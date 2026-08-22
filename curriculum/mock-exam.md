# Mock exam

Fifteen tasks, 120 minutes, 100 points, weighted like the real blueprint (15/25/25/20/15). Layers required: `make full` (everything on the main cluster; no mesh, no portal). Also have the 2.2 ApplicationSet applied (`kubectl apply -f examples/argocd-appset.yaml`) and the demo-app Dockerfile from section 2.4 pushed, both part of the curriculum's normal flow.

Rules that make this worth doing: start a timer (`date`), no peeking at curriculum sections or the answers below, docs and `--help` allowed (that matches the real exam), and grade only at the end, with the commands in the grading section. Anything a grading command cannot see does not count, which is also how the real thing works. Target: 70+ and no domain at zero. If a task stalls, note the time, move on, come back.

## Tasks

**1. (7 pts, domain 1)** Create namespace `team-x` labelled `pod-security.kubernetes.io/enforce=baseline`, with a ResourceQuota `mock-quota` (requests.cpu 1, requests.memory 2Gi, pods 5) and a LimitRange `mock-limits` defaulting containers to 100m/128Mi requests and 200m/256Mi limits.

**2. (8 pts, domain 1)** In `team-x`, create deployment `web` (image `ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine`, port 8080), 4 replicas, each container requesting exactly 25m CPU and 32Mi memory, spread across zones with a topologySpreadConstraint (`maxSkew: 1`, `whenUnsatisfiable: DoNotSchedule` on `topology.kubernetes.io/zone`). All 4 must become Ready.

**3. (8 pts, domain 2)** Through git only (no kubectl mutations): set the staging overlay of demo-app to 2 replicas and get it live via Argo CD. The live deployment is `staging-demo` in `team-a`.

**4. (9 pts, domain 2)** Create a Flux Kustomization `mock-demo` on the existing `GitRepository/platform` deploying path `./demo-app/base` into namespace `mock-flux` (create it), prune enabled, interval 1m. Both replicas Ready.

**5. (8 pts, domain 2)** Apply `examples/rollouts/canary.yaml`, wait for the rollout `demo` in `team-a` to be Healthy, trigger a canary with image tag `1.28-alpine`, then abort it while it is mid-steps (the metric analysis may abort it for you first, since the demo app exposes no `http_requests_total`; an abort is an abort, but be the one who did it). The rollout must end aborted with the stable version at `1.27-alpine`.

**6. (8 pts, domain 3)** Create a namespaced CRD `mockapps.mock.lab` (kind `MockApp`, plural `mockapps`) whose spec requires field `tier` (string, enum: dev, prod) and shows it in a printer column named `TIER`. Create instance `one` (tier: dev) in `default`. A MockApp with `tier: staging` must be rejected by the API server.

**7. (9 pts, domain 3)** Using the lab's existing AppEnvironment platform API, provision an environment `team-y-dev` in `default` for team `team-y` with cpuQuota "3" and memoryQuota 6Gi, and wait until it is fully reconciled.

**8. (8 pts, domain 3)** Create and run an Argo Workflow in `default` (any name, `generateName` fine) that creates ConfigMap `mock-result` in `default` with data `result=done`, running under a ServiceAccount that you grant exactly the rights this needs. The workflow must reach Succeeded.

**9. (7 pts, domain 4)** Deploy `quay.io/brancz/prometheus-example-app:v0.5.0` in `default` as deployment+service `mock-metrics` (port 8080) and get Prometheus scraping it via a ServiceMonitor. The target must reach state up.

**10. (7 pts, domain 4)** Create a PrometheusRule that defines alert `MockDown`, firing (after 1m) whenever `mock-metrics` has zero healthy scrape targets. Prove it can fire by scaling `mock-metrics` to 0 and letting it reach Alertmanager.

**11. (6 pts, domain 4)** Run `make break`. Diagnose it, write the root cause in one line to `/tmp/mock-diagnosis.txt` before revealing anything, then fix the cluster yourself (no `make break-fix`). Score it only if `make break-answer` matches your written diagnosis and the fault's symptom is demonstrably gone.

**12. (4 pts, domain 5)** Create ServiceAccount `auditor` in `team-b` that can get and list pods and deployments in `team-b` and nothing else (no create, no other namespaces).

**13. (4 pts, domain 5)** Create namespace `policy-test`, then make the cluster reject any new pod there whose containers lack CPU or memory requests, using the policy engine already installed. (Flip it back after grading. And if your first instinct was to demonstrate this in team-b, work out why that can never show a rejection before reading the answer.)

**14. (3 pts, domain 5)** From the API audit log, extract every successful `delete` performed today by the admin user into `/tmp/mock-audit.json`, one JSON event per line, each containing verb, user.username, and objectRef.

**15. (4 pts, domain 5)** Generate a cosign key pair, sign the image `localhost:5001/demo:v1` by digest, and verify the signature. Both sign and verify must succeed against the registry.

## Grading

Run all of it; each line prints what earns the points. Judge partial credit like the meanest grader you know.

```bash
# 1
kubectl get ns team-x -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}{"\n"}'   # baseline
kubectl -n team-x get resourcequota mock-quota -o jsonpath='{.spec.hard}{"\n"}'                      # cpu 1, mem 2Gi, pods 5
kubectl -n team-x run graded --image=busybox:1.37 --restart=Never -- sleep 30 && sleep 5 && \
kubectl -n team-x get pod graded -o jsonpath='{.spec.containers[0].resources}{"\n"}'                 # 100m/128Mi defaults injected
# 2
kubectl -n team-x get deploy web -o jsonpath='{.status.readyReplicas}{"\n"}'                         # 4
kubectl -n team-x get pods -l app=web -o custom-columns=NODE:.spec.nodeName --no-headers | sort | uniq -c   # 2+2 across zone nodes
# 3
kubectl -n team-a get deploy staging-demo -o jsonpath='{.spec.replicas}{"\n"}'                       # 2
kubectl -n argocd get app demo-staging -o jsonpath='{.status.sync.status}{"\n"}'                     # Synced (git did it, not kubectl)
# 4
flux get kustomization mock-demo   # Ready True
kubectl -n mock-flux get deploy demo -o jsonpath='{.status.readyReplicas}{"\n"}'                     # 2
# 5
kubectl -n team-a get rollout demo -o jsonpath='{.status.abort}{"\n"}'                               # true
kubectl -n team-a get rollout demo -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'     # ...1.28-alpine requested
kubectl argo rollouts status demo -n team-a --timeout 10s 2>&1 | head -1                             # Degraded/aborted, stable serving old
# 6
kubectl get crd mockapps.mock.lab -o jsonpath='{.status.conditions[?(@.type=="Established")].status}{"\n"}'  # True
kubectl get mockapp one   # TIER column shows dev
kubectl apply -f <(kubectl get mockapp one -o json | jq '.metadata.name="bad" | .spec.tier="staging"') 2>&1 | grep -i unsupported  # rejection
# 7
kubectl get appenvironment team-y-dev -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}{"\n"}'    # True
kubectl -n team-y get resourcequota tenant-quota -o jsonpath='{.spec.hard}{"\n"}'                    # cpu 3, memory 6Gi
# 8
kubectl get workflow -o jsonpath='{.items[?(@.status.phase=="Succeeded")].metadata.name}{"\n"}'      # your workflow
kubectl get cm mock-result -o jsonpath='{.data.result}{"\n"}'                                        # done
# 9
kubectl -n monitoring port-forward svc/prometheus-kube-prometheus-prometheus 19090:9090 & sleep 3
curl -s 'http://localhost:19090/api/v1/query?query=up{namespace="default"}' | jq -r '.data.result[] | select(.metric.pod|test("mock-metrics")) | .value[1]'   # 1
# 10 (after scaling to 0 and waiting out the for:)
kubectl -n monitoring port-forward svc/prometheus-kube-prometheus-alertmanager 9093:9093 & sleep 3
curl -s 'http://localhost:9093/api/v2/alerts?filter=alertname%3D%22MockDown%22' | jq -r '.[0].status.state'   # active
# 11
cat /tmp/mock-diagnosis.txt && make break-answer     # must agree; then show the symptom gone
# 12
kubectl auth can-i list pods --as=system:serviceaccount:team-b:auditor -n team-b       # yes
kubectl auth can-i create pods --as=system:serviceaccount:team-b:auditor -n team-b     # no
kubectl auth can-i list pods --as=system:serviceaccount:team-b:auditor -n team-a       # no
# 13
kubectl -n policy-test run graded-naked --image=busybox:1.37 --restart=Never -- sleep 5 2>&1 | grep -ci 'request'  # >=1 (rejected)
# 14
jq -e 'select(.verb=="delete") | .user.username, .objectRef.resource' /tmp/mock-audit.json | head    # parses, right shape
# 15
cosign verify --key cosign.pub --allow-http-registry localhost:5001/demo@$(skopeo inspect --tls-verify=false docker://localhost:5001/demo:v1 | jq -r .Digest) 2>&1 | grep -c 'signatures were verified'  # 1
```

## Answers

Key moves only; each maps to a curriculum section where the full treatment lives.

1. Three objects, section 1.4's shapes. The graded check is the LimitRange *injecting* defaults, so `default:`/`defaultRequest:` must both be set.
2. Requests must be explicit or team-x's LimitRange (100m) would overshoot the quota at 4 replicas; 25m×4 fits under 1 CPU. Spread as in section 1.2. If pods pend, read the quota/scheduling event; that is the task inside the task.
3. Clone the platform repo with credentials (`http://lab:$GITEA_PASS@gitea.lab:3000/lab/platform.git`; anonymous push fails), set `replicas` in `demo-app/overlays/staging/kustomization.yaml`, push, let the ApplicationSet's automated sync land it, or `argocd app sync demo-staging` to skip the poll. Section 2.2.
4. `flux create kustomization mock-demo --source=GitRepository/platform --path=./demo-app/base --target-namespace=mock-flux --prune=true --interval=1m` after creating the namespace. Section 2.3.
5. `kubectl argo rollouts set image demo web=ghcr.io/nginxinc/nginx-unprivileged:1.28-alpine -n team-a`, then `kubectl argo rollouts abort demo -n team-a` during the pause step. Aborted leaves spec at the new tag, stable ReplicaSet serving the old one, `status.abort: true`. Section 2.5.
6. Section 3.2's CRD skeleton with `enum: [dev, prod]` and an `additionalPrinterColumns` entry (`name: TIER`, jsonPath `.spec.tier`). The rejection sentence comes from the enum validator.
7. Copy `examples/crossplane/xr.yaml`, change name/team/quotas, apply, `kubectl get appenvironment -w` until Ready. Section 3.5; `crossplane resource trace` if it sticks.
8. Section 3.4's pattern with a single `resource` template (action create, the ConfigMap manifest inline). SA needs `create` on configmaps in default *and* `create,patch` on `workflowtaskresults.argoproj.io` (the executor's reporting channel; forget it and a correct workflow still fails), bound with Roles, named in `spec.serviceAccountName`.
9. Deployment + Service with a *named* port, ServiceMonitor selecting the Service's labels, endpoint port by name. This lab's Prometheus selects all monitors (selector `{}`); on a stock install you would also need the release label, and checking the selector first is the habit. Section 4.1's second exercise is this task in slow motion.
10. `expr: absent(up{job="mock-metrics"} == 1)` (or `count(up{...}==1) == 0` with `or vector` care), `for: 1m`. Scale to 0, wait ~2-3 min for evaluate + for: + group_wait. Section 4.2. (Rule selector logic is the same story as answer 9.)
11. Section 4.6's method: blast radius, timeline, descend. Sub-7-minutes is the target this whole curriculum has been training.
12. Role (get/list pods+deployments) + RoleBinding to the SA, both in team-b only. The third check fails if you reached for a ClusterRoleBinding. Section 5.1.
13. `kubectl patch validatingpolicy require-resource-requests --type=merge -p '{"spec":{"validationActions":["Deny"]}}'`; the policy ships in Audit. The task uses `policy-test` because the tenant namespaces have LimitRanges, and LimitRanger mutates requests in before validation ever runs, so team-b literally cannot produce a rejection. Section 5.2 makes a whole lesson of it. Flip back to `["Audit"]`.
14. `docker exec cnpe-control-plane cat /var/log/kubernetes/audit.log | jq -c 'select(.verb=="delete" and .responseStatus.code<300 and (.user.username|test("admin")))' > /tmp/mock-audit.json`. Section 5.4.
15. Section 5.6's exercise verbatim: `cosign generate-key-pair`, sign by digest with `--allow-http-registry -y`, verify with the pub key. If `demo:v1` doesn't exist, the 2.4 pipeline builds it (pushing as `kind-registry:5000/demo:v1`, which the host reads back as `localhost:5001/demo:v1`), and discovering that dependency mid-exam is authentic too.

## After scoring

Log the score per domain, not just the total; a domain at zero fails you in ways an average hides. Re-drill the weakest domain's sections, wait two days, and rerun this from scratch on a rebuilt lab (`make down && make full` gives you a clean grader). The second attempt under time is the one that predicts the real thing.
