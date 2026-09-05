/* Accessibility checks for the shared page shell and representative content.

   The cheap DOM checks visit every staged page. Axe then covers the dashboard,
   a widget page, the drill, the mock exam and the single-file bundle in both
   themes. This keeps the broad structural promises cheap while still exercising
   the components that previously produced violations after app.js built them. */
'use strict';
const fs = require('fs');
const path = require('path');

let AxeBuilder = null;
try { AxeBuilder = require('@axe-core/playwright').default; } catch (e) {}

/** @param {string} dir @return {string[]} */
function htmlPages(dir) {
  /** @type {string[]} */
  const pages = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.html')) pages.push(path.relative(dir, f).split(path.sep).join('/'));
    }
  })(dir);
  return pages.sort();
}

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, siteDir, assert, group } = h;

  await group('every page has one main landmark and ordered headings', async () => {
    const pages = htmlPages(siteDir);
    assert(pages.length === 36, 'the staged site has all 36 pages');
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 640, height: 800 });
    for (const name of pages) {
      await page.goto(url(name));
      const state = await page.evaluate(() => {
        const ranks = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
          .filter(h => {
            const s = getComputedStyle(h);
            return s.display !== 'none' && s.visibility !== 'hidden';
          })
          .map(h => +h.tagName.slice(1));
        const skips = ranks.filter((n, i) => i > 0 && n > ranks[i - 1] + 1);
        const scroll = Array.from(document.querySelectorAll('pre')).filter(pre => {
          const x = getComputedStyle(pre).overflowX;
          return /auto|scroll/.test(x) && pre.scrollWidth > pre.clientWidth && pre.tabIndex < 0;
        }).length;
        return {
          mains: document.querySelectorAll('main, [role="main"]').length,
          skips: skips,
          groupedFigures: document.querySelectorAll('figure[role="group"]').length,
          unreachableScroll: scroll,
        };
      });
      const ok = state.mains === 1 && state.skips.length === 0 &&
        state.groupedFigures === 0 && state.unreachableScroll === 0;
      assert(ok, name + ': ' + JSON.stringify(state));
    }
    await ctx.close();
  });

  await group('axe finds no violations in representative pages and themes', async () => {
    if (!AxeBuilder) {
      assert(!process.env.CI, '@axe-core/playwright must be installed in CI (npm ci)');
      if (!process.env.CI) console.log('  note @axe-core/playwright is not installed; structural checks still ran');
      return;
    }
    const pages = ['index.html', '01-architecture/02-compute-right-sizing.html',
      'drill.html', 'mock-exam.html', 'console.html#1.2'];
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await fresh(null, { theme: theme });
      for (const name of pages) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(url(name.split('#')[0]) + (name.includes('#') ? '#' + name.split('#')[1] : ''));
        if (name.startsWith('console.html#')) {
          await page.waitForFunction(() => document.body.getAttribute('data-id') === '1.2');
        }
        const result = await new AxeBuilder({ page: page }).analyze();
        const summary = result.violations.map(v => v.id + ': ' +
          v.nodes.map(n => n.target.join(' ')).join(', ')).join(' | ');
        assert(result.violations.length === 0, theme + ' ' + name + ': ' + (summary || 'no violations'));
      }
      await ctx.close();
    }
  });
};
