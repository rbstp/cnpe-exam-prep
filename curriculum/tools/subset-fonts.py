#!/usr/bin/env python3
"""Cut the shipped faces down to the characters the console actually writes.

    python3 tools/subset-fonts.py            # rewrite assets/fonts/*.woff2
    python3 tools/subset-fonts.py --check    # exit 1 if the site outgrew the cut

tools/fonts-src/ holds the faces as they arrived, and is not staged; assets/fonts/
holds what the site serves. Subsetting needs fonttools and brotli, so it happens
here and the result is committed. dropped.txt records every codepoint the cut
removed, which is what --check reads: no font parsing, no dependency, and it
fires exactly when new prose reaches for a glyph the shipped faces no longer
carry (a character the faces never covered was already falling back to a system
font, and is not a regression).
"""
import glob, html, os, subprocess, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "fonts-src")
OUT = os.path.join(ROOT, "assets", "fonts")
DROPPED = os.path.join(SRC, "dropped.txt")


def used():
    """Every character the site can put on screen, from its pages and its scripts."""
    chars = set()
    for path in (sorted(glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True))
                 + sorted(glob.glob(os.path.join(ROOT, "assets", "*.js")))
                 + sorted(glob.glob(os.path.join(ROOT, "assets", "*.css")))):
        # tools/ and a locally built bundle are not part of what Pages serves
        if path.startswith(HERE + os.sep) or os.path.basename(path) == "cnpe-console.html":
            continue
        text = open(path, encoding="utf-8").read()
        chars |= set(html.unescape(text) if path.endswith(".html") else text)
    # Cc/Cf carry no glyph, and a stray NUL would not survive the argv below.
    return {c for c in chars if unicodedata.category(c)[0] != "C"}


def name(cp):
    return "U+%04X %s" % (cp, unicodedata.name(chr(cp), "?"))


def dropped(covered, kept):
    """Codepoints the cut removed, minus the ones no prose could reach for anyway."""
    return sorted(cp for cp in covered - kept if unicodedata.category(chr(cp))[0] != "C")


def read_dropped():
    if not os.path.exists(DROPPED):
        sys.exit("tools/fonts-src/dropped.txt is missing: run tools/subset-fonts.py")
    out = set()
    for line in open(DROPPED, encoding="utf-8"):
        line = line.split("#")[0].strip()
        if line:
            out.add(chr(int(line, 16)))
    return out


if "--check" in sys.argv:
    lost = sorted(used() & read_dropped())
    if lost:
        sys.exit("the shipped fonts no longer cover %s: run tools/subset-fonts.py "
                 "and commit assets/fonts/" % ", ".join(name(ord(c)) for c in lost))
    print("shipped fonts cover every character the site uses")
    sys.exit(0)

from fontTools.ttLib import TTFont      # only the cut needs it, not --check

keep = "".join(sorted(used()))
covered, kept, before, after = set(), set(), 0, 0
os.makedirs(OUT, exist_ok=True)
for src in sorted(glob.glob(os.path.join(SRC, "*.woff2"))):
    dst = os.path.join(OUT, os.path.basename(src))
    covered |= set(TTFont(src).getBestCmap())
    subprocess.run([sys.executable, "-m", "fontTools.subset", src,
                    "--text=" + keep, "--layout-features=*",
                    "--flavor=woff2", "--output-file=" + dst],
                   check=True, stdout=subprocess.DEVNULL)
    kept |= set(TTFont(dst).getBestCmap())
    before += os.path.getsize(src)
    after += os.path.getsize(dst)

with open(DROPPED, "w", encoding="utf-8") as fh:
    fh.write("# Codepoints tools/subset-fonts.py cut from the faces in this directory.\n"
             "# --check fails when the site reaches for one of them again.\n")
    for cp in dropped(covered, kept):
        fh.write("%04X  # %s\n" % (cp, unicodedata.name(chr(cp), "?")))

print("subset %d faces to %d characters: %.0f KB -> %.0f KB (%d codepoints dropped)"
      % (len(glob.glob(os.path.join(SRC, "*.woff2"))), len(kept),
         before / 1024, after / 1024, len(dropped(covered, kept))))
