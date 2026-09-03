/* The command palette and the global keyboard shortcuts. */
'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, store, assert, group } = h;

  /** @param {import('playwright').Page} page */
  const paletteOpen = page => page.evaluate(() => {
    const o = document.querySelector('.overlay.open .palette');
    return !!o;
  });
  /** @param {import('playwright').Page} page */
  const selIndex = page => page.evaluate(() => {
    const lis = document.querySelectorAll('#palette-list li');
    for (let i = 0; i < lis.length; i++) if (lis[i].classList.contains('sel')) return i;
    return -1;
  });

  /* A key that did nothing leaves the URL matching whatever it matched before, so
     a check on where it went has to require the address to change, or a shortcut
     that stopped working passes the check written for the one after it. The old
     address is read before the key: the navigation can beat a read taken after. */
  /** @param {import('playwright').Page} page @param {string} key @param {(href: string) => boolean} at */
  const pressTo = async (page, key, at) => {
    const from = page.url();
    await page.keyboard.press(key);
    return page.waitForURL(u => u.href !== from && at(u.href), { timeout: 5000 })
      .then(() => true, () => false);
  };

  /* 1. open, filter, arrow-drive, Enter navigates */
  await group('palette: / opens, filter narrows, Enter opens the selection', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    await page.keyboard.press('/');
    assert(await paletteOpen(page), '/ opens the palette');
    assert(await page.evaluate(() => document.activeElement === document.querySelector('.palette input')),
      'the search input has focus');
    const total = await page.evaluate(() => document.querySelectorAll('#palette-list li').length);
    assert(total >= 30, 'unfiltered list carries every section: ' + total);
    assert((await selIndex(page)) === 0, 'first row selected by default');
    await page.keyboard.press('ArrowDown');
    assert((await selIndex(page)) === 1, 'ArrowDown moves the selection');
    await page.keyboard.press('ArrowUp');
    assert((await selIndex(page)) === 0, 'ArrowUp moves it back');
    await page.keyboard.press('ArrowUp');
    assert((await selIndex(page)) === 0, 'ArrowUp stops at the top');

    await page.keyboard.type('platform networking');
    const first = await page.evaluate(() => {
      const li = document.querySelector('#palette-list li');
      return li ? li.querySelector('.pid').textContent : '(no rows)';
    });
    assert(first === '1.1', 'first match for "platform networking" is 1.1: ' + JSON.stringify(first));
    const hint = await page.evaluate(() => document.getElementById('palette-hint').textContent);
    assert(/match/.test(hint), 'hint reports the match count: ' + JSON.stringify(hint));
    assert(await pressTo(page, 'Enter', href => /01-networking\.html/.test(href)),
      'Enter navigates to the selected section');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 1b. opened from a section, the list starts on that section */
  await group('palette: opens on the section being read, and ⏎ there closes rather than reloads', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('04-observability/01-prometheus.html'));
    await page.keyboard.press('/');
    assert(await paletteOpen(page), '/ opens the palette');
    const pid = await page.evaluate(() => {
      const li = document.querySelector('#palette-list li.sel');
      return li ? li.querySelector('.pid').textContent : '(nothing selected)';
    });
    assert(pid === '4.1', 'the selected row is the section being read, not 1.1: ' + JSON.stringify(pid));
    // that row is well down a 30-row list, so it has to have been scrolled to
    assert(await page.evaluate(() => {
      const li = document.querySelector('#palette-list li.sel'), ul = document.getElementById('palette-list');
      const a = li.getBoundingClientRect(), b = ul.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    }), 'and it is scrolled into view rather than left off the end');

    // ⏎ on the page you are already on has nowhere to go: it should not reload
    // a reload wipes the DOM, so a mark on the root outlives one only if none happened
    await page.evaluate(() => { document.documentElement.dataset.stillHere = '1'; });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert(await page.evaluate(() => document.documentElement.dataset.stillHere === '1'),
      '⏎ on the current section does not reload the page');
    assert(!(await paletteOpen(page)), 'it closes the palette instead');
    assert(/01-prometheus\.html/.test(page.url()), 'and leaves the address alone: ' + page.url());

    // typing still overrides the preselection: a query re-selects from the top
    await page.keyboard.press('/');
    await page.keyboard.type('tekton');
    assert((await selIndex(page)) === 0, 'a query puts the selection back on the first match');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 2. no match, Escape, ⌘K, and the palette owns single-key shortcuts */
  await group('palette: no-match hint, Escape closes, ctrl-K reopens, keys stay in the input', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('index.html'));
    await page.keyboard.press('/');
    await page.keyboard.type('zzzz-no-such-thing');
    const hint = await page.evaluate(() => document.getElementById('palette-hint').textContent);
    assert(/no section matches/.test(hint), 'hint says nothing matches: ' + JSON.stringify(hint));
    assert(await page.evaluate(() => document.querySelectorAll('#palette-list li').length) === 0, 'zero rows');
    await page.keyboard.press('Escape');
    assert(!(await paletteOpen(page)), 'Escape closes the palette');
    await page.keyboard.press('Control+k');
    assert(await paletteOpen(page), 'ctrl-K reopens it, empty again');
    assert(await page.evaluate(() => /** @type {HTMLInputElement} */ (document.querySelector('.palette input')).value) === '', 'reopen clears the query');
    // g is a navigation shortcut everywhere else; inside the input it is just a letter
    await page.keyboard.press('g');
    assert(/index\.html/.test(page.url()), 'g inside the palette does not navigate');
    assert(await page.evaluate(() => /** @type {HTMLInputElement} */ (document.querySelector('.palette input')).value) === 'g', 'g landed in the query');
    await page.keyboard.press('Escape');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 3. single-key navigation from a section page */
  await group('shortcuts: n/p/d/g navigate, m completes, ? opens help', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    const nextPath = await page.evaluate(() => {
      const NAV = window.CNPE_NAV, i = NAV.findIndex(n => n.id === '1.1');
      return NAV[i + 1].path;
    });
    assert(await pressTo(page, 'n', href => href.indexOf(nextPath.split('/').pop()) >= 0),
      'n opens the next section: ' + nextPath);
    assert(await pressTo(page, 'p', href => /01-networking\.html/.test(href)),
      'p goes back to the previous one');

    await page.keyboard.press('?');
    assert(await page.evaluate(() => !!document.querySelector('.overlay.open .helpcard')), '? opens the help card');
    // An overlay blurs what shows through it, so a wheel reaching the page behind
    // re-blurs the viewport per frame and moves the reader's place under a scrim.
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'),
      'the page behind the help card cannot scroll');
    // the modal owns the keyboard: n must not navigate while the help card is open
    await page.keyboard.press('n');
    assert(await page.evaluate(() => !!document.querySelector('.overlay.open .helpcard')),
      'the help card still owns the keyboard after n');
    assert(/01-networking\.html/.test(page.url()), 'n is inert while the help card is open');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('.overlay.open') && !!document.querySelector('.finish')),
      'Escape closes the help card, still on the section page');
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden'),
      'and hands scrolling back');

    await page.keyboard.press('m');
    let s = await store(page);
    assert(s.done['1.1'] === 1, 'm marks the section complete');
    const prog = await page.evaluate(() => document.querySelector('.topbar .prog').textContent);
    assert(/^1\/29/.test(prog.trim()), 'topbar progress shows 1/29: ' + JSON.stringify(prog));
    await page.keyboard.press('m');
    s = await store(page);
    assert(!s.done['1.1'], 'm again un-marks it');

    assert(await pressTo(page, 'd', href => /index\.html/.test(href)), 'd returns to the dashboard');
    assert(await pressTo(page, 'g', href => /drill\.html/.test(href)), 'g opens the drill');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 4. x jumps to the exercises, c collapses and expands them all */
  await group('shortcuts: x and c work the exercise panel', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    assert((await page.evaluate(() => window.scrollY)) === 0, 'the page starts at the top');
    await page.keyboard.press('x');
    // the console scrolls smoothly, so give the animation a moment
    const scrolled = await page.waitForFunction(() => window.scrollY > 1000, null, { timeout: 5000 })
      .then(() => true, () => false);
    assert(scrolled, 'x scrolls down to the exercises');
    const counts = () => page.evaluate(() => ({
      all: document.querySelectorAll('.exercise').length,
      collapsed: document.querySelectorAll('.exercise.collapsed').length,
    }));
    let c = await counts();
    assert(c.all > 0 && c.collapsed === 0, 'exercises start expanded: ' + JSON.stringify(c));
    await page.keyboard.press('c');
    c = await counts();
    assert(c.collapsed === c.all, 'c collapses every exercise: ' + JSON.stringify(c));
    await page.keyboard.press('c');
    c = await counts();
    assert(c.collapsed === 0, 'c again expands them all');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
