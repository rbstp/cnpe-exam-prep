/* CNPE curriculum: the dashboard. Mounts on index.html and nowhere else.

   A panel, on the same terms as widgets.js and drill.js: it exposes a mount(),
   boot() calls it, and it self-mounts too, so it works loaded either side of
   app.js. It reaches the runtime through CNPE_PROGRESS for the store and
   CNPE_UI for the two view helpers it cannot reasonably own: tile(), which is
   markup for a CSS component app.js also writes, and href(), which needs the
   page's depth and whether this is the bundle. */
(function () {
  "use strict";

  // Bound in mount(): CNPE_UI is app.js's, and this file may load before it.
  var UI, tile, href;

  function api() { return window.CNPE_PROGRESS; }
  function store() { return api().get(); }
  function save() { api().save(); }
  function nav() { return window.CNPE_NAV || []; }
  function domains() { return window.CNPE_DOMAINS || []; }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ── the drill's backlog ───────────────────────────────────── */
  // Ids and sections, no prose: the dashboard's index or the drill's full bank.
  function deck() { return window.CNPE_DRILL || window.CNPE_DRILL_INDEX || []; }
  // Cards that have come round for review: answered before, and their rest is up.
  // A card nobody has ever seen is not a backlog, it is the rest of the deck, so
  // it is not counted here or on the drill's own tile. merge.js sets the interval.
  function dueCards() {
    var s = store();
    var recs = s.drill && typeof s.drill === "object" && !Array.isArray(s.drill) ? s.drill : {};
    var now = Date.now(), n = 0;
    deck().forEach(function (q) {
      var rec = recs[q.id];
      if (rec && window.CNPE_MERGE.dueIn(rec, now) <= 0) n++;
    });
    return n;
  }

  /* ── progress transfer ─────────────────────────────────────── */
  function exportPayload() {
    return JSON.stringify({ cnpe: 2, exported: new Date().toISOString(), progress: store() }, null, 2);
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
  /** @param {string} text @return {string | { added: CnpeMergeCounts }} */
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
    var n = api().merge(src);
    save();
    if (!n.done && !n.ex && !n.exam && !n.drill && !n.days) return "Nothing new in that file; this browser is already up to date.";
    return { added: n };
  }

  /* ── weak spots: drill accuracy split by domain ────────────── */
  // Drill record keys embed the section ("2.3#..."), so the domain comes from the key.
  var WEAK_MIN = 5;   // answers a domain needs before the panel will call it weak
  function buildWeakSpots() {
    var host = document.getElementById("weak-domains");
    if (!host) return;
    var totals = {};
    deck().forEach(function (q) {
      var d = +q.sec.split(".")[0];
      totals[d] = (totals[d] || 0) + 1;
    });
    var per = {};
    domains().forEach(function (d) { per[d.n] = { seen: 0, r: 0, m: 0 }; });
    var s = store();
    var drill = s.drill && typeof s.drill === "object" ? s.drill : {};
    Object.keys(drill).forEach(function (k) {
      var rec = drill[k], d = per[+k.split(".")[0]];
      if (!d || !rec || typeof rec !== "object") return;
      d.seen++; d.r += rec.r || 0; d.m += rec.m || 0;
    });

    /** @type {{ dom: CnpeDomain, pct: number, n: number } | null} */
    var weakest = null;
    var cells = domains().map(function (dom) {
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

    var answered = domains().some(function (d) { return per[d.n].r + per[d.n].m > 0; });
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

  /* ── the map, the tiles and the transfer buttons ───────────── */
  function buildIndex() {
    var host = document.getElementById("domain-grid");
    if (!host) return;
    var s = store();
    var ov = api().overall();
    var sk = api().streak();
    var totalEx = Object.keys(s.ex).length, doneEx = Object.keys(s.ex).filter(function (k) { return s.ex[k]; }).length;
    var stats = document.querySelector(".stats");
    if (stats) {
      // Last 30 days, one cell per day, column-major so today lands bottom right.
      var cells = "", now = new Date();
      for (var i = 29; i >= 0; i--) {
        var dk = window.CNPE_MERGE.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
        var acts = window.CNPE_MERGE.dayActs(s.days[dk]);
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
    host.innerHTML = domains().map(function (d) {
      var secs = nav().filter(function (n) { return n.d === d.n; });
      var done = secs.filter(function (n) { return s.done[n.id]; }).length;
      var pct = secs.length ? Math.round(done / secs.length * 100) : 0;
      return '<div class="dcard"><header><span class="badge d' + d.n + '">D' + d.n + '</span><h3>' + d.name +
        '</h3><span class="w">' + d.weight + "</span></header><ol>" +
        secs.map(function (n) {
          return '<li><a class="' + (s.done[n.id] ? "done" : "") + '" href="' + href(n.path) + '">' +
            '<span class="sid">' + n.id + '</span><span class="st">' + n.title + '</span><span class="tick"></span></a></li>';
        }).join("") +
        '</ol><div class="foot"><span>' + done + "/" + secs.length + '</span><span class="track"><i style="width:' + pct +
        '%"></i></span><span>' + pct + "%</span></div></div>";
    }).join("");

    var resume = document.getElementById("resume");
    if (resume) {
      var last = s.last ? nav().filter(function (n) { return n.id === s.last; })[0] : null;
      var nextUp = nav().filter(function (n) { return n.d > 0 && !s.done[n.id]; })[0];
      var target = last || nextUp;
      var html = "";
      if (target) {
        html += '<a class="tbtn" style="text-decoration:none" href="' + href(target.path) + '">▶ ' +
          (last ? "Resume " : "Start ") + target.id + " · " + target.title + "</a> ";
      }
      // What is waiting beats how long the streak is, and the uptime tile above
      // already carries the streak.
      var due = dueCards();
      html += '<a class="tbtn ghost" style="text-decoration:none" href="' + href("drill.html") + '">Drill 10' +
        (due ? " · " + due + " due" : sk.streak ? " · up " + sk.streak + (sk.streak === 1 ? " day" : " days") : "") +
        "</a>";
      resume.innerHTML = html;
    }
    // These three are the dashboard's own markup, so boot() finds the same three
    // every time. Wire once, as sync.js does with its two, or a re-boot turns one
    // click into two: two confirms to reset, two files exported, two file pickers.
    /** @param {string} id */
    function once(id) {
      var b = document.getElementById(id);
      if (!b || b.getAttribute("data-wired")) return null;
      b.setAttribute("data-wired", "1");
      return b;
    }
    var reset = once("reset-progress");
    if (reset) reset.addEventListener("click", function () {
      if (!confirm("Clear all section, exercise, exam, drill and streak progress stored in this browser?" +
                   "\n\nOther tabs of the console hold their own copy in memory. Close or reload them " +
                   "first, or the next thing written from any tab puts that copy back.")) return;
      function wipe() {
        // Drop the sync's base too, or the next pull reads this as un-ticking everything.
        if (window.CNPE_SYNC && window.CNPE_SYNC.forgetBase) window.CNPE_SYNC.forgetBase();
        api().reset();                     // which reloads, so nothing here is stale
      }
      if (!(window.CNPE_SYNC && window.CNPE_SYNC.signedIn())) { wipe(); return; }
      // Keeping the saved copy is a real choice, but it does come back.
      if (confirm("Also delete the copy saved to your GitHub account?\n\nCancel keeps it, and this browser will sync it back down on the next load.")) {
        window.CNPE_SYNC.forget().then(wipe, wipe);
      } else wipe();
    });

    var note = document.getElementById("io-note");
    function say(msg) { if (note) { note.textContent = msg; note.hidden = false; } }
    var exp = once("export-progress");
    if (exp) exp.addEventListener("click", function () {
      var text = exportPayload();
      var name = "cnpe-progress-" + new Date().toISOString().slice(0, 10) + ".json";
      if (saveFile(name, text)) { say("Wrote " + name + " to your downloads."); return; }
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
    var imp = once("import-progress");
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

  // buildIndex before buildWeakSpots, as boot() ran them: both paint from the
  // same store and neither reads the other's markup, but keep the order stable.
  window.CNPE_DASH = {
    mount: function () {
      UI = window.CNPE_UI;
      // A cached page from before these existed still fetches this file; leave
      // it the static HTML it already is rather than throwing across it.
      if (!UI || !window.CNPE_MERGE || !window.CNPE_PROGRESS) return;
      tile = UI.tile; href = UI.href;
      buildIndex();
      buildWeakSpots();
    },
  };
  // Mount now as well as from boot(), so this file works loaded either side of
  // app.js: before it, CNPE_UI is not there yet and boot() does the work; after
  // it, this call does, and boot() re-runs are idempotent either way.
  window.CNPE_DASH.mount();
})();
