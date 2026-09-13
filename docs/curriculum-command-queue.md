# Curriculum command queue

**This queue is finished.** It is kept as the record of what was added and why, and as the
procedure to follow if more exercises are ever queued the same way.

The September 2026 curriculum expansion added theory panels to every section but no command
blocks, because every block on the site was executed against the lab and its output captured, and
none of these had been. This file was the queue of 178 commands and exercises the research
found worth adding, grouped by section, each with the outcome the captured output should show.
It was worked in two passes: insert each item as an exercise with a **placeholder** output drawer,
then run it against the lab and replace the placeholder with the real output.

**Outcome: 170 exercises landed, 8 were dropped.** Every drawer on the site now holds real output;
none are pending. The output for these 170 was captured on 2026-09-12 against Kubernetes 1.36.1,
before the lab's `K8S_IMAGE` pin moved to 1.37.0. The eight dropped items are struck through in
the list below, each with its reason. Four were dropped because they restart the API server and
crashloop every controller in the cluster for minutes (encryption at rest, the PodSecurity
`AdmissionConfiguration`, the audit policy, and the VAP audit annotation that depended on it).
Four more were dropped on the evidence of running them: OLM v1, the Grafana Operator dashboard,
Falco, and the sigstore policy-controller.

## How an item is inserted

Append the exercise at the end of the section's `#exercises` panel (`<section class="panel accent-g"
id="exercises">`), before that panel's closing `</div>` and `</section>`. Use exactly this shape:

```html
    <div class="exercise" data-title="Short imperative title">
      <p>One or two sentences: what this proves and why the exam cares.</p>
      <div class="cb" data-lang="bash"><pre><code>kubectl get crd tenantbuckets.platform.lab.local -o jsonpath='{.status.conditions[*].type}'</code></pre><details class="out pending"><summary>output<span class="when">not yet captured</span></summary><pre><code><b>$ kubectl get crd tenantbuckets.platform.lab.local -o jsonpath='{.status.conditions[*].type}'</b>
<i>placeholder: run this against the lab and paste the real output here</i></code></pre></details></div>
      <div class="verify"><b>verify:</b> what the output must show for the exercise to count (the "expected" half of the queue item).</div>
    </div>
```

Rules the site's checks enforce or the maintainer expects:

- The command block is `div.cb[data-lang=bash]` holding `pre > code`. Several commands go on
  separate lines in one block; a manifest goes inline as `kubectl apply -f - <<'EOF' ... EOF` so the
  block is self-contained. Escape `<`, `>` and `&` as `&lt;`, `&gt;`, `&amp;` inside `code`.
- The drawer is `details.out.pending` with the summary text `output` and `<span class="when">not yet
  captured</span>`. Its body opens with the command echoed on a `<b>$ ...</b>` line (a continuation
  line of a multi-line command is `<b>  ... \</b>`), then one `<i>placeholder: ...</i>` line. The
  stylesheet paints a pending drawer with a red "placeholder" tag, so a reader is never misled.
- `data-title` is unique within the page; it becomes the exercise's progress key and its entry in
  the exercise index.
- Plain ASCII punctuation: no em dashes, no curly quotes. `python3 curriculum/tools/subset-fonts.py
  --check` fails on any character the shipped fonts do not carry.
- Do not edit any existing command block or drawer. New exercises go after the existing ones.
- Items that need a tool the lab does not install (HNC, Tekton Chains, Falco, OLM v1, the Sigstore
  policy-controller, the Grafana Operator, blackbox-exporter) either install it in the first lines of
  the block or are left out; say which in the exercise text.
- Keep the voice of the existing pages: dry, specific, second person. No quotes or anecdotes from
  exam takers.

## How a placeholder becomes real output

1. Bring up the layers the section needs (`make help` lists them; the section page's *needs* tile names them).
2. Run the block's commands exactly as written, on the cluster context they name (`kind-cnpe` is the
   main cluster, `kind-mesh` the Istio cluster; `scripts/lib.sh` has `kctx`).
3. Paste the output verbatim into the drawer body under the `<b>$ ...</b>` echo line, escaping
   `<`, `>` and `&`. Long repetitive output may be elided with an `<i>... N more lines</i>` line.
4. Change the drawer's class from `out pending` to `out` and the span to `captured YYYY-MM-DD`.
5. If the output disagrees with the queue's expected outcome, fix the exercise text or the `verify`
   line to say what the lab actually prints; the theory panel above it may need the same correction.
6. Note the cluster version the capture was taken on. Everything dated 2026-09-12 ran on Kubernetes
   1.36.1; the lab's `K8S_IMAGE` pin moved to 1.37.0 afterwards.

Then, from the repo root: `python3 curriculum/tools/extract-drill.py --check`,
`python3 curriculum/tools/subset-fonts.py --check`, `make site`, `make browser` (needs
`npm ci` and Playwright's Chromium), `make typecheck`. `grep -rl 'out pending' curriculum/0*/` lists
the drawers still waiting.

## Names the lab uses

| Thing | Name |
|---|---|
| clusters (kubectl contexts) | `kind-cnpe` (main), `kind-mesh` (Istio ambient, Flagger) |
| tenants | namespaces `team-a` (default-deny NetworkPolicy, quota `team-a-quota`, LimitRange `team-a-limits`, PSS labels, user `dev-a`) and `team-b`; `team-c` is created by the Crossplane XR `appenvironment/team-c-dev` in `default` |
| git | Gitea at `gitea.lab` (host: `localhost:3001`; in-cluster: `gitea.lab:3000`), user `lab`, org `services`; the demo app repo holds `demo-app/base` plus `overlays/staging` and `overlays/prod` |
| registry | `kind-registry:5000` from inside the cluster, `localhost:5001` from the host |
| GitOps | Argo CD in `argocd` (Applications from `examples/argocd-appset.yaml`, e.g. `demo-staging`; `make break` uses `drill-app`); Flux in `flux-system` with GitRepository `platform` and Kustomization `demo-flux` into `flux-demo` |
| CI | Tekton in `tekton-pipelines`; the pipeline and tasks in `examples/tekton/pipeline.yaml` |
| platform APIs | Crossplane in `crossplane-system` (`examples/crossplane/`), kro, CloudNativePG in `cnpg-system` (a `Cluster` in `team-a`), Argo Workflows in `argo` |
| observability | kube-prometheus-stack, Loki and Alloy in `monitoring`; OpenTelemetry Collector and Jaeger in `tracing`; OpenCost in `opencost` |
| security | Kyverno in `kyverno`, Gatekeeper in `gatekeeper-system`, Sealed Secrets and External Secrets from `make sec`, SPIRE in `spire`; the `hardened` namespace (enforce restricted) is created by section 5.3's own exercise, not by a layer script |

Read the layer script under `scripts/` for anything not listed; names there are authoritative.

## The queue

Every unchecked box below landed and its drawer holds real lab output; the eight struck-through
entries are the ones that did not. The boxes are left unticked because the list is a record now,
not a worklist. (A tracker page with a checkbox per item was published alongside the work; it
lives outside this repository.)

### Domain 1: Platform architecture and infrastructure (lab layers: make up (+sec, obs))

#### 1.1 Platform networking

- [ ] `kubectl explain gateway.spec.listeners.allowedRoutes --recursive` and `kubectl explain httproute.spec.rules.backendRefs`: show the standard-channel field shapes (namespaces.from Same/All/Selector, backendRefs weight) are available offline on the lab CRDs. Expect the field list with descriptions.
- [ ] `kubectl apply` a ReferenceGrant in team-b plus an HTTPRoute in team-a whose backendRef names a team-b Service, then `kubectl get httproute -n team-a demo -o jsonpath='{.status.parents[*].conditions}'`: on kind-mesh (Istio) expect `ResolvedRefs: False / RefNotPermitted` before the grant and `True` after. On the main cluster there is no controller so status stays empty; capture on kind-mesh.
- [ ] `kubectl -n kube-system get cm coredns -o yaml`: capture the stock Corefile so the panel's table can point at real lines. Then add a `consul.local:53 { forward . 10.150.0.1 }` stub block, wait ~2 min, and `kubectl -n kube-system logs deploy/coredns | tail` to show the reload line (or a parse error if deliberately malformed).
- [ ] `kubectl run hn --image=busybox:1.28 --restart=Never --overrides='{"spec":{"hostNetwork":true}}' -- nslookup kubernetes.default` versus the same with `"dnsPolicy":"ClusterFirstWithHostNet"`: expect the first to fail (node resolver) and the second to succeed. Demonstrates the hostNetwork DNS trap.
- [ ] `cilium status | grep -i kubeproxy`: expect `KubeProxyReplacement: True` (or the lab's mode) to anchor the datapath table.
- [ ] `kubectl get svc kubernetes -o jsonpath='{.spec.trafficDistribution}'` after `kubectl patch svc demo -p '{"spec":{"trafficDistribution":"PreferSameZone"}}'` on a two-zone Service; then `kubectl get endpointslices -l kubernetes.io/service-name=demo -o yaml | grep -A2 hints`: expect zone hints to appear.

#### 1.2 Compute: requests, limits, QoS, scheduling, autoscaling

- [ ] `kubectl patch pod <name> --subresource resize --patch '{"spec":{"containers":[{"name":"c","resources":{"requests":{"cpu":"200m"},"limits":{"cpu":"400m"}}}]}}'` on a Burstable pod, then `kubectl get pod <name> -o jsonpath='{.status.conditions}' | jq` and `...allocatedResources`: expect no PodResizePending, allocatedResources updated, restartCount 0 (CPU NotRequired). Then request an impossible CPU (e.g. 64) and show `PodResizePending / Infeasible`.
- [ ] Same patch on a Guaranteed pod changing only requests: expect a validation error naming the QoS class.
- [ ] `kubectl get pdb -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,ALLOWED:.status.disruptionsAllowed`, then create a PDB `minAvailable: 100%` over a crash-looping Deployment and `kubectl drain <node> --ignore-daemonsets --timeout=60s`: expect the drain to block; patch `unhealthyPodEvictionPolicy: AlwaysAllow` and rerun: expect it to proceed.
- [ ] `kubectl describe node <worker> | sed -n '/Capacity/,/Allocatable/p'` plus `kubectl get --raw /api/v1/nodes/<worker>/proxy/configz | jq '.kubeletconfig | {kubeReserved,systemReserved,evictionHard}'`: show the arithmetic behind allocatable on the kind node.
- [ ] `kubectl create priorityclass batch --value=1000 --preemption-policy=Never`, then schedule a batch pod on a full node: expect it to stay Pending (no preemption) while a default-policy class at the same value preempts.
- [ ] `kubectl get hpa demo -o jsonpath='{.spec.behavior}'` after `kubectl autoscale` to show the defaulted behavior block (scaleDown stabilizationWindowSeconds 300).

#### 1.3 Storage: volumes, claims, classes

- [ ] Create a StatefulSet with `persistentVolumeClaimRetentionPolicy: {whenScaled: Delete, whenDeleted: Retain}`, scale 3 -> 1, `kubectl get pvc`: expect the two higher-ordinal PVCs deleted (check ownerReferences on them first with `-o jsonpath='{.metadata.ownerReferences}'`). Delete the StatefulSet: expect the remaining PVC kept.
- [ ] `kubectl patch storageclass standard -p '{"allowVolumeExpansion":true}'` (local-path may still refuse); then edit a bound PVC to a larger size and read `kubectl get pvc x -o jsonpath='{.status.conditions}'`: capture either the API rejection text ("only dynamically provisioned pvc can be resized...") or the FileSystemResizePending condition. Local-path does not implement expansion; the message itself is the lesson.
- [ ] `kubectl apply` a Pod with a generic ephemeral volume (`volumes[].ephemeral.volumeClaimTemplate`), then `kubectl get pvc`: expect a PVC named `<pod>-<volume>` with an ownerReference to the pod; delete the pod and confirm the PVC goes.
- [ ] `kubectl get crd | grep snapshot.storage.k8s.io`: on kind expect none, which is the honest caveat for the snapshot table; if the maintainer installs the external-snapshotter CRDs and controller, a VolumeSnapshot against local-path should sit not-ready with an event naming the missing driver support.
- [ ] `kubectl get storageclass -o jsonpath='{.items[*].metadata.annotations.storageclass\.kubernetes\.io/is-default-class}'` and a PVC with no class created while no default exists, then re-add the default annotation: expect the PVC's storageClassName to be filled in retroactively.

#### 1.4 Multi-tenancy: isolation you can defend

- [ ] ResourceQuota with `scopeSelector` PriorityClass In [system-cluster-critical] and `pods: "0"` in team-a, then `kubectl -n team-a run p --image=busybox --overrides='{"spec":{"priorityClassName":"system-cluster-critical"}}'`: expect an "exceeded quota" rejection naming the scoped quota, while a pod without the class is admitted.
- [ ] `kubectl create quota objs -n team-a --hard=count/configmaps=2,count/tenantbuckets.platform.lab.local=1` then create three ConfigMaps: expect the third refused; demonstrates count/ for custom kinds too.
- [ ] If HNC is installed for a demo: `kubectl hns create dev -n team-a`, `kubectl hns tree team-a`, and `kubectl get rolebinding -n dev` to show propagated bindings with the `hnc.x-k8s.io/inherited-from` label.
- [ ] `kubectl get flowschema,prioritylevelconfiguration`: show APF objects exist by default so the panel's mention has something to point at.

#### 1.5 Cost: OpenCost and right-sizing

- [ ] `kubectl -n opencost port-forward deploy/opencost 9003 &` then `curl -sG localhost:9003/allocation -d window=1d -d aggregate=namespace -d includeIdle=true | jq '.data[0] | keys'` and `... | jq '.data[0]["__idle__"].totalCost'`: expect namespaces plus `__idle__`.
- [ ] `curl -sG localhost:9003/allocation -d window=1d -d aggregate=label:app | jq '.data[0] | keys'`: expect label values as keys, `__unallocated__` for pods without the label.
- [ ] `curl -sG localhost:9003/allocation -d window=1d -d aggregate=namespace -d shareIdle=true | jq '.data[0] | map_values(.totalCost)'` compared with shareIdle=false: expect the idle row gone and other totals higher.
- [ ] `kubectl -n opencost get deploy opencost -o jsonpath='{.spec.template.spec.containers[0].env}' | jq` to show PROMETHEUS_SERVER_ENDPOINT and CLOUD_PROVIDER/pricing settings; `kubectl -n opencost exec deploy/opencost -- cat /models/default.json` (path may differ) to show the on-prem price list in use.
- [ ] `kubectl get vpa demo -o jsonpath='{.status.recommendation.containerRecommendations[0]}' | jq` alongside `kubectl cost deployment --opencost --show-efficiency -n default`: pair the VPA target with the efficiency figure.

### Domain 2: GitOps and continuous delivery (lab layers: make core cicd (+mesh))

#### 2.1 GitOps fundamentals: desired state, drift, repo design

- [ ] `flux push artifact oci://localhost:5001/platform-config:$(git rev-parse --short HEAD) --path ./examples/demo-app/base --source $(git remote get-url origin) --revision main@sha1:$(git rev-parse HEAD)` then `flux create source oci demo-oci --url oci://kind-registry:5000/platform-config --tag <tag> --insecure` and a Kustomization on it: expect Ready with an artifact revision; shows OCI as a first-class source with the lab registry.
- [ ] `kubectl -n argocd get secret -l argocd.argoproj.io/secret-type=repository -o name` and `flux get sources all -A`: the two engines' registered sources side by side.
- [ ] `helm list -A` after Argo CD has deployed a Helm chart Application: expect no release listed (Argo renders and applies); after the Flux HelmRelease exercise: expect the release. Captures the "no Helm release object" difference.
- [ ] `kubectl -n argocd get cm argocd-cm -o jsonpath='{.data.application\.resourceTrackingMethod}'` and a managed Deployment's `metadata.annotations` filtered for `argocd.argoproj.io/tracking-id`: show annotation tracking is the 3.x default.

#### 2.2 Argo CD: applications, sync, drift

- [ ] `kubectl -n argocd get app demo-staging -o jsonpath='{.status.operationState.phase}{"\n"}{.status.operationState.syncResult.resources[*].status}'`: capture the operation phase and per-resource result codes after a normal sync and after an immutable-field failure (expect Failed / SyncFailed).
- [ ] Point demo-staging at a repo not in its AppProject (`argocd app set demo-staging --repo http://gitea.lab:3000/lab/other.git`) and read `kubectl -n argocd get app demo-staging -o jsonpath='{.status.conditions}'`: expect InvalidSpecError "application repo ... is not permitted in project". Restore.
- [ ] `argocd app delete demo-staging --cascade=false` then `kubectl -n team-a get deploy staging-demo`: expect the workload still running; re-apply the ApplicationSet to recreate the app. Confirms the finalizer semantics.
- [ ] Annotate `argocd.argoproj.io/refresh: hard` on an Application and watch the annotation disappear: shows refresh without the CLI.
- [ ] Add `Prune=confirm` to an app's syncOptions, remove a manifest from git, sync: expect the operation to stay Syncing with "Confirm Pruning" needed; `argocd app confirm-deletion` (or the deletion-approved annotation) completes it.
- [ ] `argocd account can-i sync applications 'default/demo-staging'` as a project-role JWT with and without the sync policy line: expect yes/no.
- [ ] `kubectl -n argocd patch cm argocd-notifications-cm --type merge -p '{"data":{"service.webhook.gitea":"url: http://gitea.lab:3000/...","trigger.on-sync-succeeded":"- send: [app-sync-succeeded]\n  when: app.status.operationState.phase in [\"Succeeded\"]"}}'` plus the subscribe annotation: capture one delivered notification in the notifications-controller log.

#### 2.3 Flux: sources, kustomizations, helm releases

- [ ] Create a HelmRelease with `install.remediation.retries: 2` and a bad value that makes the chart fail (e.g. an invalid image), then `kubectl -n flux-demo get hr x -o jsonpath='{.status.conditions}' | jq`: expect Ready False with reason InstallFailed, then after retries a `RetriesExceeded`/uninstall remediation; then `flux reconcile hr x --reset` after fixing values: expect Ready True InstallSucceeded.
- [ ] Set `driftDetection.mode: enabled` on the podinfo HelmRelease, `kubectl -n flux-demo scale deploy podinfo --replicas=5`, wait an interval: expect an event "Cluster state of release ... has drifted" and replicas back; `kubectl get hr podinfo -o jsonpath='{.status.conditions[?(@.type=="Drifted")]}'`.
- [ ] `kubectl -n flux-demo annotate deploy demo kustomize.toolkit.fluxcd.io/prune=disabled` (in the source manifests, then commit), remove it from git, reconcile: expect the Deployment to survive pruning with an event saying it was skipped.
- [ ] Create a Kustomization pointing at a non-existent path: expect Ready False reason `BuildFailed` (or ArtifactFailed if the source is broken); capture the exact message.
- [ ] Create a Receiver of type gitea with a token Secret; `kubectl -n flux-system get receiver -o jsonpath='{.items[0].status.webhookPath}'`; expose `webhook-receiver` as a LoadBalancer; configure the Gitea webhook; push; `flux events --for GitRepository/platform`: expect a reconcile triggered by the receiver within seconds.
- [ ] Image automation: `flux create image repository demo --image=kind-registry:5000/demo --interval=1m --insecure` (flag name may differ by version), `flux create image policy demo --image-ref=demo --select-semver='>=1.0.0'`, add a marker comment to the staging overlay, create an ImageUpdateAutomation with push branch main: push a `v1.0.1` tag with skopeo and expect a commit by fluxcdbot.

#### 2.4 Tekton: CI/CD as Kubernetes resources

- [ ] `kubectl api-resources | grep -i stepaction` then a StepAction plus a TaskRun referencing it with `ref.name`; add `image:` to the referencing step and apply: capture the validation error text.
- [ ] `kubectl create -f` a PipelineRun with `timeouts: {pipeline: 1m, tasks: 40s, finally: 20s}` over a Task that sleeps 90s: expect reason `PipelineRunTimeout` (or the tasks timeout message) in `.status.conditions[0]`.
- [ ] Start a run, then `kubectl patch pipelinerun <name> --type merge -p '{"spec":{"status":"CancelledRunFinally"}}'` with a finally task present: expect reason CancelledRunFinally and the finally TaskRun executed.
- [ ] A pipeline with a `when` that evaluates false: expect status True reason `Completed` and `status.skippedTasks` populated; capture with jsonpath.
- [ ] A Task writing a >4096 byte result: expect the "Termination message is above max allowed size 4096" failure.
- [ ] A `matrix.params` fan-out over three values: `tkn taskrun list` shows `<run>-<task>-0..2`.
- [ ] If Chains is installable (`kubectl apply -f https://storage.googleapis.com/tekton-releases/chains/latest/release.yaml` plus a cosign key in `signing-secrets`): after a TaskRun completes, `kubectl get taskrun <name> -o jsonpath='{.metadata.annotations.chains\.tekton\.dev/signed}'` expect "true"; `cosign verify --key cosign.pub localhost:5001/demo:v1` succeeds.

#### 2.5 Progressive delivery: canary, blue-green, and the mesh

- [ ] Rollout with an AnalysisTemplate whose metric has no successCondition/failureCondition: expect the AnalysisRun `Inconclusive` and the Rollout paused (not Degraded); `kubectl argo rollouts promote` resumes.
- [ ] Set `failureLimit: 0` (default) and a failing metric: expect abort after one measurement; then `failureLimit: 2`: expect abort after the third failed measurement. Capture `kubectl -n team-a get analysisrun -o jsonpath='{.items[0].status.metricResults[0]}'`.
- [ ] Blue-green with `autoPromotionSeconds: 30` and `previewReplicaCount: 1`: capture `kubectl get rs` showing the preview RS at 1 replica, then scaling to full on promotion after 30s.
- [ ] On kind-mesh: Rollout with `trafficRouting.istio.virtualService` and a `setHeaderRoute` step; `kubectl get virtualservice -o yaml` should show the managed header route; curl with the header reaches the canary at weight 0.
- [ ] Flagger Canary with `analysis.match` header regex and `iterations: 3`: `kubectl describe canary podinfo` events should show A/B iterations rather than weight steps; with `iterations` only and `provider: kubernetes` on the main cluster: a blue/green run that needs no mesh (capture the event sequence).
- [ ] `kubectl rollout status deploy/demo` against a Deployment with a bad image and `progressDeadlineSeconds: 60`: expect "deployment ... exceeded its progress deadline" and condition Progressing=False reason ProgressDeadlineExceeded.

#### 2.6 Troubleshooting delivery: drift, permissions, bad config

- [ ] Apply a Kyverno ClusterPolicy in Enforce mode requiring a label the demo-app lacks, sync demo-staging: capture the SyncFailed message quoting `admission webhook "validate.kyverno.svc-fail" denied the request`, and the equivalent Flux `ReconciliationFailed` on demo-flux.
- [ ] Scale the Kyverno admission controller to 0 while its webhook has failurePolicy Fail, then sync: capture `failed calling webhook ... no endpoints available`. Scale back.
- [ ] Create a ValidatingWebhookConfiguration with `sideEffects: Unknown` (or a stub) and reconcile a Flux Kustomization: capture `does not support dry run`.
- [ ] `kubectl -n argocd get app demo-staging -o jsonpath='{.status.conditions[*].type}'` in each staged failure from the existing exercises, to attach the condition type to each bucket.

### Domain 3: Platform APIs and self-service (lab layers: make core api (+portal))

#### 3.1 Platform APIs as products

- [ ] Nothing runnable; consider an exercise asking the reader to place each `make help` tool on the 13-row capability table and the five aspects of the maturity model.

#### 3.2 CRDs: extending the API server yourself

- [ ] Apply the TenantBucket CRD with `metadata.name: buckets.platform.lab.local` (wrong plural): capture the exact error `must be spec.names.plural+"."+spec.group`.
- [ ] Apply a version with two `storage: true`: capture `must have exactly one version marked as storage version`.
- [ ] Add a CEL rule `self.all(x, x.contains('a'))` over an unbounded string array: capture the `exceeded budget` error; add `maxItems`/`maxLength`: expect acceptance.
- [ ] Add a transition rule `self.tier == oldSelf.tier` and update tier on an existing object: capture the message; create a new object: expect no error (transition rules skip create).
- [ ] Tighten `pattern` on an existing field after objects exist, then `kubectl label tenantbucket good x=y`: expect success (ratcheting); then change the field itself: expect the pattern error.
- [ ] Add `selectableFields: [{jsonPath: .spec.tier}]` and run `kubectl get tb --field-selector spec.tier=silver`: expect filtered output; without the field, capture the "field label not supported" error.
- [ ] Add a `v1beta1` version, make it storage, then try to remove `v1alpha1` from spec.versions: capture the `storedVersions` refusal; run the no-op update loop and patch status.storedVersions, then remove.
- [ ] `kubectl get crd tenantbuckets.platform.lab.local -o jsonpath='{.status.conditions[*].type}'`: expect NamesAccepted, Established.

#### 3.3 Operators: reconciliation and how to read it

- [ ] `kubectl -n cnpg-system get lease` and `-o jsonpath='{.items[0].spec.holderIdentity}'`: show the CloudNativePG leader; scale the operator to 2 replicas and repeat: only one holder.
- [ ] `kubectl -n cnpg-system get clusterrole -o name | xargs -I{} kubectl get {} -o yaml | grep -A3 'postgresql.cnpg.io'`: show the CRD/status/finalizers RBAC shape on a real operator.
- [ ] Remove the operator ServiceAccount's permission on `pods` (edit the ClusterRole temporarily), delete pg-1, and read `kubectl -n cnpg-system logs deploy/cnpg-controller-manager | grep -i forbidden`: capture the Forbidden line and the stuck Cluster condition; restore.
- [ ] `kubectl get validatingwebhookconfiguration cnpg-validating-webhook-configuration -o jsonpath='{.webhooks[*].failurePolicy}'`, scale the operator to 0, then `kubectl apply` a Cluster edit: capture `failed calling webhook` blocking the write. Scale back.
- [ ] `kubectl get cluster pg -o jsonpath='{.status.conditions[*].type}'` and compare with `kubectl explain cluster.status.conditions`: show a real operator's condition types against the metav1.Condition shape.
- [x] ~~Install OLM v1 and watch it resolve~~: **dropped**. It never got as far as the conditions: the `argocd-operator` bundle owns `applicationsets.argoproj.io`, which Argo CD already installed, so the ClusterExtension fails on a CRD it is not allowed to adopt. Getting there also installs cert-manager and an `olmv1-system` namespace that the block does not remove, and no other exercise cleans up after it. The theory panel keeps the ClusterCatalog and ClusterExtension shapes.

#### 3.4 Argo Workflows: orchestration for self-service

- [ ] `argo submit --from workflowtemplate/provision-tenant -p team=team-g --watch` after promoting the lab Workflow to a WorkflowTemplate. Purpose: show the submit-from-template path and the live node tree. Expected: `Succeeded` with the two resource nodes.
- [ ] A Workflow with `retryStrategy: {limit: "2", retryPolicy: OnFailure, backoff: {duration: "5s", factor: "2"}}` on a template that runs `exit 1`, then `kubectl get wf <name> -o jsonpath='{.status.nodes}' | jq '.[] | {displayName, phase, message}'`. Expected: three child attempts under a retry node, final message `No more retries left`.
- [ ] `spec.activeDeadlineSeconds: 10` on a template that sleeps 60. Expected node message: `Pod was active on the node longer than the specified deadline`.
- [ ] Two Workflows sharing `synchronization.mutexes: [{name: lab-lock}]` submitted together; `kubectl get wf` shows the second `Pending` and its node message names the lock.
- [ ] `onExit` handler that echoes `{{workflow.status}}`, run once on a succeeding and once on a failing entrypoint; capture the exit node log. Also run `argo stop` vs `argo terminate` on a long-running workflow and show which one produced the exit-handler node.
- [ ] A `CronWorkflow` with `schedules: ["* * * * *"]`, `concurrencyPolicy: Forbid` and a 90-second template; `argo cron get` output plus `kubectl get wf` after three minutes should show ticks skipped.
- [ ] `argo template create` with a template containing a step using `templateRef` with and without `clusterScope: true` against a ClusterWorkflowTemplate, to capture the not-found error text for the wrong form.
- [ ] Set `workflowRestrictions: templateReferencing: Strict` in `workflow-controller-configmap`, submit a bare Workflow and one with `workflowTemplateRef` plus a `serviceAccountName` override; capture both rejection messages.
- [ ] Submit via the Argo Server API with a ServiceAccount token: `kubectl create token`, `curl -H "Authorization: Bearer ..." $ARGO_SERVER/api/v1/workflows/default -d @submit.json`. Expected: 200 and the Workflow appears.

#### 3.5 Crossplane: compositions as platform APIs

- [ ] `kubectl get xrd appenvironments.platform.lab.local -o jsonpath='{.status.conditions}'` and `kubectl get xrd` to capture the ESTABLISHED/OFFERED columns.
- [ ] Edit the composition once, then `kubectl get compositionrevisions -l crossplane.io/composition-name=<name>`; create one XR with `spec.crossplane.compositionUpdatePolicy: Manual`, edit the composition again, and show that XR's `compositionRevisionRef` unchanged while an Automatic XR moved.
- [ ] Set `spec.enforcedCompositionRef` on the XRD, create an XR with a different `compositionRef`, and show the XR's `spec.crossplane.compositionRef` rewritten.
- [ ] Annotate an XR `crossplane.io/paused: "true"`, edit its spec, show `Synced` reason `ReconcilePaused` and no change to the ResourceQuota.
- [ ] `crossplane composition render xr.yaml composition.yaml functions.yaml` (or `crossplane beta render` depending on installed CLI) against the lab files; capture the rendered Objects.
- [ ] `kubectl get managed` and `kubectl describe providerrevisions` on the lab; then delete the provider's ClusterRoleBinding (the lab's RBAC fault) and capture the `forbidden` message on the composed Object's `Synced` condition.
- [ ] A `Usage` protecting the team-c ResourceQuota, then `kubectl delete resourcequota` to capture the 409 admission message; delete the Usage and repeat.
- [ ] Managed resource with `managementPolicies: ["Observe"]` and `crossplane.io/external-name` pointing at an existing namespace via provider-kubernetes Object; show `status.atProvider` populated and no ownership.
- [ ] Scrape provider metrics: PodMonitor on the provider pod port 8080, then query `crossplane_managed_resource_ready` in Prometheus.

#### 3.6 kro, the golden path, and choosing the right engine

- [ ] `kubectl get rgd tenantspace -o jsonpath='{.status.conditions}'` and `'{.status.topologicalOrder}'`; then apply an RGD with a cycle (A references B, B references A) and capture the rejection.
- [ ] Add `readyWhen: [${quota.status.hard != null}]` (or a Deployment `availableReplicas` check on a new resource) and `includeWhen: [${schema.spec.cpu != "0"}]`; show a dependent waiting and a resource omitted.
- [ ] Annotate an instance `kro.run/reconcile: suspended`, delete the quota by hand, show it is not recreated; remove the annotation and show it return.
- [ ] If the chart supports it, install kro with `rbac.mode: aggregation`, apply the TenantSpace RGD without an aggregated ClusterRole, and capture the instance `forbidden` condition; add the labelled ClusterRole and show recovery.
- [ ] In Backstage: create a template whose `RepoUrlPicker` lacks the Gitea host in `allowedHosts` and capture the form error; then break the Gitea integration token and capture the `publish:gitea` failure text from the task log.
- [ ] `curl http://localhost:7007/api/catalog/entities?filter=kind=component` to list catalog entities and show the derived `relations` (ownedBy, partOf).

### Domain 4: Observability and operations (lab layers: make core obs)

#### 4.1 Prometheus: collection and PromQL

- [ ] A `ScrapeConfig` with `staticConfigs` pointing at an external target (the kind host's node-exporter if any, or a busybox httpd serving a fake metrics page); show the Prometheus object's `scrapeConfigSelector` and the resulting target.
- [ ] A `Probe` with blackbox-exporter (install it) probing the demo app's Service; query `probe_success`.
- [ ] A ServiceMonitor in `monitoring` for the Argo CD metrics Services without `spec.namespaceSelector`, then with `matchNames: [argocd]`; capture zero targets vs targets.
- [ ] Query `topk(10, count by (__name__) ({__name__=~".+"}))` and screenshot/text of Status → TSDB Status head cardinality.
- [ ] `predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[1h], 24*3600)` and `absent_over_time(up{job="example"}[5m])` after deleting the example ServiceMonitor.
- [ ] `kubectl -n monitoring get prometheus -o jsonpath='{.items[0].spec.retention}{" "}{.items[0].spec.retentionSize}'`.
- [ ] Flux and Tekton metric scrapes: PodMonitor on `flux-system` controllers (port `http-prom`) and ServiceMonitor on `tekton-pipelines-controller` (port 9090); queries `gotk_reconcile_duration_seconds_count` and `tekton_pipelines_controller_pipelinerun_total`.

#### 4.2 Alerting: rules, Alertmanager, routing

- [ ] An `AlertmanagerConfig` in `default` with a `muteTimeIntervals` referencing a `muteTimeIntervals[]` definition covering the current time; fire the drill alert and show it held in the UI, plus `amtool config routes test` against the rendered config.
- [ ] An `inhibitRules` entry (source `alertname=Watchdog`, target `severity=warning`, `equal: [namespace]`) and observe the drill alert inhibited.
- [ ] Extract `spec.groups` from the drill PrometheusRule into `rules.yml`, write `test.yml`, run `promtool check rules rules.yml` and `promtool test rules test.yml` (promtool binary in the Prometheus image via `kubectl exec`).
- [ ] Recording rules for a burn-rate alert on `http_requests_total` from the example app, then the two-window alert; drive errors with a curl loop to a 5xx path and show Pending → Firing.
- [ ] `kubectl -n monitoring get secret alertmanager-<name>-generated -o jsonpath='{.data.alertmanager\.yaml\.gz}' | base64 -d | gunzip` to show the rendered config with the injected namespace matcher.
- [ ] `kubectl -n monitoring get prometheus -o jsonpath='{.items[0].spec.alerting}'` to show the Alertmanager discovery block.

#### 4.3 Grafana dashboards and Loki logs

- [ ] Provision a Loki datasource ConfigMap with an explicit `uid`, `editable: false` and `jsonData.derivedFields` linking a `trace_id` regex to the Jaeger datasource; show the link in Explore.
- [ ] Annotate a dashboard ConfigMap `grafana_folder: Platform` and show it land in that folder.
- [x] ~~Make a dashboard wait for its instance~~: **dropped**. Installing the Grafana Operator to watch one `instanceSelector` match costs about four minutes, and "a selector that matches nothing leaves status empty" is already made twice on this site, by the ServiceMonitor `namespaceSelector` exercise and by the kro `instanceSelector` one. The lesson survives; the four minutes do not earn their place.
- [ ] LogQL: `| pattern` on the demo app's access log, `| unwrap` with `quantile_over_time`, `absent_over_time` on the chatty pod after it exits, and a query with `__error__!=""` to show parse failures.
- [ ] `alloy convert --source-format=promtail` on a sample promtail config (in the Alloy image) to show the component mapping.
- [ ] Loki retention: `kubectl -n monitoring get cm loki -o yaml | grep -A3 -E 'compactor|retention'` to show whether `retention_enabled` is set.

#### 4.4 Distributed tracing: OpenTelemetry and Jaeger

- [ ] Deploy a second `OpenTelemetryCollector` with `mode: sidecar` and annotate a pod `sidecar.opentelemetry.io/inject: "true"`; show the injected container.
- [ ] A `tail_sampling` processor with `status_code` and `latency` policies on the gateway collector; send telemetrygen traces with and without `--status-code ERROR` (or a synthetic slow span) and show what reaches Jaeger.
- [ ] `k8sattributes` processor with RBAC removed, then restored; show spans without and with `k8s.pod.name`.
- [ ] Instrumentation with a wrong endpoint port (4317 for Python), capture the agent's connection error in the app pod logs, then fix.
- [ ] `spanmetrics` connector plus `prometheus` exporter; query `traces_span_metrics_calls_total` (or the connector's metric name in the installed version) in Prometheus.
- [ ] `curl -s http://<jaeger>/api/services` and the `jaeger` v2 config (`kubectl -n tracing get cm -o yaml`) to show `jaeger_storage`/`jaeger_query` extensions.

#### 4.5 Platform efficiency: deployment metrics and indicators

- [ ] kube-state-metrics `--custom-resource-state-config` for `appenvironments.platform.lab.local` exposing a gauge from `status.conditions[type=Ready].status`; query `kube_customresource_*` in Prometheus.
- [ ] Compute lead time for one demo-staging revision: `git log -1 --format=%cI <sha>` vs the `argocd app history demo-staging` deployed-at timestamp; show the subtraction.
- [ ] `count(gotk_resource_info{customresource_kind="Kustomization", suspended="true"})` after `flux suspend` on one Kustomization.
- [ ] `increase(tekton_pipelines_controller_pipelinerun_total{status="success"}[24h])` after two pipeline runs.

#### 4.6 Incident response: diagnosis under a clock

- [ ] Fill etcd in kind to hit the quota (or lower `--quota-backend-bytes` on the kind control plane) and capture `etcdserver: mvcc: database space exceeded`, then `etcdctl alarm list`, compact, defrag, disarm.
- [ ] `kubeadm certs check-expiration` inside the kind control-plane container.
- [ ] Break CoreDNS (scale to 0) and capture `nslookup kubernetes.default` failure text from a pod; restore.
- [ ] Delete the Kyverno admission Deployment with `failurePolicy: Fail` webhooks in place and capture the `failed calling webhook ... context deadline exceeded` message on a pod create.
- [ ] `kubectl debug node/<node> -it --image=busybox --profile=sysadmin` and `--profile=netadmin` to show what each profile allows (`chroot /host`, `ip link`).
- [ ] A liveness probe with a wrong port on the demo app; capture exit code 143 in `lastState.terminated` and the `Liveness probe failed` events.
- [ ] `kubectl get --raw /readyz?verbose`.

### Domain 5: Security and policy enforcement (lab layers: make full (+spire, mesh))

#### 5.1 RBAC and secrets: least privilege in practice

- [ ] `kubectl auth whoami` as an impersonated user and group (`--as dev-a --as-group platform`).
- [ ] As a user bound to `admin` in team-a, try to create a RoleBinding to a ClusterRole granting `nodes` read; capture `attempt to grant extra privileges`; grant `bind` on that ClusterRole with `resourceNames` and retry.
- [ ] `kubectl create token reporter -n team-a --duration=10m` and decode the JWT to show `exp`, `aud`, `kubernetes.io.pod` binding (when bound).
- [x] ~~Encryption at rest on the kind control plane~~: **dropped**. Three control-plane restarts, a key file that must survive between them, and a decommission that has to rewrite every Secret before the flag comes off. It ran green and it wrecked the cluster twice getting there, and no exam task is that long. The theory panel keeps the field names; there is no exercise.
- [ ] ESO fake store: ExternalSecret with `refreshPolicy: CreatedOnce` plus `target.immutable: true`; change the fake value; show the Secret unchanged; then `Periodic` with `refreshInterval: 30s` and show the update.
- [ ] ESO `dataFrom.extract` against a JSON value and a `target.template` building a DSN.
- [ ] `kubeseal --scope namespace-wide` then rename the SealedSecret; contrast with a `strict` one renamed (`decryption error` in controller logs/events).
- [ ] Flux SOPS: `age-keygen`, `.sops.yaml`, `sops --encrypt --in-place`, Kustomization with `decryption.provider: sops`; show the decrypted Secret in-cluster and ciphertext in git.

#### 5.2 Policy engines: admission control, Kyverno, Gatekeeper

- [ ] `kubectl api-resources | grep -E 'kyverno|policies.kyverno'` and a `kubectl apply` of a classic ClusterPolicy to capture the 1.19 deprecation warning (if the lab runs 1.19+).
- [ ] ValidatingPolicy with `autogen.podControllers.controllers: [deployments]`; create a violating Deployment and show the denial at Deployment admission, versus without autogen the ReplicaSet event.
- [ ] `autogen.validatingAdmissionPolicy.enabled: true`; `kubectl get validatingadmissionpolicies` to show the generated VAP and binding.
- [ ] PolicyException in the exception namespace with `policyRefs` and `matchConditions`; show the report `skip` entry and the flags on the admission controller Deployment (`--enablePolicyException`, `--exceptionNamespace`).
- [ ] `kyverno test .` with a `kyverno-test.yaml` for the lab policy (CLI binary), and `kyverno apply --resource`.
- [ ] Gatekeeper: Constraint with `enforcementAction: scoped` and `scopedEnforcementActions` (deny at `audit.gatekeeper.sh`, warn at `validation.gatekeeper.sh`); capture the kubectl warning and the audit violation.
- [ ] Gatekeeper `Assign` mutator setting `imagePullPolicy` with `pathTests`; show the mutated pod.
- [ ] `gator test -f manifests/ -f policies/` in CI style.
- [ ] Native VAP with a typo in a field path; show `status.typeChecking` and the runtime effect under `failurePolicy: Fail` vs `Ignore`.
- [ ] MutatingAdmissionPolicy (1.36 GA) adding a label with `ApplyConfiguration`; show the label on a created pod.

#### 5.3 Pod Security Standards: the built-in baseline

- [ ] A pod with `runAsNonRoot: true` and a root image in `hardened`; capture `CreateContainerConfigError` and the `container has runAsNonRoot and image will run as root` event.
- [ ] `kubectl debug` into a restricted namespace without and with `--profile=restricted`; capture the admission rejection of the ephemeral container.
- [x] ~~`AdmissionConfiguration` with PodSecurity defaults on the kind control plane~~: **dropped**, same reason as the encryption item. It rewrites the API server's static pod manifest and restarts the control plane twice; every controller in the cluster crashloops through the gap. The namespace labels are the exam-shaped half and they already have exercises.
- [ ] `hostUsers: false` pod on the kind node (kernel and containerd version permitting); `kubectl exec` and `cat /proc/self/uid_map` to show the mapping.
- [ ] `kubectl apply --dry-run=server` of a Deployment into a warn-restricted namespace to capture the workload-level warning.

#### 5.4 Audit trails, SBOMs, and compliance reports

- [x] ~~Apply the audit policy and query it with jq~~: **dropped**. It restarts the API server, and every controller in the cluster crashloops through the gap for several minutes. The policy fragment in the theory panel is the part worth reading.
- [x] ~~The VAP audit annotation~~: **dropped with the item above**, which is the only thing that would have produced an audit log to query.
- [x] ~~Watch a shell open inside a container~~: **dropped**, and this one was conditional from the start ("if installable on kind with modern eBPF"). Falco installs and the DaemonSet goes Ready, but the alert never fires: the `Terminal shell in container` rule requires `proc.tty != 0`, and a captured `kubectl exec` has no terminal. Allocating a pty inside the container with `script` did not produce an event either, so the modern eBPF probe is not delivering on this host kernel. It also costs five minutes and puts a privileged DaemonSet on every node. The theory panel keeps the rule and the detection argument.
- [ ] `trivy image --format spdx-json` and `syft` on the same image; `trivy sbom` on the result; `trivy image --vex` with a small OpenVEX file suppressing one CVE.
- [ ] `kubectl get clustercompliancereport cis -o jsonpath='{.status.updateTimestamp}'` before and after forcing a rerun (edit `spec.cron`).
- [ ] kube-bench Job on kind; capture one PASS and one FAIL line with control ids.

#### 5.5 mTLS and workload identity: Istio and SPIRE

- [ ] `istioctl waypoint apply -n default --enroll-namespace`, `kubectl get gtw waypoint`, then an L7 AuthorizationPolicy with `targetRefs` allowing GET only; capture `403 RBAC: access denied` for POST and the L4 exit code 56 for the outsider.
- [ ] The same L7 rule on a `selector` policy to capture the fail-safe DENY behaviour.
- [ ] `PeerAuthentication` with `portLevelMtls` disabling one port; show plaintext accepted on that port only.
- [ ] `RequestAuthentication` + AuthorizationPolicy `requestPrincipals: ["*"]` with a test JWT (Istio's sample JWKS).
- [ ] `istioctl ztunnel-config certificates`, `policies`, and the ztunnel log lines with `src.identity`/`dst.identity`.
- [ ] Linkerd variant: `Server` on the backend port with an `AuthorizationPolicy` + `MeshTLSAuthentication`; capture `linkerd viz authz deploy/backend` before and after, and the readiness-probe failure when probes are not authorised.
- [ ] SPIRE: `spire-server entry show -selector k8s:sa:<sa>` and a pod with the `csi.spiffe.io` volume running `spire-agent api fetch x509 -socketPath /run/spire/sockets/agent.sock` to print the SVID's URI SAN.

#### 5.6 Pipeline security: scan, sign, verify

- [ ] Keyless signing against the public Sigstore instance is not possible offline; instead, capture `cosign verify` without identity flags on a keyless-signed public image (for example a Kyverno or Argo CD release image) to show the "must specify identity" error, then with `--certificate-identity-regexp` and `--certificate-oidc-issuer`.
- [ ] `cosign attest --predicate sbom.json --type cyclonedx --key cosign.key` on the lab image, `cosign tree`, `cosign verify-attestation --type cyclonedx --key cosign.pub | jq -r .payload | base64 -d | jq .predicateType`.
- [ ] Tekton Chains: install, set `artifacts.taskrun.format: slsa/v2alpha3`, `artifacts.oci.storage: oci`, `artifacts.taskrun.storage: oci`, key signer from `signing-secrets`; run the build task with `IMAGE_URL`/`IMAGE_DIGEST` results; capture `chains.tekton.dev/signed` annotation and `cosign verify-attestation --type slsaprovenance1` on the image. Then remove the results and show no OCI attestation.
- [ ] Kyverno IVP requiring the SLSA attestation (`attestations[].intoto.type: https://slsa.dev/provenance/v1`) with `verifyAttestationSignatures`; admit the Chains-built image, reject the busybox retag.
- [ ] `mutateDigest: true` and `kubectl get pod -o jsonpath='{.spec.containers[0].image}'` to show the digest rewrite.
- [ ] trivy gate variants: `--exit-code 1 --severity CRITICAL`, then `--ignore-unfixed`, then a `.trivyignore` with an `exp:` date in the past to show it no longer suppresses.
- [x] ~~A second opinion at admission~~: **dropped**. A second admission controller enforcing image signatures alongside Kyverno teaches the same control twice, and the Kyverno half already has two exercises on this page (the ImageValidatingPolicy and the digest rewrite). Two webhooks racing on the same pods is a lab hazard, not a lesson.
