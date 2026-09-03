/* The console on a phone. Every other area drives a desktop viewport, so the
   rules that only bite at narrow widths — the measure, the collapsing topbar,
   the figures that have to stop being two columns — went unchecked. */
'use strict';
const fs = require('fs');
const path = require('path');

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };   // the narrowest width worth supporting

/* Every page in the staged site, so a new section is covered the day it lands
   rather than the day someone remembers to add it here. */
/** @param {string} dir @return {string[]} */
function pagesIn(dir) {
  /** @param {string} d @param {string[]} out */
  const walk = (d, out) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      // 404.html links its assets absolutely, because Pages can serve it from any
      // depth. Over file:// those resolve to the filesystem root, so it loads bare
      // and has no layout to measure: it is a Pages page, not a console page.
      else if (f.endsWith('.html') && f !== '404.html') out.push(path.relative(dir, p));
    }
    return out;
  };
  return walk(dir, []);
}

/** @param {import('./lib').Harness} h */
module.exports = async function (h) {
  const { url, fresh, assert, group, siteDir } = h;
  const PAGES = pagesIn(siteDir);

  /* A page wider than its own viewport is the phone failure that matters: the
     reader swipes sideways to reach the right-hand half of every paragraph.
     Wide content (diagrams, tables, code) is allowed to scroll, but inside its
     own box — so measure the document, then name whichever element sticks out. */
  /** @param {import('playwright').Page} page */
  const overflow = page => page.evaluate(() => {
    const root = document.documentElement;
    const over = root.scrollWidth - root.clientWidth;
    if (over <= 1) return { over: 0, culprits: [] };
    /** @type {string[]} */
    const culprits = [];
    /** @param {Element} el */
    const scrolls = el => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= root.clientWidth + 1) continue;
      if (scrolls(el)) continue;   // wide content is allowed, so long as its own box scrolls
      culprits.push(el.tagName.toLowerCase() + '.' + (String(el.className) || '(none)') +
        ' right=' + Math.round(r.right) + ' "' + (el.textContent || '').trim().slice(0, 40) + '"');
    }
    return { over, culprits: culprits.slice(0, 3) };
  });

  /* 1. no page pushes the document sideways, at either width. One assert per
     width over the whole corpus: a per-page assert would bury the count. */
  /** @param {{ width: number, height: number }} vp */
  const sweep = async vp => {
    const { ctx, page } = await fresh();
    await page.setViewportSize(vp);
    /** @type {string[]} */
    const bad = [];
    for (const p of PAGES) {
      await page.goto(url(p));
      await page.waitForTimeout(120);
      const o = await overflow(page);
      if (o.over) bad.push(p + ' by ' + o.over + 'px (' + o.culprits.join(' | ') + ')');
    }
    assert(bad.length === 0, vp.width + 'px: all ' + PAGES.length +
      ' pages fit the viewport' + (bad.length ? ' — except ' + bad.join('; ') : ''));
    assert(page.errors.length === 0, vp.width + 'px: no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  };

  await group('mobile: nothing scrolls sideways on a phone', async () => {
    assert(PAGES.length > 20, 'the sweep has the whole site to walk: ' + PAGES.length + ' pages');
    await sweep(PHONE);
  });
  await group('mobile: nor at 320px, where a long unbroken token would show', () => sweep(SMALL));

  /* 3. the measure is a ceiling, so a phone spends every pixel it has on text,
     and no width anywhere lets a line grow past that ceiling */
  await group('mobile: text fills the column, and never exceeds the measure at any width', async () => {
    const { ctx, page } = await fresh();
    /** @param {number} w */
    const widths = async w => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(120);
      return page.evaluate(() => {
        const r = (/** @type {Element | null} */ e) => e ? Math.round(e.getBoundingClientRect().width) : null;
        return {
          col: r(document.querySelector('.panel .pbody')),
          para: r(document.querySelector('.panel .pbody p')),
          quiz: r(document.querySelector('.quiz .answer'))
        };
      });
    };
    await page.goto(url('01-architecture/05-cost.html'));

    for (const w of [320, 390, 430, 768]) {
      const m = await widths(w);
      assert(m.para === m.col, w + 'px: a paragraph spends the whole column, no gutter: ' +
        m.para + ' of ' + m.col);
      assert(m.quiz > 0 && m.quiz <= m.col, w + 'px: a self-check answer fits the column: ' +
        m.quiz + ' of ' + m.col);
    }

    /* The rail leaves at 1180px and the column widens to the whole page, so
       without a px ceiling narrowing the window would lengthen the line. */
    const wide = await widths(1400), justUnder = await widths(1179), justOver = await widths(1181);
    assert(wide.para <= 846, 'wide: the line stops at the measure: ' + wide.para);
    assert(justUnder.col > justOver.col,
      'the column really does widen when the rail leaves: ' + justOver.col + ' → ' + justUnder.col);
    assert(justUnder.para <= wide.para,
      'yet narrowing the window never lengthens the line: ' + justOver.para + ' → ' + justUnder.para);
    assert(justUnder.para === justUnder.quiz && wide.para === wide.quiz,
      'a paragraph and an answer break in the same place at both widths');
    /* the answer hangs under the question rather than under the Q number, so on a
       phone the two have to share a left edge or the block reads as two columns */
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(120);
    const quiz = await page.evaluate(() => {
      const d = document.querySelector('details.quiz');
      d.setAttribute('open', '');
      const q = d.querySelector('summary'), a = d.querySelector('.answer');
      const qs = getComputedStyle(q);
      return {
        qText: Math.round(q.getBoundingClientRect().left + parseFloat(qs.paddingLeft)),
        aText: Math.round(a.getBoundingClientRect().left),
        aRight: Math.round(a.getBoundingClientRect().right),
        vw: document.documentElement.clientWidth
      };
    });
    assert(Math.abs(quiz.qText - quiz.aText) <= 1,
      'the answer starts where the question text starts: ' + quiz.qText + ' vs ' + quiz.aText);
    assert(quiz.aRight <= quiz.vw + 1, 'and does not run off the right edge: ' +
      quiz.aRight + ' of ' + quiz.vw);
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 4. the chrome that has to fold away */
  await group('mobile: the rail and the crumbs fold away, the search key does not', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize(PHONE);
    await page.goto(url('01-architecture/01-networking.html'));
    const chrome = await page.evaluate(() => {
      const shown = (/** @type {string} */ s) => {
        const e = document.querySelector(s);
        return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
      };
      return { toc: shown('#toc'), crumbs: shown('.crumbs'), search: shown('.searchbtn'), logo: shown('.logo') };
    });
    assert(!chrome.toc, 'the index rail is gone');
    assert(!chrome.crumbs, 'so are the breadcrumbs');
    assert(chrome.logo, 'the logo stays');
    assert(chrome.search, 'and the way into the palette stays');
    // the palette itself has to fit, or the only navigation on a phone is unusable
    await page.evaluate(() => {
      const b = /** @type {HTMLElement} */ (document.querySelector('.searchbtn'));
      b.click();
    });
    await page.waitForTimeout(250);
    const pal = await page.evaluate(() => {
      const p = document.querySelector('.overlay.open .palette');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth };
    });
    assert(pal, 'the search button opens the palette');
    assert(pal && pal.left >= 0 && pal.right <= pal.vw + 1,
      'and the palette fits the phone: ' + JSON.stringify(pal));
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 5. the interactive figures: two-column controls and the hop chain both have
     a phone layout, and a chain box that kept its 340px would overflow 320px */
  await group('mobile: the figures fold to one column and the hop chain fills the width', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize(SMALL);
    await page.goto(url('01-architecture/01-networking.html'));
    await page.waitForTimeout(400);
    const fig = await page.evaluate(() => {
      const path = document.querySelector('.wpath.narrow');
      if (!path) return null;
      const hop = path.querySelector('.whop'), arr = path.querySelector('.whop-arr');
      const body = /** @type {HTMLElement} */ (path.closest('.wbody'));
      const inner = body.clientWidth - parseFloat(getComputedStyle(body).paddingLeft) -
        parseFloat(getComputedStyle(body).paddingRight);
      return {
        hop: Math.round(hop.getBoundingClientRect().width),
        arr: Math.round(arr.getBoundingClientRect().width),
        inner: Math.round(inner),
        // the arrow is a spine: its centre has to be the box's centre
        hopMid: Math.round(hop.getBoundingClientRect().left + hop.getBoundingClientRect().width / 2),
        arrMid: Math.round(arr.getBoundingClientRect().left + arr.getBoundingClientRect().width / 2)
      };
    });
    assert(fig, 'the hop chain is on the page');
    assert(fig && fig.hop <= fig.inner, 'a hop box drops its 340px and fits the phone: ' +
      (fig ? fig.hop + ' in ' + fig.inner : ''));
    assert(fig && Math.abs(fig.hopMid - fig.arrMid) <= 1,
      'the connector is still centred on the box it joins: ' + (fig ? fig.hopMid + ' vs ' + fig.arrMid : ''));
    await page.goto(url('01-architecture/02-compute-right-sizing.html'));
    await page.waitForTimeout(400);
    const ctl = await page.evaluate(() => {
      const c = document.querySelector('.wctl');   // a slider row: label / track / value
      return c ? getComputedStyle(c).gridTemplateColumns.split(' ').length : -1;
    });
    assert(ctl === 1, 'a slider row folds from three columns to one: ' + ctl);
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });

  /* 6. the drill is the one page you would actually use on a phone */
  await group('mobile: a drill session is usable on a phone', async () => {
    const { ctx, page } = await fresh();
    await page.setViewportSize(PHONE);
    await page.goto(url('drill.html'));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '40' }).first().click();
    await page.getByRole('button', { name: /Start a session/ }).click();
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    await page.keyboard.press('2');
    await page.waitForTimeout(120);
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    await page.keyboard.press('1');
    await page.waitForTimeout(200);

    const bar = await page.evaluate(() => {
      const cells = document.querySelectorAll('.drill-prog .track i');
      const cls = /** @type {string[]} */ (Array.prototype.map.call(cells, (/** @type {Element} */ c) => c.className));
      const track = document.querySelector('.drill-prog .track').getBoundingClientRect();
      return { n: cells.length, first: cls.slice(0, 3), cell: +cells[0].getBoundingClientRect().width.toFixed(2),
               track: Math.round(track.width) };
    });
    assert(bar.n === 40, 'the bar is one cell per card in a 40-card deck: ' + bar.n);
    assert(bar.first[0] === 'hit' && bar.first[1] === 'miss' && bar.first[2] === 'now',
      'and it records the answers in order: ' + JSON.stringify(bar.first));
    // 39 gaps across a phone-width track must not leave the cells invisible
    assert(bar.cell >= 2, 'a cell is still wide enough to see at 40 cards: ' + bar.cell + 'px of ' + bar.track);

    const o = await overflow(page);
    assert(o.over === 0, 'a session in progress still fits the phone' +
      (o.over ? ' — overflows by ' + o.over + 'px: ' + o.culprits.join(' | ') : ''));
    const acts = await page.evaluate(() => {
      const bs = document.querySelectorAll('.drill-actions .tbtn');
      const vw = document.documentElement.clientWidth;
      return Array.prototype.every.call(bs, (/** @type {Element} */ b) => b.getBoundingClientRect().right <= vw + 1) && bs.length > 0;
    });
    assert(acts, 'the grade buttons are reachable, not off the right edge');
    assert(page.errors.length === 0, 'no console errors: ' + page.errors.join(' | '));
    await ctx.close();
  });
};
