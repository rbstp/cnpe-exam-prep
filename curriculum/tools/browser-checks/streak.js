/* The console-wide study streak, end to end: every action type heartbeats the
   day, un-ticking never counts, history derives the right streak/record/heat
   strip, the drillmeta migration seeds an alive legacy streak, and the
   single-file bundle behaves across hash routes. */
'use strict';
const path = require('path');

module.exports = async function (h) {
  const { url, fresh, store, assert, group, streakVal, streakLbl, heatOn, heatAll, daysAgo, TODAY, YDAY } = h;
  const SHOTS = process.env.STREAK_SHOTS || '';

  /* 1. drill answers count, once per day; a full session shows the summary */
  {
    group('drill answers feed the streak');
    const { ctx, page } = await fresh();
    await page.goto(url('drill.html'));
    let tile = await page.evaluate(() => document.getElementById('drill-streak').textContent);
    assert(/^0\s*days/.test(tile.trim()), 'fresh profile shows 0 days: ' + JSON.stringify(tile));
    await page.click('button.drill-start');
    for (let i = 0; i < 10; i++) {
      await page.click('button:has-text("Show answer")');
      await page.click(i % 3 === 0 ? 'button.drill-miss' : 'button.drill-hit');
    }
    tile = await page.evaluate(() => document.getElementById('drill-streak').textContent);
    assert(/^1\s*day/.test(tile.trim()), 'streak tile shows 1 day after answers: ' + JSON.stringify(tile));
    const cells = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.wgrid .wcell')).map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    // wk and wv are sibling spans, so textContent runs them together
    assert(cells.some(c => /^uptimeup 1 day · today's 10 are in$/.test(c)), 'summary uptime cell: ' + JSON.stringify(cells));
    const s = await store(page);
    assert(s.days[TODAY] && s.days[TODAY].c === 10, 'days[today].c === 10: ' + JSON.stringify(s.days));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. exercise verify counts; un-tick does not */
  {
    group('exercise verify counts, un-tick does not');
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    await page.click('.exercise .mark');
    let s = await store(page);
    assert(s.days[TODAY] && s.days[TODAY].x === 1, 'x === 1 after verify');
    await page.click('.exercise .mark');            // un-tick
    s = await store(page);
    assert(s.days[TODAY].x === 1, 'x stays 1 after un-tick');
    await page.click('.exercise .mark');            // re-tick
    s = await store(page);
    assert(s.days[TODAY].x === 2, 'x === 2 after re-tick');
    await page.goto(url('index.html'));
    assert(/^1day/.test(await streakVal(page)), 'dashboard uptime is 1 day');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. section complete counts; un-tick does not */
  {
    group('section complete counts, un-tick does not');
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    await page.click('.finish button.tbtn');
    let s = await store(page);
    assert(s.days[TODAY] && s.days[TODAY].s === 1, 's === 1 after complete');
    await page.click('.finish button.tbtn');
    s = await store(page);
    assert(s.days[TODAY].s === 1, 's stays 1 after un-tick');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 4. exam task scored counts; un-tick does not */
  {
    group('exam task scored counts, un-tick does not');
    const { ctx, page } = await fresh();
    await page.goto(url('mock-exam.html'));
    await page.click('.task .dot');
    let s = await store(page);
    assert(s.days[TODAY] && s.days[TODAY].e === 1, 'e === 1 after scoring a task');
    await page.click('.task .dot');
    s = await store(page);
    assert(s.days[TODAY].e === 1, 'e stays 1 after un-tick');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 5. seeded multi-day history: streak, record, heat strip */
  {
    group('seeded multi-day history renders streak, record, heat strip');
    const days = {};
    days[daysAgo(1)] = { c: 1 }; days[daysAgo(2)] = { x: 1 }; days[daysAgo(3)] = { s: 2 };
    days[daysAgo(6)] = { e: 1 }; days[daysAgo(7)] = { c: 5 };
    const { ctx, page } = await fresh({ days });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^3days$/.test(val), 'streak 3: ' + JSON.stringify(val));
    const lbl = await streakLbl(page);
    assert(/^Uptime·record3$/.test(lbl), 'record 3 in the label: ' + JSON.stringify(lbl));
    assert((await heatAll(page)) === 30, '30 heat cells');
    assert((await heatOn(page)) === 5, '5 lit heat cells');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 6. a gap day breaks the streak */
  {
    group('a gap day breaks the streak');
    const days = {}; days[daysAgo(2)] = { c: 3 };
    const { ctx, page } = await fresh({ days });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^0days$/.test(val), 'streak 0: ' + JSON.stringify(val));
    assert(/^Uptime·record1$/.test(await streakLbl(page)), 'record 1 in the label');
    await ctx.close();
  }

  /* 7. drillmeta seeding preserves an alive legacy streak */
  {
    group('drillmeta seeding preserves an alive legacy streak (earned today)');
    const { ctx, page } = await fresh({ drillmeta: { day: TODAY, n: 10, earned: TODAY, streak: 4, best: 6, t: Date.now() } });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^4days$/.test(val), 'streak 4: ' + JSON.stringify(val));
    assert(/^Uptime·record6$/.test(await streakLbl(page)), 'record 6 in the label');
    assert((await heatOn(page)) === 4, '4 lit heat cells from the backfill');
    const btn = await page.evaluate(() => document.querySelector('#resume a[href*="drill"]').textContent);
    assert(/up 4 days/.test(btn), 'drill button carries the unified streak: ' + JSON.stringify(btn));
    await ctx.close();
  }
  {
    group('drillmeta seeding, streak ending yesterday');
    const { ctx, page } = await fresh({ drillmeta: { day: YDAY, n: 10, earned: YDAY, streak: 2, best: 2, t: Date.now() } });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^2days$/.test(val), 'streak 2 alive via yesterday: ' + JSON.stringify(val));
    await ctx.close();
  }
  {
    group('a dead legacy streak only carries its record');
    const { ctx, page } = await fresh({ drillmeta: { day: daysAgo(5), n: 10, earned: daysAgo(5), streak: 7, best: 7, t: Date.now() } });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^0days$/.test(val), 'streak 0: ' + JSON.stringify(val));
    assert(/^Uptime·record7$/.test(await streakLbl(page)), 'record 7 in the label');
    assert((await heatOn(page)) === 0, 'no backfilled cells for a dead streak');
    await ctx.close();
  }

  /* 8. the bundled console: #index and #DR routes, repeated boot() */
  {
    group('bundle: streak works across #index and #DR hash routes');
    const { ctx, page } = await fresh();
    await page.goto(url('console.html'));
    assert((await heatAll(page)) === 30, 'heat strip renders in the bundle');
    await page.goto(url('console.html') + '#DR');
    await page.click('button.drill-start');
    await page.click('button:has-text("Show answer")');
    await page.click('button.drill-hit');
    const tile = await page.evaluate(() => document.getElementById('drill-streak').textContent);
    assert(/^1\s*day/.test(tile.trim()), 'drill tile shows 1 day in the bundle: ' + JSON.stringify(tile));
    await page.goto(url('console.html') + '#index');
    await page.waitForFunction(() => document.querySelector('#stat-streak .heat i'));
    const val = await streakVal(page);
    assert(/^1day$/.test(val), 'dashboard uptime 1 back on #index: ' + JSON.stringify(val));
    // navigate back and forth once more: boot() re-runs must stay idempotent
    await page.goto(url('console.html') + '#DR');
    await page.goto(url('console.html') + '#index');
    await page.waitForFunction(() => document.querySelector('#stat-streak .heat i'));
    assert((await heatOn(page)) === 1, 'one lit cell after re-navigation');
    assert(page.errors.length === 0, 'no console errors in the bundle: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 9. junk in the store does not break boot */
  {
    group('junk tolerance');
    const { ctx, page } = await fresh({ days: 'garbage', drillmeta: [1, 2], ex: 7 });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^0days/.test(val), 'junk store renders 0 days: ' + JSON.stringify(val));
    assert(page.errors.length === 0, 'no console errors on junk: ' + page.errors.join(' | '));
    await ctx.close();
  }
  {
    const days = { 'not-a-date': { c: 3 } }; days[TODAY] = { c: 'x', x: 2 };
    const { ctx, page } = await fresh({ days });
    await page.goto(url('index.html'));
    const val = await streakVal(page);
    assert(/^1day/.test(val), 'junk day entries tolerated: ' + JSON.stringify(val));
    assert(page.errors.length === 0, 'no console errors on junk days: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 10. themes: the strip must boot clean in light and dark */
  {
    group('themes' + (SHOTS ? ' (screenshots in ' + SHOTS + ')' : ''));
    const days = {};
    for (let i = 0; i < 12; i++) if (i % 4 !== 3) days[daysAgo(i)] = { c: 10 };
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await fresh({ days }, { theme });
      await page.goto(url('index.html'));
      await page.waitForFunction(() => document.querySelector('#stat-streak .heat i'));
      assert((await heatOn(page)) === 9, theme + ' theme renders the strip');
      assert(page.errors.length === 0, theme + ' theme, no console errors');
      if (SHOTS) {
        // the eyeball aid must never fail the gate
        try {
          await page.screenshot({ path: path.join(SHOTS, 'heat-' + theme + '.png'), clip: await page.evaluate(() => {
            const r = document.querySelector('.stats').getBoundingClientRect();
            return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height };
          }) });
        } catch (e) { console.log('  note: ' + theme + ' screenshot skipped (' + e.message + ')'); }
      }
      await ctx.close();
    }
  }
};
