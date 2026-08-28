#!/usr/bin/env bash
# Auto-remediate whatever 'make break' injected, and say why.
#
#   QUICK=1  apply every repair but skip the post-repair health waits
source "$(dirname "$0")/lib.sh"
need kubectl
NS="${BREAK_NS:-team-a}"
CI_NS=drill-ci
K="kubectl --context kind-$CLUSTER -n $NS"
KC="kubectl --context kind-$CLUSTER"
GOOD_IMAGE="ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine"
PROM_GOOD="http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090"
FIXED=0

fix() { FIXED=$((FIXED+1)); printf '  \033[32mfixed\033[0m  %s\n         \033[36mwhy:\033[0m %s\n' "$1" "$2"; }
slow() { [ -z "${QUICK:-}" ]; }

HAVE_DEPLOY=0
$K get deploy broken >/dev/null 2>&1 && HAVE_DEPLOY=1

log "Inspecting the lab for injected faults"

# ── security ───────────────────────────────────────────────────────────────
# Fix these first: pods restarted by the repairs below would be rejected again.

# pss: the namespace was flipped to enforce=restricted mid-flight
ENFORCE=$($KC get ns "$NS" -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null || true)
if [ -n "$ENFORCE" ] && [ "$ENFORCE" != "baseline" ]; then
  $KC label ns "$NS" pod-security.kubernetes.io/enforce=baseline --overwrite >/dev/null
  fix "namespace enforce label -> baseline" "was '$ENFORCE'; the PodSecurity admission controller rejected every new pod in $NS ('violates PodSecurity')"
fi

# kyverno: a Deny ValidatingPolicy scoped to the tenant namespace
if $KC get validatingpolicy drill-deny >/dev/null 2>&1; then
  $KC delete validatingpolicy drill-deny >/dev/null
  fix "deleted ValidatingPolicy/drill-deny" "a Deny policy required a billing-code label on every pod in $NS; the ReplicaSet's pods were rejected at admission, so the error sits on the ReplicaSet, not the pods"
  [ "$HAVE_DEPLOY" = 1 ] && $K rollout restart deploy/broken >/dev/null 2>&1 || true
fi

# ── the broken deployment (workload faults) ───────────────────────────────
if [ "$HAVE_DEPLOY" = 1 ]; then

  # image: a tag that does not exist
  IMG=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
  if [ "$IMG" != "$GOOD_IMAGE" ]; then
    $K set image deploy/broken "nginx-unprivileged=$GOOD_IMAGE" >/dev/null
    fix "image -> $GOOD_IMAGE" "was '$IMG'; pods sat in ErrImagePull/ImagePullBackOff"
  fi

  # probe: readiness pointed at a port nothing listens on
  PROBE_PORT=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.port}' 2>/dev/null)
  if [ -n "$PROBE_PORT" ] && [ "$PROBE_PORT" != "8080" ]; then
    $K patch deploy broken --type=json -p='[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe"}]' >/dev/null
    fix "removed readinessProbe" "probed port $PROBE_PORT, container listens on 8080; pods Running but never Ready"
  fi

  # resources: requests no node can satisfy
  CPU_REQ=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null)
  MEM_REQ=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].resources.requests.memory}' 2>/dev/null)
  case "$CPU_REQ$MEM_REQ" in
    *Gi|8|[1-9])
      if [ "$CPU_REQ" != "25m" ]; then
        $K set resources deploy/broken --requests=cpu=25m,memory=32Mi >/dev/null
        fix "requests -> cpu=25m,memory=32Mi" "asked for cpu=$CPU_REQ mem=$MEM_REQ; unschedulable, pods Pending with FailedScheduling"
      fi ;;
  esac

  # pss: the pod's securityContext was stripped (paired with the enforce flip)
  APE=$($K get deploy broken -o jsonpath='{.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation}' 2>/dev/null)
  if [ "$APE" != "false" ]; then
    $K patch deploy broken --type strategic -p '{"spec":{"template":{"spec":{"securityContext":{"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"nginx-unprivileged","securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}}}' >/dev/null
    fix "restored the restricted-compliant securityContext" "it was stripped while the namespace enforced 'restricted'; every replacement pod violated PodSecurity and the deployment reported ReplicaFailure"
  fi

  # config: a volume referencing a ConfigMap that does not exist
  VOL_CM=$($K get deploy broken -o jsonpath='{.spec.template.spec.volumes[0].configMap.name}' 2>/dev/null)
  if [ -n "$VOL_CM" ] && ! $K get configmap "$VOL_CM" >/dev/null 2>&1; then
    $K patch deploy broken --type=json -p='[{"op":"remove","path":"/spec/template/spec/volumes"},{"op":"remove","path":"/spec/template/spec/containers/0/volumeMounts"}]' >/dev/null
    fix "removed volume referencing missing ConfigMap '$VOL_CM'" "pods stuck ContainerCreating; the reason is only in 'describe pod' events, never in logs"
  fi

  # rbac: a ServiceAccount with no permissions
  SA=$($K get deploy broken -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null)
  if [ -n "$SA" ] && [ "$SA" != "default" ]; then
    if ! $KC auth can-i list pods -n "$NS" --as="system:serviceaccount:$NS:$SA" >/dev/null 2>&1; then
      $K create role "$SA-reader" --verb=get,list,watch --resource=pods,configmaps \
        --dry-run=client -o yaml | $KC apply -f - >/dev/null
      $K create rolebinding "$SA-reader" --role="$SA-reader" \
        --serviceaccount="$NS:$SA" --dry-run=client -o yaml | $KC apply -f - >/dev/null
      fix "granted Role/$SA-reader to sa/$SA" "sa/$SA could not read the API; the pod runs but its app gets 403, and nothing in kubectl status shows this, only 'kubectl auth can-i --as=...'"
    fi
  fi

  # quota: replicas raised purely to collide with the clamped quota
  REPLICAS=$($K get deploy broken -o jsonpath='{.spec.replicas}' 2>/dev/null)
  if [ "${REPLICAS:-1}" -gt 2 ] 2>/dev/null; then
    $K scale deploy/broken --replicas=1 >/dev/null
    fix "replicas -> 1" "was $REPLICAS, scaled up purely to collide with the quota"
  fi
fi

# quota: ResourceQuota clamped to 1 pod (fix even without the deployment)
HARD_PODS=$($K get resourcequota team-a-quota -o jsonpath='{.spec.hard.pods}' 2>/dev/null || true)
if [ -n "$HARD_PODS" ] && [ "$HARD_PODS" -le 2 ] 2>/dev/null; then
  $K patch resourcequota team-a-quota --type=merge -p '{"spec":{"hard":{"pods":"20"}}}' >/dev/null
  fix "ResourceQuota pods -> 20" "was $HARD_PODS; the ReplicaSet could not create pods, so look for 'exceeded quota' on the ReplicaSet, not the pods"
fi

# netpol: the DNS egress rule was stripped from the tenant policy
if $K get networkpolicy allow-dns-and-same-namespace >/dev/null 2>&1; then
  if ! $K get networkpolicy allow-dns-and-same-namespace -o json 2>/dev/null | grep -q '"port": *53'; then
    $KC apply -f "$REPO_ROOT/examples/multitenancy/team-a.yaml" >/dev/null
    fix "restored the DNS egress rule on allow-dns-and-same-namespace" \
        "with default-deny in place and the DNS rule gone, the pod stays Running but cannot resolve anything. 'kubectl exec ... nslookup' is the only thing that shows it"
  fi
fi
if $K get networkpolicy oops-deny-dns >/dev/null 2>&1; then
  $K delete networkpolicy oops-deny-dns >/dev/null
  fix "deleted leftover NetworkPolicy/oops-deny-dns" "additive policy that never blocked anything"
fi

# ── gitops ─────────────────────────────────────────────────────────────────

# argocd: the drill Application points at a git ref that does not exist
if $KC -n argocd get application drill-app >/dev/null 2>&1; then
  REV=$($KC -n argocd get application drill-app -o jsonpath='{.spec.source.targetRevision}' 2>/dev/null)
  if [ "$REV" != "main" ]; then
    $KC -n argocd patch application drill-app --type merge -p '{"spec":{"source":{"targetRevision":"main"}}}' >/dev/null
    $KC -n argocd annotate application drill-app argocd.argoproj.io/refresh=normal --overwrite >/dev/null
    fix "Application drill-app targetRevision -> main" "was '$REV', a git ref that does not exist; the repo compare failed (ComparisonError in .status.conditions) so nothing synced, while the deployed pods stayed healthy and looked innocent"
    argo_ok() { [ "$($KC -n argocd get application drill-app -o jsonpath='{.status.health.status}{.status.sync.status}' 2>/dev/null)" = "HealthySynced" ]; }
    slow && { poll 120 "drill-app to become Healthy+Synced" argo_ok || true; }
  fi
fi

# flux: the drill Kustomization was suspended
if $KC -n flux-system get kustomization drill-app >/dev/null 2>&1; then
  if [ "$($KC -n flux-system get kustomization drill-app -o jsonpath='{.spec.suspend}' 2>/dev/null)" = "true" ]; then
    $KC -n flux-system patch kustomization drill-app --type merge -p '{"spec":{"suspend":false}}' >/dev/null
    $KC -n flux-system annotate kustomization drill-app "reconcile.fluxcd.io/requestedAt=$(date +%s)" --overwrite >/dev/null
    fix "resumed Kustomization drill-app" "spec.suspend was true; a suspended Kustomization is skipped entirely, so the deleted prod-demo deployment was never re-created. 'flux get kustomizations' showed it as Suspended the whole time"
    flux_ok() { [ "$($KC -n flux-system get kustomization drill-app -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; }
    slow && { poll 180 "Kustomization drill-app to reconcile" flux_ok || true; }
  fi
fi

# rollouts: the canary's analysis queried a Prometheus that does not exist
if $K get analysistemplate drill-analysis >/dev/null 2>&1; then
  ADDR=$($K get analysistemplate drill-analysis -o jsonpath='{.spec.metrics[0].provider.prometheus.address}' 2>/dev/null)
  if [ "$ADDR" != "$PROM_GOOD" ]; then
    $K patch analysistemplate drill-analysis --type=json \
      -p="[{\"op\":\"replace\",\"path\":\"/spec/metrics/0/provider/prometheus/address\",\"value\":\"$PROM_GOOD\"}]" >/dev/null
    fix "AnalysisTemplate drill-analysis address -> $PROM_GOOD" "pointed at '$ADDR', which resolves to nothing; every metric query errored, the AnalysisRun failed, and the rollout aborted itself"
  fi
  if [ "$($K get rollout drill-web -o jsonpath='{.status.abort}' 2>/dev/null)" = "true" ]; then
    # An aborted rollout stays aborted until someone retries it.
    if command -v kubectl-argo-rollouts >/dev/null 2>&1; then
      kubectl-argo-rollouts --context "kind-$CLUSTER" retry rollout drill-web -n "$NS" >/dev/null
    else
      $K patch rollout drill-web --subresource=status --type merge -p '{"status":{"abort":false}}' >/dev/null
    fi
    fix "retried rollout drill-web" "the aborted canary does not resume on its own once the analysis target is fixed; it needs an explicit retry"
    ro_ok() { [ "$($K get rollout drill-web -o jsonpath='{.status.phase}' 2>/dev/null)" = "Healthy" ]; }
    slow && { poll 180 "rollout drill-web to become Healthy" ro_ok || true; }
  fi
fi

# ── ci/cd ──────────────────────────────────────────────────────────────────

# tekton: the pipeline references a Task that is not there
if $KC -n "$CI_NS" get pipeline drill-build >/dev/null 2>&1; then
  if ! $KC -n "$CI_NS" get task drill-lint >/dev/null 2>&1; then
    $KC apply -f - >/dev/null <<YAML
apiVersion: tekton.dev/v1
kind: Task
metadata: { name: drill-lint, namespace: $CI_NS }
spec:
  steps:
    - name: lint
      image: $GOOD_IMAGE
      command: [sh, -c, 'echo lint ok']
YAML
    fix "created Task drill-lint" "Pipeline drill-build referenced it but it did not exist; every PipelineRun failed instantly with reason CouldntGetTask"
    if slow; then
      # Completed PipelineRuns are immutable, so proving the fix means a new run.
      $KC -n "$CI_NS" delete pipelinerun drill-run-retry --ignore-not-found >/dev/null 2>&1
      $KC apply -f - >/dev/null <<YAML
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata: { name: drill-run-retry, namespace: $CI_NS }
spec:
  pipelineRef: { name: drill-build }
YAML
      run_ok() { [ "$($KC -n "$CI_NS" get pipelinerun drill-run-retry -o jsonpath='{.status.conditions[?(@.type=="Succeeded")].status}' 2>/dev/null)" = "True" ]; }
      poll 180 "PipelineRun drill-run-retry to succeed" run_ok || true
    fi
  fi
fi

# tekton triggers: the EventListener's ServiceAccount lost its RBAC
if $KC -n "$CI_NS" get eventlistener drill-listener >/dev/null 2>&1; then
  if ! $KC -n "$CI_NS" get rolebinding drill-trigger-el >/dev/null 2>&1; then
    $KC apply -f - >/dev/null <<YAML
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: drill-trigger-el, namespace: $CI_NS }
subjects: [{ kind: ServiceAccount, name: drill-trigger-sa, namespace: $CI_NS }]
roleRef: { kind: ClusterRole, name: tekton-triggers-eventlistener-roles, apiGroup: rbac.authorization.k8s.io }
YAML
    # A crashlooping pod backs off for minutes; delete it so the recovery shows now.
    $KC -n "$CI_NS" delete pod -l eventlistener=drill-listener >/dev/null 2>&1
    fix "recreated RoleBinding drill-trigger-el" "sa/drill-trigger-sa had lost the tekton-triggers-eventlistener-roles binding; the listener pod could not list/watch Triggers resources ('forbidden' in its logs) and crashlooped, so webhooks went nowhere"
    el_ok() { [ "$($KC -n "$CI_NS" get eventlistener drill-listener -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; }
    slow && { poll 180 "EventListener drill-listener to become Ready" el_ok || true; }
  fi
fi

# ── platform apis ──────────────────────────────────────────────────────────

# crossplane: a provider's ClusterRoleBinding was revoked
if $KC get ns crossplane-system >/dev/null 2>&1; then
  for sa in $($KC -n crossplane-system get sa -o name 2>/dev/null | grep provider-kubernetes | sed 's|.*/||'); do
    if ! $KC get clusterrolebinding "crossplane-$sa" >/dev/null 2>&1; then
      $KC create clusterrolebinding "crossplane-$sa" \
        --clusterrole=cluster-admin --serviceaccount="crossplane-system:$sa" \
        --dry-run=client -o yaml | $KC apply -f - >/dev/null
      fix "recreated ClusterRoleBinding crossplane-$sa" "the provider runs with InjectedIdentity, so without this binding every composed Object failed with 'forbidden' in its Synced condition and the XR never became Ready"
    fi
  done
  if $KC -n default get appenvironment drill-env >/dev/null 2>&1; then
    env_ok() { [ "$($KC -n default get appenvironment drill-env -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; }
    slow && { poll 180 "AppEnvironment drill-env to become Ready" env_ok || true; }
  fi
fi

# crossplane: the seeded XR was paused
if [ "$($KC -n default get appenvironment team-c-dev -o jsonpath='{.metadata.annotations.crossplane\.io/paused}' 2>/dev/null)" = "true" ]; then
  $KC -n default annotate appenvironment team-c-dev crossplane.io/paused- >/dev/null
  fix "removed crossplane.io/paused from XR team-c-dev" "a paused XR is skipped by the reconciler (Synced=False, reason ReconcilePaused), so the cpuQuota change in its spec never reached the tenant's ResourceQuota"
  xr_ok() { [ "$($KC -n default get appenvironment team-c-dev -o jsonpath='{.status.conditions[?(@.type=="Synced")].status}' 2>/dev/null)" = "True" ]; }
  slow && { poll 60 "XR team-c-dev to sync" xr_ok || true; }
fi

# ── report ─────────────────────────────────────────────────────────────────
echo
if [ "$FIXED" -eq 0 ]; then
  ok "nothing to fix; the lab already matches the healthy baseline"
else
  if [ "$HAVE_DEPLOY" = 1 ] && slow; then
    log "Waiting for the rollout"
    $K rollout status deploy/broken --timeout=3m 2>&1 | tail -1
    $K get deploy broken -o custom-columns='NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas' --no-headers 2>&1 | sed 's/^/  /'
  fi
fi
LAST=$(head -1 /tmp/cnpe-lab/.last-fault 2>/dev/null || echo unknown)
printf '\n  injected fault was: \033[33m%s\033[0m   (fixes applied: %s)\n\n' "$LAST" "$FIXED"
