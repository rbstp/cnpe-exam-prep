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

record_image() {
  local name="$1" reference="$2" tmp
  command -v jq >/dev/null || return 0
  tmp="$REPO_ROOT/.lab-versions.json.tmp"
  if [ -s "$REPO_ROOT/.lab-versions.json" ]; then
    jq --arg name "$name" --arg reference "$reference" \
      '.images = ((.images // {}) + {($name): $reference})' \
      "$REPO_ROOT/.lab-versions.json" > "$tmp"
  else
    jq -n --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg name "$name" --arg reference "$reference" \
      '{generated_at: $generated_at, tools: [], images: {($name): $reference}}' > "$tmp"
  fi
  mv "$tmp" "$REPO_ROOT/.lab-versions.json"
}

kctx() { kubectl --context "kind-${1:-$CLUSTER}" "${@:2}"; }

helmi() {
  local release="$1" chart="$2" ns="$3" chart_version app_version tmp; shift 3
  chart_version=$(helm show chart "$chart" | awk -F ': ' '$1 == "version" {print $2; exit}')
  [ -n "$chart_version" ] || die "could not resolve a version for Helm chart '$chart'"
  app_version=$(helm show chart "$chart" | awk -F ': ' '$1 == "appVersion" {print $2; exit}')

  if command -v jq >/dev/null; then
    tmp="$REPO_ROOT/.lab-versions.json.tmp"
    if [ -s "$REPO_ROOT/.lab-versions.json" ]; then
      jq --arg release "$release" --arg chart "$chart" --arg version "$chart_version" --arg app_version "$app_version" \
        '.charts = ((.charts // {}) + {($release): {chart: $chart, version: $version, app_version: $app_version}})' \
        "$REPO_ROOT/.lab-versions.json" > "$tmp"
    else
      jq -n --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg release "$release" --arg chart "$chart" --arg version "$chart_version" --arg app_version "$app_version" \
        '{generated_at: $generated_at, tools: [], charts: {($release): {chart: $chart, version: $version, app_version: $app_version}}}' > "$tmp"
    fi
    mv "$tmp" "$REPO_ROOT/.lab-versions.json"
  fi

  helm --kube-context "kind-$CLUSTER" upgrade --install "$release" "$chart" \
    --version "$chart_version" --namespace "$ns" --create-namespace --wait --timeout 12m "$@"
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
