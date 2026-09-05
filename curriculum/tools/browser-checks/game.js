/* The quest: the store it writes, the trial it shares with the drill, the doors
   it opens, a battle fought in its terminal, and the renderer under it: the
   step tween, the terrain cache and its patches, the living tiles, the minimap,
   and what a visit to the bundle's #GM route leaves behind. game-sim-test.mjs
   covers every scenario's commands in node; this drives the page around them. */
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
    await page.waitForTimeout(150);
    assert(/game\.html/.test(page.url()) && /Portmouth/.test(await page.textContent('.gm-title')), 'a letter pressed in a town does not leave the page');
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
    assert(door.patchMs > 0 && door.patchMs < themeMs / 4 && Math.abs((door.ms - themed.ms) - door.patchMs) < 0.5,
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
      const at = () => page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { x: d.x, y: d.y, walking: d.walking, off: d.offset, queued: d.queued, walk: d.walkFrame, face: d.face }; });
      const before = await at();
      assert(before.x === 8 && before.y === 8 && !before.walking, tag + 'standing on the start tile: ' + JSON.stringify(before));
      // press and read in the same task: the tile has changed, the sprite has not arrived
      const mid = await page.evaluate(() => {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        const d = window.CNPE_GAME.debug();
        return { x: d.x, y: d.y, walking: d.walking, off: d.offset, face: d.face };
      });
      if (reduced) {
        assert(mid.x === 9 && !mid.walking && mid.off.x === 0 && mid.off.y === 0 && mid.face === 'r', tag + 'the step is instant: ' + JSON.stringify(mid));
      } else {
        assert(mid.x === 9 && mid.y === 8 && mid.walking && mid.off.x === -16 && mid.off.y === 0, tag + 'the tile is taken at once and the sprite starts a tile behind it: ' + JSON.stringify(mid));
        await page.waitForTimeout(50);
        const part = await at();
        assert(part.walking && part.off.x < 0 && part.off.x > -16 && part.off.x % 1 === 0, tag + 'part way, the offset is whole pixels between the tiles: ' + JSON.stringify(part));
        assert(part.walk === 1 || part.off.x > -8, tag + 'the walk cycle is keyed to the tween: the other foot in its first half: ' + JSON.stringify(part));
        await page.waitForFunction(() => !window.CNPE_GAME.debug().walking, null, { timeout: 2000 }).catch(() => {});
        const done = await at();
        assert(done.x === 9 && done.y === 8 && !done.walking && done.off.x === 0 && done.off.y === 0 && done.walk === 0, tag + 'the tween ends on the exact tile, standing: ' + JSON.stringify(done));
        // a step asked for in flight waits and lands on the next tile, never skipping one
        const two = await page.evaluate(() => {
          const press = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          press(); press(); press();
          const d = window.CNPE_GAME.debug();
          return { x: d.x, walking: d.walking, queued: d.queued };
        });
        assert(two.x === 10 && two.walking && two.queued, tag + 'three presses in one tween: one step taken, one queued: ' + JSON.stringify(two));
        await page.waitForTimeout(400);
        const landed = await at();
        assert(landed.x === 11 && !landed.walking && !landed.queued, tag + 'and the queued step lands one tile on, and no further: ' + JSON.stringify(landed));
        const label = await page.getAttribute('.gm-stage canvas', 'aria-label');
        assert(/You stand on grass/.test(label || ''), tag + 'the canvas describes the tile landed on: ' + label);
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
    // the door's torches: over the beat, the flame colour shows on the open door's post
    const v = await view(page);
    /** @type {{ warn: string, seen: string[] }} */
    const torch = await page.evaluate(({ v, door }) => new Promise(res => {
      const A = window.CNPE_ART, warn = A.ambient('torch', 0).getContext('2d').getImageData(3, 0, 1, 1).data;
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-stage canvas')), k = c.getContext('2d');
      /** @type {string[]} */
      const seen = [];
      const look = () => {
        window.CNPE_GAME.debug().frame();
        // the flame is at pixel (3, 0) of the open door's tile
        const p = k.getImageData(((door.x - v.cx) * 16 + 3) * v.scale, ((door.y - v.cy) * 16 + 0) * v.scale, 1, 1).data;
        seen.push(p[0] + ',' + p[1] + ',' + p[2] + ':' + window.CNPE_GAME.debug().waterFrame);
        if (seen.length < 4) setTimeout(look, 430); else res({ warn: warn[0] + ',' + warn[1] + ',' + warn[2], seen });
      };
      look();
    }), { v, door: DOOR });
    assert(torch.seen.some(x => x.indexOf(torch.warn + ':') === 0), 'the torch flame is painted over the open door in the flame colour: ' + JSON.stringify(torch));
    assert(new Set(torch.seen.map(x => x.split(':')[1])).size >= 3, 'across three frames of the beat: ' + JSON.stringify(torch.seen));
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
    await page.waitForTimeout(100);
    const far = await inView();
    assert(far.got.water === far.expect.water && far.got.ambient === far.expect.ambient && far.at.join() !== here.at.join(), 'and by the Exam gate too: ' + JSON.stringify(far));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 8d. the minimap: built from the terrain once, tinted per region, the towns cleared in green, the player a dot that blinks */
  await group('the minimap is built from the terrain and only its dot moves', async () => {
    const { ctx, page } = await fresh({ game: { towns: { '1.1': 1 }, flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } });
    await page.goto(url('game.html'));
    await page.waitForSelector('.gm-stage canvas');
    await skipIntro(page);
    const m0 = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { minimap: d.minimap, builds: d.minimapBuilds, frames: d.frames }; });
    const map = await page.evaluate(() => ({ w: window.CNPE_GAME_DATA.map[0].length, h: window.CNPE_GAME_DATA.map.length }));
    assert(!!m0.minimap && m0.minimap.w === map.w && m0.minimap.h === map.h, 'a pixel a tile: ' + JSON.stringify(m0.minimap) + ' for a ' + map.w + 'x' + map.h + ' map');
    assert(m0.builds === 1 && m0.frames > 1, 'built once with the terrain, while frames keep coming: ' + JSON.stringify(m0));
    const px = (/** @type {number} */ x, /** @type {number} */ y) => page.evaluate(({ x, y }) => { const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')); const p = c.getContext('2d').getImageData(x, y, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; }, { x, y });
    const colours = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const v = (/** @type {string} */ n) => cs.getPropertyValue(n).trim(); return { ok: v('--ok'), paper: v('--paper'), warn: v('--warn') }; });
    const rgb = (/** @type {string} */ hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(','); };
    assert((await px(8, 6)) === rgb(colours.ok), 'Portmouth, cleared, is a green pixel: ' + (await px(8, 6)) + ' for ' + colours.ok);
    const mill = await page.evaluate(() => window.CNPE_GAME_DATA.towns[1]);
    assert((await px(mill.x, mill.y)) === rgb(colours.paper), mill.name + ', not cleared, is a paper pixel: ' + (await px(mill.x, mill.y)));
    assert((await px(0, 0)) !== (await px(60, 40)), 'the sea and the land differ: ' + (await px(0, 0)) + ' vs ' + (await px(60, 40)));
    const tints = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d');
      const at = (/** @type {number} */ x, /** @type {number} */ y) => { const p = k.getImageData(x, y, 1, 1).data; return [p[0], p[1], p[2]]; };
      // a meadow tile deep in each region: Substrate Downs (north-west), Warden's March (south-east)
      return { d1: at(20, 12), d5: at(100, 60) };
    });
    assert(tints.d1.join() !== tints.d5.join(), 'two regions are tinted differently: ' + JSON.stringify(tints));
    // the dot blinks on the beat, without rebuilding the map under it
    const dot = await page.evaluate(() => new Promise(res => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d');
      const at = () => { const p = k.getImageData(10, 6, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      const seen = new Set([at()]);
      const t0 = performance.now();
      const tick = () => { seen.add(at()); if (performance.now() - t0 < 1200) requestAnimationFrame(tick); else res(Array.from(seen)); };
      requestAnimationFrame(tick);
    }));
    assert(dot.length >= 2, 'the dot blinks: the pixel under the player changes over a second: ' + JSON.stringify(dot));
    const builds1 = await page.evaluate(() => window.CNPE_GAME.debug().minimapBuilds);
    assert(builds1 === 1, 'and blinking did not rebuild the minimap: ' + builds1);
    // a step moves the dot: the map's pixel comes back where it was, and the dot's colours show where it is
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    const moved = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d');
      const at = (/** @type {number} */ x, /** @type {number} */ y) => { const p = k.getImageData(x, y, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      const d = window.CNPE_GAME.debug();
      // the dot is 3 by 3 around the player, so the tile two to the right is ground again
      return { x: d.x, builds: d.minimapBuilds, right: at(12, 6), was: at(11, 6) };
    });
    assert(moved.x === 9 && moved.builds === 1, 'a step moves the dot without a rebuild: ' + JSON.stringify(moved));
    await ctx.close();
    // reduced motion: the dot holds still
    const still = await fresh({ game: { flags: { intro: 1 }, pos: { x: 10, y: 6, t: 1 } } }, { reducedMotion: 'reduce' });
    await still.page.goto(url('game.html'));
    await still.page.waitForSelector('.gm-stage canvas');
    await skipIntro(still.page);
    const steady = await still.page.evaluate(() => new Promise(res => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-mini canvas')), k = c.getContext('2d');
      const at = () => { const p = k.getImageData(10, 6, 1, 1).data; return p[0] + ',' + p[1] + ',' + p[2]; };
      const seen = new Set([at()]);
      setTimeout(() => { window.CNPE_GAME.debug().frame(); seen.add(at()); res(Array.from(seen)); }, 900);
    }));
    assert(steady.length === 1 && steady[0] === rgb(colours.warn), 'reduced motion: the dot is on and does not blink: ' + JSON.stringify(steady) + ' for ' + colours.warn);
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
    });
    await page.goto(url('console.html') + '#GM');
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
    await skipIntro(page);
    const pending = () => page.evaluate(() => { const w = /** @type {any} */ (window), d = window.CNPE_GAME.debug(); return { raf: w.__pending.raf.size, beat: w.__pending.beat.size, mounted: d.mounted, mounts: d.mounts, listeners: d.listeners, anim: d.anim }; });
    const first = await pending();
    assert(first.mounted && first.mounts === 1 && first.listeners > 0 && first.beat === 1, 'mounted once, holding its listeners, one beat pending: ' + JSON.stringify(first));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { location.hash = '#DR'; });
      await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
      await page.waitForTimeout(500);
      const away = await pending();
      assert(!away.mounted && away.listeners === 0 && away.raf === 0 && away.beat === 0 && !away.anim, 'trip ' + (i + 1) + ', away: unmounted, no listeners, no frame, no beat: ' + JSON.stringify(away));
      await page.evaluate(() => { location.hash = '#GM'; });
      await page.waitForFunction(() => document.body.getAttribute('data-id') === 'GM' && !!document.querySelector('#game-app[data-built] canvas'));
      await skipIntro(page);
    }
    await page.waitForTimeout(700);
    const back = await pending();
    assert(back.mounted && back.mounts === 4 && back.beat === 1 && back.raf <= 1 && back.listeners === first.listeners, 'three round trips later: one beat, at most one frame pending, the same listeners as the first mount: ' + JSON.stringify(back));
    // one keydown listener: a press is one step
    await page.focus('.gm-stage');
    const x0 = await page.evaluate(() => window.CNPE_GAME.debug().x);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const x1 = await page.evaluate(() => window.CNPE_GAME.debug().x);
    assert(x1 === x0 + 1, 'one press, one step: ' + x0 + ' -> ' + x1);
    const cache = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { terrain: !!d.terrain, renders: d.terrainRenders }; });
    assert(cache.terrain && cache.renders === 4, 'each visit painted its own terrain cache and the last one is live: ' + JSON.stringify(cache));
    await page.evaluate(() => { location.hash = '#DR'; });
    await page.waitForFunction(() => document.body.getAttribute('data-id') === 'DR');
    const dropped = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { terrain: d.terrain, minimap: d.minimap }; });
    assert(dropped.terrain === null && dropped.minimap === null, 'and unmount drops the terrain and minimap caches: ' + JSON.stringify(dropped));
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
        await page.waitForTimeout(1000);
        assert((await page.evaluate(() => window.CNPE_GAME.debug().waterFrame)) === 0, tag + 'the water stays on its first frame');
        const f0 = await page.evaluate(() => window.CNPE_GAME.debug().frames);
        await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
        const s = await page.evaluate(() => { const d = window.CNPE_GAME.debug(); return { frames: d.frames, face: d.face, walk: d.walkFrame }; });
        assert(s.frames > f0 && s.face === 'l', tag + 'a step still paints a frame and turns the player: ' + JSON.stringify(s));
      } else {
        assert(a.reduce === false && a.anim === true, tag + 'the water ticker runs on the map: ' + JSON.stringify(a));
        await page.waitForFunction(() => window.CNPE_GAME.debug().waterFrame !== 0, null, { timeout: 3000 }).catch(() => {});
        assert((await page.evaluate(() => window.CNPE_GAME.debug().waterFrame)) !== 0, tag + 'and the water reaches another frame');
        await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
        await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
        await page.waitForTimeout(500);
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
    await page.evaluate(() => window.CNPE_THEME.set('light'));
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => ({ mark: document.querySelector('.gm-term pre').getAttribute('data-mark'), value: /** @type {HTMLInputElement} */ (document.querySelector('.gm-term input')).value }));
    assert(after.mark === '1' && after.value === 'kubectl get', 'a theme switch repaints the sprite but keeps the terminal and the half-typed command');
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
    await page.waitForTimeout(1500);
    assert((await page.evaluate(() => document.querySelectorAll('.gm-float').length)) === 0, 'the numbers are gone after their second');
    // the fall: Hollow Beacon is a networking fault, and its figure falls the networking way before the card
    await type(page, 'kubectl -n team-a patch svc web -p \'{"spec":{"selector":{"app":"web-frontend"}}}\'');
    const fell = await page.evaluate(() => { const f = document.querySelector('.gm-enemy'); return f ? { fx: f.getAttribute('data-fx'), family: f.getAttribute('data-family'), anim: getComputedStyle(f.querySelector('canvas')).animationName } : null; });
    assert(!!fell && fell.fx === 'win' && fell.family === 'networking' && fell.anim === 'gm-fall-networking', 'the fix plays the networking fall on the figure: ' + JSON.stringify(fell));
    await page.waitForSelector('.gm-result', { timeout: 3000 });
    assert(/Victory|Critical|lucky/.test(await page.textContent('.gm-result')), 'and the card comes up behind it');
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
};
