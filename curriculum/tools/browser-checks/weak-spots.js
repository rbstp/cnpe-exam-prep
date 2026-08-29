/* The dashboard's weak-spots panel. */
'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, assert, group } = h;

  /** @typedef {import('playwright').Page} Page */

  const verdict = (/** @type {Page} */ page) => page.evaluate(() =>
    document.querySelector('#weak-domains .wcell.wspan .wv').textContent.replace(/\s+/g, ' ').trim());
  const cellFor = (/** @type {Page} */ page, /** @type {number} */ n) => page.evaluate(d =>
    Array.from(document.querySelectorAll('#weak-domains .wcell'))
      .map(c => c.textContent.replace(/\s+/g, ' ').trim())
      .filter(t => t.indexOf('domain ' + d + ' ') === 0)[0] || '(missing)', n);

  /* 1. no drill history yet */
  {
    group('no history: the panel points at the drill');
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    assert(/^No drill history in this browser yet/.test(await verdict(page)), 'the verdict says to run a session');
    assert(/no answers yet/.test(await cellFor(page, 1)), 'a domain cell shows no answers yet');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. too few answers per domain to call a weak spot */
  {
    group('too few answers: no weak spot is called');
    const { ctx, page } = await fresh({ drill: { '2.1#a': { r: 1, m: 1, ok: true, t: 1 } } });
    await page.goto(url('index.html'));
    assert(/^Too few answers per domain/.test(await verdict(page)), 'the verdict asks for more drilling');
    assert(/50% of 2/.test(await cellFor(page, 2)), 'the domain 2 cell still shows its 50% of 2');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. a weak spot is called, and its link pre-selects the drill domain */
  {
    group('the weakest domain is called and handed to the drill');
    const { ctx, page } = await fresh({ drill: {
      '1.1#a': { r: 6, m: 0, ok: true, t: 1 },
      '2.1#b': { r: 2, m: 4, ok: false, t: 1 },
    } });
    await page.goto(url('index.html'));
    assert(/100% of 6/.test(await cellFor(page, 1)), 'domain 1 reads 100% of 6');
    assert(/33% of 6/.test(await cellFor(page, 2)), 'domain 2 reads 33% of 6');
    const v = await verdict(page);
    assert(/^Weakest: domain 2 /.test(v), 'domain 2 is called weakest: ' + JSON.stringify(v));
    await page.click('#weak-domains [data-drill-domain]');
    await page.waitForURL(/drill\.html/);
    const chips = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('.wpick button.sel')).map(b => b.textContent));
    const sel = await chips();
    assert(sel.indexOf('d2') >= 0, 'the drill arrives with d2 pre-selected: ' + JSON.stringify(sel));
    // once, or every later drill is stuck on the domain one click chose. Named
    // against 'all' rather than against nothing, so an empty row cannot pass it.
    await page.reload();
    const back = await chips();
    assert(back.indexOf('all') >= 0 && back.indexOf('d2') < 0,
      'the hand-off was consumed, so the reload deals every domain again: ' + JSON.stringify(back));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 4. the dashboard says how much of the drill has come round */
  {
    group('the drill button carries the backlog, once there is one');
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    // The dashboard renders no card, so it loads the index, not the 67 KB bank.
    assert(await page.evaluate(() => !window.CNPE_DRILL && Array.isArray(window.CNPE_DRILL_INDEX)),
      'the dashboard has the drill index and not the bank');
    // real ids, since the count is over the deck the drill actually deals from
    await page.evaluate(() => {
      const st = window.CNPE_PROGRESS.get(), now = Date.now();
      const bank = window.CNPE_DRILL || window.CNPE_DRILL_INDEX;
      st.drill = {};
      st.drill[bank[0].id] = { r: 1, m: 0, ok: true, t: now - 5 * 864e5 };   // came round days ago
      st.drill[bank[1].id] = { r: 1, m: 0, ok: true, t: now - 5 * 864e5 };   // came round days ago
      st.drill[bank[2].id] = { r: 2, m: 0, ok: true, t: now };               // resting four days
      st.drill[bank[3].id] = { r: 6, m: 0, ok: true, t: now };               // resting three weeks
      window.CNPE_PROGRESS.save();
    });
    await page.reload();
    const drillBtn = () => page.evaluate(() =>
      (document.querySelector('#resume a[href$="drill.html"]') || { textContent: '' })
        .textContent.replace(/\s+/g, ' ').trim());
    assert(/^Drill 10 · 2 due$/.test(await drillBtn()),
      'two of the four have come round: ' + JSON.stringify(await drillBtn()));
    await ctx.close();

    // and a browser that has never drilled is not told all 148 are waiting
    const fresh2 = await fresh({ done: { '1.1': 1 } });
    await fresh2.page.goto(url('index.html'));
    const text = await fresh2.page.evaluate(() =>
      (document.querySelector('#resume a[href$="drill.html"]') || { textContent: '' })
        .textContent.replace(/\s+/g, ' ').trim());
    assert(!/due/.test(text), 'no history, no backlog: ' + JSON.stringify(text));
    assert(fresh2.page.errors.length === 0, 'no console errors: ' + fresh2.page.errors.join(' | '));
    await fresh2.ctx.close();
  }
};
