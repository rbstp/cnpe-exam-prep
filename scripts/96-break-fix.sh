#!/usr/bin/env bash
# Auto-remediate whatever 'make break' injected, and say WHY.
#
# Detection is state-based, not "read /tmp/.last-fault", for two reasons: it still
# works if that file is gone, and printing the evidence it matched on is the part
# worth learning. Use it to reset the drill, or to check your own diagnosis after
# you have had a go yourself.
source "$(dirname "$0")/lib.sh"
need kubectl
NS="${BREAK_NS:-team-a}"
K="kubectl --context kind-$CLUSTER -n $NS"
GOOD_IMAGE="ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine"
FIXED=0

$K get deploy broken >/dev/null 2>&1 || { warn "no 'broken' deployment in $NS — nothing to fix (run: make break)"; exit 0; }

fix() { FIXED=$((FIXED+1)); printf '  \033[32mfixed\033[0m  %s\n         \033[36mwhy:\033[0m %s\n' "$1" "$2"; }

log "Inspecting $NS/deploy/broken"

# 1. image — a tag that does not exist
IMG=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
if [ "$IMG" != "$GOOD_IMAGE" ]; then
  $K set image deploy/broken "nginx-unprivileged=$GOOD_IMAGE" >/dev/null
  fix "image -> $GOOD_IMAGE" "was '$IMG'; pods sat in ErrImagePull/ImagePullBackOff"
fi

# 2. probe — readiness pointed at a port nothing listens on
PROBE_PORT=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.port}' 2>/dev/null)
if [ -n "$PROBE_PORT" ] && [ "$PROBE_PORT" != "8080" ]; then
  $K patch deploy broken --type=json -p='[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe"}]' >/dev/null
  fix "removed readinessProbe" "probed port $PROBE_PORT, container listens on 8080 — pods Running but never Ready"
fi

# 3. resources — requests no node can satisfy
CPU_REQ=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null)
MEM_REQ=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null)
case "$CPU_REQ$MEM_REQ" in
  *Gi|8|[1-9]) 
    if [ "$CPU_REQ" != "25m" ]; then
      $K set resources deploy/broken --requests=cpu=25m,memory=32Mi >/dev/null
      fix "requests -> cpu=25m,memory=32Mi" "asked for cpu=$CPU_REQ mem=$MEM_REQ; unschedulable, pods Pending with FailedScheduling"
    fi ;;
esac

# 4. quota — ResourceQuota clamped to 1 pod while replicas were raised
HARD_PODS=$($K get resourcequota team-a-quota -o jsonpath='{.spec.hard.pods}' 2>/dev/null)
if [ -n "$HARD_PODS" ] && [ "$HARD_PODS" -le 2 ] 2>/dev/null; then
  $K patch resourcequota team-a-quota --type=merge -p '{"spec":{"hard":{"pods":"20"}}}' >/dev/null
  fix "ResourceQuota pods -> 20" "was $HARD_PODS; the ReplicaSet could not create pods — look for 'exceeded quota' on the ReplicaSet, not the pods"
fi
REPLICAS=$($K get deploy broken -o jsonpath='{.spec.replicas}' 2>/dev/null)
if [ "${REPLICAS:-1}" -gt 2 ] 2>/dev/null; then
  $K scale deploy/broken --replicas=1 >/dev/null
  fix "replicas -> 1" "was $REPLICAS, scaled up purely to collide with the quota"
fi

# 5. netpol — the DNS egress rule was stripped from the tenant policy
if $K get networkpolicy allow-dns-and-same-namespace >/dev/null 2>&1; then
  if ! $K get networkpolicy allow-dns-and-same-namespace -o json 2>/dev/null | grep -q '"port": *53'; then
    kubectl --context "kind-$CLUSTER" apply -f "$REPO_ROOT/examples/multitenancy/team-a.yaml" >/dev/null
    fix "restored the DNS egress rule on allow-dns-and-same-namespace" \
        "with default-deny in place and the DNS rule gone, the pod stays Running but cannot resolve anything. 'kubectl exec ... nslookup' is the only thing that shows it"
  fi
fi
# legacy no-op fault from an earlier version of the drill; remove it if present
if $K get networkpolicy oops-deny-dns >/dev/null 2>&1; then
  $K delete networkpolicy oops-deny-dns >/dev/null
  fix "deleted leftover NetworkPolicy/oops-deny-dns" "additive policy that never blocked anything"
fi

# 6. config — a volume referencing a ConfigMap that does not exist
VOL_CM=$($K get deploy broken -o jsonpath='{.spec.template.spec.volumes[0].configMap.name}' 2>/dev/null)
if [ -n "$VOL_CM" ] && ! $K get configmap "$VOL_CM" >/dev/null 2>&1; then
  $K patch deploy broken --type=json -p='[{"op":"remove","path":"/spec/template/spec/volumes"},{"op":"remove","path":"/spec/template/spec/containers/0/volumeMounts"}]' >/dev/null
  fix "removed volume referencing missing ConfigMap '$VOL_CM'" "pods stuck ContainerCreating; the reason is only in 'describe pod' events, never in logs"
fi

# 7. rbac — a ServiceAccount with no permissions
SA=$($K get deploy broken -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null)
if [ -n "$SA" ] && [ "$SA" != "default" ]; then
  if ! kubectl --context "kind-$CLUSTER" auth can-i list pods -n "$NS" \
        --as="system:serviceaccount:$NS:$SA" >/dev/null 2>&1; then
    $K create role "$SA-reader" --verb=get,list,watch --resource=pods,configmaps \
      --dry-run=client -o yaml | kubectl --context "kind-$CLUSTER" apply -f - >/dev/null
    $K create rolebinding "$SA-reader" --role="$SA-reader" \
      --serviceaccount="$NS:$SA" --dry-run=client -o yaml | kubectl --context "kind-$CLUSTER" apply -f - >/dev/null
    fix "granted Role/$SA-reader to sa/$SA" "sa/$SA could not read the API; the pod runs but its app gets 403 — nothing in kubectl status shows this, only 'kubectl auth can-i --as=...'"
  fi
fi

echo
if [ "$FIXED" -eq 0 ]; then
  ok "nothing to fix — deployment already matches the healthy baseline"
else
  log "Waiting for the rollout"
  $K rollout status deploy/broken --timeout=3m 2>&1 | tail -1
fi
$K get deploy broken -o custom-columns='NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas' --no-headers 2>&1 | sed 's/^/  /'
LAST=$(cat /tmp/cnpe-lab/.last-fault 2>/dev/null || echo unknown)
printf '\n  injected fault was: \033[33m%s\033[0m   (fixes applied: %s)\n\n' "$LAST" "$FIXED"
