#!/usr/bin/env node
/* Drive a staged copy of the study console in headless Chromium and assert its
   behavior end to end. Each area lives in its own module beside this runner;
   a module gets the shared harness (fresh contexts, seeded stores, the assert
   counter) and adds its checks to the one tally.

       node tools/browser-checks/run.js <site-dir>    # site-dir from stage-site.sh

   Needs the playwright package resolvable from here (CI installs it with
   --no-save; the console itself stays dependency-free). CHROMIUM_BIN overrides
   the browser binary; otherwise Playwright's own Chromium is used. Set
   STREAK_SHOTS to a directory to also get theme screenshots for eyeballing. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { makeHarness } = require('./lib');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', '_site'));

const AREAS = ['streak', 'palette', 'exam-clock', 'drill-deck', 'progress-io', 'section', 'weak-spots'];

async function run() {
  const browser = await chromium.launch(
    process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {});
  const h = makeHarness(browser, SITE);
  const startedOn = h.TODAY;

  for (const name of AREAS) {
    console.log('\n═══ ' + name + ' ═══');
    // one area blowing up (a timeout, an evaluate against a navigating
    // document) must not discard every area after it: count it and move on
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
