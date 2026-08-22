#!/usr/bin/env bash
# Backstage on the host + a working software template that scaffolds into the
# local Gitea, plus the Argo CD ApplicationSet that picks the new repo up.
# Runs on the host rather than in-cluster: far lighter on a 2019 chassis, and
# templates are the part of Domain 3 you actually need reps on.
source "$(dirname "$0")/lib.sh"
need node; need npx
# NOT $LAB_HOME/backstage: that IS this repo's own backstage/ template source
# directory (LAB_HOME == REPO_ROOT), so scaffolding there collides with the
# files we copy FROM. Scaffold into portal/ instead.
APP="${BACKSTAGE_APP:-$LAB_HOME/portal}"

command -v yarn >/dev/null || { log "Installing yarn"; sudo npm i -g yarn; }
# Backstage supports EVEN LTS releases only (20 / 22 / 24 at time of writing).
# ">= 20" is the wrong test: Node 26 is too NEW and create-app fails on it.
#
# mise.toml in the repo root pins Node 22, but mise only rewrites PATH when it is
# activated in your shell. Under 'make' (or any non-interactive shell) it is not, so
# resolve the pinned version ourselves rather than failing on the global default.
node_major() { node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/'; }
NODE_MAJOR=$(node_major)
if { [ $((NODE_MAJOR % 2)) -ne 0 ] || [ "$NODE_MAJOR" -gt 24 ]; } && command -v mise >/dev/null; then
  for v in 22 24 20; do
    NODE_DIR=$(mise where "node@$v" 2>/dev/null) || continue
    [ -x "$NODE_DIR/bin/node" ] || continue
    log "Using mise-pinned Node $v from $NODE_DIR (shell default is $(node -v))"
    export PATH="$NODE_DIR/bin:$PATH"
    NODE_MAJOR=$(node_major)
    break
  done
fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Backstage needs Node 20+ (you have $(node -v))"
elif [ $((NODE_MAJOR % 2)) -ne 0 ] || [ "$NODE_MAJOR" -gt 24 ]; then
  warn "Node $(node -v) is not a version Backstage supports (it wants an even LTS: 20/22/24)."
  if command -v mise >/dev/null; then
    warn "You have mise. Pin a supported Node just for this directory:"
    warn "    cd $LAB_HOME && mise use node@22 && exec \$SHELL"
  else
    warn "Install Node 22 (nvm/mise/fnm) and re-run 'make portal'."
  fi
  die "refusing to scaffold Backstage on an unsupported Node — see above"
fi

# ── 1. scaffold the app ──────────────────────────────────────────────────
if [ ! -d "$APP" ]; then
  log "Creating the Backstage app (~5-10 min, lots of npm)"
  mkdir -p "$LAB_HOME"
  # create-app has no --name flag and ALWAYS prompts for the app name, so it hangs
  # forever when run non-interactively. Feed the name on stdin.
  # --skip-install: create-app writes .yarnrc.yml and THEN installs, and the
  # generated config sets 'npmMinimalAgeGate: 3d' which rejects any dependency
  # published in the last 3 days. Backstage's own scaffolder-backend depends on
  # 'nunjitsu', which is often newer than that, so the bundled install dies with a
  # misleading "All versions ... are quarantined". Scaffold first, fix the policy,
  # then install ourselves.
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
[ -d "$APP/packages/backend" ] || die "create-app did not finish — remove $APP and re-run"

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
    print('    !! could not find backend.start() — add this line yourself:')
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

# Keep credentials in one place: rewrite the config from lab.env, not by hand.
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
    warn "no .gitea-token — run 'make gitea' first"
  fi
  log "Applying the golden-path ApplicationSet"
  sed -e "s|gitea.lab|${GITEA_HOST}|g" -e "s|owner: services|owner: ${GITEA_ORG}|" \
    "$REPO_ROOT/examples/argocd-appset-gitea-scm.yaml" \
    | kubectl --context "kind-$CLUSTER" apply -f -
else
  warn "argocd namespace missing — run 'make gitops', then re-run 'make portal'"
fi

cat <<INFO

  Start Backstage:   cd $APP && yarn start      → http://localhost:3000
  (Gitea moved to host port ${GITEA_PORT} to free 3000; http://${GITEA_HOST}:3000 works from both.)

  The loop to run, end to end:
    1. Create → choose "Golden path service" → name it e.g. 'payments'
    2. Watch the repo appear:   http://${GITEA_HOST}:3000/${GITEA_USER}/payments
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
