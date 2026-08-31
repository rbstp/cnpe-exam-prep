#!/usr/bin/env bash
# Shared helpers. Source, don't execute.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

# record_versions <jq filter> [jq args...]
record_versions() {
  local filter="$1"; shift
  local file="$REPO_ROOT/.lab-versions.json" tmp base
  command -v jq >/dev/null || return 0
  if [ -s "$file" ]; then
    base=$(cat "$file")
  else
    base=$(jq -n --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{generated_at: $generated_at, tools: []}')
  fi
  tmp="$file.tmp"
  printf '%s' "$base" | jq "$@" "$filter" > "$tmp"
  mv "$tmp" "$file"
}

record_image() {
  record_versions '.images = ((.images // {}) + {($name): $reference})' \
    --arg name "$1" --arg reference "$2"
}

record_chart() {
  record_versions '.charts = ((.charts // {}) + {($release): {chart: $chart, version: $version, app_version: $app_version}})' \
    --arg release "$1" --arg chart "$2" --arg version "$3" --arg app_version "$4"
}

kctx() { kubectl --context "kind-${1:-$CLUSTER}" "${@:2}"; }

helmi() {
  local release="$1" chart="$2" ns="$3" metadata chart_version app_version; shift 3
  metadata=$(helm show chart "$chart")
  chart_version=$(printf '%s\n' "$metadata" | awk -F ': ' '$1 == "version" {print $2; exit}')
  [ -n "$chart_version" ] || die "could not resolve a version for Helm chart '$chart'"
  app_version=$(printf '%s\n' "$metadata" | awk -F ': ' '$1 == "appVersion" {print $2; exit}')

  # Callers tolerate an optional chart failing, so 'set -e' will not stop here.
  helm --kube-context "kind-$CLUSTER" upgrade --install "$release" "$chart" \
    --version "$chart_version" --namespace "$ns" --create-namespace --wait --timeout 12m "$@" || return
  record_chart "$release" "$chart" "$chart_version" "$app_version"
}

repo_add() {
  local name="$1" url="$2"
  # --force-update also corrects a stale URL. Refresh this repository before
  # Helm resolves an unpinned chart version.
  helm repo add --force-update "$name" "$url" >/dev/null
  helm repo update "$name" >/dev/null
}

wait_rollout() {
  local ns="$1"; shift
  kubectl --context "kind-$CLUSTER" -n "$ns" rollout status "$@" --timeout=10m
}

# poll <timeout-seconds> <what> <predicate...>: retry until it succeeds or times out.
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
