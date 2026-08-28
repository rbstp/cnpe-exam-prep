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
   * @param {(req: import('playwright').Route, url: URL, method: string, body: string) => *} [o.api]
   */
  async function site(o) {
    const ctx = await browser.newContext();
    /** @type {string[]} */
    const seen = [];
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });

    // Seed once, not on every reload: a merge has to survive the page reload it triggers.
    await ctx.addInitScript(({ s, f }) => {
      try {
        if (localStorage.getItem('cnpe:seeded')) return;
        localStorage.setItem('cnpe:seeded', '1');
        if (s) localStorage.setItem('cnpe:v2', JSON.stringify(s));
        if (f) localStorage.setItem('cnpe:sync', JSON.stringify({ on: 1, login: 'octocat' }));
      } catch (e) { /* private mode */ }
    }, { s: o.seed || null, f: !!o.signedIn });

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

    return { ctx, page, seen, go: () => page.goto(SITE_ORIGIN + '/index.html') };
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
          route.fulfill({ status: 302, headers: { Location: SITE_ORIGIN + '/index.html' } });
          return undefined;
        }
        return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 0, progress: null, updated: null } };
      },
    });
    await s.go();
    await Promise.all([s.page.waitForURL(SITE_ORIGIN + '/index.html'), s.page.click('#sync-btn')]);
    // the round trip lands back on the console: wait for its scripts, not just the URL
    await s.page.waitForFunction(() => !!window.CNPE_SYNC);
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
    await s.page.click('#sync-btn');
    await s.page.waitForFunction(() => !window.CNPE_SYNC.signedIn());
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

  /* 12. remote content reaches the merge, so prototype keys must not */
  {
    group('a poisoned remote copy cannot reach the prototype');
    const s = await site({
      signedIn: true,
      seed: { done: { '1.1': 1 } },
      api: (route, url, method) => {
        if (method === 'GET') {
          return { status: 200, json: { user: { login: 'octocat', id: '1' }, rev: 1, updated: 'then',
            progress: { done: { __proto__: 1, '2.1': 1 }, drill: { __proto__: { r: 1 }, q1: { r: 1, m: 0, t: 1 } } } } };
        }
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
      };
    });
    assert(clean.objProto, 'Object.prototype is untouched');
    assert(clean.drillProto && clean.doneProto, 'and so are the store buckets own prototypes');
    assert(clean.real, 'while the legitimate records still merged');
    assert(s.page.errors.length === 0, 'no console errors: ' + s.page.errors.join(' | '));
    await s.ctx.close();
  }
};
