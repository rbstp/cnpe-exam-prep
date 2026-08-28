# Optional progress sync, with GitHub sign-in

The study console is local-first and stays that way. `localStorage` is the source
of truth; this is a mirror bolted on top of it, off by default, and everything in
the console works identically without it.

Concretely, the guarantees the code holds to, each asserted by a browser check in
`curriculum/tools/browser-checks/sync.js`:

* Over `file://` there is no sync UI and **no request is ever made**.
* On the hosted site, signed out, there is a button and still **no request**.
* Signed in, a failing or unreachable Worker costs a status line and nothing else:
  local progress is already saved before sync hears about it.
* Signing out stops the syncing and leaves both copies, local and saved, intact.

If you never press **Sign in to sync**, nothing below applies to you and the
console behaves exactly as it did before.

## Why this needs a Worker at all

GitHub Pages serves static bytes. It cannot hold an OAuth client secret and it
cannot run code, and GitHub is no help here either:

* GitHub [supports PKCE since July 2025](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/)
  but still requires the client secret at the token exchange, because it does not
  distinguish public from confidential clients. PKCE does not buy a browser-only
  flow the way it does with an OIDC provider that does.
* `https://github.com/login/oauth/access_token` sends no CORS headers and does not
  answer `OPTIONS`. A browser cannot complete the exchange at all, the device flow
  included.

So exactly one piece of compute is unavoidable. It is a single Cloudflare Worker,
and it changes nothing about how the site is hosted or deployed.

## What it stores

One row per GitHub user: the numeric user id, the login, a revision counter and
the `cnpe:v2` store as JSON. Nothing else. A **fully completed** store, meaning all
29 sections, all 123 exercises, all 148 drill cards, both mock exams and a year of
study days, is about 21 KB.

Two things deliberately do not travel:

* **The mock exam clock.** `startedAt`, `running` and `spent` are stripped before
  the push, so a running exam stays on the machine that started it. That matches
  what Import has always done.
* **Any GitHub credential.** The OAuth scope is empty, so this is identity only.
  The token GitHub returns is used once, server-side, to read the account id, and
  is never stored. The consent screen says "public data only"; this service can no more
  read your repositories or gists than a stranger can.

## How conflicts resolve

They do not, because the merge cannot conflict. `CNPE_PROGRESS.merge`, the same
function Import has always used, is a union of ticks and a per-field max of the
counters: commutative, idempotent, and monotone. It never lowers anything. Drill
records are the interesting case, because they are cumulative: `r` and `m` take
the max independently, and only `ok` and `t` follow the clock, so two browsers
that each answered the same card offline keep both answers.

The Worker holds a `rev` per row. A `PUT` carrying a stale `rev` is rejected with
`409` **and the current copy**; the client merges that in and retries with the
fresh `rev`. So two browsers that both worked offline converge on the union of
their work whenever they next reach the network, in any order, with no locking and
no conflict UI.

Two consequences worth knowing, both following from "never lowers anything":

* **Un-ticking does not propagate.** A union cannot express a removal, so if you
  un-tick an exercise on the laptop while the desktop's copy still has it ticked,
  the next sync ticks it back. Un-tick on each synced browser, or use **Reset
  progress**, which is a deletion rather than a merge.
* **Two tabs of the same browser still diverge**, exactly as they did before sync
  existed: each tab holds its own in-memory store and `save()` writes the whole
  blob. Sync heals that once both tabs' work reaches the server, which is why the
  push on `pagehide` uses `keepalive`.

---

# What you need to configure

Four things: a GitHub OAuth app, a D1 database, two secrets, and a deploy. Roughly
ten minutes. Everything that is *code* is already in `sync/`.

## 1. A GitHub OAuth app

github.com → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
(Not "GitHub App": a plain OAuth app is the right shape for identity-only login.)

| Field | Value |
|---|---|
| Application name | `CNPE study console` |
| Homepage URL | `https://cnpe.rbstp.dev` |
| Authorization callback URL | `https://sync.rbstp.dev/auth/callback` |
| Enable Device Flow | leave unticked |

Save. Copy the **Client ID** into `sync/wrangler.toml` under `[vars]`, then press
**Generate a new client secret** and keep the value on screen for step 4, because
GitHub will not show it again.

**Upload a logo** while you are there: `sync/oauth-app-logo.png` is the console's
own stack mark on its dark ground, 512x512, which is what people see on the
authorize screen. It is rendered from `curriculum/assets/favicon.svg`, so the two
cannot drift into different marks; GitHub masks it to a circle, and the padding
is set so nothing clips.

The app needs no scopes and no permissions to request. `/auth/start` sends
`scope=`, empty, on purpose.

## 2. The D1 database

```bash
cd sync
npx wrangler login                                    # once, per machine
npx wrangler d1 create cnpe-progress                  # prints a database_id
```

Paste the printed `database_id` into `sync/wrangler.toml`, then create the table:

```bash
npx wrangler d1 execute cnpe-progress --remote --file=schema.sql
```

`--remote` matters: without it you write to a local emulator and the deployed
Worker sees an empty database.

## 3. Deploy

The deploy comes before the secrets: `wrangler secret put` needs the Worker to
exist, and offers to create an empty one if it does not. Let the real deploy
create it instead.

```bash
npx wrangler deploy
curl https://sync.rbstp.dev/healthz                   # → ok
```

`wrangler.toml` declares `sync.rbstp.dev` as a **Custom Domain**, so the deploy
creates the proxied DNS record and its certificate for you. You do not add a
record by hand.

## 4. The two secrets

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET          # paste from step 1
npx wrangler secret put SESSION_SECRET                # openssl rand -base64 32
```

They take effect immediately; there is no second deploy. Between step 3 and here
the Worker is live but unconfigured, which is the guard doing its job:

```bash
curl https://sync.rbstp.dev/v1/progress
# {"error":"sync is not configured: SESSION_SECRET"}
```

`SESSION_SECRET` signs the session cookie and the OAuth state. Rotating it signs
everyone out; it does not touch stored progress. It must be at least 16 characters:
the Worker refuses every route with a 500 naming the missing value rather than
signing cookies with a guessable key, so a half-configured deploy fails loudly.

### This does not touch the Pages hostname

`docs/deploy-pages.md` §2 says to leave `cnpe` grey-cloud, and that still holds.
The orange-cloud record this creates is `sync`, a different name whose only origin
is the Worker. `cnpe.rbstp.dev` keeps its GitHub Pages certificate and its grey
cloud, and nothing in that document changes.

### Why `sync.rbstp.dev` and not `*.workers.dev`

`workers.dev` is on the Public Suffix List, so a Worker there would be a different
**site** from `cnpe.rbstp.dev`, and the session cookie would be a third-party
cookie, already blocked in Safari and going away in Chrome. `sync.rbstp.dev` shares
the registrable domain `rbstp.dev`, which makes the fetch same-site, which is what
lets a plain `HttpOnly; Secure; SameSite=Lax` cookie through. The session token
therefore never touches JavaScript at all.

This is a hard constraint, not a preference: **the Worker must answer on the same
registrable domain as the console.**

## 5. Verify

The same call that named the missing secret should now say you are merely signed
out, which means everything is configured:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://sync.rbstp.dev/v1/progress
# 401   configured. A 500 still names whatever is missing.
```

Open <https://cnpe.rbstp.dev>, press **Sign in to sync**, approve, and the button
should come back reading `Sign out (@you)` with a `Synced HH:MM` line under it.
Then:

```bash
npx wrangler d1 execute cnpe-progress --remote \
  --command "SELECT user_id, login, rev, length(blob) AS bytes, updated_at FROM progress"
```

Tick an exercise, wait a few seconds, run it again: `rev` and `bytes` should move.

## If you fork this, or rename anything

The Worker origin is one constant, `API`, at the top of
`curriculum/assets/sync.js`. It must agree with three other places:

| Place | What it is |
|---|---|
| `curriculum/assets/sync.js` → `API` | where the browser calls |
| `sync/wrangler.toml` → `routes` | where the Worker answers |
| GitHub OAuth app → callback URL | `<that origin>/auth/callback` |
| `sync/wrangler.toml` → `ALLOWED_ORIGINS` | the console's origin, comma-separated for more than one |
| `sync/wrangler.toml` → `ALLOWED_LOGINS` | optional guest list; unset means any GitHub account |

`curriculum/tools/check-site.sh` asserts the staged site points at `$SYNC_DOMAIN`
(default `sync.rbstp.dev`), in both `assets/sync.js` and the single-file
`console.html`, so a rename that misses a spot fails the merge gate rather than
the live site.

`ALLOWED_ORIGINS` is doing real work: it is the allowlist for CORS **and** the
allowlist for the post-sign-in redirect. An origin missing from it cannot sign in,
and an unlisted `return` URL is replaced with the first allowed origin rather than
followed. Otherwise this would be an open redirect wearing a GitHub login.

## Running it locally

```bash
cd sync && npx wrangler dev --local          # http://127.0.0.1:8787
make site && python3 -m http.server -d _site 8080
```

Then, in the browser console on `http://127.0.0.1:8080`, before signing in:

```js
window.CNPE_SYNC_API = "http://127.0.0.1:8787";
```

Add `http://127.0.0.1:8080` to `ALLOWED_ORIGINS` for the dev run. `sync.js` allows
`localhost`/`127.0.0.1` over plain http for exactly this; every other non-https
origin, `file://` included, gets no sync at all.

## The cost

Nothing, with a very large margin. The [Workers free plan](https://developers.cloudflare.com/workers/platform/pricing/)
is 100,000 requests/day, and [D1's](https://developers.cloudflare.com/d1/platform/pricing/)
is 5 GB with 5M row reads and 100,000 row writes per day. Pushes are debounced to
one per 2.5 seconds of idle plus one when the tab is hidden, and a store that
already matches what the server holds is not pushed at all, so a hard study
session is a few hundred requests and an idle reload is none. Fifty people using it daily would spend a few
percent of the request budget and a rounding error of the storage.

D1 rather than KV for two reasons: KV's free plan allows 1,000 writes/day against
D1's 100,000, and KV is eventually consistent for up to a minute, which is
precisely wrong when the entire point is a laptop and a desktop agreeing.

## Keeping it to yourself

As deployed above, anyone with a GitHub account can sign in and store *their own*
progress, and they never see yours. If you would rather it stayed a guest list, set
`ALLOWED_LOGINS` in `sync/wrangler.toml` to a comma-separated list of GitHub
logins; everyone else gets a 403 at the callback and nothing is stored for them.
Leave it unset and the door is open, which is fine: 5 GB at ~21 KB a head is
around a quarter of a million completed study records.

## What you are taking on

If anyone but you signs in, you are holding their study record. It is tick-boxes
and dates, not personal data of consequence, but it is theirs:

* **Delete saved copy** on the dashboard removes their row (`DELETE /v1/progress`).
* **Reset progress**, while signed in, asks a second time whether to delete the
  saved copy. Decline and it stays, and this browser syncs it back down on the next
  load; the confirm says so.
* `[observability] enabled = false` in `wrangler.toml` keeps request bodies out of
  Cloudflare's logs.

To shut the whole thing down: `npx wrangler delete` removes the Worker. Browsers
already signed in fall back to local-only on their next load, with a note saying
the Worker is unreachable; a browser that presses **Sign in to sync** after that
gets its own connection-error page, since sign-in is a navigation. Nobody loses
any progress, because nobody ever had it only there.

## Notes on the hardening

Worth knowing if you change any of it:

* The session and OAuth-state cookies carry the `__Host-` prefix, so no other host
  under `rbstp.dev` can set one for the Worker. That prefix also forbids a `Domain`
  attribute, which is why the cookie is host-only.
* `PUT` and `DELETE` require an allowed `Origin` header outright, not merely the
  absence of a disallowed one. `GET` tolerates a missing one so `curl` still works.
* Bodies are capped at 64 KB, three times a completed store, before and after the
  JSON round trip. Every query is parameterised through `bind()`.
* `CNPE_PROGRESS.merge` skips `__proto__`, `constructor` and `prototype` keys. That
  matters more now than it did for Import: the merge takes network input, and one
  of its buckets assigns whole objects by key.
* The session is a signed cookie with a 30-day expiry and no server-side
  revocation list. Signing out clears the cookie; rotating `SESSION_SECRET`
  invalidates every outstanding one.
* There is no per-account rate limit. `ALLOWED_LOGINS` is the answer if that
  matters to you; without it, a signed-in account could spend D1's daily write
  budget.
* `sync/test.mjs` drives the Worker directly with a stub D1: forged, tampered,
  expired and wrong-key session cookies, the CORS gate on every credentialed
  route, six open-redirect attempts on `return`, the state and nonce checks on
  the callback, cross-account isolation, and the optimistic-concurrency SQL.
  Plain `node sync/test.mjs`, no dependencies, and CI runs it on every PR.

## The protocol

| | | |
|---|---|---|
| `GET` | `/auth/start?return=<url>` | → GitHub authorize, empty scope, signed state |
| `GET` | `/auth/callback` | token exchange, session cookie, 302 back to `<url>` |
| `POST` | `/auth/signout` | clears the session cookie |
| `GET` | `/v1/progress` | `{ user, rev, progress, updated }`, or 401 |
| `PUT` | `/v1/progress` | `{ rev, progress }` → `{ rev, updated }`; 409 carries the current copy |
| `DELETE` | `/v1/progress` | forget the stored copy |
| `GET` | `/healthz` | `ok` |

Sign-in intent is recorded in `localStorage` under `cnpe:sync` *before* the
redirect, which is what tells the returning page to pull. There is no marker
appended to your URL, and the Worker redirects back to the exact page you left.
