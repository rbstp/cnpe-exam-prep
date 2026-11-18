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

# The controller itself, not the Envoy load balancer containers it starts: their
# command lines carry its name too, and they come back after a reboot without it.
cpk_running() { pgrep -u "$(id -u)" -f '^[^ ]*cloud-provider-kind( |$)' >/dev/null 2>&1; }

# A fixed address near the top of the kind network (its broadcast address minus $1),
# for the containers pods reach by name. Docker hands out addresses from the bottom
# and remembers them, so after a reboot a container that starts first can take one
# Gitea or the registry held, which then fails with "Address already in use" and
# leaves CoreDNS pointing at the wrong container.
kind_fixed_ip() {
  local subnet
  subnet=$(docker network inspect kind -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | tr ' ' '\n' | grep -m1 '\.') \
    || die "the 'kind' docker network has no IPv4 subnet; run 'make up' first"
  python3 -c 'import ipaddress,sys; n=ipaddress.ip_network(sys.argv[1]); print(n.broadcast_address - int(sys.argv[2]))' "$subnet" "$1"
}

# Resolve $2 to $1 inside the cluster, through the hosts block of CoreDNS's
# Corefile; a stale address from an older install is corrected, not kept.
coredns_host() {
  local ip="$1" host="$2" changed
  changed=$(python3 - "$ip" "$host" <<'PY'
import subprocess, sys, json, re
ip, host = sys.argv[1], sys.argv[2]
cm = json.loads(subprocess.check_output(["kubectl", "-n", "kube-system", "get", "cm", "coredns", "-o", "json"]))
corefile = cm["data"]["Corefile"]
known = re.search(r"^(\s+)(\S+) " + re.escape(host) + r"$", corefile, re.M)
if known and known.group(2) == ip:
    print("no"); sys.exit(0)
if known:
    corefile = corefile.replace(known.group(0), f"{known.group(1)}{ip} {host}", 1)
elif "    hosts {\n" in corefile:  # CoreDNS allows only one hosts block per server
    corefile = corefile.replace("    hosts {\n", f"    hosts {{\n        {ip} {host}\n", 1)
else:
    corefile = corefile.replace("    ready\n", f"    ready\n    hosts {{\n        {ip} {host}\n        fallthrough\n    }}\n", 1)
cm["data"]["Corefile"] = corefile
subprocess.run(["kubectl", "apply", "-f", "-"], input=json.dumps(cm).encode(), check=True, stdout=subprocess.DEVNULL)
print("yes")
PY
) || die "could not patch CoreDNS for $host"
  if [ "$changed" = yes ]; then
    kubectl -n kube-system rollout restart deploy/coredns >/dev/null
    kubectl -n kube-system rollout status deploy/coredns --timeout=3m >/dev/null || true
    ok "CoreDNS resolves $host to $ip"
  else
    ok "CoreDNS already resolves $host to $ip"
  fi
}
