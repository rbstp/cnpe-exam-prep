#!/usr/bin/env bash
# Start (or stop) a port-forward for every UI in the lab, in the background.
# Useful when cloud-provider-kind is not running, or when you just want stable
# localhost ports that do not change.
#   make forward        start them all
#   make forward-stop   kill them all
source "$(dirname "$0")/lib.sh"

PIDFILE=/tmp/cnpe-lab/forwards.pids
mkdir -p /tmp/cnpe-lab

# name|ns|svc|local:remote
FORWARDS="
argocd|argocd|argocd-server|8081:80
rollouts|argo-rollouts|argo-rollouts-dashboard|3100:3100
workflows|argo|argo-workflows-server|2746:2746
tekton|tekton-pipelines|tekton-dashboard|9097:9097
grafana|monitoring|prometheus-grafana|3300:80
prometheus|monitoring|prometheus-kube-prometheus-prometheus|9090:9090
alertmanager|monitoring|prometheus-kube-prometheus-alertmanager|9093:9093
jaeger|tracing|jaeger|16686:16686
opencost|opencost|opencost|9003:9090
hubble|kube-system|hubble-ui|12000:80
"

stop() {
  local n=0
  if [ -f "$PIDFILE" ]; then
    while read -r pid name; do
      [ -n "$pid" ] || continue
      if kill "$pid" 2>/dev/null; then n=$((n+1)); fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  # Belt and braces: anything left over from a previous shell.
  pkill -f "kubectl --context kind-$CLUSTER -n .* port-forward" 2>/dev/null || true
  ok "stopped $n port-forward(s)"
}

case "${1:-start}" in
  stop) stop; exit 0 ;;
  start) ;;
  *) die "usage: 93-forward.sh [start|stop]" ;;
esac

# Never stack duplicates on the same ports.
[ -f "$PIDFILE" ] && { warn "forwards already running — restarting them"; stop; }

log "Starting port-forwards (logs in /tmp/cnpe-lab/pf-<name>.log)"
: > "$PIDFILE"
printf '  %-13s %s\n' "SERVICE" "URL"
echo "$FORWARDS" | while IFS='|' read -r name ns svc ports; do
  [ -z "$name" ] && continue
  kubectl --context "kind-$CLUSTER" -n "$ns" get svc "$svc" >/dev/null 2>&1 || {
    printf '  %-13s %s\n' "$name" "(service not found — layer not installed)"; continue; }
  nohup kubectl --context "kind-$CLUSTER" -n "$ns" port-forward "svc/$svc" "$ports" \
    > "/tmp/cnpe-lab/pf-$name.log" 2>&1 &
  echo "$! $name" >> "$PIDFILE"
  printf '  %-13s http://localhost:%s\n' "$name" "${ports%%:*}"
done

sleep 4
ALIVE=$(awk '{print $1}' "$PIDFILE" 2>/dev/null | while read -r p; do kill -0 "$p" 2>/dev/null && echo x; done | wc -l)
TOTAL=$(wc -l < "$PIDFILE" 2>/dev/null || echo 0)
[ "$ALIVE" = "$TOTAL" ] && ok "$ALIVE/$TOTAL forwards up" \
  || warn "$ALIVE/$TOTAL up — check /tmp/cnpe-lab/pf-*.log (a dead one usually means the port is taken)"

cat <<INFO

  Credentials    Argo CD admin / $(kubectl --context "kind-$CLUSTER" -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>/dev/null | base64 -d 2>/dev/null || echo '<rotated>')
                 Grafana admin / admin
  Stop them      make forward-stop
  Note           port 3000 is left free for Backstage; Grafana is on 3300.

INFO
