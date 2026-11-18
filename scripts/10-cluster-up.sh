#!/usr/bin/env bash
# Creates the main practice cluster: kind, CNI, LoadBalancer, storage, metrics, registry.
source "$(dirname "$0")/lib.sh"
need kind; need kubectl; need helm; need docker
SMOKE=${CNPE_SMOKE:-0}

docker info >/dev/null 2>&1 || die "cannot talk to the docker daemon.
     If dockerd is running, you are probably not in the 'docker' group
     (check: id -nG | grep -w docker). Fix, then log out and back in:
       sudo usermod -aG docker \$USER      # or re-run: make host"

# The apiserver needs this directory to hold a file named exactly policy.yaml.
AUDIT_DIR="$REPO_ROOT/.audit"
mkdir -p "$AUDIT_DIR" /tmp/cnpe-lab
install -m644 "$REPO_ROOT/kind/audit-policy.yaml" "$AUDIT_DIR/policy.yaml"
record_image kind_node "$K8S_IMAGE"

# ── local OCI registry, reachable from inside the cluster ────────────────
if [ "$SMOKE" != 1 ] && [ "$(docker inspect -f '{{.State.Running}}' "$REGISTRY_NAME" 2>/dev/null || true)" != "true" ]; then
  log "Starting local registry on localhost:$REGISTRY_PORT"
  docker run -d --restart=always -p "127.0.0.1:$REGISTRY_PORT:5000" \
    --name "$REGISTRY_NAME" registry:2 >/dev/null
fi
if [ "$SMOKE" != 1 ]; then
  registry_ref=$(docker image inspect -f '{{index .RepoDigests 0}}' registry:2 2>/dev/null || true)
  [ -n "$registry_ref" ] || registry_ref=$(docker image inspect -f '{{.Id}}' registry:2)
  record_image local_registry "$registry_ref"
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
    # No --wait: the nodes stay NotReady until Cilium is installed further down.
    kind create cluster --config /tmp/cnpe-lab/kind-$CLUSTER.yaml
  else
    kind create cluster --config /tmp/cnpe-lab/kind-$CLUSTER.yaml --wait 180s
  fi
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

# ── tell every node where the local registry lives ───────────────────────
if [ "$SMOKE" != 1 ]; then
  log "Wiring nodes to the local registry"
  for node in $(kind get nodes --name "$CLUSTER"); do
    # Two names for one registry: one for host commands, one for in-cluster clients.
    for reg in "localhost:$REGISTRY_PORT" "$REGISTRY_NAME:5000"; do
      docker exec "$node" mkdir -p "/etc/containerd/certs.d/$reg"
      docker exec -i "$node" sh -c "cat > '/etc/containerd/certs.d/$reg/hosts.toml'" <<TOML
[host."http://$REGISTRY_NAME:5000"]
  capabilities = ["pull", "resolve"]
TOML
    done
  done
  REGISTRY_IP=$(kind_fixed_ip 6)
  if [ "$(docker inspect -f '{{with index .NetworkSettings.Networks "kind"}}{{.IPAddress}}{{end}}' "$REGISTRY_NAME")" != "$REGISTRY_IP" ]; then
    docker network disconnect kind "$REGISTRY_NAME" 2>/dev/null || true
    docker network connect --ip "$REGISTRY_IP" kind "$REGISTRY_NAME"
  fi
  kubectl apply -f - >/dev/null <<CM
apiVersion: v1
kind: ConfigMap
metadata: { name: local-registry-hosting, namespace: kube-public }
data:
  localRegistryHosting.v1: |
    host: "localhost:$REGISTRY_PORT"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
CM
fi

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
  # After a reboot the kind nodes come back on new addresses, and the agents keep
  # the old ones cached: every endpoint sync fails with "cannot take ownership of
  # CEP that is not local". Restarting the agents is the whole fix.
  if cilium status --context "kind-$CLUSTER" 2>/dev/null | grep -q 'cannot take ownership of CEP'; then
    log "Restarting the Cilium agents (they still hold the node addresses from before a restart)"
    kubectl -n kube-system rollout restart ds/cilium >/dev/null
    kubectl -n kube-system rollout status ds/cilium --timeout=5m >/dev/null || true
  fi
  cilium status --wait --wait-duration 3m --context "kind-$CLUSTER" >/dev/null || warn "cilium not fully ready yet"
  log "Waiting for all nodes to reach Ready now that a CNI exists"
  kubectl wait --for=condition=Ready nodes --all --timeout=5m || warn "some nodes still NotReady"
fi

# A reboot kills Job pods mid-run; once their Job is gone (Trivy deletes its scan
# Jobs), nothing ever removes them, and they fail 'make validate'.
if cluster_exists "$CLUSTER"; then
  kubectl get pods -A --field-selector=status.phase=Failed -o json \
    | jq -r --argjson jobs "$(kubectl get jobs -A -o json | jq '[.items[].metadata.uid]')" \
      '.items[] | select(.metadata.ownerReferences[0].kind == "Job")
       | select(.metadata.ownerReferences[0].uid as $u | ($jobs | index($u)) == null)
       | "\(.metadata.namespace) \(.metadata.name)"' \
    | while read -r ns pod; do kubectl -n "$ns" delete pod "$pod" --wait=false >/dev/null && ok "removed orphaned pod $ns/$pod"; done
fi

# ── make the registry resolvable from pods, not just from containerd ─────
if [ "$SMOKE" != 1 ]; then
  coredns_host "$(kind_fixed_ip 6)" "$REGISTRY_NAME"
fi

# ── LoadBalancer services actually get IPs ───────────────────────────────
if [ "$SMOKE" != 1 ] && ! cpk_running; then
  if command -v cloud-provider-kind >/dev/null; then
    log "Starting cloud-provider-kind (gives Services type=LoadBalancer real IPs)"
    # On Linux each load balancer is a container on the kind network, so the docker
    # socket is all it needs: it runs as you, like kind does.
    mkdir -p /tmp/cnpe-lab
    setsid nohup "$(command -v cloud-provider-kind)" --gateway-channel=disabled \
      > /tmp/cnpe-lab/cpk.log 2>&1 < /dev/null &
    echo $! > /tmp/cnpe-lab/cpk.pid
    sleep 5
    if kill -0 "$(cat /tmp/cnpe-lab/cpk.pid)" 2>/dev/null; then ok "cloud-provider-kind running"
    else warn "cloud-provider-kind died; see /tmp/cnpe-lab/cpk.log"; fi
  else
    warn "cloud-provider-kind missing; LoadBalancer Services will stay <pending>"
  fi
fi

# ── Gateway API CRDs (Istio, Linkerd, Argo Rollouts, Cilium all use these) ─
if [ "$SMOKE" != 1 ]; then
  log "Installing Gateway API CRDs (standard channel)"
  kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.7.0/standard-install.yaml

  # ── metrics-server: required for HPA, kubectl top, VPA recommendations ──
  log "Installing metrics-server"
  repo_add metrics-server https://kubernetes-sigs.github.io/metrics-server/
  helmi metrics-server metrics-server/metrics-server kube-system \
    --set 'args={--kubelet-insecure-tls,--kubelet-preferred-address-types=InternalIP}'

  # ── VPA: the syllabus calls out update modes explicitly ────────────────
  log "Installing Vertical Pod Autoscaler"
  repo_add fairwinds-stable https://charts.fairwinds.com/stable
  helmi vpa fairwinds-stable/vpa vpa \
    --set recommender.enabled=true --set updater.enabled=true --set admissionController.enabled=true \
    || warn "VPA install failed; non-fatal, retry later"
else
  ok "CI smoke mode: skipped registry, cloud-provider-kind, Gateway API, metrics-server, and VPA"
fi

log "Cluster summary"
kubectl get nodes -o wide
ok "Cluster up. Next: make gitea && make gitops"
