/* The theme switch: the masthead button, the t shortcut, and what they persist.

   The other areas seed cnpe:theme and read the end state, which says nothing
   about the control that writes it. This drives the control. */
'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, assert, group } = h;

  /** @param {import('playwright').Page} page */
  const state = page => page.evaluate(() => ({
    pref: window.CNPE_THEME.pref(),
    resolved: window.CNPE_THEME.resolved(),
    attr: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('cnpe:theme'),
    title: (/** @type {HTMLButtonElement} */ (document.querySelector('.themebtn')) || { title: '' }).title,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim().toLowerCase(),
    metas: Array.from(document.querySelectorAll('meta[name="theme-color"]'))
      .map(m => m.getAttribute('content').toLowerCase()),
  }));

  await group('study pages default to dark and toggle light / dark', async () => {
    const { ctx, page } = await fresh();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(url('index.html'));
    let s = await state(page);
    assert(s.pref === 'dark' && s.attr === 'dark',
      'a browser that has never chosen starts dark even on a light system: ' + JSON.stringify([s.pref, s.attr]));
    assert(s.stored === null, 'and nothing is stored for it');
    assert(/switch to light \(t\)/.test(s.title), 'the button offers the next one: ' + JSON.stringify(s.title));

    await page.click('.themebtn');
    s = await state(page);
    assert(s.pref === 'light' && s.attr === 'light' && s.stored === 'light',
      'one click pins light: ' + JSON.stringify([s.pref, s.attr, s.stored]));
    assert(/Theme: light · switch to dark/.test(s.title), 'and the button repaints: ' + JSON.stringify(s.title));

    await page.click('.themebtn');
    s = await state(page);
    assert(s.pref === 'dark' && s.attr === 'dark' && s.stored === 'dark', 'the next pins dark');

    await page.click('.themebtn');
    s = await state(page);
    assert(s.pref === 'light' && s.attr === 'light', 'and the third returns to light');
    assert(s.stored === 'light', 'the preference is persisted');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 2. a pin outlives the page, and paints before anything can flash */
  await group('a pinned theme survives a reload', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    await page.click('.themebtn');
    const before = await state(page);
    await page.reload();
    const after = await state(page);
    assert(after.pref === 'light' && after.attr === 'light', 'the pin is still light after a reload');
    assert(after.ink === before.ink, 'painting the same ground: ' + after.ink);
    assert(after.metas.length > 0 && after.metas.every(c => c === after.ink),
      'and the chrome follows it: ' + JSON.stringify(after.metas));
    // a section page loads its own copy of theme.js and app.js
    await page.goto(url('01-architecture/01-networking.html'));
    const sec = await state(page);
    assert(sec.pref === 'light' && sec.attr === 'light', 'a section page reads the same pin');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 3. the keyboard reaches the same switch */
  await group('t cycles the theme, and not from inside the palette', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    assert((await state(page)).pref === 'dark', 'starting on dark');
    await page.keyboard.press('t');
    assert((await state(page)).pref === 'light', 't pins light');
    await page.keyboard.press('t');
    assert((await state(page)).pref === 'dark', 't again pins dark');

    await page.keyboard.press('/');
    await page.keyboard.press('t');
    const s = await state(page);
    assert(s.pref === 'dark', 't inside the palette does not switch: ' + s.pref);
    assert(await page.evaluate(() =>
      /** @type {HTMLInputElement} */ (document.querySelector('.palette input')).value) === 't',
      'it landed in the query instead');
    await page.keyboard.press('Escape');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 4. a junk pin is not a pin */
  await group('a stored theme nobody offers falls back to dark', async () => {
    const { ctx, page } = await fresh(null, { theme: 'chartreuse' });
    await page.goto(url('index.html'));
    const s = await state(page);
    assert(s.pref === 'dark' && s.attr === 'dark', 'junk reads as dark: ' + JSON.stringify([s.pref, s.attr]));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('the quest keeps its original system default and three-way switch', async () => {
    const { ctx, page } = await fresh();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(url('game.html'));
    let s = await state(page);
    assert(s.pref === 'system' && s.attr === null && s.ink === '#f3efe6', 'quest follows the light system with its original palette');
    await page.click('.themebtn');
    assert((await state(page)).pref === 'light', 'quest first pins light');
    await page.click('.themebtn');
    assert((await state(page)).pref === 'dark', 'quest next pins dark');
    await page.click('.themebtn');
    s = await state(page);
    assert(s.pref === 'system' && s.stored === null, 'quest then clears the pin');
    await page.goto(url('console.html') + '#2.2');
    assert((await state(page)).ink === '#171c1d', 'bundle starts with the study palette');
    await page.evaluate(() => { location.hash = '#GM'; });
    await page.waitForSelector('#game-app canvas');
    assert((await state(page)).ink === '#f3efe6', 'bundled quest restores the original palette');
    await page.evaluate(() => { location.hash = '#2.2'; });
    await page.waitForSelector('.reading-modes');
    assert((await state(page)).ink === '#171c1d', 'returning to study restores its dark default');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 5. the button is rebuilt on every boot, and one click must stay one cycle */
  await group('a repainted masthead does not double the switch', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    // what a storage event from another tab does: boot() runs again, topbar and all
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++) window.CNPE_BOOT();
    });
    assert((await page.evaluate(() => document.querySelectorAll('.themebtn').length)) === 1,
      'one button in the masthead');
    await page.click('.themebtn');
    const s = await state(page);
    assert(s.pref === 'light', 'and one click moved one step: ' + s.pref);
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
