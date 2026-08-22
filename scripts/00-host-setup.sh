#!/usr/bin/env bash
# Host prep for Omarchy 4 / Arch on Intel MacBook Pro.
# Idempotent. Run once (and after kernel upgrades if kind starts misbehaving).
source "$(dirname "$0")/lib.sh"

log "Checking hardware headroom"
TOTAL_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 / 1024 ))
CORES=$(nproc)
FREE_GB=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc '0-9')
echo "    RAM: ${TOTAL_GB}G   cores: ${CORES}   free disk in \$HOME: ${FREE_GB}G"
[ "$TOTAL_GB" -ge 24 ] || warn "under 24G RAM — run one stack at a time"
[ "$FREE_GB" -ge 60 ] || warn "less than 60G free — container images alone need ~35G"

log "Installing base packages (pacman)"
# Deliberately NOT -Syu. You are on a T2-patched kernel; a full system upgrade
# here can swap the kernel and cost you wifi/keyboard mid-lab. Update the system
# on your own terms (omarchy-update / pacman -Syu) as a separate, deliberate act.
PKGS=(docker docker-buildx git jq yq curl wget unzip tar make openssh
      bash-completion python-yaml)
MISSING=()
for p in "${PKGS[@]}"; do pacman -Qq "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if [ ${#MISSING[@]} -eq 0 ]; then
  ok "all base packages already installed"
else
  log "missing: ${MISSING[*]}"
  sudo pacman -S --needed --noconfirm "${MISSING[@]}" || {
    warn "pacman failed — your package db is probably stale."
    warn "Run 'omarchy-update' (or 'sudo pacman -Syu') yourself, then re-run: make host"
    exit 1
  }
fi

log "Enabling docker"
sudo systemctl enable --now docker.service
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  warn "added $USER to the 'docker' group — LOG OUT AND BACK IN, then re-run this script"
fi

log "Raising kernel limits (kind + dozens of controllers exhaust the defaults)"
sudo tee /etc/sysctl.d/99-cnpe-lab.conf >/dev/null <<'SYSCTL'
# Each controller/pod watches many files; defaults cause silent CrashLoopBackOff.
fs.inotify.max_user_watches  = 1048576
fs.inotify.max_user_instances = 8192
fs.file-max = 2097152
# Elasticsearch/OpenSearch-style workloads and some collectors need this.
vm.max_map_count = 262144
# Many namespaces => many conntrack entries.
net.netfilter.nf_conntrack_max = 393216
# ARP table overflow with 3 nodes x many pods on one bridge.
net.ipv4.neigh.default.gc_thresh1 = 4096
net.ipv4.neigh.default.gc_thresh2 = 8192
net.ipv4.neigh.default.gc_thresh3 = 16384
SYSCTL
sudo sysctl --system >/dev/null
ok "sysctls applied"

log "Raising systemd task/file limits for docker"
# Restarting dockerd bounces EVERY container on the machine, including unrelated
# work and existing kind clusters. Only do it when the override really changed.
OVERRIDE=/etc/systemd/system/docker.service.d/override.conf
WANT=$(cat <<'UNIT'
[Service]
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
UNIT
)
if [ "$(sudo cat "$OVERRIDE" 2>/dev/null || true)" = "$WANT" ]; then
  ok "docker limits already set (not restarting docker)"
else
  sudo mkdir -p "$(dirname "$OVERRIDE")"
  printf '%s\n' "$WANT" | sudo tee "$OVERRIDE" >/dev/null
  warn "restarting dockerd to apply new limits — this restarts ALL your containers"
  sudo systemctl daemon-reload && sudo systemctl restart docker
  ok "docker limits applied"
fi

log "Checking docker daemon config (log rotation — kind nodes fill the SSD otherwise)"
# On Omarchy, /etc/docker/daemon.json is OWNED BY THE omarchy-settings PACKAGE and
# deliberately sets dns=172.17.0.1 (systemd-resolved listens on the docker bridge)
# plus bip. Overwriting it breaks container DNS and gets reverted by omarchy-update.
# So: only create the file if it is absent, and only report if it already exists.
if [ -f /etc/docker/daemon.json ]; then
  if pacman -Qo /etc/docker/daemon.json >/dev/null 2>&1; then
    ok "daemon.json is package-owned — leaving it untouched"
  else
    ok "daemon.json exists — leaving it untouched"
  fi
  if grep -q 'max-size' /etc/docker/daemon.json; then
    ok "log rotation already configured"
  else
    warn "no log rotation in /etc/docker/daemon.json — kind node logs can fill the SSD."
    warn 'Add manually:  "log-opts": { "max-size": "10m", "max-file": "3" }'
  fi
else
  sudo mkdir -p /etc/docker
  sudo tee /etc/docker/daemon.json >/dev/null <<'DAEMON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
DAEMON
  sudo systemctl restart docker
  ok "daemon.json created"
fi

# MacBook-specific: the 2019 Intel chassis throttles hard under sustained load.
if grep -qi apple /sys/class/dmi/id/board_vendor 2>/dev/null; then
  log "Apple hardware detected — thermal advice"
  echo "    • Install 'mbpfan' (AUR) so fans ramp before the CPU throttles:"
  echo "        yay -S mbpfan-git && sudo systemctl enable --now mbpfan"
  echo "    • Check throttling during labs: watch -n2 'grep MHz /proc/cpuinfo | head'"
  echo "    • Prefer 'make obs' OFF while doing mesh labs; both are CPU-hungry."
fi

ok "Host ready. Next: make tools"
