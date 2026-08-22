# 2.5 Progressive delivery: canary, blue-green, and the mesh

Competency: deploying applications using progressive delivery strategies (domain 2, 25%). Needs: `make core obs` (the canary's analysis queries Prometheus). The Flagger exercise adds `make mesh`.

Progressive delivery is a Deployment with a spine: new version goes to a slice of traffic, something measures whether it is worse, and the rollout continues or reverses based on evidence instead of hope. The two strategies to know cold: canary (shift traffic in steps, watch metrics between steps) and blue-green (run both versions full-size, cut over at once, keep the old one warm for instant rollback).

## Argo Rollouts

A Rollout is a Deployment with `spec.strategy` swapped for something richer. Canary strategy is a list of steps: `setWeight`, `pause` (with or without duration; without means wait for a human), and `analysis` (run an AnalysisTemplate and act on the result). Blue-green strategy is two Services (active and preview) plus `autoPromotionEnabled`.

`examples/rollouts/canary.yaml` is the whole pattern in one file: an AnalysisTemplate that queries the lab's Prometheus for a success rate, and a Rollout whose steps gate on it with `failureLimit: 1`, meaning one bad measurement aborts and rolls back on its own. The controller lives in `argo-rollouts` and does the measuring itself, so tenant NetworkPolicies never touch the metric path.

Verbs you will actually use, via the kubectl plugin: `kubectl argo rollouts get rollout demo -n team-a --watch`, `set image`, `promote`, `abort`, `undo`, `status`. The watch view is the best mental model builder in this whole domain: you see the stable and canary ReplicaSets, the current step, and the analysis runs as they happen.

## Flagger, for contrast

Flagger (on the mesh cluster, `kind-mesh` context) inverts the authoring model: you keep a plain Deployment and Flagger's Canary CR generates the primary/canary pairs and shifts real traffic through the mesh. Argo Rollouts without a traffic provider only shifts by replica ratio; Flagger with Istio shifts by route weight, which is finer and independent of replica count. That distinction, replica-weight vs route-weight, is the sentence to remember about mesh integration.

## Exercises

**Run the canary and watch it pass.**

```bash
kubectl apply -f examples/rollouts/canary.yaml
kubectl argo rollouts get rollout demo -n team-a --watch
```

First rollout of a new Rollout goes straight to healthy (nothing to compare against). Now change the image to trigger a real canary, in a second terminal:

```bash
kubectl argo rollouts set image demo web=ghcr.io/nginxinc/nginx-unprivileged:1.28-alpine -n team-a
```

Verify: the watch shows the canary ReplicaSet appear, weight steps advance, and the AnalysisRun tick. Check the analysis itself: `kubectl -n team-a get analysisrun` and read one with `-o yaml`; the measured value and the success condition are both in status. If the analysis errors because the demo app exposes no `http_requests_total`, that is faithful to production life; read the AnalysisRun error, then either drive traffic that produces the metric or loosen the query, and understand that an *erroring* analysis is treated per `failureLimit` too.

**Abort and roll back.** Trigger another image change, and while it pauses: `kubectl argo rollouts abort demo -n team-a`. Verify: status Degraded with the stable image still serving, then `kubectl argo rollouts undo demo -n team-a` and confirm Healthy. The pair (abort, undo) is your incident lever during a bad release, and it is exactly what an exam task means by "safely roll back".

**Convert canary to blue-green.** Rewrite the Rollout: strategy `blueGreen`, two Services (`demo-active`, `demo-preview`, both selecting `app: demo`), `autoPromotionEnabled: false`. Push a new image and inspect both Services' `spec.selector` before and after `kubectl argo rollouts promote demo -n team-a`. Verify: before promotion the preview Service selector carries the new ReplicaSet's pod-template-hash while active still points at the old one; after promotion both point at the new. That selector flip *is* blue-green; if you can narrate it, you understand the strategy.

**Flagger on the mesh.** Flagger is on the exam's tool list, so this one is not optional. On `kind-mesh` (`kubectx kind-mesh`): deploy podinfo and Flagger's loadtester (both from Flagger's podinfo tutorial manifests), then write a Canary CR targeting the podinfo Deployment with `provider: istio`. One lab-specific honesty clause before you copy the tutorial's analysis block: this cluster runs no Prometheus, and `make mesh` wires Flagger at a metrics address that does not exist, so the built-in `request-success-rate` metric check can never pass. Build the analysis from webhooks only: a `load-test` webhook against the loadtester (`http://flagger-loadtester.test/`) to generate traffic, and if you want a gate, a `pre-rollout` acceptance webhook. Then bump the podinfo image and watch `kubectl describe canary podinfo` events walk the weights up. Verify: the Canary reaches Succeeded (`kubectl get canary -A`), and while it runs, `kubectl get virtualservice podinfo -o yaml` shows Flagger moving real route weights between primary and canary. That route-weight movement, versus Rollouts' replica ratios on the main cluster, is the compare-and-contrast this section exists for. If the Canary sticks in Progressing, its events name the failing check, which is precisely the diagnostic loop a Flagger exam task would hand you.

## Docs to know your way around

- argo-rollouts.readthedocs.io: canary and blueGreen strategy references, AnalysisTemplate spec, the kubectl plugin page
- flagger.app: the Istio canary tutorial
