/* A section page's working parts: the copy button, the needs chip, the exercises tile. */
'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, assert, group } = h;

  async function freshWithClipboard() {
    const { ctx, page } = await fresh();
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: /** @param {string} t */ function (t) { window.__copied.push(t); return Promise.resolve(); } },
      });
    });
    return { ctx, page };
  }

  /* 1. the copy button copies the block, whole */
  await group('the code-block copy button copies the block', async () => {
    const { ctx, page } = await freshWithClipboard();
    await page.goto(url('01-architecture/01-networking.html'));
    // the first block sits inside an exercise, whose panel is rebuilt via innerHTML at boot
    assert(await page.evaluate(() => !!document.querySelector('.cb').closest('.exercise')),
      'the block under test lives inside an exercise panel');
    // syntax-test.mjs proves the colouring; this proves it reaches the page at
    // all, which the copy button cannot see (it reads textContent) and neither
    // does check-site.sh. Without it a highlighter that throws deploys green.
    assert(await page.evaluate(() => !!document.querySelector('.cb code span.t-cmd')),
      'the block came out coloured, so syntax.js loaded and app.js called it');
    const expected = await page.evaluate(() => document.querySelector('.cb code').textContent);
    await page.click('.cb .copy-btn');
    const copied = await page.evaluate(() => window.__copied);
    assert(copied.length === 1 && copied[0] === expected, 'the first block arrived on the clipboard, verbatim');
    const btn = () => page.evaluate(() => {
      const b = document.querySelector('.cb .copy-btn');
      return { text: b.textContent, ok: b.classList.contains('ok') };
    });
    let b = await btn();
    assert(b.text === 'copied' && b.ok, 'the button acknowledges the copy');
    await page.waitForFunction(() => document.querySelector('.cb .copy-btn').textContent === 'copy');
    b = await btn();
    assert(b.text === 'copy' && !b.ok, 'and settles back to copy');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 2. the needs chip copies its make command on click and on Enter */
  await group('the needs chip copies its make command', async () => {
    const { ctx, page } = await freshWithClipboard();
    await page.goto(url('01-architecture/01-networking.html'));
    const cmd = await page.evaluate(() => document.querySelector('.needs code').textContent);
    assert(/^make /.test(cmd), 'the chip carries a make command: ' + JSON.stringify(cmd));
    await page.click('.needs code');
    assert((await page.evaluate(() => document.querySelector('.needs code').textContent)) === 'copied ✓',
      'the chip acknowledges the copy');
    await page.waitForFunction(c => document.querySelector('.needs code').textContent === c, cmd);
    await page.focus('.needs code');
    await page.keyboard.press('Enter');
    const copied = await page.evaluate(() => window.__copied);
    assert(copied.length === 2 && copied.every(c => c === cmd), 'click and Enter both copied the command');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 3. the exercises tile and the toc counter follow every tick */
  await group('the exercises tile and toc counter follow the ticks', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    const state = () => page.evaluate(() => ({
      total: document.querySelectorAll('.exercise').length,
      tile: document.querySelector('#stat-ex .val').textContent.replace(/\s+/g, ''),
      toc: document.getElementById('toc-ex-count').textContent.replace(/\s+/g, ''),
      bar: /** @type {HTMLElement} */ (document.querySelector('#stat-ex .spark i')).style.width,
    }));
    let s = await state();
    assert(s.total > 0 && s.tile === '0/' + s.total, 'the tile starts at 0/' + s.total + ': ' + JSON.stringify(s.tile));
    assert(s.toc === '0/' + s.total, 'so does the toc counter');
    await page.click('.exercise .mark');
    s = await state();
    assert(s.tile === '1/' + s.total, 'a tick moves the tile to 1/' + s.total);
    assert(s.toc === '1/' + s.total, 'and the toc counter with it');
    assert(s.bar === Math.round(1 / s.total * 100) + '%', 'the spark bar follows: ' + s.bar);
    await page.click('.exercise .mark');
    s = await state();
    assert(s.tile === '0/' + s.total && s.toc === '0/' + s.total, 'un-ticking walks both back to zero');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* the scroll spy across the 1180px breakpoint, where the column comes and goes */
  await group('the toc mark is right after the column comes back', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(url('02-gitops/04-tekton.html'));
    const marked = () => page.evaluate(() =>
      (document.querySelector('#toc a.active') || {}).textContent || null);
    const first = await page.evaluate(() => (document.querySelector('#toc a') || {}).textContent);
    // Instant, or smooth scrolling keeps firing events that hide the bug.
    /** @param {number} y */
    const to = y => page.evaluate(n => window.scrollTo({ top: n, behavior: 'instant' }), y);
    await to(5000);
    await page.waitForTimeout(250);
    const deep = await marked();
    assert(deep !== first, 'reading deep in the page marks a later panel: ' + JSON.stringify(deep));
    // spy leaves the mark alone while the column is gone, so widening back has to
    // re-read; nothing else will, since the reader has not scrolled since.
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(200);
    await to(0);
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(300);
    assert(await marked() === first,
      'back at the top and wide again, the first panel is marked: ' + JSON.stringify(await marked()));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* the last panels sit above the pager and the footer, so their headings never
     reach the spy line and the rail used to stop short of them */
  await group('the bottom of the page marks the last panel', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(url('03-platform-apis/04-argo-workflows.html'));
    const marked = () => page.evaluate(() =>
      (document.querySelector('#toc a.active') || {}).textContent || null);
    const last = await page.evaluate(() => {
      const as = document.querySelectorAll('#toc a');
      return as.length ? as[as.length - 1].textContent : null;
    });
    assert(last, 'the page has a rail to mark: ' + JSON.stringify(last));
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(300);
    assert(await marked() === last,
      'at the bottom the last panel is marked: ' + JSON.stringify(await marked()) + ' want ' + JSON.stringify(last));
    // and it is the bottom that does it, not a one-way latch: scrolling back up releases
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(300);
    assert(await marked() !== last, 'back at the top it lets go again: ' + JSON.stringify(await marked()));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
