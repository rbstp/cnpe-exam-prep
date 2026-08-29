#!/usr/bin/env python3
"""Cut the shipped faces down to the characters the console actually writes.

    python3 tools/subset-fonts.py            # rewrite assets/fonts/*.woff2
    python3 tools/subset-fonts.py --check    # exit 1 if the cut no longer holds

tools/fonts-src/ holds the faces as they arrived, and is not staged; assets/fonts/
holds what the site serves. Subsetting needs fonttools and brotli, so it happens
here and the result is committed. The cut writes everything --check needs into
cut.txt, so --check reads no font file and CI needs no font library.
"""
import glob, hashlib, html, os, subprocess, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "fonts-src")
OUT = os.path.join(ROOT, "assets", "fonts")
CUT = os.path.join(SRC, "cut.txt")

# Text the site puts on screen without spelling it anywhere this scan can read:
# sync.js formats a time in the visitor's locale, and some locales separate with
# these rather than a plain space.
KEEP_ANYWAY = {0x00A0, 0x2009}


def sources():
    """Every file that can put a character on screen, in the order they are scanned."""
    paths = [p for p in sorted(glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True))
             # tools/ and a locally built bundle are not part of what Pages serves
             if not p.startswith(HERE + os.sep) and os.path.basename(p) != "cnpe-console.html"]
    paths += sorted(glob.glob(os.path.join(ROOT, "assets", "*.js")))
    paths += sorted(glob.glob(os.path.join(ROOT, "assets", "*.css")))
    # 404.html is generated at staging time, so its prose lives in the staging script
    paths.append(os.path.join(HERE, "stage-site.sh"))
    return paths


def used():
    chars = set()
    for path in sources():
        # Entities reach the page as characters, and the scripts write them too
        # (app.js builds markup carrying &nbsp;), so unescape everything. It can
        # only over-approximate, which costs a spare glyph and never a missing one.
        chars |= set(html.unescape(open(path, encoding="utf-8").read()))
    # Cc/Cf carry no glyph, and a stray NUL would not survive the argv below.
    return {c for c in chars if unicodedata.category(c)[0] != "C"}


def faces():
    """Every face the cut runs on and produces, as (tag, name, sha256)."""
    for tag, d in (("src", SRC), ("out", OUT)):
        for path in sorted(glob.glob(os.path.join(d, "*.woff2"))):
            yield tag, os.path.basename(path), hashlib.sha256(
                open(path, "rb").read()).hexdigest()


def read_cut():
    if not os.path.exists(CUT):
        sys.exit("tools/fonts-src/cut.txt is missing: run tools/subset-fonts.py")
    listed, cuts, seal = [], [], None
    for n, line in enumerate(open(CUT, encoding="utf-8"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if fields[0] in ("src", "out") and len(fields) == 3:
            listed.append(tuple(fields))
        elif fields[0] == "cut" and len(fields) > 1:
            cuts.append(line.split(None, 1)[1])
        elif fields[0] == "codepoints" and len(fields) == 2:
            seal = fields[1]
        else:
            sys.exit("tools/fonts-src/cut.txt:%d: cannot read %r" % (n, line))
    # A merge that drops a line from the list below would otherwise leave a
    # check that still passes and no longer covers what it says it covers.
    if seal != sealed(cuts):
        sys.exit("tools/fonts-src/cut.txt does not match its own codepoint list: " + RECUT)
    return listed, {chr(int(c.split()[0], 16)) for c in cuts}


def sealed(cuts):
    return hashlib.sha256("\n".join(cuts).encode()).hexdigest()


def name(cp):
    return "U+%04X %s" % (cp, unicodedata.name(chr(cp), "?"))


RECUT = "run tools/subset-fonts.py and commit assets/fonts/ with tools/fonts-src/cut.txt"

if "--check" in sys.argv:
    listed, dropped = read_cut()
    # The codepoints below are only worth trusting if they describe the faces
    # actually in the tree: a face changed or added without a re-cut fails here.
    if listed != list(faces()):
        sys.exit("the shipped fonts no longer match tools/fonts-src/cut.txt: " + RECUT)
    lost = sorted(used() & dropped)
    if lost:
        sys.exit("the shipped fonts no longer cover %s: %s"
                 % (", ".join(name(ord(c)) for c in lost), RECUT))
    print("%d faces match the cut, and it covers every character the site uses"
          % (len(listed) // 2))
    sys.exit(0)

from fontTools.ttLib import TTFont      # only the cut needs it, not --check

keep = "".join(sorted(used() | {chr(cp) for cp in KEEP_ANYWAY}))
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

# Anything category C was filtered out of the used set too, so listing it here
# would be a line the check could never act on.
dropped = sorted(cp for cp in covered - kept if unicodedata.category(chr(cp))[0] != "C")

cuts = ["%04X  %s" % (cp, unicodedata.name(chr(cp), "?")) for cp in dropped]
with open(CUT, "w", encoding="utf-8") as fh:
    fh.write("# Written by tools/subset-fonts.py, and read by its --check.\n"
             "#\n"
             "# The faces the cut ran on and the faces it produced. --check re-hashes\n"
             "# both, so a face that changed without a re-cut, or a record edited by\n"
             "# hand, fails before the codepoints below are trusted.\n")
    for record in faces():
        fh.write("%s %s %s\n" % record)
    fh.write("#\n"
             "# Codepoints the cut removed from those faces. --check fails when the\n"
             "# site reaches for one of them again, and when this list does not hash\n"
             "# to the seal below.\n")
    fh.write("codepoints %s\n" % sealed(cuts))
    for line in cuts:
        fh.write("cut %s\n" % line)

print("subset %d faces to %d characters: %.0f KB -> %.0f KB (%d codepoints dropped)"
      % (len(glob.glob(os.path.join(SRC, "*.woff2"))), len(kept),
         before / 1024, after / 1024, len(dropped)))
