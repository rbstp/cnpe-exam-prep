#!/usr/bin/env bash
# Creates the main practice cluster: kind + CNI + LoadBalancer + storage +
# metrics + a local registry. Everything else layers on top of this.
source "$(dirname "$0")/lib.sh"
need kind; need kubectl; need helm; need docker

# The apiserver is started with --audit-policy-file=/etc/kubernetes/audit/policy.yaml,
# so the mounted directory must contain a file called exactly policy.yaml. Stage it
# here rather than mounting the whole kind/ dir (whose file is named
# audit-policy.yaml -- that mismatch stops kube-apiserver from starting at all).
# Persistent path on purpose: /tmp is wiped on reboot and the apiserver would then
# fail to come back up.
AUDIT_DIR="$REPO_ROOT/.audit"
mkdir -p "$AUDIT_DIR" /tmp/cnpe-lab
install -m644 "$REPO_ROOT/kind/audit-policy.yaml" "$AUDIT_DIR/policy.yaml"

# ── local OCI registry, reachable from inside the cluster ────────────────
if [ "$(docker inspect -f '{{.State.Running}}' "$REGISTRY_NAME" 2>/dev/null || true)" != "true" ]; then
  log "Starting local registry on localhost:$REGISTRY_PORT"
  docker run -d --restart=always -p "127.0.0.1:$REGISTRY_PORT:5000" \
    --name "$REGISTRY_NAME" registry:2 >/dev/null
fi

# ── render kind config ───────────────────────────────────────────────────
if [ "$CNI" = "cilium" ]; then DISABLE_CNI=true; CNI_NOTE="Cilium installed below; kindnet does not enforce NetworkPolicy reliably";
else DISABLE_CNI=false; CNI_NOTE="using kind's built-in kindnet"; fi

sed -e "s|__CLUSTER__|$CLUSTER|g" \
    -e "s|__IMAGE__|$K8S_IMAGE|g" \
    -e "s|__DISABLE_CNI__|$DISABLE_CNI|g" \
    -e "s|__CNI_COMMENT__|$CNI_NOTE|g" \
    -e "s|__AUDIT_DIR__|$AUDIT_DIR|g" \
    "$REPO_ROOT/kind/cnpe.yaml.tpl" > /tmp/cnpe-lab/kind-$CLUSTER.yaml

if cluster_exists "$CLUSTER"; then
  ok "cluster '$CLUSTER' already exists (delete with: make down)"
else
  log "Creating kind cluster '$CLUSTER' (3 nodes)"
  if [ "$CNI" = "cilium" ]; then
    # No --wait: without a CNI the nodes stay NotReady by design, so waiting for
    # the Ready condition here would always fail. We wait after Cilium instead.
    kind create cluster --config /tmp/cnpe-lab/kind-$CLUSTER.yaml
  else
    kind create cluster --config /tmp/cnpe-lab/kind-$CLUSTER.yaml --wait 180s
  fi
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

# ── tell every node where the local registry lives ───────────────────────
log "Wiring nodes to the local registry"
for node in $(kind get nodes --name "$CLUSTER"); do
  # Two names for one registry: localhost:$REGISTRY_PORT for host-side muscle
  # memory, $REGISTRY_NAME:5000 so in-cluster pushers (kaniko) and verifiers
  # (Kyverno) can reach the same store. Both map to plain http.
  for reg in "localhost:$REGISTRY_PORT" "$REGISTRY_NAME:5000"; do
    docker exec "$node" mkdir -p "/etc/containerd/certs.d/$reg"
    docker exec -i "$node" sh -c "cat > '/etc/containerd/certs.d/$reg/hosts.toml'" <<TOML
[host."http://$REGISTRY_NAME:5000"]
  capabilities = ["pull", "resolve"]
TOML
  done
done
docker network connect kind "$REGISTRY_NAME" 2>/dev/null || true
kubectl apply -f - >/dev/null <<CM
apiVersion: v1
kind: ConfigMap
metadata: { name: local-registry-hosting, namespace: kube-public }
data:
  localRegistryHosting.v1: |
    host: "localhost:$REGISTRY_PORT"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
CM

# ── CNI ──────────────────────────────────────────────────────────────────
if [ "$CNI" = "cilium" ]; then
  log "Installing Cilium (real NetworkPolicy + Hubble flow visibility)"
  repo_add cilium https://helm.cilium.io/
  helmi cilium cilium/cilium kube-system \
    --set image.pullPolicy=IfNotPresent \
    --set ipam.mode=kubernetes \
    --set operator.replicas=1 \
    --set hubble.relay.enabled=true \
    --set hubble.ui.enabled=true \
    --set envoy.enabled=false
  cilium status --wait --context "kind-$CLUSTER" || warn "cilium not fully ready yet"
  log "Waiting for all nodes to reach Ready now that a CNI exists"
  kubectl wait --for=condition=Ready nodes --all --timeout=5m || warn "some nodes still NotReady"
fi

# ── make the registry resolvable from PODS, not just from containerd ─────
# containerd resolves $REGISTRY_NAME through docker's DNS, but pods ask
# CoreDNS, which has never heard of it. Without this entry, kaniko cannot
# push and Kyverno cannot verify signatures against the local registry.
REGISTRY_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "kind").IPAddress}}' "$REGISTRY_NAME" 2>/dev/null || true)
if [ -n "$REGISTRY_IP" ]; then
  log "Teaching CoreDNS about $REGISTRY_NAME ($REGISTRY_IP)"
  python3 - "$REGISTRY_IP" "$REGISTRY_NAME" <<'PY'
import subprocess, sys, json, re
ip, host = sys.argv[1], sys.argv[2]
cm = json.loads(subprocess.check_output(
    ["kubectl","-n","kube-system","get","cm","coredns","-o","json"]))
corefile = cm["data"]["Corefile"]
if host in corefile:
    print("    CoreDNS already knows", host); sys.exit(0)
m = re.search(r"(    hosts \{\n)", corefile)
if m:  # extend the existing hosts block (CoreDNS allows only one per server)
    corefile = corefile.replace(m.group(1), m.group(1) + f"        {ip} {host}\n", 1)
else:
    block = f"    hosts {{\n        {ip} {host}\n        fallthrough\n    }}\n"
    corefile = corefile.replace("    ready\n", "    ready\n" + block, 1)
cm["data"]["Corefile"] = corefile
subprocess.run(["kubectl","apply","-f","-"], input=json.dumps(cm).encode(), check=True)
print("    CoreDNS patched")
PY
  kubectl -n kube-system rollout restart deploy/coredns >/dev/null
  kubectl -n kube-system rollout status deploy/coredns --timeout=3m >/dev/null || true
fi

# ── LoadBalancer services actually get IPs ───────────────────────────────
if ! pgrep -f cloud-provider-kind >/dev/null 2>&1; then
  if command -v cloud-provider-kind >/dev/null; then
    log "Starting cloud-provider-kind (gives Services type=LoadBalancer real IPs)"
    # Needs root to bind :80/:443 for LoadBalancer Services. If sudo wants a
    # password and none is cached, do NOT abort the whole cluster build over an
    # optional component; everything else here works without it.
    # MUST be an absolute path: sudo replaces PATH with secure_path, which does
    # not include ~/.local/bin, so a bare name fails with "No such file".
    # --gateway-channel=disabled is REQUIRED: cloud-provider-kind embeds an older
    # Gateway API bundle and installs it at startup, but Gateway API v1.5+ ships a
    # ValidatingAdmissionPolicy (safe-upgrades.gateway.networking.k8s.io) that
    # rejects CRDs older than v1.5.0. The denial kills its service controller, so
    # no LoadBalancer ever gets an IP. We install Gateway API ourselves anyway.
    CPK="$(command -v cloud-provider-kind)"
    if sudo -n true 2>/dev/null; then
      sudo -b nohup "$CPK" --gateway-channel=disabled > /tmp/cnpe-lab/cpk.log 2>&1
      sleep 2
      # Record the PID so 'make down' can stop exactly this process instead of
      # pkill-ing every process whose argv happens to contain the name.
      pgrep -f "$CPK --gateway-channel=disabled" | head -1 > /tmp/cnpe-lab/cpk.pid 2>/dev/null || true
      sleep 5
      if pgrep -f "$CPK" >/dev/null; then ok "cloud-provider-kind running"
      else warn "cloud-provider-kind died; see /tmp/cnpe-lab/cpk.log"; fi
    else
      warn "sudo needs a password; skipping cloud-provider-kind for now."
      warn "LoadBalancer Services stay <pending> until you run, in another shell:"
      warn "  sudo -b nohup $CPK --gateway-channel=disabled > /tmp/cnpe-lab/cpk.log 2>&1"
    fi
  else
    warn "cloud-provider-kind missing; LoadBalancer Services will stay <pending>"
  fi
fi

# ── Gateway API CRDs (Istio, Linkerd, Argo Rollouts, Cilium all use these) ─
log "Installing Gateway API CRDs (standard channel)"
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.1/standard-install.yaml

# ── metrics-server: required for HPA, kubectl top, VPA recommendations ────
log "Installing metrics-server"
repo_add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helmi metrics-server metrics-server/metrics-server kube-system \
  --set 'args={--kubelet-insecure-tls,--kubelet-preferred-address-types=InternalIP}'

# ── VPA: the syllabus calls out update modes explicitly ──────────────────
log "Installing Vertical Pod Autoscaler"
repo_add fairwinds-stable https://charts.fairwinds.com/stable
helmi vpa fairwinds-stable/vpa vpa \
  --set recommender.enabled=true --set updater.enabled=true --set admissionController.enabled=true \
  || warn "VPA install failed; non-fatal, retry later"

log "Cluster summary"
kubectl get nodes -o wide
ok "Cluster up. Next: make gitea && make gitops"
