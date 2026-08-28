/* CNPE curriculum: the theme switch. Three states: system, light and dark. */
(function () {
  "use strict";

  var KEY = "cnpe:theme";
  var MODES = ["system", "light", "dark"];
  var root = document.documentElement;
  var listeners = [];
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var pref = (function () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return MODES.indexOf(v) > 0 ? v : "system";
  })();

  function resolved() { return pref === "system" ? (mq && mq.matches ? "light" : "dark") : pref; }

  // Browser chrome backgrounds, kept in sync with --dk-ink and --lt-ink in the CSS.
  var CHROME = { dark: "#101010", light: "#F4F4F4" };

  function paint() {
    if (pref === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", pref);
    // The metas' media queries only follow the OS, so a pinned theme sets both.
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var scheme = (metas[i].getAttribute("media") || "").indexOf("light") >= 0 ? "light" : "dark";
      metas[i].setAttribute("content", CHROME[pref === "system" ? scheme : pref]);
    }
  }

  function announce() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](pref, resolved()); } catch (e) {}
    }
  }

  function set(next) {
    if (MODES.indexOf(next) < 0) return;
    pref = next;
    try {
      if (pref === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch (e) {}
    paint();
    announce();
  }

  if (mq) {
    var onSystem = function () { if (pref === "system") announce(); };
    if (mq.addEventListener) mq.addEventListener("change", onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  }

  window.CNPE_THEME = {
    modes: MODES,
    pref: function () { return pref; },
    resolved: resolved,
    set: set,
    cycle: function () { set(MODES[(MODES.indexOf(pref) + 1) % MODES.length]); },
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); }
  };

  paint();
})();
