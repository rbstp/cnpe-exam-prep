/* The command palette and the global keyboard shortcuts: open with / and ⌘K,
   filter, drive the selection with the arrows, navigate with Enter, close with
   Escape, and the single-key navigation (n/p/d/g, ? for help, m to complete)
   that must never fire while the palette owns the keyboard. */
'use strict';

module.exports = async function (h) {
  const { url, fresh, store, assert, group } = h;

  const paletteOpen = page => page.evaluate(() => {
    const o = document.querySelector('.overlay.open .palette');
    return !!o;
  });
  const selIndex = page => page.evaluate(() => {
    const lis = document.querySelectorAll('#palette-list li');
    for (let i = 0; i < lis.length; i++) if (lis[i].classList.contains('sel')) return i;
    return -1;
  });

  /* 1. open, filter, arrow-drive, Enter navigates */
  {
    group('palette: / opens, filter narrows, Enter opens the selection');
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
    await page.keyboard.press('Enter');
    await page.waitForURL(/01-networking\.html/);
    assert(true, 'Enter navigates to the selected section');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. no match, Escape, ⌘K, and the palette owns single-key shortcuts */
  {
    group('palette: no-match hint, Escape closes, ctrl-K reopens, keys stay in the input');
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
    assert(await page.evaluate(() => document.querySelector('.palette input').value) === '', 'reopen clears the query');
    // g is a navigation shortcut everywhere else; inside the input it is just a letter
    await page.keyboard.press('g');
    assert(/index\.html/.test(page.url()), 'g inside the palette does not navigate');
    assert(await page.evaluate(() => document.querySelector('.palette input').value) === 'g', 'g landed in the query');
    await page.keyboard.press('Escape');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. single-key navigation from a section page */
  {
    group('shortcuts: n/p/d/g navigate, m completes, ? opens help');
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    const nextPath = await page.evaluate(() => {
      const NAV = window.CNPE_NAV, i = NAV.findIndex(n => n.id === '1.1');
      return NAV[i + 1].path;
    });
    await page.keyboard.press('n');
    await page.waitForURL(u => u.href.indexOf(nextPath.split('/').pop()) >= 0);
    assert(true, 'n opens the next section: ' + nextPath);
    await page.keyboard.press('p');
    await page.waitForURL(/01-networking\.html/);
    assert(true, 'p goes back to the previous one');

    await page.keyboard.press('?');
    assert(await page.evaluate(() => !!document.querySelector('.overlay.open .helpcard')), '? opens the help card');
    // the modal owns the keyboard: n must not navigate while help is open
    await page.keyboard.press('n');
    assert(/01-networking\.html/.test(page.url()), 'n is inert while the help card is open');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => !document.querySelector('.overlay.open')), 'Escape closes the help card');

    await page.keyboard.press('m');
    let s = await store(page);
    assert(s.done['1.1'] === 1, 'm marks the section complete');
    const prog = await page.evaluate(() => document.querySelector('.topbar .prog').textContent);
    assert(/^1\/29/.test(prog.trim()), 'topbar progress shows 1/29: ' + JSON.stringify(prog));
    await page.keyboard.press('m');
    s = await store(page);
    assert(!s.done['1.1'], 'm again un-marks it');

    await page.keyboard.press('d');
    await page.waitForURL(/index\.html/);
    assert(true, 'd returns to the dashboard');
    await page.keyboard.press('g');
    await page.waitForURL(/drill\.html/);
    assert(true, 'g opens the drill');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 4. x jumps to the exercises, c collapses and expands them all */
  {
    group('shortcuts: x and c work the exercise panel');
    const { ctx, page } = await fresh();
    await page.goto(url('01-architecture/01-networking.html'));
    assert((await page.evaluate(() => window.scrollY)) === 0, 'the page starts at the top');
    await page.keyboard.press('x');
    // the console scrolls smoothly, so give the animation a moment
    await page.waitForFunction(() => window.scrollY > 1000);
    assert(true, 'x scrolls down to the exercises');
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
  }
};
