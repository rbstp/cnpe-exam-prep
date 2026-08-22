#!/usr/bin/env bash
# Functional validation of the whole lab: does each piece actually WORK, not just
# "is a pod Running". Exits non-zero if anything essential is broken.
# Usage: make validate            (add FAST=1 to skip the in-cluster probe pods)
source "$(dirname "$0")/lib.sh"
set +e   # we report failures, we do not abort on them

PASS=0; FAIL=0; SKIP=0
K="kubectl --context kind-$CLUSTER"

ok_()   { printf '  \033[32m✓\033[0m %-46s %s\n' "$1" "${2:-}"; PASS=$((PASS+1)); }
bad_()  { printf '  \033[31m✗\033[0m %-46s %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }
skip_() { printf '  \033[33m-\033[0m %-46s %s\n' "$1" "${2:-}"; SKIP=$((SKIP+1)); }
head_() { printf '\n\033[36m── %s\033[0m\n' "$1"; }

# check <label> <expected> <actual>
eq() { [ "$3" = "$2" ] && ok_ "$1" "$3" || bad_ "$1" "got '$3', want '$2'"; }
# ge <label> <min> <actual>
ge() { [ "${3:-0}" -ge "$2" ] 2>/dev/null && ok_ "$1" "$3" || bad_ "$1" "got '${3:-0}', want >= $2"; }

head_ "Domain 1 — Platform architecture & infrastructure"
NODES_READY=$($K get nodes -o json 2>/dev/null | jq '[.items[]|select(.status.conditions[]|select(.type=="Ready" and .status=="True"))]|length')
eq "nodes Ready" 3 "$NODES_READY"
# Derive the expected version from K8S_IMAGE so overriding it does not produce a
# false FAIL. Strip the @sha256 digest FIRST, then take the tag: a greedy '.*:'
# on the whole string returns the digest, not the version.
EXPECT_K8S=$(printf '%s' "$K8S_IMAGE" | sed -e 's|@.*||' -e 's|.*:||')
eq "kubelet version" "$EXPECT_K8S" "$($K get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion}' 2>/dev/null)"
ZONES=$($K get nodes -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/zone}{"\n"}{end}' 2>/dev/null | sort -u | grep -c .)
ge "topology zones labelled" 2 "$ZONES"
BAD_PODS=$($K get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers 2>/dev/null | wc -l)
eq "pods not Running/Succeeded" 0 "$BAD_PODS"
NOTDEP=$(helm list -A -o json 2>/dev/null | jq '[.[]|select(.status!="deployed")]|length')
eq "helm releases not deployed" 0 "$NOTDEP"
$K top nodes >/dev/null 2>&1 && ok_ "metrics-server (kubectl top)" || bad_ "metrics-server (kubectl top)" "no metrics"
ge "VPA components" 3 "$($K -n vpa get deploy --no-headers 2>/dev/null | wc -l)"
ge "Gateway API CRDs" 8 "$($K get crd -o name 2>/dev/null | grep -c gateway.networking.k8s.io)"
# local registry round-trip
if [ "${FAST:-0}" != "1" ] && command -v docker >/dev/null; then
  if docker pull -q busybox:1.37 >/dev/null 2>&1 \
     && docker tag busybox:1.37 "localhost:$REGISTRY_PORT/validate:v1" >/dev/null 2>&1 \
     && docker push -q "localhost:$REGISTRY_PORT/validate:v1" >/dev/null 2>&1; then
    ok_ "local registry push" "localhost:$REGISTRY_PORT"
  else
    bad_ "local registry push" "see: docker logs $REGISTRY_NAME"
  fi
else
  skip_ "local registry push" "FAST=1"
fi

head_ "Domain 2 — GitOps & continuous delivery"
GITEA_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://${GITEA_HOST}:3000/api/healthz" 2>/dev/null)
eq "gitea reachable from host" "200" "$GITEA_CODE"
eq "flux GitRepository ready" "True" "$($K -n flux-system get gitrepository platform -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)"
ge "flux controllers ready" 6 "$($K -n flux-system get deploy -o json 2>/dev/null | jq '[.items[]|select(.status.readyReplicas>0)]|length')"
eq "argocd-server ready" "1" "$($K -n argocd get deploy argocd-server -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
$K -n argocd get secret gitea-repo >/dev/null 2>&1 && ok_ "argocd git repo registered" || bad_ "argocd git repo registered"
ge "argo-rollouts running" 1 "$($K -n argo-rollouts get deploy argo-rollouts -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "argo-workflows running" 1 "$($K -n argo get deploy argo-workflows-server -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "tekton deployments ready" 4 "$($K -n tekton-pipelines get deploy -o json 2>/dev/null | jq '[.items[]|select(.status.readyReplicas>0)]|length')"
ge "tekton catalog tasks" 2 "$($K get tasks.tekton.dev --no-headers 2>/dev/null | wc -l)"

head_ "Domain 3 — Platform APIs & self-service"
UNHEALTHY=$($K get providers.pkg.crossplane.io -o json 2>/dev/null | jq '[.items[]|select((.status.conditions[]?|select(.type=="Healthy")|.status)!="True")]|length')
eq "crossplane providers unhealthy" 0 "$UNHEALTHY"
FN_BAD=$($K get functions.pkg.crossplane.io -o json 2>/dev/null | jq '[.items[]|select((.status.conditions[]?|select(.type=="Healthy")|.status)!="True")]|length')
eq "crossplane functions unhealthy" 0 "$FN_BAD"
eq "XRD established" "True" "$($K get xrd appenvironments.platform.lab.local -o jsonpath='{.status.conditions[?(@.type=="Established")].status}' 2>/dev/null)"
eq "example XR reconciled (Ready)" "True" "$($K get appenvironment team-c-dev -n default -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)"
$K get ns team-c >/dev/null 2>&1 && ok_ "XR actually created its namespace" "team-c" || bad_ "XR actually created its namespace"
ge "cloudnative-pg operator ready" 1 "$($K -n cnpg-system get deploy -o json 2>/dev/null | jq '[.items[]|select(.status.readyReplicas>0)]|length')"
ge "kro ready" 1 "$($K -n kro get deploy -o json 2>/dev/null | jq '[.items[]|select(.status.readyReplicas>0)]|length')"

head_ "Domain 4 — Observability & operations"
ge "prometheus ready" 1 "$($K -n monitoring get sts prometheus-prometheus-kube-prometheus-prometheus -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "grafana ready" 1 "$($K -n monitoring get deploy prometheus-grafana -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "alertmanager ready" 1 "$($K -n monitoring get sts alertmanager-prometheus-kube-prometheus-alertmanager -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "loki ready" 1 "$($K -n monitoring get sts loki -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "jaeger ready" 1 "$($K -n tracing get deploy jaeger -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "otel collector ready" 1 "$($K -n tracing get deploy otel-collector -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
$K get instrumentation auto -n default >/dev/null 2>&1 && ok_ "otel auto-instrumentation CR" || bad_ "otel auto-instrumentation CR"
ge "opencost ready" 1 "$($K -n opencost get deploy opencost -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
# prometheus scrape health via a short-lived port-forward
if [ "${FAST:-0}" != "1" ]; then
  $K -n monitoring port-forward svc/prometheus-kube-prometheus-prometheus 19099:9090 >/dev/null 2>&1 &
  PFPID=$!; sleep 6
  UP=$(curl -s "http://localhost:19099/api/v1/query?query=count(up==1)" 2>/dev/null | jq -r '.data.result[0].value[1]//"0"')
  DOWN=$(curl -s "http://localhost:19099/api/v1/query?query=count(up==0)" 2>/dev/null | jq -r '.data.result[0].value[1]//"0"')
  kill $PFPID 2>/dev/null
  ge "prometheus targets UP" 25 "$UP"
  eq "prometheus targets DOWN" 0 "$DOWN"
  if [ "${DOWN:-0}" != "0" ]; then
    $K -n monitoring port-forward svc/prometheus-kube-prometheus-prometheus 19099:9090 >/dev/null 2>&1 &
    PF2=$!; sleep 5
    curl -s "http://localhost:19099/api/v1/targets?state=active" 2>/dev/null \
      | jq -r '.data.activeTargets[]|select(.health!="up")|"        down: \(.labels.job) -> \(.scrapeUrl)"' | sort -u
    kill $PF2 2>/dev/null
    cat <<'HINT'
        kubeadm binds these to 127.0.0.1 so Prometheus cannot reach them.
        New clusters get this from kind/cnpe.yaml.tpl already. For THIS cluster:
          make fix-cp-metrics
HINT
  fi
else
  skip_ "prometheus target health" "FAST=1"
fi
# API audit trail
AUDIT_BYTES=$(docker exec "${CLUSTER}-control-plane" stat -c %s /var/log/kubernetes/audit.log 2>/dev/null || echo 0)
ge "API audit log being written (bytes)" 10000 "$AUDIT_BYTES"

head_ "Domain 5 — Security & policy"
CIL=$($K -n kube-system get ds cilium -o jsonpath='{.status.numberReady}' 2>/dev/null)
eq "cilium agents ready" 3 "$CIL"
ge "hubble relay ready" 1 "$($K -n kube-system get deploy hubble-relay -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "kyverno controllers ready" 4 "$($K -n kyverno get deploy -o json 2>/dev/null | jq '[.items[]|select(.status.readyReplicas>0)]|length')"
ge "kyverno policies loaded" 2 "$(( $($K get validatingpolicies.policies.kyverno.io --no-headers 2>/dev/null | wc -l) + $($K get mutatingpolicies.policies.kyverno.io --no-headers 2>/dev/null | wc -l) ))"
ge "gatekeeper ready" 1 "$($K -n gatekeeper-system get deploy gatekeeper-controller-manager -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "sealed-secrets controller ready" 1 "$($K -n kube-system get deploy sealed-secrets -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
command -v kubeseal >/dev/null && ok_ "kubeseal CLI present" "$(kubeseal --version 2>/dev/null)" || bad_ "kubeseal CLI present" "not on PATH"
ge "external-secrets ready" 1 "$($K -n external-secrets get deploy external-secrets -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
ge "trivy vulnerabilityreports" 10 "$($K get vulnerabilityreports -A --no-headers 2>/dev/null | wc -l)"
ge "trivy sbomreports" 10 "$($K get sbomreports -A --no-headers 2>/dev/null | wc -l)"
ge "compliance reports (CIS/NSA/PSS)" 4 "$($K get clustercompliancereports --no-headers 2>/dev/null | wc -l)"
NODE_REPORTS=$($K get clusterinfraassessmentreports --no-headers 2>/dev/null | wc -l)
ge "per-node infra reports (all 3 nodes)" 3 "$NODE_REPORTS"
ge "tenant namespaces w/ quota" 2 "$($K get resourcequota -A --no-headers 2>/dev/null | grep -c 'team-')"
ge "tenant NetworkPolicies" 2 "$($K get networkpolicy -A --no-headers 2>/dev/null | grep -c 'team-')"

# Does NetworkPolicy actually ENFORCE? kindnet silently does not; cilium does.
if [ "${FAST:-0}" != "1" ]; then
  head_ "NetworkPolicy enforcement (the thing kindnet fakes)"
  $K -n team-a delete pod np-probe --ignore-not-found >/dev/null 2>&1
  # team-a has a default-deny egress+ingress policy; egress to the internet must FAIL
  $K -n team-a run np-probe --image=curlimages/curl:8.11.1 --restart=Never \
     --labels=app=np-probe --command -- curl -s -m 8 -o /dev/null -w '%{http_code}' http://example.com >/dev/null 2>&1
  $K -n team-a wait --for=jsonpath='{.status.phase}' pod/np-probe --timeout=90s >/dev/null 2>&1
  for i in $(seq 1 12); do
    ph=$($K -n team-a get pod np-probe -o jsonpath='{.status.phase}' 2>/dev/null)
    [ "$ph" = "Succeeded" ] || [ "$ph" = "Failed" ] && break; sleep 5
  done
  RC=$($K -n team-a get pod np-probe -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}' 2>/dev/null)
  if [ "$RC" != "0" ] && [ -n "$RC" ]; then
    ok_ "egress blocked by NetworkPolicy" "curl exit=$RC (denied, correct)"
  elif [ "$RC" = "0" ]; then
    bad_ "egress blocked by NetworkPolicy" "curl SUCCEEDED - policy not enforced!"
  else
    skip_ "egress blocked by NetworkPolicy" "probe inconclusive"
  fi
  $K -n team-a delete pod np-probe --ignore-not-found >/dev/null 2>&1
fi

head_ "SPIRE — workload identity (optional layer)"
if $K get ns spire >/dev/null 2>&1; then
  ge "spire-server ready" 1 "$($K -n spire get sts spire-server -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
  ge "spire agents ready" 1 "$($K -n spire get ds spire-agent -o jsonpath='{.status.numberReady}' 2>/dev/null)"
  ge "spiffe csi driver ready" 1 "$($K -n spire get ds spire-spiffe-csi-driver -o jsonpath='{.status.numberReady}' 2>/dev/null)"
  HEALTH=$($K -n spire exec sts/spire-server -c spire-server -- /opt/spire/bin/spire-server healthcheck 2>/dev/null | head -1)
  [ "$HEALTH" = "Server is healthy." ] && ok_ "spire-server healthcheck" "healthy" || bad_ "spire-server healthcheck" "$HEALTH"
  ENTRIES=$($K -n spire exec sts/spire-server -c spire-server -- /opt/spire/bin/spire-server entry show 2>/dev/null | grep -c '^Entry ID')
  ge "SVID registration entries" 1 "$ENTRIES"
  ge "ClusterSPIFFEID CRD present" 1 "$($K get crd clusterspiffeids.spire.spiffe.io --no-headers 2>/dev/null | wc -l)"
else
  skip_ "SPIRE" "not installed (make spire)"
fi

head_ "Mesh cluster — Istio ambient (optional layer)"
if kind get clusters 2>/dev/null | grep -qx "$MESH_CLUSTER"; then
  MK="kubectl --context kind-$MESH_CLUSTER"
  ge "istiod ready" 1 "$($MK -n istio-system get deploy istiod -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
  ge "ztunnel ready (ambient dataplane)" 1 "$($MK -n istio-system get ds ztunnel -o jsonpath='{.status.numberReady}' 2>/dev/null)"
  ge "istio-cni ready" 1 "$($MK -n istio-system get ds istio-cni-node -o jsonpath='{.status.numberReady}' 2>/dev/null)"
  eq "default ns enrolled in ambient" "ambient" "$($MK get ns default -o jsonpath='{.metadata.labels.istio\.io/dataplane-mode}' 2>/dev/null)"
  ge "flagger ready" 1 "$($MK -n istio-system get deploy flagger -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
  MBAD=$($MK get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers 2>/dev/null | wc -l)
  eq "mesh pods not Running" 0 "$MBAD"
else
  skip_ "mesh cluster" "not created (make mesh)"
fi

head_ "Portal — Backstage golden path (optional layer)"
if [ -d "$LAB_HOME/portal/packages/backend" ]; then
  ok_ "backstage app scaffolded" "$LAB_HOME/portal"
  grep -q 'scaffolder-backend-module-gitea' "$LAB_HOME/portal/packages/backend/src/index.ts" 2>/dev/null \
    && ok_ "gitea scaffolder module registered" || bad_ "gitea scaffolder module registered"
  [ -f "$LAB_HOME/portal/examples/golden-path/template.yaml" ] \
    && ok_ "golden-path template installed" || bad_ "golden-path template installed"
  if curl -s -o /dev/null -m 5 "http://localhost:3000" 2>/dev/null; then
    ok_ "backstage serving on :3000" "running"
  else
    skip_ "backstage serving on :3000" "not started (cd portal && yarn start)"
  fi
else
  skip_ "backstage app" "not scaffolded (make portal)"
fi
ASET=$($K -n argocd get applicationset golden-path -o jsonpath='{.status.conditions[?(@.type=="ErrorOccurred")].status}' 2>/dev/null)
if [ -n "$ASET" ]; then
  eq "golden-path ApplicationSet healthy" "False" "$ASET"
  ge "Applications auto-generated from git" 1 "$($K -n argocd get applications --no-headers 2>/dev/null | wc -l)"
else
  skip_ "golden-path ApplicationSet" "not applied (make portal)"
fi

printf '\n\033[36m──────────────────────────────────────────────\033[0m\n'
printf '  \033[32mPASS %d\033[0m   \033[31mFAIL %d\033[0m   \033[33mSKIP %d\033[0m\n' "$PASS" "$FAIL" "$SKIP"
printf '\033[36m──────────────────────────────────────────────\033[0m\n\n'
[ "$FAIL" -eq 0 ] || { echo "Some checks failed. 'make urls' for dashboards; 'make status' for pod-level detail."; exit 1; }
echo "Lab is fully functional."
