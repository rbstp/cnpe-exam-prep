# 4.4 Distributed tracing: OpenTelemetry and Jaeger

Competency: implementing tracing solutions (domain 4, 20%). Needs: `make up obs` (OTel operator and collector in `opentelemetry-operator-system`/`tracing`, Jaeger in `tracing`).

Tracing answers the one question metrics and logs cannot: where, along a request's path through many services, did the time go or the failure start. The vocabulary is small and the exam expects it exact.

## Vocabulary and plumbing

A trace is one request's journey; a span is one named, timed operation within it, carrying attributes and a parent span. Context propagation is what links spans across service boundaries: the caller sends the trace context in headers (W3C `traceparent` is the standard one), the callee continues the trace instead of starting a new one. Broken propagation is the classic failure: every service reports spans, and every span is its own orphan trace. When you see many one-span traces from an instrumented system, name that cause.

OpenTelemetry's pipeline: SDKs (or zero-code auto-instrumentation agents) produce telemetry, ship it over OTLP (gRPC 4317, HTTP 4318) to a Collector, which runs receivers → processors → exporters. The collector is the platform team's control point: sampling, batching, fan-out to backends happen there, not in application code. Jaeger is one such backend, storing and visualising traces.

Kubernetes-side, the OTel operator adds two CRDs: OpenTelemetryCollector (the lab's `otel-collector` deployment in `tracing` came from the operator or chart; read its config to see the receiver/exporter chain) and Instrumentation, the zero-code path: the lab ships one named `auto` in `default`, and annotating a pod spec with `instrumentation.opentelemetry.io/inject-java: "default/auto"` (or `-python`, `-nodejs`) makes a webhook inject the language agent at admission. Injection happens at pod *creation*, so existing pods must restart to pick it up; forgetting that looks like "the annotation does nothing".

## Exercises

**Read the collector's pipeline first.** `kubectl -n tracing get cm -o yaml | grep -A30 'receivers:'` (or the OpenTelemetryCollector CR if present). Draw the chain on paper: which receivers listen, which exporter points at Jaeger, what processors sit between. Verify: you can name the exact address an application in this cluster should send OTLP to (`otel-collector.tracing.svc:4317` or the HTTP twin). Every tracing task starts by knowing that address.

**Emit spans without an app.** telemetrygen is the collector project's own traffic generator, and it makes tracing exercises deterministic:

```bash
kubectl run telemetrygen --restart=Never \
  --image=ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:latest \
  -- traces --otlp-endpoint otel-collector.tracing.svc:4317 --otlp-insecure \
     --service curriculum-drill --traces 20 --child-spans 3
```

Verify in Jaeger (address from `make urls`): service `curriculum-drill` appears in the dropdown, 20 traces, each 4 spans deep. Then verify the API way, because exams grade with curl: `curl -s 'http://<jaeger>/api/traces?service=curriculum-drill&limit=1' | jq '.data[0].spans | length'` returns 4.

**Follow one trace like a root-cause hunt.** Open one trace, read the waterfall: parent/child structure, per-span duration, attributes on each span. Answer for that trace: which span is the critical path, and what would you look at next if the leaf span were slow (that span's service's logs, at that timestamp, and now you know why traces carry IDs you can grep logs for). That narration is what "trace analysis and root cause" means as a testable skill.

**Auto-instrument a real workload (stretch).** Run a small Java service (`ghcr.io/open-telemetry/opentelemetry-java-examples` images work, or any Spring Boot sample), annotate its pod template with `instrumentation.opentelemetry.io/inject-java: "default/auto"`, restart, and hit its endpoint. Verify: `kubectl describe pod` shows the injected init container, and the service appears in Jaeger with HTTP spans you never wrote. If it does not, the diagnostic ladder is: annotation on the *pod template* (not the Deployment metadata), pod restarted since annotating, Instrumentation CR namespace/name correct in the annotation value, operator webhook alive.

**Break propagation on paper.** No cluster needed: service A calls B through a proxy that strips unknown headers. Describe what Jaeger shows and which header must survive. If your answer names `traceparent` and predicts orphaned single-service traces, the concept is yours.

## Docs to know your way around

- opentelemetry.io: the Concepts pages (signals, context propagation) and the Kubernetes operator's Instrumentation injection docs
- jaegertracing.io: mostly the UI is self-explanatory; know that the HTTP API exists for scripted verification
