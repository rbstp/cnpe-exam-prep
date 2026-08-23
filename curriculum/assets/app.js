/* CNPE curriculum — page runtime.
   Builds the chrome from nav.js, wires copy buttons, progress, TOC, palette and keys.
   Everything persists in localStorage; nothing here needs a server (file:// works). */
(function () {
  "use strict";

  var NAV = window.CNPE_NAV || [];
  var DOMAINS = window.CNPE_DOMAINS || [];
  var body = document.body;
  var ROOT = body.getAttribute("data-root") || "";
  var PAGE_ID = body.getAttribute("data-id") || null;
  var entry = NAV.filter(function (n) { return n.id === PAGE_ID; })[0] || null;
  var KEY = "cnpe:v2";

  /* ── storage ─────────────────────────────────────────────── */
  var store = (function () {
    var s = { ex: {}, done: {}, exam: {}, last: null };
    try { var raw = localStorage.getItem(KEY); if (raw) s = Object.assign(s, JSON.parse(raw)); } catch (e) {}
    return s;
  })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

  function exKey(id, i) { return id + "#" + i; }
  function sectionCounts(id) {
    var total = 0, done = 0;
    Object.keys(store.ex).forEach(function (k) {
      if (k.indexOf(id + "#") === 0) { total++; if (store.ex[k]) done++; }
    });
    return { total: total, done: done };
  }
  function overall() {
    var secs = NAV.filter(function (n) { return n.d > 0; });
    var done = secs.filter(function (n) { return store.done[n.id]; }).length;
    return { done: done, total: secs.length, pct: secs.length ? Math.round(done / secs.length * 100) : 0 };
  }

  /* ── small helpers ───────────────────────────────────────── */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function domainOf(n) { return DOMAINS.filter(function (d) { return d.n === n; })[0]; }
  function href(path) { return ROOT + path; }

  /* ── top bar ─────────────────────────────────────────────── */
  function buildTopbar() {
    var d = entry ? domainOf(entry.d) : null;
    var bar = el("div", "topbar");
    var inner = el("div", "inner");

    var logo = el("a", "logo", '<span class="dot"></span>CNPE <span class="sub">study console</span>');
    logo.href = href("index.html");
    inner.appendChild(logo);

    var crumbs = el("div", "crumbs");
    if (entry) {
      crumbs.innerHTML =
        '<span class="sep">/</span><a href="' + href("index.html") + '">' + (d ? "Domain " + d.n : "Exam") + "</a>" +
        '<span class="sep">/</span><span class="here">' + (entry.id === "EX" ? "Mock exam" : entry.id + " " + entry.title) + "</span>";
    } else {
      crumbs.innerHTML = '<span class="sep">/</span><span class="here">Overview</span>';
    }
    inner.appendChild(crumbs);
    inner.appendChild(el("div", "spacer"));

    var ov = overall();
    var prog = el("div", "prog",
      '<span>' + ov.done + "/" + ov.total + '</span><span class="track"><i style="width:' + ov.pct + '%"></i></span>');
    inner.appendChild(prog);

    var sb = el("button", "searchbtn", '<span>⌕</span><span>Jump to section…</span><span class="k">/</span>');
    sb.type = "button";
    sb.addEventListener("click", openPalette);
    inner.appendChild(sb);

    var hb = el("button", "iconbtn", "?");
    hb.type = "button"; hb.title = "Keyboard shortcuts";
    hb.addEventListener("click", function () { toggleOverlay(helpOverlay); });
    inner.appendChild(hb);

    bar.appendChild(inner);
    body.insertBefore(bar, body.firstChild);
  }

  /* ── page head + stat tiles ──────────────────────────────── */
  function buildHead() {
    if (!entry) return;
    var head = document.querySelector(".pagehead");
    if (!head) return;
    var d = domainOf(entry.d);
    var eyebrow = head.querySelector(".eyebrow");
    var h1 = head.querySelector("h1");
    if (eyebrow) {
      eyebrow.innerHTML = d
        ? '<span class="badge d' + d.n + '">Domain ' + d.n + " · " + d.weight + "</span><span>" + d.name + "</span>"
        : '<span class="badge d2">Assessment</span><span>All five domains, 120 minutes</span>';
    }
    if (h1 && !h1.textContent.trim()) {
      h1.innerHTML = (entry.id === "EX" ? "" : '<span class="id">' + entry.id + "</span>") + entry.title;
    }
    var stats = document.querySelector(".stats");
    if (!stats) return;
    var c = sectionCounts(entry.id);
    var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    stats.innerHTML =
      tile("c", "Lab layers", entry.needs, true) +
      tile("p", "Session length", "~" + entry.mins + '<span class="u">min</span>', false) +
      tile("y", "Exam weight", d ? d.weight : "100%", false) +
      '<div class="stat g" id="stat-ex"><div class="lbl">Exercises verified</div><div class="val">' +
        c.done + '<span class="u">/ ' + c.total + '</span></div><div class="spark"><i style="width:' + pct + '%"></i></div></div>';
  }
  function tile(cls, label, value, small) {
    return '<div class="stat ' + cls + '"><div class="lbl">' + label + '</div><div class="val' + (small ? " sm" : "") + '">' + value + "</div></div>";
  }
  function refreshExTile() {
    var t = document.getElementById("stat-ex");
    if (!t || !entry) return;
    var c = sectionCounts(entry.id);
    var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    t.querySelector(".val").innerHTML = c.done + '<span class="u">/ ' + c.total + "</span>";
    t.querySelector(".spark i").style.width = pct + "%";
    var mini = document.querySelector(".toc .mini");
    if (mini) {
      mini.querySelector(".row span:last-child").textContent = c.done + "/" + c.total;
      mini.querySelector(".track i").style.width = pct + "%";
    }
  }

  /* ── code blocks: language bar, copy, light highlighting ─── */
  var KWS = /\b(kubectl|helm|flux|argocd|argo|tkn|kubeseal|cosign|skopeo|trivy|docker|git|curl|jq|kustomize|istioctl|linkerd|hubble|cilium|crossplane|stern|kubectx|make|yq|base64|sudo|watch|source|echo|sleep|grep|awk|sed|sort|head|tail|wc|seq|for|do|done|while|if|then|fi|export)\b/;
  function highlight(code, lang) {
    var html = code.innerHTML; // already entity-escaped in source
    var patterns = [
      { re: /(^|\n)([ \t]*#[^\n]*)/g, fn: function (m, a, b) { return a + '<span class="t-cm">' + b + "</span>"; } },
      { re: /('[^'\n]*'|"[^"\n]*")/g, fn: function (m) { return '<span class="t-str">' + m + "</span>"; } }
    ];
    // strings + comments first, tracked so later passes skip them
    var parts = [];
    var protectedRe = /(^|\n)([ \t]*#[^\n]*)|('[^'\n]*')|("[^"\n]*")/g;
    var out = "", last = 0, m;
    while ((m = protectedRe.exec(html)) !== null) {
      out += paint(html.slice(last, m.index), lang);
      if (m[2] != null) out += m[1] + '<span class="t-cm">' + m[2] + "</span>";
      else out += '<span class="t-str">' + m[0] + "</span>";
      last = m.index + m[0].length;
    }
    out += paint(html.slice(last), lang);
    code.innerHTML = out;
    void parts; void patterns;
  }
  function paint(s, lang) {
    if (!s) return s;
    if (lang === "yaml" || lang === "json") {
      s = s.replace(/(^|\n)([ \t-]*)([A-Za-z_][\w.\/-]*)(:)/g, '$1$2<span class="t-key">$3</span>$4');
      s = s.replace(/\b(true|false|null)\b/g, '<span class="t-kw">$1</span>');
      return s;
    }
    if (lang === "promql" || lang === "logql") {
      s = s.replace(/\b(sum|rate|increase|avg|count|max|min|by|without|histogram_quantile|absent|vector|topk|irate|delta|group_left|or|unless|and)\b/g, '<span class="t-kw">$1</span>');
      s = s.replace(/\b(\d+(\.\d+)?[smhdw]?)\b/g, '<span class="t-num">$1</span>');
      return s;
    }
    s = s.replace(KWS, function (m) { return '<span class="t-cmd">' + m + "</span>"; });
    s = s.replace(/(\s)(--?[A-Za-z][\w-]*)/g, '$1<span class="t-flag">$2</span>');
    s = s.replace(/(\$\{?[A-Za-z_][\w]*\}?)/g, '<span class="t-var">$1</span>');
    return s;
  }

  function buildCodeBlocks() {
    Array.prototype.forEach.call(document.querySelectorAll(".cb"), function (cb) {
      var lang = cb.getAttribute("data-lang") || "text";
      var code = cb.querySelector("code");
      var bar = el("div", "cb-bar", "<span>" + lang + '</span><span class="spacer"></span>');
      var btn = el("button", "copy-btn", "copy");
      btn.type = "button";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var text = code.textContent;
        var done = function () {
          btn.textContent = "copied"; btn.classList.add("ok");
          setTimeout(function () { btn.textContent = "copy"; btn.classList.remove("ok"); }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
        } else legacyCopy(text, done);
      });
      bar.appendChild(btn);
      cb.insertBefore(bar, cb.firstChild);
      if (code) { try { highlight(code, lang); } catch (e) {} }
    });
    // one-click copy for the "needs" chips
    Array.prototype.forEach.call(document.querySelectorAll(".needs code"), function (c) {
      c.title = "click to copy";
      c.addEventListener("click", function () {
        var t = c.textContent, old = c.textContent;
        var fin = function () { c.textContent = "copied ✓"; setTimeout(function () { c.textContent = old; }, 1100); };
        if (navigator.clipboard) navigator.clipboard.writeText(t).then(fin, fin); else fin();
      });
    });
  }
  function legacyCopy(text, cb) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta); cb();
  }

  /* ── exercises ───────────────────────────────────────────── */
  function buildExercises() {
    if (!entry) return;
    var list = document.querySelectorAll(".exercise");
    Array.prototype.forEach.call(list, function (ex, i) {
      var title = ex.getAttribute("data-title") || "Exercise " + (i + 1);
      var k = exKey(entry.id, i);
      if (!(k in store.ex)) store.ex[k] = 0;
      var body = ex.innerHTML;
      ex.innerHTML = "";
      var hdr = el("header", null,
        '<span class="dot"></span><h4>' + title + '</h4><span class="mark">' +
        (store.ex[k] ? "verified" : "mark verified") + '</span><span class="chev">▾</span>');
      var wrapDiv = el("div", "body", body);
      ex.appendChild(hdr); ex.appendChild(wrapDiv);
      if (store.ex[k]) ex.classList.add("done");
      hdr.querySelector(".mark").addEventListener("click", function (e) {
        e.stopPropagation();
        store.ex[k] = store.ex[k] ? 0 : 1; save();
        ex.classList.toggle("done", !!store.ex[k]);
        hdr.querySelector(".mark").textContent = store.ex[k] ? "verified" : "mark verified";
        refreshExTile();
      });
      hdr.addEventListener("click", function () {
        ex.classList.toggle("collapsed");
        hdr.querySelector(".chev").textContent = ex.classList.contains("collapsed") ? "▸" : "▾";
      });
    });
    save();
  }

  /* ── table of contents + scroll spy ──────────────────────── */
  function buildToc() {
    var toc = document.getElementById("toc");
    if (!toc) return;
    var heads = document.querySelectorAll("article .panel > .phdr h2");
    if (!heads.length) { toc.style.display = "none"; return; }
    var html = "<h4>On this page</h4>";
    Array.prototype.forEach.call(heads, function (h, i) {
      var panel = h.closest(".panel");
      if (!panel.id) panel.id = "p" + i;
      html += '<a href="#' + panel.id + '">' + h.textContent + "</a>";
    });
    if (entry) {
      var c = sectionCounts(entry.id);
      html += '<div class="mini"><div class="row"><span>exercises</span><span>' + c.done + "/" + c.total +
        '</span></div><div class="track"><i style="width:' + (c.total ? c.done / c.total * 100 : 0) + '%"></i></div></div>';
    }
    toc.innerHTML = html;

    var links = toc.querySelectorAll("a");
    var targets = Array.prototype.map.call(links, function (a) { return document.querySelector(a.getAttribute("href")); });
    function spy() {
      var y = window.scrollY + 120, idx = 0;
      targets.forEach(function (t, i) { if (t && t.offsetTop <= y) idx = i; });
      Array.prototype.forEach.call(links, function (a, i) { a.classList.toggle("active", i === idx); });
    }
    window.addEventListener("scroll", throttle(spy, 120)); spy();
  }
  function throttle(fn, ms) {
    var t = 0;
    return function () { var n = Date.now(); if (n - t > ms) { t = n; fn(); } };
  }

  /* ── pager + finish ──────────────────────────────────────── */
  function buildFooter() {
    if (!entry) return;
    var art = document.querySelector("article");
    if (!art) return;
    var idx = NAV.indexOf(entry);
    var prev = NAV[idx - 1], next = NAV[idx + 1];

    var fin = el("div", "finish");
    var done = !!store.done[entry.id];
    fin.innerHTML = '<div class="txt">Finished this section? Marking it complete updates the dashboard and your overall progress.</div>';
    var b = el("button", "tbtn" + (done ? " on" : ""), done ? "✓ Section complete" : "Mark section complete");
    b.type = "button";
    b.addEventListener("click", function () {
      store.done[entry.id] = store.done[entry.id] ? 0 : 1; save();
      b.className = "tbtn" + (store.done[entry.id] ? " on" : "");
      b.textContent = store.done[entry.id] ? "✓ Section complete" : "Mark section complete";
      var ov = overall();
      var p = document.querySelector(".topbar .prog");
      if (p) p.innerHTML = "<span>" + ov.done + "/" + ov.total + '</span><span class="track"><i style="width:' + ov.pct + '%"></i></span>';
    });
    fin.appendChild(b);
    if (next) {
      var nb = el("button", "tbtn ghost", "Next section →"); nb.type = "button";
      nb.addEventListener("click", function () { location.href = href(next.path); });
      fin.appendChild(nb);
    }
    art.appendChild(fin);

    var pager = el("div", "pager");
    pager.innerHTML =
      (prev ? '<a class="prev" href="' + href(prev.path) + '"><span class="dir">◀ previous</span>' + (prev.id === "EX" ? "" : prev.id + " ") + prev.title + "</a>"
            : '<a class="prev ghost">&nbsp;</a>') +
      (next ? '<a class="next" href="' + href(next.path) + '"><span class="dir">next ▶</span>' + (next.id === "EX" ? "" : next.id + " ") + next.title + "</a>"
            : '<a class="next" href="' + href("index.html") + '"><span class="dir">next ▶</span>Back to the dashboard</a>');
    art.appendChild(pager);

    store.last = entry.id; save();
  }

  /* ── command palette ─────────────────────────────────────── */
  var paletteOverlay, paletteInput, paletteList, paletteItems = [], paletteSel = 0;
  function buildPalette() {
    paletteOverlay = el("div", "overlay");
    var p = el("div", "palette");
    p.innerHTML =
      '<div class="pin"><span>⌕</span><input type="text" placeholder="Search sections, tools, concepts…" autocomplete="off" spellcheck="false"></div>' +
      "<ul></ul>" +
      '<div class="hint">↑↓ navigate · ⏎ open · esc close · type a tool name (kyverno, flux, spiffe…) to find its section</div>';
    paletteOverlay.appendChild(p);
    body.appendChild(paletteOverlay);
    paletteInput = p.querySelector("input");
    paletteList = p.querySelector("ul");
    paletteInput.addEventListener("input", function () { renderPalette(paletteInput.value); });
    paletteInput.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); paletteSel = Math.min(paletteSel + 1, paletteItems.length - 1); markSel(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); paletteSel = Math.max(paletteSel - 1, 0); markSel(); }
      else if (e.key === "Enter") { e.preventDefault(); go(paletteSel); }
    });
    paletteOverlay.addEventListener("click", function (e) { if (e.target === paletteOverlay) closeOverlays(); });
    renderPalette("");
  }
  function renderPalette(q) {
    q = (q || "").toLowerCase().trim();
    var items = NAV.filter(function (n) {
      if (!q) return true;
      var hay = (n.id + " " + n.title + " " + n.tags + " " + (domainOf(n.d) ? domainOf(n.d).name : "")).toLowerCase();
      return q.split(/\s+/).every(function (tok) { return hay.indexOf(tok) >= 0; });
    });
    paletteItems = items; paletteSel = 0;
    paletteList.innerHTML = items.map(function (n, i) {
      var d = domainOf(n.d);
      var hit = "";
      if (q) {
        var t = n.tags.split(/\s+/).filter(function (w) { return w.indexOf(q.split(/\s+/)[0]) === 0; }).slice(0, 4);
        if (t.length) hit = " · " + t.join(" ");
      }
      return '<li data-i="' + i + '"><span class="pid">' + n.id + '</span><span class="ptitle">' + n.title +
        '</span><span class="pmeta">' + (d ? "d" + d.n : "exam") + hit + "</span></li>";
    }).join("");
    Array.prototype.forEach.call(paletteList.children, function (li) {
      li.addEventListener("click", function () { go(+li.getAttribute("data-i")); });
      li.addEventListener("mousemove", function () { paletteSel = +li.getAttribute("data-i"); markSel(); });
    });
    markSel();
  }
  function markSel() {
    Array.prototype.forEach.call(paletteList.children, function (li, i) { li.classList.toggle("sel", i === paletteSel); });
    var s = paletteList.children[paletteSel];
    if (s && s.scrollIntoView) s.scrollIntoView({ block: "nearest" });
  }
  function go(i) {
    var n = paletteItems[i];
    if (n) location.href = href(n.path);
  }
  function openPalette() {
    closeOverlays();
    paletteOverlay.classList.add("open");
    paletteInput.value = ""; renderPalette(""); paletteInput.focus();
  }

  /* ── help overlay ────────────────────────────────────────── */
  var helpOverlay;
  function buildHelp() {
    helpOverlay = el("div", "overlay");
    var c = el("div", "helpcard");
    c.innerHTML = "<h3>Keyboard</h3><dl>" +
      "<dt>/ &nbsp;or&nbsp; ⌘K</dt><dd>jump to any section by name, tool or concept</dd>" +
      "<dt>n &nbsp;/&nbsp; p</dt><dd>next / previous section</dd>" +
      "<dt>d</dt><dd>back to the dashboard</dd>" +
      "<dt>x</dt><dd>jump to the exercises panel</dd>" +
      "<dt>c</dt><dd>collapse or expand every exercise</dd>" +
      "<dt>m</dt><dd>mark this section complete</dd>" +
      "<dt>?</dt><dd>this card</dd>" +
      "<dt>esc</dt><dd>close</dd></dl>" +
      '<p style="margin:16px 0 0;color:var(--fg-3);font-size:13.5px">Progress is stored in this browser only. ' +
      'Every code block has a copy button; the lab-layer chips at the top of a section copy their make command too.</p>';
    helpOverlay.appendChild(c);
    helpOverlay.addEventListener("click", function (e) { if (e.target === helpOverlay) closeOverlays(); });
    body.appendChild(helpOverlay);
  }
  function toggleOverlay(o) {
    var open = o.classList.contains("open");
    closeOverlays();
    if (!open) o.classList.add("open");
  }
  function closeOverlays() {
    Array.prototype.forEach.call(document.querySelectorAll(".overlay"), function (o) { o.classList.remove("open"); });
  }

  /* ── keyboard ────────────────────────────────────────────── */
  function keys() {
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if (e.key === "Escape") { closeOverlays(); return; }
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPalette(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      var idx = entry ? NAV.indexOf(entry) : -1;
      switch (e.key) {
        case "/": e.preventDefault(); openPalette(); break;
        case "?": toggleOverlay(helpOverlay); break;
        case "n": if (idx >= 0 && NAV[idx + 1]) location.href = href(NAV[idx + 1].path); break;
        case "p": if (idx > 0) location.href = href(NAV[idx - 1].path); break;
        case "d": location.href = href("index.html"); break;
        case "x": var ep = document.getElementById("exercises"); if (ep) ep.scrollIntoView(); break;
        case "c":
          var exs = document.querySelectorAll(".exercise");
          var anyOpen = Array.prototype.some.call(exs, function (x) { return !x.classList.contains("collapsed"); });
          Array.prototype.forEach.call(exs, function (x) {
            x.classList.toggle("collapsed", anyOpen);
            var ch = x.querySelector(".chev"); if (ch) ch.textContent = anyOpen ? "▸" : "▾";
          });
          break;
        case "m":
          var btn = document.querySelector(".finish .tbtn"); if (btn) { btn.click(); btn.scrollIntoView({ block: "center" }); }
          break;
      }
    });
  }

  /* ── index dashboard ─────────────────────────────────────── */
  function buildIndex() {
    var host = document.getElementById("domain-grid");
    if (!host) return;
    var ov = overall();
    var totalEx = Object.keys(store.ex).length, doneEx = Object.keys(store.ex).filter(function (k) { return store.ex[k]; }).length;
    var stats = document.querySelector(".stats");
    if (stats) {
      stats.innerHTML =
        '<div class="stat g"><div class="lbl">Sections complete</div><div class="val">' + ov.done +
          '<span class="u">/ ' + ov.total + '</span></div><div class="spark"><i style="width:' + ov.pct + '%"></i></div></div>' +
        tile("c", "Exercises verified", doneEx + '<span class="u">/ ' + (totalEx || "—") + "</span>", false) +
        tile("p", "Exam length", '120<span class="u">min</span>', false) +
        tile("y", "Tasks on the day", '15–20<span class="u">≈7 min each</span>', false) +
        tile("o", "Domains", "5", false);
    }
    host.innerHTML = DOMAINS.map(function (d) {
      var secs = NAV.filter(function (n) { return n.d === d.n; });
      var done = secs.filter(function (n) { return store.done[n.id]; }).length;
      var pct = Math.round(done / secs.length * 100);
      return '<div class="dcard"><header><span class="badge d' + d.n + '">D' + d.n + '</span><h3>' + d.name +
        '</h3><span class="w">' + d.weight + "</span></header><ol>" +
        secs.map(function (n) {
          return '<li><a class="' + (store.done[n.id] ? "done" : "") + '" href="' + href(n.path) + '">' +
            '<span class="sid">' + n.id + '</span><span class="st">' + n.title + '</span><span class="tick"></span></a></li>';
        }).join("") +
        '</ol><div class="foot"><span>' + done + "/" + secs.length + '</span><span class="track"><i style="width:' + pct +
        '%"></i></span><span>' + pct + "%</span></div></div>";
    }).join("");

    var resume = document.getElementById("resume");
    if (resume) {
      var last = store.last ? NAV.filter(function (n) { return n.id === store.last; })[0] : null;
      var nextUp = NAV.filter(function (n) { return n.d > 0 && !store.done[n.id]; })[0];
      var target = last || nextUp;
      if (target) {
        resume.innerHTML = '<a class="tbtn" style="text-decoration:none" href="' + href(target.path) + '">▶ ' +
          (last ? "Resume " : "Start ") + target.id + " · " + target.title + "</a>";
      }
    }
    var reset = document.getElementById("reset-progress");
    if (reset) reset.addEventListener("click", function () {
      if (confirm("Clear all section and exercise progress stored in this browser?")) {
        store = { ex: {}, done: {}, exam: {}, last: null }; save(); location.reload();
      }
    });
  }

  /* ── mock exam widgets ───────────────────────────────────── */
  function buildExam() {
    if (!body.hasAttribute("data-exam")) return;
    var TOTAL = 120 * 60;
    var st = store.exam || {};
    var clock = document.getElementById("clock");
    var scoreVal = document.getElementById("score-val");
    var startBtn = document.getElementById("t-start");
    var resetBtn = document.getElementById("t-reset");

    function remaining() {
      if (!st.startedAt) return TOTAL;
      var spent = (st.spent || 0) + (st.running ? (Date.now() - st.startedAt) / 1000 : 0);
      return Math.max(0, TOTAL - spent);
    }
    function paintClock() {
      if (!clock) return;
      var r = Math.floor(remaining());
      var mm = String(Math.floor(r / 60)).padStart(3, " "), ss = String(r % 60).padStart(2, "0");
      clock.textContent = mm + ":" + ss;
      clock.className = "clock" + (r === 0 ? " out" : r < 15 * 60 ? " low" : "");
      if (startBtn) startBtn.textContent = st.running ? "❚❚ Pause" : (st.spent ? "▶ Resume" : "▶ Start 120:00");
    }
    if (startBtn) startBtn.addEventListener("click", function () {
      if (st.running) { st.spent = (st.spent || 0) + (Date.now() - st.startedAt) / 1000; st.running = false; }
      else { st.startedAt = Date.now(); st.running = true; }
      store.exam = st; save(); paintClock();
    });
    if (resetBtn) resetBtn.addEventListener("click", function () {
      st = {}; store.exam = st; save(); paintClock();
    });
    setInterval(paintClock, 1000); paintClock();

    var tasks = document.querySelectorAll(".task");
    st.tasks = st.tasks || {};
    var maxPts = 0;
    Array.prototype.forEach.call(tasks, function (t, i) {
      var pts = +(t.getAttribute("data-pts") || 0);
      maxPts += pts;
      var title = t.getAttribute("data-title") || "";
      var inner = t.innerHTML;
      t.innerHTML = "";
      var h = el("header", null,
        '<span class="dot"></span><span class="tno">' + (i + 1) + '</span><span class="tt">' + title +
        '</span><span class="pts">' + pts + " pts</span>");
      var b = el("div", "body", inner);
      t.appendChild(h); t.appendChild(b);
      if (st.tasks[i]) t.classList.add("done");
      h.querySelector(".dot").addEventListener("click", function (e) {
        e.stopPropagation();
        st.tasks[i] = st.tasks[i] ? 0 : 1; store.exam = st; save();
        t.classList.toggle("done", !!st.tasks[i]); paintScore();
      });
      h.addEventListener("click", function () { b.style.display = b.style.display === "none" ? "" : "none"; });
    });
    function paintScore() {
      if (!scoreVal) return;
      var got = 0;
      Array.prototype.forEach.call(tasks, function (t, i) { if (st.tasks[i]) got += +(t.getAttribute("data-pts") || 0); });
      scoreVal.innerHTML = got + '<span class="u">/ ' + maxPts + "</span>";
      var sp = document.querySelector("#stat-score .spark i");
      if (sp) sp.style.width = (maxPts ? got / maxPts * 100 : 0) + "%";
    }
    paintScore();
  }

  /* ── boot ────────────────────────────────────────────────── */
  buildTopbar();
  buildHead();
  buildCodeBlocks();
  buildExercises();
  buildToc();
  buildFooter();
  buildPalette();
  buildHelp();
  buildIndex();
  buildExam();
  keys();
})();
