# 2.6 Troubleshooting delivery: drift, permissions, bad config

Competency: the diagnostic half of every domain 2 competency, and worth its own session because broken delivery is the most likely shape of a domain 2 exam task. Needs: `make core`, with the 2.2 applications still deployed.

Delivery failures sort into four buckets, and the first diagnostic move is deciding which bucket you are in. Everything below is reps for that decision.

## The four buckets

**Git is wrong, cluster is faithful.** Synced + Degraded. Bad image tag, impossible resource request, missing ConfigMap key. The controller did its job; fix the commit. Evidence: app health Degraded while sync status is green, pod events carry the real error (ImagePullBackOff, CreateContainerConfigError).

**Cluster refuses what git says.** Sync fails outright. Admission policy denies the manifest, the API version doesn't exist on this cluster, a field is immutable (Service clusterIP, label selectors, PVC size shrink), the CRD isn't installed yet. Evidence: the sync operation error message, which quotes the API server's rejection verbatim. Immutable-field errors mean delete-and-recreate or `Replace=true` sync option, and knowing that saves ten minutes.

**The controller lacks permission or access.** Repo unreachable, credentials rotated, Application targeting a namespace the controller's RBAC can't touch, ApplicationSet token missing a scope. Evidence: errors mention the controller's own identity, appear in controller logs (`kubectl -n argocd logs deploy/argocd-repo-server`, `flux logs`), and nothing about the workload itself.

**Nobody is wrong, state is stale.** Webhook lost, refresh interval not elapsed, reconciliation suspended and forgotten. Evidence: everything green but old; `flux get kustomizations` shows a suspended row, `argocd app get` shows a last-sync timestamp from an hour ago. Fix is `argocd app get --refresh` / `flux reconcile ... --with-source`, and checking for suspension before anything else.

Drift deserves one more sentence: with selfHeal on, drift self-corrects and the interesting question becomes "what keeps re-creating this thing I keep deleting"; with it off, `argocd app diff` is the tool that shows exactly what diverged.

## Exercises

Each one stages a failure. Do the diagnosis before the fix, and say the bucket out loud before touching anything.

**Bad config.** Push `newTag: 9.9.9-nope` to the staging overlay in the platform repo. Watch demo-staging stay Synced while health goes Progressing (Degraded arrives only after the Deployment's ten-minute progress deadline; do not wait for it, the pod evidence is immediate). Diagnose down the stack: `argocd app get demo-staging` → `kubectl -n team-a get pods` → `describe pod` shows ImagePullBackOff. Fix in git only. Verify: revert commit pushed, app back to Healthy without any kubectl mutation.

**Immutable field.** Add a patch to the staging overlay's kustomization setting `spec.clusterIP: 10.96.99.99` on the demo Service (the Service manifest itself lives in base; overlays change it through patches, which is the kustomize idiom worth a rep on its own). Sync and read the error. Verify: you can quote where the error text came from (the API server, relayed by the sync operation) and fix it by removing the patch. Bucket 2, and the error message named it.

**Break the controller's credentials.** Deleting the repo secret outright would not do it here, and knowing why is the exercise's first half: the lab's repos are public, so anonymous cloning still works. *Wrong* credentials fail where absent ones would not, because Gitea rejects a bad password even on a public repo. So corrupt the secret: `kubectl -n argocd patch secret gitea-repo -p '{"stringData":{"password":"wrong"}}'`, then `argocd app get demo-staging --refresh`. The error mentions authentication, not manifests. Restore by re-running `make gitops` (idempotent) or patching the real token back from `.gitea-token`. Verify: the refresh succeeds again. Notice how different this error's *shape* was: no pod was ever involved.

**Silent staleness.** `flux suspend kustomization demo-flux` (from 2.3), push any change to demo-app/base in the platform repo, and observe that nothing happens and nothing errors. The absence of failure is the symptom. Verify: `flux get kustomizations` shows Suspended, resume, and the change lands. Train yourself to check suspension *first*; it costs three seconds.

**The lab's own drill.** `FAULT=config make break` corrupts something in team-a's delivery path under a 7-minute clock. Bucket it, fix it, then `make break-answer` to compare. Run it until the bucketing step takes under a minute.

## Docs to know your way around

- argo-cd.readthedocs.io: sync options (Replace, ServerSideApply), resource health checks
- fluxcd.io: the troubleshooting cheatsheet page (flux logs, flux events, tracing a resource to its Kustomization)
