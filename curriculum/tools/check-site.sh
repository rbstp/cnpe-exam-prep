#!/usr/bin/env bash
# Assert a staged copy of the study console is complete and self-contained.
# Shared by CI (pull requests) and the Pages deploy so the two cannot drift:
# whatever gate protects master is the same gate that protects the deploy.
#
#     tools/check-site.sh <site-dir>
#
# Env:
#   SITE_DOMAIN   hostname expected in CNAME (default cnpe.rbstp.dev)
set -euo pipefail

SITE="${1:?usage: check-site.sh <site-dir>}"
SITE_DOMAIN="${SITE_DOMAIN:-cnpe.rbstp.dev}"

for f in index.html mock-exam.html mock-exam-2.html drill.html console.html 404.html CNAME \
         assets/style.css assets/app.js assets/nav.js assets/widgets.js \
         assets/theme.js assets/favicon.svg assets/drill-data.js assets/drill.js; do
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
echo "staged site looks right ($n pages)"
