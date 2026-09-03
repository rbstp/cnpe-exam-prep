# Optional progress sync, with GitHub sign-in

The study console is local-first and stays that way. `localStorage` is the source
of truth; this is a mirror bolted on top of it, off by default, and everything in
the console works identically without it.

Concretely, the guarantees the code holds to, each asserted by a browser check in
`curriculum/tools/browser-checks/`, under `sync.js`, `streak.js` or `tabs.js`:

* Over `file://` there is no sync UI and **no request is ever made**.
* On the hosted site, signed out, there is a button and still **no request**.
* Signed in, a failing or unreachable Worker costs a status line and nothing else:
  local progress is already saved before sync hears about it.
* Signing out stops the syncing and leaves both copies, local and saved, intact.
* A tick and an un-tick both reach the other browsers, and work this browser did
  not itself undo survives every merge it takes part in.
* The section you last read follows you, so **Resume** offers the same one on
  every browser, ticked or not.
* A day's work adds up across browsers rather than the larger side hiding the
  smaller: six cards here and six there is a day of twelve, and the drill's goal
  of ten is earned by it.
* Two tabs of one browser converge on the same store instead of overwriting each
  other, signed in or not; that one is local-first machinery, not sync.

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
29 sections, all 123 exercises, all 148 drill cards, both mock exams and a full
window of study days, is about 19 KB against a 64 KB ceiling.
The Worker measures that ceiling on the UTF-8 encoded JSON, not JavaScript
character count, so multibyte text cannot bypass the limit.

The window is 30 days, the same span the dashboard's heat strip draws, and `KEEP`
in `merge.js` is the one number that says so. Days older than that are dropped as
the store is written, and a day that arrives from anywhere older is not taken in
at all.

A streak outlives them. Before dropping anything, `pruneDays` writes down how
long the run below the window was and the day it ended on, and the walk back from
today picks that up where the stored days run out. So 60 days running still reads
as 60 with 30 days on disk, and the record with it. The carry travels, because
the days that would otherwise prove it do not.

Three things deliberately do not travel:

* **The mock exam clock.** `startedAt`, `running` and `spent` are stripped before
  the push, so a running exam stays on the machine that started it. That matches
  what Import has always done.
* **The theme.** System, light or dark is a property of the screen you are
  looking at, not of the account: dark on the phone and light on the laptop is a
  setting, not a bug. It lives in `cnpe:theme`, outside the store, and no merge
  has ever touched it.
* **Any GitHub credential.** The OAuth scope is empty, so this is identity only.
  The token GitHub returns is used once, server-side, to read the account id, and
  is never stored. The consent screen says "public data only"; this service can no more
  read your repositories or gists than a stranger can.

## How conflicts resolve

Counters cannot conflict, ticks resolve against a base, and the resume pointer
carries the moment it was set.

The counters are a per-field max. `drill.r` and `m` take it independently, `days`
counts the same way, and only `ok` and `t` follow the clock, so two browsers that
each answered the same card offline keep both answers. Nothing lowers them.

Ticks are a three-way merge, the shape `git merge` uses. Each browser keeps a
**base** in `localStorage` under `cnpe:sync-base`: the ticked keys of the last
state it and the server agreed on. Then, per key,

```
result = (local === base) ? remote : local
```

which reads as: I have not touched this since we last agreed, so take the
server's; or I have, so mine wins, an un-tick included. Over booleans that cannot
conflict, because if local and remote both differ from base then both are the
opposite of base, so they agree. There is no conflict case and so no conflict UI.

With no base every base value is 0 and the rule collapses to `local OR remote`,
the plain union this used to be. That is the fallback wherever the base cannot be
trusted, and it is also what Import gets: an imported file is somebody else's
history, not a state this browser ever agreed on, so `merge` is called without a
base and an import still cannot un-tick anything.

### Counters, and why a day is a map

A day's counters are the one thing a max cannot answer. Six cards on the laptop
and six on the phone is twelve answered, but a single `days[today].c` merging by
max can only say six: it has no way to tell one browser's six from the other's,
and adding them would count them twice the next time the same copy merged.

So each counter is a map of browser id to that browser's own count, read as their
sum. Every slot still takes the max, so merging the same payload twice is still a
no-op, and the day adds up across browsers. The id names a slot and is not
progress: it lives in `cnpe:dev`, is minted on a browser's first action rather
than at load, and never travels, because two browsers sharing a slot would hide
each other's work exactly as before.

A plain number is a store written before this, or one written by a browser still
on the old script. It reads as a single unnamed slot and merges by max the way it
always did, so nothing is lost and nothing is claimed: a browser adding to such a
day puts its own count beside the number rather than taking it over, which would
count the same answers twice on two browsers that both held it.

Today's card count against the drill's goal of ten is read from that counter, so
a session split across two browsers earns the day. `drillmeta.day` and `n`, which
used to keep the same number where only one browser could see it, are no longer
written or merged.

The resume pointer is neither a counter nor a tick: there is one of it, and the
answer wanted is the section read most recently anywhere, not the one whichever
browser pushed last. So `last` travels with `lastAt`, the epoch millisecond the
pointer was set, and a copy that arrives moves it only if its stamp is at least
the local one. A store written before this shipped carries no stamp, reads as 0,
and is overtaken by the first section anything reads after it. Like the drill's
own `t`, this trusts the browsers' clocks; a badly wrong one costs a resume
button pointing at the wrong section and nothing else.

The Worker holds a `rev` per row. A `PUT` carrying a stale `rev` is rejected with
`409` **and the current copy**; the client merges that in, against the base in
effect, and retries with the fresh `rev`. So two browsers that both worked offline
converge whenever they next reach the network, in any order, with no locking.

### When the base is not trusted

A base is only usable while it is genuinely an ancestor of this browser's store.
Four checks, and failing any of them falls back to the union:

* **The store must have reached the disk.** `save()` swallows storage errors, so a
  quota failure would otherwise leave a base claiming a merge that never landed,
  and the next load would push the missing work up as a removal. So the base is
  written only after the store write is confirmed, and read only while the
  persisted store still matches the one in memory.
* **No other tab may have written the store**, unless this one took that write
  in. The base and the store are shared across tabs; the in-memory copy is not.
  A second tab that saves its own older store re-aligns disk and memory, so the
  check above goes quiet just when it is needed most, and that tab would read the
  first tab's work as a removal. The `storage` event fires only in the *other*
  tabs, and app.js answers it first by merging that store into memory (below);
  sync looks after it, so a store and a disk that still disagree mean the merge
  could not fix it, and that tab stops trusting the base for the rest of its life.
* **The row must be the one the base came from.** A `rev` below the base's means
  the row was deleted and remade, and so does a `rev` equal to the base's with
  different ticks, since one `rev` holds one blob. A pull that finds no row at all
  drops the base outright. Between them these catch every remake this browser can
  see; a row deleted and rebuilt past the old `rev` by a browser that never held
  this one's work, without this browser pulling in between, is not visible to any
  of them.
* **The account must match.** Belt and braces, since signing out clears the base.

**Reset progress** clears the base as well, which is what keeps it a local wipe
rather than a mass un-tick: declining the second confirm still syncs the saved copy
back down, exactly as that confirm says.

### Two tabs, one disk

Tabs share the store on the disk and nothing else, so `save()` used to be a
clobber: the last tab to write won, and whatever the other one held only in memory
was gone until it saved again. That is the same problem the sync solves, one level
down, and it takes the same merge.

Each tab keeps `seen`, the ticked keys of the store as it last left it on the disk,
in memory and nowhere else. When the `storage` event says another tab wrote,
app.js re-reads the store and merges it in with `seen` as the base: what this tab
changed since wins, and everything else follows the disk, an un-tick included. Then
the panels repaint, because they paint from the store at load. Two tabs that both
run this end up holding the same store, whichever of them wrote.

The base is narrowed before that merge. A tick that is *missing* from the other
tab's store, rather than sitting in it as `0`, is one that store never had: the
console writes `0` to un-tick and never drops a key. So the base speaks only for
the keys the other store mentions, and a tab that saved an older copy of
everything, one running the previous bundle included, reads as the stale tab it is
rather than as a mass removal.

The other direction, whether this tab owes the disk anything, is a different
question and takes the unnarrowed base: what has this tab changed since the two
last agreed? Normally nothing, because every change saves as it is made, and then
there is nothing to write and no answering write for the other tab to answer. It is
not nothing after a save that threw, which is exactly the work that would otherwise
be lost. Asking the wider question instead, whether the disk lacks anything this tab
holds, would put a whole store back over a **Reset progress** that another tab had
just run.

The resume pointer is left out of both questions. A merge that moved only it
neither repaints nor writes: repainting would stamp this tab's own section back
over the pointer it just took, and two tabs on two sections would then write at
each other for as long as both stayed open. It rides the next save either tab
makes. The sync repaints by reloading the page, which restamps nothing, so it does
act on the pointer.

So a reset still only clears the tab it was run in. The others keep what they hold
in memory, and the first write from any tab, the resetting one included, is enough
to put that copy back: the reset moves what the tabs agree on to an empty store, so
everything the stale tab holds reads as new work the next time anyone writes. That
is where this was before any of this, and the Reset confirm now says so: close or
reload the other tabs first.

### What still does not travel

* **A browser running older JavaScript.** Until it loads the new bundle it merges
  the old way and ticks things back. Every asset reference carries a hash of the
  file, so a page and the scripts it pulls are at least always the same version of
  the console, but the page itself still rides Pages' ten-minute cache, and a tab
  that is already open keeps the code it started with until it is reloaded.
* **An un-tick that lost a race.** A browser that was offline with a pending
  un-tick wins over a newer re-tick made elsewhere, because a base cannot see a
  change that nets back to where it started. Telling those apart needs a per-key
  clock, which is a larger thing than this is.
* **A removal arriving on a `409`** is not repainted until the next load. The pull
  repaints; the conflict retry does not.
* **A tab that never sees the write.** The `storage` event does not queue, so a
  frozen or discarded tab can miss one; it re-reads the store when it becomes
  visible again, which covers coming back to it, but not a save made from a tab
  that is still in the background.

One deliberate change of behaviour: the mock exam's own **Reset** button now clears
that paper on every synced browser. It zeroes its task keys rather than deleting
them, because a key that is simply gone says nothing to the merge.


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
stack mark set inside a hexagon on the dark ground, 512x512, which is what people
see on the authorize screen. Its source is `sync/oauth-app-logo.svg`, which reuses
the favicon's mark geometry and the palette from `curriculum/assets/style.css`, so
the two cannot drift into different marks. GitHub masks it to a circle, and the
hexagon sits inside that circle so nothing clips. To regenerate the PNG after
editing the SVG:

```bash
npx playwright screenshot --viewport-size=512,512 sync/oauth-app-logo.svg sync/oauth-app-logo.png
```

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

Once both secrets are set, use the readiness endpoint for deployment checks:

```bash
curl --fail https://sync.rbstp.dev/readyz
# {"ready":true}
```

`/healthz` is a liveness check and returns `ok` even during a half-configured
deploy. `/readyz` checks every required binding, variable and secret, then runs
`SELECT 1` against D1. It requires no session and does not read the progress
table. It returns 503 when configuration or D1 is unavailable.

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
one per 30 seconds of idle, and never later than two minutes after the first save
that has not gone up, plus one when the tab is hidden or left with a save still
waiting. A store that already matches what the server holds is not pushed at all,
so a hard study session is a few dozen requests and an idle reload is none. Fifty
people using it daily would spend a few percent of the request budget and a
rounding error of the storage.

D1 rather than KV for two reasons: KV's free plan allows 1,000 writes/day against
D1's 100,000, and KV is eventually consistent for up to a minute, which is
precisely wrong when the entire point is a laptop and a desktop agreeing.

## Keeping it to yourself

As deployed above, anyone with a GitHub account can sign in and store *their own*
progress, and they never see yours. If you would rather it stayed a guest list, set
`ALLOWED_LOGINS` in `sync/wrangler.toml` to a comma-separated list of GitHub
logins; everyone else gets a 403 at the callback and nothing is stored for them.
Leave it unset and the door is open, which is fine: 5 GB at ~19 KB a head is
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
* `CNPE_PROGRESS.merge` skips every `Object.prototype` name, not just `__proto__`,
  `constructor` and `prototype`. The base lookup reads through `hasOwnProperty`,
  which costs the accident that used to leave a key like `toString` inert. That
  matters more here than it did for Import: the merge takes network input, and one
  of its buckets assigns whole objects by key.
* The session is a signed cookie with a 30-day expiry and no server-side
  revocation list. Signing out clears the cookie; rotating `SESSION_SECRET`
  invalidates every outstanding one.
* There is no per-account rate limit. `ALLOWED_LOGINS` is the answer if that
  matters to you; without it, a signed-in account could spend D1's daily write
  budget.
* `curriculum/tools/merge-test.mjs` drives the merge and the rules around it over
  plain objects: all 27 base/local/remote combinations in each of the four tick
  buckets, the counter maxima, the prototype guards on a payload that arrives over
  the network, the narrowed base one tab holds against another, and the base rules
  above, meaning the rev and account checks, the wire shape the exam clock is
  stripped from, and what counts as having anything to save. Whether this browser
  may hold a base at all stays in `sync.js`, since that is a question about the
  disk and the other tabs rather than a rule. Plain `node`, no dependencies, and
  CI runs it on every PR.
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
`cnpe:sync-base` sits beside it and holds the merge base described above; both are
this browser's own bookkeeping and neither is ever sent anywhere.
