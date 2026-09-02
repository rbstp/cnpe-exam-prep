#!/usr/bin/env bash
# Stage the study console for static hosting (GitHub Pages).
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
    --exclude=./jsconfig.json \
    --exclude=./assets/cnpe.d.ts \
    . | tar -xf - -C "$OUT"

python3 "$SRC/tools/bundle.py" "$OUT/console.html" >/dev/null
echo "console.html   $(du -h "$OUT/console.html" | cut -f1)"

: > "$OUT/.nojekyll"

printf '%s\n' "$SITE_DOMAIN" > "$OUT/CNAME"

# Served for any missing path at any depth, so its links must be root-absolute.
cat > "$OUT/404.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#171511" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F3EFE6" media="(prefers-color-scheme: light)">
<title>Not found · CNPE study console</title>
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<script src="/assets/theme.js"></script>
</head>
<body>
<div class="wrap"><div class="cols">
<article id="main" role="main" tabindex="-1">
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

# Pages serves every file with a ten-minute max-age, so without this a deploy
# arrives in pieces: the new HTML against a bundle the browser cached before it,
# for as long as that cache holds. Stamping each reference with a hash of the
# file's bytes changes the URL exactly when the file changes, and not otherwise,
# so a page and the assets it pulls are always the same version of the console.
sha() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-10
}
# sed -i takes a suffix on BSD and none on GNU, so write the copy ourselves.
rewrite() {                                    # rewrite <sed script> <file>
  sed -E "$1" "$2" > "$2.stamped" && mv "$2.stamped" "$2"
}

# The stylesheet's own font URLs go first, so that a changed font changes
# style.css, and the stamp every page carries for style.css changes with it.
fonts=""
for f in "$OUT"/assets/fonts/*.woff2; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  fonts+="s#url\(\"fonts/${name//./\\.}\"\)#url(\"fonts/$name?v=$(sha "$f")\")#g;"
done
[ -z "$fonts" ] || rewrite "$fonts" "$OUT/assets/style.css"

script=""
for a in "$OUT"/assets/*.css "$OUT"/assets/*.js "$OUT"/assets/*.svg; do
  [ -e "$a" ] || continue
  name="$(basename "$a")"
  # href="assets/x", href="../assets/x" and 404.html's root-absolute href="/assets/x"
  script+="s#(href|src)=\"((\.\./)*|/)assets/${name//./\\.}\"#\1=\"\2assets/$name?v=$(sha "$a")\"#g;"
done
while IFS= read -r -d "" f; do
  rewrite "$script" "$f"
done < <(find "$OUT" -name '*.html' -print0)

echo "staged         $OUT"
echo "pages          $(find "$OUT" -name '*.html' | wc -l | tr -d ' ') html files, CNAME=$SITE_DOMAIN"
