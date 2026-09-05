/* CNPE curriculum: the progress merge, and the decisions that go with it.

   Nothing in here touches the DOM, storage or the network: it is plain functions
   over plain objects, which is what lets tools/merge-test.mjs drive every branch
   of them in bare node. app.js and sync.js load this and hold the state, so the
   parts that read localStorage or the account live there and the rules live here. */
(function (root) {
  "use strict";

  var BUCKETS = ["done", "ex", "exam", "exam2"];
  var DAY = 864e5;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function stampOf(v) { var n = +v; return isFinite(n) && n > 0 ? n : 0; }
  // Keys off a file or the wire land in lookup maps, so the ones Object.prototype
  // already answers for are not ours to take: "toString" is not inert here.
  function ownKey(k) { return k !== "prototype" && !(k in Object.prototype); }

  /* ── study days ──────────────────────────────────────────── */
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var KEEP = 30;                                 // days of history a store carries
  var MAXRUN = 3660;                             // and the longest run it will believe in
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function shiftKey(k, by) {                     // k ± n days, in local time
    var p = k.split("-");
    return dayKey(new Date(+p[0], +p[1] - 1, +p[2] + by));
  }
  /* One day's counter is a map of browser id to that browser's own count, read
     as their sum. Two browsers drilling the same day add up, which one number
     cannot do under a merge that has to be safe to run twice: the most it can
     say is the larger of the two, which is the smaller of the answers. A plain
     number is a store written before this, or by a browser still on the old
     script, and reads as one unnamed slot that merges the way it always did. */
  var PRE = "";
  var SLOT_RE = /^[a-z0-9]{1,16}$/;              // as devId writes them, and no longer
  var MAXSLOTS = 16;                             // browsers on one day, which is already absurd
  function slots(v) {
    var out = {};
    if (typeof v === "number") { if (v > 0) out[PRE] = v; return out; }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.keys(v).forEach(function (k) {
        var x = +v[k];
        if (x > 0 && ownKey(k) && (k === PRE || SLOT_RE.test(k))) out[k] = x;
      });
    }
    return out;
  }
  function countOf(v) {
    var m = slots(v), n = 0;
    Object.keys(m).forEach(function (k) { n += m[k]; });
    return n;
  }
  // Per-slot max of theirs into mine: the merged map, or null when nothing moved.
  // A slot already here always takes the max. A new one only lands while there
  // is room: a payload naming thousands of browsers would otherwise be stored,
  // and push the blob past what the Worker takes.
  function takeSlots(curV, incV) {
    var mine = slots(curV), theirs = slots(incV), moved = false;
    Object.keys(theirs).forEach(function (id) {
      if (theirs[id] <= (mine[id] || 0)) return;
      if (!own(mine, id) && Object.keys(mine).length >= MAXSLOTS) return;
      mine[id] = theirs[id]; moved = true;
    });
    return moved ? mine : null;
  }
  function dayActs(rec) {
    if (!rec || typeof rec !== "object") return 0;
    return countOf(rec.c) + countOf(rec.x) + countOf(rec.s) + countOf(rec.e);
  }
  // Consecutive days with a heartbeat, alive if today or yesterday has one.
  // today is an argument so this stays a function of what it is given.
  /** @param {*} store @param {string} [today] */
  function streak(store, today) {
    var s = store && typeof store === "object" ? store : {};
    var days = s.days && typeof s.days === "object" && !Array.isArray(s.days) ? s.days : {};
    var q = {};
    Object.keys(days).forEach(function (k) {
      if (DAY_RE.test(k) && dayActs(days[k]) > 0) q[k] = 1;
    });
    var cur = today && DAY_RE.test(today) ? today : dayKey(new Date());
    if (!q[cur]) cur = shiftKey(cur, -1);        // yesterday still counts as alive
    // A day the zone skipped is its own yesterday, so the walk must watch the
    // key move, not just the day qualify: Apia's 2011-12-31 and Kiritimati's
    // 1995-01-01 are fixed points of shiftKey and would spin here forever.
    var run = 0;
    while (q[cur]) {
      run++;
      var back = shiftKey(cur, -1);
      if (back >= cur) break;
      cur = back;
    }
    // The walk stops at the first day with no heartbeat, which for a store that
    // has been pruned is the day after the oldest it still carries. A run that
    // reached there went on below it, and pruneDays wrote down how far.
    var carry = s.run && typeof s.run === "object" && !Array.isArray(s.run) ? s.run : null;
    if (run && carry && carry.d === cur) run += Math.max(0, Math.floor(+carry.n) || 0);
    var best = 0, streakRun = 0, prev = null;
    Object.keys(q).sort().forEach(function (k) {
      streakRun = prev && shiftKey(prev, 1) === k ? streakRun + 1 : 1;
      prev = k;
      if (streakRun > best) best = streakRun;
    });
    var dm = s.drillmeta && typeof s.drillmeta === "object" ? s.drillmeta : {};
    // The live run is a run, so it is a floor under the record as well: past the
    // window the days that prove it are gone and only this can still see it.
    return { streak: run, best: Math.max(best, +dm.best || 0, run) };
  }

  /* The run below the days a store keeps: how long it was, and the day it ended
     on. It only ever moves forward, because it is the sole record of a streak
     whose days are gone: a later day wins, and for the same day, the longer run.
     The same rule serves the prune that writes it, the seed that truncates one,
     and the copy that arrives from another browser. */
  /** @param {*} s @param {string} d @param {*} n @param {string} [edge] oldest day kept */
  function carryRun(s, d, n, edge) {
    var run = Math.min(Math.max(0, Math.floor(+n) || 0), MAXRUN);
    if (!run || !DAY_RE.test(d)) return;
    // Anchored inside the window it is unreachable, the walk having the days
    // themselves to read, and it would sit there refusing the next real one.
    if (edge && d >= edge) return;
    var cur = s.run && typeof s.run === "object" && !Array.isArray(s.run) ? s.run : null;
    if (cur && DAY_RE.test(cur.d) && (cur.d > d || (cur.d === d && (+cur.n || 0) >= run))) return;
    s.run = { d: d, n: run };
  }

  function seedDays(s) {
    var dm = s.drillmeta;
    if (!dm || typeof dm !== "object" || Array.isArray(dm)) return;
    var n = Math.min(+dm.streak || 0, MAXRUN);
    var end = dm.earned;
    if (n < 1 || typeof end !== "string" || !DAY_RE.test(end)) return;
    var t = dayKey(new Date());
    if (end !== t && end !== shiftKey(t, -1)) return;
    if (!s.days || typeof s.days !== "object" || Array.isArray(s.days)) s.days = {};
    var edge = shiftKey(t, -(KEEP - 1));
    var i = 0;
    for (; i < n; i++) {
      var k = shiftKey(end, -i);
      if (k < edge) break;                       // days live inside the window, and only there
      var d = s.days[k];
      if (!d || typeof d !== "object" || Array.isArray(d)) d = s.days[k] = {};
      if (!dayActs(d)) d.c = 10;                 // the ten cards that earned that day
    }
    if (i < n) carryRun(s, shiftKey(end, -i), n - i, edge);   // the rest of it ran below the window
  }

  /* A store carries KEEP days and no more. Nothing reads a count older than the
     heat strip, and a year of them is most of what a store weighs once every
     count is a map. The longest run inside what goes is folded into
     drillmeta.best first, which streak() already takes as a floor, so the record
     outlives the days that earned it. Dropping a day is local and never travels
     as a removal: days merge by key, so a browser that still has one puts it
     back, and it goes again on that browser's own next prune. */
  /** @param {*} s @param {string} [today] @return {number} days dropped */
  function pruneDays(s, today) {
    if (!s || typeof s !== "object") return 0;
    var days = s.days;
    if (!days || typeof days !== "object" || Array.isArray(days)) return 0;
    var t = today && DAY_RE.test(today) ? today : dayKey(new Date());
    var edge = shiftKey(t, -(KEEP - 1)), ahead = shiftKey(t, 1);
    // A day beyond tomorrow is a clock, not a day: tomorrow itself is only a
    // browser a timezone or two east, and its work is as real as any.
    var old = Object.keys(days).filter(function (k) {
      return DAY_RE.test(k) && (k < edge || k > ahead);
    });
    if (!old.length) return 0;
    var best = streak(s, t).best;                // while the days are still here
    var dm = s.drillmeta;
    if (!dm || typeof dm !== "object" || Array.isArray(dm)) dm = s.drillmeta = {};
    if (best > (+dm.best || 0)) dm.best = best;
    // How long the run below the window is, so streak() can go on counting it.
    var last = shiftKey(edge, -1), cur = last, run = 0;
    while (dayActs(days[cur]) > 0) {
      run++;
      var back = shiftKey(cur, -1);
      if (back >= cur) break;
      cur = back;
    }
    var carry = s.run && typeof s.run === "object" && !Array.isArray(s.run) ? s.run : null;
    if (run && carry && carry.d === cur) run += Math.max(0, Math.floor(+carry.n) || 0);
    carryRun(s, last, run, edge);
    old.forEach(function (k) { delete days[k]; });
    return old.length;
  }

  /* ── the drill's schedule ─────────────────────────────────── */
  /* SM-2's shape over the counters the drill has always kept. A card sits on a
     ladder at its lifetime score, right net of missed, and each rung waits longer
     than the last by an ease its own miss rate sets. A miss costs a rung and makes
     the card due now; the next right answer buys that rung back, so a lapse sets a
     card back rather than starting it over, which is as much as a lifetime record
     can say. Nothing new is stored: r, m, ok and t are the whole of it. */
  var STEP = [1, 4];                 // days to the first review, then to the second
  var CAP = 21;                      // the exam is weeks away, so nothing rests longer
  var EASE_HI = 2.5, EASE_LO = 1.3;  // SM-2's own range, off the lifetime miss rate

  function easeOf(rec) {
    var n = (+rec.r || 0) + (+rec.m || 0);
    return n ? Math.max(EASE_LO, EASE_HI - 1.2 * ((+rec.m || 0) / n)) : EASE_HI;
  }
  // Days a card rests after the answer it last got. Zero means it is due now.
  function restOf(rec) {
    if (!rec || !rec.t || !rec.ok) return 0;              // never answered, or missed
    var reps = (+rec.r || 0) - (+rec.m || 0);             // right, net of the misses
    if (reps < 1) return 0;
    if (reps <= STEP.length) return STEP[reps - 1];
    var days = STEP[STEP.length - 1], ease = easeOf(rec);
    // Stop at the cap rather than at reps: r is whatever an imported file said,
    // and the merge only ever raises it, so the rung count is not ours to trust.
    for (var i = STEP.length; i < reps && days < CAP; i++) days *= ease;
    return Math.min(days, CAP);
  }
  // Milliseconds until a card comes round again; zero or less means it is due.
  function dueIn(rec, now) { return ((rec && +rec.t) || 0) + restOf(rec) * DAY - now; }


  /* ── the quest ────────────────────────────────────────────── */
  /* The game stores nothing the rest of the store does not already know how to
     merge. Its counters are slot maps read as the sum (xp, gold earned and gold
     spent, items got and items used), so two browsers add up as study days do;
     its ticks are monotonic unions (a trial cleared, a technique learned, a boss
     beaten), because nothing in the game un-clears; a win keeps the most times,
     the fewest turns and the latest stamp; and where you stood carries its
     stamp, as the resume pointer does. Every rule is per field and never lowers
     anything, so merging the same copy twice is a no-op, which is what lets it
     run on every pull and every import. */
  var GKEY_RE = /^[A-Za-z0-9][A-Za-z0-9._#:-]{0,63}$/;   // the ids game-data.js mints
  var MAXGKEYS = 400;                            // more than the content names, and a bound on the wire
  var MAXPOS = 4096;                             // no map is wider
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function gkey(k) { return ownKey(k) && GKEY_RE.test(k); }
  /** @param {*} store @param {*} src @return {number} fields that grew */
  function mergeGame(store, src) {
    var inc = obj(src && src.game);
    if (!inc) return 0;
    var g = obj(store.game);
    if (!g) g = store.game = {};
    var n = 0, m;
    m = takeSlots(g.xp, inc.xp);
    if (m) { g.xp = m; n++; }
    var ig = obj(inc.gold);
    if (ig) {
      var cg = obj(g.gold) || {};
      ["e", "s"].forEach(function (f) {
        m = takeSlots(cg[f], ig[f]);
        if (m) { cg[f] = m; g.gold = cg; n++; }
      });
    }
    var ii = obj(inc.items);
    if (ii) {
      var ci = obj(g.items) || {};
      Object.keys(ii).forEach(function (id) {
        var rec = obj(ii[id]);
        if (!gkey(id) || !rec) return;
        var cur = obj(ci[id]);
        if (!cur && Object.keys(ci).length >= MAXGKEYS) return;
        ["g", "u"].forEach(function (f) {
          m = takeSlots(cur && cur[f], rec[f]);
          if (!m) return;
          if (!cur) cur = ci[id] = {};
          cur[f] = m; g.items = ci; n++;
        });
      });
    }
    ["towns", "learned", "flags"].forEach(function (b) {
      var from = obj(inc[b]);
      if (!from) return;
      var into = obj(g[b]) || {};
      Object.keys(from).forEach(function (k) {
        if (!gkey(k) || !from[k] || into[k]) return;
        if (Object.keys(into).length >= MAXGKEYS) return;
        into[k] = 1; g[b] = into; n++;
      });
    });
    var iw = obj(inc.wins);
    if (iw) {
      var cw = obj(g.wins) || {};
      Object.keys(iw).forEach(function (k) {
        var r = obj(iw[k]);
        if (!gkey(k) || !r) return;
        var cur = obj(cw[k]);
        if (!cur && Object.keys(cw).length >= MAXGKEYS) return;
        var was = cur || { n: 0 }, next = {};
        var wn = Math.floor(+r.n) || 0, best = Math.floor(+r.best) || 0, t = stampOf(r.t);
        if (wn > (+was.n || 0)) next.n = wn;
        if (best > 0 && (!(+was.best > 0) || best < +was.best)) next.best = best;
        if (t > stampOf(was.t)) next.t = t;
        if (!Object.keys(next).length) return;
        if (!cur) cur = cw[k] = { n: 0 };
        Object.keys(next).forEach(function (f) { cur[f] = next[f]; });
        g.wins = cw; n++;
      });
    }
    var ip = obj(inc.pos);
    if (ip) {
      var t = stampOf(ip.t), cp = obj(g.pos), x = Math.floor(+ip.x), y = Math.floor(+ip.y);
      if (t && x >= 0 && y >= 0 && x < MAXPOS && y < MAXPOS && t > (cp ? stampOf(cp.t) : 0)) {
        g.pos = { x: x, y: y, t: t }; n++;
      }
    }
    return n;
  }
  // Whether a game bucket holds anything a player earned.
  function gameHasAnything(g) {
    g = obj(g);
    if (!g) return false;
    if (countOf(g.xp) > 0) return true;
    return ["towns", "learned", "wins", "flags", "items"].some(function (k) {
      var v = obj(g[k]);
      return !!v && Object.keys(v).length > 0;
    });
  }

  /* ── the ticked keys of a store ───────────────────────────── */
  /* What cnpe:sync-base holds, and what a tab keeps of the last store it saw on
     the disk. Both are bases for the merge below; sets() is the shape it reads. */
  // exam and exam2 keep their ticks under .tasks; done and ex are the map itself.
  /** @param {*} p @param {string} b */
  function bucketOf(p, b) {
    var m = b === "exam" || b === "exam2" ? p && p[b] && p[b].tasks : p && p[b];
    return m && typeof m === "object" && !Array.isArray(m) ? m : null;
  }
  /** @param {*} p @return {CnpeTickSets} */
  function ticks(p) {
    var out = { done: [], ex: [], exam: [], exam2: [] };
    if (!p || typeof p !== "object") return out;
    BUCKETS.forEach(function (b) {
      var m = bucketOf(p, b);
      if (!m) return;
      out[b] = Object.keys(m).filter(function (k) { return m[k]; }).sort();
    });
    return out;
  }
  /** @param {*} b @return {CnpeMergeBase} */
  function sets(b) {
    var out = /** @type {*} */ (Object.create(null));
    BUCKETS.forEach(function (k) {
      var m = Object.create(null);
      (b && b[k] || []).forEach(function (t) { m[t] = 1; });
      out[k] = m;
    });
    return out;
  }
  /* The base one tab may hold against another tab's store. A tick that is simply
     missing from that store, rather than sitting in it as 0, is one that store
     never had: the console writes 0 to un-tick and never drops a key. So the base
     speaks only for the keys the other store mentions, and a tab that saved an
     older copy of everything reads as the stale tab it is, not as a mass removal. */
  /** @param {CnpeTickSets} seen @param {*} p @return {CnpeMergeBase} */
  function shared(seen, p) {
    var out = /** @type {*} */ (Object.create(null));
    BUCKETS.forEach(function (b) {
      var m = bucketOf(p, b), keep = Object.create(null);
      (seen && seen[b] || []).forEach(function (k) { if (m && own(m, k)) keep[k] = 1; });
      out[b] = keep;
    });
    return out;
  }

  /* ── the sync's own decisions ─────────────────────────────── */
  /* Key order in a store means nothing, so comparing two of them means ordering
     the keys first. Used to tell a store that reached the disk from one that did
     not, and a payload worth sending from one already sent. */
  /** @param {*} v @return {string} */
  function canon(v) {
    if (!v || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canon(v[k]);
    }).join(",") + "}";
  }

  /* Whether the base this browser kept is usable against the copy that arrived.
     The caller owns the parts that are not a rule: reading it off the disk,
     whether another tab wrote, and whether this browser's own store landed. */
  /** @param {*} b the stored base @param {*} progress the remote copy
      @param {number} rev its revision @param {string} uid the account it came for
      @return {CnpeMergeBase|null} */
  function pickBase(b, progress, rev, uid) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    if (b.uid && uid && String(b.uid) !== uid) return null;
    var was = +b.rev || 0;
    if (rev < was) return null;                       // the row was deleted and remade
    // One rev holds one blob, so a match that disagrees is a different row.
    var only = { done: b.done || [], ex: b.ex || [], exam: b.exam || [], exam2: b.exam2 || [] };
    if (rev === was && canon(ticks(progress)) !== canon(only)) return null;
    return sets(b);
  }

  /* A store as it goes over the wire. A running exam clock stays on the machine
     that started it, as import has always left it. The shape is stable so an
     unchanged store canonicalises to exactly what was sent last time: the resume
     pointer travels, and app.js moves it only when a new section is opened. */
  /** @param {*} p @return {*} */
  function wire(p) {
    if (!p || typeof p !== "object") return null;
    var copy;
    try { copy = JSON.parse(JSON.stringify(p)); } catch (e) { return null; }
    ["exam", "exam2"].forEach(function (k) {
      var e = copy[k] && typeof copy[k] === "object" && !Array.isArray(copy[k]) ? copy[k] : (copy[k] = {});
      delete e.startedAt; delete e.running; delete e.spent;
      if (!e.tasks || typeof e.tasks !== "object") e.tasks = {};
    });
    // Today's card count is days[today].c now. What the drill used to keep here
    // is not merged any more, so it must not be sent either: two browsers would
    // never agree on it, and each would answer the other's push with its own.
    var dm = copy.drillmeta;
    if (dm && typeof dm === "object" && !Array.isArray(dm)) { delete dm.day; delete dm.n; }
    return copy;
  }

  // An empty store never earns a remote row.
  /** @param {*} p @return {boolean} */
  function hasAnything(p) {
    if (!p) return false;
    if (typeof p.last === "string" && p.last) return true;
    if (["ex", "done", "drill", "days"].some(function (k) {
      return p[k] && typeof p[k] === "object" && Object.keys(p[k]).length > 0;
    })) return true;
    if (["exam", "exam2"].some(function (k) {
      return p[k] && p[k].tasks && Object.keys(p[k].tasks).length > 0;
    })) return true;
    return gameHasAnything(p.game);
  }

  /* ── the merge ────────────────────────────────────────────── */
  /* Ticks merge three ways against the base, the last state this browser and the
     server agreed on: (local === base) ? remote : local, so an un-tick travels.
     No base makes every base value 0, which is the union Import has always had. */
  /** @param {*} store @param {*} src @param {CnpeMergeBase} [base] @return {CnpeMergeCounts} */
  function mergeProgress(store, src, base) {
    var n = { done: 0, ex: 0, exam: 0, drill: 0, days: 0, game: 0, last: 0, off: 0 };
    function union(into, from, was, bucket) {
      // A bucket the payload leaves out is not a bucket the server emptied.
      if (!from || typeof from !== "object" || Array.isArray(from)) return;
      var keys = Object.create(null);
      Object.keys(from).forEach(function (k) { keys[k] = 1; });
      if (was) Object.keys(was).forEach(function (k) { keys[k] = 1; });  // gone from the remote is a removal
      Object.keys(keys).forEach(function (k) {
        if (!ownKey(k)) return;
        var r = from[k] ? 1 : 0;
        var l = own(into, k) && into[k] ? 1 : 0;
        var b = was && own(was, k) && was[k] ? 1 : 0;
        var v = l === b ? r : l;
        if (!own(into, k)) { if (own(from, k)) { into[k] = v; if (v) n[bucket]++; } }
        else if (v !== l) { into[k] = v; if (v) n[bucket]++; else n.off++; }
      });
    }
    union(store.done, src.done, base && base.done, "done");
    union(store.ex, src.ex, base && base.ex, "ex");
    ["exam", "exam2"].forEach(function (k) {
      if (!src[k] || typeof src[k] !== "object") return;
      if (!store[k] || typeof store[k] !== "object") store[k] = {};
      if (!store[k].tasks || typeof store[k].tasks !== "object") store[k].tasks = {};
      union(store[k].tasks, src[k].tasks, base && base[k], "exam");
    });
    // r and m are lifetime counters, so they take the max; only the last-answer
    // fields follow the clock. Replacing the record wholesale would lower them.
    if (src.drill && typeof src.drill === "object" && !Array.isArray(src.drill)) {
      if (!store.drill || typeof store.drill !== "object") store.drill = {};
      Object.keys(src.drill).forEach(function (k) {
        var inc = src.drill[k];
        if (!ownKey(k) || !inc || typeof inc !== "object" || Array.isArray(inc)) return;
        var cur = store.drill[k];
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
          cur = store.drill[k] = { r: 0, m: 0 };
        }
        var grew = false;
        ["r", "m"].forEach(function (f) {
          var v = +inc[f] || 0;
          if (v > (+cur[f] || 0)) { cur[f] = v; grew = true; }
        });
        var it = +inc.t || 0, ct = +cur.t || 0;
        // On an exact tie the miss wins, so both sides land on the same record.
        if (it > ct || (it === ct && it > 0 && !inc.ok && cur.ok)) {
          cur.ok = !!inc.ok; cur.t = it; grew = true;
        }
        if (grew) n.drill++;
      });
    }
    if (src.drillmeta && typeof src.drillmeta === "object" && !Array.isArray(src.drillmeta)) {
      if (!store.drillmeta || typeof store.drillmeta !== "object") store.drillmeta = {};
      // day and n are not here: today's card count is days[today].c, which adds
      // up across browsers where a single drillmeta.n could only take the max.
      var cur = store.drillmeta, inc = src.drillmeta;
      if (typeof inc.earned === "string" && (typeof cur.earned !== "string" || inc.earned > cur.earned)) {
        cur.earned = inc.earned;
      }
      // Only write what is there: a merge that adds nothing must leave the store alone.
      var streak = Math.max(+cur.streak || 0, +inc.streak || 0);
      if (streak) cur.streak = streak;
      var best = Math.max(+cur.best || 0, +inc.best || 0, streak);
      if (best) cur.best = best;
      var t = Math.max(+cur.t || 0, +inc.t || 0);
      if (t) cur.t = t;
    }
    /* Study days are counters too, per slot: each browser's own count takes the
       max, and the day is what they add up to.

       This browser's own history is trimmed first, so the carry it keeps is
       already anchored where the walk will look for it. Any carry that arrives
       after, from another browser or from what the drill claims, is anchored on
       the same day at the latest, and the same-day rule then takes the longer of
       the two rather than whichever landed last. */
    pruneDays(store);
    var edge = shiftKey(dayKey(new Date()), -(KEEP - 1));
    if (src.days && typeof src.days === "object" && !Array.isArray(src.days)) {
      if (!store.days || typeof store.days !== "object" || Array.isArray(store.days)) store.days = {};
      Object.keys(src.days).forEach(function (k) {
        if (!DAY_RE.test(k)) return;
        var inc = src.days[k];
        if (!inc || typeof inc !== "object" || Array.isArray(inc)) return;
        var cur = store.days[k];
        if (!cur || typeof cur !== "object" || Array.isArray(cur)) cur = store.days[k] = {};
        var grew = false;
        ["c", "x", "s", "e"].forEach(function (f) {
          var m = takeSlots(cur[f], inc[f]);
          if (m) { cur[f] = m; grew = true; }
        });
        // A day from below the window is taken so the run it is part of is not
        // lost with it, and the prune below folds it into the carry and drops
        // it. It is not counted as added, because it is not history kept: a copy
        // of a year of days must not tell Import it added a year.
        if (grew && k >= edge) n.days++;
      });
    }
    if (src.run && typeof src.run === "object" && !Array.isArray(src.run)) {
      carryRun(store, src.run.d, src.run.n, edge);
    }
    seedDays(store);
    pruneDays(store);
    n.game = mergeGame(store, src);
    /* The pointer carries the moment it was set, so the section read most recently
       wins rather than whichever browser pushed last. A file with no stamp in it,
       and a store that never carried one, both read as 0 and still merge. */
    var nav = root.CNPE_NAV || [];
    var at = stampOf(src.lastAt);
    if (typeof src.last === "string" && at >= stampOf(store.lastAt) &&
        nav.filter(function (x) { return x.id === src.last; }).length) {
      if (store.last !== src.last) n.last++;
      store.last = src.last;
      if (at) store.lastAt = at;
    }
    return n;
  }

  root.CNPE_MERGE = {
    merge: mergeProgress, ticks: ticks, sets: sets, shared: shared,
    canon: canon, pickBase: pickBase, wire: wire, hasAnything: hasAnything,
    dueIn: dueIn, seedDays: seedDays, streak: streak,
    countOf: countOf, pruneDays: pruneDays, KEEP: KEEP,
    mergeGame: mergeGame, gameHasAnything: gameHasAnything,
    dayKey: dayKey, shiftKey: shiftKey, dayActs: dayActs, DAY_RE: DAY_RE,
  };
})(typeof window !== "undefined" ? window : globalThis);
