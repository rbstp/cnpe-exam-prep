#!/usr/bin/env bash
# Installs every CLI the CNPE exam tool list implies, into ~/.local/bin.
source "$(dirname "$0")/lib.sh"
mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"

RELEASE_CACHE=$(mktemp -d)
RELEASE_ROWS=$(mktemp)
trap 'rm -rf "$RELEASE_CACHE"; rm -f "$RELEASE_ROWS"' EXIT

pac() {
  for p in "$@"; do
    if ! pacman -Si "$p" >/dev/null 2>&1; then
      warn "pacman: $p not in the repos, will try an upstream binary"
    elif ! sudo pacman -S --needed --noconfirm "$p"; then
      warn "pacman: installing $p FAILED (it does exist in the repos); see the error above"
    fi
  done
}

api() {
  local repo="$1"
  local cache="$RELEASE_CACHE/${repo//\//_}.json"
  if [ ! -s "$cache" ]; then
    curl -fsSL "https://api.github.com/repos/$repo/releases/latest" -o "$cache"
  fi
  cat "$cache"
}

tag() { api "$1" | jq -er .tag_name; }

# Print one client-side version line without waiting on a Kubernetes API.
ver() {
  local t="$1"
  command -v "$t" >/dev/null || { echo MISSING; return; }
  case "$t" in
    istioctl) timeout 10 "$t" version --remote=false 2>/dev/null | head -1 ;;
    linkerd)  timeout 10 "$t" version --client --short 2>/dev/null | head -1 ;;
    argocd)   timeout 10 "$t" version --client --short 2>/dev/null | head -1 ;;
    flux)     timeout 10 "$t" version --client 2>/dev/null | head -1 ;;
    helm)     timeout 10 "$t" version --short 2>/dev/null | head -1 ;;
    cosign)   timeout 10 "$t" version --json 2>/dev/null | jq -r .gitVersion ;;
    kubeseal) timeout 10 "$t" --version 2>/dev/null | head -1 ;;
    kubectl-cost) timeout 10 "$t" version 2>/dev/null | awk -F ': +' '$1 ~ /Git Summary/ {print $2; exit}' ;;
    kubectl-argo-rollouts) timeout 10 "$t" version 2>/dev/null | head -1 ;;
    kind|trivy|kubebuilder|cilium|hubble|argo|tkn|crossplane|cloud-provider-kind)
              timeout 10 "$t" version 2>/dev/null | head -1 ;;
    *)        timeout 10 "$t" version --client 2>/dev/null | head -1 ;;
  esac
}

# Only for a tool that now sits at <release>: a row written before a download
# that then fails pairs it with the old binary's hash, which later runs trust.
record_release() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RELEASE_ROWS"
}

has_release() {
  local out="$1" release="$2" plain="${2#v}" escaped
  printf '%s\n' "$out" | grep -Fq "$release" && return 0
  escaped=$(printf '%s' "$plain" | sed 's/[][\\.^$*+?{}|()]/\\&/g')
  printf '%s\n' "$out" | grep -Eq "(^|[^[:alnum:]])v?${escaped}([^[:alnum:]]|$)"
}

report_matches_release() {
  local tool="$1" repo="$2" release="$3" path expected actual recorded
  [ -s "$REPO_ROOT/.lab-versions.json" ] || return 1
  path=$(command -v "$tool" 2>/dev/null) || return 1
  [ -f "$path" ] || return 1
  recorded=$(jq -r --arg tool "$tool" --arg repo "$repo" \
    '.upstream_releases[]? | select(.tool == $tool and .repository == $repo) | .latest_release' \
    "$REPO_ROOT/.lab-versions.json" | head -1)
  [ "$recorded" = "$release" ] || return 1
  expected=$(jq -r --arg tool "$tool" '.tools[]? | select(.name == $tool) | .sha256' \
    "$REPO_ROOT/.lab-versions.json" | head -1)
  if [ -z "$expected" ] || [ "$expected" = null ]; then return 1; fi
  actual=$(sha256sum "$path" | awk '{print $1}')
  [ "$actual" = "$expected" ]
}

asset_field() {
  local repo="$1" match="$2" field="$3"
  api "$repo" | jq -er --arg m "$match" --arg f "$field" \
    '.assets[] | select(.name|test($m)) | .[$f]' | head -1
}

download_asset() {
  local repo="$1" match="$2" destination="$3" url digest expected actual
  url=$(asset_field "$repo" "$match" browser_download_url) || return 1
  digest=$(asset_field "$repo" "$match" digest 2>/dev/null || true)
  log "download <- $url"
  curl -fsSL "$url" -o "$destination"
  if [[ "$digest" == sha256:* ]]; then
    expected=${digest#sha256:}
    actual=$(sha256sum "$destination" | awk '{print $1}')
    [ "$actual" = "$expected" ] || die "checksum mismatch for $url"
    ok "verified sha256 for $(basename "$url")"
  else
    warn "GitHub did not publish an asset digest for $(basename "$url"); TLS verification still applies"
  fi
}

# gh_bin <repo> <asset-name-substring> <output-name>
gh_bin() {
  local repo="$1" match="$2" out="$3"
  local release current asset tmp installed name
  release=$(tag "$repo") || { warn "could not resolve the latest $repo release"; return; }
  current=$(ver "$out" || true)
  if { [ "$current" != MISSING ] && has_release "$current" "$release"; } || \
     report_matches_release "$out" "$repo" "$release"; then
    record_release "$out" "$repo" "$release"
    ok "$out already matches latest ($release)"
    return
  fi
  if [ "$current" = MISSING ]; then installed="not installed"; else installed="installed: ${current:-unknown}"; fi
  log "$out latest is $release ($installed)"
  tmp=$(mktemp -d)
  asset="$tmp/asset"
  if ! download_asset "$repo" "$match" "$asset"; then
    warn "no asset matching '$match' in $repo"
    rm -rf "$tmp"
    return
  fi
  name=$(asset_field "$repo" "$match" name)
  if [[ "$name" == *.gz && "$name" != *.tar.gz ]]; then
    gunzip -c "$asset" > "$tmp/$out"
    install -m755 "$tmp/$out" "$BIN_DIR/$out"
  else
    install -m755 "$asset" "$BIN_DIR/$out"
  fi
  rm -rf "$tmp"
  record_release "$out" "$repo" "$release"
}

# gh_tar <repo> <asset-substring> <path-inside-tar> <output-name>
gh_tar() {
  local repo="$1" match="$2" inner="$3" out="$4"
  local release current tmp installed
  release=$(tag "$repo") || { warn "could not resolve the latest $repo release"; return; }
  current=$(ver "$out" || true)
  if { [ "$current" != MISSING ] && has_release "$current" "$release"; } || \
     report_matches_release "$out" "$repo" "$release"; then
    record_release "$out" "$repo" "$release"
    ok "$out already matches latest ($release)"
    return
  fi
  if [ "$current" = MISSING ]; then installed="not installed"; else installed="installed: ${current:-unknown}"; fi
  log "$out latest is $release ($installed)"
  tmp=$(mktemp -d)
  if ! download_asset "$repo" "$match" "$tmp/asset"; then
    warn "no asset matching '$match' in $repo"
    rm -rf "$tmp"
    return
  fi
  tar xzf "$tmp/asset" -C "$tmp"
  [ -f "$tmp/$inner" ] || die "$inner was not present in the downloaded $repo archive"
  install -m755 "$tmp/$inner" "$BIN_DIR/$out"
  rm -rf "$tmp"
  record_release "$out" "$repo" "$release"
}

log "Arch repo packages"
pac kubectl helm k9s kustomize kind trivy cosign stern kubectx skopeo nodejs npm yarn go

log "Core cluster tooling"
gh_bin kubernetes-sigs/kind 'kind-linux-amd64$' kind
gh_tar kubernetes-sigs/cloud-provider-kind 'linux_amd64.tar.gz$' cloud-provider-kind cloud-provider-kind
gh_bin kubernetes-sigs/kubebuilder 'kubebuilder_linux_amd64$' kubebuilder

log "GitOps + delivery"
gh_bin argoproj/argo-cd 'argocd-linux-amd64$' argocd
gh_bin argoproj/argo-rollouts 'kubectl-argo-rollouts-linux-amd64$' kubectl-argo-rollouts
gh_bin argoproj/argo-workflows 'argo-linux-amd64.gz$' argo
gh_tar fluxcd/flux2 'flux_.*_linux_amd64.tar.gz$' flux flux
gh_tar tektoncd/cli 'tkn_.*_Linux_x86_64.tar.gz$' tkn tkn

log "Platform APIs"
if crossplane_release=$(tag crossplane/cli); then
  if has_release "$(ver crossplane || true)" "$crossplane_release" || \
     report_matches_release crossplane crossplane/cli "$crossplane_release"; then
    record_release crossplane crossplane/cli "$crossplane_release"
  else
    log "crossplane latest is $crossplane_release"
    if ( cd "$BIN_DIR" && curl -fsSL https://cli.crossplane.io/install.sh | XP_VERSION="$crossplane_release" sh ); then
      record_release crossplane crossplane/cli "$crossplane_release"
    else
      warn "the crossplane installer failed; the installed CLI is unchanged"
    fi
  fi
else
  warn "could not resolve the latest crossplane/cli release; skipping crossplane"
fi

log "Networking / mesh"
gh_tar cilium/cilium-cli 'cilium-linux-amd64.tar.gz$' cilium cilium
gh_tar cilium/hubble 'hubble-linux-amd64.tar.gz$' hubble hubble
if istio_release=$(tag istio/istio); then
  if has_release "$(ver istioctl || true)" "$istio_release" || \
     report_matches_release istioctl istio/istio "$istio_release"; then
    record_release istioctl istio/istio "$istio_release"
  else
    log "istioctl latest is $istio_release"
    istio_tmp=$(mktemp -d)
    if ( cd "$istio_tmp" && curl -fsSL https://istio.io/downloadIstio | ISTIO_VERSION="${istio_release#v}" sh - >/dev/null ) && \
       install -m755 "$istio_tmp"/istio-*/bin/istioctl "$BIN_DIR/istioctl"; then
      record_release istioctl istio/istio "$istio_release"
    else
      warn "the istioctl download failed; the installed CLI is unchanged"
    fi
    rm -rf "$istio_tmp"
  fi
else
  warn "could not resolve the latest istio/istio release; skipping istioctl"
fi
gh_bin linkerd/linkerd2 'linkerd2-cli-.*-linux-amd64$' linkerd

log "Secrets tooling"
gh_tar bitnami/sealed-secrets 'kubeseal-.*-linux-amd64.tar.gz$' kubeseal kubeseal

log "Cost + policy"
gh_bin kubecost/kubectl-cost 'kubectl-cost-linux-amd64$' kubectl-cost 2>/dev/null || \
  warn "kubectl-cost: fetch manually if the asset name changed"

log "Shell completion + kubeconfig ergonomics"
mkdir -p "$HOME/.bash_completion.d"
for t in kubectl helm kind argocd flux tkn linkerd istioctl; do
  command -v "$t" >/dev/null && "$t" completion bash > "$HOME/.bash_completion.d/$t" 2>/dev/null || true
done

grep -q 'cnpe-lab tooling' "$HOME/.bashrc" 2>/dev/null || cat >> "$HOME/.bashrc" <<'RC'

# ── cnpe-lab tooling ─────────────────────────────────────────────
export PATH="$HOME/.local/bin:$PATH"
for f in "$HOME"/.bash_completion.d/*; do [ -r "$f" ] && . "$f"; done
alias k=kubectl
complete -o default -F __start_kubectl k
export do='--dry-run=client -o yaml'        # exam muscle memory
export now='--force --grace-period=0'
RC

if helm repo list >/dev/null 2>&1 && [ "$(helm repo list -o json | jq 'length')" -gt 0 ]; then
  log "Refreshing configured Helm repository indexes"
  helm repo update >/dev/null
fi

log "Installed versions"
report_rows=$(mktemp)
for t in kubectl helm kind argocd flux tkn crossplane istioctl linkerd cilium hubble \
         argo kubectl-argo-rollouts trivy cosign kubebuilder kubeseal kubectl-cost cloud-provider-kind; do
  version=$(ver "$t" || echo installed)
  printf '  %-24s %s\n' "$t" "$version"
  path=$(command -v "$t" 2>/dev/null || true)
  if [ -n "$path" ] && [ -f "$path" ]; then digest=$(sha256sum "$path" | awk '{print $1}'); else digest=""; fi
  printf '%s\t%s\t%s\n' "$t" "${version//$'\t'/ }" "$digest" >> "$report_rows"
done
report_extra='{}'
if [ -s "$REPO_ROOT/.lab-versions.json" ]; then
  report_extra=$(jq '{charts, images} | with_entries(select(.value != null))' "$REPO_ROOT/.lab-versions.json")
fi
releases=$(jq -Rn '[inputs | split("\t") | {tool: .[0], repository: .[1], latest_release: .[2]}]' < "$RELEASE_ROWS")
jq -Rn --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson extra "$report_extra" --argjson releases "$releases" \
  '{generated_at: $generated_at, tools: [inputs | split("\t") | {name: .[0], version: .[1], sha256: .[2]}], upstream_releases: $releases} + $extra' \
  < "$report_rows" > "$REPO_ROOT/.lab-versions.json.tmp"
mv "$REPO_ROOT/.lab-versions.json.tmp" "$REPO_ROOT/.lab-versions.json"
rm -f "$report_rows"
ok "Tools ready. Resolved versions: $REPO_ROOT/.lab-versions.json"
ok "Open a new shell, then: make up"
