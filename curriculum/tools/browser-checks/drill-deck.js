/* The drill's deck building and scoring. */
'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, store, assert, group } = h;

  // answer through n cards with the drill's own keys: space reveals, 1 missed, 2 got it
  /**
   * @param {import('playwright').Page} page
   * @param {number} n
   * @param {(i: number) => string} [keyFor]
   */
  async function walk(page, n, keyFor) {
    const secs = [], qs = [];
    for (let i = 0; i < n; i++) {
      const card = await page.evaluate(() => ({
        sec: document.querySelector('.drill-src a').textContent.split(' · ')[0].trim(),
        q: document.querySelector('.drill-q').textContent.replace(/\s+/g, ' ').trim(),
      }));
      secs.push(card.sec); qs.push(card.q);
      await page.keyboard.press('Space');
      await page.keyboard.press(keyFor ? keyFor(i) : '2');
    }
    return { secs, qs };
  }

  /* 1. a domain chip narrows the deck to that domain, without repeats */
  {
    group('the domain chip filters the deck');
    const { ctx, page } = await fresh();
    await page.goto(url('drill.html'));
    await page.click('button.wchip:text-is("d2")');
    await page.click('button.drill-start');
    assert(/card 1 \/ 10/.test(await page.evaluate(() => document.querySelector('.drill-prog').textContent)),
      'a d2 session starts at card 1 / 10');
    const { secs, qs } = await walk(page, 10);
    assert(secs.every(s => s.indexOf('2.') === 0), 'every card comes from domain 2: ' + JSON.stringify(secs));
    assert(new Set(qs).size === 10, 'no question repeats within the deck');
    const cells = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.wgrid .wcell')).map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    assert(cells.some(c => c.replace(/\s/g, '') === 'gotit10'), 'summary counts 10 got: ' + JSON.stringify(cells));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. the size chip sets the deck length */
  {
    group('the size chip sets the deck length');
    const { ctx, page } = await fresh();
    await page.goto(url('drill.html'));
    await page.click('button.wchip:text-is("40")');
    await page.click('button.drill-start');
    assert(/card 1 \/ 40/.test(await page.evaluate(() => document.querySelector('.drill-prog').textContent)),
      'a 40-card session starts at card 1 / 40');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. the weighting leans toward missed questions and rests fresh-correct ones */
  {
    group('missed questions dominate a weighted deck');
    const { ctx, page } = await fresh();
    // a deterministic Math.random, so this check never flakes on a given bank
    await page.addInitScript(() => {
      let s = 42 >>> 0;
      Math.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    });
    await page.goto(url('drill.html'));
    // all the questions were answered right just now; five repeat offenders weigh 20x more
    const missedQs = await page.evaluate(() => {
      const st = window.CNPE_PROGRESS.get(), bank = window.CNPE_DRILL, now = Date.now();
      st.drill = {};
      bank.forEach(function (q, i) {
        st.drill[q.id] = i < 5 ? { r: 0, m: 2, ok: false, t: now - 864e5 }
                               : { r: 1, m: 0, ok: true, t: now };
      });
      window.CNPE_PROGRESS.save();
      return bank.slice(0, 5).map(function (q) {
        const d = document.createElement('div'); d.innerHTML = q.q;
        return d.textContent.replace(/\s+/g, ' ').trim();
      });
    });
    await page.reload();
    await page.click('button.wchip:text-is("40")');
    await page.click('button.drill-start');
    const { qs } = await walk(page, 40);
    const hit = missedQs.filter(q => qs.indexOf(q) >= 0).length;
    assert(hit >= 2, hit + ' of the 5 missed questions made the 40-card deck');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 4. misses feed the records, the summary and the redrill */
  {
    group('a session records misses and offers a redrill');
    const { ctx, page } = await fresh();
    await page.goto(url('drill.html'));
    await page.click('button.drill-start');
    await walk(page, 10, i => (i < 3 ? '1' : '2'));   // miss the first three
    const acc = await page.evaluate(() => document.getElementById('drill-acc').textContent.replace(/\s+/g, ''));
    assert(/^70%/.test(acc), 'the accuracy tile shows 70%: ' + JSON.stringify(acc));
    const s = await store(page);
    const recs = Object.keys(s.drill).map(k => s.drill[k]);
    assert(recs.length === 10 && recs.filter(r => r.m > 0 && r.ok === false).length === 3,
      '10 records written, 3 carry the miss');
    assert((await page.evaluate(() => document.querySelectorAll('.drill-missed .row').length)) === 3,
      'the summary lists the 3 misses for rereading');
    await page.click('button:has-text("Redrill the 3 missed")');
    assert(/card 1 \/ 3/.test(await page.evaluate(() => document.querySelector('.drill-prog').textContent)),
      'the redrill deals exactly those 3');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 5. the schedule rests what is not due and deals what is */
  {
    group('the schedule rests a fresh card and brings a missed one back');
    const { ctx, page } = await fresh();
    await page.addInitScript(() => {
      let s = 42 >>> 0;
      Math.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    });
    await page.goto(url('drill.html'));
    const dueQs = await page.evaluate(() => {
      const st = window.CNPE_PROGRESS.get(), bank = window.CNPE_DRILL, now = Date.now();
      st.drill = {};
      // five got right a month ago, so long past due; the rest answered just now
      bank.forEach(function (q, i) {
        st.drill[q.id] = i < 5 ? { r: 2, m: 0, ok: true, t: now - 30 * 864e5 }
                               : { r: 3, m: 0, ok: true, t: now };
      });
      window.CNPE_PROGRESS.save();
      return bank.slice(0, 5).map(function (q) {
        const d = document.createElement('div'); d.innerHTML = q.q;
        return d.textContent.replace(/\s+/g, ' ').trim();
      });
    });
    await page.reload();
    const due = () => page.evaluate(() => +document.getElementById('drill-due').firstChild.textContent);
    assert((await due()) === 5, 'the tile counts the five that are due: ' + await due());
    await page.click('button.wchip:text-is("20")');
    await page.click('button.drill-start');
    const { qs } = await walk(page, 20, i => (i === 0 ? '1' : '2'));
    const hit = dueQs.filter(q => qs.indexOf(q) >= 0).length;
    assert(hit >= 3, hit + ' of the 5 due cards made the 20-card deck');
    // the 19 got right went away for a day or more; the one missed is due again now
    assert((await due()) === 1, 'the session left exactly the missed card due: ' + await due());
    const missed = await page.evaluate(() => {
      const st = window.CNPE_PROGRESS.get();
      return Object.keys(st.drill).filter(function (k) { return st.drill[k].ok === false; }).length;
    });
    assert(missed === 1, 'and that is the one card the store has as missed: ' + missed);
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 6. a record can hold any number at all: it came from a file, or from a merge */
  {
    group('an absurd counter does not stall the schedule');
    const { ctx, page } = await fresh({ drill: { 'x': { r: 1e15, m: 0, ok: true, t: Date.now() } } });
    const started = Date.now();
    await page.goto(url('drill.html'));
    await page.click('button.drill-start');
    assert(Date.now() - started < 15000, 'the page built and dealt a deck in ' + (Date.now() - started) + 'ms');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 7. a handed-over domain pre-selects its chip, once */
  {
    group('the dashboard hand-off pre-selects a domain chip');
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    await page.evaluate(() => sessionStorage.setItem('cnpe:drill-domain', '3'));
    await page.goto(url('drill.html'));
    const sel = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.wpick button.sel')).map(b => b.textContent));
    assert(sel.indexOf('d3') >= 0, 'the d3 chip arrives selected: ' + JSON.stringify(sel));
    assert((await page.evaluate(() => sessionStorage.getItem('cnpe:drill-domain'))) === null,
      'the hand-off is consumed on arrival');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }
};
