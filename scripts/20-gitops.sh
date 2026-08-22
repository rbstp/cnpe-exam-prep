#!/usr/bin/env bash
# Domain 2 (25%): Argo CD, Flux, Argo Rollouts, Argo Workflows.
# The exam may hand you either Argo CD or Flux — install both, use both.
source "$(dirname "$0")/lib.sh"
need helm; need kubectl

log "Argo CD"
repo_add argo https://argoproj.github.io/argo-helm
helmi argocd argo/argo-cd argocd \
  --set configs.params."server\.insecure"=true \
  --set server.service.type=LoadBalancer \
  --set notifications.enabled=false \
  --set dex.enabled=false \
  --set applicationSet.replicas=1 \
  --set controller.metrics.enabled=true \
  --set server.metrics.enabled=true \
  --set repoServer.metrics.enabled=true
ARGO_PW=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || echo "<already rotated>")

log "Argo Rollouts (progressive delivery — blue/green + canary)"
helmi argo-rollouts argo/argo-rollouts argo-rollouts \
  --set dashboard.enabled=true --set dashboard.service.type=LoadBalancer

log "Argo Workflows (platform automation / orchestration, NOT CI)"
helmi argo-workflows argo/argo-workflows argo \
  --set 'server.authModes={server}' \
  --set server.serviceType=LoadBalancer \
  --set 'controller.workflowNamespaces={argo,default}'

log "Flux"
if ! kubectl get ns flux-system >/dev/null 2>&1; then
  flux install --components-extra=image-reflector-controller,image-automation-controller
else
  ok "flux-system already present"
fi

# Point Flux at the local Gitea repo so both controllers watch the same truth.
if [ -f "$REPO_ROOT/.gitea-token" ]; then
  log "Wiring Flux to gitea.lab/platform"
  kubectl -n flux-system create secret generic gitea-auth \
    --from-literal=username="$GITEA_USER" --from-literal=password="$GITEA_PASS" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl apply -f - >/dev/null <<YAML
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata: { name: platform, namespace: flux-system }
spec:
  interval: 1m
  url: http://${GITEA_HOST}:3000/${GITEA_USER}/platform.git
  ref: { branch: main }
  secretRef: { name: gitea-auth }
YAML
  ok "GitRepository/platform created — build Kustomizations on top of it"
fi

log "Registering the git repo with Argo CD"
kubectl -n argocd create secret generic gitea-repo \
  --from-literal=type=git \
  --from-literal=url="http://${GITEA_HOST}:3000/${GITEA_USER}/platform.git" \
  --from-literal=username="$GITEA_USER" \
  --from-literal=password="$GITEA_PASS" \
  --dry-run=client -o yaml | kubectl label -f - --local -o yaml \
  argocd.argoproj.io/secret-type=repository | kubectl apply -f - >/dev/null

cat <<INFO

  Argo CD    admin / ${ARGO_PW}
             kubectl -n argocd get svc argocd-server   (LoadBalancer IP)
             or: kubectl -n argocd port-forward svc/argocd-server 8081:80
             CLI: argocd login <ip> --username admin --password '${ARGO_PW}' --insecure

  Rollouts   kubectl argo rollouts dashboard   (or the LoadBalancer svc in argo-rollouts)
  Workflows  kubectl -n argo get svc argo-workflows-server
  Flux       flux get sources git ; flux get kustomizations

INFO
ok "GitOps layer ready"
