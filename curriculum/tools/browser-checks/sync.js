/* Optional progress sync: local-first by default, and correct once opted in.

   The console ships as file:// pages, so these checks serve the *staged* site
   over a real https origin through route interception, and stub the Worker at
   its real hostname. Nothing here reaches the network. */
'use strict';
const fs = require('fs');
const path = require('path');

const SITE_ORIGIN = 'https://cnpe.rbstp.dev';
const API_ORIGIN = 'https://sync.rbstp.dev';

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

const AVATAR = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#456"/></svg>');

/** CORS headers the console's credentialed fetches need back. */
const CORS = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Cache-Control': 'no-store',
};

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { browser, siteDir, assert, group } = h;

  /** Serve the staged site at SITE_ORIGIN, and hand the Worker to `api`.
   * @param {object} o
   * @param {*} [o.seed] cnpe:v2 to start from
   * @param {boolean} [o.signedIn] start with the sync opt-in flag set
   * @param {*} [o.base] cnpe:sync-base to start from
   * @param {(req: import('playwright').Route, url: URL, method: string, body: string) => *} [o.api]
   * @param {boolean} [o.avatar] false to make GitHub's avatar CDN fail
   * @param {boolean} [o.repaint] let a pull that moved something reload the dashboard
   */
  async function site(o) {
    const ctx = await browser.newContext();
    /** @type {string[]} */
    const seen = [];
    /** @type {string[]} */
    const avatarHits = [];
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });

    // Seed once, not on every reload: a merge has to survive the page reload it triggers.
    await ctx.addInitScript(({ s, f, b, repaint }) => {
      // A pull that moves something reloads the dashboard once, which tears down
      // whatever the check was about to read. Only the checks that are about that
      // repaint want it, so every other one claims its marker before the page runs.
      // Per page, not per context: the marker lives in sessionStorage.
      try { if (!repaint) sessionStorage.setItem('cnpe:sync-reloaded', '1'); } catch (e) { /* private mode */ }
      try {
        if (localStorage.getItem('cnpe:seeded')) return;
        localStorage.setItem('cnpe:seeded', '1');
        if (s) localStorage.setItem('cnpe:v2', JSON.stringify(s));
        if (f) localStorage.setItem('cnpe:sync', JSON.stringify({ on: 1, login: 'octocat' }));
        if (b) localStorage.setItem('cnpe:sync-base', JSON.stringify(b));
      } catch (e) { /* private mode */ }
    }, { s: o.seed || null, f: !!o.signedIn, b: o.base || null, repaint: !!o.repaint });

    await ctx.route(SITE_ORIGIN + '/**', route => {
      const p = new URL(route.request().url()).pathname;
      const file = path.join(siteDir, p === '/' ? 'index.html' : decodeURIComponent(p));
      if (!file.startsWith(siteDir) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'no' });
      return route.fulfill({
        status: 200,
        contentType: TYPES[path.extname(file)] || 'application/octet-stream',
        body: fs.readFileSync(file),
      });
    });

    // GitHub's avatar CDN, stubbed so no check ever reaches the network
    await ctx.route('https://avatars.githubusercontent.com/**', route => {
      avatarHits.push(route.request().url());
      return o.avatar === false
        ? route.abort()
        : route.fulfill({ status: 200, contentType: 'image/svg+xml', body: AVATAR });
    });

    await ctx.route(API_ORIGIN + '/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();
      seen.push(method + ' ' + url.pathname);
      if (method === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: Object.assign({}, CORS, {
            'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }),
        });
      }
      const body = req.postData() || '';
      const out = o.api ? await o.api(route, url, method, body) : null;
      if (out === undefined) return;                    // the stub fulfilled it itself
      const r = out || { status: 404, json: { error: 'unstubbed' } };
      return route.fulfill({
        status: r.status,
        headers: Object.assign({}, CORS, r.headers || {}, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(r.json === undefined ? {} : r.json),
      });
    });

    return { ctx, page, seen, avatarHits, go: () => page.goto(SITE_ORIGIN + '/index.html') };
  }

  /* Chromium logs every non-2xx response as a console error. 401, 409 and 500
     are the protocol here, so drop that one line and keep every other error. */
  const realErrors = (/** @type {import('playwright').Page} */ p) =>
    p.errors.filter((/** @type {string} */ e) => !/Failed to load resource/.test(e));

  /** Poll a node-side predicate; used to wait out the reload a growing merge triggers. */
  async function settle(/** @type {() => boolean} */ done) {
    for (let i = 0; i < 200 && !done(); i++) await new Promise(r => setTimeout(r, 25));
    return done();
  }
  const gets = (/** @type {string[]} */ seen) => seen.filter(x => x === 'GET /v1/progress').length;

  /** Wait for a section to settle at a value. A merge-triggered reload destroys the
   *  execution context and rejects the wait, so pick it back up on the new page. */
  const doneIs = async (/** @type {import('playwright').Page} */ p, /** @type {string} */ id, /** @type {number} */ want) => {
    for (let i = 0; i < 3; i++) {
      const got = await p.waitForFunction(([k, v]) => {
        const s = window.CNPE_PROGRESS;
        return !!s && s.get().done[k] === v;
      }, /** @type {[string, number]} */ ([id, want]), { timeout: 5000 }).then(() => true, () => false);
      if (got) return true;
    }
    return false;
  };

  /** @param {import('playwright').Page} p */
  const topOf = p => p.evaluate(() => {
    const b = /** @type {HTMLButtonElement} */ (document.querySelector('.syncbtn'));
    if (!b) return { hidden: null, title: '', on: false };
    return { hidden: b.hidden, title: b.title, on: b.classList.contains('on') };
  });

  const readStore = (/** @type {import('playwright').Page} */ p) =>
    p.evaluate(() => window.CNPE_PROGRESS.get());
  const noteOf = (/** @type {import('playwright').Page} */ p) =>
    p.evaluate(() => (document.getElementById('sync-note') || { textContent: '' }).textContent);
  /** @param {import('playwright').Page} p */
  const btnOf = p => p.evaluate(() => {
    const b = /** @type {HTMLButtonElement} */ (document.getElementById('sync-btn'));
    const d = /** @type {HTMLButtonElement} */ (document.getElementById('sync-forget'));
    return { text: b ? b.textContent : null, hidden: b ? b.hidden : null, delHidden: d ? d.hidden : null };
  });

  /* 1. file:// is local-only: the button never appears and nothing is requested */
  {
    group('file:// stays local-first: no sync UI, no network');
    const { ctx, page } = await h.fresh({ done: { '1.1': 1 } });
    /** @type {string[]} */
    const out = [];
    page.on('request', r => { if (r.url().indexOf('sync.rbstp.dev') >= 0) out.push(r.url()); });
    await page.goto(h.url('index.html'));
    const b = await btnOf(page);
    assert(b.hidden === true, 'the sign-in button is hidden over file://');
    assert(out.length === 0, 'no request to the sync origin: ' + JSON.stringify(out));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. hosted but signed out: the button offers, and still nothing is requested */
  {
    group('signed out on https: the button offers, the network stays quiet');
    const s = await site({ seed: { done: { '1.1': 1 } } });
    await s.go();
    const b = await btnOf(s.page);
    assert(b.hidden === false && /Sign in to sync/.test(b.text), 'the button offers sign-in: ' + JSON.stringify(b.text));
    assert(b.delHidden === true, 'the delete button is hidden while signed out');
    // [hidden] only wins if nothing in style.css sets display on button.tbtn
    const painted = await s.page.evaluate(() =>
      getComputedStyle(document.getElementById('sync-forget')).display);
    assert(painted === 'none', 'and it is really off the page, not just flagged: ' + painted);
    assert(s.seen.length === 0, 'no call to the Worker before opting in: ' + JSON.stringify(s.seen));
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 3. signing in records the intent locally and leaves for the Worker */
  {
    group('sign-in records the opt-in and hands off to the Worker');
    /** @type {string|null} */
    let started = null;
    const s = await site({
      api: (route, url) => {
        if (url.pathname === '/auth/start') {
          started = url.searchParams.get('return');
          // The Worker answers with a 302, but a redirect from route.fulfill
          // escapes interception in the headless shell CI runs, so send the
          // browser back with a navigation instead. sync/test.mjs asserts the
          // real 302; what matters here is the client's behaviour on return.
          route.fulfill({
            status: 200, contentType: 'text/html',
            body: '<meta http-equiv="refresh" content="0;url=' + started + '">',
          });
          return undefined;
        }
        return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 0, progress: null, updated: null } };
      },
    });
    await s.go();
    await s.page.click('#sync-btn');
    // waitForURL would match the page we are already on, so wait for the trip
    await s.page.waitForFunction(o =>
      location.href === o && !!window.CNPE_SYNC, SITE_ORIGIN + '/index.html');
    assert(started === SITE_ORIGIN + '/index.html', 'the return URL is handed to the Worker: ' + JSON.stringify(started));
    const flag = await s.page.evaluate(() => localStorage.getItem('cnpe:sync'));
    assert(!!flag && JSON.parse(flag).on === 1, 'the opt-in is recorded before leaving: ' + JSON.stringify(flag));
    await s.page.waitForFunction(() => window.CNPE_SYNC.signedIn());
    const b = await btnOf(s.page);
    assert(/Sign out/.test(b.text), 'the button flips to sign-out on return: ' + JSON.stringify(b.text));
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 4. the pull is a union, and what it merges is pushed straight back */
  {
    group('pull merges both ways: remote into local, union back to remote');
    /** @type {*} */
    let put = null;
    const s = await site({
      repaint: true,      // this one is about the reload the merge triggers
      signedIn: true,
      seed: { done: { '1.1': 1 }, ex: { '1.1#local-only': 1 } },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 7, updated: '2026-08-01T00:00:00Z',
            progress: { done: { '2.1': 1 }, ex: { '2.1#remote-only': 1 } },
          } };
        }
        if (method === 'PUT') { put = JSON.parse(body); return { status: 200, json: { rev: 8, updated: '2026-08-02T00:00:00Z' } }; }
        return { status: 405, json: {} };
      },
    });
    await s.go();
    // the merge adds two sections, so the dashboard reloads once: wait it out
    assert(await settle(() => gets(s.seen) >= 2), 'the merge reloaded the dashboard and pulled again');
    await s.page.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.state().rev === 8);
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 1 && store.done['2.1'] === 1, 'both sections survive the merge');
    assert(store.ex['1.1#local-only'] === 1 && store.ex['2.1#remote-only'] === 1, 'both exercises survive the merge');
    const sections = await s.page.evaluate(() => document.querySelector('.stats .stat .val').textContent.replace(/\s+/g, ''));
    assert(/^2\/29/.test(sections), 'and the dashboard repainted with the pulled work: ' + JSON.stringify(sections));
    assert(put && put.rev === 7, 'the push carries the rev the pull returned: ' + (put && put.rev));
    assert(put && put.progress.done['1.1'] === 1 && put.progress.done['2.1'] === 1,
      'the push carries the union, not just the local half');
    assert(/Synced .* to @octocat/.test(await noteOf(s.page)), 'the status line names the account');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 5. the exam clock is progress-adjacent, not progress: it never travels */
  {
    group('the mock exam clock stays on the machine that started it');
    /** @type {*} */
    let put = null;
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 }, exam: { tasks: { 0: 1 }, startedAt: 1770000000000, running: true, spent: 42 } },
      api: (route, url, method, body) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 2, progress: null, updated: null } };
        if (method === 'PUT') { put = JSON.parse(body); return { status: 200, json: { rev: 3, updated: 'now' } }; }
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 3);
    assert(put.progress.exam.tasks['0'] === 1, 'the scored task travels');
    assert(put.progress.exam.startedAt === undefined && put.progress.exam.running === undefined &&
           put.progress.exam.spent === undefined, 'the clock does not: ' + JSON.stringify(put.progress.exam));
    const store = await readStore(s.page);
    assert(store.exam.running === true && store.exam.spent === 42, 'and the local clock is left alone');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 6. a racing write is merged, not lost */
  {
    group('a 409 merges the other browser in and retries');
    /** @type {*[]} */
    const puts = [];
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method, body) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 4, progress: null, updated: null } };
        if (method === 'PUT') {
          puts.push(JSON.parse(body));
          if (puts.length === 1) {
            // another browser wrote 3.1 between our pull and our push
            return { status: 409, json: { rev: 5, progress: { done: { '3.1': 1 } }, updated: 'then' } };
          }
          return { status: 200, json: { rev: 6, updated: 'now' } };
        }
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 6);
    assert(puts.length === 2, 'the push retried once: ' + puts.length);
    assert(puts[1].rev === 5, 'the retry carries the rev from the conflict: ' + puts[1].rev);
    assert(puts[1].progress.done['1.1'] === 1 && puts[1].progress.done['3.1'] === 1,
      'the retry carries both browsers work: ' + JSON.stringify(puts[1].progress.done));
    const store = await readStore(s.page);
    assert(store.done['3.1'] === 1, 'and the other browsers work landed locally too');
    assert(realErrors(s.page).length === 0, 'no console errors beyond the expected status: ' + realErrors(s.page).join(' | '));
    await s.ctx.close();
  }

  /* 7. a Worker that is down costs a status line and nothing else */
  {
    group('a failing Worker never costs local progress');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 }, ex: { '1.1#keep-me': 1 } },
      api: () => ({ status: 500, json: { error: 'boom' } }),
    });
    await s.go();
    await s.page.waitForFunction(() => /unreachable/.test(
      (document.getElementById('sync-note') || { textContent: '' }).textContent));
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 1 && store.ex['1.1#keep-me'] === 1, 'the local store is untouched');
    assert(/saved in this browser/.test(await noteOf(s.page)), 'the note says where the work still is');
    const sections = await s.page.evaluate(() => document.querySelector('.stats .stat .val').textContent.replace(/\s+/g, ''));
    assert(/^1\/29/.test(sections), 'and the dashboard still counts it: ' + JSON.stringify(sections));
    assert(realErrors(s.page).length === 0, 'no console errors beyond the expected status: ' + realErrors(s.page).join(' | '));
    await s.ctx.close();
  }

  /* 8. an expired session drops back to local-only without losing anything */
  {
    group('a 401 drops the opt-in and keeps the progress');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: () => ({ status: 401, json: { error: 'signed out' } }),
    });
    await s.go();
    await s.page.waitForFunction(() => !window.CNPE_SYNC.signedIn());
    const flag = await s.page.evaluate(() => localStorage.getItem('cnpe:sync'));
    assert(flag === null, 'the opt-in flag is cleared: ' + JSON.stringify(flag));
    assert(/Not signed in/.test(await noteOf(s.page)), 'the note explains why');
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 1, 'progress is still here');
    assert(realErrors(s.page).length === 0, 'no console errors beyond the expected status: ' + realErrors(s.page).join(' | '));
    await s.ctx.close();
  }

  /* 9. sign out is local: the saved copy is left where it is */
  {
    group('sign out stops syncing and leaves both copies alone');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, progress: null, updated: null } };
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        if (method === 'POST') return { status: 204, json: {} };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.signedIn());
    // the panel button is a deliberate, fully labelled control: no confirm here
    let dialogs = 0;
    s.page.on('dialog', d => { dialogs++; d.accept(); });
    await s.page.click('#sync-btn');
    await s.page.waitForFunction(() => !window.CNPE_SYNC.signedIn());
    assert(dialogs === 0, 'the panel button signs out without asking');
    assert(s.seen.indexOf('POST /auth/signout') >= 0, 'the session is dropped at the Worker: ' + JSON.stringify(s.seen));
    const b = await btnOf(s.page);
    assert(/Sign in to sync/.test(b.text), 'the button offers sign-in again');
    assert(b.delHidden === true, 'the delete button goes away with it');
    assert(/saved copy is untouched/.test(await noteOf(s.page)), 'the note says the saved copy survives');
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 1, 'local progress survives too');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 10. delete removes the saved copy only */
  {
    group('delete removes the saved copy and keeps this browser');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, progress: null, updated: null } };
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        if (method === 'DELETE') return { status: 200, json: { deleted: true } };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.signedIn());
    s.page.once('dialog', d => d.dismiss());
    await s.page.click('#sync-forget');
    assert(s.seen.indexOf('DELETE /v1/progress') < 0, 'cancelling the confirm deletes nothing');
    s.page.once('dialog', d => d.accept());
    await s.page.click('#sync-forget');
    await s.page.waitForFunction(() => /Deleted the copy/.test(
      (document.getElementById('sync-note') || { textContent: '' }).textContent));
    assert(s.seen.indexOf('DELETE /v1/progress') >= 0, 'accepting it deletes the saved copy');
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 1, 'this browser keeps everything');
    assert(await s.page.evaluate(() => window.CNPE_SYNC.state().rev) === 0, 'and the client forgets the rev');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 11. reset asks about the saved copy separately, and honours either answer */
  {
    group('reset asks twice: the browser, then the saved copy');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1, '2.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, progress: null, updated: null } };
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        if (method === 'DELETE') return { status: 200, json: { deleted: true } };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.signedIn());

    // cancelling the first confirm changes nothing at all
    s.page.once('dialog', d => d.dismiss());
    await s.page.click('#reset-progress');
    assert((await readStore(s.page)).done['1.1'] === 1, 'cancelling the first confirm keeps everything');

    // accepting the first and declining the second clears only the browser
    /** @type {string[]} */
    let asked = [];
    const twice = (/** @type {import('playwright').Dialog} */ d) => {
      asked.push(d.message());
      return asked.length === 1 ? d.accept() : d.dismiss();
    };
    s.page.on('dialog', twice);
    let reloaded = s.page.waitForNavigation({ waitUntil: 'load' });
    await s.page.click('#reset-progress');
    await reloaded;
    s.page.off('dialog', twice);
    assert(asked.length === 2, 'reset asks twice when signed in: ' + asked.length);
    assert(/progress stored in this browser/i.test(asked[0]), 'first about the browser: ' + JSON.stringify(asked[0]));
    assert(/delete the copy saved to your GitHub account/i.test(asked[1]), 'then about the saved copy: ' + JSON.stringify(asked[1]));
    assert(/sync it back down/i.test(asked[1]), 'and it says what declining means');
    assert(s.seen.indexOf('DELETE /v1/progress') < 0, 'declining keeps the saved copy: ' + JSON.stringify(s.seen));

    // accepting both takes the saved copy with it
    await s.page.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.signedIn());
    const both = (/** @type {import('playwright').Dialog} */ d) => d.accept();
    s.page.on('dialog', both);
    reloaded = s.page.waitForNavigation({ waitUntil: 'load' });
    await s.page.click('#reset-progress');
    await reloaded;
    s.page.off('dialog', both);
    assert(s.seen.indexOf('DELETE /v1/progress') >= 0, 'accepting both deletes it: ' + JSON.stringify(s.seen));
    await s.page.waitForFunction(() => window.CNPE_PROGRESS && document.querySelector('#stat-streak'));
    const store = await readStore(s.page);
    assert(Object.keys(store.done).length === 0, 'and the browser is cleared');
    await s.ctx.close();
  }

  /* 12. remote content reaches the merge, so prototype keys must not.
         A `{__proto__: 1}` literal sets the prototype and never serialises, so
         the payload is built as raw JSON: the wire is what matters here. */
  {
    group('a poisoned remote copy cannot reach the prototype');
    // toString rode in on the base lookup: it used to be inert only because
    // `k in into` found it on the prototype, which hasOwnProperty does not.
    const POISON = '{"done":{"__proto__":{"pwned":1},"toString":0,"valueOf":1,"2.1":1},' +
                   '"drill":{"__proto__":{"pwned":1},"q1":{"r":1,"m":0,"t":1}},' +
                   '"days":{"__proto__":{"pwned":1}}}';
    /** @type {string[]} */
    const bodies = [];
    const s = await site({
      repaint: true,      // this one is about the reload the merge triggers
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      base: { uid: '1', rev: 1, done: ['1.1', 'toString'], ex: [], exam: [], exam2: [] },
      api: (route, url, method) => {
        if (method === 'GET') {
          route.fulfill({
            status: 200,
            headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
            body: '{"user":{"login":"octocat","id":"1"},"rev":1,"updated":"then","progress":' + POISON + '}',
          });
          return undefined;
        }
        bodies.push(route.request().postData() || '');
        return { status: 200, json: { rev: 2, updated: 'now' } };
      },
    });
    await s.go();
    assert(await settle(() => gets(s.seen) >= 2), 'the merge reloaded the dashboard and pulled again');
    await s.page.waitForFunction(() => {
      const p = window.CNPE_PROGRESS && window.CNPE_PROGRESS.get();
      return p && p.done['2.1'] === 1;
    });
    const clean = await s.page.evaluate(() => {
      const p = window.CNPE_PROGRESS.get();
      return {
        objProto: Object.getPrototypeOf({}) === Object.prototype && !('r' in {}),
        drillProto: Object.getPrototypeOf(p.drill) === Object.prototype,
        doneProto: Object.getPrototypeOf(p.done) === Object.prototype,
        real: p.done['2.1'] === 1 && !!p.drill.q1,
        ownProto: Object.keys(p.done).concat(Object.keys(p.drill), Object.keys(p.days)).indexOf('__proto__') >= 0,
        ownNative: ['toString', 'valueOf'].some(k => Object.prototype.hasOwnProperty.call(p.done, k)),
      };
    });
    assert(clean.objProto, 'Object.prototype is untouched');
    assert(clean.drillProto && clean.doneProto, 'and so are the store buckets own prototypes');
    assert(clean.real, 'while the legitimate records still merged');
    assert(!clean.ownProto, 'and no __proto__ key was taken as data either');
    assert(!clean.ownNative, 'nor was any other Object.prototype name, base lookup or not');
    // the guard is worthless if the poison never left the stub
    assert(await settle(() => bodies.length > 0) && bodies.every(b => b.indexOf('__proto__') < 0),
      'the poison reached the client and did not come back out: ' + JSON.stringify(bodies[0] || '').slice(0, 80));
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 13. drill records are lifetime counters: a merge must never lower one */
  {
    group('two browsers drilling offline keep both answers');
    /** @type {*} */
    let put = null;
    const s = await site({
      repaint: true,      // this one is about the reload the merge triggers
      signedIn: true,
      // this browser got q1 right at t=200; the other missed it at t=300
      seed: { drill: { q1: { r: 11, m: 2, ok: true, t: 200 } }, drillmeta: { day: '2026-08-28', n: 9, best: 7, t: 200 } },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, updated: 'then',
            progress: { drill: { q1: { r: 10, m: 3, ok: false, t: 300 } },
                        drillmeta: { day: '2026-08-28', n: 4, best: 5, t: 300 } } } };
        }
        put = JSON.parse(body);
        return { status: 200, json: { rev: 2, updated: 'now' } };
      },
    });
    await s.go();
    // the drill counters grow, so the dashboard reloads once: wait it out
    assert(await settle(() => gets(s.seen) >= 2), 'the merge reloaded the dashboard and pulled again');
    await s.page.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.state().rev === 2);
    const q = (await readStore(s.page)).drill.q1;
    assert(q.r === 11, 'the right count kept the higher of the two: ' + q.r);
    assert(q.m === 3, 'and so did the missed count: ' + q.m);
    assert(q.ok === false && q.t === 300, 'the last answer is the later one: ' + JSON.stringify(q));
    const dm = (await readStore(s.page)).drillmeta;
    assert(dm.n === 9, "today's card count took the max, not the newer write: " + dm.n);
    assert(dm.best === 7, 'and the record streak survived: ' + dm.best);
    assert(put.progress.drill.q1.r === 11 && put.progress.drill.q1.m === 3, 'the union went back to the server');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 14. the resume pointer is per-browser, and the clock never travels */
  {
    group('the payload carries progress only');
    /** @type {*} */
    let put = null;
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 }, last: '1.1' },
      api: (route, url, method, body) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, progress: null, updated: null } };
        put = JSON.parse(body);
        return { status: 200, json: { rev: 2, updated: 'now' } };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.state().rev === 2);
    assert(put.progress.last === undefined, 'the resume pointer stays on this browser: ' + JSON.stringify(put.progress.last));
    assert((await readStore(s.page)).last === '1.1', 'and is still set locally');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 15. the masthead control is the one reachable from every page */
  {
    group('the masthead carries the sync control on every page');
    const s = await site({ seed: { done: { '1.1': 1 } } });
    await s.go();
    let b = await topOf(s.page);
    assert(b.hidden === false, 'the dashboard masthead shows it');
    assert(/Sign in with GitHub/.test(b.title), 'signed out it offers sign-in: ' + JSON.stringify(b.title));
    assert(!b.on, 'and is not in the signed-in state');

    // a section page has no dashboard panel at all, so this is the only control there
    await s.page.goto(SITE_ORIGIN + '/01-architecture/01-networking.html');
    await s.page.waitForFunction(() => !!window.CNPE_SYNC);
    b = await topOf(s.page);
    assert(b.hidden === false, 'and so does a section page, which has no panel');
    assert(await s.page.evaluate(() => !document.getElementById('sync-btn')),
      'confirming the panel button is genuinely absent there');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 15b. signed in it reports the account, and it is the same toggle */
  {
    group('the masthead control reports state and signs out');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, progress: null, updated: null } };
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        if (method === 'POST') return { status: 204, json: {} };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.signedIn());
    let b = await topOf(s.page);
    assert(b.on, 'signed in it carries the .on state');
    assert(/Synced .* to @octocat/.test(b.title), 'and names the account in its label: ' + JSON.stringify(b.title));
    // one stray click from any page, so it asks first
    /** @type {string} */
    let asked = '';
    s.page.once('dialog', d => { asked = d.message(); d.dismiss(); });
    await s.page.click('.syncbtn');
    assert(/Sign out of progress sync\?/.test(asked), 'it asks before signing out: ' + JSON.stringify(asked));
    assert(/stays in this browser/.test(asked) && /left alone/.test(asked),
      'and says what survives either way');
    assert(await s.page.evaluate(() => window.CNPE_SYNC.signedIn()), 'cancelling keeps the session');
    assert(s.seen.indexOf('POST /auth/signout') < 0, 'and tells the Worker nothing');

    s.page.once('dialog', d => d.accept());
    await s.page.click('.syncbtn');
    await s.page.waitForFunction(() => !window.CNPE_SYNC.signedIn());
    assert(s.seen.indexOf('POST /auth/signout') >= 0, 'accepting signs out');
    b = await topOf(s.page);
    assert(!b.on && /Sign in with GitHub/.test(b.title), 'and it flips back to offering sign-in');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 15c. over file:// it must not appear at all */
  {
    group('the masthead control stays away from file://');
    const { ctx, page } = await h.fresh({ done: { '1.1': 1 } });
    await page.goto(h.url('index.html'));
    const b = await topOf(page);
    assert(b.hidden === true, 'hidden on the dashboard');
    await page.goto(h.url('01-architecture/01-networking.html'));
    assert((await topOf(page)).hidden === true, 'and on a section page');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 15d. the masthead wears the account's avatar, derived from the id alone */
  {
    group('the masthead shows the account avatar');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: { user: { login: 'octocat', id: '583231' }, rev: 1, progress: null, updated: null } };
        }
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => !!document.querySelector('.syncbtn img.avt'));
    const src = await s.page.evaluate(() =>
      /** @type {HTMLImageElement} */ (document.querySelector('.syncbtn img.avt')).getAttribute('src'));
    assert(src === 'https://avatars.githubusercontent.com/u/583231?s=64&v=4',
      'the URL is built from the id the Worker returned, with nothing stored: ' + src);
    assert((await topOf(s.page)).on, 'the green synced ring stays behind it');
    // a repaint must reuse the element, or every push refetches the image
    const before = s.avatarHits.length;
    await s.page.evaluate(() => { window.CNPE_SYNC.mount(); window.CNPE_PROGRESS.save(); });
    assert(s.avatarHits.length === before, 'a repaint reuses it: ' + s.avatarHits.length + ' vs ' + before);
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 15e. a blocked avatar must not leave an empty button */
  {
    group('a blocked avatar falls back to the glyph and gives up');
    const s = await site({
      signedIn: true,
      avatar: false,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') return { status: 200, json: { user: { login: 'octocat', id: '583231' }, rev: 1, progress: null, updated: null } };
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => {
      const b = document.querySelector('.syncbtn');
      return !!b && !b.querySelector('img.avt') && !!b.querySelector('svg');
    });
    const b = await topOf(s.page);
    assert(b.on && /Synced .* to @octocat/.test(b.title), 'the button still reports the account: ' + JSON.stringify(b.title));
    const after = s.avatarHits.length;
    await s.page.evaluate(() => { window.CNPE_SYNC.mount(); window.CNPE_PROGRESS.save(); });
    assert(s.avatarHits.length === after, 'and stops asking: ' + s.avatarHits.length + ' vs ' + after);
    assert(realErrors(s.page).length === 0, 'no console errors beyond the failed image: ' + realErrors(s.page).join(' | '));
    await s.ctx.close();
  }

  /* 15f. an id that is not digits never reaches a URL */
  {
    group('a junk id is refused rather than interpolated');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '../../evil?x=' }, rev: 1, progress: null, updated: null } };
        }
        if (method === 'PUT') return { status: 200, json: { rev: 2, updated: 'now' } };
        return { status: 405, json: {} };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.state().rev === 2);
    assert(await s.page.evaluate(() => !document.querySelector('.syncbtn img.avt')),
      'no image is built from an id that is not digits');
    assert(s.avatarHits.length === 0, 'and nothing was requested: ' + JSON.stringify(s.avatarHits));
    assert((await topOf(s.page)).on, 'the glyph still reports signed in');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 16. a store the server already has costs no write */
  {
    group('reloading with nothing new does not write again');
    // The row the server holds is whatever a client last pushed, so let the
    // first load produce it rather than guessing the normalised shape by hand.
    /** @type {*} */
    let stored = null;
    let rev = 0;
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev, updated: 'then', progress: stored } };
        }
        stored = JSON.parse(body).progress;
        rev += 1;
        return { status: 200, json: { rev, updated: 'now' } };
      },
    });
    const puts = () => s.seen.filter(x => x === 'PUT /v1/progress').length;
    await s.go();
    assert(await settle(() => stored !== null), 'the first load pushes the store the server did not have');
    const after = puts();
    await s.page.reload();
    await s.page.waitForFunction(() => /Synced/.test(
      (document.getElementById('sync-note') || { textContent: '' }).textContent));
    assert(await settle(() => gets(s.seen) >= 2), 'the reload pulled again');
    assert(puts() === after, 'and pushed nothing back: ' + JSON.stringify(s.seen));
    assert(await s.page.evaluate(() => window.CNPE_SYNC.state().rev) === rev, 'the rev is the one the pull returned');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 17. an un-tick made here is not ticked back by the copy the server still has */
  {
    group('a local un-tick survives the pull that used to undo it');
    /** @type {*} */
    let put = null;
    const s = await site({
      signedIn: true,
      seed: {
        done: { '1.1': 0, '2.1': 1 },
        ex: { '1.1#gone': 0, '1.1#kept': 1 },
        exam: { tasks: { 0: 0, 1: 1 } },
      },
      base: { uid: '1', rev: 1, done: ['1.1', '2.1'], ex: ['1.1#gone', '1.1#kept'], exam: ['0', '1'], exam2: [] },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 1, updated: 'then',
            progress: {
              done: { '1.1': 1, '2.1': 1 },
              ex: { '1.1#gone': 1, '1.1#kept': 1 },
              exam: { tasks: { 0: 1, 1: 1 } },
            },
          } };
        }
        put = JSON.parse(body);
        return { status: 200, json: { rev: 2, updated: 'now' } };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 2);
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 0, 'the un-tick is still an un-tick: ' + JSON.stringify(store.done));
    assert(store.done['2.1'] === 1, 'and the section it did not touch is untouched');
    // every bucket is wired to the base separately, and exam reads through .tasks
    assert(store.ex['1.1#gone'] === 0 && store.ex['1.1#kept'] === 1, 'exercises resolve the same way: ' + JSON.stringify(store.ex));
    assert(store.exam.tasks['0'] === 0 && store.exam.tasks['1'] === 1, 'and so do exam tasks: ' + JSON.stringify(store.exam.tasks));
    assert(put && put.progress.done['1.1'] === 0 && put.progress.ex['1.1#gone'] === 0 &&
           put.progress.exam.tasks['0'] === 0, 'the push carries all three removals: ' + JSON.stringify(put && put.progress.ex));
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 18. and the other direction: the other browser un-ticked, so this one follows */
  {
    group('an un-tick made elsewhere comes down and repaints');
    const s = await site({
      signedIn: true,
      repaint: true,
      seed: { done: { '1.1': 1, '2.1': 1 } },
      base: { uid: '1', rev: 1, done: ['1.1', '2.1'], ex: [], exam: [], exam2: [] },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 2, updated: 'then',
            progress: { done: { '1.1': 0, '2.1': 1 } },
          } };
        }
        return { status: 200, json: { rev: 3, updated: 'now' } };
      },
    });
    await s.go();
    assert(await settle(() => gets(s.seen) >= 2), 'the removal reloaded the dashboard');
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 0, 'this browser followed the removal: ' + JSON.stringify(store.done));
    const sections = await s.page.evaluate(() => document.querySelector('.stats .stat .val').textContent.replace(/\s+/g, ''));
    assert(/^1\/29/.test(sections), 'and the tile repainted: ' + JSON.stringify(sections));
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 19. with no base there is nothing to tell a removal from a gap, so: union */
  {
    group('no base is still the union it always was');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 0, '2.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 1, updated: 'then',
            progress: { done: { '1.1': 1, '2.1': 1 } },
          } };
        }
        return { status: 200, json: { rev: 2, updated: 'now' } };
      },
    });
    await s.go();
    assert(await doneIs(s.page, '1.1', 1), 'the tick comes back, as it did before');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 20. the 409 path carries removals too, and merges against the base in effect */
  {
    group('a 409 carrying someone elses un-tick is honoured, not undone');
    /** @type {*[]} */
    const puts = [];
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1, '2.1': 1, '3.1': 1 } },
      base: { uid: '1', rev: 1, done: ['1.1', '2.1'], ex: [], exam: [], exam2: [] },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 1, updated: 'then',
            progress: { done: { '1.1': 1, '2.1': 1 } },
          } };
        }
        puts.push(JSON.parse(body));
        if (puts.length === 1) {
          return { status: 409, json: { rev: 2, updated: 'then', progress: { done: { '1.1': 0, '2.1': 1 } } } };
        }
        return { status: 200, json: { rev: 3, updated: 'now' } };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 3);
    assert(puts.length === 2, 'the push retried once: ' + puts.length);
    assert(puts[1].progress.done['1.1'] === 0, 'the retry keeps the other browsers removal: ' + JSON.stringify(puts[1].progress.done));
    assert(puts[1].progress.done['3.1'] === 1, 'and still carries this browsers own work');
    const store = await readStore(s.page);
    assert(store.done['1.1'] === 0 && store.done['3.1'] === 1, 'the local store agrees: ' + JSON.stringify(store.done));
    assert(realErrors(s.page).length === 0, 'no console errors beyond the expected status: ' + realErrors(s.page).join(' | '));
    await s.ctx.close();
  }

  /* 21. a bucket the payload leaves out is not a bucket the server emptied */
  {
    group('a payload missing a bucket removes nothing from it');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 }, ex: { '1.1#keep-me': 1 } },
      base: { uid: '1', rev: 1, done: ['1.1'], ex: ['1.1#keep-me'], exam: [], exam2: [] },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 2, updated: 'then',
            progress: { done: { '1.1': 1 } },
          } };
        }
        return { status: 200, json: { rev: 3, updated: 'now' } };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 3);
    const store = await readStore(s.page);
    assert(store.ex['1.1#keep-me'] === 1, 'the absent bucket is left alone: ' + JSON.stringify(store.ex));
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 22. a base is only trusted while it is an ancestor of the row in front of it */
  {
    /** @param {string} uid @param {number} rev @param {string[]} done @return {*} */
    const held = (uid, rev, done) => ({ uid, rev, done, ex: [], exam: [], exam2: [] });
    const cases = [
      { what: 'a rev that went backwards', base: held('1', 5, ['1.1']), rev: 1 },
      { what: 'a rev that matches with a different blob', base: held('1', 3, ['1.1', '9.9']), rev: 3 },
      { what: 'a base from another account', base: held('999', 3, ['1.1']), rev: 3 },
    ];
    for (const { what, base, rev } of cases) {
      group('the base is dropped for ' + what);
      const s = await site({
        signedIn: true,
        seed: { done: { '1.1': 0 } },
        base,
        api: (route, url, method) => {
          if (method === 'GET') {
            return { status: 200, json: {
              user: { login: 'octocat', id: '1' }, rev, updated: 'then', progress: { done: { '1.1': 1 } },
            } };
          }
          return { status: 200, json: { rev: rev + 1, updated: 'now' } };
        },
      });
      await s.go();
      assert(await doneIs(s.page, '1.1', 1),
        'so the merge falls back to a union and loses nothing');
      assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
      await s.ctx.close();
    }
  }

  /* 23. the base is an ancestor of what reached the disk, not of what is in memory.
         A second tab writing under us, or a quota error, breaks exactly that. */
  {
    group('a store that no longer matches the disk is not read as a removal');
    /** @type {*} */
    let put = null;
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1, '2.1': 1 } },
      base: { uid: '1', rev: 1, done: ['1.1', '2.1'], ex: [], exam: [], exam2: [] },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 2, updated: 'then',
            progress: { done: { '1.1': 1, '2.1': 1 } },
          } };
        }
        put = JSON.parse(body);
        return { status: 200, json: { rev: 3, updated: 'now' } };
      },
    });
    // app.js reads the store once, at boot; every later read is another tab's copy.
    await s.page.addInitScript(() => {
      let first = true;
      const real = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (k !== 'cnpe:v2') return real.call(this, k);
        if (first) { first = false; return real.call(this, k); }
        return JSON.stringify({ done: { '1.1': 1 } });
      };
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 3);
    assert(put && put.progress.done['2.1'] === 1, 'nothing was removed: ' + JSON.stringify(put && put.progress.done));
    assert(await s.page.evaluate(() => localStorage.getItem('cnpe:sync-base')) === null,
      'and the base it could not trust is gone');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 24. a save that never lands must not leave a base claiming it did */
  {
    group('a store write that throws leaves no base behind');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 2, updated: 'then',
            progress: { done: { '2.1': 1 } },
          } };
        }
        return { status: 200, json: { rev: 3, updated: 'now' } };
      },
    });
    await s.page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'cnpe:v2') throw new Error('QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.state().rev === 3);
    assert(await s.page.evaluate(() => localStorage.getItem('cnpe:sync-base')) === null,
      'no base is written for a merge that never reached the disk');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 25. reset is a local wipe, not a mass un-tick: the kept copy still comes back */
  {
    group('reset, declining the saved copy, still syncs it back down');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1, '2.1': 1 } },
      base: { uid: '1', rev: 1, done: ['1.1', '2.1'], ex: [], exam: [], exam2: [] },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: {
            user: { login: 'octocat', id: '1' }, rev: 1, updated: 'then',
            progress: { done: { '1.1': 1, '2.1': 1 } },
          } };
        }
        if (method === 'DELETE') return { status: 200, json: { deleted: true } };
        return { status: 200, json: { rev: 2, updated: 'now' } };
      },
    });
    await s.go();
    await s.page.waitForFunction(() => window.CNPE_SYNC.signedIn());
    /** @type {string[]} */
    const asked = [];
    const twice = (/** @type {import('playwright').Dialog} */ d) => {
      asked.push(d.message());
      return asked.length === 1 ? d.accept() : d.dismiss();
    };
    s.page.on('dialog', twice);
    const reloaded = s.page.waitForNavigation({ waitUntil: 'load' });
    await s.page.click('#reset-progress');
    await reloaded;
    s.page.off('dialog', twice);
    assert(s.seen.indexOf('DELETE /v1/progress') < 0, 'declining keeps the saved copy');
    assert(await doneIs(s.page, '1.1', 1),
      'and the next load syncs it back down, as the confirm says');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }

  /* 26. the whole thing, twice over: two profiles, one row, and the real buttons.
         Every group above seeds a store; this one clicks. */
  {
    group('two browsers, one row: a tick travels, and so does taking it back');
    /** @type {{rev: number, blob: *}} */
    const row = { rev: 0, blob: null };
    /** @type {(route: import('playwright').Route, url: URL, method: string, body: string) => *} */
    const worker = (route, url, method, body) => {
      if (method === 'GET') {
        return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: row.rev, updated: 'then', progress: row.blob } };
      }
      if (method !== 'PUT') return { status: 405, json: {} };
      const put = JSON.parse(body);
      // the compare-and-swap the Worker really does
      if ((put.rev || 0) !== row.rev) return { status: 409, json: { rev: row.rev, progress: row.blob, updated: 'then' } };
      row.rev += 1; row.blob = put.progress;
      return { status: 200, json: { rev: row.rev, updated: 'now' } };
    };
    // both browsers here are about the reload a merge triggers
    const a = await site({ signedIn: true, api: worker, repaint: true });
    const b = await site({ signedIn: true, api: worker, repaint: true });
    /** Wait for the sections tile to settle on a count.
     * @param {import('playwright').Page} p @param {string} want */
    const tileIs = async (p, want) => {
      for (let i = 0; i < 3; i++) {
        const got = await p.waitForFunction(w => {
          const el = document.querySelector('.stats .stat .val');
          return !!el && el.textContent.replace(/\s+/g, '').indexOf(w) === 0;
        }, want, { timeout: 5000 }).then(() => true, () => false);
        if (got) return true;
      }
      return false;
    };
    /** @param {import('playwright').Page} p @param {string} page */
    const toggle = async (p, page) => {
      await p.goto(SITE_ORIGIN + page);
      await p.waitForSelector('.finish .tbtn');
      await p.click('.finish .tbtn');
    };
    // Opening a section registers its exercises at 0, so the row moves before any
    // click does. Wait on what the row says, never on how many times it moved.
    /** @param {string} id @param {number} want */
    const rowSays = (id, want) => settle(() => !!row.blob && row.blob.done[id] === want);

    await toggle(a.page, '/01-architecture/01-networking.html');
    assert(await rowSays('1.1', 1), 'A ticks a section and it reaches the row: ' + JSON.stringify(row.blob && row.blob.done));

    await b.go();
    assert(await tileIs(b.page, '1/29'), 'B picks it up on its next load');

    await a.page.click('.finish .tbtn');
    assert(await rowSays('1.1', 0), 'A takes it back and that reaches the row too: ' + JSON.stringify(row.blob.done));

    await b.page.reload();
    assert(await tileIs(b.page, '0/29'), 'and B follows, which is the whole point');

    await toggle(b.page, '/02-gitops/01-gitops-fundamentals.html');
    assert(await rowSays('2.1', 1), "B's own tick lands");
    await a.page.reload();
    assert(await rowSays('1.1', 0),
      'and A does not resurrect the un-tick on its way through: ' + JSON.stringify(row.blob.done));

    const errs = a.page.errors.concat(b.page.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await a.ctx.close();
    await b.ctx.close();
  }

  /* 27. two tabs of one browser share a store and a base, but not a memory.
         The stale tab must never read the fresh tab's work as a removal. */
  {
    group('a second tab writing under us cannot turn a tick into a removal');
    /** @type {{rev: number, blob: *}} */
    const row = { rev: 0, blob: null };
    const s = await site({
      signedIn: true,
      seed: { done: { '2.1': 1 } },
      api: (route, url, method, body) => {
        if (method === 'GET') {
          return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: row.rev, updated: 'then', progress: row.blob } };
        }
        if (method !== 'PUT') return { status: 405, json: {} };
        const put = JSON.parse(body);
        if ((put.rev || 0) !== row.rev) return { status: 409, json: { rev: row.rev, progress: row.blob, updated: 'then' } };
        row.rev += 1; row.blob = put.progress;
        return { status: 200, json: { rev: row.rev, updated: 'now' } };
      },
    });
    const two = await s.ctx.newPage();
    two.errors = [];
    two.on('pageerror', e => two.errors.push('pageerror: ' + e.message));

    await s.go();
    assert(await settle(() => row.rev >= 1), 'the first tab establishes the row');
    await two.goto(SITE_ORIGIN + '/index.html');
    await two.waitForFunction(() => window.CNPE_SYNC && window.CNPE_SYNC.state().rev > 0);

    // tab one ticks something tab two has never heard of
    await s.page.evaluate(() => { window.CNPE_PROGRESS.get().done['1.1'] = 1; window.CNPE_PROGRESS.save(); });
    assert(await settle(() => !!row.blob && row.blob.done['1.1'] === 1), 'tab one ticks 1.1 and it lands');

    // tab two saves its own stale store, which clobbers 1.1 on the disk, then pushes
    await two.evaluate(() => { window.CNPE_PROGRESS.get().done['3.1'] = 1; window.CNPE_PROGRESS.save(); });
    assert(await settle(() => !!row.blob && row.blob.done['3.1'] === 1), 'tab two ticks 3.1 and it lands');
    assert(row.blob.done['1.1'] === 1,
      'and tab one\'s tick survived the stale tab: ' + JSON.stringify(row.blob.done));

    const errs = s.page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await s.ctx.close();
  }
};
