#!/usr/bin/env node
/* Drive a staged copy of the study console in headless Chromium and check its behavior.

       node tools/browser-checks/run.js <site-dir>    # site-dir from stage-site.sh

   Env:
     CHROMIUM_BIN    browser binary to use instead of Playwright's own Chromium
     STREAK_SHOTS    directory to write theme screenshots into
     AREAS           comma-separated subset to run, for iterating on one of them */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { makeHarness, dayKey } = require('./lib');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', '_site'));

const ALL = ['streak', 'palette', 'exam-clock', 'drill-deck', 'progress-io', 'sync', 'tabs',
  'section', 'weak-spots', 'trace', 'widgets', 'reading', 'reading-layout', 'reading-navigation', 'theme', 'mobile', 'accessibility', 'pagehide', 'game', 'game-presentation'];

const want = (process.env.AREAS || '').split(',').map(s => s.trim()).filter(Boolean);
const unknown = want.filter(a => ALL.indexOf(a) < 0);
if (unknown.length) {
  console.error('no such area: ' + unknown.join(', ') + '\nhave: ' + ALL.join(', '));
  process.exit(2);
}
const AREAS = want.length ? want : ALL;

/** @param {import('playwright').Browser} browser
 *  @return {Promise<{ checks: number, failures: number, startedOn: string }>} */
async function pass(browser) {
  const h = makeHarness(browser, SITE);
  const startedOn = h.TODAY;

  for (const name of AREAS) {
    console.log('\n═══ ' + name + ' ═══');
    // group() catches inside an area; this is for what escapes one, such as a
    // throw between groups, and keeps the areas after it running
    try { await require('./' + name)(h); }
    catch (e) { h.assert(false, name + ' aborted: ' + String((e && e.message) || e).split('\n')[0]); }
  }

  const { checks, failures } = h.counts();
  return { checks, failures, startedOn };
}

async function run() {
  const browser = await chromium.launch(
    process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {});

  let { checks, failures, startedOn } = await pass(browser);

  // A pass fixes its day keys at the start; the page reads its own each time it
  // writes one. Midnight splits the two, so take a pass that sits inside one day.
  if (dayKey(new Date()) !== startedOn && failures) {
    console.log('\n' + checks + ' checks, ' + failures + ' failures');
    console.log('\nthe pass crossed local midnight, which fails day-based checks where'
      + ' the day changed; running once more, wholly inside one day');
    ({ checks, failures } = await pass(browser));
  }

  await browser.close();
  console.log('\n' + checks + ' checks, ' + failures + ' failures');
  process.exitCode = failures ? 1 : 0;   // let stdout flush
}

// a crash leaves the browser open, which would keep node alive: exit hard
run().catch(e => { console.error(e); process.exit(1); });
