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

  /* each page-shaped panel actually painted the markup it owns */
  {
    group('every panel mounted on the page that owns it');
    const { ctx, page } = await fresh();
    // Asserting window.CNPE_DASH here would prove only that a script tag exists,
    // which check-site.sh already reads off the HTML, and it stays true when the
    // panel loads but never mounts. Count what mounting leaves behind instead.
    /** @param {string} p */
    const painted = async p => {
      await page.goto(url(p));
      await page.waitForTimeout(150);
      return page.evaluate(() => ({
        // the dashboard: five domain cards, five stat tiles, the weak-spots grid
        dash: document.querySelectorAll('#domain-grid .dcard').length,
        tiles: document.querySelectorAll('.stats .stat').length,
        weak: document.querySelectorAll('#weak-domains .wcell').length,
        // the paper: a clock with digits in it, and every task given a header
        clock: (document.getElementById('clock') || {}).textContent || '',
        tasks: document.querySelectorAll('.task > header .dot').length,
        // the figures and the drill
        figs: document.querySelectorAll('.widget .wfig').length,
        drill: document.querySelectorAll('#drill-app .drill-actions').length,
      }));
    };
    let m = await painted('index.html');
    assert(m.dash === 5 && m.tiles === 5 && m.weak > 5,
      'the dashboard painted its map, tiles and weak spots: ' + JSON.stringify(m));
    assert(!m.clock && !m.tasks && !m.figs && !m.drill, 'and nothing else mounted there');

    m = await painted('mock-exam-2.html');
    assert(/^\s*\d+:\d\d$/.test(m.clock) && m.tasks === 15,
      'the second paper painted its clock and 15 tasks: ' + JSON.stringify(m));
    assert(!m.dash && !m.weak, 'and the dashboard did not follow it there');

    m = await painted('drill.html');
    assert(m.drill === 1, 'the drill painted its deck: ' + JSON.stringify(m));
    assert(!m.dash && !m.clock, 'and neither of the others mounted');

    m = await painted('01-architecture/01-networking.html');
    assert(m.figs === 1, 'a section page painted its figure: ' + JSON.stringify(m));
    assert(!m.dash && !m.clock && !m.drill, 'and carries no page-shaped panel');

    m = await painted('02-gitops/04-tekton.html');
    assert(!m.figs && !m.dash && !m.clock && !m.drill,
      'a section page with no figure paints none of them: ' + JSON.stringify(m));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* the scroll spy across the 1180px breakpoint, where the column comes and goes */
  {
    group('the toc mark is right after the column comes back');
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
  }
};
