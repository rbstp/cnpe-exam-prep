/* Two tabs of one browser: one store on the disk, a copy in each tab's memory. */
'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, assert, group } = h;

  /** @param {import('playwright').BrowserContext} ctx @param {string} page */
  async function tab(ctx, page) {
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') p.errors.push('console: ' + m.text()); });
    await p.goto(url(page));
    return p;
  }
  /** @param {import('playwright').Page} p @param {string} id @param {number} on */
  const tick = (p, id, on) => p.evaluate(a => {
    window.CNPE_PROGRESS.get().done[a.id] = a.on;
    window.CNPE_PROGRESS.save();
  }, { id: id, on: on });
  /** @param {import('playwright').Page} p @param {() => boolean} fn */
  const within = (p, fn) => p.waitForFunction(fn, null, { timeout: 4000 }).then(() => true, () => false);
  /** @param {import('playwright').Page} p */
  const complete = p => p.evaluate(() =>
    document.querySelector('.stats .stat .val').textContent.replace(/\s+/g, ''));
  /** @param {import('playwright').Page} p counts this tab's own writes of the store */
  const countWrites = p => p.addInitScript(() => {
    window.__writes = 0;
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'cnpe:v2') window.__writes++;
      return real.call(this, k, v);
    };
  });
  /** @param {import('playwright').Page} p */
  const writes = p => p.evaluate(() => window.__writes);

  /* 1. a tick made in one tab reaches the other, and repaints it */
  {
    group('a tick made in one tab lands in the other');
    const { ctx, page } = await fresh({ done: { '2.1': 1 } });
    await page.goto(url('index.html'));
    const two = await tab(ctx, 'index.html');
    const before = await complete(page);
    await tick(two, '1.1', 1);
    assert(await within(page, () => window.CNPE_PROGRESS.get().done['1.1'] === 1),
      'the other tab has it in memory, untouched');
    const after = await complete(page);
    assert(after !== before, 'and repainted its dashboard: ' + before + ' → ' + after);
    const errs = page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await ctx.close();
  }

  /* 2. and so does taking one back */
  {
    group('an un-tick travels between tabs the same way');
    const { ctx, page } = await fresh({ done: { '1.1': 1, '2.1': 1 } });
    await page.goto(url('index.html'));
    const two = await tab(ctx, 'index.html');
    await tick(two, '1.1', 0);
    assert(await within(page, () => window.CNPE_PROGRESS.get().done['1.1'] === 0),
      'the tick is taken back in the other tab too');
    assert(await within(page, () => window.CNPE_PROGRESS.get().done['2.1'] === 1),
      'and the tick nobody touched is still there');
    const errs = page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await ctx.close();
  }

  /* 3. the clobber this replaces: a tab that saves a store it never merged */
  {
    group('a tab saving an older copy of everything is not a mass un-tick');
    const { ctx, page } = await fresh({ done: { '2.1': 1 } });
    await page.goto(url('index.html'));
    const two = await tab(ctx, 'index.html');
    await tick(page, '1.1', 1);
    await within(two, () => window.CNPE_PROGRESS.get().done['1.1'] === 1);
    // straight to the disk, as an older bundle that never heard of merging would
    await two.evaluate(() => localStorage.setItem('cnpe:v2', JSON.stringify({ done: { '2.1': 1 } })));
    assert(await within(page, () => window.CNPE_PROGRESS.get().done['1.1'] === 1),
      'the tick that store never mentions survives in memory');
    await tick(page, '4.1', 1);
    const both = await page.evaluate(() => JSON.parse(localStorage.getItem('cnpe:v2')).done);
    assert(both['1.1'] === 1 && both['2.1'] === 1 && both['4.1'] === 1,
      'and its next save puts it back on the disk: ' + JSON.stringify(both));
    const errs = page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await ctx.close();
  }

  /* 4. counters cannot conflict, so both tabs keep both answers */
  {
    group('drill counters take the max across tabs');
    const now = Date.now();
    const { ctx, page } = await fresh({ drill: { q: { r: 1, m: 0, ok: true, t: now - 60000 } } });
    await page.goto(url('index.html'));
    const two = await tab(ctx, 'index.html');
    await page.evaluate(t => {
      window.CNPE_PROGRESS.get().drill.q = { r: 3, m: 0, ok: true, t: t };
      window.CNPE_PROGRESS.save();
    }, now - 30000);
    await within(two, () => window.CNPE_PROGRESS.get().drill.q.r === 3);
    await two.evaluate(t => {
      const rec = window.CNPE_PROGRESS.get().drill.q;
      rec.m = 2; rec.ok = false; rec.t = t;
      window.CNPE_PROGRESS.save();
    }, now);
    assert(await within(page, () => {
      const rec = window.CNPE_PROGRESS.get().drill.q;
      return rec.r === 3 && rec.m === 2 && rec.ok === false;
    }), 'r and m survive from both tabs, and the newer answer is the last one');
    const errs = page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await ctx.close();
  }

  /* 5. a wipe in one tab is not undone by the other holding a copy */
  {
    group('Reset in one tab is not written back by the other');
    const { ctx, page } = await fresh({ done: { '1.1': 1, '2.1': 1 } });
    await page.goto(url('index.html'));
    const two = await tab(ctx, 'index.html');
    await two.evaluate(() => {
      // what Reset progress does, minus the reload that follows it
      const s = window.CNPE_PROGRESS.get();
      s.ex = {}; s.done = {}; s.exam = {}; s.exam2 = {};
      s.drill = {}; s.drillmeta = {}; s.days = {}; s.last = null;
      window.CNPE_PROGRESS.save();
    });
    await page.waitForTimeout(400);   // long enough for a storage event and an answer to it
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('cnpe:v2')).done);
    assert(Object.keys(left).length === 0, 'the store on the disk is still empty: ' + JSON.stringify(left));
    const errs = page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await ctx.close();
  }

  /* 6. converging must not mean answering each other forever */
  {
    group('the tabs settle instead of writing at each other');
    const { ctx, page } = await fresh({ done: { '2.1': 1 } });
    await countWrites(page);
    await page.goto(url('index.html'));
    const two = await ctx.newPage();
    two.errors = [];
    two.on('pageerror', e => two.errors.push('pageerror: ' + e.message));
    await countWrites(two);
    await two.goto(url('index.html'));
    await tick(two, '1.1', 1);
    await within(page, () => window.CNPE_PROGRESS.get().done['1.1'] === 1);
    await page.waitForTimeout(500);
    assert((await writes(two)) === 1, 'the tab that ticked wrote once: ' + await writes(two));
    assert((await writes(page)) === 0, 'the tab that took it wrote not at all: ' + await writes(page));
    const errs = page.errors.concat(two.errors);
    assert(errs.length === 0, 'no console errors: ' + errs.join(' | '));
    await ctx.close();
  }
};
