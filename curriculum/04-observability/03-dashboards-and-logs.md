# 4.3 Grafana dashboards and Loki logs

Competency: implementing logging solutions and dashboards that provide actionable insight (domain 4, 20%). Needs: `make up obs`.

Grafana is the pane of glass over both halves of this section: Prometheus metrics through dashboards, Loki logs through Explore. Credentials are genuinely admin/admin here; address from `make urls`.

## Dashboards as code

The exam-relevant fact about Grafana in a kube-prometheus-stack world is that dashboards are provisioned, not clicked together. A sidecar container in the Grafana pod watches for ConfigMaps labelled `grafana_dashboard: "1"`, and loads any dashboard JSON it finds inside. That is why the stack's forty-odd dashboards exist without anyone importing them, and it is how *you* ship a dashboard in a GitOps world: JSON in a ConfigMap in a git repo. Datasources provision the same way with `grafana_datasource: "1"`.

What makes a dashboard actionable rather than decorative, in one paragraph you can reuse in written answers: it leads with the user-facing symptom (rate, errors, duration for services; the USE trio of utilization, saturation, errors for resources), it templates over a variable (`$namespace`) instead of hardcoding, and every panel answers a question someone would actually ask during an incident. Forty panels of everything is a wall, not a dashboard.

## Loki and LogQL

Loki indexes labels, not content: log lines are stored against a small label set (namespace, pod, container) and content matching happens at query time. Cheap to run, and it means your queries must always start from a label selector before filtering. Collection here is Alloy, a single-replica deployment in `monitoring` that tails every pod through the kubelet API and pushes to Loki; Loki itself stores them as a StatefulSet next door. Two hops, and `make validate` now proves the pair works by demanding Loki actually returns streams, because a running Loki with no shipper looks healthy and holds nothing.

LogQL reads like PromQL holding a grep: `{namespace="team-a"}` streams, `|= "error"` filters, `| json` parses, and metric queries wrap streams: `sum by (pod) (rate({namespace="team-a"} |= "error" [5m]))` turns logs into a graphable error rate. Those four constructs cover exam depth.

For quick terminal work, `stern <pattern> -n <ns>` tails many pods at once and is often faster than a UI round trip.

## Exercises

**Wire the Loki datasource if it is missing.** In Grafana: Connections → Data sources. If Loki is not there, add it the provisioned way rather than the UI way:

```bash
kubectl -n monitoring apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: loki-datasource
  labels: { grafana_datasource: "1" }
data:
  loki.yaml: |
    apiVersion: 1
    datasources:
      - name: Loki
        type: loki
        url: http://loki.monitoring.svc:3100
        access: proxy
EOF
```

The sidecar picks it up within a minute or so. Verify: Explore → Loki → `{namespace="monitoring"}` returns log lines. If nothing arrives, bisect the two hops: shipper first (`kubectl -n monitoring get deploy alloy`, then its logs for push errors), Loki second. Being able to say *which* hop is broken is the exercise inside the exercise.

**Query logs like an incident.** Generate known lines, then find them:

```bash
kubectl -n team-a run chatty --image=busybox:1.37 --restart=Never -- \
  sh -c 'for i in $(seq 60); do echo "level=error msg=payment_failed attempt=$i"; sleep 1; done'
```

In Explore: `{namespace="team-a"} |= "payment_failed"`, then the metric form `sum(rate({namespace="team-a"} |= "payment_failed" [1m]))`. Verify: lines visible and the rate curve is about 1/s while the pod runs. Compare `stern chatty -n team-a` for the same lines live.

**Provision a dashboard as code.** Build one panel in the UI first (New dashboard → add visualization → Prometheus → `sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))`), then export its JSON (share → Export → save JSON, set "export for sharing externally" off), and re-deliver it properly:

```bash
kubectl -n monitoring create configmap team-cpu-dashboard --from-file=dash.json=<your-file> \
  --dry-run=client -o yaml | kubectl label -f - --local --dry-run=client -o yaml grafana_dashboard=1 | kubectl apply -f -
```

Verify: delete the hand-made dashboard in the UI, and the provisioned copy appears (default folder) and survives a Grafana pod delete, which the clicked one would not have. State the GitOps moral in one sentence.

**Read one stock dashboard critically.** Open "Kubernetes / Compute Resources / Namespace (Pods)" for `team-a` while the chatty pod runs. Answer: which panels are RED, which are USE, and which single panel would you keep if you could keep one during a pod-crash incident. There is no single right answer; having *an* answer with a reason is the skill the "actionable insights" wording points at.

## Docs to know your way around

- grafana.com/docs: provisioning (datasources and dashboards), LogQL reference
- The Explore UI's query builder doubles as LogQL documentation under time pressure
