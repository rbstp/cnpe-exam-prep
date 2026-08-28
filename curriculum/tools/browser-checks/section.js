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
  {
    group('the code-block copy button copies the block');
    const { ctx, page } = await freshWithClipboard();
    await page.goto(url('01-architecture/01-networking.html'));
    // the first block sits inside an exercise, whose panel is rebuilt via innerHTML at boot
    assert(await page.evaluate(() => !!document.querySelector('.cb').closest('.exercise')),
      'the block under test lives inside an exercise panel');
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
  }

  /* 2. the needs chip copies its make command on click and on Enter */
  {
    group('the needs chip copies its make command');
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
  }

  /* 3. the exercises tile and the toc counter follow every tick */
  {
    group('the exercises tile and toc counter follow the ticks');
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
  }
};
