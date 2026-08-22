# 3.5 Crossplane: compositions as platform APIs

Competency: using automation frameworks for self-service provisioning (domain 3, 25%). Needs: `make up api`.

Crossplane is the control-plane way to build the abstraction from section 3.1: you define a new API (XRD), write the recipe that expands it into real resources (Composition), and developers create instances (XR) that reconcile forever like any operator-managed object. The lab's three files in `examples/crossplane/` are one complete platform API: `AppEnvironment` in, namespace plus quota out.

## The v2 model, because versions matter here

This lab runs Crossplane v2 and the differences from v1 content you may find online are exactly the things that will bite: XRs can be namespaced (`spec.scope: Namespaced` in the XRD), claims are gone (developers create the XR directly), and compositions are function pipelines (`mode: Pipeline`) rather than the old inline patch lists. When any doc or LLM output disagrees with the cluster, the cluster wins: `kubectl explain composition.spec` settles it.

The chain, walk it in the files: `xrd.yaml` defines schema and names for `AppEnvironment` (this is what generated the CRD you inspected in 3.2). `composition.yaml` declares `compositeTypeRef` back to that kind, then a pipeline: `function-patch-and-transform` renders two provider-kubernetes `Object`s (one wrapping a Namespace, one a ResourceQuota) with `FromCompositeFieldPath` patches pulling `spec.team` and the quota fields from the XR, plus one `ToCompositeFieldPath` patch flowing the namespace name back into XR status. `function-auto-ready` marks the XR Ready when its composed resources are. `xr.yaml` is the ten-line developer experience the other two files buy.

Two gotchas the lab already paid for, both in the file comments and the repo README: a namespaced XR may not compose cluster-scoped resources, so the composition uses the *namespaced* Object variant (`kubernetes.m.crossplane.io`, not `kubernetes.crossplane.io`) even though the manifest inside it is a cluster-scoped Namespace; and that namespaced variant authenticates via `ClusterProviderConfig`, not `ProviderConfig`. Wrong-variant errors read as `cannot apply cluster scoped composed resource`, and now you have seen the sentence before the exam has.

Package health is step zero of any Crossplane diagnosis: `kubectl get providers.pkg.crossplane.io,functions.pkg.crossplane.io` must all be Installed and Healthy before anything downstream can work.

## Exercises

**Consume the platform API as a developer.** `kubectl apply -f examples/crossplane/xr.yaml` (or confirm `team-c-dev` exists from install), then trace the expansion:

```bash
kubectl get appenvironment team-c-dev -o jsonpath='{.status.conditions}' | jq
kubectl get appenvironment team-c-dev -o jsonpath='{.status.namespace}{"\n"}'
kubectl -n default get objects.kubernetes.m.crossplane.io
kubectl get ns team-c && kubectl -n team-c get resourcequota tenant-quota -o jsonpath='{.spec.hard}'
```

Verify: Ready True, status.namespace says team-c, two composed Objects, and the quota's hard values match the XR's spec (`cpuQuota: "4"`), not the composition's placeholders. That last check proves the patches ran, which is the difference between "installed" and "works".

**Change the API's behaviour, not the API.** Edit the composition to also set `requests.memory` default differently or to add a label to the namespace, apply, and watch existing XRs reconcile to the new recipe without anyone touching them. Verify: `kubectl get ns team-c --show-labels` gains your label within a minute. Compositions are the platform team's side of the contract; this exercise is why that separation matters.

**Extend the contract end to end.** Add `podQuota` (integer, default 10) to the XRD schema, patch it into the quota's `spec.hard[pods]` in the composition, and set it in a new XR `team-f-dev`. Order matters: XRD first, wait `Established`, then composition, then XR. Verify: `kubectl -n team-f get resourcequota tenant-quota -o jsonpath='{.spec.hard.pods}'` prints your number. You have now done a schema change, a recipe change, and a consumer change as three separate actors, which is the whole platform-API workflow.

**Diagnose a broken XR.** Create an XR with `team: Team-G` (capital letter, invalid DNS label for a namespace). The XR will not go Ready. Find the failure without guessing: XR conditions first, then the composed Object's conditions (`kubectl -n default get objects.kubernetes.m.crossplane.io -o yaml | grep -A3 message`), where the API server's rejection of the namespace name surfaces. `crossplane resource trace appenvironment <name>` (the CLI is installed) draws the whole tree with statuses in one shot. Verify: you can point at the exact condition message and fix the XR. Failure bubbles bottom-up through composed-resource conditions; that is the read-path for every Crossplane incident.

## Docs to know your way around

- docs.crossplane.io: Composite Resource Definitions, Compositions (the function pipeline page), and provider-kubernetes's Object documentation on the Upbound marketplace
- `crossplane resource trace --help`, the single most useful diagnostic in the ecosystem
