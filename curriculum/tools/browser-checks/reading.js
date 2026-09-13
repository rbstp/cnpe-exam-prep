'use strict';
const fs = require('fs');
const path = require('path');
const AxeBuilder = require('@axe-core/playwright').default;

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { fresh, url, assert, group } = h;
  const lesson = '02-gitops/02-argocd.html';

  await group('the curriculum link only appears away from the overview', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const bundled of [false, true]) {
      const overview = url(bundled ? 'console.html' : 'index.html');
      const reading = bundled ? overview + '#2.2' : url(lesson);
      await page.goto(overview);
      assert(await page.locator('.reading-home').count() === 0, 'overview has no self-link' + (bundled ? ' in the bundle' : ''));
      await page.evaluate(() => { window.CNPE_BOOT(); });
      assert(await page.locator('.reading-home').count() === 0, 'repainting the overview does not add the self-link');
      await page.goto(reading);
      assert(await page.locator('.reading-home').count() === 1, 'lesson retains one curriculum link');
      await page.locator('.reading-home').click();
      await page.waitForSelector('#domain-grid');
      assert(await page.locator('.reading-home').count() === 0, 'returning to the overview removes the back link');
    }
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('reading controls preserve the document and real progress', async () => {
    const { ctx, page } = await fresh({ done: { '1.1': 1 }, game: { flags: { intro: 1 } } });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url(lesson));
    const payload = await page.locator('article .cb pre code').allTextContents();
    const source = fs.readFileSync(path.join(h.siteDir, lesson), 'utf8');
    const original = await page.evaluate(src => {
      const doc = new DOMParser().parseFromString(src, 'text/html');
      return Array.from(doc.querySelectorAll('article .cb pre code')).map(c => c.textContent);
    }, source);
    assert(JSON.stringify(payload) === JSON.stringify(original), 'rendered commands and captured outputs exactly match the authored lesson');
    const sizes = await page.evaluate(() => ({
      crumb: getComputedStyle(document.querySelector('.crumbs')).fontSize,
      weight: getComputedStyle(document.querySelector('.crumbs')).fontWeight,
      body: getComputedStyle(document.body).fontSize,
      measure: document.querySelector('#application').getBoundingClientRect().width,
      menu: Array.from(document.querySelectorAll('.toc a')).every(a => +getComputedStyle(a).fontWeight >= 650),
    }));
    assert(sizes.crumb === '16px' && +sizes.weight >= 600, 'desktop breadcrumb is 16px semibold');
    assert(sizes.body === '18px' && sizes.measure >= 940, '18px reading copy uses the available desktop column');
    assert(sizes.menu, 'all navigation links use bold text');
    await page.locator('.reading-modes a', { hasText: 'Practice' }).click();
    assert(await page.evaluate(() => document.activeElement.id === 'exercises'), 'Practice jumps and transfers focus without hiding content');
    await page.locator('.exercise .mark').first().click();
    assert((await h.store(page)).ex && Object.values((await h.store(page)).ex).filter(Boolean).length === 1, 'verification uses the existing progress store');
    await page.locator('.reading-modes a', { hasText: 'Recall' }).click();
    assert(await page.evaluate(() => document.activeElement.id === 'selfcheck'), 'Recall reaches the original self-check');
    await page.locator('.reading-size').click();
    assert(await page.evaluate(() => getComputedStyle(document.body).fontSize) === '21px', 'larger text is 21px');
    await page.reload();
    assert(await page.locator('.reading-size').getAttribute('aria-pressed') === 'true', 'reading size persists across reloads');
    await page.locator('.focusbtn').click();
    assert(!(await page.locator('#toc').isVisible()), 'focus view removes the navigation rail');
    await page.locator('.reading-menu').click();
    assert(await page.locator('#toc').isVisible(), 'contents remain reachable in focus view');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => document.activeElement.classList.contains('reading-menu')), 'Escape closes contents and returns focus');
    await page.keyboard.press('f');
    assert(await page.locator('.focusbtn').getAttribute('aria-pressed') === 'false', 'f exits focus view');
    await page.evaluate(() => { window.CNPE_BOOT(); window.CNPE_BOOT(); });
    assert(await page.locator('.reading-size').count() === 1 && await page.locator('.reading-modes').count() === 1, 'cross-tab reboots do not duplicate reading controls');
    assert(JSON.stringify(payload) === JSON.stringify(await page.locator('article .cb pre code').allTextContents()), 'copy payloads remain unchanged after interactions and reboots');
    const store = await h.store(page);
    assert(store.done['1.1'] === 1 && store.game.flags.intro === 1 && !('readingSize' in store), 'existing section and game progress survive; preferences stay outside sync');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('mobile contents and bundled routes reach every exercise directly', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url('console.html') + '#2.2');
    await page.locator('.reading-menu').click();
    await page.locator('.reading-exercises summary').click();
    const count = await page.locator('.reading-exercises a').count();
    const onPage = await page.locator('.exercise').count();
    assert(count === onPage && count >= 5, 'every exercise is indexed: ' + count + ' of ' + onPage);
    await page.locator('.reading-exercises a').last().click();
    assert(page.url().includes('#2.2/ex-'), 'exercise navigation retains the lesson in its shareable bundle route');
    await page.waitForFunction(() => document.activeElement.id === location.hash.split('/')[1]);
    assert(!(await page.locator('#toc').isVisible()), 'choosing an exercise closes mobile navigation');
    assert(await page.evaluate(() => !!document.activeElement.closest('.exercise')), 'the chosen exercise receives keyboard focus');
    await page.locator('.exercise').last().locator('.disc').click();
    await page.locator('.reading-menu').click();
    await page.locator('.reading-exercises a').last().click();
    assert(!(await page.locator('.exercise').last().evaluate(e => e.classList.contains('collapsed'))), 'direct access expands a collapsed exercise');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile document does not scroll horizontally');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('the live sync model does not cure a broken desired state by reapplying it', async () => {
    const { ctx, page } = await fresh();
    await page.goto(url(lesson));
    const model = page.locator('[data-widget="syncmatrix"]');
    const values = () => model.locator('.sync-model .wverdict').allTextContents();
    assert(JSON.stringify(await values()) === '["Synced","Degraded"]', 'the initial state matches Git but cannot run');
    await model.getByRole('button', { name: 'Apply desired state', exact: true }).click();
    assert(JSON.stringify(await values()) === '["Synced","Degraded"]', 'reapplying a missing image stays degraded');
    await model.getByLabel('Git specifies a missing image').uncheck();
    assert(JSON.stringify(await values()) === '["OutOfSync","Degraded"]', 'fixing Git changes sync, not live health');
    await model.getByRole('button', { name: 'Apply desired state', exact: true }).click();
    assert(JSON.stringify(await values()) === '["Synced","Healthy"]', 'applying the corrected image makes the model healthy');
    await model.getByLabel('Git specifies a missing image').check();
    assert(JSON.stringify(await values()) === '["OutOfSync","Healthy"]', 'a bad new commit does not break the live image until applied');
    await model.getByRole('button', { name: 'Apply desired state', exact: true }).click();
    assert(JSON.stringify(await values()) === '["Synced","Degraded"]', 'applying the bad commit degrades health again');
    await model.getByRole('button', { name: 'Reset model', exact: true }).click();
    assert(await model.getByLabel('Git specifies a missing image').isChecked(), 'reset restores the model control too');
    const chips = model.locator('.wchip');
    for (let i = 0; i < await chips.count(); i++) {
      await chips.nth(i).focus();
      await page.keyboard.press('Enter');
      assert(await chips.nth(i).getAttribute('aria-pressed') === 'true', 'diagnostic state ' + (i + 1) + ' is keyboard-operable and announces its selection');
    }
    await ctx.close();
  });

  const figures = [
    ['01-architecture/01-networking.html', 'netpath'],
    ['01-architecture/02-compute-right-sizing.html', 'qos'],
    ['01-architecture/02-compute-right-sizing.html', 'capacity'],
    ['01-architecture/04-multi-tenancy.html', 'quota'],
    ['01-architecture/05-cost.html', 'efficiency'],
    ['02-gitops/01-gitops-fundamentals.html', 'gitops'],
    [lesson, 'syncmatrix'],
    ['02-gitops/05-progressive-delivery.html', 'canary'],
    ['04-observability/01-prometheus.html', 'promrate'],
    ['04-observability/02-alerting.html', 'alertstate'],
    ['05-security/01-rbac-and-secrets.html', 'rbacscope'],
    ['05-security/02-policy-engines.html', 'admission'],
    ['05-security/03-pod-security-standards.html', 'pss'],
  ];
  for (const theme of ['dark', 'light']) {
    await group(theme + ': all 13 models are readable and interactive on desktop and mobile', async () => {
      const { ctx, page } = await fresh(null, { theme, reducedMotion: 'reduce' });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [file, kind] of figures) {
          // Axe reads stylesheets with XHR, which file:// forbids. The bundle
          // has the identical styles inline and also exercises offline routing.
          const source = fs.readFileSync(path.join(h.siteDir, file), 'utf8');
          const id = /<body[^>]*data-id="([^"]+)"/.exec(source)[1];
          await page.goto(url('console.html') + '#' + id);
          const model = page.locator('[data-widget="' + kind + '"]');
          const output = () => model.locator('.wout, .wnote').allTextContents();
          const before = JSON.stringify(await output());
          const slider = model.locator('input[type="range"]:enabled').first();
          if (await slider.count()) {
            await slider.focus();
            await page.keyboard.press('End');
          } else if (kind === 'gitops' || kind === 'canary') {
            await model.locator('.wbtn').first().click();
          } else if (kind === 'rbacscope') {
            await model.getByRole('button', { name: 'ClusterRole', exact: true }).click();
          } else {
            await model.locator('input[type="checkbox"]').first().click();
          }
          assert(JSON.stringify(await output()) !== before, width + 'px ' + kind + ': changing a control updates the model output');
          const layout = await model.evaluate(m => {
            const r = m.getBoundingClientRect();
            return {
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              bounds: r.left >= 0 && r.right <= innerWidth + 1,
              readable: Array.from(m.querySelectorAll('.wk, .wv, .wnote, .whint, .wtog, .wlbl, .wchip, .wbtn'))
                .every(e => parseFloat(getComputedStyle(e).fontSize) >= 12),
              controls: Array.from(m.querySelectorAll('button, input[type="range"], .wtog'))
                .every(e => e.getBoundingClientRect().height >= 44),
            };
          });
          assert(!layout.overflow && layout.bounds && layout.readable && layout.controls,
            width + 'px ' + kind + ': visible bounds, 12px+ labels and 44px controls ' + JSON.stringify(layout));
          const axe = await new AxeBuilder({ page }).include('[data-widget="' + kind + '"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          assert(axe.violations.length === 0, width + 'px ' + kind + ': accessible model ' +
            axe.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')).join(' | '));
        }
      }
      assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
      await ctx.close();
    });
  }
};
