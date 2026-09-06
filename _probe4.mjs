import { chromium } from 'playwright';
const B = 'http://127.0.0.1:8099';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const noFs = () => { delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen; };
async function mk(vp, init) {
  const ctx = await br.newContext({ viewport: vp || { width: 1280, height: 900 }, reducedMotion: 'reduce' });
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

console.log('=== 1. topbar over the fallback overlay, at the top of the page ===');
{
  const { ctx, page } = await mk({ width: 1400, height: 1400 }, noFs);
  await boot(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  console.log('  scrollY before f:', await page.evaluate(() => window.scrollY));
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const bar = document.querySelector('.topbar'), bb = bar.getBoundingClientRect();
    const e = document.elementFromPoint(700, 25);
    return { y: window.scrollY, barTop: Math.round(bb.top), barBottom: Math.round(bb.bottom),
      at: e && e.tagName + '.' + e.className, inBar: !!(e && e.closest('.topbar')),
      cls: document.getElementById('game-app').className };
  });
  console.log(' ', JSON.stringify(r));
  await page.screenshot({ path: '/tmp/claude-0/probe/topbar-over.png' });
  await ctx.close();
}

console.log('=== 2. scroll restore round trip (reduced motion, so scrollTo is instant) ===');
{
  const { ctx, page } = await mk(null, noFs);
  await boot(page);
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(200);
  const a = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const b = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => window.scrollY);
  console.log('  before', a, ' during', b, ' after', c, a === c ? 'RESTORED' : 'NOT RESTORED');
  await ctx.close();
}

console.log('=== 3. same but scrolled to the bottom of the page ===');
{
  const { ctx, page } = await mk(null, noFs);
  await boot(page);
  await page.evaluate(() => window.scrollTo(0, 99999));
  await page.waitForTimeout(200);
  const a = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const b = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => window.scrollY);
  console.log('  before', a, ' during', b, ' after', c, a === c ? 'RESTORED' : 'NOT RESTORED');
  await ctx.close();
}

console.log('=== 4. native path: unmount while fullscreen actually leaves it ===');
{
  const { ctx, page } = await mk();
  await boot(page);
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  console.log('  in:', await page.evaluate(() => ({ fs: !!document.fullscreenElement, cls: document.getElementById('game-app').className })));
  await page.evaluate(() => window.CNPE_GAME.unmount());
  await page.waitForTimeout(500);
  console.log('  after unmount:', await page.evaluate(() => ({ fs: !!document.fullscreenElement, cls: document.getElementById('game-app').className, lock: document.documentElement.className })));
  await ctx.close();
}

console.log('=== 5. bundle: route away while fullscreen, then back ===');
{
  const { ctx, page } = await mk();
  await boot(page, '/console.html#GM');
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  console.log('  in:', await page.evaluate(() => ({ fs: !!document.fullscreenElement, cls: document.getElementById('game-app').className, lock: document.documentElement.className })));
  await page.evaluate(() => { location.hash = '#index'; });
  await page.waitForTimeout(600);
  console.log('  after route:', await page.evaluate(() => ({ fs: !!document.fullscreenElement, ga: !!document.getElementById('game-app'), lock: document.documentElement.className, y: window.scrollY })));
  await ctx.close();
}
await br.close();
