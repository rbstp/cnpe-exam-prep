#!/usr/bin/env bash
# Bind control-plane component metrics to 0.0.0.0 on an ALREADY-RUNNING cluster.
#
# kubeadm binds kube-controller-manager and kube-scheduler to 127.0.0.1 and etcd's
# metrics listener to 127.0.0.1:2381, so Prometheus (running as a pod) cannot reach
# any of them: 3 targets DOWN and every control-plane Grafana dashboard empty.
#
# kind/cnpe.yaml.tpl already fixes this for NEW clusters via kubeadmConfigPatches.
# This script retrofits a cluster that was created before that, by editing the
# static pod manifests. kubelet notices the change and restarts each pod itself.
#
# Safe by construction: manifests are copied out, edited, YAML-validated, and
# copied back one at a time, least-critical first, waiting for Ready in between.
# Originals are kept under /tmp/cnpe-lab/cp-manifest-backup/.
source "$(dirname "$0")/lib.sh"
need kubectl; need docker

NODE="${CLUSTER}-control-plane"
BK=/tmp/cnpe-lab/cp-manifest-backup
mkdir -p "$BK/work"
docker inspect "$NODE" >/dev/null 2>&1 || die "control-plane container '$NODE' not found"

apply_one() {
  local file="$1" pod="$2" desc="$3"
  local src="/etc/kubernetes/manifests/$file.yaml"

  docker cp "$NODE:$src" "$BK/$file.yaml" >/dev/null 2>&1 || die "could not read $src"
  cp "$BK/$file.yaml" "$BK/work/$file.yaml"

  case "$file" in
    etcd) sed -i 's|--listen-metrics-urls=http://127.0.0.1:2381|--listen-metrics-urls=http://0.0.0.0:2381|' "$BK/work/$file.yaml" ;;
    *)    sed -i 's|--bind-address=127.0.0.1|--bind-address=0.0.0.0|' "$BK/work/$file.yaml" ;;
  esac

  if diff -q "$BK/$file.yaml" "$BK/work/$file.yaml" >/dev/null; then
    ok "$desc already bound to 0.0.0.0"; return
  fi
  # Never push a manifest we just broke.
  python3 -c "import yaml,sys; yaml.safe_load(open('$BK/work/$file.yaml'))" 2>/dev/null \
    || die "edited $file.yaml is not valid YAML — original kept at $BK/$file.yaml"

  log "$desc: applying (backup: $BK/$file.yaml)"
  docker cp "$BK/work/$file.yaml" "$NODE:$src" >/dev/null || die "could not write $src"

  local i ready
  for i in $(seq 1 36); do
    ready=$(kubectl --context "kind-$CLUSTER" -n kube-system get pod "$pod" \
      -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null)
    [ "$ready" = "true" ] && break
    sleep 5
  done
  if [ "$ready" = "true" ]; then
    ok "$desc restarted and Ready"
  else
    warn "$desc did not become Ready. Roll back with:"
    warn "  docker cp $BK/$file.yaml $NODE:$src"
    die "aborting before touching anything else"
  fi
}

# Least critical first: a broken scheduler is recoverable, a broken etcd is not.
apply_one kube-scheduler          "kube-scheduler-$NODE"          "kube-scheduler"
apply_one kube-controller-manager "kube-controller-manager-$NODE" "kube-controller-manager"

log "Checking the API is still healthy before touching etcd"
[ "$(kubectl --context "kind-$CLUSTER" get --raw='/readyz' 2>/dev/null)" = "ok" ] \
  || die "/readyz is not ok — refusing to touch etcd"
apply_one etcd "etcd-$NODE" "etcd"

log "Verifying the cluster still works"
[ "$(kubectl --context "kind-$CLUSTER" get --raw='/readyz' 2>/dev/null)" = "ok" ] \
  && ok "/readyz ok" || warn "/readyz not ok — check 'kubectl get --raw=/readyz?verbose'"

# kube-proxy reads a ConfigMap, not a static pod, so it is fixed through the API.
log "kube-proxy metricsBindAddress"
CM=$(kubectl --context "kind-$CLUSTER" -n kube-system get cm kube-proxy -o jsonpath='{.data.config\.conf}' 2>/dev/null)
if printf '%s' "$CM" | grep -q 'metricsBindAddress: "0.0.0.0:10249"'; then
  ok "kube-proxy already exposes metrics"
else
  printf '%s' "$CM" | sed 's|^metricsBindAddress:.*|metricsBindAddress: "0.0.0.0:10249"|' > /tmp/cnpe-lab/kube-proxy.conf
  kubectl --context "kind-$CLUSTER" -n kube-system create cm kube-proxy \
    --from-file=config.conf=/tmp/cnpe-lab/kube-proxy.conf \
    --from-literal=kubeconfig.conf="$(kubectl --context "kind-$CLUSTER" -n kube-system get cm kube-proxy -o jsonpath='{.data.kubeconfig\.conf}')" \
    --dry-run=client -o yaml | kubectl --context "kind-$CLUSTER" apply -f - >/dev/null
  kubectl --context "kind-$CLUSTER" -n kube-system rollout restart ds/kube-proxy >/dev/null
  kubectl --context "kind-$CLUSTER" -n kube-system rollout status ds/kube-proxy --timeout=3m >/dev/null \
    && ok "kube-proxy restarted with metrics enabled"
fi

cat <<INFO

  Prometheus needs ~60s to re-scrape. Then:
    make validate            # 'prometheus targets DOWN' should read 0
  Grafana's Kubernetes / Compute Resources and etcd dashboards will populate.

INFO
ok "Control-plane metrics exposed"
