/* The figures the section pages draw.

   widgets.js swallows its own exceptions by design: a widget that throws paints
   "widget failed" into its mount and raises nothing on the console, and a mount
   whose data-widget names nothing in the registry is skipped in silence. Neither
   reaches page.errors, so no other area can see either one. check-site.sh pairs
   the attribute with the script tag, which is not the same as the figure being
   drawn. This area loads every page that draws one and reads the mounts. */
'use strict';
const fs = require('fs');
const path = require('path');

/** Every staged page carrying a mount, and the kinds each one asks for.
 *  Read off the disk rather than listed here, so a new figure is covered by
 *  the page that draws it and not by remembering to add it.
 *  @param {string} dir @return {{ page: string, kinds: string[] }[]} */
function figurePages(dir) {
  /** @type {string[]} */
  const html = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.html')) html.push(f);
    }
  })(dir);
  return html.sort().map(f => {
    const kinds = (fs.readFileSync(f, 'utf8').match(/data-widget="[^"]+"/g) || [])
      .map(m => m.slice(13, -1));
    return { page: path.relative(dir, f).split(path.sep).join('/'), kinds: kinds };
  }).filter(x => x.kinds.length > 0);
}

/** @param {import('playwright').Page} page */
const mountsOf = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('.widget')).map(m => ({
    kind: m.getAttribute('data-widget'),
    built: m.getAttribute('data-built') === '1',
    // the class alone is a figure's own vocabulary, so match the note's words
    failed: m.children.length === 1 && /^widget failed:/.test(m.textContent.trim()),
    kids: m.children.length,
  })));

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, siteDir, assert, group } = h;

  const pages = figurePages(siteDir).filter(p => p.page !== 'console.html');
  const drawn = new Set();

  await group('every figure on every page is drawn', async () => {
    assert(pages.length >= 12, 'the staged site carries figure pages: ' + pages.length);
    const { ctx, page } = await fresh();
    for (const p of pages) {
      await page.goto(url(p.page));
      const mounts = await mountsOf(page);
      const bad = mounts.filter(m => !m.built || m.failed || m.kids === 0);
      const short = mounts.length !== p.kinds.length
        ? ' (' + mounts.length + ' mounts for ' + p.kinds.length + ' kinds)' : '';
      // A kind the registry does not know is skipped without a word, and one that
      // throws is caught and written into the mount: neither raises an error.
      assert(mounts.length === p.kinds.length && bad.length === 0,
        p.page + ' drew ' + p.kinds.join(', ') + ': ' +
        (bad.length ? JSON.stringify(bad) : 'ok') + short);
      mounts.forEach(m => { if (m.built) drawn.add(m.kind); });
    }
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('the registry answers for every kind the site ships', async () => {
    const shipped = new Set(pages.reduce((/** @type {string[]} */ a, p) => a.concat(p.kinds), []));
    const missing = Array.from(shipped).filter(k => !drawn.has(k));
    assert(shipped.size >= 13, 'the site ships ' + shipped.size + ' kinds of figure');
    assert(missing.length === 0, 'each of them resolved and drew: ' + JSON.stringify(missing));
  });

  await group('a repaint does not draw a figure twice', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url(pages[0].page));
    const before = await page.evaluate(() =>
      document.querySelector('.widget').innerHTML.length);
    // a storage event re-boots the page, and boot() calls mount() again
    await page.evaluate(() => { window.CNPE_WIDGETS.mount(); window.CNPE_WIDGETS.mount(); });
    const after = await mountsOf(page);
    assert(after.length === 1 && after[0].kids === 1,
      'the mount still holds one figure: ' + JSON.stringify(after));
    assert((await page.evaluate(() =>
      document.querySelector('.widget').innerHTML.length)) === before,
      'and it was not rebuilt under it');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('the bundled console draws them too', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url('console.html') + '#1.1');
    await page.waitForFunction(() => !!document.querySelector('.widget'));
    const mounts = await mountsOf(page);
    assert(mounts.length > 0 && mounts.every(m => m.built && !m.failed && m.kids > 0),
      'the bundle drew the section figure: ' + JSON.stringify(mounts));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
