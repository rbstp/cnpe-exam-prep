/* The quest: the store it writes, the trial it shares with the drill, the doors
   it opens, a battle fought in its terminal, and the renderer under it: the
   step tween, the walk cycle keyed to its sub-positions and the camera sliding with it, the camera's ease back to the player, the
   terrain cache and its patches, the living tiles, the minimap with its frame,
   and what a visit to the bundle's #GM route leaves behind. game-sim-test.mjs
   covers every scenario's commands in node; this drives the page around them.

   Time is driven, not waited on, wherever the engine offers a hand: debug().tick()
   is one beat of the water's ticker, debug().settle() fires every pending timer
   and the swap a keep's next monster waits on, debug().frame() paints now. One
   check per ticker still runs on the clock, so the tickers themselves stay
   covered; every other wait is for a state, never for a duration. */
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
  /** an action the terminal answers: run it, then wait for the log to grow rather
      than for a guessed span of time. A fix ends the fight and the result card
      takes the screen, which counts as an answer too.
      @param {import('playwright').Page} page @param {() => Promise<void>} act */
  const afterTurn = async (page, act) => {
    const lines = () => page.evaluate(() => { const p = document.querySelector('.gm-term pre'); return p ? p.childElementCount : -1; });
    const before = await lines();
    await act();
    await page.waitForFunction(n => { const p = document.querySelector('.gm-term pre'); return !p || p.childElementCount > n; }, before, { timeout: 5000 });
  };
  /** @param {import('playwright').Page} page @param {string} cmd */
  const type = (page, cmd) => afterTurn(page, async () => {
    await page.fill('.gm-term input', cmd);
    await page.keyboard.press('Enter');
  });
  /** the trial's next question is up: its options are enabled again, or the trial is over
      @param {import('playwright').Page} page */
  const nextQuestion = page => page.waitForFunction(() => {
    const o = document.querySelector('.gm-opt');
    return !o || !(/** @type {HTMLButtonElement} */ (o).disabled);
  }, null, { timeout: 5000 });
  /** @param {import('playwright').Page} page */
  const term = page => page.evaluate(() => document.querySelector('.gm-term pre').textContent);
  /** the camera as draw() clamps it, so a map tile can be found on the canvas: the
      viewport is 30 by 19 tiles, the player centred unless the map's edge is nearer
      @param {import('playwright').Page} page */
  const view = page => page.evaluate(() => {
    const d = window.CNPE_GAME.debug(), m = window.CNPE_GAME_DATA.map, W = m[0].length, H = m.length;
    const cx = Math.max(0, Math.min(W - 30, d.x - 15)), cy = Math.max(0, Math.min(H - 19, d.y - 9));
    return { cx, cy, x: d.x, y: d.y, scale: d.scale };
  });

  /* 1. the page mounts, and the intro writes the starter kit into store.game */
  await group('the quest mounts and the intro seeds the store', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    assert((await page.evaluate(() => document.querySelectorAll('main, [role="main"]').length)) === 1, 'one main landmark');
    assert(await page.isVisible('.gm-dialog'), 'the intro note is up');
    // reading the console never writes: the kit lands when the note is put down
    assert((await page.evaluate(() => localStorage.getItem('cnpe:v2'))) === null, 'opening the page wrote nothing to the store');
    assert((await page.evaluate(() => localStorage.getItem('cnpe:dev'))) === null, 'and minted no device id');
    await skipIntro(page);
    let s = await store(page);
    assert(s.game && s.game.flags && s.game.flags.intro === 1, 'putting the note down sets the intro flag: ' + JSON.stringify(s.game && s.game.flags));
    assert(s.game.learned && ['k-get', 'k-describe', 'k-events', 'k-logs'].every(k => s.game.learned[k] === 1), 'the four starter techniques are learned');
    assert(s.game.items && dayCount(s.game.items.scroll, 'g') === 2, 'two hint scrolls in the pack: ' + JSON.stringify(s.game.items));
    assert(dayCount(s.game, 'xp') === 0 && !s.game.wins, 'no xp and no wins yet');
    const tiles = await page.evaluate(() => document.querySelector('.stats').textContent.replace(/\s+/g, ' '));
    assert(/Level ?1/.test(tiles) && /Battles won ?0/.test(tiles), 'the tiles read level 1 and no battles: ' + tiles);
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
    assert((await page.locator('.gm-scene[data-scene="square"]').count()) === 1, 'over a strip of the town square');
    // d and g are page shortcuts (dashboard, drill); inside the game they are the game's
    await page.keyboard.press('d'); await page.keyboard.press('g');
    await page.waitForTimeout(150);                  // nothing to wait for: the check is that neither key navigated
    assert(/game\.html/.test(page.url()) && /Portmouth/.test(await page.textContent('.gm-title')), 'a letter pressed in a town does not leave the page');
    await page.click('.gm-menu button:has-text("Trial")');
    await page.waitForSelector('.gm-opt');
    const n = await page.evaluate(() => document.querySelectorAll('.gm-opt').length);
    assert(n === 4, 'four options per question: ' + n);
    await answerRight(page);
    await page.waitForSelector('.gm-opt.right');
    let s = await store(page);
    const recs = Object.keys(s.drill);
    assert(recs.length === 1 && recs[0].indexOf('1.1#') === 0 && s.drill[recs[0]].r === 1 && s.drill[recs[0]].ok === true,
      'one drill record, for a 1.1 card, marked right: ' + JSON.stringify(s.drill));
    assert(dayCount(s.days[TODAY], 'c') === 1, "today's card count is 1: " + JSON.stringify(s.days[TODAY]));
    assert(dayCount(s.game, 'xp') === 5, 'five xp for the right answer: ' + dayCount(s.game, 'xp'));
    assert(await page.isVisible('.gm-opt.right'), 'the right option is marked');
    await page.keyboard.press('Enter');
    await nextQuestion(page);
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
      await page.waitForSelector('.gm-opt.right');
      await page.keyboard.press('Enter');
      await nextQuestion(page);
    }
    s = await store(page);
    assert(!(s.game.towns && s.game.towns['1.1']), 'one right of six does not clear the trial');
    assert(Object.keys(s.drill).length === 6 && Object.keys(s.drill).filter(k => s.drill[k].ok === false).length === 5, 'six records, five misses: the drill will deal them again');
    assert(/Not this time/.test(await page.textContent('.gm-screen')), 'and the town says so');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 2b. the rest of the town: its people teach a technique once, the shop spends gold, the inn beds you down */
  await group('the townsfolk teach, the shop sells and the inn rests you', async () => {
    // ninety gold: enough for the Lens, never enough for a Cheat Sheet. The trial
    // is cleared so the dungeon can open, which is where the inn's wound comes from.
    const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, towns: { '1.1': 1 }, gold: { e: { seed: 90 } } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
    const menu = page.locator('.gm-body > .gm-col').first();     // the town's own menu; the right column is what it opens
    const line = (/** @type {string} */ what) => menu.locator('button:has-text("' + what + '")').textContent();
    assert(/4 people · 3 new/.test(await line('Talk')), 'Portmouth has four people, three with something to teach: ' + await line('Talk'));
    assert(/90g held/.test(await line('Shop')), 'and the shop line counts the gold you walked in with: ' + await line('Shop'));

    await menu.locator('button:has-text("Talk")').click();
    await page.waitForSelector('.gm-scene[data-scene="talk"]');
    const people = page.locator('.gm-body > .gm-col').nth(1).locator('.gm-menu button');
    assert((await people.count()) === 4, 'four people to talk to: ' + (await people.count()));
    assert(/teaches kubectl get endpointslices/.test(await people.first().textContent()), 'and the first names what she teaches: ' + (await people.first().textContent()));

    await people.first().click();
    await page.waitForSelector('.teach');
    let taught = await page.textContent('.teach');
    assert(/^Learned: kubectl get endpointslices/.test(taught), 'she teaches it: ' + taught.slice(0, 60));
    let s = await store(page);
    assert(s.game.learned && s.game.learned['k-endpoints'] === 1, 'the technique is learned: ' + JSON.stringify(s.game.learned));
    assert(dayCount(s.game, 'xp') === 5, 'five xp for learning it: ' + dayCount(s.game, 'xp'));
    assert(/4 people · 2 new/.test(await line('Talk')), 'and the menu counts one fewer left to learn: ' + await line('Talk'));

    // a second visit teaches nothing twice
    await page.click('.gm-acts button:has-text("Others")');
    await page.locator('.gm-body > .gm-col').nth(1).locator('.gm-menu button').first().click();
    await page.waitForSelector('.teach');
    taught = await page.textContent('.teach');
    s = await store(page);
    assert(/^You know this one: kubectl get endpointslices/.test(taught) && dayCount(s.game, 'xp') === 5,
      'a second visit only reminds you, for no xp: ' + taught.slice(0, 40) + ', ' + dayCount(s.game, 'xp') + ' xp');

    // the shop: what you can afford is buyable, what you cannot is not
    await menu.locator('button:has-text("Shop")').click();
    await page.waitForSelector('.gm-scene[data-scene="shop"]');
    const lens = () => page.locator('.gm-item:has-text("Lens")').first();
    assert(!(await lens().isDisabled()) && (await page.locator('.gm-item:has-text("Cheat Sheet: kubectl")').isDisabled()),
      'the Lens at 60g is buyable on 90 gold; the Cheat Sheet at 120g is not');
    await lens().click();
    await page.waitForSelector('.gm-note.ok');
    s = await store(page);
    assert(/Bought Lens/.test(await page.textContent('.gm-note.ok')), 'buying it says so: ' + await page.textContent('.gm-note.ok'));
    assert(dayCount(s.game.items.lens, 'g') === 1 && dayCount(s.game.gold, 's') === 60,
      'one Lens in the pack, sixty gold spent: ' + JSON.stringify({ items: s.game.items, gold: s.game.gold }));
    assert(/30g held/.test(await line('Shop')), 'and the menu counts what is left: ' + await line('Shop'));
    assert(await lens().isDisabled(), 'the Lens is out of reach at thirty gold');
    assert(!(await page.locator('.gm-item:has-text("Hint Scroll")').isDisabled()), 'a thirty-gold scroll is still exactly affordable');

    // the inn heals, so first take a wound: a turn in the dungeon that surfaces
    // nothing, then back up the stairs. Resting on full health would prove nothing.
    assert(/you are rested/.test(await line('Inn')), 'the inn has nothing to offer a full health bar: ' + await line('Inn'));
    await menu.locator('button:has-text("Dungeon")').click();
    await page.waitForSelector('.gm-term input');
    await type(page, 'kubectl get nodes');            // nothing this fault answers to: the enemy strikes
    const hurt = await page.textContent('.gm-term pre');
    assert(/Hollow Beacon strikes for 2\. Health 22 of 24\./.test(hurt), 'the fault bites: ' + (hurt.split('\n').filter(l => /strikes/.test(l))[0] || hurt.slice(-60)));
    await page.click('.gm-acts button:has-text("Flee")');
    await page.waitForSelector('.gm-scene[data-scene="square"]');
    assert(/rest, heal/.test(await line('Inn')), 'and the inn has something to offer now: ' + await line('Inn'));
    await menu.locator('button:has-text("Inn")').click();
    await page.waitForSelector('.gm-scene[data-scene="inn"]');
    assert(/You sleep\. The pager stays quiet\. Health restored to 24\./.test(await page.textContent('.gm-screen')),
      'the inn heals you back to a level-one full: ' + (await page.textContent('.gm-note')));
    assert(/you are rested/.test(await line('Inn')), 'and the menu agrees: ' + await line('Inn'));

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /** @type {HTMLElement} */ (document.querySelector('.gm-screen')).hidden, null, { timeout: 5000 });
    assert((await page.evaluate(() => window.CNPE_GAME.debug().x)) === 8, 'esc walks you back out onto the map');
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
    await afterTurn(page, () => page.click('.gm-sub .gm-menu button:has-text("Hint Scroll")'));
    assert(/The scroll reads/.test(await term(page)), 'the scroll speaks in the terminal');
    let s = await store(page);
    assert(dayCount(s.game.items.scroll, 'u') === 1, 'and one scroll is used: ' + JSON.stringify(s.game.items.scroll));
    // menu pick: Inspect, kubectl get, pods -> evidence at the menu rate
    await page.click('.gm-acts button:has-text("Inspect")');
    await page.click('.gm-sub .gm-menu button:has-text("kubectl get")');
    await page.waitForSelector('.gm-sub .hd:has-text("which one?")');
    await afterTurn(page, () => page.click('.gm-sub .gm-menu button:has-text("pods")'));
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
    const canvases = await page.evaluate(() => ({ stages: document.querySelectorAll('#game-app .gm-stage').length, maps: document.querySelectorAll('#game-app .gm-stage > canvas').length }));
    assert(canvases.stages === 1 && canvases.maps === 1, 'leaving and coming back mounts one stage and one map canvas, not two: ' + JSON.stringify(canvases));
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
      await page.evaluate(() => window.CNPE_GAME.debug().frame());   // the viewport settled; paint it now
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
      const r0 = await page.evaluate(() => window.CNPE_GAME.debug().terrainRenders);
      await page.evaluate(t => window.CNPE_THEME.set(t), theme === 'dark' ? 'light' : 'dark');
      await page.waitForFunction(n => window.CNPE_GAME.debug().terrainRenders > n, r0, { timeout: 3000 });
      const after = await water(page);
      assert(after !== seen[theme], theme + ': switching the theme repaints the sea: ' + seen[theme] + ' -> ' + after);
      assert(page.errors.length === 0, theme + ': no console errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
    assert(seen.dark !== seen.light, 'and the two themes paint it differently');
  });

  /* 8. the renderer: the whole map is cached offscreen, the canvas backing is whole device pixels, the theme and the landmarks repaint the cache */
  await group('the terrain is cached once and repainted when the palette or a door changes', async () => {
    const { ctx, page } = await fresh(null, { theme: 'dark', dpr: 2 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    const art = await page.evaluate(() => window.CNPE_ART.check());
    assert(art.length === 0, 'every sprite grid is the size it claims' + (art.length ? ': ' + art.join(', ') : ''));
    const d = await page.evaluate(() => { const x = window.CNPE_GAME.debug(); return { terrain: x.terrain, terrainRenders: x.terrainRenders, frames: x.frames, scale: x.scale, dpr: x.dpr }; });
    const map = await page.evaluate(() => ({ w: window.CNPE_GAME_DATA.map[0].length * 16, h: window.CNPE_GAME_DATA.map.length * 16 }));
    assert(!!d.terrain && d.terrain.w === map.w && d.terrain.h === map.h, 'the offscreen terrain holds the whole map: ' + JSON.stringify(d.terrain));
    assert(d.terrainRenders === 1 && d.frames >= 1, 'painted once at load, and frames drawn from it: ' + JSON.stringify(d));
    const backing = await page.evaluate(() => { const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-stage canvas')); return { w: c.width, h: c.height }; });
    assert(d.dpr === 2 && d.scale >= 2 && backing.w === 480 * d.scale && backing.h === 304 * d.scale, 'the backing store is a whole number of device pixels per art pixel: ' + JSON.stringify({ scale: d.scale, backing }));
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(n => window.CNPE_GAME.debug().frames > n, d.frames, { timeout: 3000 }).catch(() => {});
    const walked = await page.evaluate(() => { const x = window.CNPE_GAME.debug(); return { frames: x.frames, terrainRenders: x.terrainRenders }; });
    assert(walked.frames > d.frames && walked.terrainRenders === 1, 'walking paints frames from the cache rather than repainting it: ' + JSON.stringify(walked));
    const ms0 = await page.evaluate(() => window.CNPE_GAME.debug().terrainMs);
    await page.evaluate(() => window.CNPE_THEME.set('light'));
    await page.waitForFunction(() => window.CNPE_GAME.debug().terrainRenders === 2, null, { timeout: 3000 }).catch(() => {});
    const themed = await page.evaluate(() => { const x = window.CNPE_GAME.debug(); return { renders: x.terrainRenders, patches: x.terrainPatches, ms: x.terrainMs }; });
    assert(themed.renders === 2 && themed.patches === 0, 'the theme switch repaints the whole terrain cache: ' + JSON.stringify(themed));
    const themeMs = themed.ms - ms0;
    // a door opening is a patch: one tile repainted, the cache kept
    await page.evaluate(() => { const s = window.CNPE_PROGRESS.get(); s.game.towns = { '1.1': 1 }; window.CNPE_PROGRESS.save(); });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.CNPE_GAME.debug().terrainPatches === 1, null, { timeout: 3000 }).catch(() => {});
    const door = await page.evaluate(() => { const x = window.CNPE_GAME.debug(); return { renders: x.terrainRenders, patches: x.terrainPatches, tiles: x.tilesRepainted, patchMs: x.patchMs, ms: x.terrainMs }; });
    assert(door.renders === 2 && door.patches === 1 && door.tiles === 1, 'a door opening repaints that one tile and nothing else: ' + JSON.stringify(door));
    assert(door.patchMs >= 0 && door.patchMs < themeMs / 4 && Math.abs((door.ms - themed.ms) - door.patchMs) < 0.5,
      'and costs a fraction of a full render, counted into terrainMs: patch ' + door.patchMs.toFixed(2) + ' ms against ' + themeMs.toFixed(1) + ' ms for the theme');
    // the patched tile is the open door: the map now shows the open sprite at the door's place
    await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
    const v = await view(page);
    const patched = await page.evaluate(({ v, door }) => {
      const open = window.CNPE_ART.door(1, true).getContext('2d').getImageData(8, 8, 1, 1).data;
      window.CNPE_GAME.debug().frame();
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-stage canvas'));
      const px = ((door.x - v.cx) * 16 + 8) * v.scale, py = ((door.y - v.cy) * 16 + 8) * v.scale;
      const p = c.getContext('2d').getImageData(px, py, 1, 1).data;
      return { at: [v.x, v.y], open: open[0] + ',' + open[1] + ',' + open[2], seen: p[0] + ',' + p[1] + ',' + p[2] };
    }, { v, door: DOOR });
    assert(patched.open === patched.seen, 'and the map shows the open door there: ' + JSON.stringify(patched));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 8b. a step is a tween: the sprite slides over STEP_MS and lands on the exact tile; reduced motion steps at once */
  await group('a step tweens to the exact tile, and reduced motion skips the tween', async () => {
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion: ' : 'motion: ';
      const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, pos: { x: 8, y: 8, t: 1 } } }, { reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.goto(url('game.html'));
      await page.waitForSelector('.gm-stage canvas');
      await skipIntro(page);
      // paint, then read: offset, sub and walkFrame are the last frame's, and a starved animation frame must not stand in for one
      const at = () => page.evaluate(() => { window.CNPE_GAME.debug().frame(); const d = window.CNPE_GAME.debug(); return { x: d.x, y: d.y, walking: d.walking, off: d.offset, sub: d.sub, queued: d.queued, walk: d.walkFrame, face: d.face }; });
      const before = await at();
      assert(before.x === 8 && before.y === 8 && !before.walking, tag + 'standing on the start tile: ' + JSON.stringify(before));
      // press, paint and read in the same task: the tile has changed, the sprite has not arrived
      const mid = await page.evaluate(() => {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        window.CNPE_GAME.debug().frame();
        const d = window.CNPE_GAME.debug();
        return { x: d.x, y: d.y, walking: d.walking, off: d.offset, sub: d.sub, face: d.face };
      });
      if (reduced) {
        assert(mid.x === 9 && !mid.walking && mid.off.x === 0 && mid.off.y === 0 && mid.sub === -1 && mid.face === 'r', tag + 'the step is instant: ' + JSON.stringify(mid));
      } else {
        assert(mid.x === 9 && mid.y === 8 && mid.walking && mid.off.x === -16 && mid.off.y === 0 && mid.sub === 0, tag + 'the tile is taken at once and the sprite starts a tile behind it: ' + JSON.stringify(mid));
        await page.waitForTimeout(50);
        const part = await at();
        assert(part.walking && part.off.x < 0 && part.off.x > -16 && part.off.x % 1 === 0, tag + 'part way, the offset is whole pixels between the tiles: ' + JSON.stringify(part));
        // this pins the table's contents from outside; that each sub-position falls where it should in time is 8b1's, under a driven clock
        assert(part.sub >= 0 && part.sub <= 4 && part.walk === [1, 1, 3, 2, 2][part.sub], tag + 'the walk cycle is keyed to the sub-position: a stride\'s half, the pass, the other half: ' + JSON.stringify(part));
        await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
        const done = await at();
        assert(done.x === 9 && done.y === 8 && !done.walking && done.off.x === 0 && done.off.y === 0 && done.walk === 0 && done.sub === -1, tag + 'the tween ends on the exact tile, standing: ' + JSON.stringify(done));
        // the walk cycle's frames: standing, the two halves of a stride and the pass, four a facing and all different
        const frames = await page.evaluate(() => {
          const A = window.CNPE_ART, url = (/** @type {number} */ f) => A.hero('r', f).toDataURL();
          return { distinct: new Set([url(0), url(1), url(2), url(3)]).size, wraps: url(4) === url(0) && url(-1) === url(3), check: A.check() };
        });
        assert(frames.distinct === 4 && frames.wraps && frames.check.length === 0, tag + 'the hero has four distinct frames a facing, and the index wraps: ' + JSON.stringify(frames));
        // a step asked for in flight waits and lands on the next tile, never skipping one
        const two = await page.evaluate(() => {
          const press = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          press(); press(); press();
          const d = window.CNPE_GAME.debug();
          return { x: d.x, walking: d.walking, queued: d.queued };
        });
        assert(two.x === 10 && two.walking && two.queued, tag + 'three presses in one tween: one step taken, one queued: ' + JSON.stringify(two));
        await page.waitForFunction(() => { const d = window.CNPE_GAME.debug(); return !d.walking && !d.queued; }, null, { timeout: 2000 }).catch(() => {});
        const landed = await at();
        assert(landed.x === 11 && !landed.walking && !landed.queued, tag + 'and the queued step lands one tile on, and no further: ' + JSON.stringify(landed));
        const label = await page.getAttribute('.gm-stage canvas', 'aria-label');
        assert(/You stand on grass/.test(label || ''), tag + 'the canvas describes the tile landed on: ' + label);
      }
      assert(page.errors.length === 0, tag + 'no console errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
  });

  /* 8b1. the step under a driven clock, so every sub-position is read at its middle: the walk cycle over the five
     (stride, pass, stride, landing standing), and the sprite and the camera sliding through whole pixels rounded
     on every frame, a pixel or two at a time, rather than in five jumps of a fifth of a tile. From (60, 40) the
     camera is unclamped, so it has to move with the step. */
  await group('a step walks stride, pass, stride, and the camera slides a pixel or two a frame', async () => {
    const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, pos: { x: 60, y: 40, t: 1 } } }, { clockAt: new Date() });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    /** paint now, then read the step: the clock is paused, so a press and a read see the same instant */
    const read = () => page.evaluate(() => { window.CNPE_GAME.debug().frame(); const d = window.CNPE_GAME.debug(); return { x: d.x, sub: d.sub, walk: d.walkFrame, off: d.offset.x, cam: d.camera.x, walking: d.walking }; });
    const press = () => page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    const c0 = (await read()).cam;
    await press();
    const seq = [await read()];
    for (let i = 0; i < 6; i++) { await page.clock.runFor(i ? 24 : 12); seq.push(await read()); }   // 12, 36, 60, 84, 108 ms: the middle of each sub-position; then 132, past the landing
    const subs = seq.map(s => s.sub), walks = seq.map(s => s.walk), offs = seq.map(s => s.off), cams = seq.map(s => s.cam);
    assert(subs.join() === '0,0,1,2,3,4,-1' && walks.join() === '1,1,1,3,2,2,0' && seq[6].x === 61 && !seq[6].walking,
      'the walk cycle over the sub-positions: a stride\'s half through two, the pass through one, the other half through two, standing on the tile: ' + JSON.stringify({ subs, walks }));
    assert(offs.join() === '-16,-14,-11,-8,-5,-2,0', 'the sprite\'s offset is rounded to whole pixels for the frame, not to a fifth of a tile: ' + offs.join());
    // the step is from (60, 40) to (61, 40), so the camera goes a tile east of c0, sharing the sprite's offset on the way
    assert(c0 === 720 && cams.every((c, i) => c === c0 + 16 + offs[i]), 'and the camera is the sprite\'s: it slides with it and lands on the exact camera a tile on: ' + JSON.stringify({ c0, cams }));
    // sampled every 8 ms across the next step, the camera never jumps: a pixel or two at a time, forward only
    await press();
    /** @type {number[]} */
    const path = [(await read()).cam];
    for (let t = 8; t <= 128; t += 8) { await page.clock.runFor(8); path.push((await read()).cam); }
    const deltas = path.slice(1).map((c, i) => c - path[i]);
    assert(deltas.every(d => d >= 0 && d <= 2) && new Set(path).size >= 12 && path[0] === c0 + 16 && path[path.length - 1] === c0 + 32,
      'the camera advances a pixel or two every 8 ms and ends another tile on: ' + path.join());
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 8b2. the camera: coming back to the map it eases from where it last stood to the player, through whole
     pixels, ending on the exact clamped camera; not when it already stands there, never through a step, and
     not at all under reduced motion. The bundle's route is the way back that can find the player elsewhere:
     the quest unmounts for another page and the position moves meanwhile (a sync from another device). */
  await group('the camera eases back to the player, snaps under reduced motion, and never eases through a step', async () => {
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion: ' : 'motion: ';
      const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, pos: { x: 8, y: 8, t: 1 } } }, { reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.goto(url('console.html') + '#GM');
      await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
      await skipIntro(page);
      const cam = () => page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { x: d.x, y: d.y, camera: d.camera, ease: d.cameraEase, walking: d.walking, frames: d.frames }; });
      /** the camera the engine must end on for the player's tile */
      const clamped = (/** @type {number} */ x, /** @type {number} */ y) => page.evaluate(({ x, y }) => { const m = window.CNPE_GAME_DATA.map; return { x: Math.max(0, Math.min((m[0].length - 30) * 16, (x - 15) * 16)), y: Math.max(0, Math.min((m.length - 19) * 16, (y - 9) * 16)) }; }, { x, y });
      const c0 = await cam();
      assert(!!c0.camera && c0.camera.x === 0 && c0.camera.y === 0 && !c0.ease, tag + 'the first frame stands the camera on the map\'s corner with no ease (nowhere to come from): ' + JSON.stringify(c0));
      // a town and back: the camera is already on the player, so no ease runs and the frame is exact
      await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
      await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
      const back = await page.evaluate(() => {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        window.CNPE_GAME.debug().frame();
        const d = window.CNPE_GAME.debug();
        return { hidden: /** @type {HTMLElement} */ (document.querySelector('.gm-screen')).hidden, x: d.x, y: d.y, camera: d.camera, ease: d.cameraEase };
      });
      assert(back.hidden && back.x === 8 && back.y === 6 && !back.ease && back.camera.x === 0 && back.camera.y === 0, tag + 'leaving the town where the camera already stood: no ease, the exact camera: ' + JSON.stringify(back));
      // into the town again, away to another page, moved meanwhile, and back: the camera has a way to go
      await page.keyboard.press('Enter');
      await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
      await page.evaluate(() => { location.hash = '#DR'; });
      await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
      await page.evaluate(() => { const s = window.CNPE_PROGRESS.get(); s.game.pos = { x: 60, y: 40, t: Date.now() }; window.CNPE_PROGRESS.save(); });
      // the router mounts on hashchange; a listener added after it reads the first frame in the same task
      const arrive = await page.evaluate(() => new Promise(res => {
        addEventListener('hashchange', () => { const d = window.CNPE_GAME.debug(); res({ x: d.x, y: d.y, camera: d.camera, ease: d.cameraEase, frames: d.frames, mounted: d.mounted }); }, { once: true });
        location.hash = '#GM';
      }));
      const target = await clamped(60, 40);
      if (reduced) {
        assert(arrive.mounted && arrive.x === 60 && arrive.y === 40 && !arrive.ease && arrive.camera.x === target.x && arrive.camera.y === target.y,
          tag + 'the first frame back is the exact clamped camera, no ease: ' + JSON.stringify({ arrive, target }));
      } else {
        assert(arrive.mounted && arrive.x === 60 && arrive.y === 40 && arrive.ease && arrive.camera.x === 0 && arrive.camera.y === 0,
          tag + 'the first frame back starts from where the camera last stood, the ease in flight: ' + JSON.stringify({ arrive, target }));
        // whole pixels on the way, each frame no further back than the last, then the exact camera
        /** @type {{ x: number, y: number }[]} */
        const path = [];
        for (let i = 0; i < 60; i++) {
          const c = await page.evaluate(() => { window.CNPE_GAME.debug().frame(); const d = window.CNPE_GAME.debug(); return { camera: d.camera, ease: d.cameraEase }; });
          path.push(c.camera);
          if (!c.ease) break;
          await page.waitForTimeout(20);
        }
        const whole = path.every(c => Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.x <= target.x && c.y >= 0 && c.y <= target.y);
        const forward = path.every((c, i) => !i || (c.x >= path[i - 1].x && c.y >= path[i - 1].y));
        const end = path[path.length - 1];
        assert(whole && forward && path.length >= 2, tag + 'the camera moves through whole pixels, forward only, over more than one frame: ' + JSON.stringify(path.slice(0, 6)) + (path.length > 6 ? ' ... ' + path.length + ' frames' : ''));
        assert(end.x === target.x && end.y === target.y && !(await cam()).ease, tag + 'and the ease ends on the exact clamped camera: ' + JSON.stringify({ end, target }));
        // never through a step: a step taken while the camera is on its way cuts the ease, and the step's own camera takes over
        await page.evaluate(() => { location.hash = '#DR'; });
        await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
        await page.evaluate(() => { const s = window.CNPE_PROGRESS.get(); s.game.pos = { x: 8, y: 8, t: Date.now() }; window.CNPE_PROGRESS.save(); });
        const cut = await page.evaluate(() => new Promise(res => {
          addEventListener('hashchange', () => {
            const before = window.CNPE_GAME.debug().cameraEase;
            /** @type {HTMLElement} */ (document.querySelector('.gm-stage')).focus();
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
            window.CNPE_GAME.debug().frame();
            const d = window.CNPE_GAME.debug();
            res({ before, ease: d.cameraEase, walking: d.walking, x: d.x, camera: d.camera });
          }, { once: true });
          location.hash = '#GM';
        }));
        assert(cut.before && !cut.ease && cut.walking && cut.x === 9 && cut.camera.x === 0 && cut.camera.y === 0, tag + 'a step pressed during the ease ends it at once, and the camera is the step\'s: ' + JSON.stringify(cut));
        await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
      }
      assert(page.errors.length === 0, tag + 'no console errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
  });

  /* 8c. the living world: the beat moves more than the water, only what is in view, and the frames are sound */
  await group('the flowers, the smoke and the torches move on the beat, and only in view', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    const frames = await page.evaluate(() => {
      const A = window.CNPE_ART, same = (/** @type {HTMLCanvasElement} */ a, /** @type {HTMLCanvasElement} */ b) => a.toDataURL() === b.toDataURL();
      return { frames: A.FRAMES,
        flower: [same(A.flower(0, 1, 0), A.flower(0, 1, 1)), same(A.flower(0, 1, 1), A.flower(0, 1, 2)), same(A.flower(1, 1, 0), A.flower(1, 1, 2))],
        puff: [same(A.ambient('puff', 0), A.ambient('puff', 1)), same(A.ambient('puff', 1), A.ambient('puff', 2))],
        torch: [same(A.ambient('torch', 0), A.ambient('torch', 1)), same(A.ambient('torch', 1), A.ambient('torch', 2))],
        transparent: (() => { const d = A.ambient('puff', 1).getContext('2d').getImageData(0, 0, 16, 16).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })() };
    });
    assert(frames.frames === 3 && frames.flower.every(x => !x) && frames.puff.every(x => !x) && frames.torch.every(x => !x), 'each has three frames, all different: ' + JSON.stringify(frames));
    assert(frames.transparent > 0 && frames.transparent < 40, 'an overlay paints a few pixels over a transparent tile: ' + frames.transparent);
    const d0 = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { water: d.waterInView, ambient: d.ambientInView, anim: d.anim }; });
    assert(d0.ambient > 0 && d0.anim, 'from the road by Portmouth, animated tiles are in view (the town, its open door, flowers): ' + JSON.stringify(d0));
    // the door's torches: over the beat, the flame colour shows on the open door's post. The beat is
    // driven by hand, three ticks and three paints in one task, so the ticker cannot slip a frame in between
    const v = await view(page);
    /** @type {{ warn: string, seen: string[], before: number, after: number }} */
    const torch = await page.evaluate(({ v, door }) => {
      const A = window.CNPE_ART, warn = A.ambient('torch', 0).getContext('2d').getImageData(3, 0, 1, 1).data;
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-stage canvas')), k = c.getContext('2d');
      const before = window.CNPE_GAME.debug().waterFrame;
      /** @type {string[]} */
      const seen = [];
      for (let i = 0; i < 3; i++) {
        window.CNPE_GAME.debug().tick(); window.CNPE_GAME.debug().frame();
        // the flame is at pixel (3, 0) of the open door's tile
        const p = k.getImageData(((door.x - v.cx) * 16 + 3) * v.scale, ((door.y - v.cy) * 16 + 0) * v.scale, 1, 1).data;
        seen.push(p[0] + ',' + p[1] + ',' + p[2] + ':' + window.CNPE_GAME.debug().waterFrame);
      }
      return { warn: warn[0] + ',' + warn[1] + ',' + warn[2], seen, before, after: window.CNPE_GAME.debug().waterFrame };
    }, { v, door: DOOR });
    assert(torch.seen.some(x => x.indexOf(torch.warn + ':') === 0), 'the torch flame is painted over the open door in the flame colour: ' + JSON.stringify(torch));
    assert(new Set(torch.seen.map(x => x.split(':')[1])).size === 3 && torch.after === torch.before, 'across the three frames of the beat, three ticks coming back round: ' + JSON.stringify(torch.seen));
    assert((await page.evaluate(() => window.CNPE_GAME.debug().anim)) === true, 'and tick() left the ticker running');
    // only what is in view is counted: the same count as a walk over the map's rows inside the viewport, here and by the Exam gate
    const inView = () => page.evaluate(() => {
      const d = window.CNPE_GAME.debug(), D = window.CNPE_GAME_DATA, m = D.map, W = m[0].length, H = m.length;
      const cx = Math.max(0, Math.min(W - 30, d.x - 15)), cy = Math.max(0, Math.min(H - 19, d.y - 9));
      const s = window.CNPE_PROGRESS.get(), towns = (s.game && s.game.towns) || {};
      let water = 0, ambient = 0;
      for (let y = cy; y < cy + 19; y++) for (let x = cx; x < cx + 30; x++) {
        const t = D.tiles[m[y][x]];
        if (t === 'water') water++;
        else if (t === 'flower' || t === 'town') ambient++;
        else if (t === 'door') { const tw = D.towns.find(o => o.door.x === x && o.door.y === y); if (tw && towns[tw.sec]) ambient++; }
      }
      window.CNPE_GAME.debug().frame();
      const e = window.CNPE_GAME.debug();
      return { at: [d.x, d.y], expect: { water, ambient }, got: { water: e.waterInView, ambient: e.ambientInView } };
    });
    const here = await inView();
    assert(here.got.water === here.expect.water && here.got.ambient === here.expect.ambient, 'the counts are the tiles inside the viewport, no more: ' + JSON.stringify(here));
    const gate = await page.evaluate(() => window.CNPE_GAME_DATA.finale.keep);
    await standAt(page, gate.x, gate.y - 1);
    const far = await inView();
    assert(far.got.water === far.expect.water && far.got.ambient === far.expect.ambient && far.at.join() !== here.at.join(), 'and by the Exam gate too: ' + JSON.stringify(far));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 8c2. a paint is one blit: the terrain and the frame's water, flowers, smoke and torches are composed once
     per frame of the beat and per tile the camera stands in, and every paint after that reads what is held */
  await group('a frame blits the composition rather than the tiles under it', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    // one turn of the beat brings all three compositions into being; four more turns read them back. The beat
    // is driven by hand, in one task, so the ticker cannot slip a frame in between and compose behind the count
    const cycle = await page.evaluate(() => {
      const g = () => window.CNPE_GAME.debug();
      g().frame();
      for (let i = 0; i < 3; i++) { g().tick(); g().frame(); }
      const a = g(), warm = { composes: a.composes, blits: a.tileBlits, frames: a.frames };
      for (let i = 0; i < 12; i++) { g().tick(); g().frame(); }
      const b = g();
      return { warm, after: { composes: b.composes, blits: b.tileBlits, frames: b.frames },
        water: b.waterInView, ambient: b.ambientInView, beat: window.CNPE_ART.FRAMES };
    });
    assert(cycle.water > 0 && cycle.ambient > 0, 'the camera is over water and over what else moves: ' + JSON.stringify({ water: cycle.water, ambient: cycle.ambient }));
    assert(cycle.warm.composes <= cycle.beat && cycle.warm.blits >= cycle.water,
      'a still camera composes one canvas per frame of the beat and no more, each of them blitting what moves in view once: ' + JSON.stringify(cycle.warm));
    assert(cycle.after.frames - cycle.warm.frames === 12, 'twelve more frames are painted: ' + JSON.stringify(cycle.after));
    assert(cycle.after.composes === cycle.warm.composes && cycle.after.blits === cycle.warm.blits,
      'and not one of them composes or blits a tile: ' + JSON.stringify(cycle));
    // a step is many frames and at most one composition: the camera crossing a tile is what composes, not the
    // frames of its tween. Six steps in the open, where the map's edge does not clamp the camera
    const spot = await page.evaluate(() => {
      const D = window.CNPE_GAME_DATA, m = D.map, W = m[0].length, H = m.length;
      /** @type {Record<string, number>} */
      const walk = { grass: 1, road: 1, sand: 1, flower: 1 };
      const open = (/** @type {number} */ x, /** @type {number} */ y) => !!walk[D.tiles[m[y][x]]];
      for (let y = 24; y < H - 24; y++) for (let x = 24; x < W - 32; x++) {
        let n = 0;
        while (n < 8 && open(x + n, y)) n++;
        if (n === 8) return { x: x, y: y };
      }
      return null;
    });
    assert(!!spot, 'the map has a run of open tiles away from its edges to walk: ' + JSON.stringify(spot));
    await standAt(page, spot.x, spot.y);
    const from = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); d.frame(); const e = window.CNPE_GAME.debug(); return { composes: e.composes, frames: e.frames, x: e.x, cam: e.camera.x }; });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 3000 }).catch(() => {});
    }
    const to = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); d.frame(); const e = window.CNPE_GAME.debug(); return { composes: e.composes, frames: e.frames, x: e.x, cam: e.camera.x }; });
    const walked = { steps: to.x - from.x, tiles: (to.cam - from.cam) / 16, frames: to.frames - from.frames, composes: to.composes - from.composes };
    assert(walked.steps === 6 && walked.tiles === 6, 'six steps east, the camera over six tiles with them: ' + JSON.stringify(walked));
    assert(walked.frames >= 12, 'the tween paints several frames a step: ' + JSON.stringify(walked));
    assert(walked.composes <= walked.tiles + 3, 'and composes at most once a tile crossed, whatever the beat did meanwhile: ' + JSON.stringify(walked));
    // a repaint of the terrain drops all three: the next turn of the beat composes them again, over the new palette
    const r0 = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { renders: d.terrainRenders, composes: d.composes }; });
    await page.evaluate(() => window.CNPE_THEME.set('light'));
    await page.waitForFunction(n => window.CNPE_GAME.debug().terrainRenders > n, r0.renders, { timeout: 3000 });
    const themed = await page.evaluate(() => {
      const g = () => window.CNPE_GAME.debug();
      for (let i = 0; i < 3; i++) { g().tick(); g().frame(); }
      return g().composes;
    });
    assert(themed - r0.composes === 3, 'a theme switch drops all three compositions and the beat builds them again: ' + JSON.stringify({ before: r0.composes, after: themed }));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 8d. the minimap: built from the terrain once, tinted per region, the towns cleared in green, the player a dot
     that blinks, a frame around the tiles in view, and a backing store scaled for the screen behind a 120x80 box */
  await group('the minimap is built from the terrain, only its dot and frame move, and it is sharp on HiDPI', async () => {
    // Portmouth's dungeon is won too, or the signpost would ring its door at (11, 6) over the tiles read around the dot
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, wins: { 'svc-selector': { n: 1, best: 5, t: 1 } }, flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } }, { dpr: 2 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    const m0 = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')); const r = c.getBoundingClientRect();
      return { minimap: d.minimap, builds: d.minimapBuilds, frames: d.frames, dpr: d.dpr, backing: { w: c.width, h: c.height }, box: { w: r.width, h: r.height }, rendering: getComputedStyle(c).imageRendering }; });
    const map = await page.evaluate(() => ({ w: window.CNPE_GAME_DATA.map[0].length, h: window.CNPE_GAME_DATA.map.length }));
    const S = m0.minimap ? m0.minimap.scale : 0;
    assert(!!m0.minimap && m0.dpr === 2 && S === 2 && m0.minimap.w === map.w * S && m0.minimap.h === map.h * S && m0.backing.w === map.w * S && m0.backing.h === map.h * S,
      'the backing store is the map times a whole scale chosen for dpr 2: ' + JSON.stringify(m0) + ' for a ' + map.w + 'x' + map.h + ' map');
    // the stylesheet asks for pixelated and then crisp-edges; a browser reports whichever of the two it took
    assert(m0.box.w === 120 && m0.box.h === 80 && /^(pixelated|crisp-edges)$/.test(m0.rendering), 'behind a 120 by 80 CSS box, painted sharp: ' + JSON.stringify({ box: m0.box, rendering: m0.rendering }));
    // the box's width is the stylesheet's custom property and its height follows the map's aspect, a pixel a tile
    const prop = await page.evaluate(() => getComputedStyle(document.querySelector('.gm-mini')).getPropertyValue('--gm-mini-w').trim());
    assert(prop === m0.box.w + 'px' && parseFloat(prop) === map.w && m0.box.h === map.h, 'the box is --gm-mini-w wide and the map\'s aspect tall, a pixel a tile of the ' + map.w + 'x' + map.h + ' map: ' + JSON.stringify({ prop, box: m0.box }));
    assert(m0.builds === 1 && m0.frames > 1, 'built once with the terrain, while frames keep coming: ' + JSON.stringify(m0));
    // a minimap pixel is a tile: read the tile's top-left device pixel, and check the whole block is one colour
    const px = (/** @type {number} */ x, /** @type {number} */ y) => page.evaluate(({ x, y }) => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), s = window.CNPE_GAME.debug().minimap.scale;
      const d = c.getContext('2d').getImageData(x * s, y * s, s, s).data, first = d[0] + ',' + d[1] + ',' + d[2];
      for (let i = 4; i < d.length; i += 4) if (d[i] + ',' + d[i + 1] + ',' + d[i + 2] !== first) return 'mixed:' + first;
      return first;
    }, { x, y });
    const colours = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const v = (/** @type {string} */ n) => cs.getPropertyValue(n).trim(); return { ok: v('--ok'), paper: v('--paper'), warn: v('--warn'), ink: v('--ink'), accent: v('--accent') }; });
    const rgb = (/** @type {string} */ hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(','); };
    assert((await px(8, 6)) === rgb(colours.ok), 'Portmouth, cleared, is a green pixel, whole at the backing scale: ' + (await px(8, 6)) + ' for ' + colours.ok);
    const mill = await page.evaluate(() => window.CNPE_GAME_DATA.towns[1]);
    assert((await px(mill.x, mill.y)) === rgb(colours.paper), mill.name + ', not cleared, is a paper pixel: ' + (await px(mill.x, mill.y)));
    assert((await px(1, 1)) !== (await px(60, 40)) && !/mixed/.test(await px(1, 1)), 'the sea and the land differ: ' + (await px(1, 1)) + ' vs ' + (await px(60, 40)));
    const tints = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d'), s = window.CNPE_GAME.debug().minimap.scale;
      const at = (/** @type {number} */ x, /** @type {number} */ y) => { const p = k.getImageData(x * s, y * s, 1, 1).data; return [p[0], p[1], p[2]]; };
      // a meadow tile deep in each region: Substrate Downs (north-west), Warden's March (south-east)
      return { d1: at(20, 12), d5: at(100, 60) };
    });
    assert(tints.d1.join() !== tints.d5.join(), 'two regions are tinted differently: ' + JSON.stringify(tints));
    // the viewport's frame: from (10, 6) the camera is clamped to the map's corner, so the frame is tiles 0..29 by 0..18.
    // The stage has focus (skipIntro leaves it there), so the frame is in the accent, like the stage's border
    const focused = () => page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.gm-stage')).classList.contains('gm-focus'));
    // the focus repaints on the next animation frame: paint now, so the read is of the frame the focus asked for
    await page.evaluate(() => window.CNPE_GAME.debug().frame());
    const v0 = await view(page);
    const frame0 = { focus: await focused(), tl: await px(v0.cx, v0.cy), tr: await px(v0.cx + 29, v0.cy), bl: await px(v0.cx, v0.cy + 18), br: await px(v0.cx + 29, v0.cy + 18), top: await px(v0.cx + 15, v0.cy), left: await px(v0.cx, v0.cy + 9), inside: await px(v0.cx + 1, v0.cy + 1) };
    assert(v0.cx === 0 && v0.cy === 0 && frame0.focus && [frame0.tl, frame0.tr, frame0.bl, frame0.br, frame0.top, frame0.left].every(c => c === rgb(colours.accent)) && frame0.inside !== rgb(colours.accent),
      'a one-pixel frame marks the 30 by 19 tiles in view, hollow inside, in the accent while the stage has focus: ' + JSON.stringify(frame0));
    // the frame follows the stage's border out of the accent and back: paper without focus, as the windows' rules are
    await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement).blur());
    await page.evaluate(() => window.CNPE_GAME.debug().frame());
    const blurred = { focus: await focused(), tl: await px(v0.cx, v0.cy), br: await px(v0.cx + 29, v0.cy + 18), left: await px(v0.cx, v0.cy + 9) };
    assert(!blurred.focus && [blurred.tl, blurred.br, blurred.left].every(c => c === rgb(colours.paper)), 'blurred, the frame is the windows\' paper: ' + JSON.stringify(blurred));
    await page.focus('.gm-stage');
    await page.evaluate(() => window.CNPE_GAME.debug().frame());
    const refocused = { focus: await focused(), tl: await px(v0.cx, v0.cy), br: await px(v0.cx + 29, v0.cy + 18) };
    assert(refocused.focus && refocused.tl === rgb(colours.accent) && refocused.br === rgb(colours.accent), 'focused again, the accent again: ' + JSON.stringify(refocused));
    // the dot blinks on the beat, without rebuilding the map under it: three beats by hand, in one task
    const dot = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d'), s = window.CNPE_GAME.debug().minimap.scale;
      const at = () => { const p = k.getImageData(10 * s, 6 * s, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      window.CNPE_GAME.debug().frame();
      /** @type {Record<string, string>} */
      const seen = {}; seen[window.CNPE_GAME.debug().waterFrame] = at();
      for (let i = 0; i < 2; i++) { window.CNPE_GAME.debug().tick(); window.CNPE_GAME.debug().frame(); seen[window.CNPE_GAME.debug().waterFrame] = at(); }
      return { seen, builds: window.CNPE_GAME.debug().minimapBuilds };
    });
    const onFrames = Object.keys(dot.seen).filter(f => (+f & 1) === 0), offFrames = Object.keys(dot.seen).filter(f => (+f & 1) === 1);
    assert(Object.keys(dot.seen).length === 3 && onFrames.every(f => dot.seen[f] === rgb(colours.warn)) && offFrames.every(f => dot.seen[f] !== rgb(colours.warn)),
      'the dot blinks: warn on the beat\'s even frames, the ground on its odd one: ' + JSON.stringify(dot.seen));
    assert(dot.builds === 1, 'and blinking did not rebuild the minimap: ' + dot.builds);
    // a step moves the dot: the rim's pixel at (11, 6) is lifted and the ground under it shows again, and the dot is at (9, 6)
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
    const moved = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d'), s = window.CNPE_GAME.debug().minimap.scale;
      const at = (/** @type {number} */ x, /** @type {number} */ y) => { const p = k.getImageData(x * s, y * s, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      // paint now and read in the same task, so the blink's phase is known: the dot is on when the beat's frame is even
      window.CNPE_GAME.debug().frame();
      const d = window.CNPE_GAME.debug();
      return { x: d.x, builds: d.minimapBuilds, on: (d.waterFrame & 1) === 0, left: at(11, 6), ground: at(12, 6), centre: at(9, 6), rim: at(10, 6) };
    });
    assert(moved.x === 9 && moved.builds === 1, 'a step moves the dot without a rebuild: ' + JSON.stringify(moved));
    assert(moved.left !== rgb(colours.ink) && moved.left !== rgb(colours.warn), 'the tile the rim left shows the ground again: ' + JSON.stringify(moved));
    if (moved.on) assert(moved.centre === rgb(colours.warn) && moved.rim === rgb(colours.ink), 'the dot stands on the new tile, a warn centre in an ink rim: ' + JSON.stringify(moved));
    else assert(moved.centre !== rgb(colours.warn) && moved.rim !== rgb(colours.ink), 'the dot is between blinks, so the ground shows there too: ' + JSON.stringify(moved));
    // the frame moves with the camera, and the ground comes back where it was: from (60, 40) the camera is unclamped,
    // and a step east slides the frame one tile; the ground colours are read first, from here, where no frame covers them
    const ground = { corner: await px(45, 31), edge: await px(45, 40) };
    await standAt(page, 60, 40);
    await page.evaluate(() => window.CNPE_GAME.debug().frame());   // the focus skipIntro gave the stage has its frame painted
    const v1 = await view(page);
    const frame1 = { at: [v1.cx, v1.cy], focus: await focused(), corner: await px(45, 31), edge: await px(45, 40), right: await px(74, 40), inside: await px(46, 40) };
    assert(v1.cx === 45 && v1.cy === 31 && frame1.focus && frame1.corner === rgb(colours.accent) && frame1.edge === rgb(colours.accent) && frame1.right === rgb(colours.accent) && frame1.inside !== rgb(colours.accent),
      'from (60, 40) the frame stands at tiles 45..74 by 31..49: ' + JSON.stringify(frame1));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
    await page.evaluate(() => window.CNPE_GAME.debug().frame());
    const v2 = await view(page);
    const frame2 = { at: [v2.cx, v2.cy], corner: await px(46, 31), edge: await px(46, 40), right: await px(75, 40), wasCorner: await px(45, 31), wasEdge: await px(45, 40), builds: await page.evaluate(() => window.CNPE_GAME.debug().minimapBuilds) };
    assert(v2.cx === 46 && frame2.corner === rgb(colours.accent) && frame2.edge === rgb(colours.accent) && frame2.right === rgb(colours.accent), 'a step east moves the frame one tile: ' + JSON.stringify(frame2));
    assert(frame2.wasCorner === ground.corner && frame2.wasEdge === ground.edge && frame2.builds === 1, 'and the column it left shows the ground again, with no rebuild: ' + JSON.stringify({ frame2, ground }));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
    // reduced motion: the dot holds still, and a beat asked for by hand is not a beat
    const still = await fresh({ game: { flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } }, { reducedMotion: 'reduce' });
    await still.page.goto(url('game.html'));
    await still.page.waitForSelector('.gm-stage canvas');
    await skipIntro(still.page);
    const steady = await still.page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d'), s = window.CNPE_GAME.debug().minimap.scale;
      const at = () => { const p = k.getImageData(10 * s, 6 * s, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      window.CNPE_GAME.debug().frame();
      const seen = new Set([at()]);
      window.CNPE_GAME.debug().tick(); window.CNPE_GAME.debug().frame(); seen.add(at());
      return { seen: Array.from(seen), waterFrame: window.CNPE_GAME.debug().waterFrame };
    });
    assert(steady.seen.length === 1 && steady.seen[0] === rgb(colours.warn) && steady.waterFrame === 0, 'reduced motion: the dot is on, and tick() moves nothing: ' + JSON.stringify(steady) + ' for ' + colours.warn);
    assert(still.page.errors.length === 0, 'no console errors: ' + still.page.errors.join(' | '));
    await still.ctx.close();
    // the engine reads the width from the stylesheet, not from a constant of its own: on a phone-wide viewport the
    // minimap is hidden and its canvas has no width, so the backing scale can only come from --gm-mini-w. Widen the
    // property to four pixels a tile and remount, and the backing store follows it
    const narrow = await fresh({ game: { flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await narrow.page.setViewportSize({ width: 500, height: 800 });
    await narrow.page.goto(url('game.html'));
    await narrow.page.waitForSelector('.gm-stage canvas');
    await skipIntro(narrow.page);
    const hidden = await narrow.page.evaluate(() => { const d = window.CNPE_GAME.debug(); const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')); return { shown: c.clientWidth, scale: d.minimap && d.minimap.scale, dpr: d.dpr }; });
    assert(hidden.shown === 0 && hidden.scale === Math.max(1, Math.min(4, Math.round(120 * hidden.dpr / map.w))), 'phone-wide, the minimap is hidden and its backing is chosen from the stylesheet\'s 120 px: ' + JSON.stringify(hidden));
    await narrow.page.addStyleTag({ content: '.gm-mini { --gm-mini-w: 480px; }' });
    const wide = await narrow.page.evaluate(() => { window.CNPE_GAME.unmount(); window.CNPE_GAME.mount(); const d = window.CNPE_GAME.debug(); return { scale: d.minimap && d.minimap.scale, w: d.minimap && d.minimap.w, dpr: d.dpr }; });
    assert(wide.scale === Math.max(1, Math.min(4, Math.round(480 * wide.dpr / map.w))) && wide.w === map.w * wide.scale, 'widened to 480 px and remounted, the backing store follows the property: ' + JSON.stringify(wide));
    assert(narrow.page.errors.length === 0, 'no console errors: ' + narrow.page.errors.join(' | '));
    await narrow.ctx.close();
  });

  /* 8d2. the signpost: where next, in the where window, on the minimap and in the label; it moves on as things are done */
  await group('the signpost points to the trial, then the dungeon, then the nearest town left, and rings it on the minimap', async () => {
    /** @param {import('playwright').Page} page */
    const sign = page => page.evaluate(() => { window.CNPE_GAME.debug().frame(); const d = window.CNPE_GAME.debug(); const w = document.querySelector('.gm-where'); return { goal: d.goal, where: w.firstChild ? w.firstChild.textContent : '', nx: (w.querySelector('.nx') || { textContent: '' }).textContent, label: document.querySelector('.gm-stage canvas').getAttribute('aria-label') }; });
    /** the ring's pixels around a tile, and the tile itself, read at the backing scale; with beats, that many beats
        by hand first, each painted and read in this one task, so the beat's phase is known and the live ticker
        cannot slip a frame in between (as the dot's check above does)
        @param {import('playwright').Page} page @param {number} x @param {number} y @param {number} [beats] */
    const ring = (page, x, y, beats) => page.evaluate(({ x, y, beats }) => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d'), s = window.CNPE_GAME.debug().minimap.scale;
      const at = (/** @type {number} */ px, /** @type {number} */ py) => { const p = k.getImageData(px * s, py * s, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      const read = () => { window.CNPE_GAME.debug().frame(); return { tl: at(x - 2, y - 2), br: at(x + 2, y + 2), left: at(x - 2, y), top: at(x, y - 2), inner: at(x - 1, y), centre: at(x, y), below: at(x, y + 2), odd: (window.CNPE_GAME.debug().waterFrame & 1) === 1 }; };
      /** @type {ReturnType<typeof read>[]} */
      const out = [read()];
      for (let i = 0; i < (beats || 0); i++) { window.CNPE_GAME.debug().tick(); out.push(read()); }
      return out;
    }, { x, y, beats: beats || 0 });
    const rgb = (/** @type {string} */ hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(','); };
    // a fresh start two tiles under Portmouth: its trial is the first thing to do
    const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, pos: { x: 8, y: 8, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    const colours = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const v = (/** @type {string} */ n) => cs.getPropertyValue(n).trim(); return { accent: v('--accent'), paper: v('--paper'), warn: v('--warn') }; });
    let s = await sign(page);
    assert(!!s.goal && s.goal.x === TOWN.x && s.goal.y === TOWN.y && s.goal.what === 'the trial in Portmouth', 'from the start the signpost points to Portmouth\'s trial: ' + JSON.stringify(s.goal));
    assert(s.nx === 'next: the trial in Portmouth · 2 ▲' && /Substrate Downs/.test(s.where), 'the where window says so, with the steps and the way: ' + JSON.stringify(s.nx));
    assert(/Next: the trial in Portmouth, 2 steps north\./.test(s.label || ''), 'and the canvas says it in words: ' + s.label);
    // the ring: a hollow five by five in the accent around the town on the beat's odd frame, gone on the even ones the dot takes
    const frames = await ring(page, TOWN.x, TOWN.y, 2);
    const on = frames.filter(f => f.odd), off = frames.filter(f => !f.odd);
    assert(on.length === 1 && off.length === 2, 'three beats by hand: one odd frame, two even: ' + JSON.stringify(frames.map(f => f.odd)));
    assert(on.every(f => [f.tl, f.br, f.left, f.top].every(c => c === rgb(colours.accent)) && f.inner !== rgb(colours.accent) && f.centre === rgb(colours.paper)),
      'on the odd frame the ring is the accent, hollow, and the town\'s own pixel shows through it: ' + JSON.stringify(on[0]));
    assert(off.every(f => [f.tl, f.br, f.left, f.top].every(c => c !== rgb(colours.accent))), 'on the even frames the ring is lifted and the ground shows: ' + JSON.stringify(off[0]));
    // the trial cleared, the signpost moves on to the dungeon door
    await page.evaluate(() => { const st = window.CNPE_PROGRESS.get(); st.game.towns = { '1.1': 1 }; window.CNPE_PROGRESS.save(); });
    s = await sign(page);
    assert(!!s.goal && s.goal.x === DOOR.x && s.goal.y === DOOR.y && s.nx === 'next: the dungeon of Portmouth · 5 ▲▶', 'cleared, it points to the dungeon door, north-east: ' + JSON.stringify({ goal: s.goal, nx: s.nx }));
    assert(/Next: the dungeon of Portmouth, 5 steps north-east\./.test(s.label || ''), 'in words too: ' + s.label);
    // the dungeon won, the nearest town still to do is next; standing in that town, it is "here"
    await page.evaluate(() => { const st = window.CNPE_PROGRESS.get(); st.game.wins = { 'svc-selector': { n: 1, best: 5, t: 1 } }; window.CNPE_PROGRESS.save(); });
    const nearest = await page.evaluate(/** @returns {{ x: number, y: number, name: string, d: number } | null} */ () => { const D = window.CNPE_GAME_DATA; /** @type {{ x: number, y: number, name: string, d: number } | null} */ let best = null; let bd = 1e9; D.towns.forEach(t => { if (t.sec === '1.1') return; const d = Math.abs(t.x - 8) + Math.abs(t.y - 8); if (d < bd) { bd = d; best = { x: t.x, y: t.y, name: t.name, d: bd }; } }); return best; });
    if (!nearest) throw new Error('the map has one town');
    s = await sign(page);
    assert(!!s.goal && s.goal.x === nearest.x && s.goal.y === nearest.y && s.goal.what === 'the trial in ' + nearest.name && new RegExp(' · ' + nearest.d + ' ').test(s.nx),
      'won, it points to the nearest town left, ' + nearest.name + ': ' + JSON.stringify({ goal: s.goal, nx: s.nx }));
    await standAt(page, nearest.x, nearest.y);           // a reload puts you on the tile without entering the town: only a step or enter does that
    s = await sign(page);
    assert(s.nx === 'next: the trial in ' + nearest.name + ' · here' && /Next: the trial in .*, here\./.test(s.label || ''), 'standing there, the signpost reads here: ' + JSON.stringify(s.nx));
    // everything done: no signpost, no ring, and the label says so
    await page.evaluate(() => { const st = window.CNPE_PROGRESS.get(); const D = window.CNPE_GAME_DATA; st.game.towns = {}; D.towns.forEach(t => { st.game.towns[t.sec] = 1; }); st.game.wins = {}; D.scenarios.forEach(sc => { st.game.wins[sc.id] = { n: 1, best: 1, t: 1 }; }); st.game.flags = { intro: 1, final: 1 }; D.regions.forEach(r => { st.game.flags['boss-' + r.d] = 1; }); window.CNPE_PROGRESS.save(); });
    s = await sign(page);
    assert(s.goal === null && s.nx === '' && /The exam is passed/.test(s.label || ''), 'with the exam passed there is nowhere left to point: ' + JSON.stringify({ goal: s.goal, nx: s.nx }));
    const gone = (await ring(page, nearest.x, nearest.y))[0];
    assert([gone.tl, gone.br, gone.left, gone.top].every(c => c !== rgb(colours.accent)), 'and the ring is lifted for good: ' + JSON.stringify(gone));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
    // reduced motion: the ring holds steady, like the dot
    const still = await fresh({ game: { flags: { intro: 1 }, pos: { x: 8, y: 8, t: 1 } } }, { reducedMotion: 'reduce' });
    await still.page.goto(url('game.html'));
    await still.page.waitForSelector('.gm-stage canvas');
    await skipIntro(still.page);
    const steady = (await ring(still.page, TOWN.x, TOWN.y, 1))[1];
    assert([steady.tl, steady.br, steady.left, steady.top].every(c => c === rgb(colours.accent)), 'reduced motion: the ring is on and stays through a beat asked for by hand: ' + JSON.stringify(steady));
    // the player stands two tiles under the town, on the ring's bottom row: the dot is painted last, so where you stand wins
    assert(steady.below === rgb(colours.warn), 'where the dot and the ring meet, the dot shows: ' + JSON.stringify(steady));
    assert(still.page.errors.length === 0, 'no console errors: ' + still.page.errors.join(' | '));
    await still.ctx.close();
  });

  /* 8e. three round trips through the bundle's #GM route leave one animation loop, one ticker, and nothing after unmount */
  await group('unmount() leaves nothing behind: one loop and one ticker after three round trips', async () => {
    const { ctx, page } = await fresh();
    // count what is pending in the page, from outside the quest: animation frames asked for and timers set on the beat
    await page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.__pending = { raf: new Set(), beat: new Map() };
      const raf = w.requestAnimationFrame.bind(w), caf = w.cancelAnimationFrame.bind(w);
      w.requestAnimationFrame = (/** @type {FrameRequestCallback} */ fn) => { const id = raf((/** @type {number} */ t) => { w.__pending.raf.delete(id); fn(t); }); w.__pending.raf.add(id); return id; };
      w.cancelAnimationFrame = (/** @type {number} */ id) => { w.__pending.raf.delete(id); caf(id); };
      const st = w.setTimeout.bind(w), ct = w.clearTimeout.bind(w);
      w.setTimeout = (/** @type {Function} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...args) => { const id = st(() => { w.__pending.beat.delete(id); fn(...args); }, ms); if (ms === 420) w.__pending.beat.set(id, ms); return id; };
      w.clearTimeout = (/** @type {number} */ id) => { w.__pending.beat.delete(id); ct(id); };
      // and the theme's listeners: theme.js assigns CNPE_THEME once, and its onChange/offChange are counted from then on
      w.__theme = { on: 0, off: 0, held: 0 };
      /** @type {any} */
      let theme;
      Object.defineProperty(w, 'CNPE_THEME', { configurable: true, get: () => theme, set: (/** @type {any} */ t) => {
        const on = t.onChange, off = t.offChange;
        t.onChange = (/** @type {Function} */ fn) => { w.__theme.on++; w.__theme.held++; on(fn); };
        t.offChange = (/** @type {Function} */ fn) => { w.__theme.off++; w.__theme.held--; off(fn); };
        theme = t;
      } });
    });
    await page.goto(url('console.html') + '#GM');
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
    await skipIntro(page);
    const pending = () => page.evaluate(() => { const w = /** @type {any} */ (window), d = window.CNPE_GAME.debug(); return { raf: w.__pending.raf.size, beat: w.__pending.beat.size, mounted: d.mounted, mounts: d.mounts, listeners: d.listeners, timers: d.timers, anim: d.anim, frames: d.frames, theme: Object.assign({}, w.__theme) }; });
    const first = await pending();
    assert(first.mounted && first.mounts === 1 && first.listeners > 0 && first.beat === 1, 'mounted once, holding its listeners, one beat pending: ' + JSON.stringify(first));
    // the page's own theme handler (app.js's button) and the quest's: two held, none let go yet
    assert(first.theme.on === 2 && first.theme.off === 0 && first.theme.held === 2, 'the quest holds one theme listener beside the page\'s: ' + JSON.stringify(first.theme));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { location.hash = '#DR'; });
      await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
      // the drill page asks for frames of its own as it mounts; the quest's were cancelled, so the set drains and stays empty
      await page.waitForFunction(() => /** @type {any} */ (window).__pending.raf.size === 0, null, { timeout: 2000 }).catch(() => {});
      const away = await pending();
      assert(!away.mounted && away.listeners === 0 && away.timers === 0 && away.raf === 0 && away.beat === 0 && !away.anim, 'trip ' + (i + 1) + ', away: unmounted, no listeners, no timers, no frame, no beat: ' + JSON.stringify(away));
      assert(away.theme.held === 1 && away.theme.off === i + 1, 'trip ' + (i + 1) + ', away: the theme handler was let go through offChange, the page\'s is the one left: ' + JSON.stringify(away.theme));
      await page.evaluate(() => { location.hash = '#GM'; });
      await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
      await skipIntro(page);
    }
    const f0 = await pending();
    // the one real-time look at the beat: 700 ms holds at least one 420 ms tick, and a tick with water in view is a frame
    await page.waitForTimeout(700);
    const back = await pending();
    assert(back.mounted && back.mounts === 4 && back.beat === 1 && back.raf <= 1 && back.listeners === first.listeners, 'three round trips later: one beat, at most one frame pending, the same listeners as the first mount: ' + JSON.stringify(back));
    assert(back.frames > f0.frames, 'and the one loop is alive: frames still come on the beat: ' + f0.frames + ' -> ' + back.frames);
    assert(back.theme.held === 2 && back.theme.on === 5 && back.theme.off === 3, 'and one theme handler is held again, the fourth the quest took: ' + JSON.stringify(back.theme));
    // one theme handler: a switch repaints the terrain once
    const r0 = await page.evaluate(() => window.CNPE_GAME.debug().terrainRenders);
    await page.evaluate(() => window.CNPE_THEME.set('light'));
    await page.waitForFunction(n => window.CNPE_GAME.debug().terrainRenders > n, r0, { timeout: 3000 }).catch(() => {});
    const r1 = await page.evaluate(() => window.CNPE_GAME.debug().terrainRenders);
    assert(r1 === r0 + 1, 'one theme handler, one repaint on a switch: ' + r0 + ' -> ' + r1);
    // one keydown listener: a press is one step
    await page.focus('.gm-stage');
    const x0 = await page.evaluate(() => window.CNPE_GAME.debug().x);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
    const x1 = await page.evaluate(() => window.CNPE_GAME.debug().x);
    assert(x1 === x0 + 1, 'one press, one step: ' + x0 + ' -> ' + x1);
    const cache = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { terrain: !!d.terrain, renders: d.terrainRenders }; });
    assert(cache.terrain && cache.renders === 5, 'each visit painted its own terrain cache (four, and the theme switch above), and the last one is live: ' + JSON.stringify(cache));
    await page.evaluate(() => { location.hash = '#DR'; });
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
    const dropped = await page.evaluate(() => { const w = /** @type {any} */ (window), d = window.CNPE_GAME.debug(); return { terrain: d.terrain, minimap: d.minimap, listeners: d.listeners, timers: d.timers, theme: w.__theme }; });
    assert(dropped.terrain === null && dropped.minimap === null, 'and unmount drops the terrain and minimap caches: ' + JSON.stringify(dropped));
    assert(dropped.listeners === 0 && dropped.timers === 0 && dropped.theme.held === 1 && dropped.theme.off === dropped.theme.on - 1, 'nothing held after the last unmount, the theme handler included: ' + JSON.stringify(dropped));
    // and the hooks are no-ops when nothing is mounted: the beat, the frame count and the timers are as they were
    const hooks = await page.evaluate(() => {
      const w = /** @type {any} */ (window), pick = () => { const d = window.CNPE_GAME.debug(); return { waterFrame: d.waterFrame, frames: d.frames, timers: d.timers, raf: w.__pending.raf.size }; };
      const before = pick(); window.CNPE_GAME.debug().tick(); window.CNPE_GAME.debug().settle(); return { before, after: pick() };
    });
    assert(JSON.stringify(hooks.before) === JSON.stringify(hooks.after), 'tick() and settle() do nothing outside a mount: ' + JSON.stringify(hooks));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 9. the water moves on its own beat, and not at all for a visitor who asked for reduced motion */
  await group('the water animates, and reduced motion stills it', async () => {
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion: ' : 'motion: ';
      const { ctx, page } = await fresh(null, { reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.goto(url('game.html'));
      await page.waitForSelector('.gm-stage canvas');
      await skipIntro(page);
      const a = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { anim: d.anim, reduce: d.reduceMotion, wf: d.waterFrame }; });
      if (reduced) {
        assert(a.reduce === true && a.anim === false, tag + 'no ticker runs: ' + JSON.stringify(a));
        await page.waitForTimeout(500);                // longer than a beat: the one real-time look at a ticker that must not run
        assert((await page.evaluate(() => window.CNPE_GAME.debug().waterFrame)) === 0, tag + 'the water stays on its first frame');
        const f0 = await page.evaluate(() => window.CNPE_GAME.debug().frames);
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(n => window.CNPE_GAME.debug().frames > n, f0, { timeout: 3000 });
        const s = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { frames: d.frames, face: d.face, walk: d.walkFrame }; });
        assert(s.frames > f0 && s.face === 'l', tag + 'a step still paints a frame and turns the player: ' + JSON.stringify(s));
      } else {
        assert(a.reduce === false && a.anim === true, tag + 'the water ticker runs on the map: ' + JSON.stringify(a));
        await page.waitForFunction(() => window.CNPE_GAME.debug().waterFrame !== 0, null, { timeout: 3000 }).catch(() => {});
        assert((await page.evaluate(() => window.CNPE_GAME.debug().waterFrame)) !== 0, tag + 'and the water reaches another frame');
        await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
        await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
        assert((await page.evaluate(() => window.CNPE_GAME.debug().anim)) === false, tag + 'in a town the ticker stops');
      }
      assert(page.errors.length === 0, tag + 'no console errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
  });

  /* 10. the battle screen: a sprite per fault family, a terminal that grows in place, blows that show */
  await group('the battle screen updates in place and shows the fault', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, learned: { 'k-get': 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowRight');
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    const fam = await page.getAttribute('.gm-enemy canvas', 'data-family');
    assert(fam === 'networking', 'Hollow Beacon, a Service with no endpoints, is a networking fault: ' + fam);
    assert(/networking fault/.test(await page.getAttribute('.gm-enemy canvas', 'aria-label') || ''), 'and the sprite says so');
    const painted = await page.evaluate(() => { const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-enemy canvas')); const d = c.getContext('2d').getImageData(0, 0, 96, 96).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert(painted > 1500, 'the sprite is drawn: ' + painted + ' opaque pixels');
    await page.evaluate(() => { document.querySelector('.gm-term input').setAttribute('data-mark', '1'); document.querySelector('.gm-term pre').setAttribute('data-mark', '1'); });
    const guard0 = await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.gm-bar:not(.hp) i')).style.width);
    await type(page, 'kubectl -n team-a describe svc web');
    const kept = await page.evaluate(() => ({
      input: document.querySelector('.gm-term input').getAttribute('data-mark'), pre: document.querySelector('.gm-term pre').getAttribute('data-mark'),
      value: /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).value, fx: document.querySelector('.gm-enemy').getAttribute('data-fx'),
      guard: /** @type {HTMLElement} */ (document.querySelector('.gm-bar:not(.hp) i')).style.width }));
    assert(kept.input === '1' && kept.pre === '1', 'the terminal and its prompt are the same elements after a turn');
    assert(kept.value === '', 'and the prompt is cleared for the next command');
    assert(kept.fx === 'stagger' && kept.guard !== guard0, 'evidence staggers the enemy and drops its guard: ' + guard0 + ' -> ' + kept.guard);
    await type(page, 'kubectl -n team-a get svc');
    const hit = await page.evaluate(() => document.querySelector('.gm-enemy').getAttribute('data-fx'));
    assert(hit === 'hit', 'a fruitless turn plays the hit: ' + hit);
    await page.fill('.gm-term input', 'kubectl get');
    await page.evaluate(() => window.CNPE_THEME.set('light'));   // theme.js announces on the spot; the repaint is done when this returns
    const after = await page.evaluate(() => ({ mark: document.querySelector('.gm-term pre').getAttribute('data-mark'), value: /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).value }));
    assert(after.mark === '1' && after.value === 'kubectl get', 'a theme switch repaints the sprite but keeps the terminal and the half-typed command');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 10b. the blow lands on the screen too: evidence shakes the guard bar, a hit flashes the stage's edge; both CSS
     classes recorded in data-fx, lifted when their animation ends or, under reduced motion, by the clock */
  await group('evidence shakes the guard bar and a hit flashes the stage edge, lifted by animationend or the clock', async () => {
    for (const reduced of [false, true]) {
      const tag = reduced ? 'reduced motion: ' : 'motion: ';
      const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, learned: { 'k-get': 1 }, pos: { x: 10, y: 6, t: 1 } } }, { reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.goto(url('game.html'));
      await page.waitForSelector('.gm-stage canvas');
      await skipIntro(page);
      await page.keyboard.press('ArrowRight');
      await page.click('.gm-dialog button:has-text("Yes")');
      await page.waitForSelector('.gm-term input');
      const state = () => page.evaluate(() => {
        const bar = /** @type {HTMLElement} */ (document.querySelector('.gm-bar:not(.hp)')), scr = /** @type {HTMLElement} */ (document.querySelector('.gm-screen'));
        return { bar: { fx: bar.getAttribute('data-fx'), cls: bar.className, anim: getComputedStyle(bar).animationName }, screen: { fx: scr.getAttribute('data-fx'), cls: scr.className, anim: getComputedStyle(scr).animationName },
          timers: window.CNPE_GAME.debug().timers, term: document.querySelector('.gm-term pre').textContent };
      });
      const s0 = await state();
      assert(s0.bar.fx === null && s0.screen.fx === null && s0.bar.anim === 'none' && s0.screen.anim === 'none', tag + 'nothing plays before a blow: ' + JSON.stringify({ bar: s0.bar, screen: s0.screen }));
      // the evidence: read in the same task as the command, so the class is up whatever the clock does after
      await page.fill('.gm-term input', 'kubectl -n team-a describe svc web');
      const ev = await page.evaluate(() => {
        /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).form.requestSubmit();
        const bar = /** @type {HTMLElement} */ (document.querySelector('.gm-bar:not(.hp)')), scr = /** @type {HTMLElement} */ (document.querySelector('.gm-screen'));
        return { fx: bar.getAttribute('data-fx'), cls: bar.className, anim: getComputedStyle(bar).animationName, screenFx: scr.getAttribute('data-fx'), timers: window.CNPE_GAME.debug().timers };
      });
      assert(ev.fx === 'shake' && /\bfx-shake\b/.test(ev.cls) && ev.screenFx === null, tag + 'evidence puts the shake on the guard bar and nothing on the screen: ' + JSON.stringify(ev));
      if (reduced) assert(ev.anim === 'none' && ev.timers >= 2, tag + 'no animation runs, so the class waits on the clock (the float\'s timer and its own): ' + JSON.stringify(ev));
      else assert(ev.anim === 'gm-bar-shake, gm-bar-flash', tag + 'the shake and the flash run on the bar: ' + JSON.stringify(ev));
      // the hit
      await page.fill('.gm-term input', 'kubectl -n team-a get svc');
      const hit = await page.evaluate(() => {
        /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).form.requestSubmit();
        const scr = /** @type {HTMLElement} */ (document.querySelector('.gm-screen')), cs = getComputedStyle(scr);
        return { fx: scr.getAttribute('data-fx'), cls: scr.className, anim: cs.animationName, shadow: cs.boxShadow, bad: getComputedStyle(document.documentElement).getPropertyValue('--bad').trim() };
      });
      assert(hit.fx === 'flash' && /\bfx-flash\b/.test(hit.cls), tag + 'a hit puts the flash on the screen: ' + JSON.stringify(hit));
      if (reduced) assert(hit.anim === 'none', tag + 'and no animation runs: ' + hit.anim);
      else {
        const rgb = (/** @type {string} */ hex) => { const h = hex.replace('#', ''); return 'rgb(' + [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')'; };
        assert(hit.anim === 'gm-edge' && hit.shadow.indexOf(rgb(hit.bad)) >= 0 && /inset/.test(hit.shadow), tag + 'the edge flashes an inset shadow in --bad: ' + JSON.stringify(hit));
      }
      if (!reduced) {
        // the animation's end lifts the class, the clock still pending behind it; an end reported by a child (a float) is not the element's own
        const ended = await page.evaluate(() => {
          const bar = /** @type {HTMLElement} */ (document.querySelector('.gm-bar:not(.hp)')), scr = /** @type {HTMLElement} */ (document.querySelector('.gm-screen'));
          const end = (/** @type {Element} */ e) => e.dispatchEvent(new AnimationEvent('animationend', { bubbles: true, animationName: 'x' }));
          const timers0 = window.CNPE_GAME.debug().timers;
          end(bar.querySelector('.gm-float') || bar.firstElementChild);
          const child = { bar: /fx-shake/.test(bar.className), screen: /fx-flash/.test(scr.className) };
          end(bar); end(scr);
          return { timers0, child, bar: bar.className, screen: scr.className, timers: window.CNPE_GAME.debug().timers, barFx: bar.getAttribute('data-fx'), screenFx: scr.getAttribute('data-fx') };
        });
        assert(ended.child.bar && ended.child.screen, tag + 'a child\'s animationend, bubbling up, lifts neither class: ' + JSON.stringify(ended.child));
        assert(!/fx-shake/.test(ended.bar) && !/fx-flash/.test(ended.screen) && ended.timers === ended.timers0 && ended.timers > 0 && ended.barFx === 'shake' && ended.screenFx === 'flash',
          tag + 'the element\'s own animationend lifts its class with the clock still pending, data-fx kept: ' + JSON.stringify(ended));
      }
      // the clock: settle() fires the fallbacks now, which lift the classes (reduced motion has no animation to end) and the numbers; data-fx stays for the record
      const lifted = await page.evaluate(() => {
        window.CNPE_GAME.debug().settle();
        const bar = /** @type {HTMLElement} */ (document.querySelector('.gm-bar:not(.hp)')), scr = /** @type {HTMLElement} */ (document.querySelector('.gm-screen'));
        return { bar: { fx: bar.getAttribute('data-fx'), cls: bar.className }, screen: { fx: scr.getAttribute('data-fx'), cls: scr.className }, floats: document.querySelectorAll('.gm-float').length, timers: window.CNPE_GAME.debug().timers };
      });
      assert(lifted.bar.fx === 'shake' && !/fx-shake/.test(lifted.bar.cls) && lifted.screen.fx === 'flash' && !/fx-flash/.test(lifted.screen.cls) && lifted.floats === 0 && lifted.timers === 0,
        tag + 'the clock lifts both classes and the numbers, data-fx keeps the record: ' + JSON.stringify(lifted));
      const t = (await state()).term;
      assert(/Evidence found \(1\/3\): the enemy staggers\. \+12 xp \(typed\)\./.test(t) && /strikes for \d+\. Health \d+ of \d+\./.test(t), tag + 'the terminal text is as it was');
      // the record is the battle's: fleeing to the town clears it from the screen, which outlives the battle
      await page.click('.gm-acts button:has-text("Flee")');
      await page.waitForSelector('.gm-menu button:has-text("Dungeon")');
      const cleared = await page.evaluate(() => { const scr = document.querySelector('.gm-screen'); return { fx: scr.getAttribute('data-fx'), cls: scr.className }; });
      assert(cleared.fx === null && !/fx-flash/.test(cleared.cls), tag + 'leaving the battle clears the flash and its record from the screen: ' + JSON.stringify(cleared));
      assert(page.errors.length === 0, tag + 'no console errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
    // on the clock: the classes come off by themselves, and the killing blow flashes the edge of a screen the card then takes
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, learned: { 'k-get': 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowRight');
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    await type(page, 'kubectl -n team-a describe svc web');
    await type(page, 'kubectl -n team-a get svc');
    await page.waitForFunction(() => !/fx-shake/.test(document.querySelector('.gm-bar:not(.hp)').className) && !/fx-flash/.test(document.querySelector('.gm-screen').className), null, { timeout: 2000 }).catch(() => {});
    const own = await page.evaluate(() => ({ bar: document.querySelector('.gm-bar:not(.hp)').className, screen: document.querySelector('.gm-screen').className, timers: window.CNPE_GAME.debug().timers }));
    assert(!/fx-shake/.test(own.bar) && !/fx-flash/.test(own.screen), 'on the clock, both classes come off by themselves: ' + JSON.stringify(own));
    for (let i = 0; i < 40; i++) {
      if (await page.locator('.gm-result').count()) break;
      await type(page, 'kubectl -n team-a get svc');
    }
    const last = await page.evaluate(() => { const scr = document.querySelector('.gm-screen'); return { fx: scr.getAttribute('data-fx'), card: !!document.querySelector('.gm-result h4.lose') }; });
    assert(last.card && last.fx === 'flash', 'the blow that ends the fight flashes the edge behind the defeat card: ' + JSON.stringify(last));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 11. battle feel: the prompt's history, the numbers that float, the fall */
  await group('the prompt remembers, the blows show their numbers, and the monster falls its own way', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, learned: { 'k-get': 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    await page.keyboard.press('ArrowRight');
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    const value = () => page.evaluate(() => /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).value);
    await type(page, 'kubectl -n team-a describe svc web');
    const evidence = await page.evaluate(() => Array.from(document.querySelectorAll('.gm-float')).map(f => f.className + ':' + f.textContent));
    assert(evidence.some(f => /gain:\+12 xp/.test(f)), 'evidence floats its xp up from the guard bar: ' + JSON.stringify(evidence));
    assert((await page.evaluate(() => !!document.querySelector('.gm-bar:not(.hp) .gm-float'))), 'anchored to the guard bar');
    await type(page, 'kubectl -n team-a get svc');
    const hit = await page.evaluate(() => Array.from(document.querySelectorAll('.gm-float')).map(f => f.className + ':' + f.textContent));
    assert(hit.some(f => /hit:-\d+$/.test(f)), 'a blow floats its damage up from the monster: ' + JSON.stringify(hit));
    assert((await page.evaluate(() => !!document.querySelector('.gm-enemy > .gm-float.hit'))), 'anchored to the figure');
    // history: up and down walk what was typed this battle; a draft survives the trip
    await page.fill('.gm-term input', 'kubectl get po');
    await page.keyboard.press('ArrowUp');
    assert((await value()) === 'kubectl -n team-a get svc', 'up recalls the last command: ' + (await value()));
    await page.keyboard.press('ArrowUp');
    assert((await value()) === 'kubectl -n team-a describe svc web', 'up again, the one before: ' + (await value()));
    await page.keyboard.press('ArrowUp');
    assert((await value()) === 'kubectl -n team-a describe svc web', 'and it stops at the oldest');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    assert((await value()) === 'kubectl get po', 'down past the newest brings the draft back: ' + (await value()));
    assert(!/kubectl get po/.test(await term(page)), 'walking the history runs nothing');
    // the terminal's words are untouched by the numbers
    const t = await term(page);
    assert(/Evidence found \(1\/3\): the enemy staggers\. \+12 xp \(typed\)\./.test(t) && /strikes for \d+\. Health \d+ of \d+\./.test(t), 'the terminal text is as it was');
    const floats = await page.evaluate(() => { const before = document.querySelectorAll('.gm-float').length; window.CNPE_GAME.debug().settle(); return { before, after: document.querySelectorAll('.gm-float').length, timers: window.CNPE_GAME.debug().timers }; });
    assert(floats.before === 2 && floats.after === 0, 'the numbers are lifted by their clock (fired by settle()): ' + JSON.stringify(floats));
    // the fall: Hollow Beacon is a networking fault, and its figure falls the networking way before the card
    await type(page, 'kubectl -n team-a patch svc web -p \'{"spec":{"selector":{"app":"web-frontend"}}}\'');
    const fell = await page.evaluate(() => { const f = document.querySelector('.gm-enemy'); return f ? { fx: f.getAttribute('data-fx'), family: f.getAttribute('data-family'), anim: getComputedStyle(f.querySelector('canvas')).animationName,
      flee: /** @type {HTMLButtonElement} */ (document.querySelector('.gm-acts button.ghost')).disabled, inspect: /** @type {HTMLButtonElement} */ (document.querySelector('.gm-acts button')).disabled } : null; });
    assert(!!fell && fell.fx === 'win' && fell.family === 'networking' && fell.anim === 'gm-fall-networking', 'the fix plays the networking fall on the figure: ' + JSON.stringify(fell));
    assert(!!fell && fell.flee === true && fell.inspect === true, 'and the fight is over: Flee and the menus are shut while it falls: ' + JSON.stringify(fell));
    // the card waits on a timer behind the fall; settle() fires it now (a battle won on the clock is group 4's)
    const card = await page.evaluate(() => { const before = !!document.querySelector('.gm-result'); window.CNPE_GAME.debug().settle(); return { before, after: !!document.querySelector('.gm-result') }; });
    assert(!card.before && card.after, 'the card waits behind the fall and comes up when its timer fires: ' + JSON.stringify(card));
    assert(/Victory|Critical|lucky/.test(await page.textContent('.gm-result')), 'and it names the win');
    const falls = await page.evaluate(() => {
      const probe = document.createElement('div'); probe.className = 'gm-enemy fx-win'; const c = document.createElement('canvas'); probe.appendChild(c); document.body.appendChild(probe);
      const names = window.CNPE_ART.FAMILIES.map(f => { probe.setAttribute('data-family', f); return getComputedStyle(c).animationName; });
      probe.remove();
      return names;
    });
    assert(falls.length === 8 && new Set(falls).size === 8 && falls.every(n => /^gm-fall-/.test(n)), 'eight families, eight falls: ' + JSON.stringify(falls));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 12. a keep chains two faults: the next monster waits for the last one's fall, and nothing repaints or runs against it meanwhile */
  await group('in a keep the next monster waits for the fall', async () => {
    // every dungeon of Substrate Downs won, so its keep opens; stand on the keep itself
    const wins = { image: { n: 1 }, probe: { n: 1 }, resources: { n: 1 }, quota: { n: 1 }, config: { n: 1 }, 'hpa-unknown': { n: 1 }, 'svc-selector': { n: 1 }, pvc: { n: 1 }, 'storage-class': { n: 1 }, dns: { n: 1 }, ingress: { n: 1 } };
    const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, wins, pos: { x: 35, y: 32, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    // the keep's own dialogue names both faults; the seed may not cover every dungeon, so read what it says
    await page.keyboard.press('Enter');
    await page.waitForSelector('.gm-dialog:not([hidden])');
    const dlg = await page.textContent('.gm-dialog');
    if (!/Two faults wait inside/.test(dlg)) {
      // list what still stands and seed those too, then come back
      const ids = await page.evaluate(() => window.CNPE_GAME_DATA.scenarios.filter(s => s.d === 1).map(s => s.id));
      await page.evaluate(ids => { const s = window.CNPE_PROGRESS.get(); s.game.wins = s.game.wins || {}; ids.forEach(id => { s.game.wins[id] = { n: 1 }; }); window.CNPE_PROGRESS.save(); }, ids);
      await standAt(page, 35, 32);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.gm-dialog:not([hidden])');
    }
    assert(/Two faults wait inside/.test(await page.textContent('.gm-dialog')), 'the keep is open: ' + (await page.textContent('.gm-dialog')).slice(0, 90));
    await page.click('.gm-dialog button:has-text("Yes")');
    await page.waitForSelector('.gm-term input');
    const first = await page.textContent('.gm-title h3');
    assert(first === "Miser's Ledger", 'the first fault of the Substrate Downs keep is up: ' + first);
    // the fix, before any evidence: the monster falls, the next waits behind it
    await page.fill('.gm-term input', 'kubectl -n team-a scale deployment broken --replicas=1');
    await page.keyboard.press('Enter');
    // not afterTurn(): a chain's win defers the terminal's paint until the swap,
    // and the swap is what this group is about. The fall starting is the state.
    await page.waitForFunction(() => document.querySelector('.gm-enemy').getAttribute('data-fx') === 'win', null, { timeout: 5000 });
    const falling = await page.evaluate(() => ({ h3: document.querySelector('.gm-title h3').textContent, fx: document.querySelector('.gm-enemy').getAttribute('data-fx'),
      disabled: /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).disabled, flee: /** @type {HTMLButtonElement} */ (document.querySelector('.gm-acts button.ghost')).disabled }));
    assert(falling.h3 === "Miser's Ledger" && falling.fx === 'win' && falling.disabled === true && falling.flee === false, 'the fallen monster stays on screen through its fall, the prompt shut, Flee still open (the keep goes on): ' + JSON.stringify(falling));
    // a repaint asked for during the fall waits: the screen is still the fallen one's
    await page.click('.gm-acts button:has-text("Inspect")');
    await page.waitForTimeout(50);                   // nothing to wait for either: the check is that the screen did not swap
    const during = await page.evaluate(() => ({ h3: document.querySelector('.gm-title h3').textContent, sub: !!document.querySelector('.gm-sub') }));
    assert(during.h3 === "Miser's Ledger" && !during.sub, 'Inspect during the fall does not swap the screen early: ' + JSON.stringify(during));
    // a command typed against the fallen monster runs nothing
    await page.evaluate(() => { const i = /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')); i.disabled = false; i.value = 'kubectl get nothing-yet'; i.form.requestSubmit(); });
    const held = await page.evaluate(() => ({ h3: document.querySelector('.gm-title h3').textContent, ran: /nothing-yet/.test(document.querySelector('.gm-term pre').textContent) }));
    assert(held.h3 === "Miser's Ledger" && !held.ran, 'nor does a command forced through the shut prompt run against it: ' + JSON.stringify(held));
    // the swap waits on the fall's end, or its fallback timer; settle() fires both now
    const next = await page.evaluate(() => { window.CNPE_GAME.debug().settle(); return { h3: document.querySelector('.gm-title h3').textContent, disabled: /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).disabled,
      fx: document.querySelector('.gm-enemy').className, sub: !!document.querySelector('.gm-sub'), log: document.querySelector('.gm-term pre').textContent, timers: window.CNPE_GAME.debug().timers }; });
    assert(next.h3 === 'Blindfolded Scaler' && next.disabled === false && !/fx-win/.test(next.fx), 'then the next monster stands, the prompt open, the fall over: ' + JSON.stringify({ h3: next.h3, disabled: next.disabled, cls: next.fx }));
    assert(next.sub, 'and the Inspect menu asked for during the fall is painted now');
    assert(/another rises: Blindfolded Scaler/.test(next.log), 'the terminal announces it');
    // settle() is idempotent: the swap fired once, and firing again with nothing pending changes nothing
    const again = await page.evaluate(() => { window.CNPE_GAME.debug().settle(); return { h3: document.querySelector('.gm-title h3').textContent, timers: window.CNPE_GAME.debug().timers }; });
    assert(again.h3 === 'Blindfolded Scaler' && again.timers === 0, 'and a second settle() finds nothing to fire: ' + JSON.stringify(again));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
