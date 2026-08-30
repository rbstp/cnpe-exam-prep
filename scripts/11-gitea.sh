#!/usr/bin/env bash
# A local Git server, resolvable inside the cluster as gitea.lab.
source "$(dirname "$0")/lib.sh"
need docker

GITEA_CONTAINER=gitea
GITEA_IMAGE=gitea/gitea:latest

run_gitea() {
  docker run -d --name "$GITEA_CONTAINER" --network kind --restart=always \
    -p "127.0.0.1:${GITEA_PORT}:3000" \
    -e GITEA__database__DB_TYPE=sqlite3 \
    -e GITEA__security__INSTALL_LOCK=true \
    -e GITEA__server__ROOT_URL="http://${GITEA_HOST}:3000/" \
    -e GITEA__server__DISABLE_SSH=true \
    -e GITEA__service__DISABLE_REGISTRATION=false \
    -e GITEA__repository__DEFAULT_BRANCH=main \
    -v gitea-data:/data \
    "$GITEA_IMAGE" >/dev/null
}

wait_gitea() {
  local up=no
  for _ in $(seq 1 60); do
    curl -fsS "http://localhost:${GITEA_PORT}/api/healthz" >/dev/null 2>&1 && { up=yes; break; }
    sleep 2
  done
  [ "$up" = yes ]
}

record_gitea_image() {
  local digest tmp
  command -v jq >/dev/null || return 0
  digest=$(docker image inspect -f '{{index .RepoDigests 0}}' "$GITEA_IMAGE" 2>/dev/null || true)
  [ -n "$digest" ] || digest=$(docker image inspect -f '{{.Id}}' "$GITEA_IMAGE")
  tmp="$REPO_ROOT/.lab-versions.json.tmp"
  if [ -s "$REPO_ROOT/.lab-versions.json" ]; then
    jq --arg digest "$digest" '.images = ((.images // {}) + {gitea: $digest})' \
      "$REPO_ROOT/.lab-versions.json" > "$tmp"
  else
    jq -n --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg digest "$digest" \
      '{generated_at: $generated_at, tools: [], images: {gitea: $digest}}' > "$tmp"
  fi
  mv "$tmp" "$REPO_ROOT/.lab-versions.json"
}

refresh_gitea() {
  local old_id latest_id old_name was_running
  if ! docker inspect "$GITEA_CONTAINER" >/dev/null 2>&1; then
    ok "Gitea is not installed; refresh leaves it absent"
    return
  fi

  log "Pulling $GITEA_IMAGE"
  old_id=$(docker inspect -f '{{.Image}}' "$GITEA_CONTAINER")
  docker pull "$GITEA_IMAGE" >/dev/null
  latest_id=$(docker image inspect -f '{{.Id}}' "$GITEA_IMAGE")
  record_gitea_image
  if [ "$old_id" = "$latest_id" ]; then
    ok "Gitea already uses the latest image ($latest_id)"
    return
  fi

  was_running=$(docker inspect -f '{{.State.Running}}' "$GITEA_CONTAINER")
  old_name="gitea-cnpe-rollback-$(date +%s)"
  log "Replacing Gitea while preserving the gitea-data volume"
  docker stop "$GITEA_CONTAINER" >/dev/null
  docker rename "$GITEA_CONTAINER" "$old_name"
  if run_gitea && wait_gitea; then
    docker rm "$old_name" >/dev/null
    [ "$was_running" = true ] || docker stop "$GITEA_CONTAINER" >/dev/null
    ok "Gitea updated to $latest_id"
    return
  fi

  warn "The refreshed Gitea did not become healthy; restoring the previous container"
  docker rm -f "$GITEA_CONTAINER" >/dev/null 2>&1 || true
  docker rename "$old_name" "$GITEA_CONTAINER"
  [ "$was_running" = true ] && docker start "$GITEA_CONTAINER" >/dev/null
  die "Gitea refresh failed; the previous container was restored"
}

if [ "${CNPE_REFRESH:-0}" = 1 ]; then
  refresh_gitea
  [ "${1:-}" = --refresh-only ] && exit 0
elif [ "${1:-}" = --refresh-only ]; then
  die "--refresh-only must be run through 'make refresh'"
fi

need kubectl; need git

if [ "$(docker inspect -f '{{.State.Running}}' "$GITEA_CONTAINER" 2>/dev/null || true)" != "true" ]; then
  log "Starting Gitea"
  docker rm -f "$GITEA_CONTAINER" >/dev/null 2>&1 || true
  run_gitea
  log "Waiting for Gitea to come up"
  wait_gitea || die "gitea did not become healthy on port ${GITEA_PORT} after 120s (docker logs gitea)"
fi

GITEA_IP=$(docker inspect -f '{{ (index .NetworkSettings.Networks "kind").IPAddress }}' gitea)
[ -n "$GITEA_IP" ] || die "gitea has no IP on the 'kind' network"
ok "Gitea at http://localhost:${GITEA_PORT} (in-cluster: http://${GITEA_HOST}:3000 → $GITEA_IP)"

log "Creating admin user '$GITEA_USER'"
if docker exec -u git gitea gitea admin user list 2>/dev/null | awk '{print $2}' | grep -qx "$GITEA_USER"; then
  ok "user '$GITEA_USER' already exists"
else
  out=$(docker exec -u git gitea gitea admin user create \
    --username "$GITEA_USER" --password "$GITEA_PASS" \
    --email "${GITEA_USER}@lab.local" --admin --must-change-password=false 2>&1) \
    || die "creating gitea user failed: $out"
  ok "user '$GITEA_USER' created"
fi

if [ ! -s "$REPO_ROOT/.gitea-token" ]; then
  TOKEN=$(docker exec -u git gitea gitea admin user generate-access-token \
    -u "$GITEA_USER" -t "cnpe-lab-$(date +%s)" \
    --scopes all --raw) \
    || die "could not generate a gitea access token (see the error above)"
  [ -n "$TOKEN" ] || die "gitea returned an empty access token"
  printf '%s\n' "$TOKEN" > "$REPO_ROOT/.gitea-token"
  chmod 600 "$REPO_ROOT/.gitea-token"
fi
TOKEN=$(cat "$REPO_ROOT/.gitea-token")
[ -n "$TOKEN" ] || die "empty $REPO_ROOT/.gitea-token"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token $TOKEN" \
  "http://localhost:${GITEA_PORT}/api/v1/user")
[ "$code" = "200" ] || die "gitea token rejected (HTTP $code) - delete $REPO_ROOT/.gitea-token and re-run"
ok "gitea API token works"

log "Teaching the HOST about ${GITEA_HOST}"
if grep -qE "^${GITEA_IP}[[:space:]]+${GITEA_HOST}\$" /etc/hosts; then
  ok "/etc/hosts already correct (no sudo needed)"
elif ! sudo -n true 2>/dev/null && ! [ -t 0 ]; then
  warn "/etc/hosts needs updating but sudo cannot prompt here; run this yourself:"
  warn "  sudo sed -i -E 's|^[0-9.]+[[:space:]]+${GITEA_HOST}\$|${GITEA_IP} ${GITEA_HOST}|' /etc/hosts   # or append if missing"
elif grep -qE "[[:space:]]${GITEA_HOST}\$" /etc/hosts; then
  sudo sed -i -E "s|^[0-9.]+[[:space:]]+${GITEA_HOST}\$|${GITEA_IP} ${GITEA_HOST}|" /etc/hosts
else
  echo "${GITEA_IP} ${GITEA_HOST}" | sudo tee -a /etc/hosts >/dev/null
fi
curl -fsS "http://${GITEA_HOST}:3000/api/healthz" >/dev/null && ok "http://${GITEA_HOST}:3000 reachable from this host" \
  || warn "gitea.lab not reachable from the host; check /etc/hosts and the docker bridge"

log "Teaching CoreDNS about ${GITEA_HOST}"
python3 - "$GITEA_IP" "$GITEA_HOST" <<'PY'
import subprocess, sys, json, re
ip, host = sys.argv[1], sys.argv[2]
cm = json.loads(subprocess.check_output(
    ["kubectl","-n","kube-system","get","cm","coredns","-o","json"]))
corefile = cm["data"]["Corefile"]
if host in corefile:
    print("    CoreDNS already knows", host); sys.exit(0)
m = re.search(r"(    hosts \{\n)", corefile)
if m:  # extend the existing hosts block (CoreDNS allows only one per server)
    corefile = corefile.replace(m.group(1), m.group(1) + f"        {ip} {host}\n", 1)
else:
    block = f"    hosts {{\n        {ip} {host}\n        fallthrough\n    }}\n"
    corefile = corefile.replace("    ready\n", "    ready\n" + block, 1)
cm["data"]["Corefile"] = corefile
subprocess.run(["kubectl","apply","-f","-"], input=json.dumps(cm).encode(), check=True)
print("    CoreDNS patched")
PY
kubectl -n kube-system rollout restart deploy/coredns >/dev/null
kubectl -n kube-system rollout status deploy/coredns --timeout=3m >/dev/null

# ── seed repositories ────────────────────────────────────────────────────
mk_repo() {
  local name="$1" code
  code=$(curl -s -o /tmp/cnpe-lab/mkrepo.out -w '%{http_code}' \
    -X POST "http://localhost:${GITEA_PORT}/api/v1/user/repos" \
    -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"private\":false,\"default_branch\":\"main\",\"auto_init\":true}")
  case "$code" in
    201)     ok "repo $name created" ;;
    409|422) ok "repo $name already exists" ;;
    *)       die "creating repo '$name' failed (HTTP $code): $(cat /tmp/cnpe-lab/mkrepo.out)" ;;
  esac
}
log "Creating org '$GITEA_ORG' (Argo CD's Gitea SCM generator needs an org, not a user)"
org_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:${GITEA_PORT}/api/v1/orgs" \
  -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$GITEA_ORG\",\"full_name\":\"Platform Services\",\"visibility\":\"public\"}")
case "$org_code" in
  201)     ok "org $GITEA_ORG created" ;;
  409|422) ok "org $GITEA_ORG already exists" ;;
  *)       die "creating org '$GITEA_ORG' failed (HTTP $org_code)" ;;
esac

mk_repo platform
mk_repo demo-app

log "Pushing example manifests into 'platform'"
WORK=$(mktemp -d)
git -c http.sslVerify=false clone -q \
  "http://${GITEA_USER}:${GITEA_PASS}@localhost:${GITEA_PORT}/${GITEA_USER}/platform.git" "$WORK/platform"
cp -r "$REPO_ROOT/examples/." "$WORK/platform/"
( cd "$WORK/platform" || exit 1
  git config user.email "lab@lab.local"; git config user.name "CNPE Lab"
  git add -A
  git diff --cached --quiet || { git commit -qm "seed lab manifests"; git push -q origin main; } )
rm -rf "$WORK"

cat > "$REPO_ROOT/.gitea-info" <<INFO
Gitea UI     http://${GITEA_HOST}:3000   (also http://localhost:${GITEA_PORT})
user/pass    ${GITEA_USER} / ${GITEA_PASS}
clone URL    http://${GITEA_HOST}:3000/${GITEA_USER}/platform.git
             (identical from host, from Backstage, and from inside the cluster)
API token    $REPO_ROOT/.gitea-token
INFO
cat "$REPO_ROOT/.gitea-info"
ok "Git server ready"
