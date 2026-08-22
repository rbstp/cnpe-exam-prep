#!/usr/bin/env bash
# Domain 5: secure service-to-service. Runs on the SECOND cluster so a broken
# mesh never costs you your main lab state. Istio by default; MESH=linkerd works.
source "$(dirname "$0")/lib.sh"
need kind; need kubectl; need helm
MESH="${MESH:-istio}"

if ! cluster_exists "$MESH_CLUSTER"; then
  log "Creating '$MESH_CLUSTER' cluster"
  # Pin the same node image as the main cluster, otherwise the mesh cluster runs
  # whatever the installed kind defaults to and the two disagree on k8s version.
  sed "s|__IMAGE__|$K8S_IMAGE|g" "$REPO_ROOT/kind/mesh.yaml" > /tmp/cnpe-lab/kind-$MESH_CLUSTER.yaml
  kind create cluster --config /tmp/cnpe-lab/kind-$MESH_CLUSTER.yaml --wait 90s
fi
CTX="kind-$MESH_CLUSTER"
kubectl config use-context "$CTX" >/dev/null

log "Gateway API CRDs"
kubectl --context "$CTX" apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.1/standard-install.yaml

case "$MESH" in
  istio)
    need istioctl
    log "Installing Istio (ambient mode)"
    istioctl install --context "$CTX" --set profile=ambient --skip-confirmation
    log "Labelling default namespace into the mesh"
    kubectl --context "$CTX" label ns default istio.io/dataplane-mode=ambient --overwrite
    cat <<'X'

  Drills:
    istioctl x ztunnel-config workload
    kubectl apply -f https://raw.githubusercontent.com/istio/istio/master/samples/bookinfo/platform/kube/bookinfo.yaml
    # then: PeerAuthentication STRICT, AuthorizationPolicy allow-only-frontend,
    #       a Gateway + HTTPRoute, and an L7 waypoint:
    istioctl waypoint apply -n default --enroll-namespace
X
    ;;
  linkerd)
    need linkerd
    log "Installing Linkerd"
    linkerd --context "$CTX" install --crds | kubectl --context "$CTX" apply -f -
    linkerd --context "$CTX" install | kubectl --context "$CTX" apply -f -
    linkerd --context "$CTX" check
    linkerd --context "$CTX" viz install | kubectl --context "$CTX" apply -f -
    ;;
  *) die "MESH must be istio or linkerd" ;;
esac

log "Flagger (progressive delivery driven by the mesh)"
repo_add flagger https://flagger.app
helm --kube-context "$CTX" upgrade --install flagger flagger/flagger \
  --namespace "$([ "$MESH" = istio ] && echo istio-system || echo linkerd)" \
  --create-namespace --set meshProvider="$MESH" \
  --set metricsServer="http://prometheus:9090" --wait --timeout 8m \
  || warn "flagger needs a Prometheus in this cluster — install kube-prometheus-stack here too if you want metric-driven canaries"

kubectl config use-context "kind-$CLUSTER" >/dev/null
ok "Mesh cluster ready (context: $CTX). Switch with: kubectl config use-context $CTX"
