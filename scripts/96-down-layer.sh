#!/usr/bin/env bash
# Remove one layer from the running cluster, so the next section starts with
# only what it needs. The cluster itself, gitea and the registry always survive;
# 'make <layer>' puts the layer back. CRDs are left behind (helm keeps them on
# uninstall, and Tekton's come from a plain manifest): they cost no memory and
# the re-install is a no-op.
source "$(dirname "$0")/lib.sh"
need helm; need kubectl

LAYER="${1:-}"

uninstall() { # uninstall <namespace> <release>...
  local ns="$1"; shift
  local r
  for r in "$@"; do
    if helm --kube-context "kind-$CLUSTER" uninstall "$r" -n "$ns" --ignore-not-found >/dev/null 2>&1; then
      ok "helm release $r ($ns)"
    else
      warn "could not uninstall $r in $ns"
    fi
  done
}

drop_ns() { # drop_ns <namespace>...
  local n
  for n in "$@"; do
    if kubectl --context "kind-$CLUSTER" delete ns "$n" --ignore-not-found --wait=false >/dev/null; then
      ok "namespace $n"
    else
      warn "could not delete namespace $n"
    fi
  done
}

case "$LAYER" in
  gitops)
    log "Removing Argo CD, Argo Rollouts, Argo Workflows and Flux"
    uninstall argocd argocd
    uninstall argo-rollouts argo-rollouts
    uninstall argo argo-workflows
    if command -v flux >/dev/null && flux uninstall -s >/dev/null 2>&1; then ok "flux components"; fi
    drop_ns argocd argo-rollouts argo flux-system
    ;;
  cicd)
    log "Removing Tekton and the Trivy operator"
    uninstall trivy-system trivy-operator
    drop_ns tekton-pipelines tekton-pipelines-resolvers trivy-system
    ;;
  api)
    log "Removing Crossplane, CloudNativePG and kro"
    uninstall crossplane-system crossplane
    uninstall cnpg-system cnpg
    uninstall kro kro
    drop_ns crossplane-system cnpg-system kro
    ;;
  obs)
    log "Removing Prometheus, Grafana, Loki, Alloy, Jaeger, OTel and OpenCost"
    uninstall monitoring prometheus loki alloy
    uninstall opentelemetry-operator-system opentelemetry-operator
    uninstall opencost opencost
    drop_ns monitoring tracing opencost opentelemetry-operator-system
    ;;
  sec)
    log "Removing Kyverno, Gatekeeper, sealed secrets and external secrets"
    uninstall kyverno kyverno
    uninstall gatekeeper-system gatekeeper
    uninstall external-secrets external-secrets
    uninstall kube-system sealed-secrets   # installed into kube-system; the release goes, the namespace stays
    drop_ns kyverno gatekeeper-system external-secrets
    ;;
  spire)
    log "Removing SPIRE"
    uninstall "${SPIRE_NS:-spire}" spire spire-crds
    drop_ns "${SPIRE_NS:-spire}"
    ;;
  mesh)
    log "Deleting the second cluster"
    need kind
    if kind get clusters 2>/dev/null | grep -qx "$MESH_CLUSTER"; then
      kind delete cluster --name "$MESH_CLUSTER" >/dev/null 2>&1 && ok "cluster $MESH_CLUSTER gone"
    else
      warn "no cluster named $MESH_CLUSTER"
    fi
    ;;
  *)
    die "usage: 95-down-layer.sh gitops|cicd|api|obs|sec|spire|mesh"
    ;;
esac

ok "layer '$LAYER' removed; 'make $LAYER' puts it back"
