#!/usr/bin/env node
/* Drive a staged copy of the study console in headless Chromium and check its behavior.

       node tools/browser-checks/run.js <site-dir>    # site-dir from stage-site.sh

   Env:
     CHROMIUM_BIN    browser binary to use instead of Playwright's own Chromium
     STREAK_SHOTS    directory to write theme screenshots into */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { makeHarness } = require('./lib');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', '_site'));

const AREAS = ['streak', 'palette', 'exam-clock', 'drill-deck', 'progress-io', 'sync', 'tabs', 'section', 'weak-spots', 'trace', 'pagehide'];

async function run() {
  const browser = await chromium.launch(
    process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {});
  const h = makeHarness(browser, SITE);
  const startedOn = h.TODAY;

  for (const name of AREAS) {
    console.log('\n═══ ' + name + ' ═══');
    // one area blowing up must not discard the areas after it: count it and move on
    try { await require('./' + name)(h); }
    catch (e) { h.assert(false, name + ' aborted: ' + e.message.split('\n')[0]); }
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
