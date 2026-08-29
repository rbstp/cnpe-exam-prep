/* Direct tests for the progress merge. Plain node, no dependencies:
 *
 *     node curriculum/tools/merge-test.mjs
 *
 * assets/merge.js touches no DOM, so the truth table the console turns on is
 * checked here rather than through a staged site and a real browser: all 27
 * base/local/remote combinations across all four tick buckets, the guards that
 * decide when a base may be read at all, and the counters that take the max. */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MERGE = fileURLToPath(new URL("../assets/merge.js", import.meta.url));
createRequire(import.meta.url)(MERGE);                  // a browser script; it finds globalThis
const M = globalThis.CNPE_MERGE;
globalThis.CNPE_NAV = [{ id: "1.1" }, { id: "2.3" }];   // only the ids matter to the merge

let checks = 0, failures = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) console.log("  ok  " + label);
  else { failures++; console.log("  FAIL " + label); }
};
const group = t => console.log(t);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const store = over => Object.assign(
  { ex: {}, done: {}, exam: {}, exam2: {}, drill: {}, drillmeta: {}, days: {}, last: null }, over);
const pad = n => (n < 10 ? "0" : "") + n;
// One clock read for the whole run: calling new Date() per day would disagree
// with TODAY for anything started in the last milliseconds before midnight.
const NOW = new Date();
const day = n => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};
const TODAY = day(0);

/* ── the truth table ──────────────────────────────────────────
   base, local, remote, then the tick the merge lands on, how many ticks it
   reports adding and how many it reports clearing. "-" is a key that is not
   there at all, which is not the same as a key that is there and 0. */
const K = "k";
const TRUTH = [
  ["-", "-", "-", "-", 0, 0],
  ["-", "-", "0", 0, 0, 0],
  ["-", "-", "1", 1, 1, 0],
  ["-", "0", "-", 0, 0, 0],
  ["-", "0", "0", 0, 0, 0],
  ["-", "0", "1", 1, 1, 0],
  ["-", "1", "-", 1, 0, 0],
  ["-", "1", "0", 1, 0, 0],
  ["-", "1", "1", 1, 0, 0],
  ["0", "-", "-", "-", 0, 0],
  ["0", "-", "0", 0, 0, 0],
  ["0", "-", "1", 1, 1, 0],
  ["0", "0", "-", 0, 0, 0],
  ["0", "0", "0", 0, 0, 0],
  ["0", "0", "1", 1, 1, 0],
  ["0", "1", "-", 1, 0, 0],
  ["0", "1", "0", 1, 0, 0],
  ["0", "1", "1", 1, 0, 0],
  ["1", "-", "-", "-", 0, 0],
  ["1", "-", "0", 0, 0, 0],
  ["1", "-", "1", 0, 0, 0],   // the base says I had it and I do not: a removal
  ["1", "0", "-", 0, 0, 0],
  ["1", "0", "0", 0, 0, 0],
  ["1", "0", "1", 0, 0, 0],   // my un-tick beats their tick
  ["1", "1", "-", 0, 0, 1],   // gone from the payload is gone
  ["1", "1", "0", 0, 0, 1],
  ["1", "1", "1", 1, 0, 0],
];

function slot(v) { return v === "-" ? {} : { [K]: +v }; }

group("the three-way truth table, in every tick bucket");
TRUTH.forEach(function (row) {
  const [b, l, r, want, added, off] = row;
  const s = store({ done: slot(l), ex: slot(l), exam: { tasks: slot(l) }, exam2: { tasks: slot(l) } });
  const src = { done: slot(r), ex: slot(r), exam: { tasks: slot(r) }, exam2: { tasks: slot(r) } };
  const base = b === "-" ? null
    : { done: slot(b), ex: slot(b), exam: slot(b), exam2: slot(b) };
  const n = M.merge(s, src, base);
  const got = {
    done: K in s.done ? s.done[K] : "-",
    ex: K in s.ex ? s.ex[K] : "-",
    exam: K in s.exam.tasks ? s.exam.tasks[K] : "-",
    exam2: K in s.exam2.tasks ? s.exam2.tasks[K] : "-",
  };
  const label = "base " + b + ", local " + l + ", remote " + r + " → " + want;
  const values = eq(got, { done: want, ex: want, exam: want, exam2: want });
  // exam and exam2 both report under n.exam, and every bucket shares n.off
  const counts = n.done === added && n.ex === added && n.exam === added * 2 && n.off === off * 4;
  ok(values && counts, label + (values ? "" : ", got " + JSON.stringify(got)) +
     (counts ? "" : ", counted " + JSON.stringify(n)));
});

group("what the table means, said in words");
{
  const s = store({ done: { "1.1": 1 } });
  M.merge(s, { done: { "2.1": 1 } });
  ok(s.done["1.1"] === 1 && s.done["2.1"] === 1, "no base is the union import has always been");

  const t = store({ done: { "1.1": 1 } });
  const n = M.merge(t, { done: { "1.1": 1, "2.1": 1 } }, M.sets({ done: ["1.1"] }));
  ok(t.done["2.1"] === 1 && n.done === 1, "a tick made elsewhere arrives");

  const u = store({ done: { "1.1": 0 } });
  const un = M.merge(u, { done: { "1.1": 1 } }, M.sets({ done: ["1.1"] }));
  ok(u.done["1.1"] === 0 && un.done === 0 && un.off === 0, "an un-tick this browser made is not undone");

  const v = store({ done: { "1.1": 1 } });
  const off = M.merge(v, { done: { "1.1": 0 } }, M.sets({ done: ["1.1"] }));
  ok(v.done["1.1"] === 0 && off.off === 1, "an un-tick made elsewhere comes down, and is counted");

  const w = store({ done: { "1.1": 1, "9.9": 1 } });
  M.merge(w, { done: { "1.1": 1 } }, M.sets({ done: ["1.1"] }));
  ok(w.done["9.9"] === 1, "a key neither the base nor the payload mentions is left alone");
}

group("a bucket the payload leaves out is not a bucket the server emptied");
{
  const base = M.sets({ done: ["1.1"], ex: ["1.1#a"], exam: ["0"], exam2: ["0"] });
  const s = store({ done: { "1.1": 1 }, ex: { "1.1#a": 1 }, exam: { tasks: { 0: 1 } }, exam2: { tasks: { 0: 1 } } });
  const n = M.merge(s, {}, base);
  ok(s.done["1.1"] === 1 && s.ex["1.1#a"] === 1 && s.exam.tasks[0] === 1 && s.exam2.tasks[0] === 1 && n.off === 0,
    "an empty payload removes nothing from any bucket");
  ["a string", 42, null, [], ["1.1"]].forEach(function (junk) {
    const j = store({ done: { "1.1": 1 } });
    M.merge(j, { done: junk }, base);
    ok(j.done["1.1"] === 1, "a bucket that is " + JSON.stringify(junk) + " removes nothing");
  });
  const e = store({ exam: { tasks: { 0: 1 } } });
  M.merge(e, { exam: "not an object" }, base);
  ok(e.exam.tasks[0] === 1, "and neither does an exam that is not an object");
  const fresh = store({ exam: undefined, exam2: undefined });
  M.merge(fresh, { exam: { tasks: { 3: 1 } }, exam2: { tasks: { 4: 1 } } });
  ok(fresh.exam.tasks[3] === 1 && fresh.exam2.tasks[4] === 1, "an exam bucket the store lacks is built");
}

group("no payload reaches Object.prototype");
{
  const s = store();
  const src = JSON.parse('{"done":{"__proto__":{"polluted":1},"constructor":{"polluted":1},' +
    '"prototype":{"polluted":1},"toString":1,"hasOwnProperty":1,"2.1":1},' +
    '"drill":{"__proto__":{"polluted":1},"toString":{"r":9,"m":9}},' +
    '"days":{"__proto__":{"polluted":1}}}');
  const n = M.merge(s, src, M.sets({ done: ["toString"] }));
  ok({}.polluted === undefined && Object.prototype.polluted === undefined, "the prototype is untouched");
  ok(!Object.prototype.hasOwnProperty.call(s.done, "toString") &&
     !Object.prototype.hasOwnProperty.call(s.done, "constructor") &&
     !Object.prototype.hasOwnProperty.call(s.done, "prototype"),
    "every Object.prototype name is skipped, not merely __proto__");
  ok(!Object.prototype.hasOwnProperty.call(s.drill, "toString"), "the drill bucket skips them too");
  ok(s.done["2.1"] === 1 && n.done === 1, "and the real key in the same payload still lands");
}

group("drill records are counters: the max, never the last word");
{
  const now = Date.now();
  const s = store({ drill: { a: { r: 5, m: 1, ok: true, t: now } } });
  const n = M.merge(s, { drill: { a: { r: 2, m: 4, ok: false, t: now - 1000 } } });
  ok(s.drill.a.r === 5 && s.drill.a.m === 4, "r and m each take the higher of the two");
  ok(s.drill.a.ok === true && s.drill.a.t === now, "the older answer does not become the last one");
  ok(n.drill === 1, "a record that grew is counted once");

  const t = store({ drill: { a: { r: 1, m: 0, ok: true, t: now } } });
  M.merge(t, { drill: { a: { r: 1, m: 0, ok: false, t: now } } });
  ok(t.drill.a.ok === false, "on an exact tie the miss wins, so both browsers land on one record");

  const u = store({ drill: { a: { r: 1, m: 0, ok: false, t: now } } });
  M.merge(u, { drill: { a: { r: 1, m: 0, ok: true, t: now } } });
  ok(u.drill.a.ok === false, "and the tie breaks the same way from the other side");

  const v = store({ drill: { a: { r: 1, m: 0, ok: false, t: now - 1000 } } });
  const grew = M.merge(v, { drill: { a: { r: 1, m: 0, ok: true, t: now } } });
  ok(v.drill.a.ok === true && v.drill.a.t === now && grew.drill === 1, "a newer answer replaces the last one");

  const w = store({ drill: { a: { r: 3, m: 1, ok: true, t: now } } });
  const same = M.merge(w, { drill: { a: { r: 3, m: 1, ok: true, t: now } } });
  ok(same.drill === 0, "a record that matches is not counted as growth");

  const x = store();
  M.merge(x, { drill: { a: { r: 2, m: 1, ok: false, t: now } } });
  ok(x.drill.a.r === 2 && x.drill.a.m === 1, "a record this browser has never seen is created");

  const y = store({ drill: { a: "junk" } });
  M.merge(y, { drill: { a: { r: 2, m: 0, ok: true, t: now }, b: "junk", c: null, d: [] } });
  ok(y.drill.a.r === 2, "a local record that is junk is replaced by a real one");
  ok(y.drill.b === undefined && y.drill.c === undefined && y.drill.d === undefined,
    "an incoming record that is junk is skipped");
}

group("study days are counters too");
{
  const s = store({ days: { [TODAY]: { c: 4, x: 1 } } });
  const n = M.merge(s, { days: { [TODAY]: { c: 2, x: 3, s: 1 }, "not-a-day": { c: 9 }, [day(1)]: "junk" } });
  ok(s.days[TODAY].c === 4 && s.days[TODAY].x === 3 && s.days[TODAY].s === 1, "per-counter max, so nothing is lowered");
  ok(n.days === 1, "the day that grew is counted");
  ok(s.days["not-a-day"] === undefined, "a key that is not a date is not a day");
  ok(s.days[day(1)] === undefined, "a day record that is junk is skipped");
  const t = store({ days: { [TODAY]: { c: 9 } } });
  ok(M.merge(t, { days: { [TODAY]: { c: 9 } } }).days === 0, "a day that did not grow is not counted");
}

group("the drill's own day counter and the streak it earns");
{
  const s = store({ drillmeta: { day: TODAY, n: 7, streak: 2, best: 3, earned: day(1), t: 10 } });
  M.merge(s, { drillmeta: { day: TODAY, n: 4, streak: 1, best: 1, earned: day(2), t: 5 } });
  ok(s.drillmeta.n === 7, "the same day keeps the higher count");
  ok(s.drillmeta.streak === 2 && s.drillmeta.best === 3 && s.drillmeta.earned === day(1) && s.drillmeta.t === 10,
    "and every other field takes the max");

  const t = store({ drillmeta: { day: day(1), n: 9 } });
  M.merge(t, { drillmeta: { day: TODAY, n: 2 } });
  ok(t.drillmeta.day === TODAY && t.drillmeta.n === 2, "a newer day replaces the count rather than raising it");

  const u = store({ drillmeta: { day: TODAY, n: 9 } });
  M.merge(u, { drillmeta: { day: day(1), n: 99 } });
  ok(u.drillmeta.day === TODAY && u.drillmeta.n === 9, "an older day cannot touch today's count");

  const v = store();
  M.merge(v, { drillmeta: {} });
  ok(eq(v.drillmeta, {}), "a merge that adds nothing writes nothing");

  const w = store({ drillmeta: { streak: 1 } });
  M.merge(w, { drillmeta: { streak: 4 } });
  ok(w.drillmeta.best === 4, "best never sits below the streak it just took");
}

group("a streak that arrives backfills the days that earned it");
{
  const s = store();
  M.merge(s, { drillmeta: { streak: 3, earned: TODAY } });
  ok(s.days[TODAY] && s.days[day(1)] && s.days[day(2)] && !s.days[day(3)],
    "three days of ten cards are seeded, and no fourth");
  const t = store({ days: { [TODAY]: { x: 1 } } });
  M.merge(t, { drillmeta: { streak: 2, earned: TODAY } });
  ok(t.days[TODAY].x === 1 && t.days[TODAY].c === undefined, "a day that already has activity is left as it is");
  const u = store();
  M.merge(u, { drillmeta: { streak: 3, earned: day(5) } });
  ok(eq(u.days, {}), "a streak that died days ago seeds nothing");
}

group("the resume pointer only names a section that exists");
{
  const s = store({ last: "1.1" });
  M.merge(s, { last: "2.3" });
  ok(s.last === "2.3", "a section in the manifest is taken");
  M.merge(s, { last: "9.9" });
  ok(s.last === "2.3", "one that is not is ignored");
  M.merge(s, { last: 42 });
  ok(s.last === "2.3", "and so is a pointer that is not a string");
}

group("the ticked keys of a store, which is what a base is made of");
{
  const s = store({
    done: { "2.1": 1, "1.1": 0 }, ex: { "1.1#a": 1 },
    exam: { tasks: { 3: 1, 4: 0 }, running: true, startedAt: 5 }, exam2: {},
  });
  ok(eq(M.ticks(s), { done: ["2.1"], ex: ["1.1#a"], exam: ["3"], exam2: [] }),
    "only the ticked keys, sorted, and the exam's tasks rather than its clock");
  ok(eq(M.ticks(null), { done: [], ex: [], exam: [], exam2: [] }), "nothing at all reads as four empty buckets");
  ok(eq(M.ticks({ done: "junk", ex: [], exam: 7 }), { done: [], ex: [], exam: [], exam2: [] }),
    "and so does a store full of junk");
  const b = M.sets({ done: ["2.1"] });
  ok(b.done["2.1"] === 1 && Object.getPrototypeOf(b.done) === null,
    "the lookup the merge reads has no prototype to inherit a key from");
  ok(eq(M.sets(null), M.sets({})), "a base with no buckets is an empty lookup, not a crash");
}

group("the base one tab holds against another tab's store");
{
  const seen = { done: ["1.1", "2.1"], ex: ["1.1#a"], exam: ["0"], exam2: [] };
  const disk = { done: { "1.1": 0 }, ex: {}, exam: { tasks: { 0: 1 } } };
  const b = M.shared(seen, disk);
  ok(b.done["1.1"] === 1, "a tick that store mentions, even as 0, is one it can have removed");
  ok(b.done["2.1"] === undefined, "a tick it does not mention at all is one it never had");
  ok(b.ex["1.1#a"] === undefined, "an empty bucket mentions nothing");
  ok(b.exam["0"] === 1, "and the exam's tasks are read, not the exam");
  ok(Object.getPrototypeOf(b.done) === null, "the lookup has no prototype");

  // the whole point: an older tab saving its whole store is not a mass un-tick
  const mine = store({ done: { "1.1": 1, "2.1": 1 } });
  const stale = { done: { "1.1": 1 } };
  M.merge(mine, stale, M.shared({ done: ["1.1", "2.1"], ex: [], exam: [], exam2: [] }, stale));
  ok(mine.done["2.1"] === 1, "a tick the other tab's store never mentions survives its write");
  const untick = store({ done: { "1.1": 1, "2.1": 1 } });
  const removed = { done: { "1.1": 1, "2.1": 0 } };
  M.merge(untick, removed, M.shared({ done: ["1.1", "2.1"], ex: [], exam: [], exam2: [] }, removed));
  ok(untick.done["2.1"] === 0, "and a tick it did take back comes down as the removal it is");
}

group("the base a browser may hold against the copy that arrived");
{
  const base = { uid: "42", rev: 4, done: ["1.1"], ex: [], exam: [], exam2: [] };
  const same = { done: { "1.1": 1 } };
  // null-safe, so a base that stops being trusted reads as a failure and not a crash
  const held = (...a) => M.pickBase(...a) || { done: {}, ex: {}, exam: {}, exam2: {} };
  ok(held(base, same, 5, "42").done["1.1"] === 1, "a rev past the base's is a row that moved on, so the base stands");
  // the ordinary pull after another browser pushed: the ticks have moved on and
  // the base must still stand, or every un-tick made elsewhere is resurrected
  ok(held(base, { done: { "9.9": 1 } }, 5, "42").done["1.1"] === 1,
    "and it stands even though the copy that arrived has different ticks in it");
  ok(held(base, same, 4, "42").done["1.1"] === 1, "the base's own rev, carrying the base's own ticks, stands too");
  ok(M.pickBase(base, same, 3, "42") === null, "a rev below the base's means the row was deleted and remade");
  ok(M.pickBase(base, { done: { "2.1": 1 } }, 4, "42") === null,
    "one rev holds one blob, so the same rev with different ticks is a different row");
  ok(M.pickBase(base, same, 4, "99") === null, "a base kept for another account is not this account's");
  ok(held({ rev: 4, done: ["1.1"] }, same, 4, "42").done["1.1"] === 1,
    "a base from before the account was recorded is still usable");
  ok(held(base, same, 4, "").done["1.1"] === 1, "and so is one checked before the account is known");
  ok(M.pickBase(null, same, 4, "42") === null, "no base is no base");
  ["", "a string", 42, [], ["1.1"]].forEach(function (junk) {
    ok(M.pickBase(junk, same, 4, "42") === null, "a base that is " + JSON.stringify(junk) + " is refused");
  });
  ok(held({ done: ["1.1"] }, same, 0, "42").done["1.1"] === 1, "a base with no rev reads as rev 0");
  // the exam's ticks live under tasks on the wire and flat in the base
  const exam = { uid: "42", rev: 2, done: [], ex: [], exam: ["3"], exam2: [] };
  ok(held(exam, { exam: { tasks: { 3: 1 } } }, 2, "42").exam["3"] === 1,
    "the base's exam list is compared against the payload's exam tasks");
  ok(M.pickBase(exam, { exam: { tasks: { 4: 1 } } }, 2, "42") === null, "and a different task is a different row");
}

group("the shape a store goes over the wire in");
{
  const store = {
    done: { "1.1": 1 }, ex: {}, drill: {}, drillmeta: {}, days: {},
    exam: { tasks: { 0: 1 }, startedAt: 999, running: true, spent: 12 },
    exam2: "junk", last: "2.3",
  };
  const w = M.wire(store);
  ok(w.exam.startedAt === undefined && w.exam.running === undefined && w.exam.spent === undefined,
    "a running exam clock stays on the machine that started it");
  ok(w.exam.tasks[0] === 1, "the tasks it scored travel");
  ok(eq(w.exam2, { tasks: {} }), "an exam bucket that is junk goes out as an empty one");
  ok(w.last === undefined, "the resume pointer is this browser's own business");
  ok(store.exam.startedAt === 999 && store.last === "2.3", "and the store itself is not touched");
  w.done["9.9"] = 1;
  ok(store.done["9.9"] === undefined, "the copy is deep, so the caller cannot write through it");
  ok(M.wire(null) === null && M.wire("nope") === null, "there is no wire shape for nothing");
  const ticking = JSON.parse(JSON.stringify(store));
  ticking.exam.spent = 60; ticking.exam.running = false; ticking.last = "1.1";
  ok(M.canon(M.wire(ticking)) === M.canon(M.wire(store)),
    "two stores that differ only in the clock and the pointer go out identical, " +
    "which is what stops a running exam pushing every second");
}

group("what counts as having anything to save");
{
  ok(!M.hasAnything(null) && !M.hasAnything({}), "nothing is nothing");
  ok(!M.hasAnything(store()), "and so is a store that has only its empty buckets");
  ["ex", "done", "drill", "days"].forEach(function (k) {
    const s = store();
    s[k] = { x: 1 };
    ok(M.hasAnything(s), "a store with something in " + k + " earns a row");
  });
  const e = store();
  e.exam = { startedAt: 5, running: true, tasks: {} };
  ok(!M.hasAnything(e), "a running clock with nothing scored does not");
  e.exam.tasks[0] = 1;
  ok(M.hasAnything(e), "a scored task does");
  const e2 = store();
  e2.exam2 = { tasks: { 1: 1 } };
  ok(M.hasAnything(e2), "and so does one on the second paper");
}

group("comparing two stores ignores the order their keys came in");
{
  ok(M.canon({ a: 1, b: 2 }) === M.canon({ b: 2, a: 1 }), "key order does not change a store");
  ok(M.canon({ a: { y: 1, x: 2 } }) === M.canon({ a: { x: 2, y: 1 } }), "nor does it nested");
  ok(M.canon([1, 2]) !== M.canon([2, 1]), "but array order is order");
  ok(M.canon(undefined) === M.canon(null), "undefined and null read the same");
  ok(M.canon({ a: 1 }) !== M.canon({ a: "1" }), "and a number is not its string");
}

group("when a drill card comes round again");
{
  const now = Date.now(), DAY = 864e5;
  const days = rec => M.dueIn(rec, now) / DAY;
  ok(M.dueIn(undefined, now) <= 0, "a card nobody has answered is due");
  ok(M.dueIn({ r: 0, m: 0 }, now) <= 0, "and so is a record with no answer in it");
  ok(days({ r: 3, m: 1, ok: false, t: now }) === 0, "a card missed last time is due now, whatever its score");
  ok(days({ r: 1, m: 0, ok: true, t: now }) === 1, "one right answer buys a day");
  ok(days({ r: 2, m: 0, ok: true, t: now }) === 4, "two buy four");
  ok(days({ r: 3, m: 0, ok: true, t: now }) === 10, "three buy ten, the ease being 2.5 for a card never missed");
  ok(days({ r: 6, m: 0, ok: true, t: now }) === 21, "and the ladder stops at three weeks");
  const missed = days({ r: 6, m: 2, ok: true, t: now });
  ok(missed > 0 && missed < 21, "a card with misses on its record climbs slower: " + missed.toFixed(1) + " days");
  ok(days({ r: 2, m: 2, ok: true, t: now }) === 0, "a score that nets to nothing is due");
  ok(days({ r: 1, m: 0, ok: true, t: now - DAY }) === 0, "a day later, that card has come round");
  ok(M.dueIn({ r: 1, m: 0, ok: true }, now) <= 0, "a record with no timestamp cannot be resting");
  // r is whatever an imported file said, and the merge only ever raises it
  const started = Date.now();
  ok(days({ r: 1e15, m: 0, ok: true, t: now }) === 21 && Date.now() - started < 50,
    "an absurd score is capped without walking every rung to get there");
}

group("the counts the callers paint from");
{
  const s = store({ done: { "1.1": 1 } });
  const n = M.merge(s, {
    done: { "2.1": 1 }, ex: { "1.1#a": 1 }, exam: { tasks: { 0: 1 } }, exam2: { tasks: { 1: 1 } },
    drill: { a: { r: 1, m: 0, ok: true, t: 1 } }, days: { [TODAY]: { c: 1 } },
  }, M.sets({ done: ["1.1"] }));
  ok(eq(n, { done: 1, ex: 1, exam: 2, drill: 1, days: 1, off: 1 }),
    "one of each, and the tick the base says was removed: " + JSON.stringify(n));
}

/* ── the study streak ────────────────────────────────────────── */
group("\nthe streak counts back from today");
{
  const heat = (...ns) => Object.fromEntries(ns.map(n => [day(n), { c: 1 }]));
  const run = (days, over) => M.streak(store({ days, ...over }), TODAY);

  ok(run({}).streak === 0, "an empty store is not a streak");
  ok(run(heat(0)).streak === 1, "today alone is one day");
  ok(run(heat(0, 1, 2)).streak === 3, "three days running");
  ok(run(heat(0, 1, 3)).streak === 2, "and it stops at the gap, not through it");

  // The day is not over: a streak stays alive until yesterday falls off too.
  ok(run(heat(1, 2)).streak === 2, "yesterday still counts as alive");
  ok(run(heat(2, 3)).streak === 0, "the day before that does not");
  ok(run(heat(1, 2)).best === 2, "and the run is still the best on record");
}

group("what counts as a heartbeat");
{
  const one = k => M.streak(store({ days: { [TODAY]: k } }), TODAY).streak;
  ok(one({ c: 1 }) === 1, "a card answered");
  ok(one({ x: 1 }) === 1, "an exercise verified");
  ok(one({ s: 1 }) === 1, "a section completed");
  ok(one({ e: 1 }) === 1, "an exam task scored");
  ok(one({ c: 0, x: 0, s: 0, e: 0 }) === 0, "a day of all zeroes is not a heartbeat");
  ok(one({}) === 0, "nor is an empty record");
  ok(one("junk") === 0, "nor is a record that is not an object");
  // best, not streak: the walk back from today stops after one day either way,
  // so only the longest-run scan can see whether the junk key was counted.
  ok(M.streak(store({ days: { "not-a-day": { c: 9 } } }), TODAY).best === 0,
    "a key that is not a date is ignored rather than counted");
}

group("the lifetime best");
{
  const days = { ...Object.fromEntries([5, 6, 7, 8].map(n => [day(n), { c: 1 }])), [TODAY]: { c: 1 } };
  const r = M.streak(store({ days }), TODAY);
  ok(r.streak === 1, "the live streak is just today: " + r.streak);
  ok(r.best === 4, "but the best is the longest run anywhere in the record: " + r.best);
  ok(M.streak(store({ days, drillmeta: { best: 9 } }), TODAY).best === 9,
    "a higher best already recorded by the drill is a floor, never lowered");
  ok(M.streak(store({ days, drillmeta: { best: 2 } }), TODAY).best === 4,
    "and a lower one does not pull the computed best down");
}

group("the streak's guards");
{
  const z = { streak: 0, best: 0 };
  ok(eq(M.streak(null, TODAY), z), "no store at all");
  ok(eq(M.streak({}, TODAY), z), "a store with no days");
  ok(eq(M.streak({ days: "junk" }, TODAY), z), "days that is not an object");
  ok(eq(M.streak({ days: [] }, TODAY), z), "days that is an array");
  ok(M.streak({ days: { [TODAY]: { c: 1 } }, drillmeta: "junk" }, TODAY).best === 1,
    "drillmeta that is not an object");
  // No reference day, so it reads the clock: today is seeded, so this is 1.
  ok(M.streak(store({ days: { [TODAY]: { c: 1 } } })).streak === 1, "and with no today passed, it asks the clock");
  ok(M.streak(store({ days: { [TODAY]: { c: 1 } } }), "nonsense").streak === 1, "a junk today falls back to the clock");

  // Apia skipped 2011-12-30 and Kiritimati 1994-12-31, so in those zones the day
  // after is its own yesterday and the walk back would spin. shiftKey reads the
  // process TZ, so this only means anything in a child that sets it.
  for (const [tz, fixed] of [["Pacific/Apia", "2011-12-31"], ["Pacific/Kiritimati", "1995-01-01"]]) {
    const r = spawnSync(process.execPath, ["-e", `
      require(${JSON.stringify(MERGE)});
      globalThis.CNPE_MERGE.streak({ days: { ${JSON.stringify(fixed)}: { c: 1 } } }, ${JSON.stringify(fixed)});
    `], { env: { ...process.env, TZ: tz }, timeout: 5000 });
    ok(r.status === 0 && r.signal === null,
      "the walk back terminates on a day " + tz + " skipped (" + fixed + ")");
  }
}

console.log("\n" + checks + " checks, " + failures + " failures");
process.exitCode = failures ? 1 : 0;
