/* The reconcile trace and the sync readout: the masthead draws course progress
   as a square wave (high where a section is done), overlays the section being
   read, follows the mark-complete button live, and the readout chip's LED
   turns green only when all 29 sections report done. Also pins the browser
   chrome: the theme-color metas must carry the same ground the stylesheet
   paints, or a palette change has silently missed theme.js. */
'use strict';

module.exports = async function (h) {
  const { url, fresh, assert, group } = h;

  // points sitting at the wave's high level (y=2); each done section carries two
  const hiPoints = page => page.evaluate(() => {
    const p = document.querySelector('.topbar .trace path.tr');
    return p ? (p.getAttribute('d').match(/ 2(?=L|$)/g) || []).length : -1;
  });
  const hasCur = page => page.evaluate(() => !!document.querySelector('.topbar .trace path.cur'));
  const synced = page => page.evaluate(() => document.querySelector('.topbar .prog').classList.contains('synced'));

  /* 1. the wave exists, encodes progress, and the dashboard has no reading overlay */
  {
    group('trace: the wave carries one segment per section');
    const { ctx, page } = await fresh({ done: { '1.1': 1 } });
    await page.goto(url('index.html'));
    assert((await page.evaluate(() => document.querySelectorAll('.topbar .trace svg').length)) === 1,
      'the masthead carries one trace');
    assert((await hiPoints(page)) === 2, 'one done section holds the wave high for one segment');
    assert(!(await hasCur(page)), 'no reading overlay on the dashboard');
    assert(!(await synced(page)), '1/29 is not synced');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. the trace follows the mark-complete button without a reload */
  {
    group('trace: marking a section moves the wave and the readout');
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    assert((await hiPoints(page)) === 0, 'a fresh store starts the wave flat');
    assert(await hasCur(page), 'the section being read is overlaid');
    await page.keyboard.press('m');
    assert((await hiPoints(page)) === 2, 'm raises this section in the wave');
    await page.keyboard.press('m');
    assert((await hiPoints(page)) === 0, 'm again lowers it back');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. all 29 done turns the readout LED green */
  {
    group('trace: the sync LED goes green only at 29/29');
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    await page.evaluate(() => {
      const done = {};
      window.CNPE_NAV.filter(n => n.d > 0).forEach(n => { done[n.id] = 1; });
      localStorage.setItem('cnpe:v2', JSON.stringify({ done }));
    });
    await page.reload();
    assert(await synced(page), 'the readout chip reports synced');
    assert((await hiPoints(page)) === 58, 'the whole wave sits high');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 4. the browser chrome follows the stylesheet's ground in both pinned themes */
  for (const theme of ['dark', 'light']) {
    group('trace: theme-color meta matches --ink when ' + theme + ' is pinned');
    const { ctx, page } = await fresh(null, { theme });
    await page.goto(url('index.html'));
    const pair = await page.evaluate(() => ({
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim().toLowerCase(),
      metas: Array.from(document.querySelectorAll('meta[name="theme-color"]'))
        .map(m => m.getAttribute('content').toLowerCase()),
    }));
    assert(pair.metas.length > 0 && pair.metas.every(c => c === pair.ink),
      'every meta carries the ' + theme + ' ground ' + pair.ink + ': ' + JSON.stringify(pair.metas));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }
};
