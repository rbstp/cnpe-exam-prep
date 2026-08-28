#!/usr/bin/env bash
# Domain 3 (25%, joint-largest): Crossplane, CRDs, operators, self-service.
source "$(dirname "$0")/lib.sh"
need helm; need kubectl

log "Crossplane"
repo_add crossplane-stable https://charts.crossplane.io/stable
helmi crossplane crossplane-stable/crossplane crossplane-system

log "Waiting for Crossplane CRDs"
kubectl wait --for=condition=Established crd/providers.pkg.crossplane.io --timeout=5m >/dev/null

log "Installing provider-kubernetes (composes native K8s objects, no cloud account needed)"
kubectl apply -f - <<'YAML'
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata: { name: provider-kubernetes }
spec:
  package: xpkg.crossplane.io/crossplane-contrib/provider-kubernetes:v1.3.0
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata: { name: provider-helm }
spec:
  package: xpkg.crossplane.io/crossplane-contrib/provider-helm:v1.4.0
YAML

log "Installing composition functions (v2 compositions are function-based)"
kubectl apply -f - <<'YAML'
apiVersion: pkg.crossplane.io/v1
kind: Function
metadata: { name: function-patch-and-transform }
spec:
  package: xpkg.crossplane.io/crossplane-contrib/function-patch-and-transform:v0.10.9
---
apiVersion: pkg.crossplane.io/v1
kind: Function
metadata: { name: function-auto-ready }
spec:
  package: xpkg.crossplane.io/crossplane-contrib/function-auto-ready:v0.7.0
YAML

# Use fully-qualified names here: Gatekeeper also serves a "providers" resource.
log "Waiting for providers and functions to become healthy (pulls packages, ~2-4 min)"
kubectl wait --for=condition=Healthy providers.pkg.crossplane.io/provider-kubernetes --timeout=8m || warn "provider-kubernetes slow"
kubectl wait --for=condition=Healthy providers.pkg.crossplane.io/provider-helm --timeout=8m || warn "provider-helm slow"
kubectl wait --for=condition=Healthy functions.pkg.crossplane.io --all --timeout=8m || warn "functions slow"

log "Granting the providers in-cluster credentials"
SA_K8S=$(kubectl -n crossplane-system get sa -o name | grep provider-kubernetes | sed 's|.*/||' | head -1)
SA_HELM=$(kubectl -n crossplane-system get sa -o name | grep provider-helm | sed 's|.*/||' | head -1)
for sa in "$SA_K8S" "$SA_HELM"; do
  [ -n "$sa" ] && kubectl create clusterrolebinding "crossplane-$sa" \
    --clusterrole=cluster-admin --serviceaccount="crossplane-system:$sa" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done
# Both the cluster-scoped and the namespaced (.m.) API groups need their own config.
kubectl apply -f - >/dev/null <<'YAML'
apiVersion: kubernetes.crossplane.io/v1alpha1
kind: ProviderConfig
metadata: { name: default }
spec:
  credentials: { source: InjectedIdentity }
---
apiVersion: helm.crossplane.io/v1beta1
kind: ProviderConfig
metadata: { name: default }
spec:
  credentials: { source: InjectedIdentity }
---
apiVersion: kubernetes.m.crossplane.io/v1alpha1
kind: ClusterProviderConfig
metadata: { name: default }
spec:
  credentials: { source: InjectedIdentity }
---
apiVersion: helm.m.crossplane.io/v1beta1
kind: ClusterProviderConfig
metadata: { name: default }
spec:
  credentials: { source: InjectedIdentity }
YAML

log "CloudNativePG operator (a real operator to inspect: CRDs, reconcile, status)"
repo_add cnpg https://cloudnative-pg.github.io/charts
helmi cnpg cnpg/cloudnative-pg cnpg-system

log "kro (Kubernetes Resource Orchestrator): the other self-service path"
helm --kube-context "kind-$CLUSTER" upgrade --install kro \
  oci://ghcr.io/kro-run/kro/kro --namespace kro --create-namespace --wait --timeout 8m \
  2>/dev/null || warn "kro install skipped (optional)"

log "Applying the seeded XRD / Composition / XR (self-service golden path)"
kubectl apply -f "$REPO_ROOT/examples/crossplane/xrd.yaml" >/dev/null
kubectl wait --for=condition=Established xrd/appenvironments.platform.lab.local --timeout=3m >/dev/null \
  || warn "XRD not established yet"
kubectl apply -f "$REPO_ROOT/examples/crossplane/composition.yaml" >/dev/null
# The XRD needs a moment to register its CRD before an XR of that kind is accepted.
for _ in $(seq 1 30); do
  kubectl apply -f "$REPO_ROOT/examples/crossplane/xr.yaml" >/dev/null 2>&1 && break
  sleep 4
done
log "Waiting for the XR to reconcile into a real namespace + quota"
for _ in $(seq 1 45); do
  [ "$(kubectl get appenvironment team-c-dev -n default \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ] && break
  sleep 5
done
if [ "$(kubectl get appenvironment team-c-dev -n default -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; then
  ok "XR team-c-dev reconciled -> namespace $(kubectl get appenvironment team-c-dev -n default -o jsonpath='{.status.namespace}')"
else
  warn "XR not Ready yet: kubectl describe appenvironment team-c-dev"
fi

cat <<'INFO'

  Try the seeded example:
    kubectl apply -f examples/crossplane/xrd.yaml
    kubectl apply -f examples/crossplane/composition.yaml
    kubectl apply -f examples/crossplane/xr.yaml
    kubectl get appenvironments,objects -A
    kubectl describe appenvironment team-c-dev     # read the composition trace

  Operator drill (CloudNativePG):
    kubectl explain cluster.postgresql.cnpg.io --recursive | head -60
    kubectl apply -f examples/crossplane/pg-cluster.yaml
    kubectl -n team-a get cluster,pods,pvc
    # This one will NOT become Ready, on purpose. team-a is default-deny, so the
    # Postgres pods cannot reach the API server and initdb hangs. Read the header
    # comment in that file only after you have tried to diagnose it yourself.

  Build your own CRD + controller:
    mkdir -p ~/kb-demo && cd ~/kb-demo
    kubebuilder init --domain lab.local --repo lab.local/demo
    kubebuilder create api --group platform --version v1alpha1 --kind Database
    make manifests install run

INFO
ok "Platform API layer ready"
