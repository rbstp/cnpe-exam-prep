# 2.1 GitOps fundamentals: desired state, drift, repo design

Competency: GitOps workflows for application and infrastructure deployment (domain 2, 25%). Needs: `make core` (cluster + Gitea + Argo CD/Flux).

GitOps is one idea applied ruthlessly: git holds the desired state, a controller in the cluster pulls it and reconciles continuously, and nobody deploys by pushing manifests at the API server from a laptop or a CI job. Everything else in this domain, Argo CD, Flux, promotion, drift handling, is machinery for that one idea.

## The concepts that questions hang off

Reconciliation is a loop, not an event. The controller compares live state with git on an interval and on webhooks, so a change made with `kubectl edit` does not fail, it just gets reverted on the next loop if self-heal is on, or reported as drift if not. "Why did my manual fix disappear" is the canonical symptom, and "OutOfSync" is the canonical report.

Push vs pull: CI pushing manifests needs cluster credentials in the CI system and only knows the state at deploy time. A pull-based agent keeps credentials in-cluster and never stops comparing. Be able to give that answer in two sentences.

Repo design is the part people under-prepare. This lab seeds two Gitea repos that model the standard split: `platform` (cluster-level config: policies, tenants, the app-of-apps) and `demo-app` (one workload). Environments are directories, not branches: `demo-app/overlays/staging` and `overlays/prod` in the platform repo, with promotion being a change flowing from one directory to the next, usually by bumping the image tag or a kustomize patch. Branches-per-environment exists in the wild and the received wisdom is to avoid it, because merges between long-lived env branches drift apart and fight.

Templating, both flavours, because the exam can hand you either. Kustomize layers patches over a base with no templating language; Helm renders templates from values. Argo CD and Flux both consume both. The lab's demo-app is the kustomize shape: read `examples/demo-app/base/kustomization.yaml`, then both overlays, and note what each overlay changes (name prefix, replicas, labels).

## Exercises

**Render before you trust.** Never push an overlay you haven't built locally:

```bash
kustomize build examples/demo-app/overlays/staging
kustomize build examples/demo-app/overlays/prod | grep -E 'replicas|name:'
```

Verify: you can state every difference between the two overlays from the rendered output alone, without opening the overlay files.

**Make a change the GitOps way.** The `platform` repo in Gitea carries a copy of `examples/`. Clone it, change the staging replica count, push:

```bash
source lab.env   # for GITEA_PASS; anonymous clone works, push needs credentials
git clone "http://lab:${GITEA_PASS}@gitea.lab:3000/lab/platform.git" /tmp/platform && cd /tmp/platform
# edit demo-app/overlays/staging/kustomization.yaml: set replicas, or add a patch
git commit -am "staging: 3 replicas" && git push
```

Nothing deploys yet, and that is the point: a repo is desired state only once a controller watches the path. Section 2.2 wires this exact commit to a live Application; keep the clone.

**Say what watches what.** Both controllers are already connected to Gitea:

```bash
kubectl -n argocd get secret gitea-repo -o jsonpath='{.data.url}' | base64 -d; echo
flux get sources git
```

Verify: both point at `gitea.lab` and the Flux GitRepository shows Ready True with a commit SHA. Now you know the truth both engines reconcile from, and it is the same repo you just pushed to.

**Drift, the concept.** With nothing managing demo-app yet, apply it manually (`kubectl apply -k examples/demo-app/overlays/staging -n default` after creating the namespace it wants, or just note the rendered namespace). Scale it by hand. Ask: who notices? Nobody, and that is life before GitOps. Hold that thought for the drift-revert exercise in 2.2, where the same edit gets reverted in seconds.

## Docs to know your way around

- opengitops.dev: the four principles, quotable in exactly the form graders like
- kustomize.io: bases and overlays, patches
- argo-cd.readthedocs.io and fluxcd.io: each has a "core concepts" page worth ten minutes before the tool sections
