#!/usr/bin/env bash
# Domain 2 continued: Tekton (the exam's CI tool) + supply-chain scanning.
source "$(dirname "$0")/lib.sh"
need kubectl

log "Tekton Pipelines"
kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
log "Tekton Triggers (EventListener / TriggerBinding / TriggerTemplate)"
kubectl apply -f https://storage.googleapis.com/tekton-releases/triggers/latest/release.yaml
kubectl apply -f https://storage.googleapis.com/tekton-releases/triggers/latest/interceptors.yaml
log "Tekton Dashboard"
kubectl apply -f https://storage.googleapis.com/tekton-releases/dashboard/latest/release-full.yaml

for d in tekton-pipelines tekton-pipelines-resolvers; do
  kubectl -n "$d" wait --for=condition=Available deploy --all --timeout=6m 2>/dev/null || true
done

log "Exposing the Tekton dashboard"
kubectl -n tekton-pipelines patch svc tekton-dashboard \
  -p '{"spec":{"type":"LoadBalancer"}}' >/dev/null 2>&1 || true

log "Installing common Tekton Hub tasks (git-clone, kaniko, trivy)"
kubectl apply -f https://raw.githubusercontent.com/tektoncd/catalog/main/task/git-clone/0.9/git-clone.yaml 2>/dev/null || warn "git-clone task fetch failed"
kubectl apply -f https://raw.githubusercontent.com/tektoncd/catalog/main/task/kaniko/0.6/kaniko.yaml 2>/dev/null || warn "kaniko task fetch failed"

log "Trivy Operator (continuous image + config + RBAC scanning, SBOMs)"
repo_add aqua https://aquasecurity.github.io/helm-charts/
helmi trivy-operator aqua/trivy-operator trivy-system \
  --set="trivy.ignoreUnfixed=true" \
  --set="operator.scannerReportTTL=24h" \
  --set="operator.sbomGenerationEnabled=true" \
  --set="trivyOperator.scanJobTolerations[0].operator=Exists" \
  --set="nodeCollector.tolerations[0].operator=Exists"

cat <<'INFO'

  Tekton     tkn task ls ; tkn pipeline ls ; tkn pipelinerun logs -f
             dashboard: kubectl -n tekton-pipelines get svc tekton-dashboard
  Trivy      kubectl get vulnerabilityreports -A
             kubectl get configauditreports -A
             kubectl get sbomreports -A
             kubectl get rbacassessmentreports -A

INFO
ok "CI/CD + scanning layer ready"
