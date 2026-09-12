/* The theme switch: dark by default, light on request, remembered per browser. */
(function () {
  "use strict";

  var KEY = "cnpe:theme";
  var MODES = ["light", "dark"];
  var root = document.documentElement;
  var listeners = [];
  var pref = (function () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return MODES.indexOf(v) >= 0 ? v : "dark";
  })();

  // browser chrome, kept in sync with --ink in style.css and the theme-color metas (check-site.sh)
  var CHROME = { dark: "#171c1d", light: "#f6f5f0" };

  function paint() {
    root.setAttribute("data-theme", pref);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", CHROME[pref]);
  }

  function announce() {
    // over a copy: a listener may let itself (or another) go while it is told
    var fns = listeners.slice();
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](pref, pref); } catch (e) {}
    }
  }

  function set(next) {
    if (MODES.indexOf(next) < 0) return;
    pref = next;
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    paint();
    announce();
  }

  window.CNPE_THEME = {
    modes: MODES,
    pref: function () { return pref; },
    resolved: function () { return pref; },
    set: set,
    cycle: function () { set(pref === "dark" ? "light" : "dark"); },
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    // the same function that was given to onChange; the quest lets its handler go on unmount
    offChange: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
  };

  paint();
})();
