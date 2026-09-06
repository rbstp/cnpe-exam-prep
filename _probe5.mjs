import { chromium } from 'playwright';
const B = 'http://127.0.0.1:8099';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function mk(vp, init) {
  const ctx = await br.newContext({ viewport: vp, reducedMotion: 'reduce', hasTouch: true });
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
async function toTrial(page) {
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.waitForSelector('.gm-screen:not([hidden]) .gm-title');
  await page.click('.gm-menu button:has-text("Trial")');
  await page.waitForSelector('.gm-opt');
}
const layout = p => p.evaluate(() => {
  const host = document.getElementById('game-app');
  const stage = document.querySelector('.gm-stage');
  const screen = document.querySelector('.gm-screen');
  const pad = document.querySelector('.gm-pad');
  const cv = document.querySelector('.gm-stage > canvas');
  const opts = Array.from(document.querySelectorAll('.gm-opt'));
  const r = e => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    vw: innerWidth, vh: innerHeight, cls: host.className,
    host: r(host), stage: r(stage), screen: r(screen), pad: r(pad),
    canvasDisplay: getComputedStyle(cv).display, canvas: r(cv),
    screenScroll: { h: screen.scrollHeight, ch: screen.clientHeight, canScroll: screen.scrollHeight > screen.clientHeight + 1 },
    docScroll: { h: document.documentElement.scrollHeight, vh: innerHeight },
    optH: opts.map(o => Math.round(o.getBoundingClientRect().height)),
    optOverflowX: opts.map(o => Math.round(o.scrollWidth - o.clientWidth)),
    optTextLen: opts.map(o => o.textContent.length),
    padOnScreen: (() => { const b = pad.getBoundingClientRect(); return b.bottom <= innerHeight + 1 && b.top >= -1; })(),
    firstOptVisible: (() => { const b = opts[0].getBoundingClientRect(); return b.top >= 0 && b.top < innerHeight; })(),
    bodyOverflowX: document.documentElement.scrollWidth > innerWidth,
  };
});
for (const [name, vp] of [['phone portrait 390x844', { width: 390, height: 844 }], ['phone landscape 844x390', { width: 844, height: 390 }], ['tablet 768x1024', { width: 768, height: 1024 }], ['desktop 1280x800', { width: 1280, height: 800 }]]) {
  console.log('###', name);
  const { ctx, page } = await mk(vp);
  await boot(page);
  await toTrial(page);
  console.log(' normal  :', JSON.stringify(await layout(page)));
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  console.log(' full    :', JSON.stringify(await layout(page)));
  await page.screenshot({ path: '/tmp/claude-0/probe/trial-full-' + vp.width + 'x' + vp.height + '.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await ctx.close();
}
await br.close();
