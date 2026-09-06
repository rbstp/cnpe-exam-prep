import { chromium } from 'playwright';
const B = 'http://127.0.0.1:8099';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function newPage(vp, init) {
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
  await page.focus('.gm-stage');
}
const noFs = () => { delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen; };

console.log('=== B2: fallback overlay at scroll 0, what covers the top strip ===');
for (const [name, url] of [['bundle #GM', '/console.html#GM'], ['standalone game.html', '/game.html']]) {
  const { ctx, page } = await newPage(null, noFs);
  await boot(page, url);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    const bb = bar.getBoundingClientRect();
    const pt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.tagName + '.' + (e.className || '') ).slice(0, 48) + (e.closest('.topbar') ? '  <-- TOPBAR' : '') : 'none'; };
    return { barTop: Math.round(bb.top), barVisible: bb.top < innerHeight && bb.bottom > 0,
      at_10_10: pt(10, 10), at_640_20: pt(640, 20), at_640_40: pt(640, 40), at_640_60: pt(640, 60),
      barOpacity: getComputedStyle(bar).backgroundColor };
  });
  console.log(' ', name, JSON.stringify(r));
  await page.screenshot({ path: '/tmp/claude-0/probe/fb-' + name.replace(/\W+/g, '_') + '.png' });
  await ctx.close();
}

console.log('=== C: real double-click on the button (two tasks, 30ms apart) ===');
for (const delay of [0, 30, 80, 150]) {
  const { ctx, page } = await newPage();
  await boot(page);
  await page.click('.gm-fs');
  await page.waitForTimeout(delay);
  await page.click('.gm-fs');
  await page.waitForTimeout(700);
  console.log('  delay', delay, JSON.stringify(await page.evaluate(() => ({
    fullEl: !!document.fullscreenElement, cls: document.getElementById('game-app').className,
    lock: document.documentElement.className, pressed: document.querySelector('.gm-fs').getAttribute('aria-pressed') }))));
  await ctx.close();
}

console.log('=== C2: dblclick ===');
{
  const { ctx, page } = await newPage();
  await boot(page);
  await page.dblclick('.gm-fs');
  await page.waitForTimeout(700);
  console.log('  ', JSON.stringify(await page.evaluate(() => ({
    fullEl: !!document.fullscreenElement, cls: document.getElementById('game-app').className,
    pressed: document.querySelector('.gm-fs').getAttribute('aria-pressed') }))));
  await ctx.close();
}
await br.close();
