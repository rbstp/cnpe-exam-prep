#!/usr/bin/env bash
# Backstage on the host, with a software template that scaffolds into the local Gitea.
source "$(dirname "$0")/lib.sh"
need node; need npx
APP="${BACKSTAGE_APP:-$LAB_HOME/portal}"

# 1.22.22 is the end of the classic line; yarn 2+ comes from corepack, not npm.
command -v yarn >/dev/null || { log "Installing yarn"; sudo npm i -g yarn@1.22.22; }
# The app create-app scaffolds carries "node": "^24.15.0 || ^26.13.0" in its
# package.json, so the major is not enough: 26.12 is refused like 22 is. One
# list of floors, read by both the mise fallback and the guard, in preference order.
NODE_FLOORS=(26.13.0 24.15.0)
supported() {
  local v="${1#v}" floor
  for floor in "${NODE_FLOORS[@]}"; do
    [ "${v%%.*}" = "${floor%%.*}" ] || continue
    [ "$(printf '%s\n%s\n' "$floor" "$v" | sort -V | head -1)" = "$floor" ] && return 0
  done
  return 1
}
if ! supported "$(node -v)" && command -v mise >/dev/null; then
  for floor in "${NODE_FLOORS[@]}"; do
    NODE_DIR=$(mise where "node@${floor%%.*}" 2>/dev/null) || continue
    [ -x "$NODE_DIR/bin/node" ] && supported "$("$NODE_DIR/bin/node" -v)" || continue
    log "Using mise's Node $("$NODE_DIR/bin/node" -v) from $NODE_DIR (shell default is $(node -v))"
    export PATH="$NODE_DIR/bin:$PATH"
    break
  done
fi
if ! supported "$(node -v)"; then
  warn "Node $(node -v) is not a version Backstage supports (its app wants ^24.15.0 or ^26.13.0)."
  if command -v mise >/dev/null; then
    warn "You have mise. Pin a supported Node just for this directory:"
    warn "    cd $LAB_HOME && mise use node@26 && exec \$SHELL"
  else
    warn "Install Node 26.13 or later (nvm/mise/fnm) and re-run 'make portal'."
  fi
  die "refusing to scaffold Backstage on an unsupported Node; see above"
fi

# ── 1. scaffold the app ──────────────────────────────────────────────────
if [ ! -d "$APP" ]; then
  log "Creating the Backstage app (~5-10 min, lots of npm)"
  mkdir -p "$LAB_HOME"
  # create-app always prompts for the app name, so feed it on stdin.
  ( cd "$LAB_HOME" && printf 'portal\n' | \
      npx --yes @backstage/create-app@latest --skip-install --path "$(basename "$APP")" )

  if [ -f "$APP/.yarnrc.yml" ] && ! grep -q nunjitsu "$APP/.yarnrc.yml"; then
    log "Pre-approving 'nunjitsu' past the 3-day age gate (keeps the gate for everything else)"
    python3 - "$APP/.yarnrc.yml" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text()
key = "npmPreapprovedPackages:\n"
if key in s:
    s = s.replace(key, key + "  - 'nunjitsu'\n", 1)
else:
    s += "\nnpmPreapprovedPackages:\n  - 'nunjitsu'\n"
p.write_text(s)
print("    .yarnrc.yml updated")
PYEOF
  fi

  log "Installing Backstage dependencies (several minutes, builds native modules)"
  ( cd "$APP" && yarn install --no-immutable )
else
  ok "Backstage app already at $APP"
fi
[ -d "$APP/packages/backend" ] || die "create-app did not finish; remove $APP and re-run"

# ── 2. the Gitea scaffolder action ───────────────────────────────────────
if ! grep -q 'scaffolder-backend-module-gitea' "$APP/packages/backend/package.json"; then
  log "Adding @backstage/plugin-scaffolder-backend-module-gitea"
  ( cd "$APP" && yarn --cwd packages/backend add @backstage/plugin-scaffolder-backend-module-gitea )
fi

log "Registering the module in the backend"
python3 - "$APP/packages/backend/src/index.ts" <<'PY'
import sys, re
p = sys.argv[1]
src = open(p).read()
line = "backend.add(import('@backstage/plugin-scaffolder-backend-module-gitea'));\n"
if 'scaffolder-backend-module-gitea' in src:
    print('    already registered'); sys.exit(0)
# Insert immediately before backend.start()
m = re.search(r'^\s*backend\.start\(\);', src, re.M)
if not m:
    print('    !! could not find backend.start(); add this line yourself:')
    print('       ' + line.strip()); sys.exit(0)
src = src[:m.start()] + line + src[m.start():]
open(p, 'w').write(src)
print('    registered')
PY

# ── 3. install the template + config ─────────────────────────────────────
log "Installing the golden-path template"
mkdir -p "$APP/examples/golden-path"
cp -r "$REPO_ROOT/backstage/template/." "$APP/examples/golden-path/"
cp "$REPO_ROOT/backstage/app-config.local.yaml" "$APP/app-config.local.yaml"

python3 - "$APP/app-config.local.yaml" "$GITEA_HOST" "$GITEA_USER" "$GITEA_PASS" <<'PY'
import sys
p, host, user, pw = sys.argv[1:5]
s = open(p).read()
s = s.replace('gitea.lab:3000', f'{host}:3000')
s = s.replace('http://gitea.lab', f'http://{host}')
s = s.replace('username: lab\n', f'username: {user}\n')
s = s.replace('password: REPLACED_FROM_LAB_ENV', f'password: {pw}')
open(p, 'w').write(s)
PY
sed -i "s|allowedHosts: \['gitea.lab:3000'\]|allowedHosts: ['${GITEA_HOST}:3000']|; s|allowedOwners: \['services'\]|allowedOwners: ['${GITEA_ORG}']|" \
  "$APP/examples/golden-path/template.yaml"

# ── 4. the Argo CD side: discover whatever Backstage creates ─────────────
if kubectl --context "kind-$CLUSTER" get ns argocd >/dev/null 2>&1; then
  if [ -f "$REPO_ROOT/.gitea-token" ]; then
    log "Creating the Gitea token secret for Argo CD"
    kubectl --context "kind-$CLUSTER" -n argocd create secret generic gitea-token \
      --from-literal=token="$(cat "$REPO_ROOT/.gitea-token")" \
      --dry-run=client -o yaml | kubectl --context "kind-$CLUSTER" apply -f - >/dev/null
  else
    warn "no .gitea-token; run 'make gitea' first"
  fi
  log "Applying the golden-path ApplicationSet"
  sed -e "s|gitea.lab|${GITEA_HOST}|g" -e "s|owner: services|owner: ${GITEA_ORG}|" \
    "$REPO_ROOT/examples/argocd-appset-gitea-scm.yaml" \
    | kubectl --context "kind-$CLUSTER" apply -f -
else
  warn "argocd namespace missing; run 'make gitops', then re-run 'make portal'"
fi

cat <<INFO

  Start Backstage:   cd $APP && yarn start      → http://localhost:3000
  (Gitea moved to host port ${GITEA_PORT} to free 3000; http://${GITEA_HOST}:3000 works from both.)

  The loop to run, end to end:
    1. Create → choose "Golden path service" → name it e.g. 'payments'
    2. Watch the repo appear:   http://${GITEA_HOST}:3000/${GITEA_ORG}/payments
    3. Watch Argo CD find it:   kubectl -n argocd get applicationset golden-path -w
                                kubectl -n argocd get app
    4. Watch it land:           kubectl -n payments-dev get all
    5. Break it:                kubectl -n payments-dev scale deploy/payments --replicas=9
                                # self-heal reverts it within ~30s

  Then make it harder, in roughly this order:
    • Add a Kyverno ValidatingPolicy that rejects the scaffolded Deployment,
      and fix the template until it passes. That is the real golden-path job.
    • Add a second overlay + a second ApplicationSet generator for staging.
    • Swap the Deployment in the skeleton for an Argo Rollouts canary.
    • Add a 'publish:gitea' step that also opens the repo's Tekton PipelineRun.

INFO
ok "Backstage + golden path wired"
