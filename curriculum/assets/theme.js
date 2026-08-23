/* CNPE curriculum: theme.
   Loaded from <head>, before the body paints, so a pinned theme is on the root
   element from the first frame and no page flashes the wrong ground.

   Three states, cycled by the masthead button (or the "t" key):

     system   nothing stored, no attribute; style.css follows
              prefers-color-scheme, so this also works with scripting off
     light    data-theme="light"
     dark     data-theme="dark"

   The choice is a property of this browser, not of your progress, so it lives
   under its own key and stays out of the progress export. */
(function () {
  "use strict";

  var KEY = "cnpe:theme";
  var MODES = ["system", "light", "dark"];
  var root = document.documentElement;
  var listeners = [];
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var pref = (function () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}          // private mode, file:// quirks
    return MODES.indexOf(v) > 0 ? v : "system";
  })();

  function resolved() { return pref === "system" ? (mq && mq.matches ? "light" : "dark") : pref; }

  function paint() {
    if (pref === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", pref);
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

  // While following the system, the OS switching under us changes what the
  // button is reporting, so listeners hear about it too.
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
