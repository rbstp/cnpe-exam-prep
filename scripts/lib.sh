#!/usr/bin/env bash
# Shared helpers. Source, don't execute.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# lab.env holds your local settings and is gitignored, so a fresh clone has none.
# Fail with instructions rather than sourcing nothing and producing confusing
# errors three scripts later.
if [ ! -f "$REPO_ROOT/lab.env" ]; then
  printf '\033[31m ✗ \033[0m %s\n' "no lab.env found in $REPO_ROOT" >&2
  printf '     %s\n' "Create one from the template, then re-run:" >&2
  printf '     %s\n' "  cp lab.env.example lab.env" >&2
  printf '     %s\n' "  \$EDITOR lab.env        # set GITEA_PASS" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$REPO_ROOT/lab.env"

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_INFO=$'\033[36m'; C_OFF=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s ok %s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s  ! %s %s\n' "$C_WARN" "$C_OFF" "$*"; }
die()  { printf '%s ✗  %s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1'; run: make tools"; }

kctx() { kubectl --context "kind-${1:-$CLUSTER}" "${@:2}"; }

# helm upgrade --install, idempotent, waits
helmi() {
  local release="$1" chart="$2" ns="$3"; shift 3
  helm --kube-context "kind-$CLUSTER" upgrade --install "$release" "$chart" \
    --namespace "$ns" --create-namespace --wait --timeout 12m "$@"
}

repo_add() { helm repo add "$1" "$2" >/dev/null 2>&1 || true; }

wait_rollout() {
  local ns="$1"; shift
  kubectl --context "kind-$CLUSTER" -n "$ns" rollout status "$@" --timeout=10m
}

# poll <timeout-seconds> <what> <predicate...>: re-run the predicate until it
# succeeds or the timeout passes. Returns 1 on timeout but only warns, because
# the break drill keeps going either way and the learner can inspect by hand.
poll() {
  local t="$1" what="$2"; shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    waited=$((waited+3))
    if [ "$waited" -ge "$t" ]; then
      warn "timed out after ${t}s waiting for $what"
      return 1
    fi
    sleep 3
  done
}

cluster_exists() { kind get clusters 2>/dev/null | grep -qx "$1"; }
