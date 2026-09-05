/* CNPE Quest: the engine. An overworld on a canvas, and every scene over it as
   DOM: the town menu, the trial, the battle terminal, the shop.

   Theory first, commands second. A town's people teach the section and hand out
   techniques; its trial is the section's self-check cards; the dungeon behind it
   holds a fault, and the fight is real commands against game-sim.js's cluster.

   Progress lives in store.game, in the shapes merge.js merges (see cnpe.d.ts):
   counters per browser slot, ticks as unions, the position stamped. Trial
   answers go into store.drill exactly as drill.js writes them, so the drill and
   the quest share one memory and one heartbeat. */
(function () {
  "use strict";

  var M = window.CNPE_MERGE as CnpeMergeApi;      // the guard below is the real check
  if (!M || !M.countOf || !M.dayKey) return;      // a cached older merge.js: the page stays static
  // mount() checks both before anything runs; the casts spare every reader a guard
  var D = window.CNPE_GAME_DATA as CnpeGameData, SIM = window.CNPE_SIM as CnpeSimApi, ART = window.CNPE_ART as CnpeArtApi;
  var TILE = 16, VW = 30, VH = 19;                   // the viewport, in tiles
  var W = VW * TILE, H = VH * TILE;                  // logical pixels; the backing scale is chosen for the screen in fitCanvas()
  var GOAL = 10;                                     // the drill's daily goal, mirrored so a trial can earn it
  var XP_ANSWER = 5, XP_TRIAL = 50, XP_EVIDENCE = 10, XP_WIN = 100, XP_BOSS = 300, XP_FINAL = 1000;
  var GOLD_TRIAL = 20, GOLD_WIN = 30, GOLD_BOSS = 100, GOLD_FINAL = 500;
  var TYPED = 1.2;                                   // typing beats picking from the menu
  var TITLES = ["novice", "apprentice", "operator", "engineer", "senior", "staff", "principal", "architect", "distinguished", "legend"];
  var STARTER_TECH = ["k-get", "k-describe", "k-events", "k-logs"];
  var STARTER_ITEMS: Record<string, number> = { scroll: 2 };
  var WALK: Record<string, number> = { grass: 1, road: 1, sand: 1, bridge: 1, town: 1, door: 1, keep: 1, gate: 1, flower: 1 };

  /* ── the shapes the scenes build ────────────────────────── */
  type Scene = "map" | "town" | "trial" | "battle" | "shop";
  type BattleMode = "menu" | "typed" | "inspect" | "fix" | "item" | "target";
  /** the theme's colours, read live from the stylesheet's custom properties (CnpeGamePalette in cnpe.d.ts) */
  type Palette = CnpeGamePalette;
  /** the dialogue window: one speaker, pages of text, an optional yes/no */
  interface Dialogue { who: string; pages: string[]; i: number; yes: (() => void) | null; ask: boolean; done?: () => void; }
  /** one multiple-choice option: a card's answer, right when it is the question's own */
  interface TrialOption { q: CnpeDrillQuestion; ok: boolean; }
  interface Trial {
    cards: CnpeDrillQuestion[]; i: number; right: number; marks: boolean[];
    /** the domain's cards, which the wrong answers are drawn from */
    pool: CnpeDrillQuestion[];
    revealed: boolean; opts: TrialOption[] | null; picked: number;
  }
  /** one line of the terminal: the system's word, a hit taken, xp gained, or a command and its answer */
  interface LogEntry { sys?: string; hit?: string; gain?: string; crit?: boolean; cmd?: string; out?: string; tell?: string | null; }
  /** a resource a picked technique can aim at */
  interface Target { label: string; value: string; ns?: string | null; }
  interface BattleOpts { town?: CnpeGameTown; boss?: CnpeGameRegion; final?: boolean; }
  interface BattleResult { sc: CnpeGameScenario; all: boolean; turns: number; }
  interface Battle {
    /** the scenario ids fought in turn, and which one is up */
    chain: string[]; idx: number; sc: CnpeGameScenario;
    /** evidence id -> 1 once surfaced */
    found: Record<string, number>;
    turn: number; log: LogEntry[]; mode: BattleMode; opts: BattleOpts;
    gained: number; goldGained: number; turnsTotal: number;
    /** the technique picked from the menu, waiting for its target */
    pick: { id: string; cmd: string } | null;
    targets?: Target[];
    /** a half-built command handed to the prompt, and that it came from the menu */
    pending?: string | null; fromMenu?: boolean;
    results?: BattleResult[]; over?: boolean;
  }
  /** the battle screen's parts, built once a battle and updated in place */
  interface BattleDom {
    root: HTMLElement; h3: HTMLElement; sub: HTMLElement; turn: HTMLElement;
    figure: HTMLElement; sprite: HTMLCanvasElement; nm: HTMLElement; lv: HTMLElement;
    guard: HTMLElement; guardLbl: HTMLElement; hpWrap: HTMLElement; hpBar: HTMLElement; hpLbl: HTMLElement;
    ticket: HTMLElement; modes: Record<string, HTMLButtonElement>; subHost: HTMLElement;
    tool: HTMLElement; found: HTMLElement; pre: HTMLElement; input: HTMLInputElement;
    /** log entries already in the terminal, and the scenario the figure shows */
    rendered: number; scId: string; family: string;
  }
  /** the town screen's parts, built once a visit and updated in place */
  interface TownDom {
    root: HTMLElement; sec: string; headRight: HTMLElement; menu: HTMLElement;
    items: Record<string, HTMLButtonElement>; right: HTMLElement; scene: string;
  }

  /* ── the store ──────────────────────────────────────────── */
  function api() { return window.CNPE_PROGRESS!; }   // mount() checks it is loaded
  function store() { return api().get(); }
  function save() { api().save(); paintTiles(); }
  function slot() { return api().slot ? api().slot() : ""; }
  function g(): CnpeGameState {
    var s = store();
    if (!s.game || typeof s.game !== "object" || Array.isArray(s.game)) s.game = {};
    return s.game;
  }
  // any on purpose: it reads junk-tolerant store fields, and its callers keep it local
  function obj(v: unknown): any { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  /** a slot-map counter, bumped for this browser */
  function bump(owner: any, key: string, n: number) {
    var m = obj(owner[key]);
    if (!m) {
      // a plain number is a count from before the slots; it stays unnamed
      var was = typeof owner[key] === "number" && owner[key] > 0 ? owner[key] : 0;
      m = owner[key] = {};
      if (was) m[""] = was;
    }
    var id = slot();
    m[id] = (+m[id] || 0) + n;
  }
  function xp() { return M.countOf(g().xp); }
  function gold() { var gd = obj(g().gold) || {}; return Math.max(0, M.countOf(gd.e) - M.countOf(gd.s)); }
  function held(id: string) { var it = obj(g().items), rec = it && obj(it[id]); return rec ? Math.max(0, M.countOf(rec.g) - M.countOf(rec.u)) : 0; }
  function addXp(n: number) { if (n > 0) bump(g(), "xp", Math.round(n)); }
  function addGold(n: number) { var gd = obj(g().gold) || (g().gold = {}); if (n > 0) bump(gd, "e", Math.round(n)); }
  function spendGold(n: number) { if (n > gold()) return false; var gd = obj(g().gold) || (g().gold = {}); bump(gd, "s", n); return true; }
  function giveItem(id: string, n: number) { var it = obj(g().items) || (g().items = {}); var rec = obj(it[id]) || (it[id] = {}); bump(rec, "g", n); }
  function useItem(id: string) { if (held(id) < 1) return false; var rec = obj(g().items![id]); bump(rec, "u", 1); return true; }
  function tick(b: "towns" | "learned" | "flags", k: string) { var m = obj(g()[b]) || (g()[b] = {}); if (m[k]) return false; m[k] = 1; return true; }
  function has(b: "towns" | "learned" | "flags", k: string) { var m = obj(g()[b]); return !!(m && m[k]); }
  function wins(id: string) { var w = obj(g().wins), r = w && obj(w[id]); return r ? (+r.n || 0) : 0; }
  function recordWin(id: string, turns: number) {
    var w = obj(g().wins) || (g().wins = {});
    var r = obj(w[id]) || (w[id] = { n: 0 });
    r.n = (+r.n || 0) + 1;
    if (!(+r.best > 0) || turns < +r.best) r.best = turns;
    r.t = Date.now();
  }
  function level() {
    var x = xp(), lv = 1;
    for (var i = 1; i < D.levels.length; i++) if (x >= D.levels[i]) lv = i + 1;
    return lv;
  }
  function title(lv: number) { return TITLES[Math.min(TITLES.length - 1, Math.floor((lv - 1) / 3))]; }
  function maxHp() { return 20 + level() * 4; }
  function totalBattles() { return D.scenarios.length + D.regions.length + 1; }
  function battlesWon() {
    var n = D.scenarios.filter(function (s) { return wins(s.id) > 0; }).length;
    D.regions.forEach(function (r) { if (has("flags", "boss-" + r.d)) n++; });
    if (has("flags", "final")) n++;
    return n;
  }
  function paintTiles() {
    var set = function (id: string, html: string) { var e = document.getElementById(id); if (e) e.innerHTML = html; };
    var lv = level(), next = D.levels[lv];
    set("gm-level", lv + '<span class="u">' + title(lv) + "</span>");
    set("gm-xp", xp() + '<span class="u">' + (next != null ? "next at " + next : "max") + "</span>");
    set("gm-gold", gold() + '<span class="u">held</span>');
    set("gm-wins", battlesWon() + '<span class="u">of ' + totalBattles() + "</span>");
  }

  /* ── the drill's record, written the way drill.js writes it ─── */
  function recordDrill(q: CnpeDrillQuestion, okAns: boolean) {
    var s = store();
    if (!s.drill || typeof s.drill !== "object") s.drill = {};
    var rec = s.drill[q.id] || { r: 0, m: 0 };
    if (okAns) rec.r++; else rec.m++;
    rec.ok = okAns; rec.t = Date.now();
    s.drill[q.id] = rec;
    if (api().bump) api().bump("c");                  // the day's heartbeat
    if (!s.drillmeta || typeof s.drillmeta !== "object") s.drillmeta = {};
    var m = s.drillmeta, today = M.dayKey(new Date());
    var d = s.days && s.days[today];
    if (d && M.countOf(d.c) >= GOAL && m.earned !== today) {
      m.streak = m.earned === M.shiftKey(today, -1) ? (m.streak || 0) + 1 : 1;
      m.earned = today;
      m.best = Math.max(m.best || 0, m.streak);
    }
    m.t = Date.now();
  }

  /* ── helpers ────────────────────────────────────────────── */
  function el(tag: string, cls?: string, html?: string) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s: string) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function text(html: string) { var t = el("div", "", html); return (t.textContent || "").replace(/\s+/g, " ").trim(); }
  function btn(label: string, fn: () => void, cls?: string): HTMLButtonElement {
    var b = el("button", cls || "", label) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", function (e) { e.preventDefault(); fn(); });
    return b;
  }
  function navOf(sec: string) { return (window.CNPE_NAV || []).filter(function (n) { return n.id === sec; })[0]; }
  function pageHref(path: string, id: string) { return window.CNPE_BUNDLE ? "#" + id : path; }
  function domainOf(d: number) { return (window.CNPE_DOMAINS || []).filter(function (x) { return x.n === d; })[0]; }
  function scenario(id: string) { return D.scenarios.filter(function (s) { return s.id === id; })[0]; }
  function shuffle<T>(a: T[]) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // a deterministic hash for tile texture and monster shapes
  function hash(x: number, y: number) { var h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function str2n(s: string) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

  /* ── the palette, read live so the theme switch repaints ───── */
  var P = {} as Palette;                             // filled by readPalette() before the first draw
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (n: string) { return cs.getPropertyValue(n).trim() || "#888"; };
    P = { ink: v("--ink"), sunk: v("--ink-sunk"), s1: v("--surface"), s2: v("--surface-2"), s3: v("--surface-3"),
      rule: v("--rule"), rule2: v("--rule-2"), paper: v("--paper"), paper2: v("--paper-2"), paper3: v("--paper-3"),
      accent: v("--accent"), accentDim: v("--accent-dim"), accentLit: v("--accent-lit"), warn: v("--warn"), warnDim: v("--warn-dim"),
      ok: v("--ok"), okLit: v("--ok-lit"), bad: v("--bad"), badLit: v("--bad-lit"), viol: v("--viol"), info: v("--info") };
    ART.theme(P);                                    // every sprite is repainted from these on its next use
    terrainSig = "";                                 // and the terrain with them
  }

  /* ── state ──────────────────────────────────────────────── */
  let host!: HTMLElement;
  let stage!: HTMLElement;
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;
  let hud!: HTMLElement, whereEl!: HTMLElement, dialog!: HTMLElement, screen!: HTMLElement, live!: HTMLElement;
  var player = { x: 0, y: 0, face: "d" };
  var scene: Scene = "map";                           // map | town | trial | battle | shop
  var town: CnpeGameTown | null = null;
  var trial: Trial | null = null;
  var battle: Battle | null = null;
  var hp = 0;                                         // the session's hearts; a page load heals
  var dlg: Dialogue | null = null;                    // { who, pages: [], i, done: fn }
  var posTimer = 0, keysWired = false, themeWired = false, dirty = true;
  var bt: BattleDom | null = null;                    // the battle screen, while one is built
  var tn: TownDom | null = null;                      // the town screen, while one is built
  var fx: string | null = null;                       // the effect the next battle paint plays: hit, stagger, win
  var walked = false;                                 // a step was taken: only then is the position worth a save

  /* ── the overworld ──────────────────────────────────────── */
  function tileAt(x: number, y: number) {
    var row = D.map[y];
    if (!row) return "void";
    var ch = row[x];
    return ch ? (D.tiles[ch] || "void") : "void";
  }
  function walkable(x: number, y: number) { return !!WALK[tileAt(x, y)]; }
  function townAt(x: number, y: number) { return D.towns.filter(function (t) { return t.x === x && t.y === y; })[0] || null; }
  function doorAt(x: number, y: number) { return D.towns.filter(function (t) { return t.door.x === x && t.door.y === y; })[0] || null; }
  function keepAt(x: number, y: number) { return D.regions.filter(function (r) { return r.keep.x === x && r.keep.y === y; })[0] || null; }
  function gateAt(x: number, y: number) { return D.finale.keep.x === x && D.finale.keep.y === y; }
  /** the region a tile falls in: the nearest town's, which is what a road sign would say */
  function regionAt(x: number, y: number) {
    var best = null as CnpeGameTown | null, bd = 1e9;
    D.towns.forEach(function (t) { var d = Math.abs(t.x - x) + Math.abs(t.y - y); if (d < bd) { bd = d; best = t; } });
    return best ? { region: D.regions.filter(function (r) { return r.d === +best!.sec.split(".")[0]; })[0], town: best, dist: bd } : null;
  }
  function dungeonOpen(t: CnpeGameTown) { return has("towns", t.sec); }
  function keepOpen(r: CnpeGameRegion) { return D.scenarios.filter(function (s) { return s.d === r.d; }).every(function (s) { return wins(s.id) > 0; }); }
  function gateOpen() { return D.regions.every(function (r) { return has("flags", "boss-" + r.d); }); }

  function loadPos() {
    var p = obj(g().pos);
    if (p && walkable(+p.x, +p.y)) { player.x = +p.x; player.y = +p.y; }
    else { player.x = D.start.x; player.y = D.start.y; }
  }
  function savePos(now: boolean) {
    if (posTimer) { clearTimeout(posTimer); posTimer = 0; }
    if (!walked) return;                              // opening the page is not an action
    var write = function () {
      var p = obj(g().pos);
      if (p && p.x === player.x && p.y === player.y) return;
      g().pos = { x: player.x, y: player.y, t: Date.now() };
      save();
    };
    if (now) write(); else posTimer = setTimeout(write, 1500);
  }

  function move(dx: number, dy: number) {
    if (scene !== "map") return;
    if (dlg) { advanceDialog(); return; }
    player.face = dx < 0 ? "l" : dx > 0 ? "r" : dy < 0 ? "u" : "d";
    var nx = player.x + dx, ny = player.y + dy;
    // A blocked step turns you and nothing more: arriving is for a tile you
    // reached, or leaving a town with a step into the sea would put you back in it.
    if (!walkable(nx, ny)) { requestDraw(); return; }
    player.x = nx; player.y = ny; walked = true; savePos(false);
    step();
    requestDraw();
    arrive();
  }
  // What standing on a tile means. Walking onto a town enters it; the doors and
  // the keeps ask first, because a battle is a commitment.
  function arrive() {
    var t = townAt(player.x, player.y);
    if (t) { enterTown(t); return; }
    var d = doorAt(player.x, player.y);
    if (d) {
      if (!dungeonOpen(d)) { say(d.name, ["The door is sealed. A voice from the stone: <em>pass the trial in " + d.name + " first, and the way opens.</em>"]); return; }
      var sc = scenario(d.dungeon);
      say("Dungeon of " + d.name, ["Something stirs below: <b>" + esc(sc.name) + "</b>" + (wins(sc.id) ? " (beaten " + wins(sc.id) + (wins(sc.id) === 1 ? " time" : " times") + ")" : "") + ". Difficulty " + stars(sc.difficulty) + ". Go down and fight it?"],
        function () { startBattle([sc.id], { town: d }); }, true);
      return;
    }
    var k = keepAt(player.x, player.y);
    if (k) {
      if (!keepOpen(k)) { say(k.name + " keep", ["The keep's gate holds. Clear every dungeon in " + k.name + " and it opens: " + D.scenarios.filter(function (s) { return s.d === k.d && !wins(s.id); }).map(function (s) { return s.name; }).join(", ") + " still stand."]); return; }
      say(k.name + " keep", ["Two faults wait inside, one after the other: <b>" + k.boss.map(function (id) { return esc(scenario(id).name); }).join("</b> and <b>") + "</b>." + (has("flags", "boss-" + k.d) ? " You have beaten them before." : "") + " Enter the keep?"],
        function () { startBattle(k.boss.slice(), { boss: k }); }, true);
      return;
    }
    if (gateAt(player.x, player.y)) {
      if (!gateOpen()) { say("The Exam", ["The gate is shut. Five keeps guard it; " + D.regions.filter(function (r) { return !has("flags", "boss-" + r.d); }).map(function (r) { return r.name; }).join(", ") + " still hold."]); return; }
      say("The Exam", ["Beyond the gate, three faults drawn at random, on a shorter clock. Everything you learned, all at once." + (has("flags", "final") ? " You have passed before." : "") + " Sit the exam?"],
        function () { startBattle(shuffle(D.finale.pool.slice()).slice(0, D.finale.pick), { final: true }); }, true);
    }
  }
  function act() {
    if (scene !== "map") return;
    if (dlg) { advanceDialog(); return; }
    arrive();
    if (!dlg && scene === "map") {
      var here = regionAt(player.x, player.y);
      if (here) say("You look around", ["<b>" + esc(here.region.name) + "</b>. " + (here.dist ? esc(here.town.name) + " is " + here.dist + " steps away." : "")]);
    }
  }
  function stars(n: number) { var s = ""; for (var i = 0; i < 3; i++) s += i < n ? "▲" : "▽"; return s.replace(/▽/g, "·"); }

  /* the dialogue window: one speaker, pages of text, an optional yes/no */
  function say(who: string, pages: string[], yes?: (() => void) | null, ask?: boolean) {
    dlg = { who: who, pages: pages, i: 0, yes: yes || null, ask: !!ask };
    paintDialog();
  }
  function paintDialog() {
    if (!dlg) { dialog.hidden = true; return; }
    dialog.hidden = false;
    var last = dlg.i >= dlg.pages.length - 1;
    dialog.innerHTML = '<div class="who">' + esc(dlg.who) + '</div><div class="txt">' + dlg.pages[dlg.i] + "</div>";
    var more = el("div", "more");
    if (last && dlg.ask) {
      more.appendChild(btn("No, not yet", function () { closeDialog(); }, "gm-btn ghost"));
      more.appendChild(btn("Yes", function () { var fn = dlg!.yes; closeDialog(); if (fn) fn(); }, "gm-btn"));
    } else {
      more.appendChild(btn(last ? "Close" : "Next ▶", function () { advanceDialog(); }, "gm-btn ghost"));
    }
    dialog.appendChild(more);
    live.textContent = dlg.who + ": " + text(dlg.pages[dlg.i]);
    var b = dialog.querySelector("button"); if (b) b.focus();
  }
  function advanceDialog() {
    if (!dlg) return;
    if (dlg.i < dlg.pages.length - 1) { dlg.i++; paintDialog(); return; }
    if (dlg.ask) return;                              // the question waits for its buttons
    closeDialog();
  }
  function closeDialog() {
    var done = dlg && dlg.done;
    dlg = null; dialog.hidden = true;
    if (scene === "map") stage.focus();
    if (done) done();
  }

  /* ── drawing ────────────────────────────────────────────── */
  // The overworld is two layers. The terrain, every tile of the whole map, is
  // painted once into an offscreen canvas and painted again only when the
  // palette or a landmark's state changes. A frame blits the viewport out of
  // it, then draws what moves: the water's current frame, the banners, the
  // player. Frames are requested and painted on the next animation frame, so
  // a held key coalesces and a still map costs nothing.
  var terrain: HTMLCanvasElement | null = null, terrainSig = "";
  var mapW = 0, mapH = 0;
  var regionOf: Uint8Array = new Uint8Array(0);       // the domain each tile belongs to; 0 on the open sea
  var scale = 2, dprSeen = 1;                         // whole device pixels per art pixel, chosen for the screen
  var rafId = 0, animTimer = 0, idleTimer = 0, waterFrame = 0, walkFrame = 0, waterInView = 1;
  var ANIM_MS = 420;                                  // the water's beat
  var motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduceMotion = !!(motionQuery && motionQuery.matches);
  var stats = { frames: 0, drawMs: 0, terrainRenders: 0, terrainMs: 0 };

  function camera() {
    return { x: Math.max(0, Math.min(mapW - VW, player.x - Math.floor(VW / 2))), y: Math.max(0, Math.min(mapH - VH, player.y - Math.floor(VH / 2))) };
  }
  /** water for the shoreline's purposes: the sea, a bridge over it, and the void past the edge */
  function isWater(x: number, y: number) { var t = tileAt(x, y); return t === "water" || t === "bridge" || t === "void"; }
  function isRoadLike(x: number, y: number) { var t = tileAt(x, y); return t === "road" || t === "bridge" || t === "town" || t === "door" || t === "keep" || t === "gate"; }
  function isCliff(x: number, y: number) { return tileAt(x, y) === "cliff"; }
  /** N=1 E=2 S=4 W=8, set where the neighbour is not the same kind */
  function edgeMask(x: number, y: number, same: (x: number, y: number) => boolean) {
    return (same(x, y - 1) ? 0 : 1) | (same(x + 1, y) ? 0 : 2) | (same(x, y + 1) ? 0 : 4) | (same(x - 1, y) ? 0 : 8);
  }
  /** N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128, set where the neighbour is land */
  function shoreMask(x: number, y: number) {
    return (isWater(x, y - 1) ? 0 : 1) | (isWater(x + 1, y - 1) ? 0 : 2) | (isWater(x + 1, y) ? 0 : 4) | (isWater(x + 1, y + 1) ? 0 : 8) |
      (isWater(x, y + 1) ? 0 : 16) | (isWater(x - 1, y + 1) ? 0 : 32) | (isWater(x - 1, y) ? 0 : 64) | (isWater(x - 1, y - 1) ? 0 : 128);
  }
  /** which region each tile is in, for its colours: the region of the town
      nearest by land, flooding out from every town at once and never across
      water, so the tint changes at the rivers and the strait rather than in the
      middle of a meadow. The sand around the Exam gate belongs to no region. */
  function buildRegions() {
    mapW = D.map[0].length; mapH = D.map.length;
    regionOf = new Uint8Array(mapW * mapH);
    var seen = new Uint8Array(mapW * mapH);
    var queue: number[] = [];
    D.towns.forEach(function (t) { var i = t.y * mapW + t.x; regionOf[i] = +t.sec.split(".")[0]; seen[i] = 1; queue.push(i); });
    for (var q = 0; q < queue.length; q++) {
      var i = queue[q], x = i % mapW, y = (i - x) / mapW, d = regionOf[i];
      var next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (var n = 0; n < 4; n++) {
        var nx = next[n][0], ny = next[n][1];
        if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
        var j = ny * mapW + nx, t = tileAt(nx, ny);
        if (seen[j] || t === "water" || t === "bridge" || t === "sand" || t === "gate") continue;
        seen[j] = 1; regionOf[j] = d; queue.push(j);
      }
    }
    for (var y2 = 0; y2 < mapH; y2++) for (var x2 = 0; x2 < mapW; x2++) {
      var k = y2 * mapW + x2;
      if (seen[k] || isWater(x2, y2)) continue;
      var t2 = tileAt(x2, y2);
      if (t2 === "sand" || t2 === "gate") continue;             // the gate's island stays neutral
      var here = regionAt(x2, y2);                              // an islet with no town: the nearest town's, as the signpost says
      regionOf[k] = here ? here.region.d : 0;
    }
  }
  /** what the terrain was painted with: the doors, keeps and gate can change state */
  function landmarkSig() {
    var s = "";
    for (var i = 0; i < D.towns.length; i++) s += has("towns", D.towns[i].sec) ? "1" : "0";
    for (var j = 0; j < D.regions.length; j++) s += has("flags", "boss-" + D.regions[j].d) ? "1" : "0";
    return s + (has("flags", "final") ? "F" : gateOpen() ? "O" : "S");
  }
  /** the sprite for a map tile, in the water's given frame */
  function tileSprite(mx: number, my: number, frame: number): HTMLCanvasElement | null {
    var t = tileAt(mx, my), d = regionOf[my * mapW + mx] || 0, v = Math.floor(hash(mx, my) * 4);
    switch (t) {
      case "grass": return ART.grass(v, d);
      case "flower": return ART.flower(v, d);
      case "road": return ART.road(v, d, edgeMask(mx, my, isRoadLike));
      case "sand": return ART.sand(v, d);
      case "tree": return ART.tree(v, d);
      case "cliff": return ART.cliff(v, d, edgeMask(mx, my, isCliff));
      case "water": return ART.water(shoreMask(mx, my), frame);
      // a bridge runs north-south unless the water passes under it that way
      case "bridge": return ART.bridge(!(isWater(mx, my - 1) && isWater(mx, my + 1)));
      case "town": return ART.town(d);
      case "door": { var dr = doorAt(mx, my); return ART.door(d, !!(dr && dungeonOpen(dr))); }
      case "keep": { var kp = keepAt(mx, my); return ART.keep(kp ? kp.d : d, !!(kp && has("flags", "boss-" + kp.d))); }
      case "gate": return ART.gate(has("flags", "final") ? 2 : gateOpen() ? 1 : 0);
      default: return null;
    }
  }
  function renderTerrain() {
    var t0 = performance.now();
    if (!terrain) { terrain = document.createElement("canvas"); terrain.width = mapW * TILE; terrain.height = mapH * TILE; }
    var k = terrain.getContext("2d");
    if (!k) return;
    k.imageSmoothingEnabled = false;
    k.fillStyle = P.sunk; k.fillRect(0, 0, terrain.width, terrain.height);
    for (var y = 0; y < mapH; y++) for (var x = 0; x < mapW; x++) {
      var s = tileSprite(x, y, 0);
      if (s) k.drawImage(s, x * TILE, y * TILE);
    }
    terrainSig = landmarkSig();
    stats.terrainRenders++; stats.terrainMs += performance.now() - t0;
  }
  /** paint on the next animation frame; several requests in one frame are one paint */
  function requestDraw() {
    dirty = true;
    if (!rafId && scene === "map") rafId = requestAnimationFrame(frame);
  }
  function frame() { rafId = 0; draw(); }
  function draw() {
    if (!ctx || scene !== "map" || !dirty) return;
    dirty = false;
    var t0 = performance.now();
    if (!terrain || terrainSig !== landmarkSig()) renderTerrain();
    var cam = camera(), cx = cam.x, cy = cam.y;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrain!, cx * TILE, cy * TILE, W, H, 0, 0, W, H);
    // the water's frame, over the first frame the terrain holds
    waterInView = 0;
    for (var y = 0; y < VH; y++) for (var x = 0; x < VW; x++) {
      if (tileAt(cx + x, cy + y) !== "water") continue;
      waterInView++;
      if (waterFrame) ctx.drawImage(ART.water(shoreMask(cx + x, cy + y), waterFrame), x * TILE, y * TILE);
    }
    // banners over towns and keeps, so the map reads without a legend
    ctx.font = "8px CNPE Mono, ui-monospace, monospace"; ctx.textBaseline = "top";
    D.towns.forEach(function (t) { label(t.name, t.x - cx, t.y - cy, has("towns", t.sec) ? P.ok : P.paper); });
    D.regions.forEach(function (r) { label(r.name + " keep", r.keep.x - cx, r.keep.y - cy, has("flags", "boss-" + r.d) ? P.ok : P.warn); });
    label("The Exam", D.finale.keep.x - cx, D.finale.keep.y - cy, has("flags", "final") ? P.ok : P.viol);
    ctx.drawImage(ART.hero(player.face, reduceMotion ? 0 : walkFrame), (player.x - cx) * TILE, (player.y - cy) * TILE);
    var here = regionAt(player.x, player.y);
    var what = tileAt(player.x, player.y);
    var t = townAt(player.x, player.y), d = doorAt(player.x, player.y), k = keepAt(player.x, player.y);
    var where = here ? here.region.name + (t ? " · " + t.name : d ? " · dungeon of " + d.name : k ? " · the keep" : gateAt(player.x, player.y) ? " · the Exam gate" : "") : "";
    whereEl.textContent = where;
    canvas.setAttribute("aria-label", "Overworld map. You stand on " + what + " in " + where + ". " + (here && here.dist ? here.town.name + " is " + here.dist + " steps away." : ""));
    stats.frames++; stats.drawMs += performance.now() - t0;
  }
  /** a pixel banner: ink on a rim, a pointer toward the tile, the name in its state's colour */
  function label(s: string, tx: number, ty: number, color: string) {
    if (tx < -4 || tx >= VW + 4 || ty < 0 || ty >= VH) return;
    var w = s.length * 5 + 8, x = Math.round(tx * TILE + TILE / 2 - w / 2), y = ty * TILE - 14, below = false;
    if (y < 0) { y = ty * TILE + TILE + 3; below = true; }
    var px = Math.round(tx * TILE + TILE / 2);
    ctx.fillStyle = P.paper3; ctx.fillRect(x - 1, y - 1, w + 2, 12);
    if (below) { ctx.fillRect(px - 2, y - 2, 4, 1); ctx.fillRect(px - 1, y - 3, 2, 1); }
    else { ctx.fillRect(px - 2, y + 11, 4, 1); ctx.fillRect(px - 1, y + 12, 2, 1); }
    ctx.fillStyle = P.ink; ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = color; ctx.fillText(s, x + 4, y + 1);
  }
  /** a step taken: the other foot, then back to standing once you stop */
  function step() {
    walkFrame ^= 1;
    if (reduceMotion) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { idleTimer = 0; if (walkFrame) { walkFrame = 0; requestDraw(); } }, 260);
  }
  /** the water's beat: only on the map, only when it can be seen, never under reduced motion */
  function syncAnim() {
    var want = scene === "map" && !reduceMotion && document.visibilityState !== "hidden" && !!host && document.body.contains(host);
    if (want && !animTimer) animTimer = setTimeout(tickAnim, ANIM_MS);
    if (!want && animTimer) { clearTimeout(animTimer); animTimer = 0; }
    if (!want && waterFrame) { waterFrame = 0; requestDraw(); }
  }
  function tickAnim() {
    animTimer = 0;
    waterFrame = (waterFrame + 1) % ART.FRAMES;
    if (waterInView) requestDraw();
    syncAnim();
  }
  /** the backing store: whole device pixels per art pixel, so the art stays sharp on any screen */
  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1, cssW = stage.clientWidth || W;
    var s = Math.max(1, Math.min(4, Math.round(cssW * dpr / W)));
    dprSeen = dpr;
    if (s === scale && canvas.width === W * s) return;
    scale = s; canvas.width = W * s; canvas.height = H * s;
    requestDraw();
  }
  /** the monster: the fault family's sprite, painted in the theme's colours */
  function drawMonster(c: HTMLCanvasElement, family: string) {
    var k = c.getContext("2d");
    if (!k) return;
    k.setTransform(1, 0, 0, 1, 0, 0); k.imageSmoothingEnabled = false; k.clearRect(0, 0, c.width, c.height);
    k.drawImage(ART.enemy(family, 3), 0, 0);
  }
  function paintHud() {
    var mh = maxHp(), cells = "";
    for (var i = 0; i < 10; i++) cells += '<i class="' + (hp > (i / 10) * mh ? "" : "off") + '"></i>';
    hud.innerHTML = '<span class="lv">Lv <b>' + level() + "</b></span><span class=\"hp\" title=\"" + hp + " of " + mh + '">' + cells + "</span><span class=\"g\"><b>" + gold() + "</b>g</span>";
  }

  /* ── scenes ─────────────────────────────────────────────── */
  function setScene(next: Scene) {
    scene = next;
    var onMap = next === "map";
    screen.hidden = onMap;
    canvas.style.visibility = onMap ? "" : "hidden";
    hud.hidden = !onMap; whereEl.hidden = !onMap;
    stage.classList.toggle("gm-map", onMap);
    if (onMap) { screen.innerHTML = ""; bt = null; tn = null; requestDraw(); paintHud(); savePos(true); }
    else { dialog.hidden = true; dlg = null; }
    syncAnim();
  }
  function leaveToMap() { town = null; trial = null; battle = null; setScene("map"); stage.focus(); }

  /** the town: header, the menu, and whatever the menu opened on the right,
      over a strip of scenery for the square, the inn, the shop or the people.
      The header and the menu are built once a visit and their lines updated;
      only the right column is rebuilt. */
  function enterTown(t: CnpeGameTown) {
    town = t;
    setScene("town");
    paintTown(null);
  }
  function buildTown(t: CnpeGameTown): TownDom {
    var nav = navOf(t.sec), dom = domainOf(+t.sec.split(".")[0]);
    screen.innerHTML = "";
    var root = el("div", "gm-town");
    var head = el("div", "gm-title", "<h3>" + esc(t.name) + '</h3><span class="sub">' + esc(t.sec) + " · " + esc(nav ? nav.title : "") + "</span>");
    var headRight = el("span", "right", esc(dom ? dom.name : ""));
    head.appendChild(headRight);
    root.appendChild(head);
    var body = el("div", "gm-body"), left = el("div", "gm-col"), right = el("div", "gm-col");
    var menu = el("ul", "gm-menu"), items: Record<string, HTMLButtonElement> = {};
    var item = function (id: string, fn: () => void) { var li = el("li"); var b = btn("", fn); li.appendChild(b); menu.appendChild(li); items[id] = b; };
    item("talk", function () { paintTown(talkMenu(), "talk"); });
    var read = el("li"); var a = el("a", "", "Read the section" + '<span class="k">' + esc(t.sec) + "</span>") as HTMLAnchorElement;
    a.href = nav ? pageHref(nav.path, nav.id) : "index.html"; read.appendChild(a); menu.appendChild(read);
    a.addEventListener("click", function () { savePos(true); });
    item("trial", function () { startTrial(); });
    item("inn", function () { hp = maxHp(); paintHud(); paintTown(note("You sleep. The pager stays quiet. Health restored to " + hp + ".", "ok"), "inn"); });
    item("shop", function () { paintTown(shopMenu(), "shop"); });
    item("dungeon", function () {
      if (!dungeonOpen(t)) { paintTown(note("The dungeon door is sealed until you pass this town's trial.", "warn")); return; }
      startBattle([scenario(t.dungeon).id], { town: t });
    });
    item("leave", function () { leaveToMap(); });
    left.appendChild(menu);
    body.appendChild(left); body.appendChild(right);
    root.appendChild(body);
    screen.appendChild(root);
    return { root: root, sec: t.sec, headRight: headRight, menu: menu, items: items, right: right, scene: "square" };
  }
  function setItem(b: HTMLButtonElement, label: string, meta: string, cls?: string) {
    b.innerHTML = label + (meta ? '<span class="k">' + meta + "</span>" : "");
    b.className = cls || "";
  }
  function paintTown(right: HTMLElement | null, sceneName?: string) {
    var t = town!, nav = navOf(t.sec), dom = domainOf(+t.sec.split(".")[0]);
    if (!tn || tn.root.parentNode !== screen || tn.sec !== t.sec) tn = buildTown(t);
    var v = tn;
    v.headRight.innerHTML = esc(dom ? dom.name : "") + (has("towns", t.sec) ? " · trial cleared ✓" : "");
    var taught = t.npcs.filter(function (n) { return n.teaches && !has("learned", n.teaches); }).length;
    setItem(v.items.talk, "Talk", t.npcs.length + " people" + (taught ? " · " + taught + " new" : ""), taught ? "new" : "");
    setItem(v.items.trial, "Trial", deckFor(t.sec).length + " questions" + (has("towns", t.sec) ? " · cleared" : ""));
    setItem(v.items.inn, "Inn", hp < maxHp() ? "rest, heal" : "you are rested");
    setItem(v.items.shop, "Shop", gold() + "g held");
    var sc = scenario(t.dungeon);
    setItem(v.items.dungeon, "Dungeon", esc(sc.name) + (dungeonOpen(t) ? "" : " · sealed"));
    setItem(v.items.leave, "Leave", "esc");
    v.scene = sceneName || v.scene;
    v.right.innerHTML = "";
    v.right.appendChild(backdrop(v.scene, +t.sec.split(".")[0]));
    if (right) v.right.appendChild(right);
    else v.right.appendChild(el("div", "gm-lines", "<p>" + esc(t.blurb || ("The people here work on " + (nav ? nav.title.toLowerCase() : "the platform") + ".")) + "</p><p class=\"gm-note\">Talk to learn the ideas and the commands. Pass the trial to open the dungeon. Read the section itself when a question stumps you.</p>"));
    focusFirst(v.menu);
  }
  /** a strip of scenery: the town square, its people, the inn or the shop, in the region's colours */
  function backdrop(sceneName: string, d: number) {
    var c = el("canvas", "gm-scene") as HTMLCanvasElement;
    c.width = 480; c.height = 64; c.setAttribute("aria-hidden", "true"); c.setAttribute("data-scene", sceneName);
    var k = c.getContext("2d");
    if (k) { k.imageSmoothingEnabled = false; k.drawImage(ART.backdrop(sceneName, d, c.width, c.height), 0, 0); }
    return c;
  }
  function note(msg: string, cls?: string) { return el("p", "gm-note " + (cls || ""), msg); }
  function focusFirst(within: HTMLElement) { var b = within.querySelector<HTMLElement>("button, a, input"); if (b) b.focus(); }

  /** a technique's short name: the command up to its first placeholder or flag */
  function techName(id: string) {
    var words = D.techniques[id].cmd.split(" "), out: string[] = [];
    for (var i = 0; i < words.length && out.length < 4; i++) {
      if (/^[-{]/.test(words[i]) || /^[A-Z]{3,}/.test(words[i])) break;
      out.push(words[i]);
    }
    return out.join(" ");
  }
  function talkMenu() {
    var wrap = el("div", "gm-col");
    wrap.appendChild(el("div", "gm-sub .hd", "").firstChild ? el("div") : el("p", "gm-note", "Who do you talk to?"));
    var menu = el("ul", "gm-menu");
    town!.npcs.forEach(function (n) {
      var li = el("li");
      var learnedIt = n.teaches && has("learned", n.teaches);
      var b = btn(esc(n.name) + (n.teaches ? '<span class="k">' + (learnedIt ? "taught ✓" : "teaches " + esc(techName(n.teaches))) + "</span>" : ""), function () { talkTo(n); }, n.teaches && !learnedIt ? "new" : "");
      li.appendChild(b); menu.appendChild(li);
    });
    wrap.appendChild(menu);
    return wrap;
  }
  function talkTo(n: CnpeGameNpc) {
    var wrap = el("div", "gm-col");
    var lines = el("div", "gm-lines");
    lines.appendChild(el("p", "gm-note", "<b>" + esc(n.name) + "</b> says:"));
    n.lines.forEach(function (l) { lines.appendChild(el("p", "", l)); });
    if (n.teaches) {
      var tq = D.techniques[n.teaches];
      var fresh = tick("learned", n.teaches);
      if (fresh) { addXp(5); save(); }
      lines.appendChild(el("div", "teach", (fresh ? "Learned: " : "You know this one: ") + esc(tq.cmd) + "<br>" + esc(tq.about)));
      live.textContent = n.name + (fresh ? " taught you " : " reminded you of ") + tq.cmd;
    }
    wrap.appendChild(lines);
    var acts = el("div", "gm-acts");
    acts.appendChild(btn("◀ Others", function () { paintTown(talkMenu(), "talk"); }, "ghost"));
    wrap.appendChild(acts);
    paintTown(wrap, "talk");
  }
  function shopMenu() {
    var wrap = el("div", "gm-col");
    wrap.appendChild(el("p", "gm-note", "The shopkeeper nods at your " + gold() + " gold."));
    var grid = el("div", "gm-items");
    Object.keys(D.items).forEach(function (id) {
      var it = D.items[id];
      if (!it.price) return;
      var owned = held(id);
      var b = btn('<span class="nm">' + esc(it.name) + '<span class="p">' + it.price + "g</span></span>" +
        '<span class="ab">' + esc(it.about) + "</span>" + (owned ? '<span class="nm"><span class="h">' + (it.permanent ? "owned" : "held: " + owned) + "</span></span>" : ""),
        function () {
          if (it.permanent && owned) { paintTown(shopMenu(), "shop"); return; }
          if (!spendGold(it.price)) { paintTown(wrapNote(shopMenu(), "Not enough gold. Trials and battles pay.", "warn"), "shop"); return; }
          giveItem(id, 1); save();
          paintTown(wrapNote(shopMenu(), "Bought " + it.name + ".", "ok"), "shop");
        }, "gm-item");
      if ((it.permanent && owned) || gold() < it.price) b.disabled = true;
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    return wrap;
  }
  function wrapNote(w: HTMLElement, msg: string, cls: string) { w.insertBefore(note(msg, cls), w.firstChild); return w; }

  /* ── the trial: the section's self-check cards, multiple choice ── */
  function deckFor(sec: string) { return (window.CNPE_DRILL || []).filter(function (q) { return q.sec === sec; }); }
  function optionText(html: string) {
    var t = text(html);
    return t.length > 170 ? t.slice(0, 168).replace(/\s+\S*$/, "") + "…" : t;
  }
  function startTrial() {
    var cards = shuffle(deckFor(town!.sec).slice());
    if (!cards.length) { paintTown(note("This town has no trial yet: its section has no self-check cards.", "warn")); return; }
    var dom = town!.sec.split(".")[0];
    var pool = (window.CNPE_DRILL || []).filter(function (q) { return q.sec.split(".")[0] === dom; });
    trial = { cards: cards, i: 0, right: 0, marks: [], pool: pool, revealed: false, opts: null, picked: -1 };
    setScene("trial");
    paintTrial();
  }
  function paintTrial() {
    var tr = trial!, q = tr.cards[tr.i];
    screen.innerHTML = "";
    screen.appendChild(el("div", "gm-title", "<h3>Trial of " + esc(town!.name) + '</h3><span class="sub">question ' + (tr.i + 1) + " of " + tr.cards.length + '</span><span class="right">' + tr.right + " right · pass at " + passMark(tr.cards.length) + "</span>"));
    var prog = el("div", "gm-prog");
    tr.cards.forEach(function (_, i) { prog.appendChild(el("i", i < tr.marks.length ? (tr.marks[i] ? "hit" : "miss") : i === tr.i ? "now" : "")); });
    screen.appendChild(prog);
    var body = el("div", "gm-body one"), col = el("div", "gm-col");
    col.appendChild(el("p", "gm-q", q.q));
    if (!tr.opts) {
      var others = shuffle(tr.pool.filter(function (o) { return o.id !== q.id && optionText(o.a) !== optionText(q.a); })).slice(0, 3);
      tr.opts = shuffle([{ q: q, ok: true }].concat(others.map(function (o) { return { q: o, ok: false }; })));
    }
    var opts = el("div", "gm-opts");
    tr.opts.forEach(function (o, i) {
      var b = btn('<span class="n">' + (i + 1) + "</span>" + esc(optionText(o.q.a)), function () { answerTrial(i); }, "gm-opt" + (tr.revealed ? (o.ok ? " right" : i === tr.picked ? " wrong" : "") : ""));
      if (tr.revealed) b.disabled = true;
      opts.appendChild(b);
    });
    col.appendChild(opts);
    var acts = el("div", "gm-acts");
    if (tr.revealed) {
      col.appendChild(el("div", "gm-a", q.a));
      acts.appendChild(btn(tr.i + 1 < tr.cards.length ? "Next ▶" : "Finish", function () { nextTrial(); }));
      acts.appendChild(el("span", "gm-note", "enter"));
    } else {
      acts.appendChild(el("span", "gm-note", "pick 1 to 4, or click"));
    }
    acts.appendChild(btn("Give up", function () { town && enterTown(town); }, "ghost"));
    col.appendChild(acts);
    body.appendChild(col); screen.appendChild(body);
    if (tr.revealed) { var nb = acts.querySelector<HTMLElement>("button"); if (nb) nb.focus(); }
    else focusFirst(opts);
  }
  function passMark(n: number) { return Math.ceil(n * 0.7) + "/" + n; }
  function answerTrial(i: number) {
    var tr = trial!;
    if (tr.revealed) return;
    var okAns = tr.opts![i].ok;
    tr.revealed = true; tr.picked = i; tr.marks.push(okAns);
    if (okAns) { tr.right++; addXp(XP_ANSWER); }
    recordDrill(tr.cards[tr.i], okAns);
    save();
    live.textContent = okAns ? "Right." : "Missed. The answer is shown.";
    paintTrial();
  }
  function nextTrial() {
    var tr = trial!;
    tr.i++; tr.revealed = false; tr.opts = null; tr.picked = -1;
    if (tr.i < tr.cards.length) { paintTrial(); return; }
    var need = Math.ceil(tr.cards.length * 0.7), passed = tr.right >= need;
    var msg: HTMLElement;
    if (passed) {
      var first = tick("towns", town!.sec);
      if (first) { addXp(XP_TRIAL); addGold(GOLD_TRIAL); }
      save();
      msg = note("Trial cleared: " + tr.right + " of " + tr.cards.length + ". " + (first ? "The dungeon door opens. +" + XP_TRIAL + " xp, +" + GOLD_TRIAL + " gold." : "Every answer went into your drill record."), "ok");
    } else {
      msg = note("Not this time: " + tr.right + " of " + tr.cards.length + ", and " + need + " clears it. The missed cards are due again in the drill; read the section and come back.", "bad");
    }
    trial = null;
    enterTown(town!);
    paintTown(msg);
  }

  /* ── the battle ─────────────────────────────────────────── */
  function startBattle(chain: string[], opts: BattleOpts) {
    if (hp < 1) hp = maxHp();
    battle = { chain: chain, idx: 0, sc: scenario(chain[0]), found: {}, turn: 0, log: [], mode: "menu", opts: opts,
      gained: 0, goldGained: 0, turnsTotal: 0, pick: null };
    setScene("battle");
    logSys("A " + (opts.boss ? "keep" : opts.final ? "gate" : "dungeon") + " battle begins: " + battle.sc.name + ". The ticket is above; the terminal is yours.");
    paintBattle();
  }
  function logSys(s: string) { battle!.log.push({ sys: s }); }
  function buildBattle(): BattleDom {
    var b = battle!;
    screen.innerHTML = "";
    var root = el("div", "gm-battle");
    var title = el("div", "gm-title"), h3 = el("h3"), sub = el("span", "sub"), turn = el("span", "right");
    title.appendChild(h3); title.appendChild(sub); title.appendChild(turn); root.appendChild(title);
    var body = el("div", "gm-body"), left = el("div", "gm-col"), right = el("div", "gm-col");

    var figure = el("div", "gm-enemy");
    var sprite = el("canvas") as HTMLCanvasElement; sprite.width = 96; sprite.height = 96; sprite.setAttribute("role", "img");
    figure.appendChild(sprite);
    var side = el("div", "side"), nm = el("div", "nm"), lv = el("div", "lv");
    var guardWrap = el("div", "gm-bar"), guard = el("i"); guardWrap.appendChild(guard);
    var guardLbl = el("div", "gm-barlbl", "<span>guard</span><span></span>");
    var hpWrap = el("div", "gm-bar hp"), hpBar = el("i"); hpWrap.appendChild(hpBar);
    var hpLbl = el("div", "gm-barlbl", "<span>you</span><span></span>");
    [nm, lv, guardWrap, guardLbl, hpWrap, hpLbl].forEach(function (e) { side.appendChild(e); });
    figure.appendChild(side);
    // the effect's class comes off when its animation ends; data-fx keeps the last one for the checks
    figure.addEventListener("animationend", function () { figure.classList.remove("fx-hit", "fx-stagger", "fx-win"); });
    left.appendChild(figure);
    var ticket = el("p", "gm-ticket"); left.appendChild(ticket);
    var bar = el("div", "gm-acts"), modes: Record<string, HTMLButtonElement> = {};
    var mode = function (m: BattleMode, label: string) {
      // opening or closing a menu abandons whatever a menu pick had seeded, so the
      // next command typed by hand is scored as typed
      modes[m] = btn(label, function () { b.mode = b.mode === m ? "menu" : m; b.fromMenu = false; b.pending = null; paintBattle(); });
      bar.appendChild(modes[m]);
    };
    mode("inspect", "Inspect"); mode("fix", "Fix"); mode("item", "Item");
    bar.appendChild(btn("Flee", function () { flee(); }, "ghost"));
    left.appendChild(bar);
    var subHost = el("div", "gm-subhost"); left.appendChild(subHost);

    var term = el("div", "gm-term");
    var tbar = el("div", "bar"), tool = el("span"), found = el("span", "turn");
    tbar.appendChild(tool); tbar.appendChild(el("span", "spacer")); tbar.appendChild(found); term.appendChild(tbar);
    var pre = el("pre");
    pre.setAttribute("tabindex", "0"); pre.setAttribute("aria-live", "polite"); pre.setAttribute("aria-label", "Terminal output");
    term.appendChild(pre);
    var form = el("form");
    form.appendChild(el("span", "ps", "$"));
    var input = el("input") as HTMLInputElement; input.type = "text"; input.autocomplete = "off"; input.spellcheck = false;
    input.setAttribute("aria-label", "Command"); input.placeholder = "type a command, or pick one from Inspect / Fix";
    form.appendChild(input);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var cmd = input.value.trim();
      if (!cmd) return;
      input.value = "";
      runCommand(cmd, !b.fromMenu);
      b.fromMenu = false;
    });
    term.appendChild(form);
    right.appendChild(term);
    body.appendChild(left); body.appendChild(right);
    root.appendChild(body);
    screen.appendChild(root);
    return { root: root, h3: h3, sub: sub, turn: turn, figure: figure, sprite: sprite, nm: nm, lv: lv,
      guard: guard, guardLbl: guardLbl.lastChild as HTMLElement, hpWrap: hpWrap, hpBar: hpBar, hpLbl: hpLbl.lastChild as HTMLElement,
      ticket: ticket, modes: modes, subHost: subHost, tool: tool, found: found, pre: pre, input: input, rendered: 0, scId: "", family: "" };
  }
  /** bring the battle screen up to date: only what changed is touched, and the
      terminal grows by the lines since the last paint, so a long log stays cheap */
  function paintBattle() {
    var b = battle!, sc = b.sc, mh = maxHp();
    if (!bt || bt.root.parentNode !== screen) bt = buildBattle();
    var t = bt;
    var nFound = Object.keys(b.found).length, nAll = sc.evidence.length;
    if (t.scId !== sc.id) {
      t.scId = sc.id; t.family = ART.familyOf(sc.id, sc.d);
      t.h3.textContent = sc.name;
      drawMonster(t.sprite, t.family);
      t.sprite.setAttribute("aria-label", "The monster " + sc.name + ", a " + t.family + " fault");
      t.sprite.setAttribute("data-family", t.family);
      t.nm.textContent = sc.name;
      t.lv.textContent = "difficulty " + stars(sc.difficulty) + " · domain " + sc.d;
      t.ticket.innerHTML = "<b>TICKET</b><br>" + esc(sc.ticket);
    }
    t.sub.textContent = b.opts.final ? "the Exam · fault " + (b.idx + 1) + " of " + b.chain.length : b.opts.boss ? b.opts.boss.name + " keep · " + (b.idx + 1) + " of " + b.chain.length : "dungeon of " + b.opts.town!.name;
    t.turn.textContent = "turn " + (b.turn + 1) + (b.opts.final ? " · short clock" : "");
    t.guard.style.width = Math.round((1 - nFound / nAll) * 100) + "%";
    t.guardLbl.textContent = (nAll - nFound) + " of " + nAll + " evidence hidden";
    t.hpWrap.className = "gm-bar hp" + (hp <= mh * 0.25 ? " crit" : hp <= mh * 0.5 ? " low" : "");
    t.hpBar.style.width = Math.round(hp / mh * 100) + "%";
    t.hpLbl.textContent = hp + " / " + mh + " hp";
    Object.keys(t.modes).forEach(function (m) { t.modes[m].className = b.mode === m ? "sel" : ""; });
    t.subHost.innerHTML = "";
    var sub = subMenu();
    if (sub) t.subHost.appendChild(sub);
    t.tool.textContent = SIM.toolOf(lastCmd() || "kubectl") || "terminal";
    t.found.textContent = "found " + nFound + "/" + nAll + " · " + b.gained + " xp this fight";
    if (b.log.length < t.rendered) { t.pre.innerHTML = ""; t.rendered = 0; }
    if (b.log.length > t.rendered) {
      t.pre.insertAdjacentHTML("beforeend", (t.rendered ? "\n" : "") + b.log.slice(t.rendered).map(renderLog).join("\n"));
      t.rendered = b.log.length;
      t.pre.scrollTop = t.pre.scrollHeight;
    }
    if (b.pending) { t.input.value = b.pending; b.pending = null; }
    if (fx) { play(t.figure, fx); fx = null; }
    if (b.mode === "menu" || b.mode === "typed") t.input.focus();
    else focusFirst(t.subHost);
  }
  /** an effect on the enemy's figure: the class runs the animation, data-fx records it */
  function play(e: HTMLElement, name: string) {
    e.classList.remove("fx-hit", "fx-stagger", "fx-win");
    void e.offsetWidth;                                // restart the animation if the same one is still up
    e.classList.add("fx-" + name);
    e.setAttribute("data-fx", name);
  }
  function lastCmd() { for (var i = battle!.log.length - 1; i >= 0; i--) if (battle!.log[i].cmd) return battle!.log[i].cmd; return ""; }
  function renderLog(e: LogEntry) {
    if (e.sys) return '<span class="sys">' + esc(e.sys) + "</span>";
    if (e.hit) return '<span class="hit">' + esc(e.hit) + "</span>";
    if (e.gain) return '<span class="' + (e.crit ? "crit" : "gain") + '">' + esc(e.gain) + "</span>";
    var out = esc(e.out || "");
    // The tell is cut out before the colouring and each run is coloured on its
    // own: a keyword the highlighter wraps inside the tell would otherwise split
    // it, and the mark would be silently dropped.
    var t = e.tell ? esc(e.tell) : "", at = t ? out.indexOf(t) : -1;
    var parts = at >= 0 ? [out.slice(0, at), t, out.slice(at + t.length)] : [out];
    var syn = window.CNPE_SYNTAX;
    if (syn) {
      var hl = syn;                                     // narrowed once, for the closure below
      try { parts = parts.map(function (p) { return hl.highlight(p, "bash"); }); } catch (er) {}
    }
    out = at >= 0 ? parts[0] + '<span class="tell">' + parts[1] + "</span>" + parts[2] : parts[0];
    return '<span class="in">' + esc(e.cmd!) + "</span>\n" + out;
  }
  /** techniques the player knows, inspect or fix */
  function known(fix: boolean) {
    return Object.keys(D.techniques).filter(function (id) { var t = D.techniques[id]; return !!t.fix === fix && has("learned", id); });
  }
  function subMenu() {
    var b = battle!;
    if (b.mode === "menu" || b.mode === "typed") return null;
    var wrap = el("div", "gm-sub"), menu = el("ul", "gm-menu");
    var add = function (label: string, fn: () => void, cls?: string) { var li = el("li"); li.appendChild(btn(label, fn, cls)); menu.appendChild(li); };
    if (b.mode === "inspect" || b.mode === "fix") {
      var list = known(b.mode === "fix");
      wrap.appendChild(el("div", "hd", b.mode === "fix" ? "repairs you have learned; a template lands in the prompt for you to finish" : "techniques you have learned; pick one, then its target"));
      if (!list.length) add("nothing learned yet: talk to the townsfolk, or type", function () { b.mode = "menu"; paintBattle(); });
      list.forEach(function (id) {
        var t = D.techniques[id];
        add(esc(t.cmd.replace(/\{ns\}/g, b.sc.ns)) + '<span class="d">' + esc(t.about) + "</span>", function () { pickTechnique(id); });
      });
    } else if (b.mode === "target") {
      wrap.appendChild(el("div", "hd", "which one?"));
      b.targets!.forEach(function (tg) { add(esc(tg.label), function () { finishPick(tg.value, tg.ns); }); });
      add("◀ back", function () { b.mode = "inspect"; paintBattle(); }, "ghost");
    } else if (b.mode === "item") {
      wrap.appendChild(el("div", "hd", "your pack"));
      var any = false;
      Object.keys(D.items).forEach(function (id) {
        var n = held(id); if (!n) return; any = true;
        add(esc(D.items[id].name) + '<span class="k">' + (D.items[id].permanent ? "permanent" : "x" + n) + "</span>", function () { useInBattle(id); });
      });
      if (!any) add("the pack is empty; the shop in any town sells scrolls, lenses and elixirs", function () { b.mode = "menu"; paintBattle(); });
    }
    wrap.appendChild(menu);
    return wrap;
  }
  function pickTechnique(id: string) {
    var b = battle!, t = D.techniques[id], cmd = t.cmd, sc = b.sc;
    b.pick = { id: id, cmd: cmd };
    var m = /\{(res|pod|kind|sa|app|name)\}/.exec(cmd);
    if (!m) { finishPick(null, null); return; }
    var what = m[1], targets: Target[] = [];
    var seen: Record<string, number> = {};
    sc.resources.forEach(function (r) {
      if (what === "pod" && r.kind !== "pods") return;
      if (what === "sa" && r.kind !== "serviceaccounts") return;
      if (what === "app" && r.kind !== "applications") return;
      if (what === "kind") { if (seen[r.kind]) return; seen[r.kind] = 1; targets.push({ label: r.kind + (r.ns ? " (" + r.ns + ")" : ""), value: r.kind, ns: r.ns }); return; }
      var value = what === "res" ? r.kind + " " + r.name : what === "sa" ? "system:serviceaccount:" + (r.ns || "default") + ":" + r.name : r.name;
      targets.push({ label: (what === "res" || what === "name" ? r.kind + "/" : "") + r.name + (r.ns ? "  (" + r.ns + ")" : ""), value: value, ns: r.ns });
    });
    if (!targets.length) { finishPick(null, null); return; }
    b.targets = targets; b.mode = "target"; paintBattle();
  }
  function finishPick(value: string | null, ns: string | null | undefined) {
    var b = battle!, cmd = b.pick!.cmd;
    if (value !== null) cmd = cmd.replace(/\{(res|pod|kind|sa|app|name)\}/, value);
    // a cluster-scoped target takes no namespace; anything else takes its own
    if (value !== null && ns === undefined && !/\{ns\}/.test(cmd) === false) cmd = cmd.replace(/ -n \{ns\}/, "");
    cmd = cmd.replace(/\{ns\}/g, ns || b.sc.ns);
    b.pick = null;
    var unfinished = /[A-Z]{3,}|=$|=\s|\{\}|\[\]|\{(res|pod|kind|sa|app|name|image|container)\}/.test(cmd);
    if (unfinished) { b.pending = cmd.replace(/\{(image|container)\}/g, "").trim(); b.fromMenu = true; b.mode = "typed"; logSys("Finish the command in the prompt, then press enter."); paintBattle(); return; }
    b.mode = "menu";
    runCommand(cmd, false);
  }
  function useInBattle(id: string) {
    var b = battle!, sc = b.sc, it = D.items[id];
    if (!it.permanent && !useItem(id)) return;
    var pending = sc.evidence.filter(function (e) { return !b.found[e.id]; });
    if (id === "scroll") {
      logSys(pending.length ? "The scroll reads: " + pending[0].hint : "The scroll reads: you have found everything there is to find. Fix it.");
    } else if (id === "lens") {
      if (pending.length) { b.found[pending[0].id] = 1; logSys("The lens shows a line you had not seen: " + (pending[0].tell || pending[0].hint) + " (evidence found, no xp for it)"); }
      else logSys("The lens shows nothing new.");
    } else if (id === "elixir") {
      hp = Math.min(maxHp(), hp + Math.ceil(maxHp() / 2)); logSys("The elixir burns going down. Health " + hp + " of " + maxHp() + ".");
    } else if (/^sheet-/.test(id)) {
      var fam = id.slice(6);
      var lines = Object.keys(D.techniques).filter(function (k) { return D.techniques[k].tool === fam; }).map(function (k) { return "  " + D.techniques[k].cmd.replace(/\{ns\}/g, sc.ns) + "   # " + D.techniques[k].about; });
      logSys("Cheat sheet, " + fam + ":\n" + (lines.join("\n") || "  (no techniques in this family yet)"));
    }
    save();
    b.mode = "menu"; paintBattle();
  }

  /** the turn: the command, the cluster's answer, then the enemy's swing */
  function runCommand(cmd: string, typed: boolean) {
    var b = battle!, sc = b.sc;
    if (b.over) return;                               // the card is up; the fight is finished
    var r = SIM.run(sc, b.found, cmd);
    b.turn++; b.turnsTotal++;
    var entry: LogEntry = { cmd: cmd, out: r.out, tell: null };
    if (r.evidence) {
      var ev = sc.evidence.filter(function (e) { return e.id === r.evidence; })[0];
      entry.tell = ev && ev.tell || null;
      b.found[r.evidence] = 1;
      var gain = Math.round(XP_EVIDENCE * (typed ? TYPED : 1));
      addXp(gain); b.gained += gain;
      b.log.push(entry);
      b.log.push({ gain: "Evidence found (" + Object.keys(b.found).length + "/" + sc.evidence.length + "): the enemy staggers. +" + gain + " xp" + (typed ? " (typed)" : "") + "." });
      fx = "stagger";
      save(); paintBattle();
      return;
    }
    b.log.push(entry);
    if (r.fixed) { winScenario(typed); return; }
    if (r.wrong) { b.log.push({ hit: "That was not it, and the fault bites back." }); enemyHit(2); }
    else enemyHit(1);
    save();
    if (battle && !battle.over) paintBattle();
  }
  function enemyHit(mult: number) {
    var b = battle!, sc = b.sc;
    var dmg = Math.ceil((1 + sc.difficulty) * mult * (b.opts.final ? 1.5 : 1)) + Math.floor(b.turn / 4);
    hp = Math.max(0, hp - dmg);
    fx = "hit";
    b.log.push({ hit: sc.name + " strikes for " + dmg + ". Health " + hp + " of " + maxHp() + "." });
    if (hp <= 0) defeat();
  }
  function winScenario(typed: boolean) {
    var b = battle!, sc = b.sc;
    var all = Object.keys(b.found).length >= sc.evidence.length;
    var base = (all ? XP_WIN : XP_WIN / 2) * sc.difficulty * (typed ? TYPED : 1);
    var gain = Math.round(base), goldGain = (all ? GOLD_WIN : GOLD_WIN / 2) * sc.difficulty;
    addXp(gain); addGold(goldGain); b.gained += gain; b.goldGained += goldGain;
    recordWin(sc.id, b.turn);
    b.log.push({ gain: (all ? "Critical hit! " : "You got lucky: the fix landed before the evidence did. ") + sc.name + " is down. +" + gain + " xp, +" + goldGain + " gold.", crit: all });
    b.results = b.results || [];
    b.results.push({ sc: sc, all: all, turns: b.turn });
    if (b.idx + 1 < b.chain.length) {
      b.idx++; b.sc = scenario(b.chain[b.idx]); b.found = {}; b.turn = 0; b.mode = "menu";
      logSys("The truth: " + sc.answer);
      logSys("From the dark, another rises: " + b.sc.name + ". A new ticket.");
      fx = "win";
      save(); paintBattle();
      return;
    }
    var extraXp = 0, extraGold = 0, flag: string | null = null;
    if (b.opts.boss) { flag = "boss-" + b.opts.boss.d; extraXp = XP_BOSS; extraGold = GOLD_BOSS; }
    if (b.opts.final) { flag = "final"; extraXp = XP_FINAL; extraGold = GOLD_FINAL; }
    if (flag && tick("flags", flag)) { addXp(extraXp); addGold(extraGold); b.gained += extraXp; b.goldGained += extraGold; }
    b.over = true;
    save();
    resultCard(true);
  }
  function defeat() {
    var b = battle!;
    b.over = true;
    b.log.push({ hit: "You black out." });
    save();
    resultCard(false);
  }
  function flee() {
    var b = battle!;
    say("", []); dlg = null;
    logSys("You back away up the stairs. The evidence you found stays found in your head, and the xp for it stays yours.");
    save();
    battle = null;
    if (b.opts.town) { enterTown(b.opts.town); paintTown(note("You fled " + b.sc.name + ". +" + b.gained + " xp kept.", "warn")); }
    else leaveToMap();
  }
  function resultCard(won: boolean) {
    var b = battle!;
    screen.innerHTML = "";
    var card = el("div", "gm-result");
    var crit = won && (b.results || []).every(function (r) { return r.all; });
    card.appendChild(el("h4", won ? (crit ? "crit" : "win") : "lose", won ? (b.opts.final ? "You passed the Exam" : b.opts.boss ? "The keep falls" : crit ? "Critical hit" : "Victory") : "Defeat"));
    card.appendChild(el("p", "gain", (won ? "<b>+" + b.gained + " xp</b> · <b>+" + b.goldGained + " gold</b> · " + b.turnsTotal + (b.turnsTotal === 1 ? " turn" : " turns") : "<b>+" + b.gained + " xp</b> kept for the evidence you found · health restored to half") +
      " · level " + level() + " " + title(level())));
    (b.results || []).forEach(function (r) { card.appendChild(el("div", "ans", "<b>" + esc(r.sc.name) + "</b> was: " + esc(r.sc.answer))); });
    if (!won) card.appendChild(el("div", "ans", "The fault stands. Its ticket said: " + esc(b.sc.ticket) + (Object.keys(b.found).length ? " You had found: " + b.sc.evidence.filter(function (e) { return b.found[e.id]; }).map(function (e) { return e.id; }).join(", ") + "." : "")));
    var acts = el("div", "gm-acts"); acts.style.justifyContent = "center"; acts.style.marginTop = "14px";
    const back = b.opts.town;
    acts.appendChild(btn(back ? "Back to " + back.name : "Back to the map", function () {
      if (!won) hp = Math.ceil(maxHp() / 2);
      battle = null;
      if (back) enterTown(back); else leaveToMap();
    }));
    if (won && back) acts.appendChild(btn("Fight again", function () { battle = null; startBattle([back.dungeon], { town: back }); }, "ghost"));
    card.appendChild(acts);
    screen.appendChild(card);
    focusFirst(acts);
    live.textContent = won ? "Victory. " + b.gained + " xp gained." : "Defeat.";
  }

  /* ── input ──────────────────────────────────────────────── */
  function keys() {
    if (keysWired) return;
    keysWired = true;
    // Capture phase, like the drill: inside the game the keys are the game's,
    // and app.js's page shortcuts (d for dashboard, g for the drill) must not fire.
    document.addEventListener("keydown", function (e) {
      if (!host || !document.body.contains(host) || !host.contains(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var target = e.target as HTMLElement;
      var typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      var handled = true;
      if (e.key === "Escape") {
        if (scene === "map") { if (dlg) closeDialog(); else handled = false; }
        else if (scene === "battle") { if (battle && battle.mode !== "menu" && battle.mode !== "typed") { battle.mode = "menu"; battle.fromMenu = false; battle.pending = null; paintBattle(); } else handled = false; }
        else if (scene === "trial") handled = false;
        else if (scene === "town") leaveToMap();
        else handled = false;
      } else if (typing) {
        handled = false;                              // the terminal's own keys
      } else if (scene === "map") {
        switch (e.key) {
          case "ArrowUp": case "w": case "W": case "k": move(0, -1); break;
          case "ArrowDown": case "s": case "S": case "j": move(0, 1); break;
          case "ArrowLeft": case "a": case "A": case "h": move(-1, 0); break;
          case "ArrowRight": case "d": case "D": case "l": move(1, 0); break;
          case "Enter": case " ": case "z": case "Z": act(); break;
          default: handled = /^[a-z]$/i.test(e.key);  // swallow the page shortcuts while the map has focus
        }
      } else if (scene === "trial" && trial) {
        if (!trial.revealed && /^[1-4]$/.test(e.key) && trial.opts![+e.key - 1]) answerTrial(+e.key - 1);
        else if (trial.revealed && e.key === "Enter") nextTrial();
        else handled = menuNav(e) || /^[a-z]$/i.test(e.key);
      } else handled = menuNav(e) || /^[a-z]$/i.test(e.key);   // a letter in any scene is not a page shortcut
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }
  /** arrows walk a menu's buttons, so the keyboard plays it like a controller */
  function menuNav(e: KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    var items = Array.prototype.slice.call(screen.querySelectorAll("button:not(:disabled), a[href]")) as HTMLElement[];
    var i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) { if (items[0]) items[0].focus(); return true; }
    var n = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    if (n) n.focus();
    return true;
  }

  /* ── mount ──────────────────────────────────────────────── */
  function build() {
    host.innerHTML = "";
    host.classList.add("gm");
    stage = el("div", "gm-stage gm-map");
    stage.tabIndex = 0;
    stage.setAttribute("aria-label", "CNPE Quest. Click or tab here, then walk with the arrow keys or WASD; enter acts.");
    canvas = el("canvas") as HTMLCanvasElement;
    canvas.width = W * scale; canvas.height = H * scale;   // fitCanvas() picks the scale once the stage has a width
    canvas.setAttribute("role", "img");
    ctx = canvas.getContext("2d") as CanvasRenderingContext2D;   // draw() still checks for a null one
    stage.appendChild(canvas);
    hud = el("div", "gm-win gm-hud"); stage.appendChild(hud);
    whereEl = el("div", "gm-win gm-where"); stage.appendChild(whereEl);
    dialog = el("div", "gm-win gm-dialog"); dialog.hidden = true; dialog.setAttribute("role", "dialog"); stage.appendChild(dialog);
    screen = el("div", "gm-screen"); screen.hidden = true; stage.appendChild(screen);
    live = el("div"); live.className = "sr-only"; live.setAttribute("aria-live", "polite");
    live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
    stage.appendChild(live);
    host.appendChild(stage);
    stage.addEventListener("focus", function () { stage.classList.add("gm-focus"); });
    stage.addEventListener("blur", function () { stage.classList.remove("gm-focus"); });
    // a click on the map is a step toward where you clicked, and takes focus
    canvas.addEventListener("click", function (e) {
      stage.focus();
      if (scene !== "map" || dlg) return;
      var r = canvas.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width * VW, py = (e.clientY - r.top) / r.height * VH;
      var cam = camera();
      var dx = Math.floor(px) + cam.x - player.x, dy = Math.floor(py) + cam.y - player.y;
      if (dx === 0 && dy === 0) { act(); return; }
      if (Math.abs(dx) >= Math.abs(dy)) move(dx > 0 ? 1 : -1, 0); else move(0, dy > 0 ? 1 : -1);
    });

    var pad = el("div", "gm-pad");
    var dpad = el("div", "gm-dpad");
    var padBtn = function (cls: string, label: string, dx: number, dy: number) {
      var b = btn(label, function () { stage.focus(); move(dx, dy); }, cls);
      b.setAttribute("aria-label", "walk " + (dy < 0 ? "up" : dy > 0 ? "down" : dx < 0 ? "left" : "right"));
      dpad.appendChild(b);
    };
    padBtn("u", "▲", 0, -1); padBtn("l", "◀", -1, 0); padBtn("r", "▶", 1, 0); padBtn("dn", "▼", 0, 1);
    pad.appendChild(dpad);
    pad.appendChild(el("div", "gm-keys", "arrows / WASD walk · enter acts · esc leaves · 1-4 answer a trial"));
    var ab = el("div", "gm-ab");
    ab.appendChild(btn("B<b>back</b>", function () { if (scene === "map") { if (dlg) closeDialog(); } else if (scene === "battle" && battle) { if (battle.mode !== "menu") { battle.mode = "menu"; paintBattle(); } } else if (scene === "town") leaveToMap(); }));
    ab.appendChild(btn("A<b>act</b>", function () { if (scene === "map") { stage.focus(); act(); } else { var f = screen.querySelector<HTMLElement>("button:focus, a:focus") || screen.querySelector<HTMLElement>(".gm-menu button, .gm-opt, .gm-acts button"); if (f) f.click(); } }));
    pad.appendChild(ab);
    host.appendChild(pad);

    readPalette();
    fitCanvas();
    if (window.CNPE_THEME && !themeWired) {
      themeWired = true;
      window.CNPE_THEME.onChange(function () {
        readPalette(); requestDraw();
        // a live battle repaints so the monster takes the new palette; a finished
        // one keeps its result card; the terminal and its half-typed command stay
        if (scene === "battle" && battle && !battle.over) { if (bt) bt.scId = ""; paintBattle(); }
        if (scene === "town" && town && tn) paintTown(tn.right.children.length > 1 ? tn.right.children[1] as HTMLElement : null);
      });
    }
    // fonts arrive after first paint, and the town labels are text
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestDraw(); });
    // the screen: a resize or a zoom changes how many device pixels an art pixel gets
    window.addEventListener("resize", fitCanvas);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(function () { fitCanvas(); }).observe(stage);
    document.addEventListener("visibilitychange", syncAnim);
    if (motionQuery) {
      var onMotion = function () { reduceMotion = !!(motionQuery && motionQuery.matches); walkFrame = 0; syncAnim(); requestDraw(); };
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotion);
      else if (motionQuery.addListener) motionQuery.addListener(onMotion);
    }
  }
  function intro() {
    if (has("flags", "intro")) return;
    say("A note pinned to the signpost", [
      "Five regions, one per exam domain, and a town for every section. All roads are open; the dungeons are not.",
      "In a town, talk to people: they teach the theory and hand you commands. Pass the town's trial and its dungeon opens. Inside is a fault, and you fight it with real commands.",
      "You start with <code>kubectl get</code>, <code>describe</code>, <code>events</code> and <code>logs</code>, and two hint scrolls. The rest you learn in the towns. Walk with the arrows or WASD; enter acts."]);
    // The starter kit is written when the note is put down, which is the first
    // action: opening the page writes nothing, as reading the console never has.
    dlg!.done = function () {
      if (!tick("flags", "intro")) return;
      STARTER_TECH.forEach(function (id) { tick("learned", id); });
      Object.keys(STARTER_ITEMS).forEach(function (id) { giveItem(id, STARTER_ITEMS[id]); });
      save();
    };
  }

  window.CNPE_GAME = {
    mount: function () {
      var mountEl = document.getElementById("game-app");
      if (!mountEl) return;
      if (mountEl.getAttribute("data-built")) { paintTiles(); return; }   // another tab moved the store: repaint the tiles
      mountEl.setAttribute("data-built", "1");
      host = mountEl;
      if (!D || !SIM || !ART || !window.CNPE_PROGRESS || !D.map.length) {
        host.innerHTML = '<div class="wnote bad">The quest did not load; assets/game-data.js, assets/game-sim.js or assets/game-art.js is missing.</div>';
        return;
      }
      scene = "map"; town = null; trial = null; battle = null; dlg = null; bt = null; tn = null;
      buildRegions();
      build();
      hp = maxHp();
      loadPos();
      keys();
      paintTiles(); paintHud();
      setScene("map");
      frame();                                        // the first frame now, not on the next tick: the page opens painted
      intro();
    },
    /** what the renderer is doing, for the browser checks and profiling */
    debug: function (): CnpeGameDebug {
      return { frames: stats.frames, drawMs: stats.drawMs, terrainRenders: stats.terrainRenders, terrainMs: stats.terrainMs,
        terrain: terrain ? { w: terrain.width, h: terrain.height } : null, scale: scale, dpr: dprSeen,
        anim: !!animTimer, reduceMotion: reduceMotion, waterFrame: waterFrame, walkFrame: walkFrame, face: player.face,
        frame: function () { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } dirty = true; draw(); } };
    }
  };
  window.CNPE_GAME.mount();
})();
