/* CNPE curriculum: optional progress sync.

   The console is local-first and stays that way. localStorage is the source of
   truth; this file is a mirror on top of it. Signed out — which is the default,
   and the only possibility over file:// — nothing here touches the network, and
   every feature behaves exactly as it does without this script. Signed in, the
   store is pushed to the sync Worker after each change and merged back on load.

   Merging is the existing import merge (CNPE_PROGRESS.merge): a union of ticks
   and a per-counter max of the counters. It is commutative, idempotent and
   never lowers anything, so two browsers that both worked offline converge on
   the union of their work whenever they next reach the network, in any order. */
(function () {
  "use strict";

  var API = String(window.CNPE_SYNC_API || "https://sync.rbstp.dev").replace(/\/+$/, "");
  var FLAG = "cnpe:sync";
  var DEBOUNCE = 2500;
  var MAX_RETRY = 3;

  var S = { on: false, login: "", rev: 0, at: null, note: "", busy: false, muted: false };
  var timer = null, booted = false;

  /* ── availability ────────────────────────────────────────── */
  /* Sync needs a real origin: the OAuth round trip cannot come back to file://,
     and a null origin cannot hold a cookie. Local http is allowed so the site
     can be driven against a Worker in `wrangler dev`. */
  function usable() {
    if (!window.fetch || !window.localStorage) return false;
    if (location.protocol === "https:") return true;
    return location.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  /* ── the opt-in flag ─────────────────────────────────────── */
  function readFlag() {
    try {
      var raw = localStorage.getItem(FLAG);
      if (!raw) return null;
      var f = JSON.parse(raw);
      return f && typeof f === "object" && f.on ? f : null;
    } catch (e) { return null; }
  }
  function writeFlag(login) {
    try { localStorage.setItem(FLAG, JSON.stringify({ on: 1, login: login || "" })); } catch (e) {}
  }
  function clearFlag() {
    try { localStorage.removeItem(FLAG); } catch (e) {}
  }

  /* ── the payload ─────────────────────────────────────────── */
  /* What travels is progress, not session: the mock exam's running clock stays
     on the machine that started it, exactly as Import already leaves it alone. */
  function snapshot() {
    var p = window.CNPE_PROGRESS ? window.CNPE_PROGRESS.get() : null;
    if (!p) return null;
    var copy;
    try { copy = JSON.parse(JSON.stringify(p)); } catch (e) { return null; }
    ["exam", "exam2"].forEach(function (k) {
      if (copy[k] && typeof copy[k] === "object") {
        delete copy[k].startedAt; delete copy[k].running; delete copy[k].spent;
      }
    });
    return copy;
  }
  /* An empty store never earns a remote row: a fresh browser that signs in
     should pull, not create a row full of nothing. */
  function hasAnything(p) {
    if (!p) return false;
    var some = ["ex", "done", "drill", "days"].some(function (k) {
      return p[k] && typeof p[k] === "object" && Object.keys(p[k]).length > 0;
    });
    if (some) return true;
    return ["exam", "exam2"].some(function (k) {
      return p[k] && p[k].tasks && Object.keys(p[k].tasks).length > 0;
    });
  }

  /* ── transport ───────────────────────────────────────────── */
  /** @param {string} path @param {RequestInit} [opts] */
  function call(path, opts) {
    var o = opts || {};
    o.credentials = "include";
    o.cache = "no-store";
    return fetch(API + path, o);
  }
  /* Every failure is a no-op: local progress is already saved, so a Worker that
     is down, blocked or unreachable costs a status line and nothing else. */
  function offline() {
    say("Sync unreachable; your progress is saved in this browser.");
    return null;
  }

  /* ── pull, merge, push ───────────────────────────────────── */
  function pull() {
    if (!S.on || S.busy) return Promise.resolve();
    S.busy = true;
    say("Syncing…");
    return call("/v1/progress").then(function (res) {
      if (res.status === 401) { droppedOut(); return null; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (body) {
      if (!body) return;
      S.rev = body.rev || 0;
      if (body.user && body.user.login) { S.login = body.user.login; writeFlag(S.login); }
      var added = null;
      if (body.progress && window.CNPE_PROGRESS) {
        added = window.CNPE_PROGRESS.merge(body.progress);
        muted(function () { window.CNPE_PROGRESS.save(); });
      }
      S.busy = false;
      return push().then(function () {
        stamp();
        // Panels are painted from the store at load, so a merge that actually
        // added something needs a repaint. Reload only on the dashboard, where
        // the user is looking at totals and just asked for this; elsewhere the
        // merge is saved and shows on the next navigation.
        if (grew(added) && document.getElementById("sync-btn")) location.reload();
      });
    }).catch(offline).then(function () { S.busy = false; paint(); });
  }

  /** @param {number} [attempt] */
  function push(attempt) {
    if (!S.on) return Promise.resolve();
    var progress = snapshot();
    if (!hasAnything(progress)) { stamp(); return Promise.resolve(); }
    var n = attempt || 0;
    return call("/v1/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rev: S.rev, progress: progress }),
    }).then(function (res) {
      if (res.status === 401) { droppedOut(); return null; }
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    }).then(function (r) {
      if (!r) return;
      if (r.status === 200) { S.rev = r.body.rev; stamp(); paint(); return; }
      if (r.status === 409 && n < MAX_RETRY) {
        // Another browser wrote first. Take its copy, merge ours into it, retry.
        S.rev = r.body.rev || 0;
        if (r.body.progress && window.CNPE_PROGRESS) {
          window.CNPE_PROGRESS.merge(r.body.progress);
          muted(function () { window.CNPE_PROGRESS.save(); });
        }
        return push(n + 1);
      }
      throw new Error("HTTP " + r.status);
    }).catch(offline);
  }

  /* ── local hooks ─────────────────────────────────────────── */
  /** @param {*} added */
  function grew(added) {
    return !!added && !!(added.done || added.ex || added.exam || added.drill || added.days);
  }
  function muted(fn) { S.muted = true; try { fn(); } finally { S.muted = false; } }
  function schedule() {
    if (!S.on || S.muted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; push(); }, DEBOUNCE);
  }
  function flush() {
    if (!S.on || !timer) return;
    clearTimeout(timer); timer = null;
    push();
  }

  /* ── status line ─────────────────────────────────────────── */
  function say(msg) { S.note = msg; paint(); }
  function stamp() {
    S.at = new Date();
    S.note = "Synced " + S.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
             " to " + (S.login ? "@" + S.login : "your GitHub account") + ".";
  }
  function droppedOut() {
    S.on = false; S.rev = 0; clearFlag();
    // Covers both an expired session and a sign-in the user backed out of.
    say("Not signed in; your progress is still here in this browser.");
  }

  /* ── actions ─────────────────────────────────────────────── */
  function signIn() {
    // Record the intent before leaving: the Worker redirects back to this exact
    // URL untouched, and the flag is what tells the returning page to pull.
    writeFlag("");
    location.href = API + "/auth/start?return=" + encodeURIComponent(location.href);
  }
  function signOut() {
    var was = S.on;
    S.on = false; S.rev = 0; clearFlag();
    if (timer) { clearTimeout(timer); timer = null; }
    say("Signed out. Your progress stays in this browser; the saved copy is untouched.");
    paint();
    if (!was) return Promise.resolve();
    return call("/auth/signout", { method: "POST" }).catch(function () { return null; }).then(function () {});
  }
  /* Delete the copy held for this account. Local progress is not touched here;
     Reset progress is what clears the browser, and it calls this first. */
  function forget() {
    if (!S.on) return Promise.resolve();
    return call("/v1/progress", { method: "DELETE" }).then(function (res) {
      if (res.status === 401) { droppedOut(); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      S.rev = 0;
      say("Deleted the copy saved to your GitHub account. This browser still has everything.");
    }).catch(function () {
      say("Could not delete the saved copy; nothing was changed.");
    }).then(function () { paint(); });
  }

  /* ── dashboard UI ────────────────────────────────────────── */
  function paint() {
    var btn = /** @type {HTMLButtonElement} */ (document.getElementById("sync-btn"));
    var del = /** @type {HTMLButtonElement} */ (document.getElementById("sync-forget"));
    var note = document.getElementById("sync-note");
    if (!btn) return;
    if (!usable()) { btn.hidden = true; if (del) del.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = S.on ? (S.login ? "Sign out (@" + S.login + ")" : "Sign out") : "Sign in to sync";
    // ghost dims it like Export/Import; .on is the green "this is live" state,
    // and the two set colour at the same specificity, so only one may be on.
    btn.classList.toggle("on", S.on);
    btn.classList.toggle("ghost", !S.on);
    if (del) del.hidden = !S.on;
    if (note) {
      note.textContent = S.note;
      note.hidden = !S.note;
    }
  }
  function mount() {
    var btn = document.getElementById("sync-btn");
    if (!btn) return;                       // not the dashboard
    // The bundled console re-runs every builder on each hash navigation, and
    // normal pages mount once at load: wire each button exactly once either way.
    if (btn.getAttribute("data-wired")) { paint(); return; }
    btn.setAttribute("data-wired", "1");
    var del = document.getElementById("sync-forget");
    btn.addEventListener("click", function () { if (S.on) signOut(); else signIn(); });
    if (del) del.addEventListener("click", function () {
      if (confirm("Delete the progress copy saved to your GitHub account? This browser keeps its own.")) forget();
    });
    paint();
  }

  /* ── boot ────────────────────────────────────────────────── */
  function start() {
    if (booted) return;
    booted = true;
    if (!usable()) return;                  // file://: local only, no network, ever
    if (window.CNPE_PROGRESS) window.CNPE_PROGRESS.onSave(schedule);
    var f = readFlag();
    if (!f) return;                         // signed out: still no network
    S.on = true; S.login = f.login || "";
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
    pull();
  }

  window.CNPE_SYNC = {
    mount: mount,
    signedIn: function () { return S.on; },
    forget: forget,
    /** @return {{on: boolean, login: string, rev: number, note: string}} */
    state: function () { return { on: S.on, login: S.login, rev: S.rev, note: S.note }; },
  };
  start();
  mount();
})();
