#!/usr/bin/env python3
"""Bundle the curriculum into one self-contained HTML file.

    python3 tools/bundle.py [out.html] [--fragment]

--fragment omits the document skeleton for hosts that supply their own.
"""
import base64, os, re, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
FRAGMENT = "--fragment" in sys.argv
OUT = args[0] if args else os.path.join(ROOT, "cnpe-console.html")

def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as fh:
        return fh.read()

def inline_fonts(css):
    """Turn url("fonts/x.woff2") into a data: URI so the bundle needs no sidecar files."""
    def sub(m):
        path = os.path.join(ROOT, "assets", m.group(1))
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        return 'url("data:font/woff2;base64,%s")' % b64
    return re.sub(r'url\("(fonts/[^"]+\.woff2)"\)', sub, css)


def article_of(page):
    src = read(page)
    m = re.search(r"<article[^>]*>(.*?)</article>", src, re.S)
    if not m:
        raise SystemExit("no <article> in " + page)
    body_attrs = re.search(r"<body([^>]*)>", src).group(1)
    ident = re.search(r'data-id="([^"]*)"', body_attrs)
    exam = "data-exam" in body_attrs
    return (ident.group(1) if ident else "index"), exam, m.group(1)

# the section manifest drives which pages exist
nav = read("assets/nav.js")
paths = re.findall(r'path:\s*"([^"]+)"', nav)
pages = ["index.html"] + paths

valid = set(re.findall(r'id:\s*"([^"]+)"', nav)) | {"index"}
parts, seen = [], {}
for p in pages:
    key, exam, art = article_of(p)
    if key not in valid:
        raise SystemExit("%s: data-id %r is not in the section manifest" % (p, key))
    if key in seen:
        raise SystemExit("%s and %s share data-id %r" % (p, seen[key][0], key))
    seen[key] = (p, exam)
    body = (art.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
               .replace("</script", "&lt;/script"))
    parts.append('  "%s": `%s`,' % (key, body))

def favicon_uri():
    with open(os.path.join(ROOT, "assets/favicon.svg"), "rb") as fh:
        return "data:image/svg+xml;base64," + base64.b64encode(fh.read()).decode("ascii")

# The theme-color metas must come before the theme script, which recolors them.
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#101010" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F4F4F4" media="(prefers-color-scheme: light)">
<meta name="description" content="An interactive study console for the Certified Cloud Native Platform Engineer (CNPE) exam: 29 sections across all five domains, hands-on exercises against a local lab, and two timed mock exams.">
<link rel="icon" type="image/svg+xml" href="%s">
""" % favicon_uri()

bundle = """<title>CNPE study console</title>
<script>
%s
</script>
<!-- /head -->
<style>
%s
</style>

<div class="wrap"><div class="cols">
  <article id="view"></article>
  <aside class="toc" id="toc"></aside>
</div></div>

<script>window.CNPE_BUNDLE = true;</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
window.CNPE_PAGES = {
%s
};
window.CNPE_EXAM_KEYS = %s;
</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
%s
</script>
<script>
(function () {
  var view = document.getElementById("view");
  function keyFromHash() {
    var h = (location.hash || "#index").slice(1);
    return window.CNPE_PAGES[h] ? h : "index";
  }
  var pendingFragment = "";
  function render() {
    var k = keyFromHash();
    document.body.setAttribute("data-root", "");
    if (k === "index") { document.body.removeAttribute("data-id"); }
    else { document.body.setAttribute("data-id", k); }
    if (window.CNPE_EXAM_KEYS.indexOf(k) >= 0) document.body.setAttribute("data-exam", "");
    else document.body.removeAttribute("data-exam");
    view.innerHTML = window.CNPE_PAGES[k];
    window.CNPE_BOOT();
    if (pendingFragment) {
      var el = document.getElementById(pendingFragment);
      pendingFragment = "";
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }
  addEventListener("hashchange", render);
  // in-page links that point at other pages of the site become hash routes
  addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^(https?:|mailto:|#)/.test(href)) return;
    var frag = href.split("#")[1] || "";
    var file = href.split("#")[0].replace(/^(\\.\\.\\/)+/, "");
    var target = null;
    if (file === "index.html" || file === "") target = "index";
    else {
      for (var k in window.CNPE_PAGES) {
        if (k !== "index" && (window.CNPE_NAV.filter(function (n) { return n.id === k; })[0] || {}).path === file) { target = k; break; }
      }
    }
    if (!target) return;                       // not a page of this bundle: let the browser have it
    e.preventDefault();
    pendingFragment = frag;
    if (location.hash === "#" + target) render(); else location.hash = "#" + target;
  });
  render();
})();
</script>
""" % (
    read("assets/theme.js"),
    inline_fonts(read("assets/style.css")),
    read("assets/nav.js"),
    read("assets/drill-data.js"),
    read("assets/merge.js"),
    "\n".join(parts),
    json.dumps(sorted(k for k, (_, ex) in seen.items() if ex)),
    read("assets/widgets.js") if os.path.exists(os.path.join(ROOT, "assets/widgets.js")) else "",
    # The page-shaped panels. Order does not matter here, unlike on the sidecar
    # pages: the bundle's own router calls CNPE_BOOT after every script has run.
    # It carries both, being every page at once, and boots per hash.
    read("assets/app-dash.js"),
    read("assets/app-exam.js"),
    read("assets/app.js"),
    read("assets/sync.js"),
    read("assets/drill.js"),
)

if not FRAGMENT:
    # the theme script has to run before anything paints, so it belongs in <head>
    head, rest = bundle.split("<!-- /head -->\n", 1)
    bundle = HEAD + head + "</head>\n<body>\n" + rest + "\n</body>\n</html>\n"
else:
    bundle = bundle.replace("<!-- /head -->\n", "")

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(bundle)
print("wrote %s (%.0f KB, %d pages, %s)"
      % (OUT, len(bundle) / 1024, len(pages), "fragment" if FRAGMENT else "standalone document"))
