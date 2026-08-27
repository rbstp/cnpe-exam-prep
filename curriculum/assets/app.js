/* CNPE curriculum: page runtime.
   Builds the chrome from nav.js, wires copy buttons, progress, TOC, palette and keys.
   Everything persists in localStorage; nothing here needs a server (file:// works). */
(function () {
  "use strict";

  var NAV = window.CNPE_NAV || [];
  var DOMAINS = window.CNPE_DOMAINS || [];
  var body = document.body;
  var ROOT = "", PAGE_ID = null, entry = null;
  var KEY = "cnpe:v2";
  function readPage() {
    ROOT = body.getAttribute("data-root") || "";
    PAGE_ID = body.getAttribute("data-id") || null;
    entry = NAV.filter(function (n) { return n.id === PAGE_ID; })[0] || null;
  }

  /* ── study days: the console-wide streak ─────────────────────
     Every positive action (a drill answer, an exercise verified, a section
     completed, a mock exam task scored) bumps a per-day counter under
     store.days["YYYY-MM-DD"], local date, the same key the drill uses.
     Un-ticking is not an action and never decrements. The streak and best
     are derived from the map at render time, never stored as counters, so
     imported or merged history recomputes instead of fighting a total.
     Defined above the store initializer: seedDays runs during it. */
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function shiftKey(k, by) {                     // k ± n days, in local time
    var p = k.split("-");
    return dayKey(new Date(+p[0], +p[1] - 1, +p[2] + by));
  }
  function dayActs(rec) {
    if (!rec || typeof rec !== "object") return 0;
    return (+rec.c || 0) + (+rec.x || 0) + (+rec.s || 0) + (+rec.e || 0);
  }
  function bumpDay(kind) {                       // kind: c cards, x exercises, s sections, e exam tasks
    if (!store.days || typeof store.days !== "object" || Array.isArray(store.days)) store.days = {};
    var k = dayKey(new Date());
    var d = store.days[k];
    if (!d || typeof d !== "object" || Array.isArray(d)) d = store.days[k] = {};
    d[kind] = (+d[kind] || 0) + 1;
  }
  // The streak used to live in drillmeta as a running counter. An alive legacy
  // streak of N ending on `earned` backfills the N days ending there, so nobody's
  // streak resets the day this ships; a dead one only carries its best forward.
  function seedDays(s) {
    var dm = s.drillmeta;
    if (!dm || typeof dm !== "object" || Array.isArray(dm)) return;
    var n = Math.min(+dm.streak || 0, 3660);     // tolerate a junk counter
    var end = dm.earned;
    if (n < 1 || typeof end !== "string" || !DAY_RE.test(end)) return;
    var t = dayKey(new Date());
    if (end !== t && end !== shiftKey(t, -1)) return;
    for (var i = 0; i < n; i++) {
      var k = shiftKey(end, -i);
      var d = s.days[k];
      if (!d || typeof d !== "object" || Array.isArray(d)) d = s.days[k] = {};
      if (!dayActs(d)) d.c = 10;                 // the ten cards that earned that day
    }
  }
  function studyStreak() {
    var days = store.days && typeof store.days === "object" && !Array.isArray(store.days) ? store.days : {};
    var q = {};
    Object.keys(days).forEach(function (k) {
      if (DAY_RE.test(k) && dayActs(days[k]) > 0) q[k] = 1;
    });
    var cur = dayKey(new Date());                // alive if today or yesterday qualifies
    if (!q[cur]) cur = shiftKey(cur, -1);
    var streak = 0;
    while (q[cur]) { streak++; cur = shiftKey(cur, -1); }
    var best = 0, run = 0, prev = null;
    Object.keys(q).sort().forEach(function (k) {
      run = prev && shiftKey(prev, 1) === k ? run + 1 : 1;
      prev = k;
      if (run > best) best = run;
    });
    var dm = store.drillmeta && typeof store.drillmeta === "object" ? store.drillmeta : {};
    return { streak: streak, best: Math.max(best, +dm.best || 0) };
  }

  /* ── storage ─────────────────────────────────────────────── */
  var store = (function () {
    var s = { ex: {}, done: {}, exam: {}, last: null };
    try { var raw = localStorage.getItem(KEY); if (raw) s = Object.assign(s, JSON.parse(raw)); } catch (e) {}
    var hadDays = s.days && typeof s.days === "object" && !Array.isArray(s.days);
    ["ex", "done", "exam", "exam2", "drill", "drillmeta", "days"].forEach(function (k) {
      if (!s[k] || typeof s[k] !== "object") s[k] = {};       // tolerate anything that is not a map
    });
    if (typeof s.last !== "string") s.last = null;
    if (!hadDays) seedDays(s);   // one-time migration from the drill-only streak
    return s;
  })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
  // The one deliberate seam: drill.js keeps its records in this same store so
  // export/import and reset cover them. Functions, not the object, because
  // "Reset progress" replaces the object. bump feeds the study streak from the
  // drill's answer path; streak is the derived console-wide reading.
  window.CNPE_PROGRESS = { get: function () { return store; }, save: save, bump: bumpDay, streak: studyStreak };

  /* ── progress transfer ───────────────────────────────────────
     localStorage is per-origin, so a file:// copy and a hosted copy keep
     separate stores and no two browsers share one. Export writes the whole
     store to a file, import merges it back: carrying progress between them
     stays explicit and needs no network, account or server. */
  function exportPayload() {
    return JSON.stringify({ cnpe: 2, exported: new Date().toISOString(), progress: store }, null, 2);
  }
  function saveFile(name, text) {
    try {
      var a = document.createElement("a");
      if (!("download" in a)) return false;
      var url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) { return false; }
  }
  /* Union, never overwrite: an imported file can move an item from not-done to
     done and can add items this browser has never seen, but it cannot un-tick
     anything. Reset progress first if you want a plain restore. The mock exam's
     clock is deliberately left alone; only its scored tasks merge. */
  function mergeProgress(src) {
    var n = { done: 0, ex: 0, exam: 0, drill: 0, days: 0 };
    function union(into, from, bucket) {
      if (!from || typeof from !== "object" || Array.isArray(from)) return;
      Object.keys(from).forEach(function (k) {
        var v = from[k] ? 1 : 0;
        if (!(k in into)) { into[k] = v; if (v) n[bucket]++; }
        else if (v && !into[k]) { into[k] = 1; n[bucket]++; }
      });
    }
    union(store.done, src.done, "done");
    union(store.ex, src.ex, "ex");
    // Both mock exams keep the same shape under their own key.
    ["exam", "exam2"].forEach(function (k) {
      if (!src[k] || typeof src[k] !== "object") return;
      if (!store[k] || typeof store[k] !== "object") store[k] = {};
      if (!store[k].tasks || typeof store[k].tasks !== "object") store[k].tasks = {};
      union(store[k].tasks, src[k].tasks, "exam");
    });
    // Drill records are counters, not ticks: per question, the record answered
    // more recently wins outright rather than unioning.
    if (src.drill && typeof src.drill === "object" && !Array.isArray(src.drill)) {
      if (!store.drill || typeof store.drill !== "object") store.drill = {};
      Object.keys(src.drill).forEach(function (k) {
        var inc = src.drill[k], cur = store.drill[k];
        if (!inc || typeof inc !== "object") return;
        if (!cur || (inc.t || 0) > (cur.t || 0)) { store.drill[k] = inc; n.drill++; }
      });
    }
    if (src.drillmeta && typeof src.drillmeta === "object" && !Array.isArray(src.drillmeta)) {
      if (!store.drillmeta || typeof store.drillmeta !== "object") store.drillmeta = {};
      var best = Math.max(store.drillmeta.best || 0, src.drillmeta.best || 0);
      if ((src.drillmeta.t || 0) > (store.drillmeta.t || 0)) store.drillmeta = src.drillmeta;
      if (best) store.drillmeta.best = best;
    }
    // Study days are counters too: union of days, per-counter max, so a merge
    // can add history but never lower a count.
    if (src.days && typeof src.days === "object" && !Array.isArray(src.days)) {
      if (!store.days || typeof store.days !== "object" || Array.isArray(store.days)) store.days = {};
      Object.keys(src.days).forEach(function (k) {
        if (!DAY_RE.test(k)) return;
        var inc = src.days[k];
        if (!inc || typeof inc !== "object" || Array.isArray(inc)) return;
        var cur = store.days[k];
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) cur = store.days[k] = {};
        var grew = false;
        ["c", "x", "s", "e"].forEach(function (f) {
          var v = +inc[f] || 0;
          if (v > (+cur[f] || 0)) { cur[f] = v; grew = true; }
        });
        if (grew) n.days++;
      });
    }
    seedDays(store);   // an alive legacy streak in an imported drillmeta backfills too
    if (typeof src.last === "string" && NAV.filter(function (x) { return x.id === src.last; }).length) {
      store.last = src.last;
    }
    return n;
  }
  function importPayload(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return "That file is not valid JSON."; }
    // accept both the exported wrapper and a bare copy of the stored object
    var src = (obj && typeof obj === "object" && obj.progress && typeof obj.progress === "object")
      ? obj.progress : obj;
    if (!src || typeof src !== "object" || Array.isArray(src)) {
      return "That file does not look like exported CNPE progress.";
    }
    if (!src.done && !src.ex && !src.exam && !src.exam2 && !src.drill && !src.days) {
      return "That file has no CNPE progress in it.";
    }
    var n = mergeProgress(src);
    save();                                  // mergeProgress may have moved store.last on its own
    if (!n.done && !n.ex && !n.exam && !n.drill && !n.days) return "Nothing new in that file; this browser is already up to date.";
    return { added: n };
  }

  function slug(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  }
  function exKey(id, i, title) { return id + "#" + (slug(title) || i); }
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

  /* The reconcile trace: one square wave along the masthead's bottom edge,
     high where a section is done, low where it is not, in section order.
     The section being read gets its own brighter overlay segment. style.css
     reveals the wave left to right on load with a clip animation; dash tricks
     misrender under vector-effect, so the SVG itself stays plain. */
  function tracePaths() {
    var secs = NAV.filter(function (n) { return n.d > 0; });
    var n = secs.length || 1, hi = 2, lo = 6.5;
    var d = "", cur = "";
    for (var i = 0; i < secs.length; i++) {
      var y = store.done[secs[i].id] ? hi : lo;
      var x0 = (i / n * 100).toFixed(2), x1 = ((i + 1) / n * 100).toFixed(2);
      d += (i ? "L" + x0 + " " + y : "M0 " + y) + "L" + x1 + " " + y;
      if (entry && secs[i].id === entry.id) cur = "M" + x0 + " " + y + "L" + x1 + " " + y;
    }
    return { d: d, cur: cur };
  }
  function traceSvg() {
    var p = tracePaths();
    return '<svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<path class="tr" d="' + p.d + '"/>' +
      (p.cur ? '<path class="cur" d="' + p.cur + '"/>' : "") +
      "</svg>";
  }
  /* rewrite the wave in place, so the reveal animation stays a load-time
     event instead of replaying on every mark/unmark */
  function traceRefresh() {
    var tr = document.querySelector(".topbar .trace");
    if (!tr) return;
    var svg = tr.querySelector("svg");
    if (!svg) { tr.innerHTML = traceSvg(); return; }
    var p = tracePaths();
    svg.querySelector(".tr").setAttribute("d", p.d);
    var c = svg.querySelector(".cur");
    if (c && p.cur) c.setAttribute("d", p.cur);
  }
  function progHtml(ov) { return "<span>" + ov.done + "/" + ov.total + "</span>"; }

  /* ── small helpers ───────────────────────────────────────── */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function domainOf(n) { return DOMAINS.filter(function (d) { return d.n === n; })[0]; }
  function href(path) {
    if (window.CNPE_BUNDLE) {
      var hit = NAV.filter(function (n) { return n.path === path; })[0];
      return hit ? "#" + hit.id : (path === "index.html" ? "#index" : "#" + path);
    }
    return ROOT + path;
  }

  /* ── top bar ─────────────────────────────────────────────── */
  function buildTopbar() {
    var d = entry ? domainOf(entry.d) : null;
    var bar = el("div", "topbar");
    var inner = el("div", "inner");

    // Three stacked platform layers, the middle one in the ok green, echoing
    // the certified badge. The gradient stops keep their s1/s2 classes so the
    // theme rules in style.css recolor them; the green stroke via .sv.
    var logo = el("a", "logo",
      '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">' +
        '<defs><linearGradient id="cnpeMark" x1="0" y1="0" x2="1" y2="1">' +
          '<stop class="s1" offset="0%" stop-color="#F0C069"/><stop class="s2" offset="100%" stop-color="#E0A33E"/>' +
        '</linearGradient></defs>' +
        '<path d="M12 2.6 20.4 7 12 11.4 3.6 7z" fill="none" stroke="url(#cnpeMark)" stroke-width="1.7" stroke-linejoin="round"/>' +
        '<path class="sv" d="M20.4 12 12 16.4 3.6 12" fill="none" stroke="#8CBF6B" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M20.4 17 12 21.4 3.6 17" fill="none" stroke="url(#cnpeMark)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
      '<span class="word">CNPE</span><span class="sub">study console</span>');
    logo.href = href("index.html");
    inner.appendChild(logo);

    var crumbs = el("div", "crumbs");
    if (entry) {
      crumbs.innerHTML =
        '<span class="sep">/</span><a href="' + href("index.html") + '">' + (d ? "Domain " + d.n : /^EX/.test(entry.id) ? "Exam" : "Practice") + "</a>" +
        '<span class="sep">/</span><span class="here">' + (entry.id === "EX" ? "Mock exam" : entry.id === "EX2" ? "Mock exam 2" : entry.id === "DR" ? "Drill" : entry.id + " " + entry.title) + "</span>";
    } else {
      crumbs.innerHTML = '<span class="sep">/</span><span class="here">Overview</span>';
    }
    inner.appendChild(crumbs);
    inner.appendChild(el("div", "spacer"));

    var ov = overall();
    var prog = el("div", "prog" + (ov.done === ov.total ? " synced" : ""), progHtml(ov));
    inner.appendChild(prog);

    // U+2315 is not in the bundled Plex Mono subset, so as a character it came
    // from whatever the OS fell back to and drew at a different size on every
    // platform. Inline SVG renders identically everywhere.
    var sb = el("button", "searchbtn",
      '<svg class="ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-linecap="round">' +
        '<circle cx="6.75" cy="6.75" r="4.75" stroke-width="1.6"/>' +
        '<path d="M10.4 10.4 14 14" stroke-width="1.8"/>' +
      '</svg><span>Jump to section…</span><span class="k">/</span>');
    sb.type = "button";
    sb.addEventListener("click", openPalette);
    inner.appendChild(sb);

    inner.appendChild(themeButton());

    var hb = el("button", "iconbtn", "?");
    hb.type = "button"; hb.title = "Keyboard shortcuts";
    hb.addEventListener("click", function () { toggleOverlay(helpOverlay); });
    inner.appendChild(hb);

    // Almost every section tells you to run a make target, so the lab has to be
    // reachable from any page, since someone can land on a deep section from a link.
    var repo = el("a", "iconbtn",
      '<svg class="gh" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
        '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 '
          + '0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53'
          + '.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 '
          + '0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 '
          + '2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 '
          + '3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>' +
      '</svg>');
    repo.href = "https://github.com/rbstp/cnpe-exam-prep";
    repo.title = "The lab this curriculum runs on: github.com/rbstp/cnpe-exam-prep";
    repo.target = "_blank";
    repo.rel = "noopener";
    repo.setAttribute("aria-label", "The lab repository on GitHub");
    inner.appendChild(repo);

    bar.appendChild(inner);
    bar.appendChild(el("div", "trace", traceSvg()));
    body.insertBefore(bar, body.firstChild);

    if (!document.querySelector(".skip")) {
      var skip = el("a", "skip", "Skip to content");
      skip.href = "#main";
      body.insertBefore(skip, body.firstChild);
    }
    var art = document.querySelector("article");
    if (art && !art.id) { art.id = "main"; art.setAttribute("tabindex", "-1"); }
  }

  /* ── theme switch ────────────────────────────────────────────
     theme.js owns the state and has already applied it from <head>; the button
     only reports it and cycles system → light → dark. */
  var THEME_ICON = {
    system:
      '<svg class="thm" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">' +
        '<rect x="1.5" y="2.5" width="13" height="9" rx="1.1"/>' +
        '<path d="M5.6 13.8h4.8" stroke-linecap="round"/></svg>',
    light:
      '<svg class="thm" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
        '<circle cx="8" cy="8" r="3"/>' +
        '<path d="M8 1v1.7M8 13.3V15M1 8h1.7M13.3 8H15M3.1 3.1l1.2 1.2M11.7 11.7l1.2 1.2' +
          'M12.9 3.1l-1.2 1.2M4.3 11.7l-1.2 1.2"/></svg>',
    dark:
      '<svg class="thm" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">' +
        '<path d="M13.3 10.1A5.8 5.8 0 0 1 5.9 2.7a5.9 5.9 0 1 0 7.4 7.4Z"/></svg>'
  };
  var THEME_NEXT = { system: "light", light: "dark", dark: "system" };
  function themeButton() {
    var b = el("button", "iconbtn themebtn");
    b.type = "button";
    if (!window.CNPE_THEME) {                      // theme.js missing: nothing to switch
      b.style.display = "none";
      return b;
    }
    b.addEventListener("click", function () { window.CNPE_THEME.cycle(); });
    paintTheme(b);
    if (!themeWired) {
      // the topbar is rebuilt on every boot, so look the button up when it fires
      window.CNPE_THEME.onChange(function () { paintTheme(document.querySelector(".themebtn")); });
      themeWired = true;
    }
    return b;
  }
  var themeWired = false;
  function paintTheme(b) {
    if (!b || !window.CNPE_THEME) return;
    var pref = window.CNPE_THEME.pref();
    var name = pref === "system" ? "system (" + window.CNPE_THEME.resolved() + ")" : pref;
    b.innerHTML = THEME_ICON[pref];
    b.title = "Theme: " + name + " · switch to " + THEME_NEXT[pref] + " (t)";
    b.setAttribute("aria-label", b.title);
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
      if (d) eyebrow.innerHTML = '<span class="badge d' + d.n + '">Domain ' + d.n + " · " + d.weight + "</span><span>" + d.name + "</span>";
      else if (entry.id === "EX") eyebrow.innerHTML = '<span class="badge d2">Assessment</span><span>All five domains, 120 minutes</span>';
      else if (entry.id === "EX2") eyebrow.innerHTML = '<span class="badge d2">Assessment</span><span>Second paper · all five domains, 120 minutes</span>';
      // other domainless pages (the drill) keep the eyebrow written in their markup
    }
    if (h1 && !h1.textContent.trim()) {
      h1.innerHTML = (/^EX/.test(entry.id) ? "" : '<span class="id">' + entry.id + "</span>") + entry.title;
    }
    var stats = document.querySelector(".stats");
    if (!stats || stats.hasAttribute("data-static")) return;
    var c = sectionCounts(entry.id);
    var pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    stats.innerHTML =
      tile("c", "Lab layers", entry.needs, true) +
      tile("p", "Session length", "~" + entry.mins + '<span class="u">min</span>', false) +
      tile("y", "Exam weight", d ? d.weight : "100%", false) +
      '<div class="stat g" id="stat-ex"><div class="lbl">Exercises verified</div><div class="vrow"><div class="val">' +
        c.done + '<span class="u">/ ' + c.total + '</span></div><div class="spark"><i style="width:' + pct + '%"></i></div></div></div>';
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
    var cnt = document.getElementById("toc-ex-count"), barEl = document.getElementById("toc-ex-bar");
    if (cnt) cnt.textContent = c.done + "/" + c.total;
    if (barEl) barEl.style.width = pct + "%";
  }

  /* ── code blocks: language bar, copy, light highlighting ─── */
  var KWS = /\b(kubectl|helm|flux|argocd|argo|tkn|kubeseal|cosign|skopeo|trivy|docker|git|curl|jq|kustomize|istioctl|linkerd|hubble|cilium|crossplane|stern|kubectx|make|yq|base64|sudo|watch|source|echo|sleep|grep|awk|sed|sort|head|tail|wc|seq|for|do|done|while|if|then|fi|export)\b/g;
  function highlight(code, lang) {
    var html = code.innerHTML; // already entity-escaped in source
    // strings and comments first; later passes only touch what is left over
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
      if (cb.getAttribute("data-built")) return;
      cb.setAttribute("data-built", "1");
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
      if (c.getAttribute("data-built")) return;
      c.setAttribute("data-built", "1");
      var cmd = c.textContent, busy = false;
      c.title = "click to copy";
      c.tabIndex = 0;
      c.setAttribute("role", "button");
      var fire = function () {
        if (busy) return;
        busy = true;
        var fin = function () {
          c.textContent = "copied ✓";
          setTimeout(function () { c.textContent = cmd; busy = false; }, 1100);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(cmd).then(fin, fin); else fin();
      };
      c.addEventListener("click", fire);
      c.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); }
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
      if (ex.getAttribute("data-built")) return;
      ex.setAttribute("data-built", "1");
      var title = ex.getAttribute("data-title") || "Exercise " + (i + 1);
      var k = exKey(entry.id, i, title);
      if (!(k in store.ex)) store.ex[k] = 0;
      var body = ex.innerHTML;
      ex.innerHTML = "";

      var hdr = el("header");
      var disc = el("button", "disc");
      disc.type = "button";
      disc.innerHTML = '<span class="dot" aria-hidden="true"></span><h4>' + title + '</h4><span class="chev" aria-hidden="true">▾</span>';
      var mark = el("button", "mark");
      mark.type = "button";
      var bodyEl = el("div", "body", body);
      bodyEl.id = "ex-" + slug(entry.id + "-" + title);
      disc.setAttribute("aria-controls", bodyEl.id);

      function paint() {
        var on = !!store.ex[k];
        ex.classList.toggle("done", on);
        mark.textContent = on ? "verified" : "mark verified";
        mark.setAttribute("aria-pressed", on ? "true" : "false");
        mark.setAttribute("aria-label", (on ? "Verified: " : "Mark verified: ") + title);
        var collapsed = ex.classList.contains("collapsed");
        disc.setAttribute("aria-expanded", collapsed ? "false" : "true");
        disc.querySelector(".chev").textContent = collapsed ? "▸" : "▾";
      }
      mark.addEventListener("click", function (e) {
        e.stopPropagation();
        store.ex[k] = store.ex[k] ? 0 : 1;
        if (store.ex[k]) bumpDay("x");   // verifying counts as study; un-ticking is not an action
        save(); paint(); refreshExTile();
      });
      disc.addEventListener("click", function () { ex.classList.toggle("collapsed"); paint(); });

      hdr.appendChild(disc); hdr.appendChild(mark);
      ex.appendChild(hdr); ex.appendChild(bodyEl);
      paint();
    });
    save();
    refreshExTile();   // the tile is built before the exercises are registered
  }

  /* ── table of contents + scroll spy ──────────────────────── */
  function buildToc() {
    var toc = document.getElementById("toc");
    if (!toc) return;
    toc.style.display = "";
    var heads = document.querySelectorAll("article .panel > .phdr h2");
    if (!heads.length) { toc.style.display = "none"; toc.innerHTML = ""; return; }
    var html = "<h4>On this page</h4>";
    Array.prototype.forEach.call(heads, function (h, i) {
      var panel = h.closest(".panel");
      if (!panel.id) panel.id = "p" + i;
      html += '<a href="#' + panel.id + '">' + h.textContent + "</a>";
    });
    if (entry && document.querySelector(".exercise")) {
      var c = sectionCounts(entry.id);
      html += '<div class="mini"><div class="row"><span>exercises</span><span id="toc-ex-count">' + c.done + "/" + c.total +
        '</span></div><div class="track"><i id="toc-ex-bar" style="width:' + (c.total ? c.done / c.total * 100 : 0) + '%"></i></div></div>';
    }
    toc.innerHTML = html;

    spyState.links = Array.prototype.slice.call(toc.querySelectorAll("a"));
    spyState.targets = spyState.links.map(function (a) { return document.querySelector(a.getAttribute("href")); });
    if (!spyState.wired) {
      window.addEventListener("scroll", throttle(spy, 120));
      spyState.wired = true;
    }
    spy();
  }
  var spyState = { links: [], targets: [], wired: false };
  function spy() {
    var y = window.scrollY + 120, idx = 0;
    spyState.targets.forEach(function (t, i) { if (t && t.offsetTop <= y) idx = i; });
    spyState.links.forEach(function (a, i) { a.classList.toggle("active", i === idx); });
  }
  function throttle(fn, ms) {
    var t = 0, timer = null;
    return function () {
      var n = Date.now();
      if (n - t > ms) { t = n; fn(); }
      else { clearTimeout(timer); timer = setTimeout(function () { t = Date.now(); fn(); }, ms); }
    };
  }

  /* ── pager + finish ──────────────────────────────────────── */
  function buildFooter() {
    if (!entry) return;
    var art = document.querySelector("article");
    if (!art) return;
    var idx = NAV.indexOf(entry);
    var prev = NAV[idx - 1], next = NAV[idx + 1];

    // Only numbered sections get the completion strip; the exam scores itself
    // and the drill tracks its own history.
    if (entry.d > 0) {
      var fin = el("div", "finish");
      var done = !!store.done[entry.id];
      fin.innerHTML = '<div class="txt">Finished this section? Marking it complete updates the dashboard and your overall progress.</div>';
      var b = el("button", "tbtn" + (done ? " on" : ""), done ? "✓ Section complete" : "Mark section complete");
      b.type = "button";
      b.addEventListener("click", function () {
        store.done[entry.id] = store.done[entry.id] ? 0 : 1;
        if (store.done[entry.id]) bumpDay("s");
        save();
        b.className = "tbtn" + (store.done[entry.id] ? " on" : "");
        b.textContent = store.done[entry.id] ? "✓ Section complete" : "Mark section complete";
        var ov = overall();
        var p = document.querySelector(".topbar .prog");
        if (p) {
          p.innerHTML = progHtml(ov);
          p.classList.toggle("synced", ov.done === ov.total);
        }
        traceRefresh();
      });
      fin.appendChild(b);
      if (next) {
        var nb = el("button", "tbtn ghost", "Next section →"); nb.type = "button";
        nb.addEventListener("click", function () { location.href = href(next.path); });
        fin.appendChild(nb);
      }
      art.appendChild(fin);
    }

    var label = function (x) { return (x.d > 0 ? x.id + " " : "") + x.title; };
    var pager = el("div", "pager");
    pager.innerHTML =
      (prev ? '<a class="prev" href="' + href(prev.path) + '"><span class="dir">◀ previous</span>' + label(prev) + "</a>"
            : '<a class="prev ghost">&nbsp;</a>') +
      (next ? '<a class="next" href="' + href(next.path) + '"><span class="dir">next ▶</span>' + label(next) + "</a>"
            : '<a class="next" href="' + href("index.html") + '"><span class="dir">next ▶</span>Back to the dashboard</a>');
    art.appendChild(pager);

    if (entry.d > 0) { store.last = entry.id; save(); }   // the mock exam is not "where you were reading"
  }

  /* ── command palette ─────────────────────────────────────── */
  var paletteOverlay, paletteInput, paletteList, paletteItems = [], paletteSel = 0;
  function buildPalette() {
    paletteOverlay = el("div", "overlay");
    var p = el("div", "palette");
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-modal", "true");
    p.setAttribute("aria-label", "Jump to a section");
    p.innerHTML =
      '<div class="pin"><span aria-hidden="true">⌕</span><input type="text" role="combobox" aria-expanded="true" ' +
        'aria-controls="palette-list" aria-autocomplete="list" aria-label="Search sections, tools and concepts" ' +
        'placeholder="Search sections, tools, concepts…" autocomplete="off" spellcheck="false"></div>' +
      '<ul id="palette-list" role="listbox" aria-label="Sections"></ul>' +
      '<div class="hint" aria-live="polite" id="palette-hint">↑↓ navigate · ⏎ open · esc close · type a tool name (kyverno, flux, spiffe…) to find its section</div>';
    paletteOverlay.appendChild(p);
    body.appendChild(paletteOverlay);
    paletteInput = p.querySelector("input");
    paletteList = p.querySelector("ul");
    paletteInput.addEventListener("input", function () { renderPalette(paletteInput.value); });
    // keep Tab inside the dialog
    p.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      e.preventDefault();
      paletteInput.focus();
    });
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
    var hint = document.getElementById("palette-hint");
    if (hint) {
      hint.textContent = !q ? "↑↓ navigate · ⏎ open · esc close · type a tool name (kyverno, flux, spiffe…) to find its section"
        : items.length ? items.length + (items.length === 1 ? " match" : " matches") + " · ↑↓ navigate · ⏎ open"
        : "no section matches “" + q + "”";
    }
    paletteList.innerHTML = items.map(function (n, i) {
      var d = domainOf(n.d);
      var hit = "";
      if (q) {
        var t = n.tags.split(/\s+/).filter(function (w) { return w.indexOf(q.split(/\s+/)[0]) === 0; }).slice(0, 4);
        if (t.length) hit = " · " + t.join(" ");
      }
      return '<li id="pal-' + i + '" role="option" aria-selected="false" data-i="' + i + '"><span class="pid">' + n.id +
        '</span><span class="ptitle">' + n.title +
        '</span><span class="pmeta">' + (d ? "d" + d.n : /^EX/.test(n.id) ? "exam" : "drill") + hit + "</span></li>";
    }).join("");
    Array.prototype.forEach.call(paletteList.children, function (li) {
      li.addEventListener("click", function () { go(+li.getAttribute("data-i")); });
      li.addEventListener("mousemove", function () { paletteSel = +li.getAttribute("data-i"); markSel(); });
    });
    markSel();
  }
  function markSel() {
    Array.prototype.forEach.call(paletteList.children, function (li, i) {
      var on = i === paletteSel;
      li.classList.toggle("sel", on);
      li.setAttribute("aria-selected", on ? "true" : "false");
    });
    var s = paletteList.children[paletteSel];
    if (s) {
      if (s.scrollIntoView) s.scrollIntoView({ block: "nearest" });
      if (paletteInput) paletteInput.setAttribute("aria-activedescendant", s.id);
    } else if (paletteInput) paletteInput.removeAttribute("aria-activedescendant");
  }
  function go(i) {
    var n = paletteItems[i];
    if (n) location.href = href(n.path);
  }
  var lastFocus = null;
  function openPalette() {
    closeOverlays();
    lastFocus = document.activeElement;
    paletteOverlay.classList.add("open");
    paletteInput.value = ""; renderPalette(""); paletteInput.focus();
  }

  /* ── help overlay ────────────────────────────────────────── */
  var helpOverlay;
  function buildHelp() {
    helpOverlay = el("div", "overlay");   // boot() already stripped the previous one
    var sectionKeys = !!document.querySelector(".exercise");
    var c = el("div", "helpcard");
    c.setAttribute("role", "dialog");
    c.setAttribute("aria-modal", "true");
    c.setAttribute("aria-label", "Keyboard shortcuts");
    c.tabIndex = -1;
    c.innerHTML = "<h3>Keyboard</h3><dl>" +
      "<dt>/ &nbsp;or&nbsp; ⌘K</dt><dd>jump to any section by name, tool or concept</dd>" +
      "<dt>n &nbsp;/&nbsp; p</dt><dd>next / previous section</dd>" +
      "<dt>d</dt><dd>back to the dashboard</dd>" +
      "<dt>g</dt><dd>drill: shuffled self-check questions</dd>" +
      (sectionKeys
        ? "<dt>x</dt><dd>jump to the exercises panel</dd>" +
          "<dt>c</dt><dd>collapse or expand every exercise</dd>" +
          "<dt>m</dt><dd>mark this section complete</dd>"
        : "") +
      "<dt>t</dt><dd>theme: system, light, dark</dd>" +
      "<dt>?</dt><dd>this card</dd>" +
      "<dt>esc</dt><dd>close</dd></dl>" +
      '<p style="margin:16px 0 0;color:var(--paper-3);font-size:13.5px">Progress is stored in this browser only. ' +
      'Every code block has a copy button; the lab-layer chips at the top of a section copy their make command too.</p>';
    helpOverlay.appendChild(c);
    helpOverlay.addEventListener("click", function (e) { if (e.target === helpOverlay) closeOverlays(); });
    body.appendChild(helpOverlay);
  }
  function toggleOverlay(o) {
    var open = o.classList.contains("open");
    var trigger = document.activeElement;
    closeOverlays();
    if (!open) {
      lastFocus = trigger;
      o.classList.add("open");
      var focusable = o.querySelector("button, [href], input");
      if (focusable && focusable.focus) focusable.focus();
    }
  }
  function closeOverlays() {
    var wasOpen = !!document.querySelector(".overlay.open");
    Array.prototype.forEach.call(document.querySelectorAll(".overlay"), function (o) { o.classList.remove("open"); });
    if (wasOpen && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  /* ── keyboard ────────────────────────────────────────────── */
  function keys() {
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if (e.key === "Escape") { closeOverlays(); return; }
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPalette(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".overlay.open")) return;   // the modal owns the keyboard
      var idx = entry ? NAV.indexOf(entry) : -1;
      switch (e.key) {
        case "/": e.preventDefault(); openPalette(); break;
        case "?": toggleOverlay(helpOverlay); break;
        case "n": if (idx >= 0 && NAV[idx + 1]) location.href = href(NAV[idx + 1].path); break;
        case "p": if (idx > 0) location.href = href(NAV[idx - 1].path); break;
        case "d": location.href = href("index.html"); break;
        case "g": location.href = href("drill.html"); break;
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
          var btn = entry ? document.querySelector(".finish button.tbtn") : null;
          if (btn) { btn.click(); btn.scrollIntoView({ block: "center" }); }
          break;
        case "t":
          if (window.CNPE_THEME) window.CNPE_THEME.cycle();
          break;
      }
    });
  }

  /* ── weak spots: drill accuracy split by domain ──────────────
     Drill record keys embed the section ("2.3#…"), so the domain is derivable
     from the store alone; the question bank (when its script is loaded, as it
     is on the dashboard and in the bundle) only adds the seen/total counts. */
  var WEAK_MIN = 5;   // answers a domain needs before the panel will call it weak
  function buildWeakSpots() {
    var host = document.getElementById("weak-domains");
    if (!host) return;
    var totals = {};
    (window.CNPE_DRILL || []).forEach(function (q) {
      var d = +q.sec.split(".")[0];
      totals[d] = (totals[d] || 0) + 1;
    });
    var per = {};
    DOMAINS.forEach(function (d) { per[d.n] = { seen: 0, r: 0, m: 0 }; });
    var drill = store.drill && typeof store.drill === "object" ? store.drill : {};
    Object.keys(drill).forEach(function (k) {
      var rec = drill[k], d = per[+k.split(".")[0]];
      if (!d || !rec || typeof rec !== "object") return;
      d.seen++; d.r += rec.r || 0; d.m += rec.m || 0;
    });

    var weakest = null;
    var cells = DOMAINS.map(function (dom) {
      var p = per[dom.n], n = p.r + p.m;
      var seenTxt = totals[dom.n] ? p.seen + "/" + totals[dom.n] + " seen" : p.seen + " seen";
      if (!n) {
        return '<div class="wcell"><span class="wk">domain ' + dom.n + " · " + seenTxt +
          '</span><span class="wv"><span class="u">no answers yet</span></span>' +
          '<span class="wbar"><i class="dim" style="width:100%"></i></span></div>';
      }
      var pct = Math.round(p.r / n * 100);
      if (n >= WEAK_MIN && (!weakest || pct < weakest.pct)) weakest = { dom: dom, pct: pct, n: n };
      return '<div class="wcell"><span class="wk">domain ' + dom.n + " · " + seenTxt +
        '</span><span class="wv wnum">' + pct + '<span class="u">% of ' + n + "</span></span>" +
        '<span class="wbar"><i class="' + (pct >= 80 ? "green" : pct >= 60 ? "warn" : "bad") +
        '" style="width:' + pct + '%"></i></span></div>';
    });

    var answered = DOMAINS.some(function (d) { return per[d.n].r + per[d.n].m > 0; });
    var verdict;
    if (!answered) {
      verdict = 'No drill history in this browser yet. <a href="' + href("drill.html") +
        '">Run a session</a> and this panel starts pointing at the domain to spend evenings on.';
    } else if (!weakest) {
      verdict = "Too few answers per domain to call a weak spot; " + WEAK_MIN +
        " in one domain is the minimum. Keep drilling.";
    } else {
      verdict = "Weakest: <strong>domain " + weakest.dom.n + " · " + weakest.dom.name + "</strong> at " +
        weakest.pct + "% over " + weakest.n + " answers, worth " +
        (weakest.pct >= 80 ? "keeping warm" : "an evening") + ". " +
        '<a href="' + href("drill.html") + '" data-drill-domain="' + weakest.dom.n + '">Drill domain ' +
        weakest.dom.n + "</a>.";
    }
    host.innerHTML = cells.join("") +
      '<div class="wcell wspan"><span class="wk">read it like this</span><span class="wv">' + verdict + "</span></div>";

    var link = host.querySelector("[data-drill-domain]");
    if (link) link.addEventListener("click", function () {
      // the drill page picks this up once and pre-selects the domain chip
      try { sessionStorage.setItem("cnpe:drill-domain", link.getAttribute("data-drill-domain")); } catch (e) {}
    });
  }

  /* ── index dashboard ─────────────────────────────────────── */
  function buildIndex() {
    var host = document.getElementById("domain-grid");
    if (!host) return;
    var ov = overall();
    var sk = studyStreak();
    var totalEx = Object.keys(store.ex).length, doneEx = Object.keys(store.ex).filter(function (k) { return store.ex[k]; }).length;
    var stats = document.querySelector(".stats");
    if (stats) {
      // The last 30 days as an uptime strip: one cell per day, column-major
      // so today lands bottom right. Any heartbeat that day lights it.
      var cells = "", now = new Date();
      for (var i = 29; i >= 0; i--) {
        var dk = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
        var acts = dayActs(store.days[dk]);
        cells += '<i class="' + (acts ? "on" : "") + '" title="' + dk +
          (acts ? " · " + acts + (acts === 1 ? " heartbeat" : " heartbeats") : " · no heartbeat") + '"></i>';
      }
      stats.innerHTML =
        '<div class="stat g"><div class="lbl">Sections complete</div><div class="vrow"><div class="val">' + ov.done +
          '<span class="u">/ ' + ov.total + '</span></div><div class="spark"><i style="width:' + ov.pct + '%"></i></div></div></div>' +
        tile("c", "Exercises verified", doneEx + (totalEx ? '<span class="u">/ ' + totalEx + " seen</span>" : ""), false) +
        '<div class="stat g" id="stat-streak"><div class="lbl">Uptime' + (sk.best ? " · record " + sk.best : "") +
          '</div><div class="vrow"><div class="val">' + sk.streak +
          '<span class="u">' + (sk.streak === 1 ? "day" : "days") + '</span></div>' +
          '<div class="heat" role="img" aria-label="Study heartbeat over the last 30 days, one cell per day, newest bottom right">' + cells + "</div></div></div>" +
        tile("p", "Exam length", '120<span class="u">min</span>', false) +
        tile("y", "Tasks on the day", '15–20<span class="u">≈7 min each</span>', false);
    }
    host.innerHTML = DOMAINS.map(function (d) {
      var secs = NAV.filter(function (n) { return n.d === d.n; });
      var done = secs.filter(function (n) { return store.done[n.id]; }).length;
      var pct = secs.length ? Math.round(done / secs.length * 100) : 0;
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
      var html = "";
      if (target) {
        html += '<a class="tbtn" style="text-decoration:none" href="' + href(target.path) + '">▶ ' +
          (last ? "Resume " : "Start ") + target.id + " · " + target.title + "</a> ";
      }
      // the drill entry point, carrying the console-wide streak while it is up
      html += '<a class="tbtn ghost" style="text-decoration:none" href="' + href("drill.html") + '">Drill 10' +
        (sk.streak ? " · up " + sk.streak + (sk.streak === 1 ? " day" : " days") : "") + "</a>";
      resume.innerHTML = html;
    }
    var reset = document.getElementById("reset-progress");
    if (reset) reset.addEventListener("click", function () {
      if (confirm("Clear all section, exercise, exam, drill and streak progress stored in this browser?")) {
        store = { ex: {}, done: {}, exam: {}, exam2: {}, drill: {}, drillmeta: {}, days: {}, last: null }; save(); location.reload();
      }
    });

    var note = document.getElementById("io-note");
    function say(msg) { if (note) { note.textContent = msg; note.hidden = false; } }
    var exp = document.getElementById("export-progress");
    if (exp) exp.addEventListener("click", function () {
      var text = exportPayload();
      var name = "cnpe-progress-" + new Date().toISOString().slice(0, 10) + ".json";
      if (saveFile(name, text)) { say("Wrote " + name + " to your downloads."); return; }
      // some browsers refuse a scripted download from file://; hand over the text instead
      say("This browser blocked the download; copy the JSON below into " + name + ".");
      var box = document.getElementById("io-box") || el("div", "iobox");
      box.id = "io-box";
      box.innerHTML = "";
      var ta = document.createElement("textarea");
      ta.readOnly = true; ta.rows = 8; ta.value = text;
      box.appendChild(ta);
      exp.parentNode.appendChild(box);
      ta.focus(); ta.select();
    });
    var imp = document.getElementById("import-progress");
    if (imp) imp.addEventListener("click", function () {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.style.display = "none";
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) { input.remove(); return; }
        var fr = new FileReader();
        fr.onload = function () {
          var res = importPayload(String(fr.result));
          input.remove();
          if (typeof res === "string") { say(res); return; }
          var a = res.added;
          alert("Imported: " + a.done + " section(s), " + a.ex + " exercise(s), " + a.exam +
                " exam task(s), " + a.drill + " drill record(s), " + a.days + " study day(s).\nNothing already ticked here was changed.");
          location.reload();
        };
        fr.onerror = function () { input.remove(); say("Could not read that file."); };
        fr.readAsText(file);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /* ── mock exam widgets ───────────────────────────────────── */
  var examTimer = null, examLifecycleWired = false;
  function buildExam() {
    if (examTimer) { clearInterval(examTimer); examTimer = null; }
    if (!body.hasAttribute("data-exam")) return;
    var TOTAL = 120 * 60;
    // Each exam page keeps its own clock and score under its own store key,
    // so a run of paper 2 never disturbs paper 1's record.
    var bucket = PAGE_ID === "EX2" ? "exam2" : "exam";
    var st = store[bucket] && typeof store[bucket] === "object" ? store[bucket] : {};
    if (!st.tasks || typeof st.tasks !== "object") st.tasks = {};
    store[bucket] = st;
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
      if (r === 0 && st.running) {   // time is up: stop the meter where it ran out
        st.running = false; st.spent = TOTAL; save();
      }
      var mm = String(Math.floor(r / 60)).padStart(3, " "), ss = String(r % 60).padStart(2, "0");
      clock.textContent = mm + ":" + ss;
      clock.className = "clock" + (r === 0 ? " out" : r < 15 * 60 ? " low" : "");
      if (startBtn) startBtn.textContent = st.running ? "❚❚ Pause" : (st.spent ? "▶ Resume" : "▶ Start 120:00");
    }
    if (startBtn) startBtn.addEventListener("click", function () {
      if (st.running) { st.spent = (st.spent || 0) + (Date.now() - st.startedAt) / 1000; st.running = false; }
      else { st.startedAt = Date.now(); st.running = true; }
      store[bucket] = st; save(); paintClock();
    });
    if (resetBtn) resetBtn.addEventListener("click", function () {
      st.startedAt = 0; st.spent = 0; st.running = false; st.tasks = {};
      save();
      Array.prototype.forEach.call(document.querySelectorAll(".task"), function (t) { t.classList.remove("done"); });
      Array.prototype.forEach.call(document.querySelectorAll(".task .dot"), function (d) { d.setAttribute("aria-pressed", "false"); });
      paintClock(); paintScore();
    });
    examTimer = setInterval(paintClock, 1000);
    paintClock();

    // The clock should measure time you spent, not wall-clock while the tab was
    // shut. Wired once: the bundled console re-runs boot() on every navigation,
    // and these listen on the document, so a per-boot registration would stack.
    if (!examLifecycleWired) {
      var stamp = function () {
        ["exam", "exam2"].forEach(function (k) {
          var s = store[k];
          if (s && s.running) { s.spent = (s.spent || 0) + (Date.now() - s.startedAt) / 1000; s.startedAt = Date.now(); save(); }
        });
      };
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") stamp();
      });
      addEventListener("pagehide", stamp);
      examLifecycleWired = true;
    }

    var tasks = document.querySelectorAll(".task");
    var maxPts = 0;
    Array.prototype.forEach.call(tasks, function (t, i) {
      var pts = +(t.getAttribute("data-pts") || 0);
      maxPts += pts;
      var title = t.getAttribute("data-title") || "";
      if (t.getAttribute("data-built")) return;
      t.setAttribute("data-built", "1");
      var inner = t.innerHTML;
      t.innerHTML = "";

      var h = el("header");
      var dot = el("button", "dot");
      dot.type = "button";
      dot.setAttribute("aria-label", "Mark task " + (i + 1) + " scored: " + title);
      var disc = el("button", "disc");
      disc.type = "button";
      disc.innerHTML = '<span class="tno">' + (i + 1) + '</span><span class="tt">' + title +
                       '</span><span class="pts">' + pts + " pts</span>";
      var b = el("div", "body", inner);
      b.id = "task-" + i;
      disc.setAttribute("aria-controls", b.id);
      disc.setAttribute("aria-expanded", "true");

      function paintTask() {
        var on = !!st.tasks[i];
        t.classList.toggle("done", on);
        dot.setAttribute("aria-pressed", on ? "true" : "false");
      }
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        st.tasks[i] = st.tasks[i] ? 0 : 1;
        if (st.tasks[i]) bumpDay("e");
        save(); paintTask(); paintScore();
      });
      disc.addEventListener("click", function () {
        var hidden = b.style.display === "none";
        b.style.display = hidden ? "" : "none";
        disc.setAttribute("aria-expanded", hidden ? "true" : "false");
      });
      h.appendChild(dot); h.appendChild(disc);
      t.appendChild(h); t.appendChild(b);
      paintTask();
    });
    function paintScore() {
      if (!scoreVal) return;
      var got = 0, byDomain = {};
      Array.prototype.forEach.call(tasks, function (t, i) {
        var pts = +(t.getAttribute("data-pts") || 0);
        var m = /domain (\d)/.exec(t.getAttribute("data-title") || "");
        var d = m ? m[1] : "?";
        byDomain[d] = byDomain[d] || { got: 0, max: 0 };
        byDomain[d].max += pts;
        if (st.tasks[i]) { got += pts; byDomain[d].got += pts; }
      });
      scoreVal.innerHTML = got + '<span class="u">/ ' + maxPts + "</span>";
      var sp = document.querySelector("#stat-score .spark i");
      if (sp) sp.style.width = (maxPts ? got / maxPts * 100 : 0) + "%";

      var host = document.getElementById("score-domains");
      if (!host) return;
      host.innerHTML = Object.keys(byDomain).sort().map(function (d) {
        var b = byDomain[d], pct = b.max ? Math.round(b.got / b.max * 100) : 0;
        var state = b.got === 0 ? "bad" : pct >= 70 ? "ok" : "warn";
        return '<div class="wcell"><span class="wk">domain ' + d + '</span>' +
          '<span class="wv wnum">' + b.got + '<span class="u" style="font-size:12px;color:var(--paper-3)"> / ' + b.max + '</span></span>' +
          '<span class="wbar"><i class="' + (state === "ok" ? "green" : state === "warn" ? "warn" : "bad") +
          '" style="width:' + pct + '%"></i></span></div>';
      }).join("") +
      '<div class="wcell wspan"><span class="wk">read this before the total</span><span class="wv">' +
        (Object.keys(byDomain).some(function (d) { return byDomain[d].got === 0; })
          ? "A domain at zero fails you in ways an average hides; re-drill that one first."
          : "Every domain is on the board. Now push the weakest one above 70%.") +
      "</span></div>";
    }
    paintScore();
  }

  /* ── boot ────────────────────────────────────────────────── */
  var wired = false;
  function boot() {
    readPage();
    Array.prototype.forEach.call(document.querySelectorAll(".topbar, .overlay"), function (n) { n.remove(); });
    buildTopbar();
    buildHead();
    buildExercises();
    if (window.CNPE_WIDGETS) window.CNPE_WIDGETS.mount();
    if (window.CNPE_DRILL_UI) window.CNPE_DRILL_UI.mount();
    buildToc();
    buildFooter();
    buildPalette();
    buildHelp();
    buildIndex();
    buildWeakSpots();
    buildExam();
    // Last, after every innerHTML rebuild above: buildExercises and buildExam
    // re-serialize their panels, which would strip the copy buttons' listeners
    // while data-built keeps them from ever being wired again.
    buildCodeBlocks();
    if (!wired) { keys(); wired = true; }
  }
  window.CNPE_BOOT = boot;
  boot();
})();
