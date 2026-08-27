/* The mock exam's 120-minute clock, driven on Playwright's fake clock so two
   hours pass in milliseconds: start/pause/resume arithmetic, the low and out
   states, reset, and the two papers keeping separate scores and clocks. */
'use strict';

module.exports = async function (h) {
  const { url, fresh, store, assert, group } = h;

  const clockText = page => page.evaluate(() => document.getElementById('clock').textContent.replace(/\s+/g, ''));
  const clockClass = page => page.evaluate(() => document.getElementById('clock').className);
  const startLabel = page => page.evaluate(() => document.getElementById('t-start').textContent);

  /* 1. start, pause, resume, run out */
  {
    group('the clock counts spent time only, and runs out at zero');
    const { ctx, page } = await fresh(null, { clockAt: new Date('2026-03-03T09:00:00') });
    await page.goto(url('mock-exam.html'));
    assert((await clockText(page)) === '120:00', 'a fresh paper shows 120:00');
    assert(/Start 120:00/.test(await startLabel(page)), 'the button offers a start');

    await page.click('#t-start');
    assert(/Pause/.test(await startLabel(page)), 'starting flips the button to pause');
    await page.clock.fastForward(5 * 60000);
    assert((await clockText(page)) === '115:00', '5 minutes in, 115:00 remain');

    await page.click('#t-start');   // pause
    assert(/Resume/.test(await startLabel(page)), 'pausing offers a resume');
    await page.clock.fastForward(10 * 60000);
    assert((await clockText(page)) === '115:00', 'paused time does not count');

    await page.click('#t-start');   // resume
    await page.clock.fastForward(101 * 60000);
    assert((await clockText(page)) === '14:00', 'resumed, 14:00 remain after 101 more minutes');
    assert(/\blow\b/.test(await clockClass(page)), 'under 15 minutes the clock turns low');

    await page.clock.fastForward(15 * 60000);
    assert((await clockText(page)) === '0:00', 'time runs out at 0:00');
    assert(/\bout\b/.test(await clockClass(page)), 'the clock shows the out state');
    const s = await store(page);
    assert(s.exam.running === false && s.exam.spent === 7200, 'the meter stopped where it ran out: ' + JSON.stringify({ running: s.exam.running, spent: s.exam.spent }));
    await page.clock.fastForward(60000);
    assert((await clockText(page)) === '0:00', 'and stays at 0:00');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. reset clears clock and scored tasks */
  {
    group('reset clears the clock and the scored tasks');
    const { ctx, page } = await fresh(null, { clockAt: new Date('2026-03-03T09:00:00') });
    await page.goto(url('mock-exam.html'));
    await page.click('#t-start');
    await page.clock.fastForward(30 * 60000);
    await page.click('.task .dot');
    assert((await page.evaluate(() => document.querySelectorAll('.task.done').length)) === 1, 'one task scored before the reset');
    await page.click('#t-reset');
    assert((await clockText(page)) === '120:00', 'reset restores 120:00');
    assert(/Start 120:00/.test(await startLabel(page)), 'and offers a fresh start');
    assert((await page.evaluate(() => document.querySelectorAll('.task.done').length)) === 0, 'no task stays scored');
    const s = await store(page);
    assert(s.exam.spent === 0 && s.exam.running === false && Object.keys(s.exam.tasks).length === 0,
      'the stored exam state is empty again');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. the two papers keep separate scores and clocks */
  {
    group('paper 2 never disturbs paper 1');
    const { ctx, page } = await fresh(null, { clockAt: new Date('2026-03-03T09:00:00') });
    await page.goto(url('mock-exam.html'));
    const pts = await page.evaluate(() => +document.querySelector('.task').getAttribute('data-pts'));
    await page.click('#t-start');
    await page.clock.fastForward(20 * 60000);
    await page.click('.task .dot');
    const score1 = await page.evaluate(() => document.getElementById('score-val').textContent.replace(/\s+/g, ''));
    assert(score1.indexOf(pts + '/') === 0, 'paper 1 scores the first task: ' + JSON.stringify(score1));

    await page.goto(url('mock-exam-2.html'));
    const score2 = await page.evaluate(() => document.getElementById('score-val').textContent.replace(/\s+/g, ''));
    assert(score2.indexOf('0/') === 0, 'paper 2 starts at zero: ' + JSON.stringify(score2));
    assert((await clockText(page)) === '120:00', "paper 2's clock has not started");
    assert((await page.evaluate(() => document.querySelectorAll('.task.done').length)) === 0, 'no paper-2 task is marked');

    await page.goto(url('mock-exam.html'));
    assert((await page.evaluate(() => document.querySelectorAll('.task.done').length)) === 1, "paper 1's tick survived the round trip");
    const s = await store(page);
    assert(s.exam.tasks['0'] === 1 && Object.keys((s.exam2 && s.exam2.tasks) || {}).length === 0,
      'the store keeps the papers under separate keys');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }
};
