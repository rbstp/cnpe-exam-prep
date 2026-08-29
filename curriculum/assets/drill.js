/* CNPE curriculum: drill mode. Replays the self-check questions as flashcards. */
(function () {
  "use strict";

  var GOAL = 10;                     // cards per day that fill the drill's daily goal
  var DAY = 864e5;
  // As in app.js: a cache can hold an older merge.js as easily as none, so name
  // what this file needs. app.js mounts the drill only if this ran.
  var M = window.CNPE_MERGE;
  if (!M || !M.countOf) return;
  var dueIn = M.dueIn;                   // the card's own schedule; merge.js holds it
  var countOf = M.countOf;

  var session = null;                // { deck, i, right[], missed[], revealed }
  var size = 10, domain = 0;         // deck size, and 0 means all domains
  var keysWired = false;
  var host = null;

  function api() { return window.CNPE_PROGRESS; }
  function store() { return api().get(); }
  function save() { api().save(); }
  function bank() { return window.CNPE_DRILL || []; }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function navOf(sec) {
    return (window.CNPE_NAV || []).filter(function (n) { return n.id === sec; })[0];
  }
  function domOf(q) { return +q.sec.split(".")[0]; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return dayKey(new Date()); }
  function yesterday() { return dayKey(new Date(Date.now() - 864e5)); }

  /* ── records ─────────────────────────────────────────────── */
  function recs() {
    var s = store();
    if (!s.drill || typeof s.drill !== "object") s.drill = {};
    return s.drill;
  }
  function meta() {
    var s = store();
    if (!s.drillmeta || typeof s.drillmeta !== "object") s.drillmeta = {};
    return s.drillmeta;
  }
  function streak() {
    return api().streak ? api().streak() : { streak: 0, best: 0 };
  }

  // Answered before and rested long enough. A card never seen is not a review.
  function dueCount(now) {
    var r = recs(), n = 0;
    bank().forEach(function (q) {
      var rec = r[q.id];
      if (rec && dueIn(rec, now) <= 0) n++;
    });
    return n;
  }

  /* ── the deck ────────────────────────────────────────────── */
  function weightOf(q, now) {
    var rec = recs()[q.id];
    var w = 1;
    if (!rec) w *= 1.6;                                   // never seen
    else {
      var wait = dueIn(rec, now);
      if (wait > 0) w *= 0.15;                            // resting until its review
      else w *= 1 + Math.min(-wait / DAY, 4) * 0.4;       // and louder the longer it is late
      if (!rec.ok) w *= 2;                                // missed last time
      if ((rec.m || 0) > (rec.r || 0)) w *= 2.5;          // missed more than got
      else if (rec.m) w *= 1.4;                           // missed at least once
    }
    if (!store().done[q.sec]) w *= 1.75;                  // section not finished
    return w;
  }
  function buildDeck(n, pool) {
    var now = Date.now();
    var items = pool.map(function (q) { return { q: q, w: weightOf(q, now) }; });
    var deck = [];
    while (deck.length < n && items.length) {
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += items[i].w;
      var r = Math.random() * total;
      for (i = 0; i < items.length && (r -= items[i].w) > 0; i++) {}
      i = Math.min(i, items.length - 1);
      deck.push(items[i].q);
      items.splice(i, 1);
    }
    return deck;
  }

  /* ── scoring ─────────────────────────────────────────────── */
  /* Cards answered today, across every browser this account syncs. bump() writes
     the same number the goal used to keep for itself, one per answer, so the
     goal reads it there rather than in a field only this browser could see. */
  function todayCards() {
    var days = store().days;
    var d = days && days[today()];
    return d ? countOf(d.c) : 0;
  }
  function record(q, ok) {
    var r = recs();
    var rec = r[q.id] || { r: 0, m: 0 };
    if (ok) rec.r++; else rec.m++;
    rec.ok = ok;
    rec.t = Date.now();
    r[q.id] = rec;

    if (api().bump) api().bump("c");                      // every answer counts toward the study streak
    var m = meta();
    // At least ten, not exactly ten: a merge can carry the count past the goal
    // in one step, and the day is earned all the same.
    if (todayCards() >= GOAL && m.earned !== today()) {    // today earns the daily goal
      m.streak = m.earned === yesterday() ? (m.streak || 0) + 1 : 1;
      m.earned = today();
      m.best = Math.max(m.best || 0, m.streak);
    }
    m.t = Date.now();
    save();
  }

  /* ── rendering ───────────────────────────────────────────── */
  function metaLine(text) {
    var span = document.getElementById("drill-meta");
    if (span) span.textContent = text;
  }
  function paintTiles() {
    var all = bank(), r = recs();
    var seen = 0, right = 0, wrong = 0;
    Object.keys(r).forEach(function (k) {
      seen++; right += r[k].r || 0; wrong += r[k].m || 0;
    });
    var set = function (id, html) {
      var e = document.getElementById(id);
      if (e) e.innerHTML = html;
    };
    var due = dueCount(Date.now());
    set("drill-due", due + '<span class="u">of ' + all.length + "</span>");
    set("drill-seen", seen + '<span class="u">/ ' + all.length + "</span>");
    set("drill-acc", right + wrong ? Math.round(right / (right + wrong) * 100) + '<span class="u">%</span>' : '<span class="u">no answers yet</span>');
    var sk = streak();
    set("drill-streak", sk.streak +
      '<span class="u">' + (sk.streak === 1 ? "day" : "days") + (sk.best ? " · record " + sk.best : "") + "</span>");
  }

  function chipRow(label, values, current, onPick) {
    var wrap = el("div", "wpick");
    wrap.appendChild(el("span", "wlbl", label));
    values.forEach(function (v) {
      var b = el("button", "wchip small" + (v.v === current ? " sel" : ""), v.label);
      b.type = "button";
      b.addEventListener("click", function () {
        onPick(v.v);
        Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function renderSetup() {
    session = null;
    host.innerHTML = "";
    var m = meta();
    var todayN = todayCards();
    metaLine(m.earned === today()
      ? "today's " + GOAL + " are in the bank"
      : todayN + " of " + GOAL + " answered today");

    var row = el("div", "wctls-row");
    row.appendChild(chipRow("cards", [{ v: 10, label: "10" }, { v: 20, label: "20" }, { v: 40, label: "40" }],
      size, function (v) { size = v; }));
    row.appendChild(chipRow("domain", [{ v: 0, label: "all" }, { v: 1, label: "d1" }, { v: 2, label: "d2" },
      { v: 3, label: "d3" }, { v: 4, label: "d4" }, { v: 5, label: "d5" }],
      domain, function (v) { domain = v; }));
    host.appendChild(row);

    var start = el("button", "tbtn drill-start", "▶ Start a session");
    start.type = "button";
    start.addEventListener("click", function () {
      var pool = bank().filter(function (q) { return !domain || domOf(q) === domain; });
      startSession(buildDeck(Math.min(size, pool.length), pool));
    });
    var actions = el("div", "drill-actions");
    actions.appendChild(start);
    host.appendChild(actions);

    var due = dueCount(Date.now());
    host.appendChild(el("div", "drill-note",
      "Answer out loud before revealing, then grade yourself honestly; nobody else is watching. " +
      (due ? due === 1 ? "One card is due for review and the deck starts there. "
                       : due + " cards are due for review, and the deck starts there. "
           : "Nothing is due right now, so this is a session ahead of schedule. ") +
      "Getting a card right puts it away for longer than last time; missing it costs a rung and brings it back now. " +
      "The deck also leans toward questions you have not seen and sections you have not marked complete. " +
      "<span class='k'>space</span> reveals, <span class='k'>1</span> missed, <span class='k'>2</span> got it."));
  }

  function startSession(deck) {
    if (!deck.length) { renderSetup(); return; }
    session = { deck: deck, i: 0, right: [], missed: [], revealed: false };
    renderCard();
  }

  function renderCard() {
    var q = session.deck[session.i];
    host.innerHTML = "";

    var prog = el("div", "drill-prog",
      "<span>card " + (session.i + 1) + " / " + session.deck.length + "</span>" +
      '<span class="track"><i style="width:' + (session.i / session.deck.length * 100) + '%"></i></span>' +
      '<span><b class="ok">✓ ' + session.right.length + '</b> · <b class="bad">✕ ' + session.missed.length + "</b></span>");
    host.appendChild(prog);
    metaLine("card " + (session.i + 1) + " of " + session.deck.length);

    var card = el("div", "drill-card");
    card.setAttribute("aria-live", "polite");
    var nav = navOf(q.sec);
    card.appendChild(el("div", "drill-src",
      'from <a href="' + (nav ? nav.path : "index.html") + '">' + q.sec + " · " + (nav ? nav.title : "") + "</a>"));
    card.appendChild(el("div", "drill-q", q.q));

    var actions = el("div", "drill-actions");
    if (!session.revealed) {
      var reveal = el("button", "tbtn", "Show answer");
      reveal.type = "button";
      reveal.addEventListener("click", function () { session.revealed = true; renderCard(); });
      actions.appendChild(reveal);
      actions.appendChild(el("span", "drill-kbd", "space"));
    } else {
      card.appendChild(el("div", "drill-a", q.a));
      var miss = el("button", "tbtn drill-miss", "✕ Missed it");
      var hit = el("button", "tbtn drill-hit", "✓ Got it");
      miss.type = "button"; hit.type = "button";
      miss.addEventListener("click", function () { answer(false); });
      hit.addEventListener("click", function () { answer(true); });
      actions.appendChild(miss);
      actions.appendChild(el("span", "drill-kbd", "1"));
      actions.appendChild(hit);
      actions.appendChild(el("span", "drill-kbd", "2"));
    }
    card.appendChild(actions);
    host.appendChild(card);
  }

  function answer(ok) {
    var q = session.deck[session.i];
    record(q, ok);
    (ok ? session.right : session.missed).push(q);
    session.revealed = false;
    session.i++;
    paintTiles();
    if (session.i >= session.deck.length) renderSummary();
    else renderCard();
  }

  function renderSummary() {
    var missed = session.missed, right = session.right;
    var m = meta();
    var todayN = todayCards();
    session = null;
    host.innerHTML = "";
    metaLine("session done");

    var pct = Math.round(right.length / (right.length + missed.length) * 100);
    var sk = streak();
    var streakLine = "up " + sk.streak + (sk.streak === 1 ? " day" : " days") +
      (m.earned === today()
        ? " · today's " + GOAL + " are in"
        : " · " + Math.max(1, GOAL - todayN) + " more for today's " + GOAL);
    var grid = el("div", "wgrid");
    grid.innerHTML =
      '<div class="wcell"><span class="wk">got it</span><span class="wv wnum">' + right.length + "</span></div>" +
      '<div class="wcell"><span class="wk">missed</span><span class="wv wnum">' + missed.length + "</span></div>" +
      '<div class="wcell"><span class="wk">this session</span><span class="wv wnum">' + pct + '<span class="u">%</span></span></div>' +
      '<div class="wcell"><span class="wk">uptime</span><span class="wv">' + streakLine + "</span></div>";
    host.appendChild(grid);

    if (missed.length) {
      var list = el("div", "drill-missed", "<h4>Worth rereading</h4>");
      missed.forEach(function (q) {
        var nav = navOf(q.sec);
        var row = el("details", "row");
        // Keep the link in the answer body: a link inside <summary> breaks tab order.
        row.innerHTML =
          '<summary><span class="sid">' + q.sec + '</span><span class="mq">' + q.q + "</span></summary>" +
          '<div class="drill-a">' + q.a +
          (nav ? '<p class="goto"><a href="' + nav.path + '">open ' + q.sec + " · " + nav.title + "</a></p>" : "") +
          "</div>";
        list.appendChild(row);
      });
      host.appendChild(list);
    }

    var actions = el("div", "drill-actions");
    if (missed.length) {
      var again = el("button", "tbtn", "↻ Redrill the " + missed.length + " missed");
      again.type = "button";
      again.addEventListener("click", function () {
        startSession(missed.slice().sort(function () { return Math.random() - 0.5; }));
      });
      actions.appendChild(again);
    }
    var fresh = el("button", "tbtn ghost", "New session");
    fresh.type = "button";
    fresh.addEventListener("click", renderSetup);
    actions.appendChild(fresh);
    host.appendChild(actions);
  }

  /* ── keyboard ────────────────────────────────────────────── */
  function keys() {
    if (keysWired) return;
    keysWired = true;
    // Capture phase, so a session owns its keys before app.js's global shortcuts.
    document.addEventListener("keydown", function (e) {
      if (!session || !host || !document.body.contains(host)) return;
      var target = /** @type {HTMLElement} */ (e.target);
      var tag = (target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".overlay.open")) return;
      var handled = true;
      if (!session.revealed && (e.key === " " || e.key === "Enter")) { session.revealed = true; renderCard(); }
      else if (session.revealed && e.key === "1") answer(false);
      else if (session.revealed && e.key === "2") answer(true);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  /* ── mount ───────────────────────────────────────────────── */
  window.CNPE_DRILL_UI = {
    mount: function () {
      var mountEl = document.getElementById("drill-app");
      if (!mountEl || mountEl.getAttribute("data-built")) return;
      mountEl.setAttribute("data-built", "1");
      host = mountEl;
      session = null;
      // The dashboard's weak-spots panel hands over a domain to pre-select.
      try {
        var pre = +sessionStorage.getItem("cnpe:drill-domain") || 0;
        sessionStorage.removeItem("cnpe:drill-domain");
        if (pre >= 1 && pre <= 5) domain = pre;
      } catch (e) {}
      if (!window.CNPE_DRILL || !window.CNPE_PROGRESS) {
        host.innerHTML = '<div class="wnote bad">Drill data did not load; regenerate it with <code>python3 tools/extract-drill.py</code>.</div>';
        return;
      }
      keys();
      paintTiles();
      renderSetup();
    }
  };
  window.CNPE_DRILL_UI.mount();
})();
