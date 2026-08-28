/* CNPE study console: optional progress sync.
 *
 * The console is local-first. Everything here is opt-in: a browser that never
 * presses "Sign in to sync" never talks to this Worker, and a browser that
 * signs out goes back to exactly that. This service stores one JSON blob per
 * GitHub user and nothing else — no analytics, no logs of progress content.
 *
 * Routes
 *   GET    /auth/start?return=<url>   → GitHub authorize (no scopes: identity only)
 *   GET    /auth/callback             → token exchange, session cookie, back to <url>
 *   POST   /auth/signout              → clear the session cookie
 *   GET    /v1/progress               → { user, rev, progress, updated }
 *   PUT    /v1/progress               → { rev, progress }; 409 carries the current copy
 *   DELETE /v1/progress               → forget the stored copy
 *   GET    /healthz                   → "ok"
 *
 * Bindings: DB (D1). Vars: GITHUB_CLIENT_ID, ALLOWED_ORIGINS.
 * Secrets: GITHUB_CLIENT_SECRET, SESSION_SECRET.
 */
"use strict";

const SESSION_COOKIE = "cnpe_session";
const STATE_COOKIE = "cnpe_oauth";
const SESSION_TTL = 60 * 60 * 24 * 90;         // 90 days
const STATE_TTL = 60 * 10;                     // the sign-in round trip
const MAX_BLOB = 512 * 1024;                   // a completed store is ~21 KB

/* ── small helpers ──────────────────────────────────────────── */

/** @param {ArrayBuffer|Uint8Array} buf */
function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** @param {string} s */
function unb64url(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(pad + "===".slice((pad.length + 3) % 4));
}
/** @param {string} a @param {string} b */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** @param {string} secret @param {string} data */
async function sign(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
/** Sign a JSON payload into "<body>.<mac>". @param {string} secret @param {*} obj */
async function seal(secret, obj) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(obj)));
  return body + "." + await sign(secret, body);
}
/** Verify and decode a sealed payload, or null. @param {string} secret @param {string} token */
async function unseal(secret, token) {
  const dot = (token || "").lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  if (!timingSafeEqual(token.slice(dot + 1), await sign(secret, body))) return null;
  let obj;
  try { obj = JSON.parse(unb64url(body)); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.e !== "number" || obj.e < Math.floor(Date.now() / 1000)) return null;
  return obj;
}

/** @param {Request} req @param {string} name */
function cookie(req, name) {
  const raw = req.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
/** @param {string} name @param {string} value @param {number} maxAge */
function setCookie(name, value, maxAge) {
  // No Domain attribute: the cookie is host-only for this Worker. It still
  // reaches us from the console because both names share a registrable domain,
  // which makes the fetch same-site and lets SameSite=Lax through.
  return name + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}

/* ── CORS ───────────────────────────────────────────────────── */

/** @param {Env} env */
function origins(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
}
/** The request's Origin if we allow it. @param {Request} req @param {Env} env */
function allowedOrigin(req, env) {
  const o = req.headers.get("Origin");
  return o && origins(env).indexOf(o) >= 0 ? o : null;
}
/** @param {Response} res @param {string|null} origin */
function withCors(res, origin) {
  if (!origin) return res;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.append("Vary", "Origin");
  return res;
}
/** @param {*} obj @param {number} [status] */
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/* ── session ────────────────────────────────────────────────── */

/** @param {Request} req @param {Env} env */
async function session(req, env) {
  const tok = cookie(req, SESSION_COOKIE);
  if (!tok) return null;
  const s = await unseal(env.SESSION_SECRET, tok);
  return s && s.u ? { uid: String(s.u), login: String(s.l || "") } : null;
}

/* ── auth ───────────────────────────────────────────────────── */

/** A return URL is only honoured if it sits on an allowed origin.
    @param {string|null} target @param {Env} env */
function safeReturn(target, env) {
  const allow = origins(env);
  if (!target) return allow[0] || null;
  let u;
  try { u = new URL(target); } catch { return allow[0] || null; }
  return allow.indexOf(u.origin) >= 0 ? u.toString() : (allow[0] || null);
}

/** @param {Request} req @param {Env} env */
async function authStart(req, env) {
  const back = safeReturn(new URL(req.url).searchParams.get("return"), env);
  if (!back) return new Response("no allowed return origin configured", { status: 500 });
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const state = await seal(env.SESSION_SECRET, { n: nonce, r: back, e: Math.floor(Date.now() / 1000) + STATE_TTL });
  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  auth.searchParams.set("redirect_uri", new URL("/auth/callback", req.url).toString());
  auth.searchParams.set("state", state);
  auth.searchParams.set("scope", "");          // identity only: no repo, no gist, nothing
  auth.searchParams.set("allow_signup", "false");
  return new Response(null, {
    status: 302,
    headers: { Location: auth.toString(), "Set-Cookie": setCookie(STATE_COOKIE, nonce, STATE_TTL) },
  });
}

/** @param {Request} req @param {Env} env */
async function authCallback(req, env) {
  const q = new URL(req.url).searchParams;
  const state = await unseal(env.SESSION_SECRET, q.get("state") || "");
  const nonce = cookie(req, STATE_COOKIE);
  const clear = setCookie(STATE_COOKIE, "", 0);
  if (!state || !nonce || !timingSafeEqual(String(state.n), nonce)) {
    return new Response("sign-in state did not check out; start again", { status: 400, headers: { "Set-Cookie": clear } });
  }
  const back = safeReturn(String(state.r || ""), env);
  // "Cancel" on GitHub's consent screen comes back here as an error. Send them
  // to the console rather than to a dead end; it will drop the opt-in itself.
  if (q.get("error")) return new Response(null, { status: 302, headers: { Location: back || "/", "Set-Cookie": clear } });
  const code = q.get("code");
  if (!code) return new Response("no code in the callback", { status: 400, headers: { "Set-Cookie": clear } });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/auth/callback", req.url).toString(),
    }),
  });
  const tok = /** @type {*} */ (await tokenRes.json().catch(() => ({})));
  if (!tok || !tok.access_token) {
    return new Response("GitHub declined the token exchange", { status: 502, headers: { "Set-Cookie": clear } });
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: "Bearer " + tok.access_token,
      Accept: "application/vnd.github+json",
      "User-Agent": "cnpe-progress-sync",
    },
  });
  const user = /** @type {*} */ (await userRes.json().catch(() => ({})));
  if (!user || !user.id) {
    return new Response("could not read the GitHub account", { status: 502, headers: { "Set-Cookie": clear } });
  }
  // Optional guest list. Unset means anyone with a GitHub account may sign in.
  const guests = (env.ALLOWED_LOGINS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (guests.length && guests.indexOf(String(user.login).toLowerCase()) < 0) {
    return new Response("this console does not sync for @" + user.login, { status: 403, headers: { "Set-Cookie": clear } });
  }
  // The GitHub token has served its only purpose. It is never stored, and with
  // an empty scope it could not have read anything but the public profile.

  const sess = await seal(env.SESSION_SECRET, {
    u: user.id, l: user.login, e: Math.floor(Date.now() / 1000) + SESSION_TTL,
  });
  const headers = new Headers({ Location: back || "/" });
  headers.append("Set-Cookie", setCookie(SESSION_COOKIE, sess, SESSION_TTL));
  headers.append("Set-Cookie", clear);
  return new Response(null, { status: 302, headers });
}

/* ── progress ───────────────────────────────────────────────── */

/** The blob has to look like a cnpe:v2 store before it earns a row. @param {*} p */
function looksLikeProgress(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  return ["ex", "done", "exam", "exam2", "drill", "drillmeta", "days"]
    .some(k => p[k] && typeof p[k] === "object");
}

/** @param {Env} env @param {string} uid */
async function readRow(env, uid) {
  return /** @type {*} */ (await env.DB
    .prepare("SELECT rev, blob, updated_at FROM progress WHERE user_id = ?")
    .bind(uid).first());
}

/** @param {Request} req @param {Env} env @param {{uid: string, login: string}} who */
async function putProgress(req, env, who) {
  const raw = await req.text();
  if (raw.length > MAX_BLOB) return json({ error: "too large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "not JSON" }, 400); }
  if (!body || typeof body !== "object" || !looksLikeProgress(body.progress)) {
    return json({ error: "not a progress payload" }, 400);
  }
  const rev = Number(body.rev) || 0;
  const blob = JSON.stringify(body.progress);
  const now = new Date().toISOString();

  if (rev > 0) {
    const upd = await env.DB.prepare(
      "UPDATE progress SET blob = ?, login = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND rev = ?"
    ).bind(blob, who.login, now, who.uid, rev).run();
    if (upd.meta.changes === 1) return json({ rev: rev + 1, updated: now });
  } else {
    const ins = await env.DB.prepare(
      "INSERT OR IGNORE INTO progress (user_id, login, rev, blob, updated_at) VALUES (?, ?, 1, ?, ?)"
    ).bind(who.uid, who.login, blob, now).run();
    if (ins.meta.changes === 1) return json({ rev: 1, updated: now });
  }

  // Someone else got there first. Hand back what is stored; the client merges
  // its own copy into it and comes back with the fresh rev.
  const row = await readRow(env, who.uid);
  if (!row) return json({ error: "write raced with a delete; retry" }, 409);
  return json({ rev: row.rev, progress: JSON.parse(row.blob), updated: row.updated_at }, 409);
}

/* ── router ─────────────────────────────────────────────────── */

/** @type {ExportedHandler} */
const handler = {
  /** @param {Request} req @param {Env} env */
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);

    if (req.method === "OPTIONS") {
      return withCors(new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, PUT, DELETE, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      }), origin);
    }

    if (url.pathname === "/healthz") return new Response("ok\n");
    if (url.pathname === "/auth/start" && req.method === "GET") return authStart(req, env);
    if (url.pathname === "/auth/callback" && req.method === "GET") return authCallback(req, env);
    if (url.pathname === "/auth/signout" && req.method === "POST") {
      return withCors(new Response(null, { status: 204, headers: { "Set-Cookie": setCookie(SESSION_COOKIE, "", 0) } }), origin);
    }

    if (url.pathname === "/v1/progress") {
      // Everything below is credentialed, so it must come from a known origin.
      // Reads tolerate a missing Origin (curl, a health probe); writes never do.
      if (req.headers.get("Origin") && !origin) return json({ error: "origin not allowed" }, 403);
      if ((req.method === "PUT" || req.method === "DELETE") && !origin) {
        return json({ error: "origin required" }, 403);
      }
      const who = await session(req, env);
      if (!who) return withCors(json({ error: "signed out" }, 401), origin);

      if (req.method === "GET") {
        const row = await readRow(env, who.uid);
        return withCors(json({
          user: { login: who.login, id: who.uid },
          rev: row ? row.rev : 0,
          progress: row ? JSON.parse(row.blob) : null,
          updated: row ? row.updated_at : null,
        }), origin);
      }
      if (req.method === "PUT") return withCors(await putProgress(req, env, who), origin);
      if (req.method === "DELETE") {
        await env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(who.uid).run();
        return withCors(json({ deleted: true }), origin);
      }
      return withCors(json({ error: "method not allowed" }, 405), origin);
    }

    return new Response("not found\n", { status: 404 });
  },
};

export default handler;
