#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
MODE="${1:-clusters}"
case "$MODE" in
  clusters)
    log "Deleting kind clusters"
    kind delete cluster --name "$CLUSTER" 2>/dev/null || true
    kind delete cluster --name "$MESH_CLUSTER" 2>/dev/null || true
    if [ -f /tmp/cnpe-lab/cpk.pid ]; then
      CPK_PID=$(cat /tmp/cnpe-lab/cpk.pid 2>/dev/null || true)
      if [ -n "${CPK_PID:-}" ] && kill -0 "$CPK_PID" 2>/dev/null; then
        sudo kill "$CPK_PID" 2>/dev/null && ok "stopped cloud-provider-kind (pid $CPK_PID)" || true
      fi
      rm -f /tmp/cnpe-lab/cpk.pid
    else
      warn "no /tmp/cnpe-lab/cpk.pid; if cloud-provider-kind is running, stop it yourself"
    fi
    ok "clusters gone; gitea + registry kept (your git history survives)"
    ;;
  all)
    "$0" clusters
    log "Removing gitea and registry"
    docker rm -f gitea "$REGISTRY_NAME" 2>/dev/null || true
    docker volume rm gitea-data 2>/dev/null || true
    rm -f "$REPO_ROOT/.gitea-token" "$REPO_ROOT/.gitea-info"
    ok "everything removed (images cached; 'docker system prune -a' to reclaim disk)"
    ;;
  *) die "usage: 99-down.sh [clusters|all]" ;;
esac
