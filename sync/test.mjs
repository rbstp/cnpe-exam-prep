/* Direct tests for the sync Worker. Plain node, no dependencies:
 *
 *     node sync/test.mjs
 *
 * The browser checks stub this service, so its CORS gate, state validation and
 * optimistic-concurrency SQL are only exercised here. */
import worker from "./worker.js";

let checks = 0, failures = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) console.log("  ok  " + label);
  else { failures++; console.log("  FAIL " + label); }
};
const group = t => console.log(t);

/* A D1 stand-in: one table, the three statements the Worker actually issues. */
function fakeDB(seed) {
  const rows = new Map(seed || []);
  return {
    rows,
    prepare(sql) {
      let args = [];
      const self = {
        bind(...v) { args = v; return self; },
        async first() {
          if (sql === "SELECT 1 AS ok") return { ok: 1 };
          const r = rows.get(args[0]);
          return r ? { rev: r.rev, blob: r.blob, updated_at: r.updated_at } : null;
        },
        async run() {
          if (sql.startsWith("UPDATE")) {
            const [blob, login, now, uid, rev] = args;
            const r = rows.get(uid);
            if (!r || r.rev !== rev) return { success: true, meta: { changes: 0 } };
            rows.set(uid, { login, rev: r.rev + 1, blob, updated_at: now });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT")) {
            const [uid, login, blob, now] = args;
            if (rows.has(uid)) return { success: true, meta: { changes: 0 } };
            rows.set(uid, { login, rev: 1, blob, updated_at: now });
            return { success: true, meta: { changes: 1 } };
          }
          rows.delete(args[0]);
          return { success: true, meta: { changes: 1 } };
        },
      };
      return self;
    },
  };
}

const SITE = "https://cnpe.rbstp.dev";
const SECRET = "test-session-secret-0123456789";
const env = (over) => Object.assign({
  DB: fakeDB(),
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  SESSION_SECRET: SECRET,
  ALLOWED_ORIGINS: SITE,
}, over || {});

const b64url = buf => Buffer.from(buf).toString("base64url");
async function seal(secret, obj) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return body + "." + b64url(new Uint8Array(mac));
}
const hour = n => Math.floor(Date.now() / 1000) + n * 3600;
const session = (uid, exp) => seal(SECRET, { u: uid, l: "octocat", e: exp === undefined ? hour(1) : exp });

function req(path, o = {}) {
  const h = new Headers(o.headers || {});
  if (o.origin) h.set("Origin", o.origin);
  if (o.cookie) h.set("Cookie", o.cookie);
  if (o.body) h.set("Content-Type", "application/json");
  return new Request("https://sync.rbstp.dev" + path, { method: o.method || "GET", headers: h, body: o.body });
}
const call = (path, o = {}, e) => worker.fetch(req(path, o), e || env());

async function run() {
  group("misconfiguration fails loudly instead of signing with a guessable key");
  for (const [name, over] of [
    ["SESSION_SECRET", { SESSION_SECRET: "" }],
    ["SESSION_SECRET", { SESSION_SECRET: "short" }],
    ["GITHUB_CLIENT_ID", { GITHUB_CLIENT_ID: "" }],
    ["GITHUB_CLIENT_SECRET", { GITHUB_CLIENT_SECRET: "" }],
    ["ALLOWED_ORIGINS", { ALLOWED_ORIGINS: "" }],
    ["DB", { DB: null }],
  ]) {
    const res = await call("/v1/progress", { origin: SITE }, env(over));
    const body = await res.json();
    ok(res.status === 500 && body.error.indexOf(name) >= 0, "missing " + name + " is a 500 that names it");
  }
  ok((await call("/healthz", {}, env({ SESSION_SECRET: "" }))).status === 200, "healthz still answers unconfigured");

  group("readiness checks configuration and D1 without authentication or progress data");
  let res = await call("/readyz");
  ok(res.status === 200 && (await res.json()).ready === true, "readyz accepts a configured Worker with a reachable D1 binding");
  res = await call("/readyz", {}, env({ SESSION_SECRET: "" }));
  ok(res.status === 503 && /SESSION_SECRET/.test((await res.json()).error), "readyz reports missing configuration");
  res = await call("/readyz", {}, env({ DB: { prepare() { throw new Error("D1 unavailable"); } } }));
  ok(res.status === 503 && (await res.json()).error === "database is not ready", "readyz reports a failed D1 query without leaking details");

  group("the session cookie cannot be forged, tampered with, or outlived");
  const good = await session("42");
  const cases = [
    ["no cookie", ""],
    ["a made-up token", "__Host-cnpe_session=aaaa.bbbb"],
    ["a payload with the signature of another", "__Host-cnpe_session=" + b64url(new TextEncoder().encode(JSON.stringify({ u: "99", e: hour(1) }))) + "." + good.split(".")[1]],
    ["a token signed with the wrong key", "__Host-cnpe_session=" + await seal("some-other-secret-value", { u: "42", e: hour(1) })],
    ["an expired token", "__Host-cnpe_session=" + await session("42", hour(-1))],
    ["a token with no expiry", "__Host-cnpe_session=" + await seal(SECRET, { u: "42" })],
    ["a non-base64url payload", "__Host-cnpe_session=..!!.zz"],
  ];
  for (const [label, cookie] of cases) {
    const res = await call("/v1/progress", { origin: SITE, cookie });
    ok(res.status === 401, label + " is rejected");
  }
  ok((await call("/v1/progress", { origin: SITE, cookie: "__Host-cnpe_session=" + good })).status === 200,
    "a well-formed token is accepted");

  group("credentialed routes are fenced to the configured origins");
  ok((await call("/v1/progress", { origin: "https://evil.example", cookie: "__Host-cnpe_session=" + good })).status === 403,
    "an unlisted origin cannot read");
  ok((await call("/v1/progress", { method: "PUT", origin: "https://evil.example", cookie: "__Host-cnpe_session=" + good, body: "{}" })).status === 403,
    "an unlisted origin cannot write");
  ok((await call("/v1/progress", { method: "PUT", cookie: "__Host-cnpe_session=" + good, body: "{}" })).status === 403,
    "a write with no Origin at all is refused");
  ok((await call("/v1/progress", { method: "DELETE", cookie: "__Host-cnpe_session=" + good })).status === 403,
    "so is a delete with no Origin");
  ok((await call("/auth/signout", { method: "POST" })).status === 403,
    "a cross-site form post cannot sign anyone out");
  const allowed = await call("/v1/progress", { origin: SITE, cookie: "__Host-cnpe_session=" + good });
  ok(allowed.headers.get("Access-Control-Allow-Origin") === SITE &&
     allowed.headers.get("Access-Control-Allow-Credentials") === "true" &&
     /Origin/.test(allowed.headers.get("Vary") || ""), "an allowed origin gets credentialed CORS and Vary");
  const pre = await call("/v1/progress", { method: "OPTIONS", origin: "https://evil.example" });
  ok(pre.status === 204 && !pre.headers.get("Access-Control-Allow-Origin"),
    "the preflight agrees with the request: no ACAO for an unlisted origin");
  const pre2 = await call("/v1/progress", { method: "OPTIONS", origin: SITE });
  ok(pre2.headers.get("Access-Control-Allow-Origin") === SITE &&
     /PUT/.test(pre2.headers.get("Access-Control-Allow-Methods") || ""), "and does allow a listed one");

  group("the sign-in redirect cannot be pointed anywhere else");
  for (const evil of [
    "https://evil.example/",
    "https://cnpe.rbstp.dev.evil.example/",
    "https://user@evil.example/",
    "javascript:alert(1)",
    "//evil.example",
    "",
  ]) {
    const res = await call("/auth/start?return=" + encodeURIComponent(evil));
    const state = new URL(res.headers.get("Location")).searchParams.get("state");
    const back = JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString()).r;
    ok(res.status === 302 && back === SITE, JSON.stringify(evil) + " is replaced with the allowed origin");
  }
  const start = await call("/auth/start?return=" + encodeURIComponent(SITE + "/index.html"));
  const loc = new URL(start.headers.get("Location"));
  ok(loc.origin + loc.pathname === "https://github.com/login/oauth/authorize", "sign-in goes to GitHub");
  ok(loc.searchParams.get("scope") === "", "with an empty scope");
  ok(/^__Host-cnpe_oauth=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/.test(start.headers.get("Set-Cookie")),
    "and a __Host- state cookie: " + start.headers.get("Set-Cookie"));

  group("the callback checks the state against the cookie");
  const nonce = "n0nce";
  const state = await seal(SECRET, { n: nonce, r: SITE, e: hour(1) });
  for (const [label, q, cookie] of [
    ["no state at all", "?code=x", "__Host-cnpe_oauth=" + nonce],
    ["a state signed with the wrong key", "?code=x&state=" + await seal("another-secret-entirely", { n: nonce, r: SITE, e: hour(1) }), "__Host-cnpe_oauth=" + nonce],
    ["an expired state", "?code=x&state=" + await seal(SECRET, { n: nonce, r: SITE, e: hour(-1) }), "__Host-cnpe_oauth=" + nonce],
    ["a state whose nonce is not the cookie's", "?code=x&state=" + state, "__Host-cnpe_oauth=different"],
    ["a valid state with no cookie", "?code=x&state=" + state, ""],
  ]) {
    const res = await call("/auth/callback" + q, { cookie });
    ok(res.status === 400, label + " is refused");
  }
  const cancelled = await call("/auth/callback?error=access_denied&state=" + state, { cookie: "__Host-cnpe_oauth=" + nonce });
  ok(cancelled.status === 302 && cancelled.headers.get("Location") === SITE + "/",
    "a cancelled sign-in goes home, not to a dead end: " + cancelled.headers.get("Location"));
  const exact = await call("/auth/callback?error=access_denied&state=" +
    await seal(SECRET, { n: nonce, r: SITE + "/mock-exam.html", e: hour(1) }), { cookie: "__Host-cnpe_oauth=" + nonce });
  ok(exact.headers.get("Location") === SITE + "/mock-exam.html", "and back to the exact page it left");

  group("writes are optimistic and cannot cross accounts");
  const db = fakeDB();
  const e = env({ DB: db });
  const mine = "__Host-cnpe_session=" + await session("42");
  const theirs = "__Host-cnpe_session=" + await session("99");
  const put = (cookie, rev, progress) => call("/v1/progress",
    { method: "PUT", origin: SITE, cookie, body: JSON.stringify({ rev, progress }) }, e);

  res = await put(mine, 0, { done: { "1.1": 1 } });
  ok(res.status === 200 && (await res.json()).rev === 1, "a first write inserts at rev 1");
  res = await put(mine, 0, { done: { "1.1": 1 } });
  ok(res.status === 409, "a second write still claiming rev 0 conflicts");
  res = await put(mine, 5, { done: { "2.1": 1 } });
  const conflict = await res.json();
  ok(res.status === 409 && conflict.rev === 1 && conflict.progress.done["1.1"] === 1,
    "a stale rev conflicts and hands back the current copy");
  res = await put(mine, 1, { done: { "1.1": 1, "2.1": 1 } });
  ok(res.status === 200 && (await res.json()).rev === 2, "the matching rev wins and advances");

  res = await put(theirs, 0, { done: { "9.9": 1 } });
  ok(res.status === 200, "another account writes its own row");
  res = await call("/v1/progress", { origin: SITE, cookie: mine }, e);
  let body = await res.json();
  ok(body.progress.done["1.1"] === 1 && !body.progress.done["9.9"], "and cannot be read into the first");
  ok(body.user.id === "42", "the row is keyed by the id in the cookie, not anything sent");

  group("payloads are validated before they reach the table");
  ok((await put(mine, 2, { nope: 1 })).status === 400, "a payload with no known bucket is refused");
  ok((await put(mine, 2, "a string")).status === 400, "so is a non-object");
  ok((await put(mine, 2, null)).status === 400, "so is null");
  ok((await call("/v1/progress", { method: "PUT", origin: SITE, cookie: mine, body: "{not json" }, e)).status === 400,
    "so is a body that is not JSON");
  ok((await put(mine, 2, { done: { x: "y".repeat(70000) } })).status === 413, "an oversized body is refused");
  ok((await call("/v1/progress", {
    method: "PUT", origin: SITE, cookie: mine, body: "{}", headers: { "Content-Length": "65537" },
  }, e)).status === 413, "a declared body over the limit is refused before parsing");
  res = await call("/v1/progress", { origin: SITE, cookie: mine }, e);
  body = await res.json();
  ok(body.rev === 2 && body.progress.done["2.1"] === 1, "and none of it disturbed the stored copy");

  const unicodeDB = fakeDB();
  const unicodeEnv = env({ DB: unicodeDB });
  const unicodePut = value => call("/v1/progress", {
    method: "PUT", origin: SITE, cookie: mine,
    body: JSON.stringify({ rev: 0, progress: { done: { x: value } } }),
  }, unicodeEnv);
  ok((await unicodePut("é".repeat(32000))).status === 200, "a multibyte payload below 64 KiB is accepted");
  ok((await unicodePut("é".repeat(33000))).status === 413, "a multibyte payload over 64 KiB is refused by its UTF-8 size");
  ok(unicodeDB.rows.get("42").rev === 1, "the rejected multibyte payload does not disturb the stored copy");

  group("delete removes only the caller's row");
  ok((await call("/v1/progress", { method: "DELETE", origin: SITE, cookie: mine }, e)).status === 200, "delete answers");
  ok(!db.rows.has("42") && db.rows.has("99"), "the caller's row is gone and the other account's is not");
  body = await (await call("/v1/progress", { origin: SITE, cookie: mine }, e)).json();
  ok(body.rev === 0 && body.progress === null, "a deleted row reads back as nothing to merge");

  group("odds and ends");
  ok((await call("/v1/progress", { method: "PATCH", origin: SITE, cookie: mine }, e)).status === 405, "an unknown method is refused");
  ok((await call("/nope")).status === 404, "an unknown path is a 404");
  const corrupt = env({ DB: fakeDB([["42", { login: "x", rev: 3, blob: "{not json", updated_at: "now" }]]) });
  body = await (await call("/v1/progress", { origin: SITE, cookie: mine }, corrupt)).json();
  ok(body.rev === 0 && body.progress === null, "a corrupt stored blob reads as no row, not a 500");
  const j = await call("/v1/progress", { origin: SITE });
  ok(j.headers.get("X-Content-Type-Options") === "nosniff" &&
     /application\/json/.test(j.headers.get("Content-Type")) &&
     j.headers.get("Cache-Control") === "no-store", "responses carry nosniff, a JSON type and no-store");

  console.log("\n" + checks + " checks, " + failures + " failures");
  process.exitCode = failures ? 1 : 0;
}

run().catch(e => { console.error(e); process.exit(1); });
