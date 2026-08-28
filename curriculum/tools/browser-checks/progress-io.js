/* Export, import and reset: the exported file carries the whole store in the
   documented wrapper, import merges without ever lowering a count and rejects
   what it cannot read, and reset clears everything behind its confirm. */
'use strict';
const fs = require('fs');

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, store, assert, group, streakVal, streakLbl, daysAgo, TODAY } = h;

  /* 1. export writes the wrapper with the whole store */
  {
    group('export writes the documented wrapper');
    /** @type {Record<string, CnpeDayCounts>} */
    const days = {}; days[TODAY] = { c: 4, x: 1 }; days[daysAgo(1)] = { c: 10 };
    const seeded = { days, done: { '1.1': 1 }, ex: { '1.1#some-exercise': 1 } };
    const { ctx, page } = await fresh(seeded);
    await page.goto(url('index.html'));
    // some browsers refuse a scripted download from file://; the console then
    // falls back to a copyable textarea, and either path must carry the JSON
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => /** @type {import('playwright').Download | null} */ (null));
    await page.click('#export-progress');
    const download = await dl;
    let text;
    if (download) text = fs.readFileSync(await download.path(), 'utf8');
    else text = await page.evaluate(() => /** @type {HTMLTextAreaElement} */ (document.querySelector('#io-box textarea')).value);
    assert(!!text, 'the export handed over JSON (' + (download ? 'download' : 'textarea fallback') + ')');
    const obj = JSON.parse(text);
    assert(obj.cnpe === 2, 'the wrapper declares cnpe: 2');
    assert(!isNaN(Date.parse(obj.exported)), 'the wrapper stamps an export time');
    assert(JSON.stringify(obj.progress.days) === JSON.stringify(days), 'the study days travel whole');
    assert(obj.progress.done['1.1'] === 1 && obj.progress.ex['1.1#some-exercise'] === 1,
      'sections and exercises travel too');
    const note = await page.evaluate(() => document.getElementById('io-note').textContent);
    assert(/Wrote |blocked/.test(note), 'the note says what happened: ' + JSON.stringify(note));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 2. export → import into a fresh profile; merge never lowers a count */
  {
    group('export/import carries history, merge never lowers counts');
    /** @type {Record<string, CnpeDayCounts>} */
    const days = {}; days[TODAY] = { c: 2, x: 3 }; days[daysAgo(1)] = { c: 3 };
    const payload = JSON.stringify({ cnpe: 2, exported: new Date().toISOString(), progress: { ex: {}, done: {}, exam: {}, drill: {}, drillmeta: {}, days, last: null } });
    /** @type {{ days: Record<string, CnpeDayCounts> }} */
    const seeded = { days: {} }; seeded.days[TODAY] = { c: 9 };
    const { ctx, page } = await fresh(seeded);
    await page.goto(url('index.html'));
    const onDialog = (/** @type {import('playwright').Dialog} */ d) => d.accept();
    page.on('dialog', onDialog);
    const chooser = page.waitForEvent('filechooser');
    // the import handler reloads the page, so arm the wait before feeding it
    const reloaded = page.waitForNavigation({ waitUntil: 'load' });
    await page.click('#import-progress');
    await (await chooser).setFiles({ name: 'cnpe-progress.json', mimeType: 'application/json', buffer: Buffer.from(payload) });
    await reloaded;
    await page.waitForFunction(() => window.CNPE_PROGRESS && document.querySelector('#stat-streak'));
    page.off('dialog', onDialog);
    const s = await store(page);
    assert(s.days[TODAY].c === 9 && s.days[TODAY].x === 3, 'today merged per-counter max: ' + JSON.stringify(s.days[TODAY]));
    assert(s.days[daysAgo(1)] && s.days[daysAgo(1)].c === 3, 'imported day added');
    const val = await streakVal(page);
    assert(/^2days$/.test(val), 'streak 2 after import: ' + JSON.stringify(val));
    assert(/^Uptime·record2$/.test(await streakLbl(page)), 'record 2 in the label after import');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 3. import rejects what it cannot read, without touching the store */
  {
    group('import rejects junk and empty files');
    /** @type {Record<string, CnpeDayCounts>} */
    const days = {}; days[TODAY] = { c: 2 };
    const { ctx, page } = await fresh({ days });
    await page.goto(url('index.html'));
    /** @param {string} name @param {string} body */
    async function feed(name, body) {
      await page.evaluate(() => { const n = document.getElementById('io-note'); n.hidden = true; n.textContent = ''; });
      const chooser = page.waitForEvent('filechooser');
      await page.click('#import-progress');
      await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForFunction(() => !document.getElementById('io-note').hidden);
      return page.evaluate(() => document.getElementById('io-note').textContent);
    }
    let note = await feed('junk.json', 'not json at all {');
    assert(/not valid JSON/.test(note), 'invalid JSON is named: ' + JSON.stringify(note));
    note = await feed('empty.json', '{"foo": 1}');
    assert(/no CNPE progress/.test(note), 'a progress-free file is named: ' + JSON.stringify(note));
    const s = await store(page);
    assert(s.days[TODAY].c === 2 && Object.keys(s.days).length === 1, 'the store is untouched');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }

  /* 4. reset clears everything, but only past its confirm */
  {
    group('reset clears the store behind its confirm');
    /** @type {Record<string, CnpeDayCounts>} */
    const days = {}; days[TODAY] = { c: 5 }; days[daysAgo(1)] = { c: 5 };
    const { ctx, page } = await fresh({ days, done: { '1.1': 1, '2.1': 1 } });
    await page.goto(url('index.html'));
    page.once('dialog', d => d.dismiss());
    await page.click('#reset-progress');
    let s = await store(page);
    assert(s.done['1.1'] === 1, 'cancelling the confirm keeps everything');

    page.once('dialog', d => d.accept());
    const reloaded = page.waitForNavigation({ waitUntil: 'load' });
    await page.click('#reset-progress');
    await reloaded;
    await page.waitForFunction(() => window.CNPE_PROGRESS && document.querySelector('#stat-streak'));
    s = await store(page);
    assert(Object.keys(s.done).length === 0 && Object.keys(s.days).length === 0, 'accepting it clears the store');
    const sections = await page.evaluate(() => document.querySelector('.stats .stat .val').textContent.replace(/\s+/g, ''));
    assert(/^0\/29/.test(sections), 'sections tile is back to 0/29: ' + JSON.stringify(sections));
    assert(/^0days$/.test(await streakVal(page)), 'uptime is back to 0 days');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  }
};
