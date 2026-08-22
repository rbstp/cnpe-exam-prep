#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
echo
printf '%-22s %s\n' "CLUSTERS" "$(kind get clusters 2>/dev/null | tr '\n' ' ')"
printf '%-22s %s\n' "CONTEXT" "$(kubectl config current-context 2>/dev/null)"
echo
kubectl --context "kind-$CLUSTER" get nodes -o wide 2>/dev/null
echo
echo "── Endpoints (LoadBalancer IPs are reachable directly from this host) ──"
kubectl --context "kind-$CLUSTER" get svc -A \
  --field-selector spec.type=LoadBalancer \
  -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,IP:.status.loadBalancer.ingress[0].ip,PORTS:.spec.ports[*].port' 2>/dev/null
echo
echo "── Not-ready pods ──"
kubectl --context "kind-$CLUSTER" get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded 2>/dev/null | head -20
echo
echo "── Host load ──"
printf 'mem: %s   ' "$(free -h | awk '/Mem:/{print $3"/"$2}')"
printf 'containers: %s   ' "$(docker ps -q | wc -l)"
printf 'cpu MHz: %s\n' "$(awk -F: '/MHz/{s+=$2;n++} END{printf "%.0f avg", s/n}' /proc/cpuinfo)"
[ -f "$REPO_ROOT/.gitea-info" ] && { echo; cat "$REPO_ROOT/.gitea-info"; }
