import { chromium } from 'playwright';
const B = 'http://127.0.0.1:8099';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const noFs = () => { delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen; };
async function mk(vp, init) {
  const ctx = await br.newContext({ viewport: vp || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  return { ctx, page };
}
async function boot(page, url = '/game.html') {
  await page.goto(B + url);
  await page.waitForSelector('.gm-stage canvas');
  for (let i = 0; i < 5; i++) {
    const b = page.locator('.gm-dialog button').first();
    if (!(await b.count()) || !(await b.isVisible())) break;
    await b.click();
  }
  await page.evaluate(() => document.querySelector('.gm-stage').focus({ preventScroll: true }));
}
const snap = p => p.evaluate(() => {
  const bar = document.querySelector('.topbar'); const bb = bar.getBoundingClientRect();
  return { y: window.scrollY, barTop: Math.round(bb.top), pos: getComputedStyle(bar).position,
    docH: document.documentElement.scrollHeight, vh: innerHeight,
    cover: (() => { const e = document.elementFromPoint(640, 25); return e ? e.tagName + '.' + e.className : null; })() };
});
console.log('=== stacking, step by step (no native fullscreen) ===');
{
  const { ctx, page } = await mk(null, noFs);
  await boot(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log(' before f  ', JSON.stringify(await snap(page)));
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  console.log(' after f   ', JSON.stringify(await snap(page)));
  await page.screenshot({ path: '/tmp/claude-0/probe/stack0.png' });
  await ctx.close();
}
console.log('=== same, but scrolled to 30px first ===');
{
  const { ctx, page } = await mk(null, noFs);
  await boot(page);
  await page.evaluate(() => window.scrollTo(0, 30));
  console.log(' before f  ', JSON.stringify(await snap(page)));
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  console.log(' after f   ', JSON.stringify(await snap(page)));
  await page.screenshot({ path: '/tmp/claude-0/probe/stack30.png' });
  await ctx.close();
}
console.log('=== and with the topbar forced to its sticky spot: overlay z-index vs topbar in the same root ===');
{
  const { ctx, page } = await mk(null, noFs);
  await boot(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    // paint order: which of the two wins where they overlap. Force them to overlap by
    // giving the bar a fixed position at the top, which is what sticky does on a scrolled page
    const bar = document.querySelector('.topbar');
    bar.style.position = 'fixed'; bar.style.top = '0';
    const e = document.elementFromPoint(640, 25);
    return { at: e && e.tagName + '.' + e.className, inBar: !!(e && e.closest('.topbar')) };
  });
  console.log(' ', JSON.stringify(r));
  await page.screenshot({ path: '/tmp/claude-0/probe/stack-forced.png' });
  await ctx.close();
}
await br.close();
