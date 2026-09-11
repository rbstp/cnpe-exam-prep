/* The RPG presentation preserves the study rules, works without sound/motion,
   and releases its interactive state when the bundled route leaves the game. */
'use strict';
const AxeBuilder = require('@axe-core/playwright').default;

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, store, assert, group, dayCount } = h;
  const seed = { game: { flags: { intro: 1 }, towns: { '1.1': 1 }, learned: { 'k-get': 1 }, pos: { x: 8, y: 8, t: 1 } } };
  /** @param {import('playwright').Page} page */
  const settle = page => page.evaluate(() => window.CNPE_GAME.debug().settle());
  /** @param {import('playwright').Page} page @param {number} x @param {number} y */
  const destination = async (page, x, y) => {
    const position = await page.evaluate(({ x, y }) => {
      window.CNPE_GAME.debug().frame();
      const d = window.CNPE_GAME.debug(), c = document.querySelector('.gm-stage > canvas');
      const box = c.getBoundingClientRect();
      return { x: (x * 16 + 8 - d.camera.x) * box.width / 480, y: (y * 16 + 8 - d.camera.y) * box.height / 304 };
    }, { x, y });
    await page.locator('.gm-stage > canvas').click({ position });
  };
  /** @param {import('playwright').Page} page */
  const noOverflow = page => page.evaluate(() => {
    const host = document.getElementById('game-app');
    return host.scrollWidth <= host.clientWidth + 1 &&
      document.documentElement.scrollWidth <= innerWidth + 1 &&
      Array.from(host.querySelectorAll('.gm-screen, .gm-toolbar, .gm-arena, .gm-term'))
        .every(e => e.scrollWidth <= e.clientWidth + 1);
  });

  for (const theme of ['dark', 'light']) {
    for (const mobile of [false, true]) {
      const tag = theme + (mobile ? ' mobile' : ' desktop');
      await group(tag + ': journal, travel, scenery and battle feedback', async () => {
        const { ctx, page } = await fresh(seed, { theme, reducedMotion: mobile ? 'reduce' : 'no-preference' });
        await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 });
        await page.goto(url('console.html') + '#GM');
        await page.waitForSelector('.gm-stage > canvas');
        const palette = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).getPropertyValue('--ink'),
          game: getComputedStyle(document.getElementById('game-app')).getPropertyValue('--ink'),
          name: document.getElementById('game-app').getAttribute('data-palette')
        }));
        assert(palette.root === palette.game && palette.name === theme, tag + ': game windows match the shared study palette');
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => {
          const game = document.getElementById('game-app').getBoundingClientRect();
          const stats = document.querySelector('.quest-stats').getBoundingClientRect();
          return { game: { right: game.right, bottom: game.bottom }, stats: { left: stats.left, bottom: stats.bottom }, height: innerHeight };
        });
        if (!mobile) assert(layout.stats.left >= layout.game.right && Math.max(layout.stats.bottom, layout.game.bottom) <= layout.height,
          tag + ': stats sit beside the game and both fit in one screen: ' + JSON.stringify(layout));
        else assert(layout.stats.bottom < layout.game.bottom, tag + ': mobile uses a compact stats strip above the game');
        assert(!(await page.locator('.quest-guide').getAttribute('open')), tag + ': optional quick help starts collapsed');
        assert((await page.locator('.quest-guide').textContent()).split(/\s+/).length < 100, tag + ': quick help stays concise');
        await page.focus('.gm-stage');
        await page.keyboard.press('q');
        assert(await page.locator('.gm-region').count() === 5 && await page.locator('.gm-region button').count() === 29, tag + ': the journal covers every region and town');
        assert(await noOverflow(page), tag + ': journal fits without horizontal scrolling');
        const trackedName = await page.evaluate(() => window.CNPE_GAME_DATA.towns[1].name);
        await page.locator('.gm-region button').nth(1).click();
        const goal = await page.evaluate(() => window.CNPE_GAME.debug().goal);
        assert(goal.what.includes(trackedName), tag + ': choosing a town updates the compass');
        assert(dayCount((await store(page)).game, 'xp') === 0, tag + ': opening and tracking in the journal grants no XP');
        await destination(page, 11, 8);
        await page.waitForFunction(() => {
          const d = window.CNPE_GAME.debug(); return d.x === 11 && d.y === 8 && !d.walking;
        }, null, { timeout: 5000 });
        assert(true, tag + ': a map click walks a complete multi-tile route');
        await destination(page, 19, 8);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !window.CNPE_GAME.debug().walking);
        const stopped = await page.evaluate(() => window.CNPE_GAME.debug().x);
        await settle(page);
        assert((await page.evaluate(() => window.CNPE_GAME.debug().x)) === stopped && stopped < 19, tag + ': Escape cancels travel');
        await destination(page, 8, 6);
        await page.waitForSelector('.gm-town', { timeout: 5000 });
        await settle(page);
        assert(await page.locator('.gm-scene').getAttribute('height') === '304', tag + ': the town has a full-stage pixel environment');
        const detail = await page.evaluate(() => {
          const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('.gm-town > .gm-scene'));
          const pixels = canvas.getContext('2d').getImageData(0, 0, 480, 144).data;
          const colours = new Map();
          for (let i = 0; i < pixels.length; i += 4) {
            const key = pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2];
            colours.set(key, (colours.get(key) || 0) + 1);
          }
          return { colours: colours.size, flat: Math.max(...colours.values()) / (480 * 144) };
        });
        assert(detail.colours >= 20 && detail.flat < .65, tag + ': visible upper scenery contains detailed artwork, not a blank field: ' + JSON.stringify(detail));
        assert(await noOverflow(page), tag + ': town menus fit the viewport');
        await page.locator('.gm-menu button').filter({ hasText: /^Inn/ }).click();
        await settle(page);
        const inn = await page.evaluate(() => {
          const scenery = document.querySelector('.gm-town > .gm-scene');
          const picture = scenery.getBoundingClientRect();
          const menu = document.querySelector('.gm-town > .gm-body > .gm-col:first-child').getBoundingClientRect();
          const dialogue = document.querySelector('.gm-town > .gm-body > .gm-col:last-child').getBoundingClientRect();
          const separate = (/** @type {DOMRect} */ a, /** @type {DOMRect} */ b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
          return { fit: getComputedStyle(scenery).objectFit, visible: separate(picture, menu) && separate(picture, dialogue),
            dialogueHeight: dialogue.height, fullWidth: dialogue.left <= Math.min(menu.left, picture.left) + 1 && dialogue.right >= Math.max(menu.right, picture.right) - 1 };
        });
        assert(inn.fit === 'contain' && inn.visible, tag + ': the complete inn fits without menus hiding it');
        assert(inn.dialogueHeight < 100 && inn.fullWidth, tag + ': the inn message is shallow and full-width: ' + JSON.stringify(inn));
        await page.locator('.gm-menu button').filter({ hasText: /^Dungeon/ }).click();
        await page.waitForSelector('.gm-arena');
        if (mobile) assert(!(await page.isVisible('.gm-transition')), tag + ': reduced motion skips the encounter wipe');
        await settle(page);
        assert(await page.locator('.gm-arena canvas').count() === 3, tag + ': scenery, enemy and hero share the battlefield');
        await page.fill('.gm-term input', 'kubectl -n team-a get pods');
        await page.getByRole('button', { name: 'Run command', exact: true }).click();
        await page.fill('.gm-term input', 'kubectl -n team-a describe svc web');
        await page.keyboard.press('Enter');
        assert((await page.textContent('.gm-action')).includes('CHAIN x2'), tag + ': consecutive evidence produces chain feedback');
        if (mobile) assert((await page.locator('.gm-arena').evaluate(e => getComputedStyle(e, '::after').animationName)) === 'none',
          tag + ': reduced motion also disables the spell animation on the arena pseudo-element');
        await page.fill('.gm-term input', 'kubectl -n team-a get pods --show-labels');
        await page.keyboard.press('Enter');
        assert((await page.textContent('.gm-action')).includes('GUARD BROKEN'), tag + ': the complete investigation signals the repair');
        assert(await noOverflow(page), tag + ': battlefield and terminal do not overflow horizontally');
        const axe = await new AxeBuilder({ page }).include('#game-app').withTags(['wcag2a', 'wcag2aa']).analyze();
        assert(axe.violations.length === 0, tag + ': battle accessibility: ' + axe.violations.map(v => v.id + ' ' + v.nodes.map(n => n.target.join(' ')).join(', ')).join('; '));
        await page.fill('.gm-term input', 'kubectl -n team-a patch svc web -p \'{"spec":{"selector":{"app":"web-frontend"}}}\'');
        await page.keyboard.press('Enter');
        await settle(page);
        await page.waitForSelector('.gm-result');
        assert(await page.locator('.gm-level-up').isVisible(), tag + ': a gained level is celebrated');
        assert((await page.textContent('.gm-rewards')).includes('all evidence found'), tag + ': an evidence-complete win earns the S rank');
        assert(dayCount((await store(page)).game, 'xp') === 156, tag + ': feedback does not change rewards (36 evidence + 120 win)');
        assert(page.errors.length === 0, tag + ': no browser errors: ' + page.errors.join(' | '));
        await ctx.close();
      });
    }
  }

  await group('grass and click-to-travel cannot bypass a dungeon seal', async () => {
    const { ctx, page } = await fresh({ game: { flags: { intro: 1 }, pos: { x: 11, y: 8, t: 1 } } }, { reducedMotion: 'reduce' });
    await page.goto(url('console.html') + '#GM');
    await page.waitForSelector('.gm-stage');
    await page.focus('.gm-stage');
    await page.keyboard.press('ArrowUp');
    assert((await page.evaluate(() => window.CNPE_GAME.debug().y)) === 8, 'the stone enclosure blocks a southern grass approach');
    await destination(page, 11, 6);
    await page.waitForSelector('.gm-dialog:not([hidden])');
    let state = await page.evaluate(() => ({ x: window.CNPE_GAME.debug().x, y: window.CNPE_GAME.debug().y }));
    assert(state.x === 10 && state.y === 6, 'auto-travel stops outside the sealed entrance, not on or behind it');
    assert((await page.textContent('.gm-dialog')).includes('sealed') && await page.locator('.gm-battle').count() === 0, 'the seal explains its trial requirement and starts no battle');
    await page.locator('.gm-dialog button').click();
    await page.keyboard.press('ArrowRight');
    assert((await page.evaluate(() => window.CNPE_GAME.debug().x)) === 10, 'a keyboard step cannot enter the sealed tile either');
    await page.locator('.gm-dialog button').click();
    await destination(page, 13, 6);
    await page.waitForFunction(() => { const d = window.CNPE_GAME.debug(); return d.x === 13 && d.y === 6; });
    await page.keyboard.press('ArrowLeft');
    assert((await page.evaluate(() => window.CNPE_GAME.debug().x)) === 13, 'the dungeon rear is impassable from the eastern grass');
    const before = await store(page);
    assert(!before.game.towns && !before.game.wins, 'the public road detour grants no trial clear or dungeon win');
    await page.evaluate(() => { const s = window.CNPE_PROGRESS.get(); s.game.towns = { '1.1': 1 }; window.CNPE_PROGRESS.save(); });
    await destination(page, 11, 6);
    await page.waitForSelector('.gm-dialog:not([hidden])');
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    assert(await page.locator('.gm-battle').count() === 1, 'clearing the trial opens that same entrance normally');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('toolbar buttons keep their native Enter action during a revealed trial', async () => {
    const { ctx, page } = await fresh(seed, { reducedMotion: 'reduce' });
    await page.goto(url('console.html') + '#GM');
    await page.waitForSelector('.gm-stage');
    await destination(page, 8, 6);
    await page.locator('.gm-menu button').filter({ hasText: /^Trial/ }).click();
    await page.locator('.gm-opt').first().click();
    const question = await page.locator('.gm-q').textContent();
    await page.getByRole('button', { name: 'Sound: off', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('.gm-q').textContent() === question && await page.locator('.gm-opt:disabled').count() === 4,
      'Enter on the sound button does not advance the trial');
    assert(await page.getByRole('button', { name: 'Sound: on', exact: true }).count() === 1,
      'Enter enables sound while the revealed answer remains on screen');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('returning to the bundle refreshes a motion preference changed while away', async () => {
    const { ctx, page } = await fresh(seed, { reducedMotion: 'no-preference' });
    await page.goto(url('console.html') + '#GM');
    await page.waitForSelector('.gm-stage');
    await page.evaluate(() => { location.hash = '#1.1'; });
    await page.waitForFunction(() => !document.getElementById('game-app'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { location.hash = '#GM'; });
    await page.waitForSelector('.gm-stage');
    assert((await page.evaluate(() => window.CNPE_GAME.debug().reduceMotion)), 'a new game visit reads the current reduced-motion preference');
    await page.focus('.gm-stage');
    const reduced = await page.evaluate(() => {
      document.querySelector('.gm-stage').dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
      return /** @type {HTMLElement} */ (document.querySelector('.gm-transition')).hidden;
    });
    assert(reduced, 'a scene transition stays hidden after the motion preference changes off-route');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  for (const leave of [false, true]) await group('pending sound startup: ' + (leave ? 'old visit cannot mute the new one' : 'can be cancelled immediately'), async () => {
    const { ctx, page } = await fresh(seed);
    await page.addInitScript(() => {
      const NativeAudio = window.AudioContext, w = /** @type {*} */ (window);
      w.audioStarts = [];
      window.AudioContext = class extends NativeAudio {
        resume() {
          return new Promise((resolve, reject) => { w.audioStarts.push({ resolve, reject }); });
        }
      };
    });
    await page.goto(url('console.html') + '#GM');
    await page.waitForSelector('.gm-stage');
    const sound = page.locator('.gm-tools button[aria-pressed]');
    await sound.click();
    if (leave) {
      await page.evaluate(() => { location.hash = '#1.1'; });
      await page.waitForFunction(() => !document.getElementById('game-app'));
      await page.evaluate(() => { location.hash = '#GM'; });
      await page.waitForSelector('.gm-stage');
      await sound.click();
      await page.evaluate(() => /** @type {*} */ (window).audioStarts[1].resolve());
      assert(await sound.getAttribute('aria-pressed') === 'true', 'sound starts for the new visit');
      await page.evaluate(() => /** @type {*} */ (window).audioStarts[0].reject(new Error('The old context closed during startup')));
      assert(await sound.getAttribute('aria-pressed') === 'true', 'an old startup rejection cannot turn off sound in the current visit');
    } else {
      assert(await sound.getAttribute('aria-pressed') === 'true', 'sound reflects the requested state while startup is pending');
      await sound.click();
      await page.evaluate(() => /** @type {*} */ (window).audioStarts.forEach((/** @type {{ resolve: () => void }} */ start) => start.resolve()));
      assert(await sound.getAttribute('aria-pressed') === 'false', 'a late startup completion does not undo the mute request');
    }
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('transitions, opt-in sound and bundle teardown', async () => {
    const { ctx, page } = await fresh(seed);
    await page.addInitScript(() => {
      const NativeAudio = window.AudioContext, w = /** @type {*} */ (window);
      w.audioContexts = [];
      window.AudioContext = class extends NativeAudio {
        constructor() { super(); w.audioContexts.push(this); }
      };
    });
    await page.goto(url('console.html') + '#GM');
    await page.waitForSelector('.gm-stage');
    assert((await page.evaluate(() => /** @type {*} */ (window).audioContexts.length)) === 0, 'opening the game creates no audio context');
    const sound = page.getByRole('button', { name: 'Sound: off', exact: true });
    await sound.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('.gm-tools [aria-pressed="true"]');
    assert((await page.evaluate(() => /** @type {*} */ (window).audioContexts[0].state)) === 'running', 'sound can be enabled with the keyboard while on the map');
    await page.getByRole('button', { name: 'Sound: on', exact: true }).click();
    assert(await sound.getAttribute('aria-pressed') === 'false', 'sound can be muted immediately');
    await sound.click();
    await page.focus('.gm-stage');
    const wipe = await page.evaluate(() => {
      document.querySelector('.gm-stage').dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
      const e = document.querySelector('.gm-transition');
      return { hidden: /** @type {HTMLElement} */ (e).hidden, animation: getComputedStyle(e).animationName };
    });
    assert(!wipe.hidden && wipe.animation === 'gm-travel', 'scene changes play a transition when motion is enabled');
    await settle(page);
    assert(!(await page.isVisible('.gm-transition')), 'a transition settles without blocking interaction');
    await page.evaluate(() => { location.hash = '#1.1'; });
    await page.waitForFunction(() => !document.getElementById('game-app'));
    await page.waitForFunction(() => /** @type {*} */ (window).audioContexts[0].state === 'closed');
    const clean = await page.evaluate(() => window.CNPE_GAME.debug());
    assert(!clean.mounted && clean.timers === 0 && clean.listeners === 0, 'leaving the bundle closes sound and removes timers and listeners');
    await page.evaluate(() => { location.hash = '#GM'; });
    await page.waitForSelector('.gm-stage');
    assert(await page.getByRole('button', { name: 'Sound: off', exact: true }).count() === 1, 'returning has one toolbar and starts silently');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
