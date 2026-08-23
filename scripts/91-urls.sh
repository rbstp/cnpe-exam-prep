#!/usr/bin/env bash
# Every UI in the lab, with credentials and a working way to reach it.
# If cloud-provider-kind is running, LoadBalancer IPs are reachable directly.
# If not, use the port-forward command shown for each service.
source "$(dirname "$0")/lib.sh"

CPK_UP=no
# NOT pgrep -x: the kernel truncates comm to 15 chars and this name is 19, so -x
# silently never matches. And do NOT anchor with $ -- the process carries a
# trailing --gateway-channel=disabled argument.
pgrep -f 'cloud-provider-kind' >/dev/null 2>&1 && CPK_UP=yes

kc() { kubectl --context "kind-$CLUSTER" "$@"; }

lb_ip() { kc -n "$1" get svc "$2" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null; }

# name | ns | svc | svc-port | local-port | note
SERVICES="
Argo CD|argocd|argocd-server|80|8081|admin / see below
Argo Rollouts|argo-rollouts|argo-rollouts-dashboard|3100|3100|no auth
Argo Workflows|argo|argo-workflows-server|2746|2746|no auth (server authMode)
Tekton Dashboard|tekton-pipelines|tekton-dashboard|9097|9097|no auth
Grafana|monitoring|prometheus-grafana|80|3300|admin / admin  (3000 is Backstage)
Prometheus|monitoring|prometheus-kube-prometheus-prometheus|9090|9090|no auth
Alertmanager|monitoring|prometheus-kube-prometheus-alertmanager|9093|9093|no auth
Jaeger|tracing|jaeger|16686|16686|no auth
OpenCost|opencost|opencost|9090|9003|UI on /
Hubble UI|kube-system|hubble-ui|80|12000|Cilium network flows
"

printf '\n%s\n' "──────────────────────────────────────────────────────────────────────────────"
if [ "$CPK_UP" = yes ]; then
  ok "cloud-provider-kind is running; LoadBalancer IPs below are reachable directly"
else
  warn "cloud-provider-kind is NOT running, so LoadBalancer IPs stay <pending>."
  warn "Start it (needs root to bind :80/:443):"
  warn "    sudo -b nohup $(command -v cloud-provider-kind 2>/dev/null || echo cloud-provider-kind) \\"
warn "      --gateway-channel=disabled > /tmp/cnpe-lab/cpk.log 2>&1"
  warn "Until then use the port-forward commands below."
fi
printf '%s\n\n' "──────────────────────────────────────────────────────────────────────────────"

printf '%-17s %-24s %s\n' "SERVICE" "URL" "ACCESS"
printf '%-17s %-24s %s\n' "─────────────────" "────────────────────────" "──────"
echo "$SERVICES" | while IFS='|' read -r name ns svc sport lport note; do
  [ -z "$name" ] && continue
  kc -n "$ns" get svc "$svc" >/dev/null 2>&1 || continue
  ip=$(lb_ip "$ns" "$svc")
  if [ -n "$ip" ]; then
    printf '%-17s %-24s %s\n' "$name" "http://$ip:$sport" "$note"
  else
    printf '%-17s %-24s %s\n' "$name" "http://localhost:$lport" "$note"
    printf '%-17s %s\n' "" "  kubectl -n $ns port-forward svc/$svc $lport:$sport"
  fi
done

cat <<INFO

Backstage portal (runs on the HOST, not in the cluster)
  Portal           http://localhost:3000     start: cd $LAB_HOME/portal && yarn start
                   backend API on :7007      (needs Node 22; mise.toml pins it)
  Golden path      Create -> "Golden path service" -> publishes to gitea org '${GITEA_ORG}'
                   Argo CD then generates an Application automatically

Second cluster (service mesh)
  Context          kubectl config use-context kind-${MESH_CLUSTER}
  Istio ambient    istioctl ztunnel-config workload --context kind-${MESH_CLUSTER}

Always-on (no port-forward needed)
  Gitea            http://${GITEA_HOST}:3000   (also http://localhost:${GITEA_PORT})
                   ${GITEA_USER} / ${GITEA_PASS}
  OCI registry     localhost:${REGISTRY_PORT}   (push: docker push localhost:${REGISTRY_PORT}/demo:v1)

Credentials
  Argo CD    admin / $(kc -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>/dev/null | base64 -d 2>/dev/null || echo '<rotated>')
  Grafana    admin / $(kc -n monitoring get secret prometheus-grafana -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || echo admin)

No-UI things worth knowing
  API audit log    docker exec -it ${CLUSTER}-control-plane tail -f /var/log/kubernetes/audit.log | jq .
  Rollouts TUI     kubectl argo rollouts dashboard
  Hubble CLI       cilium hubble port-forward &  then: hubble observe
  Cost CLI         kubectl cost --opencost namespace --show-all-resources
  Compliance       kubectl get clustercompliancereports,vulnerabilityreports,sbomreports -A
  SPIRE identities kubectl -n spire exec sts/spire-server -c spire-server -- \\
                     /opt/spire/bin/spire-server entry show
  Golden path apps kubectl -n argocd get applicationset,applications
INFO
