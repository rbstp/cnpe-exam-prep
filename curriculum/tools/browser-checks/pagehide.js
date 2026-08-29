/* The last save before the page goes away.

   The other sync checks intercept routes, which cannot see a keepalive push from
   a document that is already gone: the request never reaches the handler, and the
   PUT that does arrive is the next page booting and pushing for itself. So this
   area serves the staged site and the stub Worker from one real localhost origin,
   which usable() allows and which needs no CORS. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json',
};

/* Same origin, no console on it: nothing here can push on its own, so a PUT that
   lands after navigating to it came from the page being left. */
const LEAVING = '/__leaving';
const LEAVING_BODY = '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">' +
  '<title>gone</title><p>gone';

const AVATAR = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#456"/></svg>');

/* As in the sync checks: Chromium logs every non-2xx as a console error, and the
   401 below is protocol, not a fault. Drop that line and keep the rest. */
/** @param {string[]} errs */
const realErrors = errs => errs.filter(e => !/Failed to load resource/.test(e));

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { browser, siteDir, assert, group } = h;

  /** @param {{ hang?: boolean }} [o] */
  async function serve(o) {
    o = o || {};
    /** @type {{ m: string, at: number, body: string }[]} */
    const seen = [];
    /** @type {import('http').ServerResponse[]} */
    const held = [];
    let rev = 0, denying = false;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (u.pathname.indexOf('/api/') === 0) {
        let body = '';
        req.on('data', c => { body += c; });
        return req.on('end', () => {
          seen.push({ m: req.method + ' ' + u.pathname.slice(4), at: Date.now(), body: body });
          if (req.method === 'PUT') {
            if (o.hang) { held.push(res); return; }     // ended by close()
            if (denying) {
              res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              return res.end('{}');
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(req.method === 'GET'
            ? { user: { login: 'octocat', id: '1' }, rev: rev, updated: 'then', progress: { done: { '1.1': 1 } } }
            : { rev: ++rev, updated: 'now' }));
        });
      }
      if (u.pathname === LEAVING) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(LEAVING_BODY);
      }
      let rel;
      try { rel = decodeURIComponent(u.pathname); }
      catch (e) { rel = ''; }                            // a bad escape is a 404, not a crash
      const f = path.join(siteDir, rel === '/' || !rel ? 'index.html' : rel);
      // siteDir + sep, or a sibling directory sharing the prefix would pass.
      if ((f + path.sep).indexOf(siteDir + path.sep) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('no');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    await new Promise((ok, bad) => {
      server.once('error', bad);                         // or a failed listen hangs the area
      server.listen(0, '127.0.0.1', () => ok(null));
    });
    const addr = /** @type {import('net').AddressInfo} */ (server.address());
    const puts = () => seen.filter(x => x.m === 'PUT /v1/progress');
    return {
      seen,
      origin: 'http://127.0.0.1:' + addr.port,
      puts: () => puts().length,
      gets: () => seen.filter(x => x.m === 'GET /v1/progress').length,
      /** @param {number} i */
      put: i => puts()[i] || { m: '', at: 0, body: '' },
      last: () => (puts()[puts().length - 1] || { body: '' }).body,
      // Only once the boot push has landed: refusing that one drops the session
      // before the check under it has started.
      deny: () => { denying = true; },
      // close() alone waits out keep-alive sockets the browser leaves behind,
      // which would hold the whole run open after the last check.
      close: () => new Promise(r => {
        held.forEach(x => { try { x.destroy(); } catch (e) { /* already gone */ } });
        server.close(() => r(null));
        server.closeAllConnections();
      }),
    };
  }

  /** @param {string} origin @param {{ signedIn?: boolean, debounce?: number }} o */
  async function open(origin, o) {
    const ctx = await browser.newContext();
    try {
      // No route interception on this origin: it is what the keepalive push needs.
      await ctx.route('https://avatars.githubusercontent.com/**', route =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: AVATAR }));
      await ctx.addInitScript(({ api, ms, f }) => {
        window.CNPE_SYNC_API = api;
        window.CNPE_SYNC_DEBOUNCE = ms;
        try {
          sessionStorage.setItem('cnpe:sync-reloaded', '1');
          if (localStorage.getItem('cnpe:seeded')) return;
          localStorage.setItem('cnpe:seeded', '1');
          localStorage.setItem('cnpe:v2', JSON.stringify({ done: { '1.1': 1 } }));
          if (f) localStorage.setItem('cnpe:sync', JSON.stringify({ on: 1, login: 'octocat' }));
        } catch (e) { /* private mode */ }
      }, { api: origin + '/api', ms: o.debounce || 60000, f: !!o.signedIn });
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
      await page.goto(origin + '/index.html');
      return { ctx, page };
    } catch (e) {
      await ctx.close();
      throw e;
    }
  }

  const wait = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));
  /** @param {() => boolean} done @param {number} [ms] */
  async function settle(done, ms) {
    const until = Date.now() + (ms || 2000);
    while (Date.now() < until && !done()) await wait(25);
    return done();
  }
  /** @param {import('playwright').Page} p @param {string} id */
  const tick = (p, id) => p.evaluate((k) => {
    const s = window.CNPE_PROGRESS;
    s.get().done[k] = 1;
    s.save();
  }, id);

  /** Boot signed in, wait out the boot push, hand the page to the body, then
   *  report what the Worker saw. The stub answers a GET with a bare payload
   *  rather than the wire shape, so the boot pull always pushes once; waiting for
   *  that rather than sleeping past it keeps it out of every count below.
   *  @param {{ hang?: boolean, debounce?: number }} o
   *  @param {(page: import('playwright').Page, srv: *) => Promise<*>} body */
  async function leave(o, body) {
    const srv = await serve({ hang: o.hang });
    /** @type {import('playwright').BrowserContext} */
    let ctx = null;
    // run.js catches a throwing area, so a server left listening here would hold
    // the whole run open after the last check rather than failing it.
    try {
      const up = await open(srv.origin, { signedIn: true, debounce: o.debounce });
      ctx = up.ctx;
      await up.page.waitForFunction(() => !!window.CNPE_SYNC && window.CNPE_SYNC.signedIn());
      const booted = await settle(() => srv.puts() >= 1, 10000);
      await wait(150);
      srv.seen.length = 0;
      const extra = await body(up.page, srv) || {};
      return Object.assign({
        booted: booted, puts: srv.puts(), gets: srv.gets(),
        last: srv.last(), errors: realErrors(up.page.errors),
      }, extra);
    } finally {
      if (ctx) await ctx.close();
      await srv.close();
    }
  }

  /** A keepalive push issued as the document goes away is dropped before it
   *  reaches the socket about once in fifteen leaves, which is the transport and
   *  not the console: the flush runs and calls push either way. Retry only that
   *  signature, nothing arriving at all, so a wrong count still reaches the
   *  assertions rather than being run again until it looks right.
   *  @param {() => Promise<*>} run */
  async function delivered(run) {
    let last = null;
    for (let i = 0; i < 3; i++) { last = await run(); if (last.puts !== 0) break; }
    return last;
  }

  /* 1. the whole point: a save inside the window still goes up on the way out */
  {
    group('a save still inside the debounce window is pushed when the page is left');
    const r = await delivered(() => leave({}, async (page, srv) => {
      await tick(page, '2.2');
      await tick(page, '3.3');
      const pending = srv.puts();
      await page.goto(srv.origin + LEAVING);
      await settle(() => srv.puts() >= 1);
      return { pending: pending };
    }));
    assert(r.booted, 'the boot push landed before the check began, so the counts below are its own');
    assert(r.pending === 0, 'nothing had gone up before leaving: ' + r.pending);
    // The debounce is 60s and this run is seconds long, so no timer can have
    // fired; no GET means it is not the next page booting and pushing either.
    assert(r.puts === 1, 'exactly one push, so it is the flush and not a timer: ' + r.puts);
    assert(r.gets === 0, 'and no pull, so the page left behind sent it: ' + r.gets);
    assert(/"2\.2"/.test(r.last) && /"3\.3"/.test(r.last),
      'it carries both saves, not a stale body: ' + r.last.slice(0, 120));
    assert(r.errors.length === 0, 'no console errors: ' + r.errors.join(' | '));
  }

  /* 2. leaving fires visibilitychange as well as pagehide, and either listener
        alone carries it. Pin visibility so only pagehide is left to do it. */
  {
    group('pagehide alone carries the save, with the visibility path held open');
    const r = await delivered(() => leave({}, async (page, srv) => {
      await tick(page, '2.2');
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      });
      await page.goto(srv.origin + LEAVING);
      await settle(() => srv.puts() >= 1);
    }));
    assert(r.puts === 1, 'pagehide pushes on its own: ' + r.puts);
    assert(/"2\.2"/.test(r.last), 'carrying the save: ' + r.last.slice(0, 120));
    assert(r.errors.length === 0, 'no console errors: ' + r.errors.join(' | '));
  }

  /* 3. and it stays quiet when there is nothing to say */
  {
    group('leaving with nothing pending pushes nothing');
    const r = await leave({}, async (page, srv) => {
      await page.goto(srv.origin + LEAVING);
      await wait(700);
    });
    assert(r.booted, 'the boot push landed before the check began');
    assert(r.puts === 0, 'no push with no pending save: ' + r.puts);
    assert(r.errors.length === 0, 'no console errors: ' + r.errors.join(' | '));
  }

  /* 4. the mobile path: backgrounding the tab, not navigating away. The page
        stays alive here, so this one has nothing to drop. */
  {
    group('backgrounding the tab flushes the same way');
    const r = await leave({}, async (page, srv) => {
      await tick(page, '4.4');
      // Headless Chromium will not give a page a real hidden state, so the state
      // is stubbed and the event dispatched. What is under test is the listener.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await settle(() => srv.puts() >= 1);
    });
    assert(r.puts === 1, 'hiding the tab pushes: ' + r.puts);
    assert(/"4\.4"/.test(r.last), 'carrying the save: ' + r.last.slice(0, 120));
    assert(r.errors.length === 0, 'no console errors: ' + r.errors.join(' | '));
  }

  /* 5. a save landing while a push is already open reschedules its own timer, so
        the flush still finds one and the later save is not stranded. The window
        is wide here only so the second push can be told from that timer. */
  {
    group('a save made while a push is in flight still goes out on the way out');
    const WIN = 1500;
    const r = await delivered(() => leave({ hang: true, debounce: WIN }, async (page, srv) => {
      await tick(page, '2.2');
      await settle(() => srv.puts() >= 1, 6000);
      const at = Date.now();
      await tick(page, '3.3');
      await page.goto(srv.origin + LEAVING);
      await settle(() => srv.puts() >= 2, 6000);
      return { after: srv.put(1).at - at };
    }));
    assert(r.puts === 2, 'leaving pushes again rather than waiting on the open one: ' + r.puts);
    // Under the window rather than over it, or the timer sent it and the flush
    // was a no-op, which every other assertion here would read the same way.
    assert(r.after > 0 && r.after < WIN / 2,
      'and it is the flush that sent it, ' + r.after + 'ms after the save against a ' + WIN + 'ms window');
    assert(/"3\.3"/.test(r.last), 'the later save is in it: ' + r.last.slice(0, 120));
    assert(r.errors.length === 0, 'no console errors: ' + r.errors.join(' | '));
  }

  /* 6. the listeners stay wired for the life of the page, so leaving after the
        session was dropped must stay silent. */
  {
    group('leaving after a 401 dropped the session pushes nothing more');
    const r = await leave({ debounce: 250 }, async (page, srv) => {
      srv.deny();
      await tick(page, '2.2');
      const refused = await settle(() => srv.puts() >= 1, 6000);
      const gone = await page.waitForFunction(() => !window.CNPE_SYNC.signedIn(), null, { timeout: 5000 })
        .then(() => true, () => false);
      await tick(page, '3.3');
      await page.goto(srv.origin + LEAVING);
      await wait(700);
      return { refused: refused, gone: gone, first: srv.put(0).body };
    });
    assert(r.booted, 'the boot push landed before the deny, so the 401 below is the debounced one');
    assert(r.refused, 'the debounced push goes out and is refused');
    assert(/"2\.2"/.test(r.first), 'it was the save that went, not an empty body: ' + r.first.slice(0, 120));
    assert(r.gone, 'the 401 drops the session');
    assert(r.puts === 1, 'and leaving sends nothing further: ' + r.puts);
    assert(r.errors.length === 0, 'no console errors beyond the refused request: ' + r.errors.join(' | '));
  }
};
