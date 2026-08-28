#!/usr/bin/env bash
# SPIFFE/SPIRE: workload identity, every workload gets its own SVID.
source "$(dirname "$0")/lib.sh"
need helm; need kubectl

NS="${SPIRE_NS:-spire}"
TRUST_DOMAIN="${TRUST_DOMAIN:-lab.local}"

log "Namespace $NS (privileged PSS: the agent needs hostPath + hostPID)"
kubectl create ns "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl label ns "$NS" \
  pod-security.kubernetes.io/enforce=privileged \
  pod-security.kubernetes.io/audit=privileged \
  pod-security.kubernetes.io/warn=privileged --overwrite >/dev/null

log "SPIRE CRDs"
repo_add spiffe https://spiffe.github.io/helm-charts-hardened
helmi spire-crds spiffe/spire-crds "$NS"

log "SPIRE server + agent + workload API CSI driver (trust domain: $TRUST_DOMAIN)"
helmi spire spiffe/spire "$NS" \
  --set global.spire.clusterName="$CLUSTER" \
  --set global.spire.trustDomain="$TRUST_DOMAIN" \
  --set spiffe-oidc-discovery-provider.enabled=false \
  --set spire-server.controllerManager.enabled=true

log "Waiting for the server and agents"
kubectl -n "$NS" rollout status statefulset/spire-server --timeout=8m || warn "spire-server slow"
kubectl -n "$NS" rollout status daemonset/spire-agent --timeout=8m || warn "spire-agent slow"

cat <<INFO

  Trust domain   spiffe://${TRUST_DOMAIN}
  Namespace      ${NS}

  Prove it works; every registration entry is an identity the server will issue:
    kubectl -n ${NS} exec -it statefulset/spire-server -c spire-server -- \\
      /opt/spire/bin/spire-server entry show
    kubectl -n ${NS} exec -it statefulset/spire-server -c spire-server -- \\
      /opt/spire/bin/spire-server healthcheck

  The self-service part (this is the bit worth practising, identity as a
  declarative platform API rather than a ticket):
    kubectl get clusterspiffeids
    kubectl explain clusterspiffeid.spec

  Give a workload an identity by writing a ClusterSPIFFEID selecting it, then
  mount the Workload API socket via the CSI driver:
    volumes:
      - name: spiffe
        csi:
          driver: csi.spiffe.io
          readOnly: true
    # then the app reads an SVID from /spiffe-workload-api/socket

  Drills:
    • Write a ClusterSPIFFEID that only matches pods with a given label, then
      confirm a non-matching pod gets NO identity.
    • Compare this with Istio's identity model on the mesh cluster: both issue
      per-workload mTLS certs, but SPIRE is the general-purpose issuer.
    • kubectl -n ${NS} logs statefulset/spire-server -c spire-server | grep -i attest

INFO
ok "SPIRE ready"
