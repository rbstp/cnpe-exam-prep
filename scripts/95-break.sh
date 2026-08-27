#!/usr/bin/env bash
# "Diagnosing and Remediating Platform Issue and Incident Scenarios" is 1/3 of
# domain 4 and the hardest thing to practise alone. This injects one fault at
# random and starts a timer. Don't read the source before playing.
#
# The faults are grouped by exam domain. The workload group is classic broken-pod
# Kubernetes; the rest break the platform tooling the exam actually weights: an
# Argo CD sync, a Flux Kustomization, a Rollouts canary analysis, a Tekton
# pipeline and trigger, a Crossplane provider and XR, a Kyverno policy, and PSS.
#
#   make break                     random fault from the whole library
#   DOMAIN=gitops make break       random fault from one domain
#   FAULT=flux-suspend make break  one specific fault
source "$(dirname "$0")/lib.sh"
need kubectl

# Pin the context: the mesh exercises tell you to switch kubectl to kind-mesh,
# and a drill that lands on whatever cluster you happen to be pointed at is a
# fault injector in the bad sense.
K="kubectl --context kind-$CLUSTER"

NS=team-a
CI_NS=drill-ci
GITOPS_NS=drill-gitops
PROM_GOOD="http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090"
REPO_URL="http://${GITEA_HOST}:3000/${GITEA_USER}/platform.git"
mkdir -p /tmp/cnpe-lab

WORKLOAD=(image probe resources rbac quota netpol config)
GITOPS=(argocd-rev flux-suspend canary-analysis)
CICD=(tekton-task tekton-trigger)
APIS=(xp-provider-rbac xr-paused)
SECURITY=(kyverno-deny pss-restricted)
FAULTS=("${WORKLOAD[@]}" "${GITOPS[@]}" "${CICD[@]}" "${APIS[@]}" "${SECURITY[@]}")
DOMAINS=(workload gitops cicd apis security)

domain_of() {
  case "$1" in
    image|probe|resources|rbac|quota|netpol|config) echo workload ;;
    argocd-rev|flux-suspend|canary-analysis)        echo gitops ;;
    tekton-task|tekton-trigger)                     echo cicd ;;
    xp-provider-rbac|xr-paused)                     echo apis ;;
    kyverno-deny|pss-restricted)                    echo security ;;
  esac
}

if [ -n "${FAULT:-}" ]; then
  printf '%s\n' "${FAULTS[@]}" | grep -qx "$FAULT" || die "FAULT must be one of: ${FAULTS[*]}"
  F="$FAULT"
elif [ -n "${DOMAIN:-}" ]; then
  case "$DOMAIN" in
    workload) POOL=("${WORKLOAD[@]}") ;;
    gitops)   POOL=("${GITOPS[@]}") ;;
    cicd)     POOL=("${CICD[@]}") ;;
    apis)     POOL=("${APIS[@]}") ;;
    security) POOL=("${SECURITY[@]}") ;;
    *) die "DOMAIN must be one of: ${DOMAINS[*]}" ;;
  esac
  F=${POOL[$RANDOM % ${#POOL[@]}]}
else
  F=${FAULTS[$RANDOM % ${#FAULTS[@]}]}
fi
D=$(domain_of "$F")

$K get ns "$NS" >/dev/null 2>&1 || $K apply -f "$REPO_ROOT/examples/multitenancy/team-a.yaml" >/dev/null

# ── reset ────────────────────────────────────────────────────────────────
# Heal whatever the previous drill broke (break-fix is state-based, so this is
# a no-op on a healthy lab), then remove the previous scenario's objects so
# stale artifacts don't become red herrings in this one. QUICK=1 skips
# break-fix's post-repair health waits; everything it repaired that we still
# need gets deleted or re-created below anyway.
log "Resetting the drill (heal previous fault, remove old scenario objects)"
QUICK=1 "$REPO_ROOT/scripts/96-break-fix.sh" >/dev/null 2>&1 || true

$K -n "$NS" delete deploy broken --ignore-not-found >/dev/null 2>&1 || true
if $K -n argocd get application drill-app >/dev/null 2>&1; then
  # The resources-finalizer makes deletion cascade to the deployed workload.
  # Wait for it: a dying app that still self-heals would fight the next fault.
  $K -n argocd delete application drill-app --wait=false >/dev/null 2>&1 || true
  $K -n argocd wait --for=delete application/drill-app --timeout=120s >/dev/null 2>&1 \
    || die "the previous drill's Argo CD Application drill-app is still terminating; retry in a minute"
fi
if $K -n flux-system get kustomization drill-app >/dev/null 2>&1; then
  # Never delete a suspended Kustomization: its prune finalizer only runs on
  # reconcile, so the delete would hang until someone resumes it.
  $K -n flux-system patch kustomization drill-app --type merge -p '{"spec":{"suspend":false}}' >/dev/null 2>&1 || true
  $K -n flux-system delete kustomization drill-app --timeout=120s >/dev/null 2>&1 \
    || die "the previous drill's Flux Kustomization drill-app is still terminating; retry in a minute"
fi
$K -n "$NS" delete rollout drill-web --ignore-not-found >/dev/null 2>&1 || true
$K -n "$NS" delete analysistemplate drill-analysis --ignore-not-found >/dev/null 2>&1 || true
if $K get ns "$CI_NS" >/dev/null 2>&1; then
  $K -n "$CI_NS" delete pipelinerun --all --ignore-not-found >/dev/null 2>&1 || true
  $K -n "$CI_NS" delete eventlistener,triggertemplate,triggerbinding --all --ignore-not-found >/dev/null 2>&1 || true
  $K -n "$CI_NS" delete pipeline drill-build --ignore-not-found >/dev/null 2>&1 || true
  $K -n "$CI_NS" delete task drill-lint --ignore-not-found >/dev/null 2>&1 || true
  $K -n "$CI_NS" delete rolebinding drill-trigger-el --ignore-not-found >/dev/null 2>&1 || true
  $K -n "$CI_NS" delete sa drill-trigger-sa --ignore-not-found >/dev/null 2>&1 || true
fi
$K delete clusterrolebinding drill-trigger-el --ignore-not-found >/dev/null 2>&1 || true
if $K -n default get appenvironment drill-env >/dev/null 2>&1; then
  $K -n default delete appenvironment drill-env --timeout=90s >/dev/null 2>&1 \
    || die "the previous drill's AppEnvironment drill-env is still terminating; retry in a minute"
fi
if $K -n default get appenvironment team-c-dev >/dev/null 2>&1; then
  # Undo the xr-paused scenario's quota bump so the seeded XR matches git again.
  $K -n default patch appenvironment team-c-dev --type merge -p '{"spec":{"cpuQuota":"4"}}' >/dev/null 2>&1 || true
fi

# ── baseline workload ────────────────────────────────────────────────────
# Create the baseline in ONE apply with a compliant securityContext already set.
# Doing it as create -> set resources -> patch emits a PodSecurity warning on every
# intermediate step (team-a warns at 'restricted'), and three walls of warnings hide
# the fault you are meant to find. Only the faults whose victim is this deployment
# create it; for the platform faults it would just be noise.
baseline_workload() {
  $K -n "$NS" apply -f - >/dev/null <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: broken
  labels: { app: broken }
spec:
  replicas: 1
  selector: { matchLabels: { app: broken } }
  template:
    metadata:
      labels: { app: broken }
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: nginx-unprivileged
          image: ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine
          ports: [{ containerPort: 8080 }]
          resources:
            requests: { cpu: 25m, memory: 32Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
YAML
  $K -n "$NS" rollout status deploy/broken --timeout=120s >/dev/null 2>&1 || true
}

# ── shared scenario pieces ───────────────────────────────────────────────
# The two GitOps faults deploy into their own namespace. The curriculum's
# ApplicationSet exercise (examples/argocd-appset.yaml) owns the demo-app
# overlays in team-a/team-b, and a self-healing app would silently resurrect
# whatever this drill deletes.
gitops_ns() { $K create ns "$GITOPS_NS" --dry-run=client -o yaml | $K apply -f - >/dev/null; }

tekton_pipeline() {
  $K apply -f - >/dev/null <<YAML
apiVersion: tekton.dev/v1
kind: Pipeline
metadata: { name: drill-build, namespace: $CI_NS }
spec:
  tasks:
    - name: lint
      taskRef: { name: drill-lint }
YAML
}

tekton_task() {
  $K apply -f - >/dev/null <<YAML
apiVersion: tekton.dev/v1
kind: Task
metadata: { name: drill-lint, namespace: $CI_NS }
spec:
  steps:
    - name: lint
      image: ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine
      command: [sh, -c, 'echo lint ok']
YAML
}

# predicates for poll()
argo_healthy()   { [ "$($K -n argocd get application drill-app -o jsonpath='{.status.health.status}{.status.sync.status}' 2>/dev/null)" = "HealthySynced" ]; }
argo_broken()    { $K -n argocd get application drill-app -o jsonpath='{.status.conditions[*].type}' 2>/dev/null | grep -q ComparisonError; }
flux_ready()     { [ "$($K -n flux-system get kustomization drill-app -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; }
rollout_healthy(){ [ "$($K -n "$NS" get rollout drill-web -o jsonpath='{.status.phase}' 2>/dev/null)" = "Healthy" ]; }
rollout_degraded(){ [ "$($K -n "$NS" get rollout drill-web -o jsonpath='{.status.phase}' 2>/dev/null)" = "Degraded" ]; }
run_failed()     { [ "$($K -n "$CI_NS" get pipelinerun drill-run -o jsonpath='{.status.conditions[?(@.type=="Succeeded")].status}' 2>/dev/null)" = "False" ]; }
el_ready()       { [ "$($K -n "$CI_NS" get eventlistener drill-listener -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]; }
el_broken()      { [ "$($K -n "$CI_NS" get eventlistener drill-listener -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "False" ]; }
xr_stuck()       { $K -n default get objects.kubernetes.m.crossplane.io -l crossplane.io/composite=drill-env -o jsonpath='{.items[*].status.conditions[?(@.type=="Synced")].status}' 2>/dev/null | grep -q False; }
xr_paused()      { [ "$($K -n default get appenvironment team-c-dev -o jsonpath='{.status.conditions[?(@.type=="Synced")].reason}' 2>/dev/null)" = "ReconcilePaused" ]; }
# Match the policy's own message, not just "pod creation fails": a lab where
# the learner left PSS on restricted would otherwise satisfy this instantly.
deny_active()    { { $K -n "$NS" run drill-policy-check --image=ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine --dry-run=server 2>&1 || true; } | grep -q drill-deny; }
replica_failure(){ [ "$($K -n "$NS" get deploy broken -o jsonpath='{.status.conditions[?(@.type=="ReplicaFailure")].status}' 2>/dev/null)" = "True" ]; }

# ── inject ───────────────────────────────────────────────────────────────
TICKET=""; HINTS=""; ANSWER=""

case "$F" in
  image)
    baseline_workload
    $K -n "$NS" set image deploy/broken nginx-unprivileged=ghcr.io/nginxinc/nginx-unprivileged:does-not-exist >/dev/null
    ANSWER="deploy/broken was pointed at image tag 'does-not-exist'. Pods sit in ErrImagePull/ImagePullBackOff. Fix: set the image back to a tag that exists." ;;
  probe)
    baseline_workload
    $K -n "$NS" patch deploy broken --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe","value":{"httpGet":{"path":"/healthz","port":9999},"initialDelaySeconds":1}}]' >/dev/null
    ANSWER="a readinessProbe was added against port 9999; the container listens on 8080. Pods run but never become Ready. Fix: correct or remove the probe." ;;
  resources)
    baseline_workload
    $K -n "$NS" set resources deploy/broken --requests=cpu=8,memory=32Gi >/dev/null
    ANSWER="requests were raised to cpu=8/memory=32Gi, more than any node has. Pods stay Pending with FailedScheduling. Fix: set requests something a node can satisfy." ;;
  rbac)
    baseline_workload
    $K -n "$NS" create sa app-sa >/dev/null 2>&1 || true
    $K -n "$NS" patch deploy broken -p '{"spec":{"template":{"spec":{"serviceAccountName":"app-sa"}}}}' >/dev/null
    $K -n "$NS" set env deploy/broken NEEDS_API=true >/dev/null
    ANSWER="the pod was switched to sa/app-sa, which has no RBAC at all. Nothing in pod status shows it; only 'kubectl auth can-i --as=system:serviceaccount:team-a:app-sa' does. Fix: bind a Role with the needed verbs." ;;
  quota)
    baseline_workload
    $K -n "$NS" patch resourcequota team-a-quota --type=merge -p '{"spec":{"hard":{"pods":"1"}}}' >/dev/null
    $K -n "$NS" scale deploy/broken --replicas=5 >/dev/null
    ANSWER="the namespace ResourceQuota was clamped to pods=1 while replicas went to 5. The 'exceeded quota' error is on the ReplicaSet, not the pods. Fix: raise the quota or drop the replicas." ;;
  netpol)
    baseline_workload
    # NetworkPolicies are ADDITIVE allow-lists. Adding a narrower policy
    # cannot revoke an allowance granted by another one, so the old version
    # of this fault (adding an egress-to-pods-only policy) did nothing at
    # all: allow-dns-and-same-namespace still permitted DNS. To actually
    # break name resolution you have to remove the DNS rule itself.
    $K -n "$NS" patch networkpolicy allow-dns-and-same-namespace \
      --type=json -p='[{"op":"remove","path":"/spec/egress/1"}]' >/dev/null
    ANSWER="the DNS egress rule was stripped from NetworkPolicy allow-dns-and-same-namespace. With default-deny in place the pod runs but resolves nothing; only an in-pod nslookup shows it. Fix: restore the rule (re-apply examples/multitenancy/team-a.yaml)." ;;
  config)
    baseline_workload
    $K -n "$NS" patch deploy broken --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/volumeMounts","value":[{"name":"cfg","mountPath":"/etc/app"}]},{"op":"add","path":"/spec/template/spec/volumes","value":[{"name":"cfg","configMap":{"name":"missing-config"}}]}]' >/dev/null
    ANSWER="a volume referencing ConfigMap 'missing-config' (which does not exist) was mounted. Pods stick in ContainerCreating and the reason only shows in describe events. Fix: create the ConfigMap or drop the volume." ;;

  argocd-rev)
    $K get ns argocd >/dev/null 2>&1 || die "Argo CD is not installed (make gitops)"
    log "Setting the scene: a healthy Argo CD application (takes a minute)"
    $K apply -f - >/dev/null <<YAML
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: drill-app
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: $REPO_URL
    targetRevision: main
    path: demo-app/overlays/staging
    kustomize:
      namespace: $GITOPS_NS
  destination: { server: https://kubernetes.default.svc, namespace: $GITOPS_NS }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [CreateNamespace=true]
YAML
    poll 180 "drill-app to become Healthy+Synced" argo_healthy || true
    $K -n argocd patch application drill-app --type merge -p '{"spec":{"source":{"targetRevision":"release-2.4"}}}' >/dev/null
    # Without a forced refresh the app controller may not compare again for
    # minutes, and the ticket would print before the symptom exists.
    $K -n argocd annotate application drill-app argocd.argoproj.io/refresh=normal --overwrite >/dev/null
    poll 120 "the symptom to surface" argo_broken || true
    TICKET="app team: our staging app in the $GITOPS_NS namespace is frozen. We merged to main twice this morning and nothing rolled out. Argo CD owns it."
    HINTS="kubectl -n argocd get applications
       kubectl -n argocd describe application drill-app     # conditions are near the bottom
       argocd app get drill-app                             # or the web UI"
    ANSWER="Application drill-app spec.source.targetRevision was changed to 'release-2.4', a git ref that does not exist. The compare fails (ComparisonError condition), so nothing syncs. Fix: patch targetRevision back to main and refresh." ;;

  flux-suspend)
    $K -n flux-system get gitrepository platform >/dev/null 2>&1 || die "Flux is not wired to gitea (make gitops)"
    gitops_ns
    log "Setting the scene: a healthy Flux Kustomization (takes a minute)"
    $K apply -f - >/dev/null <<YAML
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata: { name: drill-app, namespace: flux-system }
spec:
  interval: 1m
  prune: true
  wait: true
  timeout: 2m
  sourceRef: { kind: GitRepository, name: platform }
  path: ./demo-app/overlays/prod
  targetNamespace: $GITOPS_NS
YAML
    poll 240 "Kustomization drill-app to become Ready" flux_ready || true
    $K -n flux-system patch kustomization drill-app --type merge -p '{"spec":{"suspend":true}}' >/dev/null
    $K -n "$GITOPS_NS" delete deploy prod-demo --ignore-not-found >/dev/null 2>&1 || true
    TICKET="app team: someone fat-fingered a kubectl delete on our prod deployment in the $GITOPS_NS namespace. Flux is supposed to put it back. Twenty minutes later there is still nothing running."
    HINTS="kubectl -n $GITOPS_NS get deploy,pods
       flux get kustomizations
       kubectl -n flux-system get kustomization drill-app -o yaml"
    ANSWER="Kustomization drill-app was suspended (spec.suspend: true), then the deployment it manages was deleted. A suspended Kustomization is skipped entirely, so drift is never corrected. Fix: flux resume kustomization drill-app (or patch suspend back to false)." ;;

  canary-analysis)
    $K get crd rollouts.argoproj.io >/dev/null 2>&1 || die "Argo Rollouts is not installed (make gitops)"
    log "Setting the scene: a healthy canary rollout with a metric gate (takes a minute)"
    $K apply -f - >/dev/null <<YAML
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: drill-analysis, namespace: $NS }
spec:
  metrics:
    - name: canary-gate
      interval: 15s
      count: 2
      # vector(1) always returns 1 when Prometheus is reachable, so the gate
      # passes on a healthy lab and the only way to fail it is what this
      # scenario does to it.
      successCondition: len(result) == 1 && result[0] >= 1
      failureLimit: 0
      consecutiveErrorLimit: 1
      provider:
        prometheus:
          address: $PROM_GOOD
          query: vector(1)
---
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: drill-web, namespace: $NS }
spec:
  replicas: 2
  selector: { matchLabels: { app: drill-web } }
  template:
    metadata:
      labels: { app: drill-web }
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: web
          image: ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine
          ports: [{ containerPort: 8080 }]
          resources:
            requests: { cpu: 25m, memory: 32Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
  strategy:
    canary:
      steps:
        - setWeight: 50
        - analysis:
            templates: [{ templateName: drill-analysis }]
        - setWeight: 100
YAML
    poll 180 "rollout drill-web to become Healthy" rollout_healthy || true
    $K -n "$NS" patch analysistemplate drill-analysis --type=json \
      -p='[{"op":"replace","path":"/spec/metrics/0/provider/prometheus/address","value":"http://prometheus.monitoring.svc:9090"}]' >/dev/null
    # Any template change starts a new canary; the analysis step then runs
    # against the broken address and aborts the rollout.
    $K -n "$NS" patch rollout drill-web --type=json \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/env","value":[{"name":"DRILL_REVISION","value":"2"}]}]' >/dev/null
    poll 240 "the canary to degrade" rollout_degraded || true
    TICKET="team-a: we shipped a config change to drill-web and the canary never finished. The rollout shows Degraded and nobody knows why; the same pipeline was green last week."
    HINTS="kubectl argo rollouts get rollout drill-web -n $NS
       kubectl -n $NS get analysisruns
       kubectl -n $NS describe analysisrun \$(kubectl -n $NS get analysisruns -o name | tail -1 | cut -d/ -f2)"
    ANSWER="AnalysisTemplate drill-analysis was pointed at http://prometheus.monitoring.svc:9090, a service that does not exist (the real one is $PROM_GOOD). Every metric query errors, the AnalysisRun fails, and the rollout aborts. Fix: correct the address, then retry the rollout (kubectl argo rollouts retry rollout drill-web -n $NS)." ;;

  tekton-task)
    $K get crd pipelines.tekton.dev >/dev/null 2>&1 || die "Tekton is not installed (make cicd)"
    $K create ns "$CI_NS" --dry-run=client -o yaml | $K apply -f - >/dev/null
    tekton_pipeline
    # No drill-lint Task on purpose: that is the fault.
    $K apply -f - >/dev/null <<YAML
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata: { name: drill-run, namespace: $CI_NS }
spec:
  pipelineRef: { name: drill-build }
YAML
    poll 90 "the PipelineRun to fail" run_failed || true
    TICKET="CI channel: every run of the drill-build pipeline in the drill-ci namespace dies instantly. It was green yesterday and nobody changed the pipeline."
    HINTS="tkn -n $CI_NS pipelinerun list        # or: kubectl -n $CI_NS get pipelineruns
       kubectl -n $CI_NS describe pipelinerun drill-run
       kubectl -n $CI_NS get pipeline drill-build -o yaml"
    ANSWER="Pipeline drill-build references Task drill-lint, which does not exist in the namespace. The PipelineRun fails immediately with reason CouldntGetTask. Fix: create the drill-lint Task, then start a fresh PipelineRun (completed runs are immutable)." ;;

  tekton-trigger)
    $K get crd eventlisteners.triggers.tekton.dev >/dev/null 2>&1 || die "Tekton Triggers is not installed (make cicd)"
    $K create ns "$CI_NS" --dry-run=client -o yaml | $K apply -f - >/dev/null
    tekton_task
    tekton_pipeline
    log "Setting the scene: a healthy EventListener (takes a minute)"
    $K apply -f - >/dev/null <<YAML
apiVersion: v1
kind: ServiceAccount
metadata: { name: drill-trigger-sa, namespace: $CI_NS }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: drill-trigger-el, namespace: $CI_NS }
subjects: [{ kind: ServiceAccount, name: drill-trigger-sa, namespace: $CI_NS }]
roleRef: { kind: ClusterRole, name: tekton-triggers-eventlistener-roles, apiGroup: rbac.authorization.k8s.io }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: drill-trigger-el }
subjects: [{ kind: ServiceAccount, name: drill-trigger-sa, namespace: $CI_NS }]
roleRef: { kind: ClusterRole, name: tekton-triggers-eventlistener-clusterroles, apiGroup: rbac.authorization.k8s.io }
---
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata: { name: drill-binding, namespace: $CI_NS }
spec:
  params: [{ name: git-revision, value: \$(body.after) }]
---
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata: { name: drill-template, namespace: $CI_NS }
spec:
  params: [{ name: git-revision, default: main }]
  resourcetemplates:
    - apiVersion: tekton.dev/v1
      kind: PipelineRun
      metadata: { generateName: drill-triggered- }
      spec:
        pipelineRef: { name: drill-build }
---
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata: { name: drill-listener, namespace: $CI_NS }
spec:
  serviceAccountName: drill-trigger-sa
  triggers:
    - name: on-push
      bindings: [{ ref: drill-binding }]
      template: { ref: drill-template }
YAML
    poll 180 "EventListener drill-listener to become Ready" el_ready || true
    $K -n "$CI_NS" delete rolebinding drill-trigger-el >/dev/null
    # The running pod keeps its informer caches; only a fresh pod hits the
    # missing RBAC, which is exactly how this bites in real clusters.
    $K -n "$CI_NS" delete pod -l eventlistener=drill-listener >/dev/null 2>&1 || true
    poll 180 "the listener to go unready" el_broken || true
    TICKET="platform channel: Gitea webhooks into drill-ci stopped landing and the event listener pod keeps restarting. It ran fine for weeks."
    HINTS="kubectl -n $CI_NS get eventlisteners,pods
       kubectl -n $CI_NS logs deploy/el-drill-listener --tail=20
       kubectl -n $CI_NS get sa,rolebindings"
    ANSWER="the RoleBinding drill-trigger-el (sa drill-trigger-sa -> ClusterRole tekton-triggers-eventlistener-roles) was deleted. The listener pod can no longer list/watch Triggers resources, fails its listers with 'forbidden', and crashloops. Fix: recreate the RoleBinding and delete the pod to skip the backoff." ;;

  xp-provider-rbac)
    XP_SA=$($K -n crossplane-system get sa -o name 2>/dev/null | grep provider-kubernetes | sed 's|.*/||' | head -1 || true)
    [ -n "$XP_SA" ] || die "crossplane provider-kubernetes is not installed (make api)"
    $K delete clusterrolebinding "crossplane-$XP_SA" --ignore-not-found >/dev/null
    $K apply -f - >/dev/null <<'YAML'
apiVersion: platform.lab.local/v1alpha1
kind: AppEnvironment
metadata: { name: drill-env, namespace: default }
spec:
  team: team-drill
  cpuQuota: "1"
  memoryQuota: 1Gi
YAML
    poll 120 "the composed resources to report the failure" xr_stuck || true
    TICKET="developer: I requested a new AppEnvironment called drill-env twenty minutes ago. The team-drill namespace it should create never appeared, and the platform portal just says 'not ready'."
    HINTS="kubectl -n default get appenvironment
       kubectl -n default describe appenvironment drill-env
       kubectl -n default get objects.kubernetes.m.crossplane.io   # the composed resources
       crossplane beta trace appenvironment drill-env -n default"
    ANSWER="the ClusterRoleBinding that gives provider-kubernetes its in-cluster permissions (crossplane-$XP_SA) was deleted. Every composed Object now fails with 'forbidden' in its Synced condition, so the XR never becomes Ready. Fix: recreate the binding (cluster-admin for the provider's service account, as scripts/40-platform-api.sh does)." ;;

  xr-paused)
    $K -n default get appenvironment team-c-dev >/dev/null 2>&1 || die "seeded XR team-c-dev not found (make api)"
    $K -n default annotate appenvironment team-c-dev crossplane.io/paused=true --overwrite >/dev/null
    $K -n default patch appenvironment team-c-dev --type merge -p '{"spec":{"cpuQuota":"6"}}' >/dev/null
    poll 60 "the XR to report ReconcilePaused" xr_paused || true
    TICKET="team-c: we asked for a cpu quota bump on our AppEnvironment yesterday. The edit is visible on the XR but the actual ResourceQuota in our namespace never changed."
    HINTS="kubectl -n default describe appenvironment team-c-dev   # conditions AND annotations
       kubectl -n team-c get resourcequota tenant-quota -o yaml
       kubectl -n default get appenvironment team-c-dev -o jsonpath='{.spec.cpuQuota}'"
    ANSWER="the XR team-c-dev carries the crossplane.io/paused=true annotation, so Crossplane skips reconciliation entirely (Synced=False, reason ReconcilePaused) and the cpuQuota change never reaches the ResourceQuota. Fix: remove the annotation." ;;

  kyverno-deny)
    $K get crd validatingpolicies.policies.kyverno.io >/dev/null 2>&1 || die "Kyverno is not installed (make sec)"
    baseline_workload
    $K apply -f - >/dev/null <<'YAML'
apiVersion: policies.kyverno.io/v1
kind: ValidatingPolicy
metadata:
  name: drill-deny
spec:
  validationActions: [Deny]
  matchConstraints:
    namespaceSelector:
      matchLabels: { tenant: team-a }
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
  validations:
    - expression: "has(object.metadata.labels) && 'billing-code' in object.metadata.labels"
      message: "every pod needs a billing-code label (policy drill-deny)"
YAML
    poll 60 "the policy webhook to become active" deny_active || true
    $K -n "$NS" rollout restart deploy/broken >/dev/null
    poll 90 "the deployment to report ReplicaFailure" replica_failure || true
    TICKET="team-a: nothing deploys any more. Every new pod in our namespace is rejected with some policy error, and nobody on OUR team shipped a policy today."
    HINTS="kubectl -n $NS get deploy,rs   # then describe the newest ReplicaSet
       kubectl -n $NS get events --sort-by=.lastTimestamp | tail -10
       kubectl get validatingpolicies"
    ANSWER="a cluster-wide Kyverno ValidatingPolicy named drill-deny (Deny action, scoped to the team-a namespace) requires a billing-code label on every pod. The admission webhook rejects the ReplicaSet's pods, so the deployment reports ReplicaFailure while the old pod keeps running. Fix: delete the policy (or add the label the policy demands)." ;;

  pss-restricted)
    baseline_workload
    $K label ns "$NS" pod-security.kubernetes.io/enforce=restricted --overwrite >/dev/null
    $K -n "$NS" patch deploy broken --type=json \
      -p='[{"op":"remove","path":"/spec/template/spec/securityContext"},{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]' >/dev/null
    poll 90 "the deployment to report ReplicaFailure" replica_failure || true
    TICKET="team-a: after this morning's 'security hardening' change our app cannot start new pods. The old pod is still running; replacements never come up."
    HINTS="kubectl -n $NS get deploy,rs   # then describe the newest ReplicaSet
       kubectl -n $NS get events --sort-by=.lastTimestamp | tail -10
       kubectl get ns $NS --show-labels"
    ANSWER="the namespace was flipped to pod-security.kubernetes.io/enforce=restricted while the pod's securityContext was stripped at the same time. The PodSecurity admission controller rejects every new pod ('violates PodSecurity restricted:latest'). Fix: restore a restricted-compliant securityContext (runAsNonRoot, seccompProfile, allowPrivilegeEscalation=false, drop ALL); break-fix also puts the enforce label back to baseline." ;;
esac

# Workload faults share one ticket and the classic triage sequence.
if [ "$D" = workload ]; then
  TICKET="team-a: our 'broken' deployment is not healthy and we cannot see why. It worked an hour ago."
  HINTS="kubectl -n $NS get pods
       kubectl -n $NS describe pod <pod>
       kubectl -n $NS get events --sort-by=.lastTimestamp | tail -20
       kubectl -n $NS logs <pod> --previous"
fi

# The classic workload drill keeps its 7-minute clock (the curriculum's exam
# pace maths). The platform faults span more moving parts, so they get 10.
TARGET=10; [ "$D" = workload ] && TARGET=7
cat <<TXT

  ⏱  Fault injected. Domain: $D. Target: under $TARGET minutes (exam pace).

     Ticket: "$TICKET"

     Start here:
       $HINTS

     Reveal the answer when you're done:  make break-answer
     Auto-repair and see the evidence:    make break-fix
TXT
{
  echo "$F  (domain: $D)"
  echo
  echo "$ANSWER"
} > /tmp/cnpe-lab/.last-fault
