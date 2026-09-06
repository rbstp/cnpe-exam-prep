import { chromium } from 'playwright';
const B = 'http://127.0.0.1:8099';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function newPage(vp) {
  const ctx = await br.newContext({ viewport: vp || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [console error]', m.text()); });
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
  await page.focus('.gm-stage');
}

console.log('=== A: double toggle (two f presses in the same task) ===');
{
  const { ctx, page } = await newPage();
  await boot(page);
  // both clicks in one synchronous task, as a double-tap on the button would land in two tasks;
  // do the truly synchronous version first
  await page.evaluate(() => { const b = document.querySelector('.gm-fs'); b.click(); b.click(); });
  await page.waitForTimeout(500);
  console.log(' after sync double click:', await page.evaluate(() => ({
    fullEl: !!document.fullscreenElement,
    fullElId: document.fullscreenElement && document.fullscreenElement.id,
    hostCls: document.getElementById('game-app').className,
    lock: document.documentElement.className,
    pressed: document.querySelector('.gm-fs').getAttribute('aria-pressed'),
  })));
  // now try to get out with f
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  console.log(' after one more f:', await page.evaluate(() => ({
    fullEl: !!document.fullscreenElement, hostCls: document.getElementById('game-app').className,
    pressed: document.querySelector('.gm-fs').getAttribute('aria-pressed') })));
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  console.log(' and one more f:', await page.evaluate(() => ({
    fullEl: !!document.fullscreenElement, hostCls: document.getElementById('game-app').className,
    pressed: document.querySelector('.gm-fs').getAttribute('aria-pressed') })));
  await ctx.close();
}

console.log('=== A2: two rapid keypresses (separate tasks) ===');
{
  const { ctx, page } = await newPage();
  await boot(page);
  await page.keyboard.press('f');
  await page.keyboard.press('f');
  await page.waitForTimeout(600);
  console.log(' state:', await page.evaluate(() => ({
    fullEl: !!document.fullscreenElement, hostCls: document.getElementById('game-app').className,
    lock: document.documentElement.className, pressed: document.querySelector('.gm-fs').getAttribute('aria-pressed') })));
  await ctx.close();
}

console.log('=== B: fallback (requestFullscreen refused) — stacking vs the topbar ===');
{
  const { ctx, page } = await newPage();
  await page.addInitScript(() => {
    // iOS Safari has no element fullscreen; and a refused request is the other half
    delete Element.prototype.requestFullscreen;
    delete Element.prototype.webkitRequestFullscreen;
  });
  await boot(page, '/console.html#GM');
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const host = document.getElementById('game-app');
    const bar = document.querySelector('.topbar');
    const hb = host.getBoundingClientRect(), bb = bar ? bar.getBoundingClientRect() : null;
    // what is painted at the middle of the topbar's strip?
    const at = bb ? document.elementFromPoint(Math.round(bb.left + bb.width / 2), Math.round(bb.top + bb.height / 2)) : null;
    return {
      cls: host.className, lock: document.documentElement.className,
      hostBox: { w: Math.round(hb.width), h: Math.round(hb.height) }, vw: innerWidth, vh: innerHeight,
      barBox: bb && { t: Math.round(bb.top), h: Math.round(bb.height) },
      barZ: bar && getComputedStyle(bar).zIndex, hostZ: getComputedStyle(host).zIndex,
      wrapZ: getComputedStyle(document.querySelector('.wrap')).zIndex,
      topOfBarStrip: at && (at.className || at.tagName) + ' / ' + (at.closest('.topbar') ? 'IN TOPBAR' : at.closest('#game-app') ? 'in game' : 'elsewhere'),
      scrollY: window.scrollY,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await page.screenshot({ path: '/tmp/claude-0/probe/fallback-fullscreen.png' });
  await ctx.close();
}
await br.close();
