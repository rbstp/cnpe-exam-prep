/* The quest: the store it writes, the trial it shares with the drill, the doors
   it opens, and a battle fought in its terminal. game-sim-test.mjs covers every
   scenario's commands in node; this drives the page around them. */
'use strict';
const fs = require('fs');
const path = require('path');

const SHOTS = process.env.STREAK_SHOTS || '';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, store, assert, group, dayCount, TODAY } = h;

  // Portmouth (1.1) is the first town: the player starts two tiles below it,
  // and its dungeon door is three tiles east of it, on the road.
  const TOWN = { x: 8, y: 6 }, DOOR = { x: 11, y: 6 }, ROAD = { x: 10, y: 6 };

  /** @param {import('playwright').Page} page */
  const skipIntro = async page => {
    for (let i = 0; i < 4; i++) {
      const b = page.locator('.gm-dialog button').first();
      // the closed dialog keeps its last button in the DOM, hidden
      if (!(await b.count()) || !(await b.isVisible())) break;
      await b.click();
    }
    await page.focus('.gm-stage');
  };
  /** @param {import('playwright').Page} page @param {number} x @param {number} y */
  const standAt = async (page, x, y) => {
    await page.evaluate(({ x, y }) => {
      const s = window.CNPE_PROGRESS.get();
      s.game = s.game || {};
      s.game.pos = { x: x, y: y, t: Date.now() };
      window.CNPE_PROGRESS.save();
    }, { x, y });
    await page.reload();
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
  };
  /** pick the option that is the current question's own answer
      @param {import('playwright').Page} page */
  const answerRight = async page => {
    const idx = await page.evaluate(() => {
      const q = document.querySelector('.gm-q').innerHTML;
      const card = window.CNPE_DRILL.find(c => c.q === q);
      const strip = (/** @type {string} */ h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
      const want = strip(card.a).slice(0, 60);
      return Array.from(document.querySelectorAll('.gm-opt')).findIndex(b => b.textContent.replace(/\s+/g, ' ').indexOf(want) >= 0);
    });
    await page.keyboard.press(String(idx + 1));
  };
  /** @param {import('playwright').Page} page @param {string} cmd */
  const type = async (page, cmd) => {
    await page.fill('.gm-term input', cmd);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
  };
  /** @param {import('playwright').Page} page */
  const term = page => page.evaluate(() => document.querySelector('.gm-term pre').textContent);

  /* 1. the page mounts, and the intro writes the starter kit into store.game */
  await group('the quest mounts and the intro seeds the store', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    assert((await page.evaluate(() => document.querySelectorAll('main, [role="main"]').length)) === 1, 'one main landmark');
    assert(await page.isVisible('.gm-dialog'), 'the intro note is up');
    let s = await store(page);
    assert(s.game && s.game.flags && s.game.flags.intro === 1, 'the intro flag is set: ' + JSON.stringify(s.game && s.game.flags));
    assert(s.game.learned && ['k-get', 'k-describe', 'k-events', 'k-logs'].every(k => s.game.learned[k] === 1), 'the four starter techniques are learned');
    assert(s.game.items && dayCount(s.game.items.scroll, 'g') === 2, 'two hint scrolls in the pack: ' + JSON.stringify(s.game.items));
    assert(dayCount(s.game, 'xp') === 0 && !s.game.wins, 'no xp and no wins yet');
    const tiles = await page.evaluate(() => document.querySelector('.stats').textContent.replace(/\s+/g, ' '));
    assert(/Level ?1/.test(tiles) && /Battles won ?0/.test(tiles), 'the tiles read level 1 and no battles: ' + tiles);
    await skipIntro(page);
    assert(!(await page.isVisible('.gm-dialog')), 'the note closes');
    const label = await page.getAttribute('.gm-stage canvas', 'aria-label');
    assert(/Substrate Downs/.test(label || ''), 'the canvas describes where you stand: ' + label);
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 2. walking onto a town opens it; a trial answer lands in the drill's record and today's count */
  await group('a trial answer is a drill answer and a heartbeat', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
    assert(/Portmouth/.test(await page.textContent('.gm-title')), 'two steps north is Portmouth');
    // d is a page shortcut for the dashboard, and WASD inside the game must not fire it
    await page.click('.gm-menu button:has-text("Trial")');
    await page.waitForSelector('.gm-opt');
    const n = await page.evaluate(() => document.querySelectorAll('.gm-opt').length);
    assert(n === 4, 'four options per question: ' + n);
    await answerRight(page);
    await page.waitForTimeout(80);
    let s = await store(page);
    const recs = Object.keys(s.drill);
    assert(recs.length === 1 && recs[0].indexOf('1.1#') === 0 && s.drill[recs[0]].r === 1 && s.drill[recs[0]].ok === true,
      'one drill record, for a 1.1 card, marked right: ' + JSON.stringify(s.drill));
    assert(dayCount(s.days[TODAY], 'c') === 1, "today's card count is 1: " + JSON.stringify(s.days[TODAY]));
    assert(dayCount(s.game, 'xp') === 5, 'five xp for the right answer: ' + dayCount(s.game, 'xp'));
    assert(await page.isVisible('.gm-opt.right'), 'the right option is marked');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    // miss the rest by picking an option that is not marked right; the trial fails and stays sealed
    for (let i = 1; i < 6; i++) {
      const done = await page.evaluate(() => !document.querySelector('.gm-opt'));
      if (done) break;
      const wrong = await page.evaluate(() => {
        const q = document.querySelector('.gm-q').innerHTML;
        const card = window.CNPE_DRILL.find(c => c.q === q);
        const strip = (/** @type {string} */ h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
        const want = strip(card.a).slice(0, 60);
        return Array.from(document.querySelectorAll('.gm-opt')).findIndex(b => b.textContent.replace(/\s+/g, ' ').indexOf(want) < 0);
      });
      await page.keyboard.press(String(wrong + 1));
      await page.waitForTimeout(60);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
    }
    s = await store(page);
    assert(!(s.game.towns && s.game.towns['1.1']), 'one right of six does not clear the trial');
    assert(Object.keys(s.drill).length === 6 && Object.keys(s.drill).filter(k => s.drill[k].ok === false).length === 5, 'six records, five misses: the drill will deal them again');
    assert(/Not this time/.test(await page.textContent('.gm-screen')), 'and the town says so');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 3. the door refuses before the trial and opens after it */
  await group('a dungeon door is sealed until its trial is cleared', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await standAt(page, ROAD.x, ROAD.y);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.gm-dialog:not([hidden])');
    assert(/sealed/.test(await page.textContent('.gm-dialog')), 'the door is sealed: ' + (await page.textContent('.gm-dialog')).slice(0, 80));
    assert((await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.gm-screen')).hidden)) === true, 'and no battle opened');
    await page.evaluate(() => { const s = window.CNPE_PROGRESS.get(); s.game.towns = { '1.1': 1 }; window.CNPE_PROGRESS.save(); });
    await standAt(page, ROAD.x, ROAD.y);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.gm-dialog:not([hidden])');
    assert(/Hollow Beacon/.test(await page.textContent('.gm-dialog')), 'cleared, the door names what waits below');
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    assert(/Hollow Beacon/.test(await page.textContent('.gm-title')), 'and the battle opens');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 4. a battle: items, evidence, typed against menu, the fix, the record */
  await group('a battle is won by inspecting, then fixing', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, learned: { 'k-get': 1, 'k-describe': 1 }, items: { scroll: { g: { t: 2 } } }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowRight');
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    // an item: the scroll names the next thing to inspect and is used up
    await page.click('.gm-acts button:has-text("Item")');
    await page.click('.gm-sub .gm-menu button:has-text("Hint Scroll")');
    await page.waitForTimeout(60);
    assert(/The scroll reads/.test(await term(page)), 'the scroll speaks in the terminal');
    let s = await store(page);
    assert(dayCount(s.game.items.scroll, 'u') === 1, 'and one scroll is used: ' + JSON.stringify(s.game.items.scroll));
    // menu pick: Inspect, kubectl get, pods -> evidence at the menu rate
    await page.click('.gm-acts button:has-text("Inspect")');
    await page.click('.gm-sub .gm-menu button:has-text("kubectl get")');
    await page.waitForSelector('.gm-sub .hd:has-text("which one?")');
    await page.click('.gm-sub .gm-menu button:has-text("pods")');
    await page.waitForTimeout(80);
    let t = await term(page);
    assert(/Evidence found \(1\/3\).*\+10 xp\./.test(t) && !/\+10 xp \(typed\)/.test(t), 'a menu pick earns the menu rate: 10 xp');
    // typed: the same family of command, at the typed rate
    await type(page, 'kubectl -n team-a describe svc web');
    t = await term(page);
    assert(/Evidence found \(2\/3\).*\+12 xp \(typed\)/.test(t), 'a typed command earns a fifth more: 12 xp');
    assert(/Endpoints:\s+<none>/.test(t), 'and the tell is in the output');
    await type(page, 'kubectl -n team-a get pods --show-labels');
    assert(/Evidence found \(3\/3\)/.test(await term(page)), 'all three pieces found');
    // a wrong fix bites back, the right one with everything found is a critical hit
    const hpBefore = await page.evaluate(() => document.querySelector('.gm-bar.hp + .gm-barlbl span:last-child').textContent);
    await type(page, 'kubectl -n team-a patch svc web -p \'{"spec":{"selector":{"app":"frontend"}}}\'');
    t = await term(page);
    assert(/not it, and the fault bites back/.test(t) && /strikes for/.test(t), 'a plausible wrong fix costs a hit');
    const hpAfter = await page.evaluate(() => document.querySelector('.gm-bar.hp + .gm-barlbl span:last-child').textContent);
    assert(hpBefore !== hpAfter, 'health went down: ' + hpBefore + ' -> ' + hpAfter);
    await type(page, 'kubectl -n team-a patch svc web -p \'{"spec":{"selector":{"app":"web-frontend"}}}\'');
    await page.waitForSelector('.gm-result');
    assert(/Critical hit/.test(await page.textContent('.gm-result h4')), 'the fix with all the evidence is a critical hit');
    s = await store(page);
    // 10 + 12 + 12 for the evidence, then 100 x difficulty 1 x 1.2 typed
    assert(dayCount(s.game, 'xp') === 154, 'xp adds up: ' + dayCount(s.game, 'xp'));
    assert(dayCount(s.game.gold, 'e') === 30, 'gold for the win: ' + JSON.stringify(s.game.gold));
    assert(s.game.wins['svc-selector'] && s.game.wins['svc-selector'].n === 1 && s.game.wins['svc-selector'].best === 5, 'the win is recorded with its turn count: ' + JSON.stringify(s.game.wins));
    const tiles = await page.evaluate(() => document.querySelector('.stats').textContent.replace(/\s+/g, ' '));
    assert(/Level ?2/.test(tiles) && /Battles won ?1/.test(tiles) && /Gold ?30/.test(tiles), 'the tiles moved: ' + tiles);
    await page.click('.gm-result button:has-text("Back to Portmouth")');
    await page.waitForSelector('.gm-menu button:has-text("Dungeon")');
    assert(/Portmouth/.test(await page.textContent('.gm-title')), 'victory leads back to the town');
    // state survives a reload
    await page.reload();
    await page.waitForSelector('.gm-stage canvas');
    const again = await store(page);
    assert(dayCount(again.game, 'xp') === 154 && again.game.wins['svc-selector'].n === 1, 'xp and the win survive a reload');
    const label = await page.getAttribute('.gm-stage canvas', 'aria-label');
    assert(/Portmouth/.test(label || ''), 'and you stand where you were: ' + label);
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 5. defeat keeps the evidence xp; flee keeps it too */
  await group('defeat and flight keep what was found', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowRight');
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    await type(page, 'kubectl -n team-a describe svc web');
    await page.click('.gm-acts button:has-text("Flee")');
    await page.waitForSelector('.gm-menu button:has-text("Dungeon")');
    let s = await store(page);
    assert(dayCount(s.game, 'xp') === 12 && !s.game.wins, 'fled with 12 xp and no win');
    await page.click('.gm-menu button:has-text("Dungeon")');
    await page.waitForSelector('.gm-term input');
    for (let i = 0; i < 40; i++) {
      if (await page.locator('.gm-result').count()) break;
      await type(page, 'kubectl -n team-a get svc');            // a turn that finds nothing, and takes a hit
    }
    assert(/Defeat/.test(await page.textContent('.gm-result h4')), 'enough fruitless turns is a defeat');
    s = await store(page);
    assert(dayCount(s.game, 'xp') === 12 && !s.game.wins, 'and nothing is lost or won by it');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 6. the single-file console mounts the same game on its hash route, and remounts */
  await group('the bundle routes #GM to the quest', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('console.html') + '#GM');
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
    assert(true, 'the quest mounted on the hash route');
    await skipIntro(page);
    await page.evaluate(() => { location.hash = '#DR'; });
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
    await page.evaluate(() => { location.hash = '#GM'; });
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
    assert((await page.evaluate(() => document.querySelectorAll('#game-app canvas').length)) === 1, 'leaving and coming back mounts one canvas, not two');
    assert((await page.evaluate(() => document.querySelectorAll('main, [role="main"]').length)) === 1, 'one main landmark in the bundle');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 7. both themes paint the map, and the switch repaints it */
  await group('the map paints in both themes', async () => {
    /** @param {import('playwright').Page} page */
    const water = page => page.evaluate(() => {
      // the top-left corner of the map is the border sea in every position
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-stage canvas')), k = c.getContext('2d');
      const p = k.getImageData(4, 4, 1, 1).data;
      return p[0] + ',' + p[1] + ',' + p[2];
    });
    /** @type {Record<string, string>} */
    const seen = {};
    for (const theme of ['dark', 'light']) {
      const { ctx, page } = await fresh(null, { theme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(url('game.html'));
      await page.waitForSelector('.gm-stage canvas');
      await skipIntro(page);
      await page.waitForTimeout(150);
      seen[theme] = await water(page);
      assert(seen[theme] !== '0,0,0', theme + ': the sea is painted, not black: ' + seen[theme]);
      const ink = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim());
      const win = await page.evaluate(() => getComputedStyle(document.querySelector('.gm-hud')).backgroundColor);
      assert(!!ink && win !== 'rgba(0, 0, 0, 0)', theme + ': the windows take the palette ground');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.locator('.gm-stage').screenshot({ path: path.join(SHOTS, 'quest-' + theme + '.png') });
      }
      // the switch repaints without a reload
      await page.evaluate(t => window.CNPE_THEME.set(t), theme === 'dark' ? 'light' : 'dark');
      await page.waitForTimeout(100);
      const after = await water(page);
      assert(after !== seen[theme], theme + ': switching the theme repaints the sea: ' + seen[theme] + ' -> ' + after);
      assert(page.errors.length === 0, theme + ': no console errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
    assert(seen.dark !== seen.light, 'and the two themes paint it differently');
  });
};
