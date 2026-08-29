# Publishing the study console at cnpe.rbstp.dev

The console is static: no build step, no runtime network, no server. It is published
to GitHub Pages by an Actions workflow that stages `curriculum/` as the site root.

Everything in this file that is *code* is already done. The two lists that need a
human are [GitHub settings](#1-github-settings-you-have-to-click-yourself) and
[Cloudflare DNS](#2-cloudflare-dns).

## How the deploy works

`.github/workflows/deploy-study-console.yml` runs on pushes to `master` that touch
`curriculum/**` or the workflow itself (plus `workflow_dispatch`), and mirrors the approach already used by
`rbstp/gist-blog`: `actions/configure-pages` → `actions/upload-pages-artifact` →
`actions/deploy-pages`, same action majors, same `github-pages` environment, same
`pages` concurrency group.

Two deliberate differences from gist-blog:

| | gist-blog | here | why |
|---|---|---|---|
| `cancel-in-progress` | `true` | `false` | Cancelling a *deployment* mid-flight can leave the Pages deploy half-applied. GitHub's own Pages starter workflow uses `false` for the same reason. Cheap to differ, and there is no long build to cancel. |
| `CNAME` | repo root, not in the artifact | written into the artifact | gist-blog's root `CNAME` is not actually in its `dist/`, so its custom domain lives only in repo settings. That works, but a custom domain that exists only as a setting is the one that gets silently dropped. Carrying it in the artifact makes the deploy self-describing. |

The source tree is untouched. `curriculum/tools/stage-site.sh` does the layout work in
the publish step, so `file://` and `make study` keep working exactly as before:

* copies `curriculum/` minus `tools/` and `README.md` → site root
* `python3 tools/bundle.py → console.html`: the whole console as one file, fonts inlined as `data:` URIs
* `.nojekyll`: a no-op for Actions-published artifacts, kept so nothing changes if this is ever published from a branch instead
* `CNAME` containing `cnpe.rbstp.dev` (override with `SITE_DOMAIN=`)
* `404.html`: served for any missing path at any depth, so its links are **root-absolute** (`/assets/style.css`, `/`); that is exactly why it is generated here and not checked into the tree, where absolute paths would break `file://`
* a content stamp on every asset reference: `assets/app.js?v=a703192080`, the first ten hex digits of the file's SHA-256. Pages sends `Cache-Control: max-age=600` on everything it serves, so without a stamp each file expires on its own clock and a browser can hold the new HTML against the bundle it cached ten minutes ago. The stamp changes when the bytes change and not otherwise, so a page and its assets are always one version of the console, and an asset nobody touched stays cached across the deploy. `check-site.sh` fails on any reference that is missing one

The staged artifact is asserted by `curriculum/tools/check-site.sh` (required files,
35 pages, self-contained bundle, stamped asset references, `CNAME` content). The same script gates pull requests
via `.github/workflows/ci.yml`, so the merge gate and the deploy gate cannot drift.

Run the identical staging locally with `make site`, then:

```bash
python3 -m http.server -d _site 8080     # http://127.0.0.1:8080/
```

Resulting URLs:

| URL | file |
|---|---|
| `https://cnpe.rbstp.dev/` | `curriculum/index.html` (the dashboard) |
| `https://cnpe.rbstp.dev/01-architecture/01-networking.html` | section 1.1 (five numbered domain dirs, numbered sections) |
| `https://cnpe.rbstp.dev/mock-exam.html` | mock exam 1 (timed) |
| `https://cnpe.rbstp.dev/mock-exam-2.html` | mock exam 2 (timed, scored separately) |
| `https://cnpe.rbstp.dev/console.html` | single-file console: one URL to hand over, or save offline |

GitHub Pages also resolves those section paths without the `.html`, but nothing here
depends on that: every internal link carries the extension so the same files work over
`file://`. There is a curl for it in [§4](#4-verification).

## 1. GitHub settings you have to click yourself

These are repo settings, not repo contents, so a PR cannot set them.

| Setting | Where | Value | Status |
|---|---|---|---|
| Visibility | Settings → General → Danger Zone | public | **already public**, nothing to do. (Pages on a *private* repo needs Pro/Team/Enterprise; not your case.) |
| Source | Settings → Pages → Build and deployment → **Source** | **GitHub Actions** | **you must set this.** Pages is not enabled on this repo yet. |
| Custom domain | Settings → Pages → **Custom domain** | `cnpe.rbstp.dev` → Save | **you must set this**, *after* the DNS record exists; GitHub runs a DNS check on save and rejects a name that does not resolve to it yet. |
| Enforce HTTPS | Settings → Pages → **Enforce HTTPS** | ticked | **you must tick this**, and the checkbox stays greyed out until GitHub has issued the certificate. Come back to it. |

Order: merge this PR → set Source = GitHub Actions → add the Cloudflare record → set the
custom domain → wait for the cert → tick Enforce HTTPS.

Two things that need no clicking: the `github-pages` environment is created on first
deploy, and the workflow already carries `pages: write` + `id-token: write`. If you have
ever added environment protection rules to `github-pages`, check that `master` is an
allowed deployment branch.

Optional, worth ten seconds: **Settings → Pages → Verified domains** at the *account*
level (github.com/settings/pages). Verifying `rbstp.dev` there stops anyone else's GitHub
account from ever claiming a `*.rbstp.dev` Pages site. It does not affect this deploy.

## 2. Cloudflare DNS

One record. Nothing else in the zone changes, and **nothing that serves the apex is
touched**: `rbstp.dev` keeps whatever A/AAAA/flattened-CNAME records gist-blog needs.

Cloudflare dashboard → **rbstp.dev** → **DNS** → **Records** → **Add record**:

| Field (as labelled in the UI) | Value |
|---|---|
| **Type** | `CNAME` |
| **Name** | `cnpe` (Cloudflare appends the zone; it will read `cnpe.rbstp.dev`) |
| **Target** | `rbstp.github.io`, your Pages host, **not** `cnpe-exam-prep.rbstp.github.io` and **not** an IP |
| **Proxy status** | click the toggle to **DNS only** (grey cloud); see below |
| **TTL** | `Auto` |
| **Comment** (optional) | `GitHub Pages: cnpe-exam-prep` |

Save.

A `CNAME` is the correct record type because `cnpe` is a subdomain. The four
`185.199.10x.153` A records you may have seen are only for an apex, which cannot hold a
CNAME: do **not** add A records for `cnpe`, and do not copy whatever the apex uses.

`cnpe.rbstp.dev` and `rbstp.dev` are different names, so GitHub's "a custom domain can
only be used by one repository" rule does not put this in conflict with gist-blog.

### The certificate: start DNS-only, proxy later if you want

**Start grey (DNS only), and leave it grey until the certificate is issued.**

GitHub gets its Let's Encrypt certificate for `cnpe.rbstp.dev` via an HTTP-01 challenge
served over **plain HTTP** at `http://cnpe.rbstp.dev/.well-known/acme-challenge/…`. With
the record grey, requests bypass Cloudflare's edge entirely, GitHub sees the real request
and issues the cert, usually within minutes, occasionally up to an hour.

With the record **orange (Proxied)** before the cert exists, two things break it:

* Your zone's **Always Use HTTPS** (SSL/TLS → Edge Certificates) makes Cloudflare answer
  the plaintext challenge with a `301` to HTTPS. The challenge never reaches GitHub and
  the cert is never issued. Grey-cloud records are not subject to it at all, which is why
  starting grey sidesteps this instead of requiring you to turn a zone-wide setting off.
* GitHub's own domain check sees Cloudflare's IPs rather than its own, which can leave the
  custom domain stuck in an unverified state.

Once **Enforce HTTPS** is ticked in the Pages settings, the cert exists and you may flip
the record to **Proxied** if you want to. If you do:

* **SSL/TLS → Overview → encryption mode must be `Full (strict)`.** `Flexible` fetches
  from GitHub over plain HTTP, GitHub's Enforce HTTPS redirects it back to HTTPS, and you
  get `ERR_TOO_MANY_REDIRECTS`. `Full` works but does not validate the origin cert;
  strict is correct here since GitHub presents a valid one. Note this setting can be
  zone-wide; if the zone is currently `Flexible` for some other reason, set per-hostname
  configuration rather than flipping the zone under the apex.
* Universal SSL already covers `cnpe.rbstp.dev` (it covers the apex and one level of
  subdomain), so the edge cert needs no action.

**My recommendation: leave it grey.** Pages is already behind a CDN with a valid cert and
HTTP/2. Proxying adds a second TLS hop, a cache layer that can serve a stale console for
a few minutes after a deploy, and one more thing to be wrong the next time a cert
renews, in exchange for WAF and analytics you do not need on a static study site.

### Things already in your zone that could bite

Check these before blaming the deploy:

| Thing | Where | Effect |
|---|---|---|
| **Always Use HTTPS** | SSL/TLS → Edge Certificates | Only affects *proxied* records. Harmless while `cnpe` is grey; blocks cert issuance if you proxy too early. |
| **CAA records** | DNS → Records, type `CAA` | The one that silently kills this. If the zone restricts issuance to specific CAs and `letsencrypt.org` is not among them, GitHub can never get a cert. Check with `dig +short CAA rbstp.dev`: if that returns nothing, you are fine; if it returns entries, one must permit `letsencrypt.org`. |
| **HSTS with `includeSubDomains`** | SSL/TLS → Edge Certificates → HTTP Strict Transport Security | If enabled (especially with preload), browsers will force HTTPS on `cnpe.rbstp.dev` before the cert exists, so you get a TLS error rather than a working HTTP page during the issuance window. Wait it out; do not disable HSTS. |
| **A wildcard `*` record** | DNS → Records | An explicit `cnpe` record wins over `*`, so no conflict. But if a wildcard exists, `cnpe.rbstp.dev` *already resolves* today, so a `dig` that "works" before you add the record proves nothing. Check what is there first. |
| **Apex records for rbstp.dev** | DNS → Records | Leave alone. Adding `cnpe` does not interact with them. |
| **Universal SSL** | SSL/TLS → Edge Certificates | Covers `cnpe.rbstp.dev` automatically once proxied. No action. |
| **Page/Configuration Rules on `rbstp.dev/*`** | Rules | A rule written against the whole zone will also match `cnpe.rbstp.dev` once proxied. Worth a glance if you later turn the cloud orange. |

## 3. Progress sync across browsers

`localStorage` is per-origin, so a `file://` copy and `https://cnpe.rbstp.dev` keep
*separate* stores, and no two browsers share one. This PR adds **Export**/**Import**
buttons on the dashboard: Export writes `cnpe-progress-YYYY-MM-DD.json`, Import merges
one back in: union only, so an import can tick something but never un-tick it, and the
mock exam's clock is left alone (only its scored tasks merge). Reset first if you want a
plain restore rather than a merge.

That was chosen over the alternatives:

| Option | Cost | Trade-off |
|---|---|---|
| **(a) leave it** | none | Fine if you study in one browser. But it also means the progress you build up via `make study` never shows up on the hosted site; the two origins are different stores. |
| **(b) export/import** ✅ | ~90 lines, no deps | Manual, and you have to remember to do it. Keeps every current property: no network at runtime, no account, no secret, works identically over `file://` and in the single-file bundle. |
| **(c) Worker + KV, shared key** | a Worker, a KV namespace, a route, client sync + conflict handling | Free tier is ample (KV: 100k reads, 1k writes/day). But it puts the console on the network at runtime, and a *shared* key means anyone with the URL and key can read and overwrite your progress. Workers routes only run on **proxied** hostnames, so this forces the orange cloud and everything in §2 that comes with it. It also needs a real answer for "laptop and desktop both wrote while offline". |
| **(d) Gist + fine-grained token in localStorage** | ~50 lines, no infra | Puts a real GitHub credential with gist-write scope in `localStorage` on a public origin. Any XSS on the site, any shared or borrowed browser, any extension reading storage, and the token leaks. Not worth it for tick-boxes. |

### (e) GitHub sign-in + Worker + D1: added, opt-in, alongside (b)

(b) is still there and still the default. On top of it there is now an optional
**Sign in to sync**, documented in full in [progress-sync.md](progress-sync.md).
It answers each objection to (c) and (d) rather than accepting them:

* **Not a shared key.** GitHub OAuth gives a per-account row. Nobody with the URL
  reads anyone else's progress.
* **The orange cloud is not forced onto `cnpe`.** The Worker answers on
  `sync.rbstp.dev`, a Custom Domain whose only origin is the Worker. `cnpe` stays
  grey and §2 above is unchanged. The record must share the registrable domain
  `rbstp.dev`, though, or the session cookie becomes a third-party cookie.
* **"Both wrote while offline" has a real answer.** Counters take a per-field max,
  and ticks resolve three ways against the last state the browser and the server
  agreed on, so an un-tick travels and work a browser did not itself undo survives. The Worker rejects a stale write with `409` **and the current copy**, and
  the client merges and retries. See `docs/progress-sync.md`.
* **No GitHub credential anywhere.** The OAuth scope is empty, so this is identity
  only. The token is used once server-side to read the account id and is never
  stored, so
  unlike (d) nothing that could touch a repository or a gist exists client-side.
  The session is an `HttpOnly` cookie that JavaScript cannot read.
* **The runtime network dependency is opt-in.** Signed out, and over `file://`
  always, not one request is made. Browser checks assert exactly that.

## 4. Verification

After the DNS record is saved and the Pages custom domain is set.

```bash
# ── DNS ────────────────────────────────────────────────────────────────
dig +short CNAME cnpe.rbstp.dev          # -> rbstp.github.io.
dig +short A     cnpe.rbstp.dev          # -> 185.199.108-111.153  (grey cloud)
                                         #    104.x / 172.67.x     (orange cloud)
dig +short CAA rbstp.dev                 # empty, or must allow letsencrypt.org

# ── which one is actually answering ────────────────────────────────────
curl -sSI https://cnpe.rbstp.dev/ | grep -i '^server:'
#   server: GitHub.com   -> DNS only
#   server: cloudflare   -> proxied

# ── the HTTP -> HTTPS redirect (this is Pages' Enforce HTTPS) ──────────
curl -sSI http://cnpe.rbstp.dev/ | sed -n '1p;/^[Ll]ocation:/p'
#   HTTP/1.1 301 Moved Permanently
#   location: https://cnpe.rbstp.dev/

# ── the certificate ───────────────────────────────────────────────────
echo | openssl s_client -connect cnpe.rbstp.dev:443 -servername cnpe.rbstp.dev 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
#   grey:   issuer Let's Encrypt, SAN includes cnpe.rbstp.dev
#   orange: issuer Google Trust Services / Let's Encrypt via Cloudflare, SAN *.rbstp.dev
curl -sSI https://cnpe.rbstp.dev/ >/dev/null && echo "cert verifies"

# ── the pages ─────────────────────────────────────────────────────────
for p in / /console.html /mock-exam.html /mock-exam-2.html \
         /01-architecture/01-networking.html /05-security/06-pipeline-security.html \
         /assets/style.css /assets/fonts/plex-mono-400.woff2; do
  printf '%-52s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code}' "https://cnpe.rbstp.dev$p")"
done                                     # all 200

curl -sS -o /dev/null -w '%{http_code}\n' https://cnpe.rbstp.dev/no-such-page   # 404
curl -sS https://cnpe.rbstp.dev/01-architecture/no-such-page | grep -o 'Go to the dashboard'
curl -sS -o /dev/null -w '%{http_code}\n' https://cnpe.rbstp.dev/01-architecture/01-networking
#   200 if Pages' extension-less fallback is on for this site; nothing depends on it

# ── the apex is untouched ─────────────────────────────────────────────
curl -sS -o /dev/null -w 'apex %{http_code}\n' https://rbstp.dev/
```

### Browser pass

1. **Fonts.** Open `https://cnpe.rbstp.dev/`, DevTools → Network → filter `Font`, reload.
   Six `woff2` at `200`: plex-sans 400/600, plex-cond 600/700, plex-mono 400/500.
   Headings should be narrow and condensed, code monospaced; a serif or the system UI
   font means they did not load.
2. **Palette.** Press <kbd>/</kbd> → the overlay opens. Type `crossplane` → one hit
   (3.5). <kbd>Enter</kbd> navigates to it. <kbd>?</kbd> lists every shortcut.
3. **A figure responds.** Go to `/01-architecture/01-networking.html`, find *"Follow one
   request until it fails"*, untick **DNS egress to kube-dns is allowed** → the
   `DNS (CoreDNS)` hop flips to ✕, the hops below grey out, and the note becomes the
   `nslookup` / `hubble observe --verdict DROPPED` pair.
4. **Progress persists.** On that page click **Mark section complete** and tick one
   exercise's **mark verified**. Reload: both stay. Go to `/` → *Sections complete*
   reads `1/29` and a **▶ Resume 1.1** button appears.
5. **Export/import.** On `/` click **Export** → `cnpe-progress-<today>.json` downloads.
   Open the site in a different browser (or a private window), click **Import**, pick that
   file → it reports what it added and reloads showing 1.1 done. Importing it a second
   time says *"Nothing new in that file"* rather than double-counting.
6. **The theme.** The ground matches your OS setting on first load. Click the masthead
   theme button (or press <kbd>t</kbd>) → paper, then graphite, then back to *system*;
   the tooltip names the current state. Reload on a pinned theme: the page comes up in it
   with no flash of the other ground, because `assets/theme.js` runs from `<head>`.
7. **The single file.** `/console.html` → same dashboard. Network shows one document and
   **zero** font requests (they are `data:` URIs). Clicking a section only changes the
   `#hash`. Save it with <kbd>Ctrl/Cmd-S</kbd>, turn off wifi, open the saved file: it
   still works, palette and figures included.

### If something is wrong

| Symptom | Cause |
|---|---|
| Pages settings reject the custom domain | DNS has not propagated. `dig +short CNAME cnpe.rbstp.dev` first. |
| **Enforce HTTPS** stays greyed out for over an hour | Cert not issued. Confirm the record is **grey**, then check `dig +short CAA rbstp.dev`. |
| `ERR_TOO_MANY_REDIRECTS` | Proxied with SSL/TLS mode `Flexible`. Set `Full (strict)`, or go back to grey. |
| Site loads unstyled | `/assets/style.css` is 404ing; check the workflow's *Check the staged site* step ran green. |
| Custom domain reverted to blank after a deploy | The classic Actions-Pages failure mode; the `CNAME` in the artifact is there to prevent it. Re-set it and check the artifact contains `CNAME`. |
| A deploy did not fire | The push touched nothing under `curriculum/`. Run the workflow manually: Actions → Deploy Study Console → Run workflow. |
