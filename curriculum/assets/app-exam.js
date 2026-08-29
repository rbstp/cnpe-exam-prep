/* CNPE curriculum: the mock exam. Mounts on the two papers and nowhere else.

   A panel, on the same terms as widgets.js and drill.js: it exposes a mount(),
   boot() calls it, and it self-mounts too, so it works loaded either side of
   app.js. Its whole dependency on the runtime is CNPE_PROGRESS; the five lines
   of el() below are its own, as drill.js and widgets.js keep theirs. */
(function () {
  "use strict";

  function api() { return window.CNPE_PROGRESS; }
  function store() { return api().get(); }
  function save() { api().save(); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var examTimer = null, examLifecycleWired = false;

  function buildExam() {
    if (examTimer) { clearInterval(examTimer); examTimer = null; }
    if (!document.body.hasAttribute("data-exam")) return;
    var TOTAL = 120 * 60;
    // Each exam page keeps its own clock and score under its own store key.
    var bucket = document.body.getAttribute("data-id") === "EX2" ? "exam2" : "exam";
    var s = store();
    var st = s[bucket] && typeof s[bucket] === "object" ? s[bucket] : {};
    if (!st.tasks || typeof st.tasks !== "object") st.tasks = {};
    s[bucket] = st;
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
    // A paused clock repaints the same digits, so the meter runs only with the
    // paper. paintClock clears st.running at time-up, which stops it here.
    function tick() {
      if (examTimer) { clearInterval(examTimer); examTimer = null; }
      if (st.running) examTimer = setInterval(function () { paintClock(); if (!st.running) tick(); }, 1000);
    }
    // Both buttons are markup, so boot() finds the same two; wire them once.
    if (startBtn && !startBtn.getAttribute("data-wired")) {
      startBtn.setAttribute("data-wired", "1");
      startBtn.addEventListener("click", function () {
        if (st.running) { st.spent = (st.spent || 0) + (Date.now() - st.startedAt) / 1000; st.running = false; }
        else { st.startedAt = Date.now(); st.running = true; }
        store()[bucket] = st; save(); paintClock(); tick();
      });
    }
    if (resetBtn && !resetBtn.getAttribute("data-wired")) {
      resetBtn.setAttribute("data-wired", "1");
      resetBtn.addEventListener("click", function () {
        st.startedAt = 0; st.spent = 0; st.running = false;
        // Zero, not drop: a deleted key says nothing to the merge.
        Object.keys(st.tasks).forEach(function (k) { st.tasks[k] = 0; });
        save();
        Array.prototype.forEach.call(document.querySelectorAll(".task"), function (t) { t.classList.remove("done"); });
        Array.prototype.forEach.call(document.querySelectorAll(".task .dot"), function (d) { d.setAttribute("aria-pressed", "false"); });
        paintClock(); paintScore(); tick();
      });
    }
    paintClock();
    tick();

    // Wire these once: boot() re-runs on navigation and they listen on the document.
    if (!examLifecycleWired) {
      var stamp = function () {
        var cur = store();
        ["exam", "exam2"].forEach(function (k) {
          var e = cur[k];
          if (e && e.running) { e.spent = (e.spent || 0) + (Date.now() - e.startedAt) / 1000; e.startedAt = Date.now(); save(); }
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
        if (st.tasks[i]) api().bump("e");
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
      var sp = /** @type {HTMLElement} */ (document.querySelector("#stat-score .spark i"));
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

  window.CNPE_EXAM = {
    // A cached page from before the store existed still fetches this file; leave
    // it the static HTML it already is rather than throwing across it.
    mount: function () { if (window.CNPE_PROGRESS) buildExam(); },
  };
  // Mount now as well as from boot(), so this file works loaded either side of
  // app.js: before it, CNPE_PROGRESS is not there yet and boot() does the work;
  // after it, this call does, and boot() re-runs are idempotent either way.
  window.CNPE_EXAM.mount();
})();
