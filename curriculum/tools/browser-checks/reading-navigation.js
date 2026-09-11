'use strict';

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { fresh, url, assert, group } = h;
  const lesson = '02-gitops/02-argocd.html';
  await group('normal reading links retain native fragment history', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url(lesson));
    await page.locator('.reading-outline a[href="#application"]').click();
    assert(page.url().endsWith('#application'), 'opening a topic updates its URL');
    await page.locator('.reading-modes a', { hasText: 'Recall' }).click();
    assert(page.url().endsWith('#selfcheck'), 'the next topic gets its own history entry');
    await page.goBack();
    assert(page.url().endsWith('#application'), 'Back returns to the prior topic, not the overview');
    await page.goForward();
    assert(page.url().endsWith('#selfcheck'), 'Forward returns to the next topic');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  await group('modified reading clicks are left to the browser', async () => {
    const { ctx, page } = await fresh();
    for (const address of [url(lesson), url('console.html') + '#2.2']) {
      await page.goto(address);
      for (const selector of ['.reading-outline a', '.reading-modes a', '.reading-exercises a']) {
        const intercepted = await page.locator(selector).first().evaluate(a => {
          let prevented = false;
          // Inspect the result after the application's handlers, then suppress
          // the synthetic event's default action to avoid opening a test tab.
          window.addEventListener('click', e => {
            prevented = e.defaultPrevented;
            e.preventDefault();
          }, { once: true });
          a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
          return prevented;
        });
        assert(!intercepted, selector + ': Ctrl-click is not intercepted');
      }
    }
    await ctx.close();
  });

  await group('bundled reading links work when copied, reloaded or opened separately', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url('console.html') + '#2.2');
    for (const selector of ['.reading-outline a', '.reading-modes a', '.reading-exercises a']) {
      const link = await page.locator(selector).last().evaluate(a => /** @type {HTMLAnchorElement} */ (a).href);
      const id = link.split('#2.2/')[1];
      assert(!!id, selector + ': link includes its lesson and target');
      const copied = await ctx.newPage();
      await copied.goto(link);
      assert(await copied.locator('body').getAttribute('data-id') === '2.2', 'opening the copied link renders Argo CD');
      assert(await copied.evaluate(() => document.activeElement.id) === id, 'the linked target receives focus');
      await copied.reload();
      assert(await copied.evaluate(() => document.activeElement.id) === id, 'reloading preserves the destination');
      await copied.close();
    }
    await page.getByLabel('Git specifies a missing image').uncheck();
    await page.locator('.reading-modes a', { hasText: 'Recall' }).click();
    assert(page.url().endsWith('#2.2/selfcheck'), 'ordinary navigation records the bundled topic');
    assert(!(await page.getByLabel('Git specifies a missing image').isChecked()), 'same-lesson navigation does not reset the interactive model');
    await page.locator('.reading-modes a', { hasText: 'Practice' }).click();
    await page.goBack();
    assert(page.url().endsWith('#2.2/selfcheck'), 'bundled Back returns to the prior topic');
    await page.waitForFunction(() => document.activeElement.id === 'selfcheck');
    assert(!(await page.getByLabel('Git specifies a missing image').isChecked()), 'history navigation also retains the model state');
    await page.locator('.skip').evaluate(a => /** @type {HTMLElement} */ (a).click());
    assert(page.url().endsWith('#2.2/main'), 'the bundled skip link stays in its lesson');
    assert(page.errors.length === 0, 'no browser errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
