/* CNPE curriculum: optional progress sync.

   localStorage stays the source of truth. Signed out, and always over file://,
   nothing here touches the network. Merging reuses the import merge, given the
   base below so that an un-tick travels; counters still take the per-field max. */
(function () {
  "use strict";

  var API = String(window.CNPE_SYNC_API || "https://sync.rbstp.dev").replace(/\/+$/, "");
  var FLAG = "cnpe:sync";
  var BASE = "cnpe:sync-base";
  var RELOADED = "cnpe:sync-reloaded";
  var BUCKETS = ["done", "ex", "exam", "exam2"];
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

  var S = { on: false, login: "", uid: "", rev: 0, note: "", busy: false, muted: false, sent: null,
            noAvatar: false, foreign: false };
  var timer = null, booted = false;

  /* ── availability ────────────────────────────────────────── */
  // The OAuth round trip cannot return to file://, and a null origin holds no cookie.
  function usable() {
    if (!window.fetch || !window.localStorage) return false;
    if (location.protocol === "https:") return true;
    return location.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  /** @param {*} v */
  function numericId(v) {
    var t = String(v == null ? "" : v);
    return /^[0-9]{1,20}$/.test(t) ? t : "";
  }

  /* ── the opt-in flag ─────────────────────────────────────── */
  function readFlag() {
    try {
      var f = JSON.parse(localStorage.getItem(FLAG) || "null");
      return f && typeof f === "object" && f.on ? f : null;
    } catch (e) { return null; }
  }
  /** @param {string} login @param {string} [uid] */
  function writeFlag(login, uid) {
    try {
      localStorage.setItem(FLAG, JSON.stringify({
        on: 1, login: String(login || "").slice(0, 39), uid: numericId(uid),
      }));
    } catch (e) {}
  }
  function clearFlag() { try { localStorage.removeItem(FLAG); } catch (e) {} }

  /* ── the base ────────────────────────────────────────────── */
  /* The last state this browser and the server agreed on. mergeProgress reads it
     to tell "I never had this" from "I removed this", which is the whole trick. */
  /** @param {*} p @return {*} */
  function ticks(p) {
    var out = { done: [], ex: [], exam: [], exam2: [] };
    if (!p || typeof p !== "object") return out;
    BUCKETS.forEach(function (b) {
      var m = b === "exam" || b === "exam2" ? p[b] && p[b].tasks : p[b];
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      out[b] = Object.keys(m).filter(function (k) { return m[k]; }).sort();
    });
    return out;
  }
  /** @param {*} b @return {*} */
  function sets(b) {
    var out = Object.create(null);
    BUCKETS.forEach(function (k) {
      var m = Object.create(null);
      (b && b[k] || []).forEach(function (t) { m[t] = 1; });
      out[k] = m;
    });
    return out;
  }
  /** @param {*} b @return {*} */
  function only(b) {
    return { done: b.done || [], ex: b.ex || [], exam: b.exam || [], exam2: b.exam2 || [] };
  }
  function readBase() {
    try {
      var b = JSON.parse(localStorage.getItem(BASE) || "null");
      return b && typeof b === "object" && !Array.isArray(b) ? b : null;
    } catch (e) { return null; }
  }
  function clearBase() { try { localStorage.removeItem(BASE); } catch (e) {} }
  // A base is only an ancestor of a store that reached the disk, so a swallowed
  // quota error breaks it. So does another tab, but only until that tab saves
  // its own store over ours, which is what S.foreign below is for.
  function settled() {
    if (!window.CNPE_PROGRESS || !window.CNPE_PROGRESS.saved) return false;
    return canon(ticks(window.CNPE_PROGRESS.saved())) === canon(ticks(window.CNPE_PROGRESS.get()));
  }
  /** @param {*} progress @param {number} rev */
  function keepBase(progress, rev) {
    if (S.foreign || !settled()) { clearBase(); return; }
    var t = ticks(progress);
    t.uid = S.uid;
    t.rev = rev;
    try { localStorage.setItem(BASE, JSON.stringify(t)); } catch (e) { clearBase(); }
  }
  /** @param {*} progress @param {number} rev @param {string} uid @return {*} */
  function baseFor(progress, rev, uid) {
    var b = readBase();
    if (!b || S.foreign || !settled()) return null;
    if (b.uid && uid && String(b.uid) !== uid) return null;
    var was = +b.rev || 0;
    if (rev < was) return null;                       // the row was deleted and remade
    // One rev holds one blob, so a match that disagrees is a different row.
    if (rev === was && canon(ticks(progress)) !== canon(only(b))) return null;
    return sets(b);
  }

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
      if (body.user && body.user.login) {
        S.login = String(body.user.login);
        S.uid = numericId(body.user.id);
        writeFlag(S.login, S.uid);
      }
      var added = null;
      if (!body.progress) clearBase();          // no row, so nothing to be an ancestor of
      if (body.progress && window.CNPE_PROGRESS) {
        // Merge against the base in effect, then move it on. The other order
        // makes base and remote agree on every key, and the pull a no-op.
        added = window.CNPE_PROGRESS.merge(body.progress, baseFor(body.progress, S.rev, S.uid));
        muted(function () { window.CNPE_PROGRESS.save(); });
        S.sent = canon(body.progress);
        keepBase(body.progress, S.rev);
      }
      S.busy = false;
      return push().then(function () {
        stamp();
        // Panels paint from the store at load, so a merge that moved something
        // needs a repaint. Only on the dashboard, where the user just asked.
        if (!changed(added)) { mark(RELOADED, null); return; }
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
      if (r.status === 200) {
        S.rev = +r.body.rev || 0; S.sent = body;
        keepBase(progress, S.rev);
        stamp(); paint(); return;
      }
      if (r.status === 409 && n < MAX_RETRY) {
        // Another browser wrote first: take its copy, merge ours in, retry.
        S.rev = +r.body.rev || 0;
        if (r.body.progress && window.CNPE_PROGRESS) {
          window.CNPE_PROGRESS.merge(r.body.progress, baseFor(r.body.progress, S.rev, S.uid));
          muted(function () { window.CNPE_PROGRESS.save(); });
          keepBase(r.body.progress, S.rev);
        }
        return push(n + 1, unloading);
      }
      throw new Error("HTTP " + r.status);
    }).catch(offline);
  }

  /* ── local hooks ─────────────────────────────────────────── */
  /** @param {*} added */
  function changed(added) {
    return !!added &&
      !!(added.done || added.ex || added.exam || added.drill || added.days || added.off);
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
    S.on = false; S.rev = 0; S.sent = null; S.uid = ""; clearFlag(); clearBase();
    say("Not signed in; your progress is still here in this browser.");
  }

  /* ── actions ─────────────────────────────────────────────── */
  function signIn() {
    // The flag records the intent before leaving; it is what makes the page pull on return.
    writeFlag("", "");
    location.href = API + "/auth/start?return=" + encodeURIComponent(location.href);
  }
  function signOut() {
    if (!S.on) return Promise.resolve();
    say("Signing out…");
    // Anything ticked in the last few seconds still belongs in the saved copy.
    return flush().then(function () {
      S.on = false; S.rev = 0; S.sent = null; S.uid = ""; clearFlag(); clearBase();
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
      S.rev = 0; S.sent = null; clearBase();
      say("Deleted the copy saved to your GitHub account. This browser still has everything.");
    }).catch(function () {
      say("Could not delete the saved copy; nothing was changed.");
    }).then(function () { paint(); });
  }

  /* ── dashboard UI ────────────────────────────────────────── */
  /* Derived from the id the Worker already returns, so nothing extra is stored
     or fetched from the API. A blocked or broken image falls back to the glyph
     once and stays there, rather than retrying on every repaint. */
  function avatarSrc() {
    if (!S.on || !S.uid || S.noAvatar) return null;
    return "https://avatars.githubusercontent.com/u/" + S.uid + "?s=64&v=4";
  }
  function paintTop() {
    var b = /** @type {HTMLButtonElement} */ (document.querySelector(".syncbtn"));
    if (!b) return;
    if (!usable()) { b.hidden = true; return; }
    b.hidden = false;
    var src = avatarSrc();
    var img = /** @type {HTMLImageElement} */ (b.querySelector("img.avt"));
    if (src) {
      if (!img || img.getAttribute("data-uid") !== S.uid) {   // keep it, or it refetches
        b.innerHTML = "";
        img = document.createElement("img");
        img.className = "avt";
        img.alt = "";
        img.setAttribute("data-uid", S.uid);
        img.addEventListener("error", function () { S.noAvatar = true; paintTop(); });
        img.src = src;
        b.appendChild(img);
      }
    } else {
      b.innerHTML = S.on ? ICON.on : ICON.out;
    }
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
  /** @param {boolean} ask confirm first; the masthead icon is one stray click from anywhere */
  function toggle(ask) {
    if (!S.on) { signIn(); return; }
    if (ask && !confirm("Sign out of progress sync?\n\nYour progress stays in this browser, " +
                        "and the copy saved to your GitHub account is left alone.")) return;
    signOut();
  }
  function mount() {
    // buildTopbar replaces this element on every boot, so it is always fresh.
    var top = document.querySelector(".syncbtn");
    if (top && !top.getAttribute("data-wired")) {
      top.setAttribute("data-wired", "1");
      top.addEventListener("click", function () { toggle(true); });
    }
    var btn = document.getElementById("sync-btn");
    if (!btn) { paint(); return; }
    // The bundle re-runs every builder per navigation; wire each button once.
    if (btn.getAttribute("data-wired")) { paint(); return; }
    btn.setAttribute("data-wired", "1");
    var del = document.getElementById("sync-forget");
    btn.addEventListener("click", function () { toggle(false); });
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
    // Fires only in the other tabs. Once one has written a store this one never
    // saw, our memory has not incorporated the base and cannot again this life.
    addEventListener("storage", function () { if (!settled()) S.foreign = true; });
    var f = readFlag();
    if (!f) return;
    S.on = true; S.login = f.login || ""; S.uid = numericId(f.uid);
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
    forgetBase: clearBase,
    /** @return {{on: boolean, login: string, rev: number, note: string}} */
    state: function () { return { on: S.on, login: S.login, rev: S.rev, note: S.note }; },
  };
  start();
  mount();
})();
