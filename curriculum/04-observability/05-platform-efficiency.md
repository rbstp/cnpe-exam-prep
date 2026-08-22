# 4.5 Platform efficiency: deployment metrics and performance indicators

Competency: measuring and improving platform efficiency using deployment metrics and performance indicators (domain 4, 20%). Needs: `make core obs`, with the 2.2 applications deployed.

This is the competency people skip because it sounds like management material, and then it costs them, because it is eminently testable: "write a query showing deployment frequency" is a concrete task. The trick is knowing which existing metrics stand in for which indicator.

## The indicators worth naming

The DORA four, from the white paper's measurement section: deployment frequency, lead time for changes, time to restore service, change failure rate. Alongside them, the paper's platform-specific measures: latency from request to fulfillment of a capability (how long from XR applied to namespace ready), time to first contribution, and adoption. You will not compute all of these in a lab, but you should be able to say, for each, which system holds the raw data: deployment frequency lives in the CD tool, lead time spans git and CD, restore time lives in alerting/incident data, failure rate in rollout outcomes.

In an Argo CD shop, the controller's own metrics are the deployment data: `argocd_app_sync_total` (a counter per app with a `phase` label: Succeeded, Failed, Error) and `argocd_app_info` (current sync/health status as labels). Argo CD exposes them but this Prometheus does not scrape them until someone says so. That someone is you, below, and the wiring *is* the exercise: "measure platform efficiency" in practice means plumbing the delivery tool's metrics into the monitoring stack and querying them.

Efficiency of the platform itself is the other half: workload restart rates (`kube_pod_container_status_restarts_total`), pods not at desired replicas (`kube_deployment_status_replicas_unavailable`), and the request/usage gap from section 1.5. Deployment metrics tell you the platform ships fast; these tell you it runs what it shipped.

## Exercises

**Scrape the delivery system.** Discover what Argo CD exposes, then monitor it:

```bash
kubectl -n argocd get svc | grep metrics
```

Three metrics services (application controller, server, repo server). The lab's `gitops` layer enables them; if the grep comes back empty on an older install, that is your first finding, and `helm -n argocd upgrade argocd argo/argo-cd --reuse-values --set controller.metrics.enabled=true --set server.metrics.enabled=true --set repoServer.metrics.enabled=true` is the fix, itself a fair exam-shaped task. Write one ServiceMonitor per service you care about; the controller's is the one with sync metrics. Template, adjust the selector labels to what the discovered Service actually carries:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: argocd-controller
  namespace: monitoring
  labels: { release: prometheus }
spec:
  namespaceSelector: { matchNames: [argocd] }
  selector: { matchLabels: { app.kubernetes.io/name: argocd-metrics } }
  endpoints: [{ port: http-metrics }]
```

That endpoint port is `http-metrics` because that is what the Service names it, not because anyone would guess it: `kubectl -n argocd get svc argocd-application-controller-metrics -o jsonpath='{.spec.ports[*].name}'` is the thirty-second check that beats an hour of "why is there no target". Verify: `argocd_app_info` returns rows in the Prometheus UI within a couple of minutes. Everything you learned in 4.1 about selectors and port names applies; this exercise is deliberately a rerun of those skills against an unfamiliar target.

**Compute three indicators.** With sync activity from your 2.2/2.6 work in the counters (trigger a couple of `argocd app sync demo-staging` runs if the range is empty):

- Deployment frequency: `sum(increase(argocd_app_sync_total{phase="Succeeded"}[24h]))`
- Change failure rate: `sum(increase(argocd_app_sync_total{phase=~"Failed|Error"}[24h])) / sum(increase(argocd_app_sync_total[24h]))`
- Currently-degraded apps (a time-to-restore ingredient): `count(argocd_app_info{health_status!="Healthy"}) or vector(0)`

Verify: numbers that match reality; cross-check the first against `argocd app history demo-staging`. Then push one bad image tag (the 2.6 drill), sync, revert, and watch the failure rate query move. A metric you have personally made move is a metric you understand.

**Fulfillment latency for a platform API.** Measure the white paper's "request to fulfillment" for the lab's own self-service path: apply a fresh `AppEnvironment` XR (section 3.5) and time from apply to Ready condition using its `lastTransitionTime`:

```bash
kubectl get appenvironment <name> -o jsonpath='{.status.conditions[?(@.type=="Ready")].lastTransitionTime}'
```

against the object's `metadata.creationTimestamp`. Verify: a number in seconds, and an opinion about whether it is good. (Sub-minute for namespace-and-quota is; if it took five, something reconciled slowly and section 3.5's trace command finds what.)

**Turn one indicator into an alert.** The bridge to 4.2: a PrometheusRule that fires when any app stays non-Healthy for 10 minutes (`count(argocd_app_info{health_status!="Healthy"}) > 0`, `for: 10m`). Verify with the bad-image trick, then clean up. Congratulations, you have built the platform team's actual pager.

## Docs to know your way around

- argo-cd.readthedocs.io: the metrics page (metric names and labels)
- dora.dev: definitions, one page each; the exam-usable summaries
