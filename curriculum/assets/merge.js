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

  /* ── study days ──────────────────────────────────────────── */
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function shiftKey(k, by) {                     // k ± n days, in local time
    var p = k.split("-");
    return dayKey(new Date(+p[0], +p[1] - 1, +p[2] + by));
  }
  function dayActs(rec) {
    if (!rec || typeof rec !== "object") return 0;
    return (+rec.c || 0) + (+rec.x || 0) + (+rec.s || 0) + (+rec.e || 0);
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
    var best = 0, streakRun = 0, prev = null;
    Object.keys(q).sort().forEach(function (k) {
      streakRun = prev && shiftKey(prev, 1) === k ? streakRun + 1 : 1;
      prev = k;
      if (streakRun > best) best = streakRun;
    });
    var dm = s.drillmeta && typeof s.drillmeta === "object" ? s.drillmeta : {};
    return { streak: run, best: Math.max(best, +dm.best || 0) };
  }

  function seedDays(s) {
    var dm = s.drillmeta;
    if (!dm || typeof dm !== "object" || Array.isArray(dm)) return;
    var n = Math.min(+dm.streak || 0, 3660);
    var end = dm.earned;
    if (n < 1 || typeof end !== "string" || !DAY_RE.test(end)) return;
    var t = dayKey(new Date());
    if (end !== t && end !== shiftKey(t, -1)) return;
    if (!s.days || typeof s.days !== "object" || Array.isArray(s.days)) s.days = {};
    for (var i = 0; i < n; i++) {
      var k = shiftKey(end, -i);
      var d = s.days[k];
      if (!d || typeof d !== "object" || Array.isArray(d)) d = s.days[k] = {};
      if (!dayActs(d)) d.c = 10;                 // the ten cards that earned that day
    }
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
     that started it, as import has always left it, and the resume pointer is this
     browser's own business. The shape is stable so an unchanged store
     canonicalises to exactly what was sent last time. */
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
    delete copy.last;
    return copy;
  }

  // An empty store never earns a remote row.
  /** @param {*} p @return {boolean} */
  function hasAnything(p) {
    if (!p) return false;
    if (["ex", "done", "drill", "days"].some(function (k) {
      return p[k] && typeof p[k] === "object" && Object.keys(p[k]).length > 0;
    })) return true;
    return ["exam", "exam2"].some(function (k) {
      return p[k] && p[k].tasks && Object.keys(p[k].tasks).length > 0;
    });
  }

  /* ── the merge ────────────────────────────────────────────── */
  /* Ticks merge three ways against the base, the last state this browser and the
     server agreed on: (local === base) ? remote : local, so an un-tick travels.
     No base makes every base value 0, which is the union Import has always had. */
  // The base lookup uses hasOwnProperty, so "toString" is no longer inert.
  function ownKey(k) { return k !== "prototype" && !(k in Object.prototype); }
  /** @param {*} store @param {*} src @param {CnpeMergeBase} [base] @return {CnpeMergeCounts} */
  function mergeProgress(store, src, base) {
    var n = { done: 0, ex: 0, exam: 0, drill: 0, days: 0, off: 0 };
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
      var cur = store.drillmeta, inc = src.drillmeta;
      if (typeof inc.day === "string" && inc.day === cur.day) {
        if ((+inc.n || 0) > (+cur.n || 0)) cur.n = +inc.n;
      } else if (typeof inc.day === "string" && (typeof cur.day !== "string" || inc.day > cur.day)) {
        cur.day = inc.day; cur.n = +inc.n || 0;
      }
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
    // Study days are counters too: per-counter max, so a merge never lowers a count.
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
          var v = +inc[f] || 0;
          if (v > (+cur[f] || 0)) { cur[f] = v; grew = true; }
        });
        if (grew) n.days++;
      });
    }
    seedDays(store);
    var nav = root.CNPE_NAV || [];
    if (typeof src.last === "string" && nav.filter(function (x) { return x.id === src.last; }).length) {
      store.last = src.last;
    }
    return n;
  }

  root.CNPE_MERGE = {
    merge: mergeProgress, ticks: ticks, sets: sets, shared: shared,
    canon: canon, pickBase: pickBase, wire: wire, hasAnything: hasAnything,
    dueIn: dueIn, seedDays: seedDays, streak: streak,
    dayKey: dayKey, shiftKey: shiftKey, dayActs: dayActs, DAY_RE: DAY_RE,
  };
})(typeof window !== "undefined" ? window : globalThis);
