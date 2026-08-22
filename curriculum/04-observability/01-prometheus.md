# 4.1 Prometheus: collection and PromQL

Competency: implementing monitoring solutions (domain 4, 20%). Needs: `make up obs`.

The `obs` layer installs kube-prometheus-stack, which is three things people conflate: Prometheus itself, the Prometheus Operator that configures it through CRDs, and a bundle of exporters and dashboards. On the exam you work through the operator's CRDs, so that is the layer to be fluent in.

## The operator model

Prometheus scrapes targets on an interval and stores time series locally. What to scrape is declared, not configured: a ServiceMonitor says "scrape the endpoints of Services matching these labels, on this port name, at this path". PodMonitor does the same without a Service. The operator watches these CRDs and rewrites Prometheus's config live.

The gotcha that costs everyone their first hour on a stock kube-prometheus-stack: Prometheus only picks up ServiceMonitors matching its `serviceMonitorSelector`, which by default matches the Helm release label (`release: prometheus` here), and a perfectly correct monitor without that label is silently ignored. This lab deliberately disables that filter (`serviceMonitorSelectorNilUsesHelmValues=false`), so its selector is `{}` and every monitor everywhere is picked up. Both facts matter, and the durable habit is: read the selector *first*, then write the monitor. `kubectl -n monitoring get prometheus -o jsonpath='{.items[0].spec.serviceMonitorSelector}'` prints `{}` on this cluster and the release-label selector on a stock install, and that one command is the answer to "my target doesn't appear" everywhere, including the exam's cluster, whose selector you do not get to assume.

PromQL, the working subset. Instant vectors select current values (`up`, filtered by labels: `up{namespace="argocd"}`). Counters only ever climb, so you almost always want `rate(x_total[5m])` rather than the raw value. Aggregate with `sum by (label) (...)`. Histograms give you `histogram_quantile(0.95, sum by (le) (rate(x_bucket[5m])))`. Gauges you read directly. That is 90% of exam PromQL; the remaining 10% is arithmetic between vectors, which you used for the cost gap in section 1.5.

`up` deserves special respect: 1 per healthy target, 0 per failing one, which makes `count(up == 0)` the cluster's own health check. `make validate` runs exactly that query and demands zero; the lab even patched kubeadm's localhost-bound control-plane metrics to make it reachable (`make fix-cp-metrics` retrofits it, and the story is in the repo README).

## Exercises

Prometheus's UI address comes from `make urls`.

**Read the target map.** In the UI under Status → Targets, or via API: count the scrape pools, find which ServiceMonitor each corresponds to (`kubectl -n monitoring get servicemonitors`), and confirm zero targets down. Verify: `curl -s 'http://<prom>/api/v1/query?query=count(up==0)' | jq -r '.data.result[0].value[1] // "0"'` prints 0. If not, the down target's job name points at the responsible ServiceMonitor.

**Bring your own target, and hit the port-name gotcha on purpose.** Deploy an app that exposes metrics and monitor it, first wrong, then right:

```bash
kubectl create deploy example --image=quay.io/brancz/prometheus-example-app:v0.5.0 --port=8080
kubectl expose deploy example --port=8080 --name=example
kubectl apply -f - <<'EOF'
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata: { name: example, namespace: default }
spec:
  selector: { matchLabels: { app: example } }
  endpoints: [{ port: "8080" }]
EOF
```

Wait a minute, search Targets: nothing. The endpoint's `port` must be the Service's port *name*, and this Service has none, so the monitor matches the Service and then finds no endpoint. It fails silently, which is exactly why it is worth experiencing once. Fix it: patch the Service so the port is named (`kubectl patch svc example --type=json -p '[{"op":"add","path":"/spec/ports/0/name","value":"web"}]'`) and set `port: web` in the monitor. Verify: `up{job="example"}` returns 1 in the UI. Then add the `release: prometheus` label to your monitor anyway and confirm nothing changes here, while being able to say why it would be the difference between working and ignored on a stock install. Two failure modes, one of them live, both now yours.

**Query like the exam.** Generate a little traffic (`kubectl run curl --image=curlimages/curl:8.11.1 --restart=Never -- sh -c 'for i in $(seq 100); do curl -s example.default.svc:8080; done'`), then write, without copying: the request rate (`rate(http_requests_total{job="example"}[5m])`), summed by status code, and the p95 duration from `http_request_duration_seconds_bucket`. Verify: rates are non-zero and the quantile returns a number, not NaN. If it is NaN, reason about why (too few buckets observed yet); that reasoning is itself testable.

**Know what already exists.** Answer three questions using only metrics already collected: how many pods per namespace (`kube_pod_info`), which container restarts most (`kube_pod_container_status_restarts_total`), and each node's CPU pressure (`node_load1` vs allocatable). Verify: each answer is one query in the UI. kube-state-metrics and node-exporter are pre-installed sources the exam expects you to know exist.

## Docs to know your way around

- prometheus.io: querying basics and the function reference (`rate`, `histogram_quantile`)
- prometheus-operator.dev: the ServiceMonitor troubleshooting page, which is the release-label story in official form
