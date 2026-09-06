import { chromium } from 'playwright';
const B = 'http://127.0.0.1:8099';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function mk(vp) {
  const ctx = await br.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  return { ctx, page };
}
async function boot(page) {
  await page.goto(B + '/game.html');
  await page.waitForSelector('.gm-stage canvas');
  for (let i = 0; i < 5; i++) {
    const b = page.locator('.gm-dialog button').first();
    if (!(await b.count()) || !(await b.isVisible())) break;
    await b.click();
  }
  await page.evaluate(() => document.querySelector('.gm-stage').focus({ preventScroll: true }));
}
const m = p => p.evaluate(() => {
  const host = document.getElementById('game-app'), stage = document.querySelector('.gm-stage'), pad = document.querySelector('.gm-pad');
  const sb = stage.getBoundingClientRect(), pb = pad.getBoundingClientRect(), hb = host.getBoundingClientRect();
  const d = window.CNPE_GAME.debug();
  return { vw: innerWidth, vh: innerHeight,
    stage: { t: Math.round(sb.top), h: Math.round(sb.height), w: Math.round(sb.width) },
    pad: { t: Math.round(pb.top), b: Math.round(pb.bottom), h: Math.round(pb.height) },
    host: { t: Math.round(hb.top), h: Math.round(hb.height) },
    padFullyOnScreen: pb.bottom <= innerHeight + 0.5 && pb.top >= -0.5,
    stageTopClipped: sb.top < -0.5,
    aspectOk: Math.abs(sb.width / sb.height - 30 / 19) < 0.02,
    scale: d.scale, dpr: d.dpr, canvasW: document.querySelector('.gm-stage>canvas').width,
    hudTop: Math.round(document.querySelector('.gm-hud').getBoundingClientRect().top),
  };
});
for (const vp of [{ width: 1280, height: 800 }, { width: 1280, height: 620 }, { width: 1280, height: 560 }, { width: 1280, height: 540 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 700, height: 300 }, { width: 1000, height: 200 }, { width: 1600, height: 1000 }]) {
  const { ctx, page } = await mk(vp);
  await boot(page);
  await page.keyboard.press('f');
  await page.waitForTimeout(350);
  console.log(vp.width + 'x' + vp.height, JSON.stringify(await m(page)));
  await page.screenshot({ path: '/tmp/claude-0/probe/map-full-' + vp.width + 'x' + vp.height + '.png' });
  await ctx.close();
}
await br.close();
