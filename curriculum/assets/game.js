"use strict";
/* CNPE Quest: the engine. An overworld on a canvas, and every scene over it as
   DOM: the town menu, the trial, the battle terminal, the shop.

   Theory first, commands second. A town's people teach the section and hand out
   techniques; its trial is the section's self-check cards; the dungeon behind it
   holds a fault, and the fight is real commands against game-sim.js's cluster.

   Progress lives in store.game, in the shapes merge.js merges (see cnpe.d.ts):
   counters per browser slot, ticks as unions, the position stamped. Trial
   answers go into store.drill exactly as drill.js writes them, so the drill and
   the quest share one memory and one heartbeat.

   mount() builds into #game-app and unmount() takes everything down again: the
   bundle's router calls the pair around every visit to the #GM route, so what a
   visit wires (the animation frame, the beat, the listeners, the observers, the
   terrain cache) is gone before the page is replaced. */
(function () {
    "use strict";
    var M = window.CNPE_MERGE; // the guard below is the real check
    if (!M || !M.countOf || !M.dayKey)
        return; // a cached older merge.js: the page stays static
    // mount() checks both before anything runs; the casts spare every reader a guard
    var D = window.CNPE_GAME_DATA, SIM = window.CNPE_SIM, ART = window.CNPE_ART;
    var TILE = 16, VW = 30, VH = 19; // the viewport, in tiles
    var W = VW * TILE, H = VH * TILE; // logical pixels; the backing scale is chosen for the screen in fitCanvas()
    var GOAL = 10; // the drill's daily goal, mirrored so a trial can earn it
    var XP_ANSWER = 5, XP_TRIAL = 50, XP_EVIDENCE = 10, XP_WIN = 100, XP_BOSS = 300, XP_FINAL = 1000;
    var GOLD_TRIAL = 20, GOLD_WIN = 30, GOLD_BOSS = 100, GOLD_FINAL = 500;
    var TYPED = 1.2; // typing beats picking from the menu
    var TITLES = ["novice", "apprentice", "operator", "engineer", "senior", "staff", "principal", "architect", "distinguished", "legend"];
    var STARTER_TECH = ["k-get", "k-describe", "k-events", "k-logs"];
    var STARTER_ITEMS = { scroll: 2 };
    var WALK = { grass: 1, road: 1, sand: 1, bridge: 1, town: 1, door: 1, keep: 1, gate: 1, flower: 1 };
    /* ── the store ──────────────────────────────────────────── */
    function api() { return window.CNPE_PROGRESS; } // mount() checks it is loaded
    function store() { return api().get(); }
    function save() { api().save(); paintTiles(); }
    function slot() { return api().slot ? api().slot() : ""; }
    function g() {
        var s = store();
        if (!s.game || typeof s.game !== "object" || Array.isArray(s.game))
            s.game = {};
        return s.game;
    }
    // any on purpose: it reads junk-tolerant store fields, and its callers keep it local
    function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
    /** a slot-map counter, bumped for this browser */
    function bump(owner, key, n) {
        var m = obj(owner[key]);
        if (!m) {
            // a plain number is a count from before the slots; it stays unnamed
            var was = typeof owner[key] === "number" && owner[key] > 0 ? owner[key] : 0;
            m = owner[key] = {};
            if (was)
                m[""] = was;
        }
        var id = slot();
        m[id] = (+m[id] || 0) + n;
    }
    function xp() { return M.countOf(g().xp); }
    function gold() { var gd = obj(g().gold) || {}; return Math.max(0, M.countOf(gd.e) - M.countOf(gd.s)); }
    function held(id) { var it = obj(g().items), rec = it && obj(it[id]); return rec ? Math.max(0, M.countOf(rec.g) - M.countOf(rec.u)) : 0; }
    function addXp(n) { if (n > 0)
        bump(g(), "xp", Math.round(n)); }
    function addGold(n) { var gd = obj(g().gold) || (g().gold = {}); if (n > 0)
        bump(gd, "e", Math.round(n)); }
    function spendGold(n) { if (n > gold())
        return false; var gd = obj(g().gold) || (g().gold = {}); bump(gd, "s", n); return true; }
    function giveItem(id, n) { var it = obj(g().items) || (g().items = {}); var rec = obj(it[id]) || (it[id] = {}); bump(rec, "g", n); }
    function useItem(id) { if (held(id) < 1)
        return false; var rec = obj(g().items[id]); bump(rec, "u", 1); return true; }
    function tick(b, k) { var m = obj(g()[b]) || (g()[b] = {}); if (m[k])
        return false; m[k] = 1; return true; }
    function has(b, k) { var m = obj(g()[b]); return !!(m && m[k]); }
    function wins(id) { var w = obj(g().wins), r = w && obj(w[id]); return r ? (+r.n || 0) : 0; }
    function recordWin(id, turns) {
        var w = obj(g().wins) || (g().wins = {});
        var r = obj(w[id]) || (w[id] = { n: 0 });
        r.n = (+r.n || 0) + 1;
        if (!(+r.best > 0) || turns < +r.best)
            r.best = turns;
        r.t = Date.now();
    }
    function level() {
        var x = xp(), lv = 1;
        for (var i = 1; i < D.levels.length; i++)
            if (x >= D.levels[i])
                lv = i + 1;
        return lv;
    }
    function title(lv) { return TITLES[Math.min(TITLES.length - 1, Math.floor((lv - 1) / 3))]; }
    function maxHp() { return 20 + level() * 4; }
    function totalBattles() { return D.scenarios.length + D.regions.length + 1; }
    function battlesWon() {
        var n = D.scenarios.filter(function (s) { return wins(s.id) > 0; }).length;
        D.regions.forEach(function (r) { if (has("flags", "boss-" + r.d))
            n++; });
        if (has("flags", "final"))
            n++;
        return n;
    }
    function paintTiles() {
        var set = function (id, html) { var e = document.getElementById(id); if (e)
            e.innerHTML = html; };
        var lv = level(), next = D.levels[lv];
        set("gm-level", lv + '<span class="u">' + title(lv) + "</span>");
        set("gm-xp", xp() + '<span class="u">' + (next != null ? "next at " + next : "max") + "</span>");
        set("gm-gold", gold() + '<span class="u">held</span>');
        set("gm-wins", battlesWon() + '<span class="u">of ' + totalBattles() + "</span>");
    }
    /* ── the drill's record, written the way drill.js writes it ─── */
    function recordDrill(q, okAns) {
        var s = store();
        if (!s.drill || typeof s.drill !== "object")
            s.drill = {};
        var rec = s.drill[q.id] || { r: 0, m: 0 };
        if (okAns)
            rec.r++;
        else
            rec.m++;
        rec.ok = okAns;
        rec.t = Date.now();
        s.drill[q.id] = rec;
        if (api().bump)
            api().bump("c"); // the day's heartbeat
        if (!s.drillmeta || typeof s.drillmeta !== "object")
            s.drillmeta = {};
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
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls)
            e.className = cls;
        if (html != null)
            e.innerHTML = html;
        return e;
    }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    function text(html) { var t = el("div", "", html); return (t.textContent || "").replace(/\s+/g, " ").trim(); }
    function btn(label, fn, cls) {
        var b = el("button", cls || "", label);
        b.type = "button";
        b.addEventListener("click", function (e) { e.preventDefault(); fn(); });
        return b;
    }
    function navOf(sec) { return (window.CNPE_NAV || []).filter(function (n) { return n.id === sec; })[0]; }
    function pageHref(path, id) { return window.CNPE_BUNDLE ? "#" + id : path; }
    function domainOf(d) { return (window.CNPE_DOMAINS || []).filter(function (x) { return x.n === d; })[0]; }
    function scenario(id) { return D.scenarios.filter(function (s) { return s.id === id; })[0]; }
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i];
        a[i] = a[j];
        a[j] = t;
    } return a; }
    // a deterministic hash for tile texture and monster shapes
    function hash(x, y) { var h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
    /* ── the palette, read live so the theme switch repaints ───── */
    var P = {}; // filled by readPalette() before the first draw
    function readPalette() {
        var cs = getComputedStyle(document.documentElement);
        var v = function (n) { return cs.getPropertyValue(n).trim() || "#888"; };
        P = { ink: v("--ink"), sunk: v("--ink-sunk"), s1: v("--surface"), s2: v("--surface-2"), s3: v("--surface-3"),
            rule: v("--rule"), rule2: v("--rule-2"), paper: v("--paper"), paper2: v("--paper-2"), paper3: v("--paper-3"),
            accent: v("--accent"), accentDim: v("--accent-dim"), accentLit: v("--accent-lit"), warn: v("--warn"), warnDim: v("--warn-dim"),
            ok: v("--ok"), okLit: v("--ok-lit"), bad: v("--bad"), badLit: v("--bad-lit"), viol: v("--viol"), info: v("--info") };
        ART.theme(P); // every sprite is repainted from these on its next use
        terrainStale = true; // and the whole terrain with them, on the next frame
    }
    /* ── state ──────────────────────────────────────────────── */
    let host;
    let stage;
    let canvas;
    let ctx;
    let hud, whereEl, miniWin, dialog, screen, live;
    var player = { x: 0, y: 0, face: "d" };
    var scene = "map"; // map | town | trial | battle | shop
    var town = null;
    var trial = null;
    var battle = null;
    var hp = 0; // the session's hearts; a page load heals
    var dlg = null; // { who, pages: [], i, done: fn }
    var posTimer = 0, themeWired = false, dirty = true;
    var bt = null; // the battle screen, while one is built
    var tn = null; // the town screen, while one is built
    /** the effect the next battle paint plays (hit, stagger, win), and the number that floats up with it */
    var fx = null;
    var walked = false; // a step was taken: only then is the position worth a save
    /** listeners, observers and timers the mount holds, undone in order by unmount() */
    var undo = [];
    var timers = []; // one-shot timers (a floating number's fallback, a result card's delay)
    var mounts = 0;
    function listen(t, type, fn, capture) {
        t.addEventListener(type, fn, !!capture);
        undo.push(function () { t.removeEventListener(type, fn, !!capture); });
    }
    function later(fn, ms) {
        var id = window.setTimeout(function () { var i = timers.indexOf(id); if (i >= 0)
            timers.splice(i, 1); fn(); }, ms);
        timers.push(id);
        return id;
    }
    /* ── the overworld ──────────────────────────────────────── */
    function tileAt(x, y) {
        var row = D.map[y];
        if (!row)
            return "void";
        var ch = row[x];
        return ch ? (D.tiles[ch] || "void") : "void";
    }
    function walkable(x, y) { return !!WALK[tileAt(x, y)]; }
    function townAt(x, y) { return D.towns.filter(function (t) { return t.x === x && t.y === y; })[0] || null; }
    function doorAt(x, y) { return D.towns.filter(function (t) { return t.door.x === x && t.door.y === y; })[0] || null; }
    function keepAt(x, y) { return D.regions.filter(function (r) { return r.keep.x === x && r.keep.y === y; })[0] || null; }
    function gateAt(x, y) { return D.finale.keep.x === x && D.finale.keep.y === y; }
    /** the region a tile falls in: the nearest town's, which is what a road sign would say */
    function regionAt(x, y) {
        var best = null, bd = 1e9;
        D.towns.forEach(function (t) { var d = Math.abs(t.x - x) + Math.abs(t.y - y); if (d < bd) {
            bd = d;
            best = t;
        } });
        return best ? { region: D.regions.filter(function (r) { return r.d === +best.sec.split(".")[0]; })[0], town: best, dist: bd } : null;
    }
    function dungeonOpen(t) { return has("towns", t.sec); }
    function keepOpen(r) { return D.scenarios.filter(function (s) { return s.d === r.d; }).every(function (s) { return wins(s.id) > 0; }); }
    function gateOpen() { return D.regions.every(function (r) { return has("flags", "boss-" + r.d); }); }
    function loadPos() {
        var p = obj(g().pos);
        if (p && walkable(+p.x, +p.y)) {
            player.x = +p.x;
            player.y = +p.y;
        }
        else {
            player.x = D.start.x;
            player.y = D.start.y;
        }
    }
    function savePos(now) {
        if (posTimer) {
            clearTimeout(posTimer);
            posTimer = 0;
        }
        if (!walked)
            return; // opening the page is not an action
        var write = function () {
            var p = obj(g().pos);
            if (p && p.x === player.x && p.y === player.y)
                return;
            g().pos = { x: player.x, y: player.y, t: Date.now() };
            save();
        };
        if (now)
            write();
        else
            posTimer = setTimeout(write, 1500);
    }
    // A step is a short tween: the player's tile changes at once (it is what the
    // store, the checks and arrive() read), and the sprite and the camera slide
    // over from the tile before it across STEP_MS, in STEP_SUBS whole-pixel
    // sub-positions, on the animation frame. A step asked for while one is in
    // flight waits for it and starts the moment it lands, so a held key walks
    // tile by tile and never skips one. Under reduced motion the step is instant.
    var STEP_MS = 120, STEP_SUBS = 5;
    var walk = null; // the step in flight: from (fx, fy) to the player's tile
    var queued = null; // the step waiting behind it
    function move(dx, dy) {
        if (scene !== "map")
            return;
        if (dlg) {
            advanceDialog();
            return;
        }
        if (walk) {
            queued = { dx: dx, dy: dy };
            return;
        }
        player.face = dx < 0 ? "l" : dx > 0 ? "r" : dy < 0 ? "u" : "d";
        var nx = player.x + dx, ny = player.y + dy;
        // A blocked step turns you and nothing more: arriving is for a tile you
        // reached, or leaving a town with a step into the sea would put you back in it.
        if (!walkable(nx, ny)) {
            requestDraw();
            return;
        }
        var fx0 = player.x, fy0 = player.y;
        player.x = nx;
        player.y = ny;
        walked = true;
        savePos(false);
        if (reduceMotion) {
            requestDraw();
            arrive();
            return;
        }
        walk = { fx: fx0, fy: fy0, t0: performance.now() };
        requestDraw();
    }
    /** how far the step in flight has come, in whole sub-positions: 0 at the tile it left, 1 on the tile it ends on */
    function stepProgress(now) {
        if (!walk)
            return 1;
        var p = (now - walk.t0) / STEP_MS;
        return p >= 1 ? 1 : Math.floor(p * STEP_SUBS) / STEP_SUBS;
    }
    /** the sprite's pixel offset from the tile the step ends on */
    function stepOffset(p) {
        if (!walk || p >= 1)
            return { x: 0, y: 0 };
        return { x: Math.round((walk.fx - player.x) * (1 - p) * TILE), y: Math.round((walk.fy - player.y) * (1 - p) * TILE) };
    }
    /** the step landed: what the tile means happens now, then the step waiting behind it */
    function landStep() {
        walk = null;
        arrive();
        var q = queued;
        queued = null;
        if (q && scene === "map" && !dlg)
            move(q.dx, q.dy);
    }
    /** a scene change or an unmount ends a step where it was going, with no tween left to land */
    function settleStep() { walk = null; queued = null; }
    // What standing on a tile means. Walking onto a town enters it; the doors and
    // the keeps ask first, because a battle is a commitment.
    function arrive() {
        var t = townAt(player.x, player.y);
        if (t) {
            enterTown(t);
            return;
        }
        var d = doorAt(player.x, player.y);
        if (d) {
            if (!dungeonOpen(d)) {
                say(d.name, ["The door is sealed. A voice from the stone: <em>pass the trial in " + d.name + " first, and the way opens.</em>"]);
                return;
            }
            var sc = scenario(d.dungeon);
            say("Dungeon of " + d.name, ["Something stirs below: <b>" + esc(sc.name) + "</b>" + (wins(sc.id) ? " (beaten " + wins(sc.id) + (wins(sc.id) === 1 ? " time" : " times") + ")" : "") + ". Difficulty " + stars(sc.difficulty) + ". Go down and fight it?"], function () { startBattle([sc.id], { town: d }); }, true);
            return;
        }
        var k = keepAt(player.x, player.y);
        if (k) {
            if (!keepOpen(k)) {
                say(k.name + " keep", ["The keep's gate holds. Clear every dungeon in " + k.name + " and it opens: " + D.scenarios.filter(function (s) { return s.d === k.d && !wins(s.id); }).map(function (s) { return s.name; }).join(", ") + " still stand."]);
                return;
            }
            say(k.name + " keep", ["Two faults wait inside, one after the other: <b>" + k.boss.map(function (id) { return esc(scenario(id).name); }).join("</b> and <b>") + "</b>." + (has("flags", "boss-" + k.d) ? " You have beaten them before." : "") + " Enter the keep?"], function () { startBattle(k.boss.slice(), { boss: k }); }, true);
            return;
        }
        if (gateAt(player.x, player.y)) {
            if (!gateOpen()) {
                say("The Exam", ["The gate is shut. Five keeps guard it; " + D.regions.filter(function (r) { return !has("flags", "boss-" + r.d); }).map(function (r) { return r.name; }).join(", ") + " still hold."]);
                return;
            }
            say("The Exam", ["Beyond the gate, three faults drawn at random, on a shorter clock. Everything you learned, all at once." + (has("flags", "final") ? " You have passed before." : "") + " Sit the exam?"], function () { startBattle(shuffle(D.finale.pool.slice()).slice(0, D.finale.pick), { final: true }); }, true);
        }
    }
    function act() {
        if (scene !== "map")
            return;
        if (dlg) {
            advanceDialog();
            return;
        }
        if (walk)
            return; // the step lands first, and landing is what acts
        arrive();
        if (!dlg && scene === "map") {
            var here = regionAt(player.x, player.y);
            if (here)
                say("You look around", ["<b>" + esc(here.region.name) + "</b>. " + (here.dist ? esc(here.town.name) + " is " + here.dist + " steps away." : "")]);
        }
    }
    function stars(n) { var s = ""; for (var i = 0; i < 3; i++)
        s += i < n ? "▲" : "▽"; return s.replace(/▽/g, "·"); }
    /* the dialogue window: one speaker, pages of text, an optional yes/no */
    function say(who, pages, yes, ask) {
        dlg = { who: who, pages: pages, i: 0, yes: yes || null, ask: !!ask };
        paintDialog();
    }
    function paintDialog() {
        if (!dlg) {
            dialog.hidden = true;
            return;
        }
        dialog.hidden = false;
        var last = dlg.i >= dlg.pages.length - 1;
        dialog.innerHTML = '<div class="who">' + esc(dlg.who) + '</div><div class="txt">' + dlg.pages[dlg.i] + "</div>";
        var more = el("div", "more");
        if (last && dlg.ask) {
            more.appendChild(btn("No, not yet", function () { closeDialog(); }, "gm-btn ghost"));
            more.appendChild(btn("Yes", function () { var fn = dlg.yes; closeDialog(); if (fn)
                fn(); }, "gm-btn"));
        }
        else {
            more.appendChild(btn(last ? "Close" : "Next ▶", function () { advanceDialog(); }, "gm-btn ghost"));
        }
        dialog.appendChild(more);
        live.textContent = dlg.who + ": " + text(dlg.pages[dlg.i]);
        var b = dialog.querySelector("button");
        if (b)
            b.focus();
    }
    function advanceDialog() {
        if (!dlg)
            return;
        if (dlg.i < dlg.pages.length - 1) {
            dlg.i++;
            paintDialog();
            return;
        }
        if (dlg.ask)
            return; // the question waits for its buttons
        closeDialog();
    }
    function closeDialog() {
        var done = dlg && dlg.done;
        dlg = null;
        dialog.hidden = true;
        if (scene === "map")
            stage.focus();
        if (done)
            done();
    }
    /* ── drawing ────────────────────────────────────────────── */
    // The overworld is three layers. The terrain, every tile of the whole map, is
    // painted once into an offscreen canvas, painted again in full only when the
    // palette changes, and patched tile by tile when a door, a keep or the gate
    // changes state. A frame blits the viewport out of it at the camera's pixel
    // position, then draws what moves: the water's and the flowers' frame, the
    // smoke over the towns, the torches on the open doors, the banners, the
    // player. The minimap is a third canvas, built from the terrain when it is
    // painted and touched only where the player's dot moves. Frames are requested
    // and painted on the next animation frame, so a held key coalesces and a
    // still map costs nothing.
    var terrain = null, terrainSig = "", terrainStale = true;
    var mapW = 0, mapH = 0;
    var regionOf = new Uint8Array(0); // the domain each tile belongs to; 0 on the open sea
    var scale = 2, dprSeen = 1; // whole device pixels per art pixel, chosen for the screen
    var rafId = 0, animTimer = 0, animFrame = 0, walkFrame = 0, waterInView = 1, ambientInView = 0;
    var ANIM_MS = 420; // the beat: the water, the flowers, the smoke, the torches, the minimap's dot
    var motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    var reduceMotion = !!(motionQuery && motionQuery.matches);
    var sizeObs = null;
    var stats = { frames: 0, drawMs: 0, terrainRenders: 0, terrainMs: 0, terrainPatches: 0, tilesRepainted: 0, patchMs: 0, minimapBuilds: 0 };
    var mini = null, miniBase = null; // the minimap, and the map under its dot
    var miniDot = { x: -1, y: -1 }; // where the dot was last painted, to lift it
    var lastLabel = ""; // the canvas's aria-label as last written
    /** the camera, in map pixels: the player's pixel position centred, clamped to the map */
    function camera(px, py) {
        return { x: Math.max(0, Math.min((mapW - VW) * TILE, px - Math.floor(VW / 2) * TILE)), y: Math.max(0, Math.min((mapH - VH) * TILE, py - Math.floor(VH / 2) * TILE)) };
    }
    /** water for the shoreline's purposes: the sea, a bridge over it, and the void past the edge */
    function isWater(x, y) { var t = tileAt(x, y); return t === "water" || t === "bridge" || t === "void"; }
    function isRoadLike(x, y) { var t = tileAt(x, y); return t === "road" || t === "bridge" || t === "town" || t === "door" || t === "keep" || t === "gate"; }
    function isCliff(x, y) { return tileAt(x, y) === "cliff"; }
    /** N=1 E=2 S=4 W=8, set where the neighbour is not the same kind */
    function edgeMask(x, y, same) {
        return (same(x, y - 1) ? 0 : 1) | (same(x + 1, y) ? 0 : 2) | (same(x, y + 1) ? 0 : 4) | (same(x - 1, y) ? 0 : 8);
    }
    /** N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128, set where the neighbour is land */
    function shoreMask(x, y) {
        return (isWater(x, y - 1) ? 0 : 1) | (isWater(x + 1, y - 1) ? 0 : 2) | (isWater(x + 1, y) ? 0 : 4) | (isWater(x + 1, y + 1) ? 0 : 8) |
            (isWater(x, y + 1) ? 0 : 16) | (isWater(x - 1, y + 1) ? 0 : 32) | (isWater(x - 1, y) ? 0 : 64) | (isWater(x - 1, y - 1) ? 0 : 128);
    }
    /** which region each tile is in, for its colours: the region of the town
        nearest by land, flooding out from every town at once and never across
        water, so the tint changes at the rivers and the strait rather than in the
        middle of a meadow. The sand around the Exam gate belongs to no region. */
    function buildRegions() {
        mapW = D.map[0].length;
        mapH = D.map.length;
        regionOf = new Uint8Array(mapW * mapH);
        var seen = new Uint8Array(mapW * mapH);
        var queue = [];
        D.towns.forEach(function (t) { var i = t.y * mapW + t.x; regionOf[i] = +t.sec.split(".")[0]; seen[i] = 1; queue.push(i); });
        for (var q = 0; q < queue.length; q++) {
            var i = queue[q], x = i % mapW, y = (i - x) / mapW, d = regionOf[i];
            var next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
            for (var n = 0; n < 4; n++) {
                var nx = next[n][0], ny = next[n][1];
                if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH)
                    continue;
                var j = ny * mapW + nx, t = tileAt(nx, ny);
                if (seen[j] || t === "water" || t === "bridge" || t === "sand" || t === "gate")
                    continue;
                seen[j] = 1;
                regionOf[j] = d;
                queue.push(j);
            }
        }
        for (var y2 = 0; y2 < mapH; y2++)
            for (var x2 = 0; x2 < mapW; x2++) {
                var k = y2 * mapW + x2;
                if (seen[k] || isWater(x2, y2))
                    continue;
                var t2 = tileAt(x2, y2);
                if (t2 === "sand" || t2 === "gate")
                    continue; // the gate's island stays neutral
                var here = regionAt(x2, y2); // an islet with no town: the nearest town's, as the signpost says
                regionOf[k] = here ? here.region.d : 0;
            }
    }
    /** what the terrain was painted with: one character per door, then per keep,
        then the gate, so a change names the tiles to repaint */
    function landmarkSig() {
        var s = "";
        for (var i = 0; i < D.towns.length; i++)
            s += has("towns", D.towns[i].sec) ? "1" : "0";
        for (var j = 0; j < D.regions.length; j++)
            s += has("flags", "boss-" + D.regions[j].d) ? "1" : "0";
        return s + (has("flags", "final") ? "F" : gateOpen() ? "O" : "S");
    }
    /** the sprite for a map tile, in the beat's given frame */
    function tileSprite(mx, my, frame) {
        var t = tileAt(mx, my), d = regionOf[my * mapW + mx] || 0, v = Math.floor(hash(mx, my) * 4);
        switch (t) {
            case "grass": return ART.grass(v, d);
            case "flower": return ART.flower(v, d, frame);
            case "road": return ART.road(v, d, edgeMask(mx, my, isRoadLike));
            case "sand": return ART.sand(v, d);
            case "tree": return ART.tree(v, d);
            case "cliff": return ART.cliff(v, d, edgeMask(mx, my, isCliff));
            case "water": return ART.water(shoreMask(mx, my), frame);
            // a bridge runs north-south unless the water passes under it that way
            case "bridge": return ART.bridge(!(isWater(mx, my - 1) && isWater(mx, my + 1)));
            case "town": return ART.town(d);
            case "door": {
                var dr = doorAt(mx, my);
                return ART.door(d, !!(dr && dungeonOpen(dr)));
            }
            case "keep": {
                var kp = keepAt(mx, my);
                return ART.keep(kp ? kp.d : d, !!(kp && has("flags", "boss-" + kp.d)));
            }
            case "gate": return ART.gate(has("flags", "final") ? 2 : gateOpen() ? 1 : 0);
            default: return null;
        }
    }
    function paintTile(k, x, y) {
        var s = tileSprite(x, y, 0);
        if (s)
            k.drawImage(s, x * TILE, y * TILE);
        else {
            k.fillStyle = P.sunk;
            k.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
    }
    /** the whole map, once, and again only for a new palette */
    function renderTerrain() {
        var t0 = performance.now();
        if (!terrain) {
            terrain = document.createElement("canvas");
            terrain.width = mapW * TILE;
            terrain.height = mapH * TILE;
        }
        var k = terrain.getContext("2d");
        if (!k)
            return;
        k.imageSmoothingEnabled = false;
        k.fillStyle = P.sunk;
        k.fillRect(0, 0, terrain.width, terrain.height);
        for (var y = 0; y < mapH; y++)
            for (var x = 0; x < mapW; x++)
                paintTile(k, x, y);
        terrainSig = landmarkSig();
        terrainStale = false;
        stats.terrainRenders++;
        stats.terrainMs += performance.now() - t0;
        buildMinimap();
    }
    /** only the landmarks whose state changed: a door that opened, a keep that fell, the gate */
    function patchTerrain(sig) {
        var k = terrain && terrain.getContext("2d");
        if (!k)
            return;
        var t0 = performance.now(), n = 0, i = 0;
        for (var t = 0; t < D.towns.length; t++, i++)
            if (sig[i] !== terrainSig[i]) {
                paintTile(k, D.towns[t].door.x, D.towns[t].door.y);
                n++;
            }
        for (var r = 0; r < D.regions.length; r++, i++)
            if (sig[i] !== terrainSig[i]) {
                paintTile(k, D.regions[r].keep.x, D.regions[r].keep.y);
                n++;
            }
        if (sig[i] !== terrainSig[i]) {
            paintTile(k, D.finale.keep.x, D.finale.keep.y);
            n++;
        }
        terrainSig = sig;
        var dt = performance.now() - t0;
        stats.terrainPatches++;
        stats.tilesRepainted += n;
        stats.terrainMs += dt;
        stats.patchMs += dt;
        buildMinimap(); // a cleared town turns green on it
    }
    /** the minimap's ground: the terrain scaled to a pixel a tile, each region's
        tint over its land, the towns, the keeps and the gate in their state's colour */
    function buildMinimap() {
        if (!terrain || !mini)
            return;
        if (!miniBase) {
            miniBase = document.createElement("canvas");
            miniBase.width = mapW;
            miniBase.height = mapH;
        }
        var k = miniBase.getContext("2d"), m = mini.getContext("2d");
        if (!k || !m)
            return;
        k.imageSmoothingEnabled = true;
        k.clearRect(0, 0, mapW, mapH);
        k.drawImage(terrain, 0, 0, terrain.width, terrain.height, 0, 0, mapW, mapH);
        k.globalAlpha = 0.32;
        for (var y = 0; y < mapH; y++) {
            for (var x = 0; x < mapW;) {
                var d = regionOf[y * mapW + x];
                if (!d || isWater(x, y)) {
                    x++;
                    continue;
                }
                var x0 = x;
                while (x < mapW && regionOf[y * mapW + x] === d && !isWater(x, y))
                    x++;
                k.fillStyle = ART.tint(d);
                k.fillRect(x0, y, x - x0, 1);
            }
        }
        k.globalAlpha = 1;
        D.towns.forEach(function (t) { k.fillStyle = has("towns", t.sec) ? P.ok : P.paper; k.fillRect(t.x, t.y, 1, 1); });
        D.regions.forEach(function (r) { k.fillStyle = has("flags", "boss-" + r.d) ? P.ok : P.warn; k.fillRect(r.keep.x, r.keep.y, 1, 1); });
        k.fillStyle = has("flags", "final") ? P.ok : P.viol;
        k.fillRect(D.finale.keep.x, D.finale.keep.y, 1, 1);
        m.imageSmoothingEnabled = false;
        m.clearRect(0, 0, mapW, mapH);
        m.drawImage(miniBase, 0, 0);
        miniDot.x = -1;
        miniDot.y = -1;
        stats.minimapBuilds++;
    }
    /** the player's dot on the minimap: the last one lifted, the new one put down, blinking on the beat */
    function drawMinimap() {
        var m = mini && miniBase && mini.getContext("2d");
        if (!m)
            return;
        if (miniDot.x >= 0)
            m.drawImage(miniBase, miniDot.x - 1, miniDot.y - 1, 3, 3, miniDot.x - 1, miniDot.y - 1, 3, 3);
        var x = player.x, y = player.y;
        if (reduceMotion || !(animFrame & 1)) {
            m.fillStyle = P.ink;
            m.fillRect(x - 1, y - 1, 3, 3);
            m.fillStyle = P.warn;
            m.fillRect(x, y, 1, 1);
        }
        miniDot.x = x;
        miniDot.y = y;
    }
    /** paint on the next animation frame; several requests in one frame are one paint */
    function requestDraw() {
        dirty = true;
        if (!rafId && host && scene === "map")
            rafId = requestAnimationFrame(frame);
    }
    function frame() { rafId = 0; draw(); }
    function draw() {
        if (!ctx || !host || scene !== "map" || !dirty)
            return;
        dirty = false;
        var t0 = performance.now();
        if (!terrain || terrainStale)
            renderTerrain();
        else {
            var sig = landmarkSig();
            if (sig !== terrainSig)
                patchTerrain(sig);
        }
        var p = stepProgress(t0), off = stepOffset(p);
        walkFrame = walk && p < 0.5 ? 1 : 0;
        var px = player.x * TILE + off.x, py = player.y * TILE + off.y;
        var cam = camera(px, py), cx = cam.x, cy = cam.y;
        var tx0 = Math.floor(cx / TILE), ty0 = Math.floor(cy / TILE), ox = cx - tx0 * TILE, oy = cy - ty0 * TILE;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(terrain, cx, cy, W, H, 0, 0, W, H);
        // what moves, over the first frame the terrain holds: the water and the
        // flowers in another frame, the smoke over a town, the torches on an open door
        waterInView = 0;
        ambientInView = 0;
        var cols = VW + (ox ? 1 : 0), rows = VH + (oy ? 1 : 0);
        for (var y = 0; y < rows; y++)
            for (var x = 0; x < cols; x++) {
                var mx = tx0 + x, my = ty0 + y, t = tileAt(mx, my), sx = x * TILE - ox, sy = y * TILE - oy;
                if (t === "water") {
                    waterInView++;
                    if (animFrame)
                        ctx.drawImage(ART.water(shoreMask(mx, my), animFrame), sx, sy);
                }
                else if (t === "flower") {
                    ambientInView++;
                    if (animFrame)
                        ctx.drawImage(ART.flower(Math.floor(hash(mx, my) * 4), regionOf[my * mapW + mx] || 0, animFrame), sx, sy);
                }
                else if (t === "town") {
                    ambientInView++;
                    ctx.drawImage(ART.ambient("puff", animFrame), sx, sy);
                }
                else if (t === "door") {
                    var dr = doorAt(mx, my);
                    if (dr && dungeonOpen(dr)) {
                        ambientInView++;
                        ctx.drawImage(ART.ambient("torch", animFrame), sx, sy);
                    }
                }
            }
        // banners over towns and keeps, so the map reads without a legend
        ctx.font = "8px CNPE Mono, ui-monospace, monospace";
        ctx.textBaseline = "top";
        D.towns.forEach(function (t) { label(t.name, t.x * TILE - cx, t.y * TILE - cy, has("towns", t.sec) ? P.ok : P.paper); });
        D.regions.forEach(function (r) { label(r.name + " keep", r.keep.x * TILE - cx, r.keep.y * TILE - cy, has("flags", "boss-" + r.d) ? P.ok : P.warn); });
        label("The Exam", D.finale.keep.x * TILE - cx, D.finale.keep.y * TILE - cy, has("flags", "final") ? P.ok : P.viol);
        ctx.drawImage(ART.hero(player.face, walkFrame), px - cx, py - cy);
        drawMinimap();
        var here = regionAt(player.x, player.y);
        var what = tileAt(player.x, player.y);
        var tw = townAt(player.x, player.y), dd = doorAt(player.x, player.y), kp = keepAt(player.x, player.y);
        var where = here ? here.region.name + (tw ? " · " + tw.name : dd ? " · dungeon of " + dd.name : kp ? " · the keep" : gateAt(player.x, player.y) ? " · the Exam gate" : "") : "";
        var aria = "Overworld map. You stand on " + what + " in " + where + ". " + (here && here.dist ? here.town.name + " is " + here.dist + " steps away." : "");
        if (aria !== lastLabel) {
            lastLabel = aria;
            whereEl.textContent = where;
            canvas.setAttribute("aria-label", aria);
        }
        stats.frames++;
        stats.drawMs += performance.now() - t0;
        if (walk) {
            if (p >= 1)
                landStep();
            else
                requestDraw();
        } // the step in flight: land it, or paint the next sub-position
    }
    /** a pixel banner: ink on a rim, a pointer toward the tile, the name in its state's colour; px, py the tile's top-left on the canvas */
    function label(s, px, py, color) {
        if (px < -4 * TILE || px >= W + 4 * TILE || py <= -TILE || py >= H)
            return;
        var w = s.length * 5 + 8, x = Math.round(px + TILE / 2 - w / 2), y = py - 14, below = false;
        if (y < 0) {
            y = py + TILE + 3;
            below = true;
        }
        var ptr = Math.round(px + TILE / 2);
        ctx.fillStyle = P.paper3;
        ctx.fillRect(x - 1, y - 1, w + 2, 12);
        if (below) {
            ctx.fillRect(ptr - 2, y - 2, 4, 1);
            ctx.fillRect(ptr - 1, y - 3, 2, 1);
        }
        else {
            ctx.fillRect(ptr - 2, y + 11, 4, 1);
            ctx.fillRect(ptr - 1, y + 12, 2, 1);
        }
        ctx.fillStyle = P.ink;
        ctx.fillRect(x, y, w, 10);
        ctx.fillStyle = color;
        ctx.fillText(s, x + 4, y + 1);
    }
    /** the beat: only on the map, only while the page shows, never under reduced motion */
    function syncAnim() {
        var want = scene === "map" && !reduceMotion && document.visibilityState !== "hidden" && !!host && document.body.contains(host);
        if (want && !animTimer)
            animTimer = window.setTimeout(tickAnim, ANIM_MS);
        if (!want && animTimer) {
            clearTimeout(animTimer);
            animTimer = 0;
        }
        if (!want && animFrame) {
            animFrame = 0;
            requestDraw();
        }
    }
    /** one beat: a frame if anything animated is in view, else only the minimap's dot blinks */
    function tickAnim() {
        animTimer = 0;
        animFrame = (animFrame + 1) % ART.FRAMES;
        if (waterInView || ambientInView)
            requestDraw();
        else if (!rafId)
            drawMinimap();
        syncAnim();
    }
    /** the backing store: whole device pixels per art pixel, so the art stays sharp on any screen */
    function fitCanvas() {
        if (!host)
            return;
        var dpr = window.devicePixelRatio || 1, cssW = stage.clientWidth || W;
        var s = Math.max(1, Math.min(4, Math.round(cssW * dpr / W)));
        dprSeen = dpr;
        if (s === scale && canvas.width === W * s)
            return;
        scale = s;
        canvas.width = W * s;
        canvas.height = H * s;
        requestDraw();
    }
    /** the monster: the fault family's sprite, painted in the theme's colours */
    function drawMonster(c, family) {
        var k = c.getContext("2d");
        if (!k)
            return;
        k.setTransform(1, 0, 0, 1, 0, 0);
        k.imageSmoothingEnabled = false;
        k.clearRect(0, 0, c.width, c.height);
        k.drawImage(ART.enemy(family, 3), 0, 0);
    }
    function paintHud() {
        var mh = maxHp(), cells = "";
        for (var i = 0; i < 10; i++)
            cells += '<i class="' + (hp > (i / 10) * mh ? "" : "off") + '"></i>';
        hud.innerHTML = '<span class="lv">Lv <b>' + level() + "</b></span><span class=\"hp\" title=\"" + hp + " of " + mh + '">' + cells + "</span><span class=\"g\"><b>" + gold() + "</b>g</span>";
    }
    /* ── scenes ─────────────────────────────────────────────── */
    function setScene(next) {
        scene = next;
        var onMap = next === "map";
        screen.hidden = onMap;
        canvas.style.visibility = onMap ? "" : "hidden";
        hud.hidden = !onMap;
        whereEl.hidden = !onMap;
        miniWin.hidden = !onMap;
        stage.classList.toggle("gm-map", onMap);
        if (onMap) {
            screen.innerHTML = "";
            bt = null;
            tn = null;
            requestDraw();
            paintHud();
            savePos(true);
        }
        else {
            dialog.hidden = true;
            dlg = null;
            settleStep();
        }
        syncAnim();
    }
    function leaveToMap() { town = null; trial = null; battle = null; setScene("map"); stage.focus(); }
    /** the town: header, the menu, and whatever the menu opened on the right,
        over a strip of scenery for the square, the inn, the shop or the people.
        The header and the menu are built once a visit and their lines updated;
        only the right column is rebuilt. */
    function enterTown(t) {
        town = t;
        setScene("town");
        paintTown(null);
    }
    function buildTown(t) {
        var nav = navOf(t.sec), dom = domainOf(+t.sec.split(".")[0]);
        screen.innerHTML = "";
        var root = el("div", "gm-town");
        var head = el("div", "gm-title", "<h3>" + esc(t.name) + '</h3><span class="sub">' + esc(t.sec) + " · " + esc(nav ? nav.title : "") + "</span>");
        var headRight = el("span", "right", esc(dom ? dom.name : ""));
        head.appendChild(headRight);
        root.appendChild(head);
        var body = el("div", "gm-body"), left = el("div", "gm-col"), right = el("div", "gm-col");
        var menu = el("ul", "gm-menu"), items = {};
        var item = function (id, fn) { var li = el("li"); var b = btn("", fn); li.appendChild(b); menu.appendChild(li); items[id] = b; };
        item("talk", function () { paintTown(talkMenu(), "talk"); });
        var read = el("li");
        var a = el("a", "", "Read the section" + '<span class="k">' + esc(t.sec) + "</span>");
        a.href = nav ? pageHref(nav.path, nav.id) : "index.html";
        read.appendChild(a);
        menu.appendChild(read);
        a.addEventListener("click", function () { savePos(true); });
        item("trial", function () { startTrial(); });
        item("inn", function () { hp = maxHp(); paintHud(); paintTown(note("You sleep. The pager stays quiet. Health restored to " + hp + ".", "ok"), "inn"); });
        item("shop", function () { paintTown(shopMenu(), "shop"); });
        item("dungeon", function () {
            if (!dungeonOpen(t)) {
                paintTown(note("The dungeon door is sealed until you pass this town's trial.", "warn"));
                return;
            }
            startBattle([scenario(t.dungeon).id], { town: t });
        });
        item("leave", function () { leaveToMap(); });
        left.appendChild(menu);
        body.appendChild(left);
        body.appendChild(right);
        root.appendChild(body);
        screen.appendChild(root);
        return { root: root, sec: t.sec, headRight: headRight, menu: menu, items: items, right: right, scene: "square" };
    }
    function setItem(b, label, meta, cls) {
        b.innerHTML = label + (meta ? '<span class="k">' + meta + "</span>" : "");
        b.className = cls || "";
    }
    function paintTown(right, sceneName) {
        var t = town, nav = navOf(t.sec), dom = domainOf(+t.sec.split(".")[0]);
        if (!tn || tn.root.parentNode !== screen || tn.sec !== t.sec)
            tn = buildTown(t);
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
        if (right)
            v.right.appendChild(right);
        else
            v.right.appendChild(el("div", "gm-lines", "<p>" + esc(t.blurb || ("The people here work on " + (nav ? nav.title.toLowerCase() : "the platform") + ".")) + "</p><p class=\"gm-note\">Talk to learn the ideas and the commands. Pass the trial to open the dungeon. Read the section itself when a question stumps you.</p>"));
        focusFirst(v.menu);
    }
    /** a strip of scenery: the town square, its people, the inn or the shop, in the region's colours */
    function backdrop(sceneName, d) {
        var c = el("canvas", "gm-scene");
        c.width = 480;
        c.height = 64;
        c.setAttribute("aria-hidden", "true");
        c.setAttribute("data-scene", sceneName);
        paintBackdrop(c, d);
        return c;
    }
    function paintBackdrop(c, d) {
        var k = c.getContext("2d");
        if (k) {
            k.imageSmoothingEnabled = false;
            k.drawImage(ART.backdrop(c.getAttribute("data-scene") || "square", d, c.width, c.height), 0, 0);
        }
    }
    function note(msg, cls) { return el("p", "gm-note " + (cls || ""), msg); }
    function focusFirst(within) { var b = within.querySelector("button, a, input"); if (b)
        b.focus(); }
    /** a technique's short name: the command up to its first placeholder or flag */
    function techName(id) {
        var words = D.techniques[id].cmd.split(" "), out = [];
        for (var i = 0; i < words.length && out.length < 4; i++) {
            if (/^[-{]/.test(words[i]) || /^[A-Z]{3,}/.test(words[i]))
                break;
            out.push(words[i]);
        }
        return out.join(" ");
    }
    function talkMenu() {
        var wrap = el("div", "gm-col");
        wrap.appendChild(el("div", "gm-sub .hd", "").firstChild ? el("div") : el("p", "gm-note", "Who do you talk to?"));
        var menu = el("ul", "gm-menu");
        town.npcs.forEach(function (n) {
            var li = el("li");
            var learnedIt = n.teaches && has("learned", n.teaches);
            var b = btn(esc(n.name) + (n.teaches ? '<span class="k">' + (learnedIt ? "taught ✓" : "teaches " + esc(techName(n.teaches))) + "</span>" : ""), function () { talkTo(n); }, n.teaches && !learnedIt ? "new" : "");
            li.appendChild(b);
            menu.appendChild(li);
        });
        wrap.appendChild(menu);
        return wrap;
    }
    function talkTo(n) {
        var wrap = el("div", "gm-col");
        var lines = el("div", "gm-lines");
        lines.appendChild(el("p", "gm-note", "<b>" + esc(n.name) + "</b> says:"));
        n.lines.forEach(function (l) { lines.appendChild(el("p", "", l)); });
        if (n.teaches) {
            var tq = D.techniques[n.teaches];
            var fresh = tick("learned", n.teaches);
            if (fresh) {
                addXp(5);
                save();
            }
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
            if (!it.price)
                return;
            var owned = held(id);
            var b = btn('<span class="nm">' + esc(it.name) + '<span class="p">' + it.price + "g</span></span>" +
                '<span class="ab">' + esc(it.about) + "</span>" + (owned ? '<span class="nm"><span class="h">' + (it.permanent ? "owned" : "held: " + owned) + "</span></span>" : ""), function () {
                if (it.permanent && owned) {
                    paintTown(shopMenu(), "shop");
                    return;
                }
                if (!spendGold(it.price)) {
                    paintTown(wrapNote(shopMenu(), "Not enough gold. Trials and battles pay.", "warn"), "shop");
                    return;
                }
                giveItem(id, 1);
                save();
                paintTown(wrapNote(shopMenu(), "Bought " + it.name + ".", "ok"), "shop");
            }, "gm-item");
            if ((it.permanent && owned) || gold() < it.price)
                b.disabled = true;
            grid.appendChild(b);
        });
        wrap.appendChild(grid);
        return wrap;
    }
    function wrapNote(w, msg, cls) { w.insertBefore(note(msg, cls), w.firstChild); return w; }
    /* ── the trial: the section's self-check cards, multiple choice ── */
    function deckFor(sec) { return (window.CNPE_DRILL || []).filter(function (q) { return q.sec === sec; }); }
    function optionText(html) {
        var t = text(html);
        return t.length > 170 ? t.slice(0, 168).replace(/\s+\S*$/, "") + "…" : t;
    }
    function startTrial() {
        var cards = shuffle(deckFor(town.sec).slice());
        if (!cards.length) {
            paintTown(note("This town has no trial yet: its section has no self-check cards.", "warn"));
            return;
        }
        var dom = town.sec.split(".")[0];
        var pool = (window.CNPE_DRILL || []).filter(function (q) { return q.sec.split(".")[0] === dom; });
        trial = { cards: cards, i: 0, right: 0, marks: [], pool: pool, revealed: false, opts: null, picked: -1 };
        setScene("trial");
        paintTrial();
    }
    function paintTrial() {
        var tr = trial, q = tr.cards[tr.i];
        screen.innerHTML = "";
        screen.appendChild(el("div", "gm-title", "<h3>Trial of " + esc(town.name) + '</h3><span class="sub">question ' + (tr.i + 1) + " of " + tr.cards.length + '</span><span class="right">' + tr.right + " right · pass at " + passMark(tr.cards.length) + "</span>"));
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
            if (tr.revealed)
                b.disabled = true;
            opts.appendChild(b);
        });
        col.appendChild(opts);
        var acts = el("div", "gm-acts");
        if (tr.revealed) {
            col.appendChild(el("div", "gm-a", q.a));
            acts.appendChild(btn(tr.i + 1 < tr.cards.length ? "Next ▶" : "Finish", function () { nextTrial(); }));
            acts.appendChild(el("span", "gm-note", "enter"));
        }
        else {
            acts.appendChild(el("span", "gm-note", "pick 1 to 4, or click"));
        }
        acts.appendChild(btn("Give up", function () { town && enterTown(town); }, "ghost"));
        col.appendChild(acts);
        body.appendChild(col);
        screen.appendChild(body);
        if (tr.revealed) {
            var nb = acts.querySelector("button");
            if (nb)
                nb.focus();
        }
        else
            focusFirst(opts);
    }
    function passMark(n) { return Math.ceil(n * 0.7) + "/" + n; }
    function answerTrial(i) {
        var tr = trial;
        if (tr.revealed)
            return;
        var okAns = tr.opts[i].ok;
        tr.revealed = true;
        tr.picked = i;
        tr.marks.push(okAns);
        if (okAns) {
            tr.right++;
            addXp(XP_ANSWER);
        }
        recordDrill(tr.cards[tr.i], okAns);
        save();
        live.textContent = okAns ? "Right." : "Missed. The answer is shown.";
        paintTrial();
    }
    function nextTrial() {
        var tr = trial;
        tr.i++;
        tr.revealed = false;
        tr.opts = null;
        tr.picked = -1;
        if (tr.i < tr.cards.length) {
            paintTrial();
            return;
        }
        var need = Math.ceil(tr.cards.length * 0.7), passed = tr.right >= need;
        var msg;
        if (passed) {
            var first = tick("towns", town.sec);
            if (first) {
                addXp(XP_TRIAL);
                addGold(GOLD_TRIAL);
            }
            save();
            msg = note("Trial cleared: " + tr.right + " of " + tr.cards.length + ". " + (first ? "The dungeon door opens. +" + XP_TRIAL + " xp, +" + GOLD_TRIAL + " gold." : "Every answer went into your drill record."), "ok");
        }
        else {
            msg = note("Not this time: " + tr.right + " of " + tr.cards.length + ", and " + need + " clears it. The missed cards are due again in the drill; read the section and come back.", "bad");
        }
        trial = null;
        enterTown(town);
        paintTown(msg);
    }
    /* ── the battle ─────────────────────────────────────────── */
    function startBattle(chain, opts) {
        if (hp < 1)
            hp = maxHp();
        battle = { chain: chain, idx: 0, sc: scenario(chain[0]), found: {}, turn: 0, log: [], mode: "menu", opts: opts,
            gained: 0, goldGained: 0, turnsTotal: 0, pick: null, history: [], histAt: 0, draft: "" };
        fx = null; // a blow from a lost fight does not land on the next one's first frame
        setScene("battle");
        logSys("A " + (opts.boss ? "keep" : opts.final ? "gate" : "dungeon") + " battle begins: " + battle.sc.name + ". The ticket is above; the terminal is yours.");
        paintBattle();
    }
    function logSys(s) { battle.log.push({ sys: s }); }
    function buildBattle() {
        var b = battle;
        screen.innerHTML = "";
        var root = el("div", "gm-battle");
        var title = el("div", "gm-title"), h3 = el("h3"), sub = el("span", "sub"), turn = el("span", "right");
        title.appendChild(h3);
        title.appendChild(sub);
        title.appendChild(turn);
        root.appendChild(title);
        var body = el("div", "gm-body"), left = el("div", "gm-col"), right = el("div", "gm-col");
        var figure = el("div", "gm-enemy");
        var sprite = el("canvas");
        sprite.width = 96;
        sprite.height = 96;
        sprite.setAttribute("role", "img");
        figure.appendChild(sprite);
        var side = el("div", "side"), nm = el("div", "nm"), lv = el("div", "lv");
        var guardWrap = el("div", "gm-bar"), guard = el("i");
        guardWrap.appendChild(guard);
        var guardLbl = el("div", "gm-barlbl", "<span>guard</span><span></span>");
        var hpWrap = el("div", "gm-bar hp"), hpBar = el("i");
        hpWrap.appendChild(hpBar);
        var hpLbl = el("div", "gm-barlbl", "<span>you</span><span></span>");
        [nm, lv, guardWrap, guardLbl, hpWrap, hpLbl].forEach(function (e) { side.appendChild(e); });
        figure.appendChild(side);
        // the effect's class comes off when its animation ends; data-fx keeps the last one for the checks
        figure.addEventListener("animationend", function (e) { if (e.target === sprite)
            figure.classList.remove("fx-hit", "fx-stagger", "fx-win"); });
        left.appendChild(figure);
        var ticket = el("p", "gm-ticket");
        left.appendChild(ticket);
        var bar = el("div", "gm-acts"), modes = {};
        var mode = function (m, label) {
            // opening or closing a menu abandons whatever a menu pick had seeded, so the
            // next command typed by hand is scored as typed
            modes[m] = btn(label, function () { b.mode = b.mode === m ? "menu" : m; b.fromMenu = false; b.pending = null; paintBattle(); });
            bar.appendChild(modes[m]);
        };
        mode("inspect", "Inspect");
        mode("fix", "Fix");
        mode("item", "Item");
        bar.appendChild(btn("Flee", function () { flee(); }, "ghost"));
        left.appendChild(bar);
        var subHost = el("div", "gm-subhost");
        left.appendChild(subHost);
        var term = el("div", "gm-term");
        var tbar = el("div", "bar"), tool = el("span"), found = el("span", "turn");
        tbar.appendChild(tool);
        tbar.appendChild(el("span", "spacer"));
        tbar.appendChild(found);
        term.appendChild(tbar);
        var pre = el("pre");
        pre.setAttribute("tabindex", "0");
        pre.setAttribute("aria-live", "polite");
        pre.setAttribute("aria-label", "Terminal output");
        term.appendChild(pre);
        var form = el("form");
        form.appendChild(el("span", "ps", "$"));
        var input = el("input");
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.setAttribute("aria-label", "Command");
        input.placeholder = "type a command, or pick one from Inspect / Fix";
        form.appendChild(input);
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var cmd = input.value.trim();
            if (!cmd)
                return;
            input.value = "";
            if (b.history[b.history.length - 1] !== cmd)
                b.history.push(cmd);
            b.histAt = b.history.length;
            b.draft = "";
            runCommand(cmd, !b.fromMenu);
            b.fromMenu = false;
        });
        // up and down walk the commands typed this battle, like a shell; the draft
        // left when going up comes back at the bottom
        input.addEventListener("keydown", function (e) {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                return;
            if (e.metaKey || e.ctrlKey || e.altKey || !b.history.length)
                return;
            if (b.histAt >= b.history.length)
                b.draft = input.value;
            var at = b.histAt + (e.key === "ArrowUp" ? -1 : 1);
            if (at < 0 || at > b.history.length) {
                e.preventDefault();
                return;
            }
            b.histAt = at;
            input.value = at < b.history.length ? b.history[at] : b.draft;
            input.setSelectionRange(input.value.length, input.value.length);
            e.preventDefault();
        });
        term.appendChild(form);
        right.appendChild(term);
        body.appendChild(left);
        body.appendChild(right);
        root.appendChild(body);
        screen.appendChild(root);
        return { root: root, h3: h3, sub: sub, turn: turn, figure: figure, sprite: sprite, nm: nm, lv: lv,
            guard: guard, guardLbl: guardLbl.lastChild, hpWrap: hpWrap, hpBar: hpBar, hpLbl: hpLbl.lastChild,
            ticket: ticket, modes: modes, subHost: subHost, tool: tool, found: found, pre: pre, input: input, rendered: 0, scId: "", family: "" };
    }
    /** bring the battle screen up to date: only what changed is touched, and the
        terminal grows by the lines since the last paint, so a long log stays cheap */
    function paintBattle() {
        var b = battle, sc = b.sc, mh = maxHp();
        if (!bt || bt.root.parentNode !== screen)
            bt = buildBattle();
        var t = bt;
        var nFound = Object.keys(b.found).length, nAll = sc.evidence.length;
        // a chain's next monster waits for the last one's fall: the fall plays on the
        // figure as it is, and the swap comes when the animation ends
        if (t.scId && t.scId !== sc.id && fx && fx.name === "win" && !reduceMotion) {
            var cur = fx, swapped = false;
            fx = null;
            var swap = function () { if (swapped)
                return; swapped = true; t.sprite.removeEventListener("animationend", once); if (bt !== t || !battle)
                return; t.scId = ""; paintBattle(); };
            var once = function (e) { if (e.target === t.sprite)
                swap(); };
            t.sprite.addEventListener("animationend", once);
            later(swap, 1200); // reduced motion aside (handled above), a fall that never ends still gives way
            play(t.figure, cur.name);
            return;
        }
        if (t.scId !== sc.id) {
            t.scId = sc.id;
            t.family = ART.familyOf(sc.id, sc.d);
            t.h3.textContent = sc.name;
            drawMonster(t.sprite, t.family);
            t.sprite.setAttribute("aria-label", "The monster " + sc.name + ", a " + t.family + " fault");
            t.sprite.setAttribute("data-family", t.family);
            t.figure.setAttribute("data-family", t.family);
            t.nm.textContent = sc.name;
            t.lv.textContent = "difficulty " + stars(sc.difficulty) + " · domain " + sc.d;
            t.ticket.innerHTML = "<b>TICKET</b><br>" + esc(sc.ticket);
        }
        t.sub.textContent = b.opts.final ? "the Exam · fault " + (b.idx + 1) + " of " + b.chain.length : b.opts.boss ? b.opts.boss.name + " keep · " + (b.idx + 1) + " of " + b.chain.length : "dungeon of " + b.opts.town.name;
        t.turn.textContent = "turn " + (b.turn + 1) + (b.opts.final ? " · short clock" : "");
        t.guard.style.width = Math.round((1 - nFound / nAll) * 100) + "%";
        t.guardLbl.textContent = (nAll - nFound) + " of " + nAll + " evidence hidden";
        t.hpWrap.className = "gm-bar hp" + (hp <= mh * 0.25 ? " crit" : hp <= mh * 0.5 ? " low" : "");
        t.hpBar.style.width = Math.round(hp / mh * 100) + "%";
        t.hpLbl.textContent = hp + " / " + mh + " hp";
        Object.keys(t.modes).forEach(function (m) { t.modes[m].className = b.mode === m ? "sel" : ""; });
        t.subHost.innerHTML = "";
        var sub = subMenu();
        if (sub)
            t.subHost.appendChild(sub);
        t.tool.textContent = SIM.toolOf(lastCmd() || "kubectl") || "terminal";
        t.found.textContent = "found " + nFound + "/" + nAll + " · " + b.gained + " xp this fight";
        if (b.log.length < t.rendered) {
            t.pre.innerHTML = "";
            t.rendered = 0;
        }
        if (b.log.length > t.rendered) {
            t.pre.insertAdjacentHTML("beforeend", (t.rendered ? "\n" : "") + b.log.slice(t.rendered).map(renderLog).join("\n"));
            t.rendered = b.log.length;
            t.pre.scrollTop = t.pre.scrollHeight;
        }
        if (b.pending) {
            t.input.value = b.pending;
            b.pending = null;
        }
        if (fx) {
            play(t.figure, fx.name);
            if (fx.num)
                floatNum(fx.from === "guard" ? t.guard.parentNode : t.figure, fx.num, fx.from === "guard" ? "gain" : "hit");
            fx = null;
        }
        if (b.mode === "menu" || b.mode === "typed")
            t.input.focus();
        else
            focusFirst(t.subHost);
    }
    /** an effect on the enemy's figure: the class runs the animation, data-fx records it */
    function play(e, name) {
        e.classList.remove("fx-hit", "fx-stagger", "fx-win");
        void e.offsetWidth; // restart the animation if the same one is still up
        e.classList.add("fx-" + name);
        e.setAttribute("data-fx", name);
    }
    /** a number that floats up and fades: the damage over the monster, the xp over the guard bar */
    function floatNum(anchor, num, cls) {
        var f = el("span", "gm-float " + cls, esc(num));
        f.setAttribute("aria-hidden", "true");
        anchor.appendChild(f);
        var gone = false;
        var lift = function () { if (gone)
            return; gone = true; if (f.parentNode)
            f.parentNode.removeChild(f); };
        f.addEventListener("animationend", lift);
        later(lift, 1400); // reduced motion runs no animation, so the number is lifted by the clock
    }
    function lastCmd() { for (var i = battle.log.length - 1; i >= 0; i--)
        if (battle.log[i].cmd)
            return battle.log[i].cmd; return ""; }
    function renderLog(e) {
        if (e.sys)
            return '<span class="sys">' + esc(e.sys) + "</span>";
        if (e.hit)
            return '<span class="hit">' + esc(e.hit) + "</span>";
        if (e.gain)
            return '<span class="' + (e.crit ? "crit" : "gain") + '">' + esc(e.gain) + "</span>";
        var out = esc(e.out || "");
        // The tell is cut out before the colouring and each run is coloured on its
        // own: a keyword the highlighter wraps inside the tell would otherwise split
        // it, and the mark would be silently dropped.
        var t = e.tell ? esc(e.tell) : "", at = t ? out.indexOf(t) : -1;
        var parts = at >= 0 ? [out.slice(0, at), t, out.slice(at + t.length)] : [out];
        var syn = window.CNPE_SYNTAX;
        if (syn) {
            var hl = syn; // narrowed once, for the closure below
            try {
                parts = parts.map(function (p) { return hl.highlight(p, "bash"); });
            }
            catch (er) { }
        }
        out = at >= 0 ? parts[0] + '<span class="tell">' + parts[1] + "</span>" + parts[2] : parts[0];
        return '<span class="in">' + esc(e.cmd) + "</span>\n" + out;
    }
    /** techniques the player knows, inspect or fix */
    function known(fix) {
        return Object.keys(D.techniques).filter(function (id) { var t = D.techniques[id]; return !!t.fix === fix && has("learned", id); });
    }
    function subMenu() {
        var b = battle;
        if (b.mode === "menu" || b.mode === "typed")
            return null;
        var wrap = el("div", "gm-sub"), menu = el("ul", "gm-menu");
        var add = function (label, fn, cls) { var li = el("li"); li.appendChild(btn(label, fn, cls)); menu.appendChild(li); };
        if (b.mode === "inspect" || b.mode === "fix") {
            var list = known(b.mode === "fix");
            wrap.appendChild(el("div", "hd", b.mode === "fix" ? "repairs you have learned; a template lands in the prompt for you to finish" : "techniques you have learned; pick one, then its target"));
            if (!list.length)
                add("nothing learned yet: talk to the townsfolk, or type", function () { b.mode = "menu"; paintBattle(); });
            list.forEach(function (id) {
                var t = D.techniques[id];
                add(esc(t.cmd.replace(/\{ns\}/g, b.sc.ns)) + '<span class="d">' + esc(t.about) + "</span>", function () { pickTechnique(id); });
            });
        }
        else if (b.mode === "target") {
            wrap.appendChild(el("div", "hd", "which one?"));
            b.targets.forEach(function (tg) { add(esc(tg.label), function () { finishPick(tg.value, tg.ns); }); });
            add("◀ back", function () { b.mode = "inspect"; paintBattle(); }, "ghost");
        }
        else if (b.mode === "item") {
            wrap.appendChild(el("div", "hd", "your pack"));
            var any = false;
            Object.keys(D.items).forEach(function (id) {
                var n = held(id);
                if (!n)
                    return;
                any = true;
                add(esc(D.items[id].name) + '<span class="k">' + (D.items[id].permanent ? "permanent" : "x" + n) + "</span>", function () { useInBattle(id); });
            });
            if (!any)
                add("the pack is empty; the shop in any town sells scrolls, lenses and elixirs", function () { b.mode = "menu"; paintBattle(); });
        }
        wrap.appendChild(menu);
        return wrap;
    }
    function pickTechnique(id) {
        var b = battle, t = D.techniques[id], cmd = t.cmd, sc = b.sc;
        b.pick = { id: id, cmd: cmd };
        var m = /\{(res|pod|kind|sa|app|name)\}/.exec(cmd);
        if (!m) {
            finishPick(null, null);
            return;
        }
        var what = m[1], targets = [];
        var seen = {};
        sc.resources.forEach(function (r) {
            if (what === "pod" && r.kind !== "pods")
                return;
            if (what === "sa" && r.kind !== "serviceaccounts")
                return;
            if (what === "app" && r.kind !== "applications")
                return;
            if (what === "kind") {
                if (seen[r.kind])
                    return;
                seen[r.kind] = 1;
                targets.push({ label: r.kind + (r.ns ? " (" + r.ns + ")" : ""), value: r.kind, ns: r.ns });
                return;
            }
            var value = what === "res" ? r.kind + " " + r.name : what === "sa" ? "system:serviceaccount:" + (r.ns || "default") + ":" + r.name : r.name;
            targets.push({ label: (what === "res" || what === "name" ? r.kind + "/" : "") + r.name + (r.ns ? "  (" + r.ns + ")" : ""), value: value, ns: r.ns });
        });
        if (!targets.length) {
            finishPick(null, null);
            return;
        }
        b.targets = targets;
        b.mode = "target";
        paintBattle();
    }
    function finishPick(value, ns) {
        var b = battle, cmd = b.pick.cmd;
        if (value !== null)
            cmd = cmd.replace(/\{(res|pod|kind|sa|app|name)\}/, value);
        // a cluster-scoped target takes no namespace; anything else takes its own
        if (value !== null && ns === undefined && !/\{ns\}/.test(cmd) === false)
            cmd = cmd.replace(/ -n \{ns\}/, "");
        cmd = cmd.replace(/\{ns\}/g, ns || b.sc.ns);
        b.pick = null;
        var unfinished = /[A-Z]{3,}|=$|=\s|\{\}|\[\]|\{(res|pod|kind|sa|app|name|image|container)\}/.test(cmd);
        if (unfinished) {
            b.pending = cmd.replace(/\{(image|container)\}/g, "").trim();
            b.fromMenu = true;
            b.mode = "typed";
            logSys("Finish the command in the prompt, then press enter.");
            paintBattle();
            return;
        }
        b.mode = "menu";
        runCommand(cmd, false);
    }
    function useInBattle(id) {
        var b = battle, sc = b.sc, it = D.items[id];
        if (!it.permanent && !useItem(id))
            return;
        var pending = sc.evidence.filter(function (e) { return !b.found[e.id]; });
        if (id === "scroll") {
            logSys(pending.length ? "The scroll reads: " + pending[0].hint : "The scroll reads: you have found everything there is to find. Fix it.");
        }
        else if (id === "lens") {
            if (pending.length) {
                b.found[pending[0].id] = 1;
                logSys("The lens shows a line you had not seen: " + (pending[0].tell || pending[0].hint) + " (evidence found, no xp for it)");
            }
            else
                logSys("The lens shows nothing new.");
        }
        else if (id === "elixir") {
            hp = Math.min(maxHp(), hp + Math.ceil(maxHp() / 2));
            logSys("The elixir burns going down. Health " + hp + " of " + maxHp() + ".");
        }
        else if (/^sheet-/.test(id)) {
            var fam = id.slice(6);
            var lines = Object.keys(D.techniques).filter(function (k) { return D.techniques[k].tool === fam; }).map(function (k) { return "  " + D.techniques[k].cmd.replace(/\{ns\}/g, sc.ns) + "   # " + D.techniques[k].about; });
            logSys("Cheat sheet, " + fam + ":\n" + (lines.join("\n") || "  (no techniques in this family yet)"));
        }
        save();
        b.mode = "menu";
        paintBattle();
    }
    /** the turn: the command, the cluster's answer, then the enemy's swing */
    function runCommand(cmd, typed) {
        var b = battle, sc = b.sc;
        if (b.over)
            return; // the card is up; the fight is finished
        var r = SIM.run(sc, b.found, cmd);
        b.turn++;
        b.turnsTotal++;
        var entry = { cmd: cmd, out: r.out, tell: null };
        if (r.evidence) {
            var ev = sc.evidence.filter(function (e) { return e.id === r.evidence; })[0];
            entry.tell = ev && ev.tell || null;
            b.found[r.evidence] = 1;
            var gain = Math.round(XP_EVIDENCE * (typed ? TYPED : 1));
            addXp(gain);
            b.gained += gain;
            b.log.push(entry);
            b.log.push({ gain: "Evidence found (" + Object.keys(b.found).length + "/" + sc.evidence.length + "): the enemy staggers. +" + gain + " xp" + (typed ? " (typed)" : "") + "." });
            fx = { name: "stagger", num: "+" + gain + " xp", from: "guard" };
            save();
            paintBattle();
            return;
        }
        b.log.push(entry);
        if (r.fixed) {
            winScenario(typed);
            return;
        }
        if (r.wrong) {
            b.log.push({ hit: "That was not it, and the fault bites back." });
            enemyHit(2);
        }
        else
            enemyHit(1);
        save();
        if (battle && !battle.over)
            paintBattle();
    }
    function enemyHit(mult) {
        var b = battle, sc = b.sc;
        var dmg = Math.ceil((1 + sc.difficulty) * mult * (b.opts.final ? 1.5 : 1)) + Math.floor(b.turn / 4);
        hp = Math.max(0, hp - dmg);
        fx = { name: "hit", num: "-" + dmg, from: "enemy" };
        b.log.push({ hit: sc.name + " strikes for " + dmg + ". Health " + hp + " of " + maxHp() + "." });
        if (hp <= 0)
            defeat();
    }
    function winScenario(typed) {
        var b = battle, sc = b.sc;
        var all = Object.keys(b.found).length >= sc.evidence.length;
        var base = (all ? XP_WIN : XP_WIN / 2) * sc.difficulty * (typed ? TYPED : 1);
        var gain = Math.round(base), goldGain = (all ? GOLD_WIN : GOLD_WIN / 2) * sc.difficulty;
        addXp(gain);
        addGold(goldGain);
        b.gained += gain;
        b.goldGained += goldGain;
        recordWin(sc.id, b.turn);
        b.log.push({ gain: (all ? "Critical hit! " : "You got lucky: the fix landed before the evidence did. ") + sc.name + " is down. +" + gain + " xp, +" + goldGain + " gold.", crit: all });
        b.results = b.results || [];
        b.results.push({ sc: sc, all: all, turns: b.turn });
        if (b.idx + 1 < b.chain.length) {
            b.idx++;
            b.sc = scenario(b.chain[b.idx]);
            b.found = {};
            b.turn = 0;
            b.mode = "menu";
            logSys("The truth: " + sc.answer);
            logSys("From the dark, another rises: " + b.sc.name + ". A new ticket.");
            fx = { name: "win" };
            save();
            paintBattle();
            return;
        }
        var extraXp = 0, extraGold = 0, flag = null;
        if (b.opts.boss) {
            flag = "boss-" + b.opts.boss.d;
            extraXp = XP_BOSS;
            extraGold = GOLD_BOSS;
        }
        if (b.opts.final) {
            flag = "final";
            extraXp = XP_FINAL;
            extraGold = GOLD_FINAL;
        }
        if (flag && tick("flags", flag)) {
            addXp(extraXp);
            addGold(extraGold);
            b.gained += extraXp;
            b.goldGained += extraGold;
        }
        b.over = true;
        save();
        // the monster falls, in its family's way, and the card comes up behind it
        if (reduceMotion) {
            resultCard(true);
            return;
        }
        fx = { name: "win" };
        paintBattle();
        later(function () { if (battle === b && b.over)
            resultCard(true); }, 950);
    }
    function defeat() {
        var b = battle;
        b.over = true;
        b.log.push({ hit: "You black out." });
        save();
        resultCard(false);
    }
    function flee() {
        var b = battle;
        if (b.over)
            return; // the monster is falling; the card is on its way
        say("", []);
        dlg = null;
        logSys("You back away up the stairs. The evidence you found stays found in your head, and the xp for it stays yours.");
        save();
        battle = null;
        if (b.opts.town) {
            enterTown(b.opts.town);
            paintTown(note("You fled " + b.sc.name + ". +" + b.gained + " xp kept.", "warn"));
        }
        else
            leaveToMap();
    }
    function resultCard(won) {
        var b = battle;
        screen.innerHTML = "";
        var card = el("div", "gm-result");
        var crit = won && (b.results || []).every(function (r) { return r.all; });
        card.appendChild(el("h4", won ? (crit ? "crit" : "win") : "lose", won ? (b.opts.final ? "You passed the Exam" : b.opts.boss ? "The keep falls" : crit ? "Critical hit" : "Victory") : "Defeat"));
        card.appendChild(el("p", "gain", (won ? "<b>+" + b.gained + " xp</b> · <b>+" + b.goldGained + " gold</b> · " + b.turnsTotal + (b.turnsTotal === 1 ? " turn" : " turns") : "<b>+" + b.gained + " xp</b> kept for the evidence you found · health restored to half") +
            " · level " + level() + " " + title(level())));
        (b.results || []).forEach(function (r) { card.appendChild(el("div", "ans", "<b>" + esc(r.sc.name) + "</b> was: " + esc(r.sc.answer))); });
        if (!won)
            card.appendChild(el("div", "ans", "The fault stands. Its ticket said: " + esc(b.sc.ticket) + (Object.keys(b.found).length ? " You had found: " + b.sc.evidence.filter(function (e) { return b.found[e.id]; }).map(function (e) { return e.id; }).join(", ") + "." : "")));
        var acts = el("div", "gm-acts");
        acts.style.justifyContent = "center";
        acts.style.marginTop = "14px";
        const back = b.opts.town;
        acts.appendChild(btn(back ? "Back to " + back.name : "Back to the map", function () {
            if (!won)
                hp = Math.ceil(maxHp() / 2);
            battle = null;
            if (back)
                enterTown(back);
            else
                leaveToMap();
        }));
        if (won && back)
            acts.appendChild(btn("Fight again", function () { battle = null; startBattle([back.dungeon], { town: back }); }, "ghost"));
        card.appendChild(acts);
        screen.appendChild(card);
        focusFirst(acts);
        live.textContent = won ? "Victory. " + b.gained + " xp gained." : "Defeat.";
    }
    /* ── input ──────────────────────────────────────────────── */
    function keys() {
        // Capture phase, like the drill: inside the game the keys are the game's,
        // and app.js's page shortcuts (d for dashboard, g for the drill) must not fire.
        listen(document, "keydown", function (e) {
            if (!host || !document.body.contains(host) || !host.contains(document.activeElement))
                return;
            if (e.metaKey || e.ctrlKey || e.altKey)
                return;
            var target = e.target;
            var typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
            var handled = true;
            if (e.key === "Escape") {
                if (scene === "map") {
                    if (dlg)
                        closeDialog();
                    else
                        handled = false;
                }
                else if (scene === "battle") {
                    if (battle && battle.mode !== "menu" && battle.mode !== "typed") {
                        battle.mode = "menu";
                        battle.fromMenu = false;
                        battle.pending = null;
                        paintBattle();
                    }
                    else
                        handled = false;
                }
                else if (scene === "trial")
                    handled = false;
                else if (scene === "town")
                    leaveToMap();
                else
                    handled = false;
            }
            else if (typing) {
                handled = false; // the terminal's own keys
            }
            else if (scene === "map") {
                switch (e.key) {
                    case "ArrowUp":
                    case "w":
                    case "W":
                    case "k":
                        move(0, -1);
                        break;
                    case "ArrowDown":
                    case "s":
                    case "S":
                    case "j":
                        move(0, 1);
                        break;
                    case "ArrowLeft":
                    case "a":
                    case "A":
                    case "h":
                        move(-1, 0);
                        break;
                    case "ArrowRight":
                    case "d":
                    case "D":
                    case "l":
                        move(1, 0);
                        break;
                    case "Enter":
                    case " ":
                    case "z":
                    case "Z":
                        act();
                        break;
                    default: handled = /^[a-z]$/i.test(e.key); // swallow the page shortcuts while the map has focus
                }
            }
            else if (scene === "trial" && trial) {
                if (!trial.revealed && /^[1-4]$/.test(e.key) && trial.opts[+e.key - 1])
                    answerTrial(+e.key - 1);
                else if (trial.revealed && e.key === "Enter")
                    nextTrial();
                else
                    handled = menuNav(e) || /^[a-z]$/i.test(e.key);
            }
            else
                handled = menuNav(e) || /^[a-z]$/i.test(e.key); // a letter in any scene is not a page shortcut
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }
    /** arrows walk a menu's buttons, so the keyboard plays it like a controller */
    function menuNav(e) {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
            return false;
        var items = Array.prototype.slice.call(screen.querySelectorAll("button:not(:disabled), a[href]"));
        var i = items.indexOf(document.activeElement);
        if (i < 0) {
            if (items[0])
                items[0].focus();
            return true;
        }
        var n = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
        if (n)
            n.focus();
        return true;
    }
    /* ── mount ──────────────────────────────────────────────── */
    function build() {
        host.innerHTML = "";
        host.classList.add("gm");
        stage = el("div", "gm-stage gm-map");
        stage.tabIndex = 0;
        stage.setAttribute("aria-label", "CNPE Quest. Click or tab here, then walk with the arrow keys or WASD; enter acts.");
        canvas = el("canvas");
        canvas.width = W * scale;
        canvas.height = H * scale; // fitCanvas() picks the scale once the stage has a width
        canvas.setAttribute("role", "img");
        ctx = canvas.getContext("2d"); // draw() still checks for a null one
        stage.appendChild(canvas);
        hud = el("div", "gm-win gm-hud");
        stage.appendChild(hud);
        whereEl = el("div", "gm-win gm-where");
        stage.appendChild(whereEl);
        miniWin = el("div", "gm-win gm-mini");
        miniWin.setAttribute("aria-hidden", "true");
        mini = el("canvas");
        mini.width = mapW;
        mini.height = mapH;
        miniWin.appendChild(mini);
        stage.appendChild(miniWin);
        dialog = el("div", "gm-win gm-dialog");
        dialog.hidden = true;
        dialog.setAttribute("role", "dialog");
        stage.appendChild(dialog);
        screen = el("div", "gm-screen");
        screen.hidden = true;
        stage.appendChild(screen);
        live = el("div");
        live.className = "sr-only";
        live.setAttribute("aria-live", "polite");
        live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
        stage.appendChild(live);
        host.appendChild(stage);
        stage.addEventListener("focus", function () { stage.classList.add("gm-focus"); });
        stage.addEventListener("blur", function () { stage.classList.remove("gm-focus"); });
        // a click on the map is a step toward where you clicked, and takes focus
        canvas.addEventListener("click", function (e) {
            stage.focus();
            if (scene !== "map" || dlg || walk)
                return;
            var r = canvas.getBoundingClientRect();
            var px = (e.clientX - r.left) / r.width * VW, py = (e.clientY - r.top) / r.height * VH;
            var cam = camera(player.x * TILE, player.y * TILE);
            var dx = Math.floor(px) + cam.x / TILE - player.x, dy = Math.floor(py) + cam.y / TILE - player.y;
            if (dx === 0 && dy === 0) {
                act();
                return;
            }
            if (Math.abs(dx) >= Math.abs(dy))
                move(dx > 0 ? 1 : -1, 0);
            else
                move(0, dy > 0 ? 1 : -1);
        });
        var pad = el("div", "gm-pad");
        var dpad = el("div", "gm-dpad");
        var padBtn = function (cls, label, dx, dy) {
            var b = btn(label, function () { stage.focus(); move(dx, dy); }, cls);
            b.setAttribute("aria-label", "walk " + (dy < 0 ? "up" : dy > 0 ? "down" : dx < 0 ? "left" : "right"));
            dpad.appendChild(b);
        };
        padBtn("u", "▲", 0, -1);
        padBtn("l", "◀", -1, 0);
        padBtn("r", "▶", 1, 0);
        padBtn("dn", "▼", 0, 1);
        pad.appendChild(dpad);
        pad.appendChild(el("div", "gm-keys", "arrows / WASD walk · enter acts · esc leaves · 1-4 answer a trial"));
        var ab = el("div", "gm-ab");
        ab.appendChild(btn("B<b>back</b>", function () { if (scene === "map") {
            if (dlg)
                closeDialog();
        }
        else if (scene === "battle" && battle) {
            if (battle.mode !== "menu") {
                battle.mode = "menu";
                paintBattle();
            }
        }
        else if (scene === "town")
            leaveToMap(); }));
        ab.appendChild(btn("A<b>act</b>", function () { if (scene === "map") {
            stage.focus();
            act();
        }
        else {
            var f = screen.querySelector("button:focus, a:focus") || screen.querySelector(".gm-menu button, .gm-opt, .gm-acts button");
            if (f)
                f.click();
        } }));
        pad.appendChild(ab);
        host.appendChild(pad);
        readPalette();
        fitCanvas();
        // the theme's listener is wired once for the page (theme.js has no way to let
        // one go) and does nothing while the quest is unmounted
        if (window.CNPE_THEME && !themeWired) {
            themeWired = true;
            window.CNPE_THEME.onChange(function () {
                if (!host)
                    return;
                readPalette();
                requestDraw();
                // a live battle repaints so the monster takes the new palette; a finished
                // one keeps its result card; the terminal and its half-typed command stay
                if (scene === "battle" && battle && !battle.over) {
                    if (bt)
                        bt.scId = "";
                    paintBattle();
                }
                // a town's menus follow the stylesheet on their own; only the scenery is painted, and focus stays where it was
                if (scene === "town" && town && tn) {
                    var sc = tn.right.querySelector(".gm-scene");
                    if (sc)
                        paintBackdrop(sc, +town.sec.split(".")[0]);
                }
            });
        }
        // fonts arrive after first paint, and the town labels are text
        if (document.fonts && document.fonts.ready)
            document.fonts.ready.then(function () { requestDraw(); });
        // the screen: a resize or a zoom changes how many device pixels an art pixel gets
        listen(window, "resize", fitCanvas);
        listen(document, "visibilitychange", syncAnim);
        if (typeof ResizeObserver !== "undefined") {
            var obs = sizeObs = new ResizeObserver(function () { fitCanvas(); });
            obs.observe(stage);
            undo.push(function () { obs.disconnect(); if (sizeObs === obs)
                sizeObs = null; });
        }
        if (motionQuery) {
            var mq = motionQuery;
            var onMotion = function () { reduceMotion = mq.matches; walkFrame = 0; if (reduceMotion) {
                settleStep();
            } syncAnim(); requestDraw(); };
            if (mq.addEventListener) {
                mq.addEventListener("change", onMotion);
                undo.push(function () { mq.removeEventListener("change", onMotion); });
            }
            else if (mq.addListener) {
                mq.addListener(onMotion);
                undo.push(function () { mq.removeListener(onMotion); });
            }
        }
    }
    function intro() {
        if (has("flags", "intro"))
            return;
        say("A note pinned to the signpost", [
            "Five regions, one per exam domain, and a town for every section. All roads are open; the dungeons are not.",
            "In a town, talk to people: they teach the theory and hand you commands. Pass the town's trial and its dungeon opens. Inside is a fault, and you fight it with real commands.",
            "You start with <code>kubectl get</code>, <code>describe</code>, <code>events</code> and <code>logs</code>, and two hint scrolls. The rest you learn in the towns. Walk with the arrows or WASD; enter acts."
        ]);
        // The starter kit is written when the note is put down, which is the first
        // action: opening the page writes nothing, as reading the console never has.
        dlg.done = function () {
            if (!tick("flags", "intro"))
                return;
            STARTER_TECH.forEach(function (id) { tick("learned", id); });
            Object.keys(STARTER_ITEMS).forEach(function (id) { giveItem(id, STARTER_ITEMS[id]); });
            save();
        };
    }
    window.CNPE_GAME = {
        mount: function () {
            var mountEl = document.getElementById("game-app");
            if (!mountEl)
                return;
            if (mountEl.getAttribute("data-built")) {
                paintTiles();
                return;
            } // another tab moved the store: repaint the tiles
            mountEl.setAttribute("data-built", "1");
            host = mountEl;
            if (!D || !SIM || !ART || !window.CNPE_PROGRESS || !D.map.length) {
                host.innerHTML = '<div class="wnote bad">The quest did not load; assets/game-data.js, assets/game-sim.js or assets/game-art.js is missing.</div>';
                return;
            }
            scene = "map";
            town = null;
            trial = null;
            battle = null;
            dlg = null;
            bt = null;
            tn = null;
            fx = null;
            walk = null;
            queued = null;
            walked = false;
            lastLabel = "";
            mounts++;
            buildRegions();
            build();
            hp = maxHp();
            loadPos();
            keys();
            paintTiles();
            paintHud();
            setScene("map");
            frame(); // the first frame now, not on the next tick: the page opens painted
            intro();
        },
        /** take the quest down: the animation frame, the beat, every timer, observer
            and listener the mount added, and the terrain and minimap caches. The
            bundle calls this before it replaces the page on a hash route; the host
            is left as a plain element the next mount() can build into again. */
        unmount: function () {
            if (!host)
                return;
            savePos(true); // a step taken is worth writing before the page goes
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = 0;
            }
            if (animTimer) {
                clearTimeout(animTimer);
                animTimer = 0;
            }
            timers.forEach(function (id) { clearTimeout(id); });
            timers = [];
            undo.forEach(function (fn) { fn(); });
            undo = [];
            settleStep();
            terrain = null;
            miniBase = null;
            mini = null;
            terrainStale = true;
            terrainSig = "";
            dlg = null;
            battle = null;
            trial = null;
            town = null;
            bt = null;
            tn = null;
            fx = null;
            host.removeAttribute("data-built");
            host.classList.remove("gm");
            host.innerHTML = "";
            host = null;
            scene = "map";
            animFrame = 0;
            walkFrame = 0;
            waterInView = 1;
            ambientInView = 0;
            dirty = true;
        },
        /** what the renderer is doing, for the browser checks and profiling */
        debug: function () {
            var off = stepOffset(stepProgress(performance.now()));
            return { frames: stats.frames, drawMs: stats.drawMs, terrainRenders: stats.terrainRenders, terrainMs: stats.terrainMs,
                terrain: terrain ? { w: terrain.width, h: terrain.height } : null,
                terrainPatches: stats.terrainPatches, tilesRepainted: stats.tilesRepainted, patchMs: stats.patchMs,
                minimap: mini ? { w: mini.width, h: mini.height } : null, minimapBuilds: stats.minimapBuilds,
                scale: scale, dpr: dprSeen,
                anim: !!animTimer, reduceMotion: reduceMotion, waterFrame: animFrame, walkFrame: walkFrame, face: player.face,
                x: player.x, y: player.y, walking: !!walk, offset: off, queued: !!queued,
                waterInView: waterInView, ambientInView: ambientInView,
                mounted: !!host, mounts: mounts, listeners: undo.length,
                frame: function () { if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = 0;
                } dirty = true; draw(); } };
        }
    };
    window.CNPE_GAME.mount();
})();
