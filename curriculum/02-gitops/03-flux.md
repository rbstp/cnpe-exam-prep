# 2.3 Flux: sources, kustomizations, helm releases

Competency: GitOps workflows for application and infrastructure deployment (domain 2, 25%). Needs: `make core`.

The exam names both Argo and Flux, and the lab installs both against the same Gitea for a reason: you should be able to express the same delivery in either. Flux has no Application object. It decomposes GitOps into small CRDs that reference each other, and reading those references is the skill.

## Working model

Sources and appliers. A source CRD fetches something and exposes an artifact: GitRepository, HelmRepository, OCIRepository, Bucket. An applier CRD consumes a source: Kustomization (applies a path from a git/oci artifact) and HelmRelease (installs a chart from a source). The two-step split is the design: one GitRepository can feed many Kustomizations, each watching a different path with different intervals and health checks.

Names collide, stay alert: Flux's `Kustomization` (kustomize.toolkit.fluxcd.io) is not kustomize's `Kustomization` (kustomize.config.k8s.io). The Flux one points at a directory; the directory may contain the other one. Exam tasks love this ambiguity, and `kubectl get kustomizations.kustomize.toolkit.fluxcd.io` vs a file read resolves it.

The lab wires `GitRepository/platform` in `flux-system` to the same Gitea repo Argo CD watches, and deliberately builds nothing on it. Building the first Kustomization is your job below.

Daily verbs: `flux get sources git`, `flux get kustomizations`, `flux reconcile kustomization <name> --with-source` (force a loop now), `flux suspend/resume kustomization <name>` (the sanctioned way to pause reconciliation during surgery, and a common exam ask), `flux tree kustomization <name>` (what did this thing create), `flux events`.

Drift behaviour differs from Argo CD in a way worth knowing cold: a Flux Kustomization re-applies its manifests on every interval, so drift is corrected at reconcile time; there is no separate selfHeal toggle, but there is `prune: true/false` with the same blast-radius semantics as Argo's.

## Exercises

**Build a Kustomization on the existing source.** Deploy the demo base (not the overlays, which Argo owns in 2.2; two controllers fighting over one resource is a lesson, not a setup) into a Flux-owned namespace:

```bash
kubectl create ns flux-demo
flux create kustomization demo-flux \
  --source=GitRepository/platform \
  --path=./demo-app/base \
  --target-namespace=flux-demo \
  --prune=true --interval=1m \
  --health-check-timeout=2m
flux get kustomizations
```

Verify: Ready True with an applied revision SHA, and `kubectl -n flux-demo get deploy demo` shows 2/2. Then `flux tree kustomization demo-flux` and confirm it lists exactly the deployment, service, and nothing else.

**Watch the interval work.** Scale the deployment by hand, then wait out one interval:

```bash
kubectl -n flux-demo scale deploy demo --replicas=5
sleep 70 && kubectl -n flux-demo get deploy demo -o jsonpath='{.spec.replicas}{"\n"}'
```

Verify: back to 2. Same experiment as Argo's selfHeal, different mechanism; be able to say which component did it (kustomize-controller re-applying at interval).

**Suspend, change, resume.** `flux suspend kustomization demo-flux`, scale to 5 again, confirm it stays at 5 for two intervals, then `flux resume kustomization demo-flux` and confirm it snaps back. Verify: suspend shows in `flux get kustomizations` as Suspended True. This is the answer to "make the controller stop overwriting my hotfix while I debug".

**A HelmRelease from a public chart.** Sources need not be git:

```bash
flux create source helm podinfo --url=https://stefanprodan.github.io/podinfo --interval=10m
flux create helmrelease podinfo --source=HelmRepository/podinfo \
  --chart=podinfo --target-namespace=flux-demo --interval=5m
kubectl -n flux-demo get deploy podinfo
```

Verify: `flux get helmreleases` Ready True, release revision 1, and `helm list -n flux-demo` shows Flux as the release owner. Break it once for the diagnostic reps: set `--chart-version='>99.0.0'` on a new helmrelease, read the failure in `flux get helmreleases` and `kubectl describe helmrelease`, then delete it. Failed source resolution vs failed install vs failed health check appear in different conditions, and knowing which layer failed is the troubleshooting pattern.

**Translate.** Write down, from memory, the Flux equivalent of the Argo CD Application demo-staging from 2.2 (GitRepository exists; you need one Kustomization spec: path, targetNamespace, prune, interval). Verify against `flux create kustomization --export`. If you can do this translation both directions, the "which tool will the exam give me" worry disappears.

## Docs to know your way around

- fluxcd.io: GitRepository, Kustomization, HelmRelease API references; the "flux CLI" cheat sheet page
- `flux --help` and `flux create <kind> --help --export` generate correct YAML offline, which is faster than docs in the exam
