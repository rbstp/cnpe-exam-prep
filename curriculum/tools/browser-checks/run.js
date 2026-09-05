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
const { makeHarness } = require('./lib');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', '_site'));

const ALL = ['streak', 'palette', 'exam-clock', 'drill-deck', 'progress-io', 'sync', 'tabs',
  'section', 'weak-spots', 'trace', 'widgets', 'theme', 'mobile', 'accessibility', 'pagehide', 'game'];

const want = (process.env.AREAS || '').split(',').map(s => s.trim()).filter(Boolean);
const unknown = want.filter(a => ALL.indexOf(a) < 0);
if (unknown.length) {
  console.error('no such area: ' + unknown.join(', ') + '\nhave: ' + ALL.join(', '));
  process.exit(2);
}
const AREAS = want.length ? want : ALL;

async function run() {
  const browser = await chromium.launch(
    process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {});
  const h = makeHarness(browser, SITE);
  const startedOn = h.TODAY;

  for (const name of AREAS) {
    console.log('\n═══ ' + name + ' ═══');
    // group() catches inside an area; this is for what escapes one, such as a
    // throw between groups, and keeps the areas after it running
    try { await require('./' + name)(h); }
    catch (e) { h.assert(false, name + ' aborted: ' + String((e && e.message) || e).split('\n')[0]); }
  }

  await browser.close();
  const { checks, failures } = h.counts();
  if (h.dayKey(new Date()) !== startedOn && failures) {
    console.log('\nnote: the run crossed local midnight; day-based failures above may be spurious, rerun');
  }
  console.log('\n' + checks + ' checks, ' + failures + ' failures');
  process.exitCode = failures ? 1 : 0;   // let stdout flush
}

// a crash leaves the browser open, which would keep node alive: exit hard
run().catch(e => { console.error(e); process.exit(1); });
