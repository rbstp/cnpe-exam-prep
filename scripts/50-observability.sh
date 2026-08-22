#!/usr/bin/env bash
# Domain 4 (20%): Prometheus, Grafana, OTel, Jaeger, OpenCost, logs.
source "$(dirname "$0")/lib.sh"
need helm; need kubectl

log "kube-prometheus-stack (Prometheus Operator CRDs, Alertmanager, Grafana)"
repo_add prometheus-community https://prometheus-community.github.io/helm-charts
helmi prometheus prometheus-community/kube-prometheus-stack monitoring \
  --set grafana.service.type=LoadBalancer \
  --set grafana.adminPassword=admin \
  --set prometheus.service.type=LoadBalancer \
  --set prometheus.prometheusSpec.retention=6h \
  --set prometheus.prometheusSpec.resources.requests.memory=512Mi \
  --set 'prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false' \
  --set 'prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false' \
  --set 'prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues=false' \
  --set prometheus.prometheusSpec.enableRemoteWriteReceiver=true \
  --set prometheus.prometheusSpec.enableFeatures={otlp-write-receiver}

log "Jaeger all-in-one (memory storage — light enough for a laptop)"
kubectl create ns tracing --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n tracing apply -f - <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata: { name: jaeger, labels: { app: jaeger } }
spec:
  replicas: 1
  selector: { matchLabels: { app: jaeger } }
  template:
    metadata: { labels: { app: jaeger } }
    spec:
      containers:
        - name: jaeger
          image: jaegertracing/jaeger:2.20.0
          env:
            - { name: COLLECTOR_OTLP_ENABLED, value: "true" }
          ports:
            - { containerPort: 16686, name: ui }
            - { containerPort: 4317,  name: otlp-grpc }
            - { containerPort: 4318,  name: otlp-http }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 1Gi }
---
apiVersion: v1
kind: Service
metadata: { name: jaeger }
spec:
  type: LoadBalancer
  selector: { app: jaeger }
  ports:
    - { name: ui,        port: 16686, targetPort: 16686 }
    - { name: otlp-grpc, port: 4317,  targetPort: 4317 }
    - { name: otlp-http, port: 4318,  targetPort: 4318 }
YAML

log "OpenTelemetry Operator (auto-instrumentation + Collector CRDs)"
repo_add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helmi opentelemetry-operator open-telemetry/opentelemetry-operator opentelemetry-operator-system \
  --set "manager.collectorImage.repository=otel/opentelemetry-collector-contrib" \
  --set admissionWebhooks.certManager.enabled=false \
  --set admissionWebhooks.autoGenerateCert.enabled=true

log "Collector pipeline: OTLP in → Jaeger (traces) + Prometheus (metrics)"
kubectl -n tracing apply -f - <<'YAML'
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata: { name: otel, namespace: tracing }
spec:
  mode: deployment
  config:
    receivers:
      otlp:
        protocols:
          grpc: { endpoint: 0.0.0.0:4317 }
          http: { endpoint: 0.0.0.0:4318 }
    processors:
      batch: { timeout: 5s }
      k8sattributes: {}
    exporters:
      otlp/jaeger:
        endpoint: jaeger.tracing.svc.cluster.local:4317
        tls: { insecure: true }
      otlphttp/prom:
        endpoint: http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090/api/v1/otlp
        tls: { insecure: true }
      debug: { verbosity: basic }
    service:
      pipelines:
        traces:  { receivers: [otlp], processors: [k8sattributes, batch], exporters: [otlp/jaeger] }
        metrics: { receivers: [otlp], processors: [batch], exporters: [otlphttp/prom] }
        logs:    { receivers: [otlp], processors: [batch], exporters: [debug] }
YAML

log "Auto-instrumentation resource (zero-code tracing — annotate a pod to use it)"
kubectl apply -f - <<'YAML'
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata: { name: auto, namespace: default }
spec:
  exporter: { endpoint: http://otel-collector.tracing.svc:4318 }
  propagators: [tracecontext, baggage]
  sampler: { type: parentbased_traceidratio, argument: "1" }
YAML

log "Loki + Alloy (logs)"
repo_add grafana https://grafana.github.io/helm-charts
helmi loki grafana/loki monitoring \
  --set deploymentMode=SingleBinary \
  --set loki.auth_enabled=false \
  --set loki.commonConfig.replication_factor=1 \
  --set loki.storage.type=filesystem \
  --set loki.schemaConfig.configs[0].from=2024-04-01 \
  --set loki.schemaConfig.configs[0].store=tsdb \
  --set loki.schemaConfig.configs[0].object_store=filesystem \
  --set loki.schemaConfig.configs[0].schema=v13 \
  --set loki.schemaConfig.configs[0].index.prefix=index_ \
  --set loki.schemaConfig.configs[0].index.period=24h \
  --set singleBinary.replicas=1 \
  --set read.replicas=0 --set write.replicas=0 --set backend.replicas=0 \
  --set chunksCache.enabled=false --set resultsCache.enabled=false \
  --set lokiCanary.enabled=false --set test.enabled=false \
  || warn "Loki install failed — optional, skip it if tight on CPU"

# Loki without a shipper is a database with no writers. Alloy tails every pod
# through the kubelet API (one replica is enough for a lab) and pushes to Loki.
log "Alloy (ships pod logs into Loki)"
cat > /tmp/cnpe-lab/alloy-values.yaml <<'VALUES'
controller:
  type: deployment
  replicas: 1
alloy:
  configMap:
    content: |
      discovery.kubernetes "pods" {
        role = "pod"
      }
      discovery.relabel "pods" {
        targets = discovery.kubernetes.pods.targets
        rule {
          source_labels = ["__meta_kubernetes_namespace"]
          target_label  = "namespace"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_name"]
          target_label  = "pod"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_container_name"]
          target_label  = "container"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_label_app"]
          target_label  = "app"
        }
      }
      loki.source.kubernetes "pods" {
        targets    = discovery.relabel.pods.output
        forward_to = [loki.write.local.receiver]
      }
      loki.write "local" {
        endpoint {
          url = "http://loki.monitoring.svc:3100/loki/api/v1/push"
        }
      }
VALUES
helmi alloy grafana/alloy monitoring -f /tmp/cnpe-lab/alloy-values.yaml \
  || warn "Alloy install failed — Loki will hold no logs until a shipper exists"

log "OpenCost (cost allocation from Prometheus metrics)"
repo_add opencost-charts https://opencost.github.io/opencost-helm-chart
helmi opencost opencost-charts/opencost opencost \
  --set opencost.prometheus.internal.namespaceName=monitoring \
  --set opencost.prometheus.internal.serviceName=prometheus-kube-prometheus-prometheus \
  --set opencost.prometheus.internal.port=9090 \
  --set opencost.metrics.kubeStateMetrics.emitKsmV1Metrics=false \
  --set opencost.metrics.kubeStateMetrics.emitKsmV1MetricsOnly=true \
  --set opencost.ui.enabled=true \
  --set service.type=LoadBalancer

cat <<'INFO'

  Grafana    admin / admin        kubectl -n monitoring get svc prometheus-grafana
  Prometheus                      kubectl -n monitoring get svc prometheus-kube-prometheus-prometheus
  Jaeger UI                       kubectl -n tracing get svc jaeger        (port 16686)
  OpenCost                        kubectl -n opencost get svc opencost     (UI on 9090)
                                  kubectl cost --opencost namespace --show-all-resources

  Drill: annotate a deployment to get traces with zero code changes —
    kubectl patch deploy/<name> -p \
      '{"spec":{"template":{"metadata":{"annotations":{"instrumentation.opentelemetry.io/inject-java":"default/auto"}}}}}'

INFO
ok "Observability layer ready"
