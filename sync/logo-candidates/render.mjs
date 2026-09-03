import fs from 'node:fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const FONT='data:font/woff2;base64,'+fs.readFileSync('/home/user/cnpe-exam-prep/curriculum/assets/fonts/plex-cond-700.woff2').toString('base64');
const css=`@font-face{font-family:"CNPE Cond";src:url("${FONT}") format("woff2");font-weight:700}
html,body{margin:0;background:#000}svg{display:block;width:512px;height:512px}`;
const names=['a-lit-stack','b-slabs','c-rising','d-hex','e-wordmark'];
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1});
for(const n of names){
  const svg=fs.readFileSync(`${n}.svg`,'utf8');
  await page.setContent(`<style>${css}</style>${svg}`);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`${n}.png`,clip:{x:0,y:0,width:512,height:512}});
}
// contact sheet: square, then circle-masked on GitHub light and dark
const labels={'a-lit-stack':'A · Lit stack','b-slabs':'B · Solid slabs','c-rising':'C · Rising layers','d-hex':'D · Hex node','e-wordmark':'E · Wordmark'};
const cols=names.map(n=>{const d=fs.readFileSync(`${n}.png`).toString('base64');const src=`data:image/png;base64,${d}`;
 return `<div class="col"><h2>${labels[n]}</h2><img class="sq" src="${src}">
  <div class="row"><div class="pane lt"><img class="ci" src="${src}"></div><div class="pane dk"><img class="ci" src="${src}"></div></div>
  <div class="row small"><div class="pane lt"><img class="ci s" src="${src}"></div><div class="pane dk"><img class="ci s" src="${src}"></div></div></div>`;}).join('');
const sheet=`<style>
body{margin:0;background:#1D1B16;color:#E6DFD0;font:14px system-ui;padding:24px}
.grid{display:flex;gap:22px}.col{width:250px}h2{font-size:15px;font-weight:600;margin:0 0 10px;color:#E6DFD0}
.sq{width:250px;height:250px;display:block;border-radius:6px}
.row{display:flex;gap:6px;margin-top:8px}.pane{flex:1;display:flex;align-items:center;justify-content:center;border-radius:6px;padding:10px}
.lt{background:#ffffff}.dk{background:#0d1117}.ci{width:96px;height:96px;border-radius:50%}.ci.s{width:40px;height:40px}
</style><div class="grid">${cols}</div>`;
await page.setViewportSize({width:1410,height:560});
await page.setContent(sheet);
await page.screenshot({path:'sheet.png',fullPage:true});
await browser.close();
