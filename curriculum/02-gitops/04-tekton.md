# 2.4 Tekton: CI/CD as Kubernetes resources

Competency: building and configuring CI/CD pipelines integrated with Kubernetes (domain 2, 25%). Needs: `make core cicd`.

Tekton's whole trick is that a pipeline is not config for a CI server; it is Kubernetes resources executed as pods. Once that lands, everything else is vocabulary: a Task is a sequence of steps (containers sharing a pod), a Pipeline sequences Tasks, and running either means creating a TaskRun or PipelineRun. Debugging CI becomes debugging pods, which you already know how to do.

## The pieces the exam wires together

Params, workspaces, results. Params pass values down (pipeline param → task param → `$(params.image)` in a step). Workspaces pass files: a Pipeline declares one, the PipelineRun binds it to a PVC or volumeClaimTemplate, tasks mount it, and that is how the clone step's checkout reaches the build step. Results pass small strings between tasks (`$(tasks.clone.results.commit)`), and `examples/tekton/pipeline.yaml` uses all three, which is why the lab README calls it minimal but complete. Read it before running it.

Ordering: `runAfter` sequences tasks explicitly; consuming another task's result creates an implicit dependency. No `runAfter` and no shared results means tasks run in parallel, which surprises people exactly once.

ServiceAccounts matter in real setups because the pipeline pod's SA carries registry credentials (bound via the PipelineRun's `taskRunTemplate.serviceAccountName`); the lab registry needs none, and kaniko pushes to it with `--insecure`. One naming subtlety that generalises to every private-registry task: the pipeline pushes to `kind-registry:5000/demo:v1` because it runs *inside* the cluster, where `localhost` is the pod itself; the host addresses the very same store as `localhost:5001`. One registry, two names, and knowing which name works from where is a real exam skill. The catalog tasks `make cicd` installed are `git-clone` and `kaniko`; the trivy-scan task arrives when you apply the example below. `tkn task list` shows what you have.

Triggers turn events into runs: EventListener (a pod exposing HTTP), TriggerBinding (extract fields from the webhook payload), TriggerTemplate (stamp out the PipelineRun). It is three CRDs to say "when Gitea posts a push event, run the pipeline with that commit".

## Exercises

**Run the example pipeline end to end.** Read `examples/tekton/pipeline.yaml` first: pipeline `build-and-scan`, params `repo-url` and `image`, one workspace `shared` carried clone → build → scan, and a ready-made PipelineRun with `generateName`. One catch the file does not solve for you: the seeded `demo-app` repo contains only a README, and kaniko needs a Dockerfile. Supplying one is the exercise:

```bash
source lab.env   # push needs credentials
git clone "http://lab:${GITEA_PASS}@gitea.lab:3000/lab/demo-app.git" /tmp/demo-app && cd /tmp/demo-app
cat > Dockerfile <<'EOF'
FROM ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine
COPY README.md /usr/share/nginx/html/index.html
EOF
git add . && git commit -m "make it buildable" && git push
cd - && kubectl create -f examples/tekton/pipeline.yaml   # Task + Pipeline + one PipelineRun
tkn pipelinerun logs --last -f
```

Verify: the run Succeeds and the push was real: `skopeo inspect --tls-verify=false docker://localhost:5001/demo:v1 | jq .Digest`. If the scan step fails instead, that is the CVE gate doing its job on today's base image; read which CVEs and decide as a platform engineer would (bump the base, or ignore-unfixed). Rerun later with `tkn pipeline start build-and-scan --last`.

**Author one task from nothing.** Write a Task `manifest-lint` that takes a param `path`, mounts workspace `source`, and runs `kustomize build $(params.path)` from an image that has kustomize (`registry.k8s.io/kustomize/kustomize:v5.0.0` works, or line-count with busybox if pulls are slow). Emit a result `objects` containing the object count. Run it with `tkn task start` against the platform repo cloned by a git-clone task, or standalone with a fresh clone step. Verify: `tkn taskrun describe --last` shows your result value, non-zero.

**Fail where it should fail.** The trivy-scan task exits 1 on HIGH/CRITICAL findings, and an old image guarantees some:

```bash
tkn task start trivy-scan -p image=nginx:1.19 -w name=source,emptyDir="" --showlog
tkn taskrun list | head -3
kubectl get taskrun -o jsonpath='{.items[0].status.conditions[0].message}'
```

Verify: the run is Failed and the condition message names the step that exited non-zero. Then reason one level up: in the full pipeline, a scan failure stops anything sequenced after it via `runAfter`, which is the entire supply-chain argument for putting the gate in the pipeline instead of in a ticket. Naming *which* task killed a run from `kubectl` output alone, without the dashboard, is the competency.

**Stretch: wire a Gitea webhook to a trigger.** EventListener + TriggerBinding (extract the clone URL and SHA from Gitea's push payload) + TriggerTemplate (PipelineRun with those as params). Expose the EventListener service as a LoadBalancer so the Gitea container can reach it across the kind network, then add the webhook in the Gitea UI (repo settings → webhooks, target `http://<EXTERNAL-IP>:8080`). Push a commit to demo-app. Verify: `tkn pipelinerun list` grows by one without you touching kubectl, and `kubectl get eventlistener` shows Ready. Budget an hour; the payoff is having debugged webhook → listener → run once before an exam asks you to.

## Docs to know your way around

- tekton.dev: Tasks, Pipelines, and the workspaces page (volumeClaimTemplate binding especially); Triggers' TriggerBinding examples for payload paths
- `kubectl explain pipelinerun.spec` and `tkn <verb> --help` cover most syntax questions offline
