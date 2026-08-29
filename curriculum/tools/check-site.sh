#!/usr/bin/env bash
# Assert a staged copy of the study console is complete and self-contained.
#
#     tools/check-site.sh <site-dir>
#
# Env:
#   SITE_DOMAIN   hostname expected in CNAME (default cnpe.rbstp.dev)
#   SYNC_DOMAIN   sync Worker hostname expected in sync.js (default sync.rbstp.dev)
set -euo pipefail

SITE="${1:?usage: check-site.sh <site-dir>}"
SITE_DOMAIN="${SITE_DOMAIN:-cnpe.rbstp.dev}"
SYNC_DOMAIN="${SYNC_DOMAIN:-sync.rbstp.dev}"

for f in index.html mock-exam.html mock-exam-2.html drill.html console.html 404.html CNAME \
         assets/style.css assets/app.js assets/nav.js assets/widgets.js \
         assets/theme.js assets/favicon.svg assets/drill-data.js assets/drill-index.js \
         assets/drill.js assets/merge.js assets/sync.js; do
  test -s "$SITE/$f" || { echo "missing or empty: $f"; exit 1; }
done
test -f "$SITE/.nojekyll" || { echo "missing: .nojekyll"; exit 1; }

# 29 sections + index + 2 mock exams + drill + console + 404
n=$(find "$SITE" -name '*.html' | wc -l | tr -d ' ')
test "$n" -eq 35 || { echo "expected 35 html files, found $n"; exit 1; }

# the bundle must be self-contained: no sidecar asset references
if grep -qE '<(link|script)[^>]+(href|src)="assets/' "$SITE/console.html"; then
  echo "console.html references sidecar assets"; exit 1
fi
grep -q "$SITE_DOMAIN" "$SITE/CNAME" || { echo "CNAME does not carry $SITE_DOMAIN"; exit 1; }

# Optional sync must be opt-in and same-registrable-domain: assert the client
# points at the configured Worker origin, in the assets and in the bundle.
for f in assets/sync.js console.html; do
  grep -q "https://$SYNC_DOMAIN" "$SITE/$f" ||
    { echo "$f does not point at https://$SYNC_DOMAIN"; exit 1; }
done

# widgets.js is 52 KB and twelve pages draw a figure, so it ships per page. A page
# that forgot the tag just renders nothing, so assert the pairing here.
while IFS= read -r f; do
  case "${f#"$SITE"/}" in console.html|404.html) continue;; esac
  has_fig=$(grep -c 'class="widget"' "$f" || true)
  has_tag=$(grep -c 'assets/widgets\.js' "$f" || true)
  if test "$has_fig" -gt 0 && test "$has_tag" -eq 0; then
    echo "${f#"$SITE"/} draws a figure but does not load widgets.js"; exit 1
  fi
  if test "$has_fig" -eq 0 && test "$has_tag" -gt 0; then
    echo "${f#"$SITE"/} loads widgets.js but draws no figure"; exit 1
  fi
done < <(find "$SITE" -name '*.html')

# Only the drill renders a card, so only the drill may pull the 67 KB bank.
grep -q 'assets/drill-index\.js' "$SITE/index.html" ||
  { echo "index.html does not load the drill index"; exit 1; }
for f in index.html mock-exam.html mock-exam-2.html; do
  grep -q 'assets/drill-data\.js' "$SITE/$f" &&
    { echo "$f pulls the full drill bank; it only needs assets/drill-index.js"; exit 1; }
done
grep -q 'assets/drill-data\.js' "$SITE/drill.html" ||
  { echo "drill.html does not load the drill bank"; exit 1; }

# Every asset a page pulls must carry its content stamp, and so must every font
# the stylesheet pulls. Without one, Pages' ten-minute cache decides when a deploy
# takes effect, per file: a browser can hold the new HTML and the old bundle at
# the same time.
while IFS= read -r f; do
  unstamped=$(grep -oE '(href|src)="[^"]*assets/[^"]+"' "$f" | grep -v '?v=' || true)
  test -z "$unstamped" ||
    { echo "unstamped asset reference in ${f#"$SITE"/}: $unstamped"; exit 1; }
done < <(find "$SITE" -name '*.html')
unstamped=$(grep -oE 'url\("fonts/[^"]+"\)' "$SITE/assets/style.css" | grep -v '?v=' || true)
test -z "$unstamped" || { echo "unstamped font reference in style.css: $unstamped"; exit 1; }

# Every page's theme-color pair must carry the grounds the stylesheet paints.
dk=$(grep -o -- '--dk-ink: *#[0-9A-Fa-f]*' "$SITE/assets/style.css" | grep -o '#[0-9A-Fa-f]*')
lt=$(grep -o -- '--lt-ink: *#[0-9A-Fa-f]*' "$SITE/assets/style.css" | grep -o '#[0-9A-Fa-f]*')
{ test -n "$dk" && test -n "$lt"; } || { echo "could not read --dk-ink/--lt-ink from style.css"; exit 1; }
while IFS= read -r f; do
  { grep -q "name=\"theme-color\" content=\"$dk\" media=\"(prefers-color-scheme: dark)\"" "$f" &&
    grep -q "name=\"theme-color\" content=\"$lt\" media=\"(prefers-color-scheme: light)\"" "$f"; } ||
    { echo "theme-color metas out of sync with style.css grounds: ${f#"$SITE"/}"; exit 1; }
done < <(find "$SITE" -name '*.html')
# theme.js keeps its own copy of the pair, which must match too
grep -q "dark: \"$dk\", light: \"$lt\"" "$SITE/assets/theme.js" ||
  { echo "theme.js CHROME pair out of sync with style.css grounds"; exit 1; }

echo "staged site looks right ($n pages)"
