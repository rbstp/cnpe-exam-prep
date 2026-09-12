'use strict';
const fs = require('fs');
const path = require('path');

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { fresh, url, assert, group } = h;
  await group('section captions are removed without hiding the headings or lesson', async () => {
    const { ctx, page } = await fresh();
    for (const file of ['index.html', '05-security/02-policy-engines.html', 'mock-exam.html']) {
      await page.goto(url(file));
      const state = await page.evaluate(() => ({
        captions: Array.from(document.querySelectorAll('.panel > .phdr .meta'))
          .some(e => getComputedStyle(e).display !== 'none'),
        headings: Array.from(document.querySelectorAll('.panel > .phdr h2'))
          .every(e => getComputedStyle(e).display !== 'none'),
        prose: document.querySelector('.pbody p').getBoundingClientRect().height > 0,
      }));
      assert(!state.captions && state.headings && state.prose, file + ': section titles and content remain without the small subheaders');
    }
    await ctx.close();
  });

  await group('the type scale: title, reading copy, breadcrumb and sidebars', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(url('05-security/02-policy-engines.html'));
    const sizes = await page.evaluate(() => {
      const size = (/** @type {string} */ selector) => getComputedStyle(document.querySelector(selector)).fontSize;
      return {
        title: size('.pagehead h1'), body: size('body'), crumb: size('.crumbs'),
        nav: size('.reading-outline a'), label: size('.stat .lbl'), value: size('.stat .val'),
      };
    });
    assert(sizes.title === '32px', 'desktop title is 32px');
    assert(sizes.body === '18px' && sizes.crumb === '16px', 'reading copy is 18px and the breadcrumb 16px');
    assert(sizes.nav === '14px' && sizes.label === '13px' && sizes.value === '16px',
      'sidebars use a consistent, readable supporting scale');
    await page.setViewportSize({ width: 390, height: 900 });
    assert(await page.locator('.pagehead h1').evaluate(e => getComputedStyle(e).fontSize) === '28px',
      'mobile title is 28px');
    await ctx.close();
  });

  await group('wide tables use the available desktop reading space', async () => {
    const { ctx, page } = await fresh();
    const file = '05-security/02-policy-engines.html';
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 1600, 1920, 2000]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(url(file));
        await page.evaluate(t => window.CNPE_THEME.set(t), theme);
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => {
          const table = document.querySelector('#dialects .tbl-wrap');
          const article = document.querySelector('article').getBoundingClientRect();
          return {
            width: table.clientWidth, content: table.scrollWidth,
            rightGap: innerWidth - article.right,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        assert(layout.content <= layout.width + 1 && layout.rightGap <= 1 && !layout.overflow,
          theme + ' ' + width + 'px: policy comparison fits without scrolling or a wasted right gutter ' + JSON.stringify(layout));
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'narrow screens keep table scrolling inside its container');
    await ctx.close();
  });

  await group('desktop tables tolerate wider font metrics and increased text spacing', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ['dark', 'light']) {
      await page.goto(url('05-security/02-policy-engines.html'));
      await page.evaluate(t => window.CNPE_THEME.set(t), theme);
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: '.tbl-wrap table { letter-spacing: .12em; }' });
      const layout = await page.locator('#dialects .tbl-wrap').evaluate(table => ({
        width: table.clientWidth,
        content: table.scrollWidth,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      assert(layout.content <= layout.width + 1 && !layout.overflow,
        theme + ': wider text still fits the desktop comparison table ' + JSON.stringify(layout));
      assert(await page.locator('.cb pre code').first().evaluate(code => getComputedStyle(code).whiteSpace) === 'pre',
        'command blocks do not wrap');
    }
    await ctx.close();
  });

  await group('table headers stay on one line', async () => {
    const { ctx, page } = await fresh();
    // every page with a table: which label breaks depends on that table's content
    /** @type {string[]} */
    const files = [];
    (function walk(/** @type {string} */ dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.html') && fs.readFileSync(full, 'utf8').includes('<thead')) {
          files.push(path.relative(h.siteDir, full));
        }
      }
    })(h.siteDir);
    assert(files.length >= 20, 'the sweep found the pages with tables (' + files.length + ')');
    for (const width of [390, 768, 1180, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      /** @type {string[]} */
      const wrapped = [];
      /** @type {string[]} */
      const overflowed = [];
      for (const file of files) {
        await page.goto(url(file));
        await page.evaluate(() => document.fonts.ready);
        const state = await page.evaluate(() => {
          // line boxes, not computed white-space: what the reader actually sees
          const lines = (/** @type {Element} */ th) => {
            const range = document.createRange();
            range.selectNodeContents(th);
            return new Set(Array.from(range.getClientRects())
              .filter(r => r.width || r.height).map(r => Math.round(r.top))).size;
          };
          return {
            wrapped: Array.from(document.querySelectorAll('thead th'))
              .filter(th => lines(th) > 1).map(th => th.textContent.trim()),
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        for (const label of state.wrapped) wrapped.push(file + ' "' + label + '"');
        if (state.overflow) overflowed.push(file);
      }
      assert(wrapped.length === 0,
        width + 'px: every header cell renders on one line' + (wrapped.length ? ': ' + wrapped.join(', ') : ''));
      // a header row that cannot wrap raises the table's minimum width
      assert(overflowed.length === 0,
        width + 'px: no page scrolls sideways to fit a header row' + (overflowed.length ? ': ' + overflowed.join(', ') : ''));
    }
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('reading controls do not overlap wrapped page headings', async () => {
    const { ctx, page } = await fresh();
    /** @type {[string, number][]} */
    const cases = [
      ['mock-exam-2.html', 320],
      ['01-architecture/01-networking.html', 390],
      ['03-platform-apis/06-kro-backstage-choosing.html', 640],
      ['02-gitops/02-argocd.html', 1440],
    ];
    for (const [file, width] of cases) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url(file));
      await page.evaluate(() => document.fonts.ready);
      const overlap = await page.evaluate(() => {
        const control = document.querySelector('.reading-size').getBoundingClientRect();
        return Array.from(document.querySelectorAll('.pagehead .eyebrow, .pagehead h1')).some(el => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if (Array.from(range.getClientRects()).some(r =>
              r.left < control.right && r.right > control.left &&
              r.top < control.bottom && r.bottom > control.top)) return true;
          }
          return false;
        });
      });
      assert(!overlap, file + ': Aa does not cover heading text at ' + width + 'px');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        file + ': heading does not overflow');
    }
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('the error page does not reserve a nonexistent sidebar', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('https://reading.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' :
        name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
      return route.fulfill({ body: fs.readFileSync(path.join(h.siteDir, name)), contentType: type });
    });
    await page.goto('https://reading.test/404.html');
    const centered = await page.evaluate(() => {
      const article = document.querySelector('article').getBoundingClientRect();
      return Math.abs(article.left - (innerWidth - article.right)) <= 1;
    });
    assert(centered, 'the error article is centered in the full viewport');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
