#!/usr/bin/env bash
# Stage the study console for static hosting (GitHub Pages).
#
# The source tree in curriculum/ stays exactly as it is: every page keeps its
# relative links so file:// and 'make study' keep working. Everything that only
# makes sense for the hosted copy (CNAME, .nojekyll, an absolute-path 404,
# the single-file bundle) is produced here, in the publish step.
#
#     tools/stage-site.sh [outdir]        # default: ../_site
#
# Env:
#   SITE_DOMAIN   hostname written to CNAME (default cnpe.rbstp.dev)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(dirname "$HERE")"
TARGET="${1:-$SRC/../_site}"
OUT="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"
SITE_DOMAIN="${SITE_DOMAIN:-cnpe.rbstp.dev}"

rm -rf "$OUT"
mkdir -p "$OUT"

# The site itself: every page and asset, minus the build tooling and repo docs.
tar -cf - -C "$SRC" \
    --exclude=./tools \
    --exclude=./README.md \
    --exclude=./cnpe-console.html \
    . | tar -xf - -C "$OUT"

# One-URL offline copy of the whole console.
python3 "$SRC/tools/bundle.py" "$OUT/console.html" >/dev/null
echo "console.html   $(du -h "$OUT/console.html" | cut -f1)"

# Pages serves the artifact verbatim, but .nojekyll costs nothing and keeps the
# behaviour identical if this is ever published from a branch instead.
: > "$OUT/.nojekyll"

# Carried in the artifact so a deploy can never silently drop the custom domain.
printf '%s\n' "$SITE_DOMAIN" > "$OUT/CNAME"

# Served for any missing path at any depth, so its links must be root-absolute.
cat > "$OUT/404.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0C1014" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F1F4F8" media="(prefers-color-scheme: light)">
<title>Not found · CNPE study console</title>
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<script src="/assets/theme.js"></script>
</head>
<body>
<div class="wrap"><div class="cols">
<article>
  <header class="pagehead">
    <div class="eyebrow"><span class="badge d4">404</span><span>no page at this address</span></div>
    <h1>Nothing here</h1>
    <p class="sum">That path is not part of the study console. Section pages look like
      <code>/01-architecture/01-networking.html</code>: five numbered domain directories,
      each holding its numbered sections.</p>
  </header>
  <div class="finish" style="margin-top:0">
    <div class="txt">The dashboard lists all 29 sections, both mock exams and the drill, and remembers where you left off.</div>
    <a class="tbtn" href="/">▶ Go to the dashboard</a>
    <a class="tbtn ghost" href="/console.html">Single-file console</a>
  </div>
</article>
</div></div>
</body>
</html>
HTML

echo "staged         $OUT"
echo "pages          $(find "$OUT" -name '*.html' | wc -l | tr -d ' ') html files, CNAME=$SITE_DOMAIN"
