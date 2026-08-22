# 2.2 Argo CD: applications, sync, drift

Competency: GitOps workflows for application and infrastructure deployment (domain 2, 25%). Needs: `make core`.

Argo CD is the tool most likely to be sitting in front of you on the exam, and the Application resource is its entire API. One spec: source (repo, revision, path or chart), destination (server, namespace), syncPolicy. Everything in the UI is a view over that.

## Working model

Two status axes, independent of each other, and conflating them is the classic mistake. Sync status compares git with live (Synced/OutOfSync). Health status looks at the resources themselves (Healthy/Progressing/Degraded/Missing). An app can be Synced and Degraded: git said run a broken image, and the cluster faithfully runs it broken. Fixing that means fixing git, not clicking sync.

syncPolicy decides how much the controller does alone. Manual apps report OutOfSync and wait. `automated` syncs on git change; `selfHeal: true` also reverts live drift; `prune: true` deletes live resources whose manifests vanished from git. Prune is the one that bites: without it, renaming a resource in git leaves the old one running forever; with it, removing a file deletes production. Know which behaviour you have before you push.

Ordering: sync waves (`argocd.argoproj.io/sync-wave: "-1"` annotation, lower first) and resource hooks (PreSync/Sync/PostSync jobs). The stock example is a database migration Job in PreSync. CRDs before CRs is the other stock case, and wave ordering is the fix when a sync fails with "no matches for kind".

Scale patterns: app-of-apps (an Application whose manifests are other Applications) and ApplicationSet (a template plus generators that stamp out Applications). The lab uses both shapes: `examples/argocd-appset.yaml` generates one app per overlay directory found in git, and the Backstage golden path generates apps from an SCM generator. For the exam, be able to read a generator block and predict exactly which Applications will exist.

CLI, because the UI wastes exam time: `argocd login <server> --username admin --password $(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d) --insecure`, then `app list`, `app get`, `app sync`, `app diff`, `app set`.

## Exercises

**Deploy from the ApplicationSet.** Apply the example and predict its output before looking:

```bash
kubectl apply -f examples/argocd-appset.yaml
kubectl -n argocd get applications
kubectl -n team-a get deploy staging-demo && kubectl -n team-b get deploy prod-demo
```

Verify: `demo-staging` and `demo-prod` Applications exist (one per overlay directory in the platform repo), each Synced/Healthy. Now the nuance that makes this a good exercise: the ApplicationSet template sets `destination.namespace` to the directory basename, but the overlays pin `namespace: team-a` and `team-b` in their kustomizations, and an explicit namespace in a manifest always wins over the Application's destination default. So the workloads land in the tenant namespaces, prefixed `staging-` and `prod-`. Predicting where a resource actually lands from those two competing settings is exactly the kind of thing a task can hinge on. If an app is stuck, read its conditions: `kubectl -n argocd get app demo-staging -o jsonpath='{.status.conditions}' | jq`.

**Close the loop from 2.1.** Your replica change from the fundamentals section is already in the platform repo, so `demo-staging` picks it up on the next poll (up to ~3 min) or immediately with `argocd app sync demo-staging`. Verify: `kubectl -n team-a get deploy staging-demo -o jsonpath='{.spec.replicas}'` matches your commit, and `argocd app history demo-staging` shows the revision.

**Fight the controller and lose.** The appset template sets automated + selfHeal + prune:

```bash
kubectl -n team-a scale deploy staging-demo --replicas=5
kubectl -n team-a get deploy staging-demo -w
```

Verify: replicas snap back to the git value within seconds, and `argocd app get demo-staging` never settles OutOfSync. Then prove you understand prune the safe way: the service manifest lives in `demo-app/base/`, so drop `service.yaml` from the base kustomization's resources list, push, and watch the live Service disappear from *both* tenants (a base edit hits every overlay, which is its own lesson in blast radius). Revert the commit and watch them return. Git history is your undo; that is the pitch, demonstrated.

**Break sync with ordering, fix with a wave.** Add to the staging overlay a manifest for a CR whose CRD does not exist (any made-up kind), push, and read the sync error. Then fix it properly for the case where you control both: put the CRD in the same overlay with `argocd.argoproj.io/sync-wave: "-1"` and the CR at wave 0. Verify: sync succeeds and `kubectl get <your-kind>` returns the CR. The other tool for this job is the `argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true` annotation, for when the CRD arrives from somewhere you don't control; knowing both exists is the difference between one fix and a toolbox. Clean up the overlay afterwards; you'll reuse it.

**Synced but Degraded.** Push an image tag that doesn't exist (`newTag: does-not-exist` in the staging kustomization), sync, and read the two statuses side by side: `argocd app get demo-staging | head -20`. One timing note so you don't misread it: health shows Progressing for up to ten minutes (the Deployment's `progressDeadlineSeconds`) before flipping to Degraded, while the pod's ImagePullBackOff is visible in events immediately; Progressing-with-a-broken-pod already tells you everything. Verify: Sync status Synced, health on its way to Degraded, and you can articulate why clicking sync again is useless here. Revert the commit. This exact confusion is section 2.6's opening scenario.

## Docs to know your way around

- argo-cd.readthedocs.io: Application spec reference, sync options, sync waves and hooks, ApplicationSet generators
- `argocd app --help` covers most of what the docs would; the CLI help is available offline in the exam terminal
