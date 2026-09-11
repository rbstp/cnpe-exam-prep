/* The shared study shell, including the quest page, defaults to dark. */
(function () {
  "use strict";

  var KEY = "cnpe:theme";
  var MODES = ["system", "light", "dark"];
  var root = document.documentElement;
  var study = root.hasAttribute("data-study");
  var listeners = [];
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var pref = (function () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return MODES.indexOf(v) > 0 ? v : null;
  })();

  function preference() { return pref || (study ? "dark" : "system"); }
  function resolved() { return preference() === "system" ? (mq && mq.matches ? "light" : "dark") : preference(); }

  // Browser chrome backgrounds, kept in sync with --dk-ink and --lt-ink in the CSS.
  var CHROME = { dark: "#171511", light: "#F3EFE6" };
  var STUDY_CHROME = { dark: "#171c1d", light: "#f6f5f0" };

  function paint() {
    var mode = preference();
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    // The metas' media queries only follow the OS, so a pinned theme sets both.
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var scheme = (metas[i].getAttribute("media") || "").indexOf("light") >= 0 ? "light" : "dark";
      metas[i].setAttribute("content", (study ? STUDY_CHROME : CHROME)[mode === "system" ? scheme : mode]);
    }
  }

  function announce() {
    // over a copy: a listener may let itself (or another) go while it is told
    var fns = listeners.slice();
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](preference(), resolved()); } catch (e) {}
    }
  }

  function set(next) {
    if (MODES.indexOf(next) < 0) return;
    pref = next === "system" ? null : next;
    try {
      if (!pref) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch (e) {}
    paint();
    announce();
  }

  if (mq) {
    var onSystem = function () { if (preference() === "system") announce(); };
    if (mq.addEventListener) mq.addEventListener("change", onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  }

  window.CNPE_THEME = {
    modes: MODES,
    pref: preference,
    resolved: resolved,
    set: set,
    cycle: function () {
      set(study ? (resolved() === "dark" ? "light" : "dark") : MODES[(MODES.indexOf(preference()) + 1) % MODES.length]);
    },
    study: function (on) {
      if (study === on) return;
      study = on;
      root.toggleAttribute("data-study", on);
      paint();
      announce();
    },
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    // the same function that was given to onChange; the quest lets its handler go on unmount
    offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
  };

  paint();
})();
