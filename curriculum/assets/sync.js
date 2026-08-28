/* CNPE curriculum: optional progress sync.

   localStorage stays the source of truth. Signed out, and always over file://,
   nothing here touches the network. Merging reuses the import merge, which is a
   union of ticks and a per-counter max, so two browsers converge in any order. */
(function () {
  "use strict";

  var API = String(window.CNPE_SYNC_API || "https://sync.rbstp.dev").replace(/\/+$/, "");
  var FLAG = "cnpe:sync";
  var RELOADED = "cnpe:sync-reloaded";
  var DEBOUNCE = 2500;
  var MAX_RETRY = 3;

  var HEAD = '<svg class="acct" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" ' +
    'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">' +
    '<circle cx="8" cy="5.6" r="2.5"/><path d="M3.3 13.4a4.7 4.7 0 0 1 9.4 0"/>';
  var ICON = {
    out: HEAD + "</svg>",
    on: HEAD + '<circle cx="12.6" cy="12.4" r="2.9" fill="var(--surface)" stroke="var(--surface)" ' +
        'stroke-width="1.6"/><circle cx="12.6" cy="12.4" r="1.9" fill="currentColor" stroke="none"/></svg>',
  };

  var S = { on: false, login: "", rev: 0, note: "", busy: false, muted: false, sent: null };
  var timer = null, booted = false;

  /* ── availability ────────────────────────────────────────── */
  // The OAuth round trip cannot return to file://, and a null origin holds no cookie.
  function usable() {
    if (!window.fetch || !window.localStorage) return false;
    if (location.protocol === "https:") return true;
    return location.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  /* ── the opt-in flag ─────────────────────────────────────── */
  function readFlag() {
    try {
      var f = JSON.parse(localStorage.getItem(FLAG) || "null");
      return f && typeof f === "object" && f.on ? f : null;
    } catch (e) { return null; }
  }
  function writeFlag(login) {
    try { localStorage.setItem(FLAG, JSON.stringify({ on: 1, login: String(login || "").slice(0, 39) })); } catch (e) {}
  }
  function clearFlag() { try { localStorage.removeItem(FLAG); } catch (e) {} }

  /* ── the payload ─────────────────────────────────────────── */
  // A running exam clock stays on the machine that started it, as import does.
  function snapshot() {
    var p = window.CNPE_PROGRESS ? window.CNPE_PROGRESS.get() : null;
    if (!p) return null;
    var copy;
    try { copy = JSON.parse(JSON.stringify(p)); } catch (e) { return null; }
    // A stable wire shape, so an unchanged store canonicalises to what was sent.
    ["exam", "exam2"].forEach(function (k) {
      var e = copy[k] && typeof copy[k] === "object" && !Array.isArray(copy[k]) ? copy[k] : (copy[k] = {});
      delete e.startedAt; delete e.running; delete e.spent;
      if (!e.tasks || typeof e.tasks !== "object") e.tasks = {};
    });
    delete copy.last;
    return copy;
  }
  // An empty store never earns a remote row.
  function hasAnything(p) {
    if (!p) return false;
    if (["ex", "done", "drill", "days"].some(function (k) {
      return p[k] && typeof p[k] === "object" && Object.keys(p[k]).length > 0;
    })) return true;
    return ["exam", "exam2"].some(function (k) {
      return p[k] && p[k].tasks && Object.keys(p[k].tasks).length > 0;
    });
  }

  /** @param {*} v */
  function canon(v) {
    if (!v || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canon(v[k]);
    }).join(",") + "}";
  }

  /* ── transport ───────────────────────────────────────────── */
  /** @param {string} path @param {RequestInit} [opts] */
  function call(path, opts) {
    var o = opts || {};
    o.credentials = "include";
    o.cache = "no-store";
    o.redirect = "error";
    return fetch(API + path, o);
  }
  // Every failure is a no-op: the work is already saved locally.
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
      S.rev = +body.rev || 0;
      if (body.user && body.user.login) { S.login = String(body.user.login); writeFlag(S.login); }
      var added = null;
      if (body.progress && window.CNPE_PROGRESS) {
        added = window.CNPE_PROGRESS.merge(body.progress);
        muted(function () { window.CNPE_PROGRESS.save(); });
        S.sent = canon(body.progress);
      }
      S.busy = false;
      return push().then(function () {
        stamp();
        // Panels paint from the store at load, so a merge that added something
        // needs a repaint. Only on the dashboard, where the user just asked.
        if (!grew(added)) { mark(RELOADED, null); return; }
        if (document.getElementById("sync-btn") && !mark(RELOADED)) {
          mark(RELOADED, "1");            // a save that never sticks must not loop
          location.reload();
        }
      });
    }).catch(offline).then(function () { S.busy = false; paint(); });
  }

  /** @param {number} [attempt] @param {boolean} [unloading] */
  function push(attempt, unloading) {
    if (!S.on) return Promise.resolve();
    var progress = snapshot();
    if (!hasAnything(progress)) { stamp(); return Promise.resolve(); }
    var body = canon(progress);
    if (body === S.sent) { stamp(); return Promise.resolve(); }
    var n = attempt || 0;
    return call("/v1/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rev: S.rev, progress: progress }),
      keepalive: !!unloading,             // a plain fetch is aborted on unload
    }).then(function (res) {
      if (res.status === 401) { droppedOut(); return null; }
      return res.json().then(function (body) { return { status: res.status, body: body }; });
    }).then(function (r) {
      if (!r) return;
      if (r.status === 200) { S.rev = +r.body.rev || 0; S.sent = body; stamp(); paint(); return; }
      if (r.status === 409 && n < MAX_RETRY) {
        // Another browser wrote first: take its copy, merge ours in, retry.
        S.rev = +r.body.rev || 0;
        if (r.body.progress && window.CNPE_PROGRESS) {
          window.CNPE_PROGRESS.merge(r.body.progress);
          muted(function () { window.CNPE_PROGRESS.save(); });
        }
        return push(n + 1, unloading);
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
    if (!S.on || !timer) return Promise.resolve();
    clearTimeout(timer); timer = null;
    return push(0, true);
  }
  /** @param {string} k @param {string|null} [v] */
  function mark(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  /* ── status line ─────────────────────────────────────────── */
  function say(msg) { S.note = msg; paint(); }
  function stamp() {
    S.note = "Synced " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
             " to " + (S.login ? "@" + S.login : "your GitHub account") + ".";
  }
  function droppedOut() {
    S.on = false; S.rev = 0; S.sent = null; clearFlag();
    say("Not signed in; your progress is still here in this browser.");
  }

  /* ── actions ─────────────────────────────────────────────── */
  function signIn() {
    // The flag records the intent before leaving; it is what makes the page pull on return.
    writeFlag("");
    location.href = API + "/auth/start?return=" + encodeURIComponent(location.href);
  }
  function signOut() {
    if (!S.on) return Promise.resolve();
    say("Signing out…");
    // Anything ticked in the last few seconds still belongs in the saved copy.
    return flush().then(function () {
      S.on = false; S.rev = 0; S.sent = null; clearFlag();
      say("Signed out. Your progress stays in this browser; the saved copy is untouched.");
      return call("/auth/signout", { method: "POST" }).catch(function () { return null; });
    }).then(function () {});
  }
  // Deletes the copy held for this account. Local progress is not touched.
  function forget() {
    if (!S.on) return Promise.resolve();
    return call("/v1/progress", { method: "DELETE" }).then(function (res) {
      if (res.status === 401) { droppedOut(); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      S.rev = 0; S.sent = null;
      say("Deleted the copy saved to your GitHub account. This browser still has everything.");
    }).catch(function () {
      say("Could not delete the saved copy; nothing was changed.");
    }).then(function () { paint(); });
  }

  /* ── dashboard UI ────────────────────────────────────────── */
  function paintTop() {
    var b = /** @type {HTMLButtonElement} */ (document.querySelector(".syncbtn"));
    if (!b) return;
    if (!usable()) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = S.on ? ICON.on : ICON.out;
    b.classList.toggle("on", S.on);
    b.classList.toggle("warn", !S.on && /unreachable/.test(S.note));
    var title = S.on
      ? (S.note || "Syncing to your GitHub account.") + " Click to sign out."
      : "Sign in with GitHub to keep your progress across browsers.";
    b.title = title;
    b.setAttribute("aria-label", title);
  }
  function paint() {
    paintTop();
    var btn = /** @type {HTMLButtonElement} */ (document.getElementById("sync-btn"));
    var del = /** @type {HTMLButtonElement} */ (document.getElementById("sync-forget"));
    var note = document.getElementById("sync-note");
    if (!btn) return;
    if (!usable()) { btn.hidden = true; if (del) del.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = S.on ? (S.login ? "Sign out (@" + S.login + ")" : "Sign out") : "Sign in to sync";
    // ghost and .on set colour at the same specificity, so only one may be on.
    btn.classList.toggle("on", S.on);
    btn.classList.toggle("ghost", !S.on);
    if (del) del.hidden = !S.on;
    if (note) { note.textContent = S.note; note.hidden = !S.note; }
  }
  function toggle() { if (S.on) signOut(); else signIn(); }
  function mount() {
    // buildTopbar replaces this element on every boot, so it is always fresh.
    var top = document.querySelector(".syncbtn");
    if (top && !top.getAttribute("data-wired")) {
      top.setAttribute("data-wired", "1");
      top.addEventListener("click", toggle);
    }
    var btn = document.getElementById("sync-btn");
    if (!btn) { paint(); return; }
    // The bundle re-runs every builder per navigation; wire each button once.
    if (btn.getAttribute("data-wired")) { paint(); return; }
    btn.setAttribute("data-wired", "1");
    var del = document.getElementById("sync-forget");
    btn.addEventListener("click", toggle);
    if (del) del.addEventListener("click", function () {
      if (confirm("Delete the progress copy saved to your GitHub account? This browser keeps its own.")) forget();
    });
    paint();
  }

  /* ── boot ────────────────────────────────────────────────── */
  function start() {
    if (booted) return;
    booted = true;
    if (!usable()) return;
    if (window.CNPE_PROGRESS) window.CNPE_PROGRESS.onSave(schedule);
    var f = readFlag();
    if (!f) return;
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
