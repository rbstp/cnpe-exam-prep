#!/usr/bin/env bash
# Installs every CLI the CNPE exam tool list implies, into ~/.local/bin.
source "$(dirname "$0")/lib.sh"
mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"

pac() {
  for p in "$@"; do
    if ! pacman -Si "$p" >/dev/null 2>&1; then
      warn "pacman: $p not in the repos, will try an upstream binary"
    elif ! sudo pacman -S --needed --noconfirm "$p"; then
      warn "pacman: installing $p FAILED (it does exist in the repos); see the error above"
    fi
  done
}

api() { curl -fsSL "https://api.github.com/repos/$1/releases/latest"; }
tag() { api "$1" | jq -r .tag_name; }

# gh_bin <repo> <asset-name-substring> <output-name>
gh_bin() {
  local repo="$1" match="$2" out="$3"
  command -v "$out" >/dev/null && { ok "$out present"; return; }
  local url; url=$(api "$repo" | jq -r --arg m "$match" '.assets[] | select(.name|test($m)) | .browser_download_url' | head -1)
  [ -n "$url" ] || { warn "no asset matching '$match' in $repo"; return; }
  log "$out <- $url"
  if [[ "$url" == *.gz && "$url" != *.tar.gz ]]; then
    curl -fsSL "$url" | gunzip > "$BIN_DIR/$out"
  else
    curl -fsSL "$url" -o "$BIN_DIR/$out"
  fi
  chmod +x "$BIN_DIR/$out"
}

# gh_tar <repo> <asset-substring> <path-inside-tar> <output-name>
gh_tar() {
  local repo="$1" match="$2" inner="$3" out="$4"
  command -v "$out" >/dev/null && { ok "$out present"; return; }
  local url; url=$(api "$repo" | jq -r --arg m "$match" '.assets[] | select(.name|test($m)) | .browser_download_url' | head -1)
  [ -n "$url" ] || { warn "no asset matching '$match' in $repo"; return; }
  log "$out <- $url"
  local tmp; tmp=$(mktemp -d)
  curl -fsSL "$url" | tar xz -C "$tmp"
  install -m755 "$tmp/$inner" "$BIN_DIR/$out"
  rm -rf "$tmp"
}

log "Arch repo packages"
pac kubectl helm k9s kustomize kind trivy cosign stern kubectx skopeo nodejs npm yarn go

log "Core cluster tooling"
command -v kind >/dev/null || gh_bin kubernetes-sigs/kind 'kind-linux-amd64$' kind
gh_tar kubernetes-sigs/cloud-provider-kind 'linux_amd64.tar.gz$' cloud-provider-kind cloud-provider-kind
gh_bin kubernetes-sigs/kubebuilder 'kubebuilder_linux_amd64$' kubebuilder

log "GitOps + delivery"
gh_bin argoproj/argo-cd 'argocd-linux-amd64$' argocd
gh_bin argoproj/argo-rollouts 'kubectl-argo-rollouts-linux-amd64$' kubectl-argo-rollouts
gh_bin argoproj/argo-workflows 'argo-linux-amd64.gz$' argo
gh_tar fluxcd/flux2 'flux_.*_linux_amd64.tar.gz$' flux flux
gh_tar tektoncd/cli 'tkn_.*_Linux_x86_64.tar.gz$' tkn tkn

log "Platform APIs"
if ! command -v crossplane >/dev/null; then
  ( cd "$BIN_DIR" && curl -fsSL https://raw.githubusercontent.com/crossplane/crossplane/main/install.sh | sh )
fi

log "Networking / mesh"
gh_tar cilium/cilium-cli 'cilium-linux-amd64.tar.gz$' cilium cilium
gh_tar cilium/hubble 'hubble-linux-amd64.tar.gz$' hubble hubble
if ! command -v istioctl >/dev/null; then
  ( cd /tmp && curl -fsSL https://istio.io/downloadIstio | sh - >/dev/null && \
    install -m755 /tmp/istio-*/bin/istioctl "$BIN_DIR/istioctl" && rm -rf /tmp/istio-* )
fi
if ! command -v linkerd >/dev/null; then
  curl -fsSL https://run.linkerd.io/install-edge | sh
  install -m755 "$HOME/.linkerd2/bin/linkerd" "$BIN_DIR/linkerd" 2>/dev/null || true
fi

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

log "Installed versions"
# Some of these version commands contact the cluster and hang, so force client-only.
ver() {
  local t="$1"
  command -v "$t" >/dev/null || { echo MISSING; return; }
  case "$t" in
    istioctl) timeout 10 "$t" version --remote=false 2>/dev/null | head -1 ;;
    linkerd)  timeout 10 "$t" version --client --short 2>/dev/null | head -1 ;;
    argocd)   timeout 10 "$t" version --client --short 2>/dev/null | head -1 ;;
    kind|trivy|cosign|kubebuilder|cilium|hubble|argo|tkn|flux|crossplane|kubectl-cost)
              timeout 10 "$t" version 2>/dev/null | head -1 ;;
    *)        timeout 10 "$t" version --client 2>/dev/null | head -1 ;;
  esac
}
for t in kubectl helm kind argocd flux tkn crossplane istioctl linkerd cilium hubble \
         argo kubectl-argo-rollouts trivy cosign kubebuilder kubectl-cost cloud-provider-kind; do
  printf '  %-24s %s\n' "$t" "$(ver "$t" || echo installed)"
done
ok "Tools ready. Open a new shell, then: make up"
