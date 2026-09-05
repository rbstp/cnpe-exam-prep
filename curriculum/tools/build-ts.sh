#!/usr/bin/env bash
# Compile the console's TypeScript into curriculum/assets/.
#
#     tools/build-ts.sh            # rewrite the compiled scripts under assets/
#     tools/build-ts.sh --check    # exit 1 if the committed output no longer matches
#
# Two source directories, each a set of plain scripts with its own tsconfig:
# src/game/ (the quest) and src/console/ (merge.js and syntax.js, the DOM-free
# modules). The compiled scripts are committed, so the site still needs no build
# step and file:// still works; --check is what keeps them honest, the way
# extract-drill.py --check keeps the drill bank honest. Needs typescript (npm ci).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
DIRS=(game console)

# every .ts in a source directory compiles to the .js of the same name in assets/
outputs() {                                    # outputs <dir>
  local f
  for f in "$ROOT/src/$1"/*.ts; do
    [ -e "$f" ] || continue
    basename "${f%.ts}.js"
  done
}

if [ "${1:-}" = "--check" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  stale=0
  for d in "${DIRS[@]}"; do
    [ -d "$ROOT/src/$d" ] || continue
    npx tsc -p "$ROOT/src/$d/tsconfig.json" --outDir "$tmp/$d"
    while IFS= read -r js; do
      cmp -s "$tmp/$d/$js" "$ROOT/assets/$js" ||
        { echo "assets/$js does not match src/$d/${js%.js}.ts: run make ts and commit the result"; stale=1; }
    done < <(outputs "$d")
  done
  [ "$stale" -eq 0 ] || exit 1
  echo "the compiled scripts match their TypeScript"
  exit 0
fi

for d in "${DIRS[@]}"; do
  [ -d "$ROOT/src/$d" ] || continue
  npx tsc -p "$ROOT/src/$d/tsconfig.json"
  while IFS= read -r js; do
    test -s "$ROOT/assets/$js" || { echo "tsc wrote no assets/$js"; exit 1; }
  done < <(outputs "$d")
  echo "compiled src/$d/ into assets/: $(outputs "$d" | tr '\n' ' ')"
done
