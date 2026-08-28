/* Shared harness for the browser checks: one Chromium, fresh contexts with an
   optional seeded store, and the assert counter every area module reports
   through. Needs the playwright package resolvable from here (CI installs it
   with --no-save; the console itself stays dependency-free). CHROMIUM_BIN
   overrides the browser binary; otherwise Playwright's own Chromium is used. */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

/** @typedef {import('playwright').Page} Page */

/** @param {number} n */
const pad = n => (n < 10 ? '0' : '') + n;
/** @param {Date} d */
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
/** @param {number} n */
const daysAgo = n => { const t = new Date(); return dayKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n)); };

/**
 * @param {import('playwright').Browser} browser
 * @param {string} siteDir
 */
function makeHarness(browser, siteDir) {
  let checks = 0, failures = 0;

  /** @param {*} cond @param {string} label */
  function assert(cond, label) {
    checks++;
    if (cond) { console.log('  ok  ' + label); }
    else { failures++; console.log('  FAIL ' + label); }
  }
  /** @param {string} title */
  function group(title) { console.log(title); }

  /** @param {string} p */
  const url = p => pathToFileURL(path.join(siteDir, p)).href;

  /* A fresh context and page. seedStore becomes the cnpe:v2 store before the
     page under test loads; opts.theme seeds cnpe:theme, opts.clockAt installs
     Playwright's fake clock (Date.now + timers) at that epoch before any
     script runs. Every page collects console/page errors on page.errors. */
  /**
   * @param {*} [seedStore] anything goes: the junk-tolerance checks seed garbage on purpose
   * @param {{ theme?: string, clockAt?: Date }} [opts]
   */
  async function fresh(seedStore, opts) {
    opts = opts || {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
    if (opts.clockAt) {
      // install starts a ticking fake clock; pausing it a minute later makes
      // every remaining-time computation exact, immune to wall-clock drift
      // between the checks' own steps (fastForward still advances it)
      await page.clock.install({ time: opts.clockAt });
      await page.clock.pauseAt(new Date(opts.clockAt.getTime() + 60000));
    }
    if (seedStore || opts.theme) {
      await page.goto(url('index.html'));
      await page.evaluate(({ s, t }) => {
        localStorage.clear();
        if (s) localStorage.setItem('cnpe:v2', JSON.stringify(s));
        if (t) localStorage.setItem('cnpe:theme', t);
      }, { s: seedStore || null, t: opts.theme || null });
    }
    return { ctx, page };
  }

  /** @param {Page} page */
  const store = page => page.evaluate(() => window.CNPE_PROGRESS.get());

  // the dashboard uptime tile, shared between the streak and progress-io checks:
  // the day count lives in .val, the record streak in the label, the 30-day
  // heartbeat strip beside the count
  /** @param {Page} page */
  const streakVal = page => page.evaluate(() => document.querySelector('#stat-streak .val').textContent.replace(/\s+/g, ''));
  /** @param {Page} page */
  const streakLbl = page => page.evaluate(() => document.querySelector('#stat-streak .lbl').textContent.replace(/\s+/g, ''));
  /** @param {Page} page */
  const heatOn = page => page.evaluate(() => document.querySelectorAll('#stat-streak .heat i.on').length);
  /** @param {Page} page */
  const heatAll = page => page.evaluate(() => document.querySelectorAll('#stat-streak .heat i').length);

  return {
    url, fresh, store, assert, group,
    streakVal, streakLbl, heatOn, heatAll,
    dayKey, daysAgo,
    TODAY: daysAgo(0), YDAY: daysAgo(1),
    counts: () => ({ checks, failures }),
  };
}

/** The bag every area module receives.
    @typedef {ReturnType<typeof makeHarness>} Harness */

module.exports = { makeHarness };
