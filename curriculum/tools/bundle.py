#!/usr/bin/env python3
"""Bundle the curriculum into one self-contained HTML file.

Every page's <article> is inlined into a hash-routed single file, together with
the stylesheet, the section manifest, the widgets and the page runtime. Useful
for sharing the console as one file, or for previewing it somewhere that only
takes a single document.

    python3 tools/bundle.py [out.html]        # run from curriculum/
"""
import os, re, sys, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "cnpe-console.html")

def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as fh:
        return fh.read()

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

parts, seen = [], {}
for p in pages:
    key, exam, art = article_of(p)
    seen[key] = (p, exam)
    parts.append("  %s: %s," % (js_key := ('"%s"' % key), "`" + art.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"))

bundle = """<title>CNPE study console</title>
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
(function () {
  var view = document.getElementById("view");
  function keyFromHash() {
    var h = (location.hash || "#index").slice(1);
    return window.CNPE_PAGES[h] ? h : "index";
  }
  function render() {
    var k = keyFromHash();
    document.body.setAttribute("data-root", "");
    if (k === "index") { document.body.removeAttribute("data-id"); }
    else { document.body.setAttribute("data-id", k); }
    if (window.CNPE_EXAM_KEYS.indexOf(k) >= 0) document.body.setAttribute("data-exam", "");
    else document.body.removeAttribute("data-exam");
    view.innerHTML = window.CNPE_PAGES[k];
    window.CNPE_BOOT();
    window.scrollTo(0, 0);
  }
  addEventListener("hashchange", render);
  // in-page links that point at other pages of the site become hash routes
  addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^(https?:|mailto:|#)/.test(href)) return;
    e.preventDefault();
    var file = href.split("#")[0].replace(/^(\\.\\.\\/)+/, "");
    if (file === "index.html" || file === "") { location.hash = "#index"; return; }
    for (var k in window.CNPE_PAGES) {
      if (k !== "index" && (window.CNPE_NAV.filter(function (n) { return n.id === k; })[0] || {}).path === file) {
        location.hash = "#" + k; return;
      }
    }
  });
  render();
})();
</script>
""" % (
    read("assets/style.css"),
    read("assets/nav.js"),
    "\n".join(parts),
    '["EX"]',
    read("assets/widgets.js") if os.path.exists(os.path.join(ROOT, "assets/widgets.js")) else "",
    read("assets/app.js"),
)

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(bundle)
print("wrote %s (%.0f KB, %d pages)" % (OUT, len(bundle) / 1024, len(pages)))
