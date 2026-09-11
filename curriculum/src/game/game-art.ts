/* CNPE Quest: original, palette-indexed pixel art. Sprites are small character
   grids; scenery is composed from stepped silhouettes, tiled materials and
   hand-built architecture. No imported artwork. The pigment ramps retain
   their material colours while the console palette changes their lighting.

   The grids are ASCII only: tools/subset-fonts.py counts every character in
   assets/*.js as one the fonts must carry, and these must not add a glyph.

   game.js asks for tiles by name and state, keeps the canvases this returns,
   and calls theme() when the palette changes, which drops the cache. The water,
   the flowers, a town's chimney smoke and the torches on an open door each have
   FRAMES frames, stepped together on one beat. Nothing below touches the DOM
   until a sprite is asked for, so node can load it to check the grids (see
   tools/browser-checks/game.js, which does the same in the browser). */
(function () {
  "use strict";

  var TILE = 16;
  var FRAMES = 3;                                    // frames of the water, and of everything else that moves on its beat

  /* ── colour ─────────────────────────────────────────────── */
  type RGBA = [number, number, number, number];
  function parse(c: string): RGBA {
    c = String(c || "").trim();
    var m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map(function (x) { return x + x; }).join("");
      var n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(c);
    if (m) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(function (x) { return x.indexOf("%") >= 0 ? parseFloat(x) * 2.55 : parseFloat(x); });
      return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? (m[1].indexOf("%") > 0 && /\/\s*[\d.]+%/.test(m[1]) ? p[3] / 2.55 : p[3]) : 1];
    }
    return [136, 136, 136, 1];
  }
  function css(c: RGBA) { return c[3] >= 1 ? "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")" : "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (+c[3].toFixed(3)) + ")"; }
  /** a mixed into b by t, as css */
  function mix(a: string, b: string, t: number) {
    var x = parse(a), y = parse(b);
    return css([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, x[3] + (y[3] - x[3]) * t]);
  }
  function alpha(a: string, t: number) { var x = parse(a); return css([x[0], x[1], x[2], t]); }
  function lum(c: string) { var x = parse(c); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; }

  /* ── the palette, and the colour sets built from it ─────── */
  var P: CnpeGamePalette | null = null;
  var bright = "#fff", dark = "#000";              // whichever of ink and paper is the lighter, per theme
  var gen = 0;                                       // bumps on theme(); part of every cache key
  var cache: Record<string, HTMLCanvasElement> = {};
  /** lighter in both themes: toward the palette's brighter end */
  function lighten(c: string, t: number) { return mix(c, bright, t); }
  function darken(c: string, t: number) { return mix(c, dark, t); }
  /** Art pigments, rather than UI surface colours: daylight and twilight share
      the same materials. A little theme colour keeps custom palettes alive. */
  function pigment(day: string, night: string, tint: string) {
    return mix(lum(P!.ink) > lum(P!.paper) ? day : night, tint, 0.12);
  }
  function outline() { return pigment("#25334e", "#141d39", P!.sunk); }

  type Slots = Record<string, string>;
  /** each region tints its ground a little: five domains, five landscapes */
  function tintOf(d: number): { c: string; t: number } {
    var p = P!;
    switch (d) {
      case 2: return { c: p.accentDim, t: 0.22 };   // Reconcile Reach: cool blue
      case 3: return { c: p.viol, t: 0.2 };         // Compositor Heights: violet stone
      case 4: return { c: p.warnDim, t: 0.22 };     // Signal Fens: marsh olive
      case 5: return { c: p.bad, t: 0.16 };         // Warden's March: rust
      default: return { c: p.ok, t: 0.08 };         // Substrate Downs: plain meadow
    }
  }
  var groundCache: Record<string, Slots> = {};
  function ground(d: number): Slots {
    var key = gen + ":" + d;
    if (groundCache[key]) return groundCache[key];
    var p = P!, tint = tintOf(d);
    var g = mix(pigment("#699b57", "#356b54", p.ok), tint.c, tint.t * 0.65);
    var r = mix(pigment("#c5a277", "#9b805f", p.warnDim), tint.c, tint.t * 0.25);
    var s = mix(pigment("#dcc18a", "#b69967", p.warn), tint.c, tint.t * 0.25);
    var l = mix(pigment("#3a8050", "#246747", p.ok), tint.c, tint.t * 0.5);
    var slots: Slots = {
      g: g, G: mix(g, "#b6c977", 0.34), h: mix(g, "#204b48", 0.25), j: mix(g, "#416848", 0.16),
      f: pigment("#f0ce72", "#e9ba67", p.warn), e: pigment("#dc8598", "#d77591", p.bad), F: "#fff0c4", L: mix(l, "#c1d179", 0.55),
      r: r, R: mix(r, "#f0d6a1", 0.34), q: mix(r, "#554c47", 0.38),
      s: s, S: mix(s, "#ffe4ae", 0.4), n: mix(s, "#916e58", 0.32),
      t: pigment("#926346", "#785039", p.warnDim), T: pigment("#c59559", "#b18151", p.warn),
      k: outline(), l: l, m: mix(l, "#9abf65", 0.52), o: mix(l, "#173d3c", 0.65),
      x: alpha(outline(), 0.3)
    };
    groundCache[key] = slots;
    return slots;
  }
  function waterSlots(): Slots {
    var p = P!, w = pigment("#398fa3", "#235a82", p.info);
    return { w: w, W: mix(w, "#7ccee0", 0.55), v: mix(w, "#253d66", 0.4), o: pigment("#d0edcd", "#9fd6c6", p.okLit), O: mix(w, "#75bfb6", 0.7), u: mix(w, "#3d9aaa", 0.4) };
  }
  function cliffSlots(d: number): Slots {
    var p = P!, tint = tintOf(d), c = mix(pigment("#97919b", "#777b8f", p.rule2), tint.c, tint.t * 0.5);
    return { c: c, C: mix(c, "#e0ceb2", 0.5), b: mix(c, "#b4acae", 0.3), k: mix(c, "#4b536c", 0.55), K: mix(c, "#263a52", 0.72), g: ground(d).g };
  }
  function stoneSlots(): Slots {
    var p = P!, c = pigment("#9ca6a9", "#788499", p.rule2);
    return {
      p: pigment("#e4c79c", "#c2ae90", p.paper2), P: pigment("#c3a582", "#94877a", p.paper3),
      k: pigment("#5e4950", "#403946", p.sunk),
      b: pigment("#a94f53", "#873f57", p.bad), B: pigment("#d97b65", "#bd635f", p.badLit), r: pigment("#713f50", "#58334d", p.bad),
      y: pigment("#ffdc80", "#ffd17c", p.warn), Y: "#fff2b4",
      c: c, C: mix(c, "#e4dcc2", 0.48), K: mix(c, "#35405c", 0.65),
      v: pigment("#8464ad", "#7856a5", p.viol), V: pigment("#c3a4e0", "#b791d4", p.viol),
      a: pigment("#387f88", "#376c83", p.info), A: pigment("#92c9b2", "#75b7a3", p.okLit),
      x: alpha(outline(), 0.3), w: "#f5e7c4"
    };
  }

  /* ── the grids ──────────────────────────────────────────── */
  /** a grid is one string per row, one character per pixel; "." is transparent */
  type Grid = string[];
  function rot(g: Grid): Grid {                       // a quarter turn clockwise
    var h = g.length, w = g[0].length, out: string[] = [];
    for (var y = 0; y < w; y++) { var row = ""; for (var x = 0; x < h; x++) row += g[h - 1 - x][y]; out.push(row); }
    return out;
  }
  function flip(g: Grid): Grid { return g.map(function (r) { return r.split("").reverse().join(""); }); }
  /** an edge band padded out to a whole tile, so that a turn of it lands on the far side rather than back at the origin */
  function pad(g: Grid): Grid {
    var out: string[] = [];
    for (var y = 0; y < TILE; y++) { var row = g[y] || ""; while (row.length < TILE) row += "."; out.push(row.slice(0, TILE)); }
    return out;
  }
  /** an edge band padded to a tile and its three turns, N E S W: the same four
      grids every time, so they are turned once per band rather than per sprite */
  var turned = new Map<Grid, Grid[]>();
  function rots4(g: Grid): Grid[] {
    var hit = turned.get(g);
    if (hit) return hit;
    var sq = pad(g), dirs = [sq, rot(sq), rot(rot(sq)), rot(rot(rot(sq)))];
    turned.set(g, dirs);
    return dirs;
  }
  function own(o: object, k: string) { return Object.prototype.hasOwnProperty.call(o, k); }

  var GRASS: Grid[] = [
    ["jj....jjj.......", "j...G..jj.......", "...GGG......hh..", "....h......h.h..", ".G.........hh...", "GGG....jj.......", ".h....jGjj......", ".....jGGGj......",
     "...hh.jhj.......", "...h.......G....", "..........GGG...", ".G.....jj..h....", "GGG...jjjj......", ".h.....jj.......", "....G.......hh..", "...GGG.......h.."],
    ["......jj....jj..", "....G..j......G.", "...G.G.......GGG", "....h........h..", "jj......hh......", "jjj......h.G....", ".j........GGG...", "....G......h....",
     "...GGG..jj......", "....h..jjjj.....", ".......jjj..G...", "..hh.......GGG..", "...h.........h..", "......G.........", ".....GGG..jjj...", "......h....jj..."],
    ["..jjj......hh...", "...jj..G....h...", "......GGG.......", ".......h....jj..", "..G........jjjj.", ".GGG....G....jj.", "..h....GGG......", "........h..G....",
     ".jj.......GGG...", "jjjj.G......h...", ".jj.GGG.........", ".....h...hh.....", "..........h..jj.", ".G..........jjj.", "GGG...G......j..", ".h...GGG........"],
    ["......hh....jjj.", "..G....h.....jj.", ".GGG......G.....", "..h......GGG....", ".....jj...h.....", "....jjjj.....G..", ".....jj.....GGG.", "..hh.........h..",
     "...h...G........", "......GGG...jj..", ".G.....h...jjjj.", "GGG.........jj..", ".h...hh.........", "......h..G......", "..jj....GGG.....", ".jjjj....h......"]
  ];
  var FLOWER: Grid[] = [
    ["................", "................", "...........f....", "..........fFf...", "...........f....", "................", "................", "....e...........",
     "...eFe..........", "....e...........", "....L...........", "................", "................", "...........f....", "..........fFf...", "...........f...."],
    ["................", "....e...........", "...eFe..........", "....e...........", "...........L....", "..........f.....", ".........fFf....", "..........f.....",
     "................", "................", "................", ".....f..........", "....fFf.........", ".....f..........", ".....L..........", "................"]
  ];
  /* the flowers sway: for each variant, the heads leaning right, then left; the grid above is the frame at rest */
  var FLOWER_SWAY: Grid[][] = [
    [
      ["................", "................", "............f...", "...........fFf..", "...........f....", "................", "................", ".....e..........",
       "....eFe.........", "....e...........", "....L...........", "................", "................", "............f...", "...........fFf..", "...........f...."],
      ["................", "................", "..........f.....", ".........fFf....", "...........f....", "................", "................", "...e............",
       "..eFe...........", "....e...........", "....L...........", "................", "................", "..........f.....", ".........fFf....", "...........f...."]
    ],
    [
      ["................", ".....e..........", "....eFe.........", "....e...........", "...........L....", "...........f....", "..........fFf...", "..........f.....",
       "................", "................", "................", "......f.........", ".....fFf........", ".....f..........", ".....L..........", "................"],
      ["................", "...e............", "..eFe...........", "....e...........", "...........L....", ".........f......", "........fFf.....", "..........f.....",
       "................", "................", "................", "....f...........", "...fFf..........", ".....f..........", ".....L..........", "................"]
    ]
  ];
  /* a puff of smoke over a town's chimney (the roof's stack, columns 11 and 12), rising and thinning over three frames */
  var PUFF: Grid[] = [
    ["................", "................", "...........mm...", "................", "................", "................", "................", "................",
     "................", "................", "................", "................", "................", "................", "................", "................"],
    ["................", "...........Mm...", "..........mMMm..", "................", "................", "................", "................", "................",
     "................", "................", "................", "................", "................", "................", "................", "................"],
    ["............Mm..", "...........mM...", "............m...", "................", "................", "................", "................", "................",
     "................", "................", "................", "................", "................", "................", "................", "................"]
  ];
  /* torches on an open door's posts: a flame over each pillar, leaning and guttering over three frames */
  var TORCH: Grid[] = [
    ["...f........f...", "..fF........Ff..", "................", "................", "................", "................", "................", "................",
     "................", "................", "................", "................", "................", "................", "................", "................"],
    ["..f..........f..", "..Ff........fF..", "................", "................", "................", "................", "................", "................",
     "................", "................", "................", "................", "................", "................", "................", "................"],
    ["................", "..fF........Ff..", "................", "................", "................", "................", "................", "................",
     "................", "................", "................", "................", "................", "................", "................", "................"]
  ];
  var ROAD: Grid[] = [
    ["....RRR.........", "...R...q...RR...", ".......q..R..q..", "....qqq......q..", "...........qq...", ".RRR............", "R...q....RRRR...", "....q...R....q..",
     ".qqq.........q..", ".........qqqq...", ".....RR.........", "....R..q.....RR.", ".......q....R..q", ".....qq.........", "..R..........qq.", "...q............"],
    [".....RRRR.......", "....R....q..RR..", ".........q.R..q.", ".....qqqq.....q.", "..RR........qq..", ".R..q...........", "....q....RRR....", "..qq....R...q...",
     "............q...", "....RR...qqq....", "...R..q.........", "......q....RRRR.", "....qq....R....q", ".R.............q", "..q........qqqq.", "................"]
  ];
  var ROAD_EDGE: Grid = ["qqqqqqqqqqqqqqqq", ".q...q..q..q...."];   // the north edge; the others are turns of it
  var SAND: Grid[] = [
    [".......SSSS.....", "...SSSS....S....", "..S.........nn..", "....nnnn........", "................", "..........SSSS..", "......SSSS......", ".....S....nnn...",
     "........nn......", "..SS............", "SS..SSSS........", "........S.......", "..nnnn..........", "............SSSS", ".......SSSSS....", ".........nnnn..."],
    ["....SSSS........", "..SS....SS......", "..........S.....", ".....nnnn.......", ".............SSS", ".........SSSS...", "........S.......", "..........nnn...",
     "...SSSS.........", "SSS....SS.......", ".........S......", "...nnnn.........", "...........SS...", ".......SSSS..SS.", "......S.........", ".........nnnn..."]
  ];
  /* three frames of open water; the wave lines drift right one pixel a frame */
  var WATER: Grid[] = [
    ["uu......uuuu....", "..uuu..uu.......", "...WWW..........", "..W...W...vvv...", "....vv..........", ".........uWWWWu.", "uu........uvvu..", "..uuu...........",
     "........uuuuu...", ".WWW...uu.......", "W...W...........", "..vv.......vv...", ".......uuu......", "......uWWWWu....", "........vvv.....", "..uuuu.........."],
    [".uu......uuuu...", "...uuu..uu......", "....WWW.........", "...W...W...vvv..", ".....vv.........", "..........uWWWWu", ".uu........uvvu.", "...uuu..........",
     ".........uuuuu..", "..WWW...uu......", ".W...W..........", "...vv.......vv..", "........uuu.....", ".......uWWWWu...", ".........vvv....", "...uuuu........."],
    ["..uu......uuuu..", "....uuu..uu.....", ".....WWW........", "....W...W...vvv.", "......vv........", "u..........uWWWW", "..uu........uvvu", "....uuu.........",
     "..........uuuuu.", "...WWW...uu.....", "..W...W.........", "....vv.......vv.", ".........uuu....", "........uWWWWu..", "..........vvv...", "....uuuu........"]
  ];
  /* the shoreline: land to the north; foam dashes step along a pixel a frame */
  var SHORE: Grid[] = [
    ["oooooooooooooooo", "OO.OOO.OO.OOO.OO", "..O.........O..."],
    ["oooooooooooooooo", "OOO.OO.OOO.OO.OO", "...O.........O.."],
    ["oooooooooooooooo", ".OOO.OO.OOO.OO.O", "O...O.........O."]
  ];
  var SHORE_CORNER: Grid = ["oo..............", "oO..............", "................"];   // land to the north-west only
  var CLIFF: Grid[] = [
    ["ccccCCCCccccccbb", "ccCCbbbbCCcccbbk", "cCbbbbbbccCccbkK", "CbbbbbccccccckKk", "bbcccccccccckKkc", "cccckkkkkkkkKkcc", "ccckKccccccccccc", "cckKcCCCCcccccCC",
     "ckKcCbbbbCCcCCbb", "ckkcbbbbcccCbbbk", "ccccbbcccccccbbk", "cccccccccccccckK", "cckkkkkkccccckKk", "ckKccccckkkkkKkc", "ckcCCCCccccccccc", "cccbbbbbCCCCcccc"],
    ["ccccccCCCCcccccc", "cccCCCbbbbCCCccc", "ccCbbbbbbbcccCcc", "cCbbbccccccccckK", "kKcccccckkkkkkKk", "ckKkkkkkKccccccc", "cckkkkkKcCCCCccc", "cccccckcCbbbbCCc",
     "cCCCCCccbbbbbccc", "CbbbbbCcccccccck", "bbbbbccccccccckK", "cccccckkkkkkkkKk", "cckkkKccccccckkc", "ckKkkccCCccccccc", "ckkcccCbbCCCCCcc", "cccccbbbbbbbbbCc"]
  ];
  var CLIFF_N: Grid = ["CCCCCCCCCCCCCCCC", "CCCCCCCCCCCCCCCC", ".C.C.C.C.C.C.C.C"];   // the rim, lit
  var CLIFF_S: Grid = ["................", "................", "................", "................", "................", "................", "................", "................",
    "................", "................", "................", "................", "K.K.K.K.K.K.K.K.", "KKKKKKKKKKKKKKKK", "KKKKKKKKKKKKKKKK", "kkkkkkkkkkkkkkkk"];   // the foot, in shadow
  var CLIFF_W: Grid = ["K...............", "K...............", "K...............", "KK..............", "K...............", "K...............", "KK..............", "K...............",
    "K...............", "KK..............", "K...............", "K...............", "K...............", "KK..............", "K...............", "K..............."];
  var TREE: Grid[] = [
    ["......ooo.......", "....oolmloo.....", "...olmmmlmloo...", "..olmmLmlmlllo..", ".olmmllollmlllo.", ".olmlolmmllollo.", "oollolmmLmloloo.", "olmlolmmllollloo",
     ".oolllolllollloo", "..oolllollllooo.", "...ooootooooo...", "......tTtk......", "......tTtk......", ".....ttTttk.....", "...xxxxxxxxxx...", "................"],
    [".......o........", "......omo.......", ".....olmlo......", "....olLmllo.....", "...oolmloloo....", "....olmmllo.....", "...olLmllloo....", "..olmmllollloo..",
     "...ollmllloo....", "..olmmllollloo..", ".oollloollllloo.", "..oooooTtooooo..", "......tTtk......", ".....ttTttk.....", "....xxxxxxxxx...", "................"]
  ];
  /* a bridge crossing east-west: planks between two rails, over the water */
  var BRIDGE: Grid = ["................", "kkkkkkkkkkkkkkkk", "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt", "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt",
    "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt", "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt", "kkkkkkkkkkkkkkkk", "................"];

  /* ── landmarks ──────────────────────────────────────────── */
  var TOWN: Grid = ["................", "................", "......bb........", ".....bbbb..bb...", "....bbbbbbbbbb..", "...bbbbbbbbbbbb.", "..bbbbbbbbbbbbbb", "..pppppppppppppp",
    "..ppyppkkpppyppp", "..ppyppkkpppyppp", "..pppppkkppppppp", "..pppppkkppppppp", "..pppppkkppppppp", ".xxxxxxxxxxxxxxx", "................", "................"];
  var DOOR_SEALED: Grid = ["................", "....CCCCCCCC....", "...CccccccccC...", "..CccKKKKKKccC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", "..CcKCCCCCCKcC..", "..CcKKKKKKKKcC..",
    "..CcKKKKKKKKcC..", "..CcKCCCCCCKcC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", ".xxxxxxxxxxxxxx.", "................", "................"];
  var DOOR_OPEN: Grid = ["................", "....CCCCCCCC....", "...CccccccccC...", "..CccvvvvvvccC..", "..CcvvVVVVvvcC..", "..CcvVVVVVVvcC..", "..CcvVVVVVVvcC..", "..CcvVVVVVVvcC..",
    "..CcvVVVVVVvcC..", "..CcvVVVVVVvcC..", "..CcvvVVVVvvcC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", ".xxxxxxxxxxxxxx.", "................", "................"];
  /* five keeps, one silhouette a region; "F" is the flag, red until the keep falls, green after */
  var KEEPS: Grid[] = [
    /* Substrate Downs: a squat round tower on the downs */
    ["......F.........", "......FFF.......", "......F.........", "....C.C.C.C.....", "....CCCCCCC.....", "....cccCccc.....", "....cccCccc.....", "...ccccccccc....",
     "...ccKccccKcc...", "...ccccccccc....", "...ccccKKccccc..", "...ccccKKccccc..", "...ccccKKccccc..", ".xxxxxxxxxxxxxx.", "................", "................"],
    /* Reconcile Reach: twin towers and a wall between */
    [".F.........F....", ".FF........FF...", ".F.........F....", "CCC.......CCC...", "cKc.......cKc...", "ccc.......ccc...", "ccc.......ccc...", "cccCCCCCCCccc...",
     "cccccccccccccc..", "ccKccKKKccKccc..", "ccccccKccccccc..", "ccccccKccccccc..", "ccccccKccccccc..", ".xxxxxxxxxxxxxx.", "................", "................"],
    /* Compositor Heights: a tall spire of stacked stone */
    [".......F........", ".......FF.......", ".......F........", "......CCC.......", "......cKc.......", ".....CCCCC......", ".....ccKcc......", "....CCCCCCC.....",
     "....cccKccc.....", "...CCCCCCCCC....", "...cccKKKccc....", "...cccKKKccc....", "...cccKKKccc....", ".xxxxxxxxxxxxxx.", "................", "................"],
    /* Signal Fens: a low wide fort on stilts over the marsh */
    ["................", "..F.............", "..FF............", "..F.............", ".CCCCCCCCCCCCC..", ".cccccccccccccc.", ".cKccKcccKccKcc.", ".cccccccccccccc.",
     ".ccccccKKcccccc.", ".ccccccKKcccccc.", "..kk..kkkk..kk..", "..kk..kkkk..kk..", "..kk..kkkk..kk..", ".xxxxxxxxxxxxxx.", "................", "................"],
    /* Warden's March: a fortress with battlements and a portcullis */
    [".......F........", ".......FF.......", ".......F........", ".C.CC.CCCC.CC.C.", ".CCCCCCCCCCCCCC.", ".cccccccccccccc.", ".ccKccccccccKcc.", ".cccccKKKKccccc.",
     ".ccccKKKKKKcccc.", ".ccccKCKCKKcccc.", ".ccccKKKKKKcccc.", ".ccccKCKCKKcccc.", ".ccccKKKKKKcccc.", ".xxxxxxxxxxxxxx.", "................", "................"]
  ];
  /* the Exam gate: a violet arch; "a" is the bars while it is shut, the light beyond once open */
  var GATE: Grid = ["....vvvvvvvv....", "...vVVVVVVVVv...", "..vVvvvvvvvvVv..", ".vVvaaaaaaaavVv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.",
    ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", "xxxxxxxxxxxxxxxx", "................", "................"];
  var GATE_BARS: Grid = ["................", "................", "................", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....",
    ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", "................", "................", "................"];

  /* ── the player: four facings, four frames each ──────────
     Frame 0 stands, and is what the hero lands on. Frames 1 and 2 are the two
     halves of a stride: one leg forward with the near arm swung back, then the
     other. Frame 3 is the pass between them: the legs swinging past each other
     under the body, which rides a pixel higher, over the stride's wide shadow
     so the ground does not flicker mid-step. game.js keys them to a step's
     five sub-positions as 1, 1, 3, 2, 2, so a tile is one full stride and a
     walk reads as left, pass, right, stand rather than the same hop. */
  var HERO: Record<string, Grid[]> = {
    d: [
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSSSH....", "....HSeSSeSH....", ".....SSSSSS.....", "......SSSS......",
       "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.S...", ".....tttttt.....", ".....BB..BB.....", ".....BB..BB.....", ".....xxxxxx....."],
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSSSH....", "....HSeSSeSH....", ".....SSSSSS.....", "......SSSS......",
       "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.....", ".....tttttt.....", "....BB....BB....", "....BB..........", "....xxxxxxxx...."],
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSSSH....", "....HSeSSeSH....", ".....SSSSSS.....", "......SSSS......",
       "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", ".....TTTTTT.S...", ".....tttttt.....", "....BB....BB....", "..........BB....", "....xxxxxxxx...."],
      [".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSSSH....", "....HSeSSeSH....", ".....SSSSSS.....", "......SSSS......", "....TTTTTTTT....",
       "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.S...", ".....tttttt.....", ".....BB.BB......", ".....BB.BB......", "......B.B.......", "....xxxxxxxx...."]
    ],
    u: [
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHSSSSHH....", ".....SSSSSS.....", "......SSSS......",
       "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.S...", ".....tttttt.....", ".....BB..BB.....", ".....BB..BB.....", ".....xxxxxx....."],
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHSSSSHH....", ".....SSSSSS.....", "......SSSS......",
       "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.....", ".....tttttt.....", "....BB....BB....", "....BB..........", "....xxxxxxxx...."],
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHSSSSHH....", ".....SSSSSS.....", "......SSSS......",
       "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", ".....TTTTTT.S...", ".....tttttt.....", "....BB....BB....", "..........BB....", "....xxxxxxxx...."],
      [".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHSSSSHH....", ".....SSSSSS.....", "......SSSS......", "....TTTTTTTT....",
       "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.S...", ".....tttttt.....", ".....BB.BB......", ".....BB.BB......", "......B.B.......", "....xxxxxxxx...."]
    ],
    l: [
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSHHH....", "....HeSSSHHH....", ".....SSSSSH.....", "......SSSS......",
       ".....TTTTTTT....", "....TTTTTTTTT...", "....STTTTTTTT...", "....S.TTTTTT....", ".....tttttt.....", ".....BBB.BB.....", ".....BBB.BB.....", ".....xxxxxx....."],
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSHHH....", "....HeSSSHHH....", ".....SSSSSH.....", "......SSSS......",
       ".....TTTTTTT....", "....TTTTTTTTT...", "...S.TTTTTTTT...", "...S..TTTTTT....", ".....tttttt.....", "....BB...BBB....", "....BB...BBB....", "....xxxxxxxx...."],
      ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSHHH....", "....HeSSSHHH....", ".....SSSSSH.....", "......SSSS......",
       ".....TTTTTTT....", "....TTTTTTTTT...", ".....TTTTTTTTS..", "......TTTTTT.S..", ".....tttttt.....", "....BBB...BB....", "....BBB...BB....", "....xxxxxxxx...."],
      [".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSHHH....", "....HeSSSHHH....", ".....SSSSSH.....", "......SSSS......", ".....TTTTTTT....",
       "....TTTTTTTTT...", "....STTTTTTTT...", "....S.TTTTTT....", ".....tttttt.....", "......BBBB......", "......BBBB......", "......BBBB......", "....xxxxxxxx...."]
    ]
  };
  /* Auburn hair, a gold clasp and a violet travelling mantle over teal cloth.
     Material shading is baked into the grids once, not into walking frames. */
  Object.keys(HERO).forEach(function (face) {
    HERO[face] = HERO[face].map(function (g, frame) {
      var lift = frame === 3 ? 1 : 0;
      return g.map(function (row, y) {
        return row.split("").map(function (ch, x) {
          var yy = y + lift;
          if (ch === "H") return yy === 2 && x > 4 && x < 10 ? "J" : x > 9 || yy === 5 ? "h" : "H";
          if (ch === "S") return yy === 7 || x > 9 ? "q" : yy === 4 && x < 8 ? "F" : "S";
          if (ch === "T") {
            if (yy === 8) return x === 7 || x === 8 ? "G" : "P";
            if (x < 5 || x > 10) return yy < 10 ? "V" : "P";
            if (face === "u") return x < 8 ? "V" : "P";
            return x < 7 ? "C" : x > 9 ? "c" : "T";
          }
          if (ch === "t") return x === 7 || x === 8 ? "G" : "t";
          if (ch === "B") return yy === 13 ? "b" : "B";
          return ch;
        }).join("");
      });
    });
  });
  HERO.r = HERO.l.map(flip);
  var HERO_FRAMES = 4;                               // standing, the two halves of a stride, the pass between them
  /** skin and hair that read in both themes: the warm colours pulled toward the light and the dark end */
  function skin() { return pigment("#f3cba0", "#e8b491", P!.warn); }
  function hair() { return pigment("#965742", "#814436", P!.warnDim); }
  function heroSlots(): Slots {
    var p = P!;
    return {
      H: hair(), J: pigment("#d59358", "#bd794a", p.warn), h: pigment("#603740", "#4d2b38", p.bad),
      S: skin(), q: pigment("#cb937b", "#ba816e", p.warnDim), F: "#ffe1b5", e: outline(),
      T: pigment("#3b9ba1", "#2c8a97", p.info), C: pigment("#8ccebd", "#78c3b6", p.okLit), c: pigment("#286778", "#24546b", p.info),
      P: pigment("#685688", "#51466f", p.viol), V: pigment("#9d83b3", "#826ba3", p.viol),
      G: pigment("#f8d275", "#edbf69", p.warn), t: pigment("#765840", "#614731", p.warnDim),
      b: pigment("#716078", "#514663", p.rule2), B: outline(), x: alpha(outline(), 0.35)
    };
  }
  function folk(coat: string): Slots {
    return {
      k: hair(), K: mix(hair(), "#e4ab72", 0.4), e: outline(), p: skin(), q: mix(skin(), "#a65e64", 0.35),
      a: coat, A: mix(coat, "#ede0b7", 0.35), b: mix(coat, "#27354e", 0.5), y: pigment("#f7d78b", "#eac274", P!.warn),
      x: alpha(outline(), 0.35)
    };
  }

  /* ── the enemies: one shape per fault family, 32 by 32 ───── */
  /* b the body, dark; d the outline, darker; l the family colour as a highlight;
     e the glow of an eye; p the black inside a maw or a socket; a metal, smoke or
     chain; w a fang or a bone; s the shadow on the ground */
  var ENEMIES: Record<string, Grid> = {
    workload: [
      "................................", "..........a.....a...............", ".........a.a...a.a..............", "........a...a.a...a.............",
      "......dddddddddddddddddd........", ".....dbbbbbbbbbbbbbbbbbbd.......", "....dbbbbbbbbbbbbbbbbbbbbd......", "....dbbllbbbbbbbbbbbbllbbd......",
      "....dbblbbbbbbbbbbbbbblbbd......", "....dbbbbbbbbddddbbbbbbbbd......", "....dbbbbbbddppppddbbbbbbd......", "....dbbbbddppppppppddbbbbd......",
      "....dbbbdpeeppppppeepdbbbd......", "....dbbbdpeeppppppeepdbbbd......", "....dbbbbdppppppppppdbbbbd......", "....dbbbbbdpwpwwpwpdbbbbbd......",
      "....dbbbbbbddwwwwddbbbbbbd......", "....dbbbbbbbbddddbbbbbbbbd......", "....dbbbbbbbbbbbbbbbbbbbbd......", "....dbblbbbbbbbbbbbbbblbbd......",
      "....dbbllbbbbbbbbbbbbllbbd......", ".....dbbbbbbbbbbbbbbbbbbd.......", "......dddbbbbbbbbbbbbddd........", ".....dbbd..dbbbbbbd..dbbd.......",
      "....dbbbd..dbbbbbbd..dbbbd......", "....dbdbd..dbdbbdbd..dbdbd......", "....dd.dd..dd.dd.dd..dd.dd......", "................................",
      "......ssssssssssssssssssss......", "................................", "................................", "................................"
    ],
    networking: [
      "................................", "....dd..............dd..........", "...dbbd............dbbd.........", "..dbeebd..........dbeebd........",
      "..dbppbd....dd....dbppbd........", "..dbbbbd...dbbd...dbbbbd........", "..dbwbwd..dbeebd..dwbwbd........", "...dbbd...dbppbd...dbbd.........",
      "...dbbd...dbbbbd...dbbd.........", "...dbbd...dwbbwd...dbbd.........", "....dbbd..dbbbbd..dbbd..........", ".....dbbd.dbbbbd.dbbd...........",
      "......dbbddbbbbddbbd............", ".......dbbbbbbbbbbd.............", "......dbbbbbbbbbbbbd............", ".....dbbbbdbbbbdbbbbd...........",
      "....dbbbbdbbbbbbdbbbbd..........", "....dbbbdbbbbbbbbdbbbd..........", "....dbbbbdbbbbbbdbbbbd..........", "....dbbbbbdbbbbdbbbbbd..........",
      ".....dbbbbbbbbbbbbbbd...........", "......dbbbbbbbbbbbbd............", ".....dbbbdbbbbbbdbbbd...........", "....dbbd..dbbbbd..dbbd..........",
      "...dbbd....dbbd....dbbd.........", "..dbbd.....dbbd.....dbbd........", ".dbld......dlld......dlbd.......", ".dld........dd........dld.......",
      "..d....................d........", "......ssssssssssssssssss........", "................................", "................................"
    ],
    storage: [
      "................................", "...dddddddddddddddddddddddd.....", "..dbbbbbbbbbbbbbbbbbbbbbbbbd....", "..dbllbbbbbbbbbbbbbbbbbbllbd....",
      "..dbbbbbbbbbbbbbbbbbbbbbbbbd....", "..dbbbbbbbbbbbbbbbbbbbbbbbbd....", "..dddddddddddddddddddddddddd....", "..dwdddwdddwdddwdddwdddwdddd....",
      "..dwwdpwwdpwwdpwwdpwwdpwwdpd....", "..dppppppppppppppppppppppppd....", "..dpppppppppppppppppppppppp.....", "..dppppppppppeeeepppppppppd.....",
      "..dpppppppppeeeeeeppppppppd.....", "..dppppppppppeeeepppppppppd.....", "..dppppppppppppppppppppppppd....", "..dpdpwwdpwwdpwwdpwwdpwwdpwd....",
      "..dwwdddwwddwwwddwwwddwwwdwd....", "..dddddddddddddddddddddddddd....", "..dbbbbbbbbbbbbbbbbbbbbbbbbd....", "..dbbbaabbbbbbbbbbbbbbbaabbd....",
      "..dbbabbabbbbbbbbbbbbbabbabd....", "..dbbabbabbbbbbbbbbbbbabbabd....", "..dbbbaabbbbbbbbbbbbbbbaabbd....", "..dbbbbbbbbbbbbbbbbbbbbbbbbd....",
      "..dddddddddddddddddddddddddd....", "...dbbd..............dbbd.......", "...dbdd..............ddbd.......", "...dd..................dd.......",
      "................................", ".....ssssssssssssssssssssss.....", "................................", "................................"
    ],
    gitops: [
      "................................", "..............dddd..............", "............ddbbbbdd............", "...........dbbbbbbbbd...........",
      "..........dbbbbbbbbbbd..........", "..........dbbbbbbbbbbd..........", ".........dbbbbbbbbbbbbd.........", ".........dbbbbbbbbbbbbd.........",
      ".........dbbbeebbbeebbd.........", ".........dbbbeebbbeebbd.........", ".........dbbbbbbbbbbbbd.........", "..........dbbbbbbbbbbd..........",
      "..........dbbbbbbbbbbd..........", ".......dddbbbbbbbbbbbbddd.......", "......dbbbbbbbbbbbbbbbbbbd......", ".....dbbbbbbbblbbbbbbbbbbbd.....",
      ".....dbbbbbbblblbbbbbbbbbbd.....", "....dbbbbbbbblbbbbbbbbbbbbbd....", "....dbbbbbbbblblbbbbbbbbbbbd....", "....dbbbbbbbbblbbbbbbbbbbbbd....",
      "....dbbbbbbbbblblbbbbbbbbbbd....", "....dbbbbbbbbbblbbbbbbbbbbbd....", ".....dbbbbbbbbbbbbbbbbbbbbd.....", ".....dbbbbbbbbbbbbbbbbbbbbd.....",
      "......dbbbbbbbbbbbbbbbbbbd......", "......dbbdbbbdbbbbdbbbdbbd......", "......dbd.dbd.dbbd.dbd.dbd......", "......dd...dd..dd...dd..dd......",
      "................................", "................................", "................................", "................................"
    ],
    ci: [
      "................................", "........dddddddddddddddd........", ".......dbbbbbbbbbbbbbbbbd.......", ".......dbbaabbbbbbbbaabbd.......",
      ".......dbbaabbbbbbbbaabbd.......", ".......dbbbbbbbbbbbbbbbbd.......", ".......dbbbeeebbbbeeebbbd.......", ".......dbbbeeebbbbeeebbbd.......",
      ".......dbbbbbbbbbbbbbbbbd.......", ".......dbbddddddddddddbbd.......", ".......dbbdwpwpwpwpwpdbbd.......", ".......dbbdppppppppppdbbd.......",
      ".......dbbdpwpwpwpwpwdbbd.......", ".......dbbddddddddddddbbd.......", "....ddddbbbbbbbbbbbbbbbbdddd....", "...dbbbbbbbbbbbbbbbbbbbbbbbbd...",
      "..dbaabbbbbbbbbbbbbbbbbbbbaabd..", "..dbaabbbbbbbaaaaaabbbbbbbaabd..", "..dbaabbbbbbaappppaabbbbbbaabd..", "..dbaabbbbbbapeeeepabbbbbbaabd..",
      "..dbaabbbbbbapeeeepabbbbbbaabd..", "..dbaabbbbbbaappppaabbbbbbaabd..", "..dbaabbbbbbbaaaaaabbbbbbbaabd..", "..dbaabbbbbbbbbbbbbbbbbbbbaabd..",
      "..dbaabbbbbbbbbbbbbbbbbbbbaabd..", "..dbaadbbbbbbbbbbbbbbbbbbdaabd..", "..dddd.dbbbbbbd..dbbbbbbd.dddd..", ".......dbbbbbbd..dbbbbbbd.......",
      ".......dddddddd..dddddddd.......", "......ssssssssssssssssssss......", "................................", "................................"
    ],
    crossplane: [
      "................................", ".........ddddddddddddd..........", ".........dbbbbbbbbbbbd..........", ".........dbbbbbbbbbbbd..........",
      ".........dbbeebbbbeebd..........", ".........dbbeebbbbeebd..........", ".........dbbbbbbbbbbbd..........", ".........ddddddddddddd..........",
      "....dddddddddd...dddddddddd.....", "....dbbbbbbbbd...dbbbbbbbbd.....", "....dbbbbbbbbd...dbbbbbbbbd.....", "....dbbllbbbbd...dbbbbllbbd.....",
      "....dbbbbbbbbd...dbbbbbbbbd.....", "....dbbbbbbbbd...dbbbbbbbbd.....", "....dddddddddd...dddddddddd.....", "....dddddddddddddddddddddddd....",
      "....dbbbbbbbbdbbbbbbbbbbbbbd....", "....dbbbbbbbbdbbaaaaaaabbbbd....", "....dbbllbbbbdbbaeeeeeabbbbd....", "....dbbbbbbbbdbbaeeeeeabbbbd....",
      "....dbbbbbbbbdbbaaaaaaabbbbd....", "....dbbbbbbbbdbbbbbbbbbbbbbd....", "....dddddddddddddddddddddddd....", "....dddddddddd..................",
      "....dbbbbbbbbd...ddddddddddd....", "....dbbbbbbbbd...dbbbbbbbbbd....", "....dbbllbbbbd...dbbbbllbbbd....", "....dbbbbbbbbd...dbbbbbbbbbd....",
      "....dddddddddd...ddddddddddd....", "......ssssssssssssssssssss......", "................................", "................................"
    ],
    observability: [
      "................................", "..............d..d..............", ".............dd..dd.............", "........d...dbd..dbd...d........",
      ".......dd..dbbd..dbbd..dd.......", "......dbdddbbbbddbbbbdddbd......", ".....dbbbbbbbbbbbbbbbbbbbbd.....", "....dbbbbbbbbbbbbbbbbbbbbbbd....",
      "...dbbbbbbbbbbbbbbbbbbbbbbbbd...", "...dbbbbbbbbbbbbbbbbbbbbbbbbd...", "..dbbbbbbbbbbbbbbbbbbbbbbbbbbd..", "..dbbaaaaaaaaaaaaaaaaaaaaaabbd..",
      "..dbaaaaaaaaaaaaaaaaaaaaaaaabd..", "..dbaaaaaaaaaaaaaaaaaaaaaaaabd..", "..dbaaaaaaapppppppppaaaaaaaabd..", "..dbaaaaappppeeeepppppaaaaaabd..",
      "..dbaaaaappeeeeeeeeppaaaaaaabd..", "..dbaaaaappppeeeepppppaaaaaabd..", "..dbaaaaaaapppppppppaaaaaaaabd..", "..dbaaaaaaaaaaaaaaaaaaaaaaaabd..",
      "..dbbaaaaaaaaaaaaaaaaaaaaaabbd..", "...dbbbbbbbbbbbbbbbbbbbbbbbbd...", "...dbbbbbbbbbbbbbbbbbbbbbbbbd...", "....dbbbbbbbbbbbbbbbbbbbbbbd....",
      ".....dbbbbbbbbbbbbbbbbbbbbd.....", "......dbbdbbbdbbbbdbbbdbbd......", ".......dd.dbd.dbbd.dbd.dd.......", "..........dd..dbbd..dd..........",
      "..............dbbd..............", "...............dd...............", "................................", "................................"
    ],
    security: [
      "................................", ".....dd..................dd.....", "....dbbd................dbbd....", "....dbbbd..............dbbbd....",
      ".....dbbbd....dddd....dbbbd.....", "......dbbbdddbbbbbbdddbbbd......", ".......dbbbbbbbbbbbbbbbbd.......", "........dbbbbbbbbbbbbbbd........",
      "........dbbbbbbbbbbbbbbd........", "........dbbddddddddddbbd........", "........dbbdeeeeeeeedbbd........", "........dbbddddddddddbbd........",
      "........dbbbbbbbbbbbbbbd........", "........dbbbbbbbbbbbbbbd........", "....dddddbbbbbbbbbbbbbbddddd....", "...dbbbbbbbbbbbbbbbbbbbbbbbbd...",
      "..dbaabbbbbbbbbbbbbbbbbbbbaabd..", "..dbaabbbbbbbbbbbbbbbbbbbbaabd..", "..dbaabbbbbbbddddddbbbbbbbaabd..", "..dbaabbbbbbdbbbbbbdbbbbbbaabd..",
      "..dbaabbbbbbdbbllbbdbbbbbbaabd..", "..dbaabbbbbbdbblllbdbbbbbbaabd..", "..dbaabbbbbbdbbbllbdbbbbbbaabd..", "..dbaabbbbbbdbbbbbbdbbbbbbaabd..",
      "..dbaabbbbbbbddddddbbbbbbbaabd..", "..dbaabbbbbbbbbbbbbbbbbbbbaabd..", "...dbbbbbbbbbbbbbbbbbbbbbbbbd...", "....dbbbbbbbbbbbbbbbbbbbbbbd....",
      ".....dbbbbbbdd....ddbbbbbbd.....", "......dddddd........dddddd......", "......ssssssssssssssssssss......", "................................"
    ]
  };
  /* Directional facets and family-specific materials on the original silhouettes:
     scales, wood grain, spectral folds and engraved armour, rather than flat fill. */
  Object.keys(ENEMIES).forEach(function (family) {
    var g = ENEMIES[family];
    ENEMIES[family] = g.map(function (row, y) {
      return row.split("").map(function (ch, x) {
        if (ch === "e") return (g[y - 1] || "")[x] !== "e" && x % 3 !== 0 ? "E" : "e";
        if (ch === "a") return (x + y) % 5 === 0 ? "A" : "a";
        if (ch !== "b") return ch;
        var left = row[x - 1], above = (g[y - 1] || "")[x];
        if ((left === "d" || above === "d") && x < 21 && y < 25) return "m";
        if (x > 21 || y > 24) return (x + y) % 4 === 0 ? "b" : "h";
        if (family === "storage") return y % 5 === 0 ? "h" : y % 5 === 1 && x % 7 !== 0 ? "m" : "b";
        if (family === "networking") return y % 3 === 0 && (x + (y % 2)) % 3 === 0 ? "l" : (x + y) % 4 === 0 ? "h" : "b";
        if (family === "gitops") return (x + Math.floor(y / 4)) % 5 < 2 ? "m" : x % 4 === 0 ? "h" : "b";
        if (family === "observability") return (x * 3 + y * 5) % 11 < 3 ? "m" : (x + y) % 5 === 0 ? "h" : "b";
        return y % 6 === 0 ? "h" : y % 6 === 1 || (x % 8 === 0 && y % 3 === 0) ? "m" : "b";
      }).join("");
    });
  });
  var FAMILIES = Object.keys(ENEMIES);
  /** a family's colour is its highlight; the body is that colour pulled far toward the dark, the eyes burn */
  function enemySlots(family: string): Slots {
    var p = P!;
    var hues: Record<string, string[]> = {
      workload: ["#bb6470", "#944b64"], networking: ["#469e99", "#32847f"],
      storage: ["#b58959", "#92643f"], gitops: ["#a88bcb", "#8265b1"],
      ci: ["#c99d5d", "#ab7b49"], crossplane: ["#68a8ba", "#4b87a5"],
      observability: ["#ba738c", "#984f7b"], security: ["#8d93aa", "#676e90"]
    };
    var ramp = hues[family] || hues.workload, hue = pigment(ramp[0], ramp[1], p.viol);
    var eye = family === "gitops" || family === "networking" ? "#84eed7" : family === "security" ? "#ff886f" : "#ffd77b";
    var metal = pigment("#c2ad84", "#a68c71", p.warnDim);
    return {
      b: hue, h: mix(hue, "#29334c", 0.4), m: mix(hue, "#e8d7b1", 0.32), l: mix(hue, "#e8e6c5", 0.55),
      d: outline(), e: eye, E: "#fff4ce", p: pigment("#302b45", "#201c35", p.sunk),
      a: metal, A: "#ead2a1", w: pigment("#f1dec2", "#d9c4ad", p.paper3), s: alpha(outline(), 0.35)
    };
  }
  /** the fault family a scenario belongs to, by its id; the sprite and its colour follow */
  function familyOf(id: string, domain: number): string {
    if (/^(image|probe|resources|quota|config|hpa-unknown)$/.test(id)) return "workload";
    if (/^(argocd|flux|canary)/.test(id)) return "gitops";
    if (/^(tekton|image-unsigned)/.test(id)) return "ci";
    if (/^(xp-|xr-)/.test(id)) return "crossplane";
    if (/^(servicemonitor|alert|otel)/.test(id)) return "observability";
    if (/^(rbac|kyverno|pss|eso)/.test(id)) return "security";
    if (/^(svc|netpol|dns|ingress)/.test(id)) return "networking";
    if (/^(pvc|storage|volume)/.test(id)) return "storage";
    if (domain === 3) return "crossplane";
    if (domain === 4) return "observability";
    if (domain === 5) return "security";
    return "workload";
  }

  /* ── props for the town backdrops ───────────────────────── */
  var HOUSE: Grid = ["................", ".......bb.......", "......bbbb......", ".....bbbbbb.....", "....bbbbbbbb....", "...bbbbbbbbbb...", "..bbbbbbbbbbbb..", ".pppppppppppppp.",
    ".ppyyppppppyypp.", ".ppyyppkkppyypp.", ".ppppppkkpppppp.", ".ppppppkkpppppp.", ".ppppppkkpppppp.", ".ppppppkkpppppp.", "xxxxxxxxxxxxxxxx", "................"];
  var INN: Grid = ["................", "....bbbbbbbbbb..", "...bbbbbbbbbbbb.", "..bbbbbbbbbbbbbb", ".ppppppppppppppp", ".ppyyppyyppyyppp", ".ppyyppyyppyyppp", ".ppppppppppppppp",
    ".pppppppppppyyyp", ".ppyyppkkpppyayp", ".ppyyppkkpppyyyp", ".ppppppkkppppppp", ".ppppppkkppppppp", ".ppppppkkppppppp", "xxxxxxxxxxxxxxxx", "................"];
  var SHOP: Grid = ["................", "................", "................", ".aAaAaAaAaAaAaA.", ".AaAaAaAaAaAaAa.", ".ppppppppppppppp", ".ppppppppppppppp", ".ppyyyyyyyppkkpp",
    ".ppyyyyyyyppkkpp", ".ppyyyyyyyppkkpp", ".ppyyyyyyyppkkpp", ".ppyyyyyyyppkkpp", ".ppppppppppkkppp", ".ppppppppppkkppp", "xxxxxxxxxxxxxxxx", "................"];
  var WELL: Grid = ["................", "......kkkk......", ".....kbbbbk.....", "....kbbbbbbk....", "....k......k....", "....k......k....", "....k..kk..k....", "....k......k....",
    "....CCCCCCCC....", "....cCccccCc....", "....ccKKKKcc....", "....ccKKKKcc....", "....cCccccCc....", "....CCCCCCCC....", "...xxxxxxxxxx...", "................"];
  var BED: Grid = ["................", "................", "................", ".kk.............", ".kk.............", ".kkwwwwwwwwwwwk.", ".kkwwwwwaaaaaak.", ".kkkkkkkkkkkkkk.",
    ".kkppppppppppkk.", ".kkppppppppppkk.", ".kkkkkkkkkkkkkk.", ".kk..........kk.", ".kk..........kk.", "................", "xxxxxxxxxxxxxxxx", "................"];
  var COUNTER: Grid = ["................", "................", "................", "..yy....aa......", "..yy....aa..vv..", "..yy.ww.aa..vv..", ".kkkkkkkkkkkkkk.", ".kppppppppppppk.",
    ".kppppppppppppk.", ".kkkkkkkkkkkkkk.", ".kp...........k.", ".kp...........k.", ".kp...........k.", "................", "xxxxxxxxxxxxxxxx", "................"];
  var VILLAGER: Grid = ["................", "......kkkk......", ".....kKKKkk.....", ".....kppppk.....", ".....kpepek.....", "......pppq......", ".......qq.......", ".....bAyyab.....",
    "....bAAaaabb....", "....pAAaaaap....", "....p.Aaab.q....", "......byyb......", "......babb......", "......bb.bb.....", "......ee.ee.....", ".....xxxxxxx...."];
  var LANTERN: Grid = ["................", ".......kk.......", "......kkkk......", "......kyyk......", "......kyyk......", "......kkkk......", ".......k........", ".......k........",
    ".......k........", ".......k........", ".......k........", ".......k........", ".......k........", "......kkk.......", "......xxx.......", "................"];
  var PROPS: Record<string, Grid> = { house: HOUSE, inn: INN, shop: SHOP, well: WELL, bed: BED, counter: COUNTER, villager: VILLAGER, lantern: LANTERN };
  [TOWN, HOUSE, INN, SHOP, WELL, BED, COUNTER].forEach(function (g) {
    g.forEach(function (row, y) {
      g[y] = row.split("").map(function (ch, x) {
        if (ch === "b") return row[x + 1] !== "b" ? "r" : y % 2 === 0 && x % 3 !== 0 ? "B" : "b";
        if (ch === "p") return x % 6 === 1 || y === 7 ? "k" : y % 4 === 0 ? "P" : "p";
        if (ch === "y") return x % 2 === 0 ? "Y" : "y";
        return ch;
      }).join("");
    });
  });

  /* ── the painter ────────────────────────────────────────── */
  function canvas(w: number, h: number) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function k2d(c: HTMLCanvasElement) { var k = c.getContext("2d")!; k.imageSmoothingEnabled = false; return k; }
  /** draw a grid at (x, y), each cell s pixels; runs of one colour are one fillRect */
  function stamp(k: CanvasRenderingContext2D, g: Grid, slots: Slots, x: number, y: number, s?: number) {
    s = s || 1;
    for (var r = 0; r < g.length; r++) {
      var row = g[r], c = 0;
      while (c < row.length) {
        var ch = row[c];
        if (ch === "." || !slots[ch]) { c++; continue; }
        var e = c + 1;
        while (e < row.length && row[e] === ch) e++;
        k.fillStyle = slots[ch];
        k.fillRect(x + c * s, y + r * s, (e - c) * s, s);
        c = e;
      }
    }
  }
  function cached(key: string, build: (k: CanvasRenderingContext2D, c: HTMLCanvasElement) => void, w?: number, h?: number) {
    key = gen + "|" + key;
    var c = cache[key];
    if (c) return c;
    c = canvas(w || TILE, h || TILE);
    build(k2d(c), c);
    cache[key] = c;
    return c;
  }
  function fill(k: CanvasRenderingContext2D, c: string) { k.fillStyle = c; k.fillRect(0, 0, TILE, TILE); }

  /** N=1 E=2 S=4 W=8: the sides whose neighbour is a different kind of ground; g is the north band */
  function edges4(k: CanvasRenderingContext2D, g: Grid, slots: Slots, mask: number) {
    var dirs = rots4(g);
    for (var i = 0; i < 4; i++) if (mask & (1 << i)) stamp(k, dirs[i], slots, 0, 0);
  }

  /* Towns use individual source pixels at 480px wide: complete buildings and
     their street fit above the dialogue windows. Battles and interiors keep
     their own two-pixel scale rather than enlarging a short town banner.
     All texture, lighting and silhouettes are drawn only on a cache miss.
     Rectangles are snapped here so there are no antialiased vector edges. */
  function block(k: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    k.fillStyle = c;
    k.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
  }
  function noise(n: number) { return ((Math.imul(n + 17, 374761393) ^ Math.imul(n + 41, 668265263)) >>> 0) % 997 / 997; }
  function sceneColours(d: number): Slots {
    var p = P!, g = ground(d), tint = tintOf(d);
    return {
      sky: pigment(d === 5 ? "#797cb2" : "#659ec5", d === 5 ? "#38375e" : "#293d70", p.info),
      horizon: pigment(d === 5 ? "#efbea0" : "#c1ded1", d === 5 ? "#bd7c8c" : "#83aaa9", p.okLit),
      cloud: pigment("#edf0dc", "#a6b7cc", p.paper3), cloudShade: pigment("#b7cdd0", "#738cae", p.info),
      sun: pigment("#fff0b2", "#f0d2a0", p.warn),
      far: mix(pigment("#95afbd", "#657799", p.info), tint.c, 0.1),
      peak: mix(pigment("#798da6", "#515f89", p.viol), tint.c, 0.12),
      ridge: mix(pigment("#b0b7bd", "#7e8aaa", p.rule2), tint.c, 0.06),
      forest: pigment("#507f80", "#325c69", p.ok), forestLit: pigment("#6a9890", "#4a7a7b", p.okLit),
      grass: g.g, grassLit: g.G, grassShade: g.h, leaf: g.l, leafLit: g.m, leafDark: g.o, bark: g.t, barkLit: g.T,
      road: g.r, roadLit: g.R, roadShade: g.q,
      water: waterSlots().w, foam: waterSlots().W,
      ink: outline(), stone: stoneSlots().c, stoneLit: stoneSlots().C, stoneShade: stoneSlots().K
    };
  }
  function sky(k: CanvasRenderingContext2D, w: number, h: number, c: Slots, d: number) {
    var bands = 9, bandH = Math.ceil(h / bands), last = c.sky;
    for (var i = 0; i < bands; i++) {
      var col = mix(c.sky, c.horizon, i / (bands - 1)), y = i * bandH;
      block(k, col, 0, y, w, bandH);
      if (i) for (var x = i % 2; x < w; x += 4) {
        block(k, last, x, y, 2, 1); block(k, last, x + 2, y + 1, 1, 1);
      }
      last = col;
    }
    var sx = Math.floor(w * 0.77), sy = Math.max(4, Math.floor(h * 0.13));
    block(k, c.sun, sx + 3, sy, 8, 2); block(k, c.sun, sx + 1, sy + 2, 12, 2);
    block(k, c.sun, sx, sy + 4, 14, 6); block(k, c.sun, sx + 2, sy + 10, 10, 2);
    for (var n = -1; n < w / 68 + 1; n++) {
      var cx = n * 68 + Math.floor(noise(n + d * 19) * 19), cy = 7 + Math.floor(noise(n + 40) * Math.max(3, h * 0.35));
      block(k, c.cloudShade, cx, cy + 6, 42, 3);
      block(k, c.cloud, cx + 4, cy + 3, 30, 4); block(k, c.cloud, cx + 12, cy, 14, 4);
      block(k, c.cloud, cx - 5, cy + 7, 20, 1); block(k, c.cloudShade, cx + 26, cy + 9, 25, 1);
    }
  }
  function mountains(k: CanvasRenderingContext2D, w: number, baseline: number, height: number, c: Slots, d: number, far: boolean) {
    var span = far ? 57 : 73, offset = far ? 27 : 8;
    for (var x = 0; x < w; x += 2) {
      var at = x + offset, index = Math.floor(at / span), phase = (at % span) / span;
      var rise = height * (0.62 + noise(index + d * 31) * 0.38), slope = phase < 0.42 ? phase / 0.42 : (1 - phase) / 0.58;
      var top = Math.floor((baseline - rise * slope) / 2) * 2;
      block(k, far ? c.far : c.peak, x, top, 2, baseline - top + 2);
      if (!far && phase < 0.42) block(k, c.ridge, x, top, 2, Math.max(1, rise * slope * 0.32));
      if (!far && d === 3 && slope > 0.72) block(k, c.cloud, x, top, 2, 1 + (slope - 0.72) * 18);
    }
  }
  function scenicTree(k: CanvasRenderingContext2D, x: number, y: number, size: number, c: Slots, pine: boolean, distant: boolean) {
    var leaf = distant ? c.forest : c.leaf, light = distant ? c.forestLit : c.leafLit, shade = distant ? c.forest : c.leafDark;
    block(k, distant ? c.forest : c.bark, x - 1, y - size * 0.55, 3, size * 0.55);
    if (!distant) block(k, c.barkLit, x - 1, y - size * 0.43, 1, size * 0.43);
    if (pine) {
      for (var tier = 0; tier < 3; tier++) {
        var top = y - size + tier * size * 0.19, half = size * (0.16 + tier * 0.055);
        for (var r = 0; r < size * 0.4; r += 2) {
          var width = Math.max(1, r / (size * 0.4) * half);
          block(k, shade, x - width, top + r, width * 2 + 2, 2);
          block(k, leaf, x - width, top + r, width + 2, 2);
          if (r % 4 === 0) block(k, light, x - width + 1, top + r, Math.max(1, width * 0.65), 1);
        }
      }
    } else {
      var crown = size * 0.66, left = x - crown * 0.57, topY = y - size;
      block(k, shade, left + 2, topY + 4, crown, crown - 4);
      block(k, shade, left - 1, topY + 9, crown + 6, crown - 14);
      block(k, leaf, left + 2, topY + 4, crown - 3, crown - 7);
      block(k, leaf, left + 6, topY, crown - 10, crown);
      for (var j = 0; j < 8; j++) {
        var xx = left + 3 + noise(j + Math.floor(x)) * (crown - 7), yy = topY + 3 + noise(j + 64) * (crown - 8);
        block(k, j < 5 ? light : shade, xx, yy, 3 + j % 3, 2);
        if (!distant && j < 3) block(k, light, xx + 1, yy - 1, 2, 1);
      }
    }
  }
  function outdoor(k: CanvasRenderingContext2D, w: number, h: number, d: number, c: Slots) {
    var horizon = Math.floor(h * 0.65);
    sky(k, w, horizon + 3, c, d);
    mountains(k, w, horizon - 8, h * 0.37, c, d, true);
    mountains(k, w, horizon - 2, h * 0.39, c, d, false);
    block(k, c.forest, 0, horizon - 3, w, 6);
    for (var x = -5; x < w + 15; x += 11) scenicTree(k, x, horizon + 3, 11 + noise(x + d) * 13, c, true, true);
    block(k, c.grass, 0, horizon + 2, w, h - horizon);
    block(k, c.grassLit, 0, horizon + 3, w, 1);
    for (var row = horizon + 6; row < h; row += 4) {
      for (x = -8; x < w; x += 13) {
        var xx = x + Math.floor(noise(row + x) * 11), len = 2 + Math.floor(noise(x * row) * 5);
        block(k, row % 8 === 0 ? c.grassShade : c.grassLit, xx, row, len, 1);
      }
    }
    if (d === 2 || d === 4) {
      var waterY = horizon + 4;
      block(k, c.water, 0, waterY, w, d === 2 ? 8 : 5);
      for (x = 0; x < w; x += 11) {
        block(k, c.foam, x, waterY + (x % 3) * 2, 6, 1);
        if (d === 4) { block(k, c.grass, x + 3, waterY + 3, 6, 2); block(k, c.leafDark, x + 4, waterY - 2, 1, 4); }
      }
    }
    return horizon;
  }
  function windowPane(k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: Slots) {
    block(k, s.k, x - 1, y - 1, w + 2, h + 2);
    block(k, s.y, x, y, w, h); block(k, s.Y, x, y, 1, h - 1);
    block(k, s.k, x + Math.floor(w / 2), y, 1, h); block(k, s.k, x, y + Math.floor(h / 2), w, 1);
    block(k, s.C, x - 2, y + h + 1, w + 4, 1);
  }
  /** Roof-heavy footprints, dormers and a shaded return establish the village's
      elevated camera; these are multi-tile buildings rather than banner icons. */
  function building(k: CanvasRenderingContext2D, x: number, top: number, w: number, h: number, kind: number, s: Slots) {
    var roof = Math.floor(h * 0.57), wall = top + roof, base = top + h, door = Math.floor(x + w * 0.5) - 4;
    var tile = kind === 1 ? s.v : kind === 2 ? s.a : s.b, tileLit = kind === 1 ? s.V : kind === 2 ? s.A : s.B;
    var tileShade = mix(tile, outline(), 0.46);
    block(k, s.x, x + 4, top + 9, w + 3, h - 5);
    block(k, s.k, x + 2, wall - 2, w - 1, h - roof + 3);
    block(k, s.p, x + 3, wall, w - 7, h - roof - 2); block(k, s.P, x + w - 10, wall, 6, h - roof - 2);
    for (var y = wall + 2; y < base - 2; y += 5) {
      block(k, s.P, x + 3, y, w - 7, 1);
      for (var brick = x + 4; brick < x + w - 5; brick += 9) block(k, s.C, brick + (y % 2) * 3, y + 2, 3, 1);
    }
    for (var post = x + 3; post < x + w - 4; post += Math.max(7, Math.floor((w - 7) / 4))) {
      block(k, s.k, post, wall, 2, h - roof - 1); block(k, s.r, post, wall + 2, 1, h - roof - 5);
    }
    block(k, s.k, x + 3, base - 6, w - 7, 2);
    block(k, s.K, x + 1, base - 2, w + 1, 4); block(k, s.C, x + 2, base - 2, w - 1, 1);
    for (var stone = x + 4; stone < x + w; stone += 6) block(k, s.c, stone, base, 4, 1);
    block(k, s.k, x + 2, top + 2, w - 3, roof);
    for (var r = 0; r < roof; r++) {
      var inset = r < 5 ? 5 - r : 0;
      block(k, r % 4 === 3 ? tileShade : tile, x + inset, top + r, w - inset - 4, 1);
      if (r % 4 === 0) {
        for (var tx = x + inset + 1 - (Math.floor(r / 4) % 2) * 3; tx < x + w - 5; tx += 6) {
          block(k, tileLit, Math.max(x + inset, tx), top + r, Math.min(4, x + w - 5 - tx), 1);
          block(k, tileShade, tx + 4, top + r + 1, 1, 2);
        }
      }
      block(k, tileShade, x + w - 5, top + r, Math.min(5, 1 + r), 1);
      if (r % 4 === 0) block(k, tile, x + w - 3, top + r, 2, 1);
    }
    block(k, s.k, x - 1, wall, w + 3, 3); block(k, tileLit, x - 1, wall, w - 2, 1);
    block(k, tileShade, x + 4, top - 1, w - 7, 2); block(k, tileLit, x + 5, top - 1, w - 9, 1);
    for (var peg = x + 3; peg < x + w - 3; peg += 5) block(k, s.p, peg, wall + 2, 1, 1);
    var chimney = x + w - 13;
    block(k, s.K, chimney, top - 6, 6, 13); block(k, s.c, chimney, top - 6, 4, 12);
    block(k, s.C, chimney - 1, top - 6, 8, 2); block(k, s.k, chimney + 1, top - 6, 4, 1);
    for (y = top - 3; y < top + 5; y += 3) block(k, s.K, chimney + 2, y, 3, 1);
    block(k, alpha(s.w, 0.36), chimney + 1, top - 10, 4, 2); block(k, alpha(s.w, 0.22), chimney + 3, top - 14, 5, 2);
    var dormer = x + w * 0.42 - 5, dormerY = top + Math.max(4, roof * 0.32);
    block(k, tileShade, dormer - 2, dormerY + 5, 16, 10); block(k, s.p, dormer, dormerY + 3, 11, 9);
    for (r = 0; r < 6; r++) block(k, r % 2 ? tileShade : tileLit, dormer + 5 - r, dormerY + r, 1 + r * 2, 1);
    windowPane(k, dormer + 3, dormerY + 7, 5, 4, s);
    windowPane(k, x + 7, wall + 6, 6, 7, s); windowPane(k, x + w - 15, wall + 6, 6, 7, s);
    block(k, s.a, x + 5, wall + 6, 2, 7); block(k, s.a, x + w - 9, wall + 6, 2, 7);
    block(k, s.k, door - 1, base - 14, 10, 14); block(k, s.r, door, base - 12, 8, 12);
    block(k, s.B, door + 1, base - 11, 1, 10); block(k, s.k, door + 4, base - 12, 1, 12);
    block(k, s.y, door + 6, base - 6, 1, 2); block(k, s.C, door - 2, base + 2, 13, 2); block(k, s.K, door - 3, base + 4, 15, 1);
    if (kind === 1) {
      block(k, s.k, x + w - 1, wall + 5, 9, 1); block(k, s.k, x + w + 5, wall + 5, 1, 4);
      block(k, s.y, x + w + 1, wall + 8, 9, 8); block(k, tileShade, x + w + 2, wall + 9, 7, 6);
      block(k, s.Y, x + w + 3, wall + 11, 5, 1); block(k, s.Y, x + w + 3, wall + 10, 1, 4); block(k, s.Y, x + w + 6, wall + 12, 2, 2);
    } else if (kind === 2) {
      for (var aw = 0; aw < w - 4; aw += 4) {
        block(k, aw % 8 === 0 ? s.b : s.w, x + 2 + aw, wall + 4, 4, 5);
        block(k, aw % 8 === 0 ? s.B : s.P, x + 2 + aw, wall + 9, 4, 2);
      }
      block(k, s.k, x + 3, wall + 10, 1, h - roof - 8); block(k, s.k, x + w - 3, wall + 10, 1, h - roof - 8);
    }
  }
  function paving(k: CanvasRenderingContext2D, w: number, top: number, h: number, c: Slots) {
    block(k, c.roadShade, 0, top, w, h);
    for (var y = top + 1, row = 0; y < top + h; y += 4, row++) {
      for (var x = -(row % 2) * 7; x < w; x += 14) {
        block(k, c.road, x, y, 13, 3); block(k, c.roadLit, x + 1, y, 10, 1);
      }
    }
  }
  function ruin(k: CanvasRenderingContext2D, x: number, y: number, height: number, c: Slots, arch: boolean) {
    var pillars = arch ? 2 : 1;
    for (var i = 0; i < pillars; i++) {
      var xx = x + i * 22, top = y - height + (i ? 3 : 0);
      block(k, c.ink, xx - 1, top, 9, y - top);
      block(k, c.stone, xx, top, 6, y - top); block(k, c.stoneLit, xx, top, 2, y - top);
      for (var r = top + 4; r < y; r += 5) block(k, c.stoneShade, xx + 2, r, 5, 1);
      block(k, c.stone, xx - 2, y - 2, 11, 3);
      block(k, c.leaf, xx + 4, y - 9, 3, 9); block(k, c.leafLit, xx + 6, y - 6, 2, 2);
    }
    if (arch) {
      block(k, c.stoneShade, x - 2, y - height - 2, 33, 6);
      block(k, c.stone, x, y - height - 5, 24, 5);
      block(k, c.stoneLit, x + 2, y - height - 6, 19, 1);
      block(k, c.peak, x + 11, y - height - 5, 2, 3);
    } else {
      block(k, c.stoneLit, x - 1, y - height, 4, 2); block(k, c.stone, x + 3, y - height + 1, 5, 3);
    }
  }
  function pavedArea(k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: Slots) {
    block(k, c.roadShade, x - 1, y - 1, w + 2, h + 2);
    k.save(); k.beginPath(); k.rect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h)); k.clip();
    k.translate(Math.floor(x), Math.floor(y)); paving(k, w, 0, h, c); k.restore();
  }
  function garden(k: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: Slots, s: Slots) {
    block(k, c.leafDark, x, y, w, h); block(k, c.bark, x + 1, y + 1, w - 2, h - 2);
    for (var row = y + 3; row < y + h - 2; row += 5) {
      block(k, c.roadShade, x + 2, row + 2, w - 4, 1);
      for (var at = x + 3; at < x + w - 3; at += 5) {
        block(k, c.leaf, at - 1, row, 4, 3); block(k, c.leafLit, at, row - 1, 2, 3);
        block(k, (at + row) % 3 === 0 ? s.y : s.B, at, row - 1, 2, 1);
      }
    }
    block(k, c.barkLit, x, y + h - 2, w, 1);
    for (at = x; at <= x + w; at += 7) {
      block(k, c.bark, at, y + h - 5, 2, 7); block(k, c.barkLit, at, y + h - 5, 1, 5);
    }
  }
  function barrel(k: CanvasRenderingContext2D, x: number, y: number, s: Slots) {
    block(k, s.x, x + 1, y + 8, 9, 3); block(k, s.k, x, y + 1, 8, 8);
    block(k, s.r, x + 1, y, 6, 10); block(k, s.B, x + 2, y + 1, 2, 7);
    block(k, s.p, x + 1, y, 6, 2); block(k, s.k, x + 2, y + 1, 4, 1);
    block(k, s.K, x, y + 3, 8, 1); block(k, s.c, x, y + 7, 8, 1);
  }
  function fountain(k: CanvasRenderingContext2D, x: number, y: number, c: Slots, s: Slots) {
    block(k, s.x, x - 11, y + 5, 25, 8);
    block(k, s.K, x - 12, y - 2, 24, 11); block(k, s.c, x - 10, y - 5, 20, 16);
    block(k, s.C, x - 9, y - 5, 18, 2); block(k, s.C, x - 12, y - 2, 2, 7);
    block(k, c.water, x - 9, y - 2, 18, 9); block(k, c.water, x - 6, y - 3, 12, 11);
    block(k, c.foam, x - 8, y, 5, 1); block(k, c.foam, x + 2, y + 5, 5, 1);
    block(k, s.C, x - 9, y + 8, 18, 1); block(k, s.K, x - 10, y + 10, 20, 1);
    block(k, s.K, x - 3, y - 6, 6, 12); block(k, s.C, x - 2, y - 6, 4, 10);
    block(k, s.y, x - 4, y - 9, 8, 3); block(k, s.Y, x - 2, y - 12, 4, 4);
    block(k, c.foam, x - 5, y - 4, 1, 6); block(k, c.foam, x + 5, y - 4, 1, 7);
  }
  function townScene(k: CanvasRenderingContext2D, w: number, h: number, d: number, talk: boolean) {
    var c = sceneColours(d), s = stoneSlots(), full = h >= 220;
    var street = full ? Math.min(120, Math.floor(h * 0.42)) : Math.floor(h * 0.67), centre = Math.floor(w * 0.49);
    for (var y = 0; y < h; y += TILE) for (var x = 0; x < w; x += TILE) k.drawImage(api.grass((x / TILE + y / TILE) % 4, d), x, y);
    /* The canal and masonry banks run through the village, not along a horizon. */
    var canal = Math.max(32, w - 28);
    block(k, c.stoneShade, canal - 3, 0, 22, h); block(k, c.water, canal, 0, 15, h);
    for (y = 0; y < h; y += 4) {
      block(k, c.stoneLit, canal - 3, y, 2, 3); block(k, c.stone, canal + 16, y, 3, 3);
      block(k, c.foam, canal + 3 + y % 3, y + 1, 5, 1); block(k, c.sky, canal + 9, y + 3, 4, 1);
    }
    pavedArea(k, 0, street, w, full ? 18 : 11, c);
    if (full) pavedArea(k, centre - 6, 0, 13, h, c);
    pavedArea(k, centre - 28, street - 4, 57, full ? 31 : 20, c);
    block(k, c.bark, canal - 6, street - 2, 29, full ? 22 : 15);
    for (y = street; y < street + (full ? 20 : 12); y += 3) {
      block(k, c.barkLit, canal - 6, y, 29, 1); block(k, c.roadShade, canal + 4, y + 1, 1, 1);
    }
    block(k, c.leafDark, canal - 7, street - 3, 31, 2); block(k, c.barkLit, canal - 7, street - 4, 31, 1);
    block(k, c.leafDark, canal - 7, street + (full ? 20 : 12), 31, 2);
    for (x = canal - 7; x <= canal + 24; x += 10) {
      block(k, c.barkLit, x, street - 5, 2, 5); block(k, c.barkLit, x, street + (full ? 17 : 9), 2, 6);
    }
    var houseW = Math.max(28, Math.min(64, (canal - 22) / 3 - 30)), houseH = full ? 66 : Math.min(56, Math.max(27, h * 0.43));
    var rowTop = Math.max(8, street - houseH - (full ? 20 : 8)), gap = Math.max(42, (w - 48) / 3);
    for (x = -7; x < w + 12; x += 14) {
      scenicTree(k, x, rowTop + 8, 23 + noise(x) * 8, c, d === 3, false);
      if (full) scenicTree(k, x + 4, h + 8, 27 + noise(x + 9) * 6, c, d === 3, false);
    }
    for (var n = 0; n < 3; n++) {
      var hx = Math.floor(Math.min(30, w * 0.063) + n * gap), doorX = hx + houseW * 0.5 - 3;
      pavedArea(k, doorX, rowTop + houseH, 7, Math.max(4, street - rowTop - houseH), c);
      garden(k, hx + houseW + 3, rowTop + 12, Math.max(7, gap - houseW - 10), Math.max(8, houseH - 17), c, s);
      building(k, hx, rowTop, houseW, houseH, n === 0 ? 1 : n === 2 ? 2 : 0, s);
      barrel(k, hx + houseW - 6, rowTop + houseH + 3, s);
      stamp(k, LANTERN, s, hx + houseW + 3, street - 11);
      if (full) {
        scenicTree(k, hx + houseW + 22, rowTop + 45, 31, c, d === 3, false);
        scenicTree(k, hx - 11, rowTop + 59, 27, c, false, false);
      }
    }
    fountain(k, centre, street + (full ? 7 : 5), c, s);
    var coats = [s.v, s.a, s.b, pigment("#bc9656", "#a38450", P!.warn), c.leaf], people = talk ? 7 : 5;
    for (n = 0; n < people; n++) {
      var nx = 15 + n * Math.max(17, (canal - 35) / people), ny = street - 9 + (n % 3) * 4;
      if (Math.abs(nx - centre) < 17) nx += 19;
      stamp(k, VILLAGER, folk(coats[n % coats.length]), Math.floor(nx), ny);
    }
    if (full) {
      var south = street + 64, lowerH = Math.min(60, h - south + 8);
      garden(k, 30, street + 31, 57, 20, c, s); garden(k, canal - 74, street + 31, 56, 20, c, s);
      building(k, 30, south, houseW + 5, lowerH, 0, s); building(k, centre + 62, south - 1, houseW + 7, lowerH, 1, s);
      for (n = 0; n < 3; n++) {
        scenicTree(k, 126 + n * 24, h - 19, 34 + n % 2 * 7, c, false, false);
        barrel(k, centre + 13 + n * 8, street + 31, s);
      }
      pavedArea(k, centre - 12, street + 32, 25, 8, c); stamp(k, VILLAGER, folk(s.a), centre - 7, street + 23);
    }
    scenicTree(k, 0, street + 14, full ? 35 : 24, c, false, false);
    scenicTree(k, w - 1, street + 38, full ? 39 : 24, c, d === 3, false);
  }
  function battleScene(k: CanvasRenderingContext2D, w: number, h: number, d: number) {
    var c = sceneColours(d), horizon = outdoor(k, w, h, d, c), floor = Math.floor(h * 0.77);
    /* Keep the central combat lane clear: these are ruins and landscape, never actors. */
    ruin(k, Math.floor(w * 0.13), horizon + 8, h * 0.31, c, d === 3 || d === 5);
    ruin(k, Math.floor(w * 0.83), horizon + 9, h * 0.22, c, false);
    scenicTree(k, -1, horizon + 12, h * 0.67, c, d === 3, false);
    scenicTree(k, w - 5, horizon + 9, h * 0.57, c, d !== 4, false);
    var earth = d === 3 || d === 5 ? c.stone : c.road;
    block(k, c.roadShade, 0, floor - 1, w, h - floor + 1);
    block(k, earth, 0, floor, w, h - floor);
    for (var y = floor + 2; y < h; y += 4) {
      for (var x = -5; x < w; x += 13) {
        var xx = x + Math.floor(noise(x + y * 7) * 9);
        block(k, y % 8 < 4 ? c.roadLit : c.roadShade, xx, y, 2 + Math.floor(noise(x * 3 + y) * 6), 1);
      }
    }
    for (x = 0; x < w; x += 9) {
      block(k, c.grassShade, x, floor - 2, 6, 2); block(k, c.grassLit, x + 1, floor - 3, 2, 1);
    }
    for (x = -5; x < w; x += 28) {
      block(k, c.leafDark, x, h - 3, 17, 3); block(k, c.leaf, x + 3, h - 5, 9, 3);
      block(k, c.leafLit, x + 5, h - 6, 2, 3);
      if (d === 4) { block(k, c.barkLit, x + 10, h - 10, 1, 7); block(k, c.roadShade, x + 10, h - 11, 2, 3); }
      if (d === 3 || d === 5) { block(k, c.stoneShade, x + 17, h - 4, 7, 4); block(k, c.stoneLit, x + 18, h - 5, 4, 1); }
    }
  }
  function interior(k: CanvasRenderingContext2D, w: number, h: number, d: number, inn: boolean) {
    var p = P!, s = stoneSlots(), c = sceneColours(d), full = h >= 110, floor = Math.floor(h * (full ? 0.24 : 0.57));
    var wall = pigment("#bb967b", "#7e6267", p.warnDim), mortar = pigment("#9a7b70", "#5a4b5b", p.rule);
    var wood = pigment("#a67553", "#785346", p.warnDim), woodLit = pigment("#cb9968", "#9e7554", p.warn);
    block(k, mortar, 0, 0, w, floor);
    for (var y = 1, row = 0; y < floor; y += 6, row++) {
      for (var x = -(row % 2) * 9; x < w; x += 18) {
        block(k, wall, x, y, 17, 5); block(k, s.P, x + 2, y, 12, 1);
      }
    }
    block(k, s.k, 0, floor, w, h - floor);
    for (y = floor + 1, row = 0; y < h; y += 5, row++) {
      for (x = -(row % 2) * 17; x < w; x += 34) {
        block(k, wood, x, y, 33, 4); block(k, woodLit, x + 1, y, 30, 1);
        block(k, s.k, x + 3, y + 2, 1, 1); block(k, woodLit, x + 14, y + 2, 8, 1);
      }
    }
    block(k, s.k, 0, floor - 4, w, 4); block(k, woodLit, 0, floor - 4, w, 1);
    block(k, s.k, 0, 2, w, 4); block(k, woodLit, 0, 2, w, 1);
    for (x = 7; x < w; x += 60) {
      block(k, s.k, x, 0, 4, floor); block(k, woodLit, x, 6, 1, floor - 10);
      var wy = Math.max(9, floor - 32);
      block(k, s.k, x + 17, wy - 2, 22, 24);
      block(k, c.sky, x + 19, wy, 18, 20); block(k, c.horizon, x + 19, wy + 10, 18, 10);
      block(k, c.forest, x + 19, wy + 17, 18, 3);
      block(k, c.cloud, x + 22, wy + 4, 8, 2); block(k, c.cloud, x + 26, wy + 2, 4, 2);
      block(k, s.k, x + 27, wy, 2, 20); block(k, s.k, x + 19, wy + 9, 18, 2);
      block(k, s.C, x + 16, wy + 20, 24, 2);
      if (inn) {
        block(k, s.b, x + 14, wy - 2, 5, 21); block(k, s.B, x + 15, wy, 1, 17);
        block(k, s.b, x + 37, wy - 2, 5, 21); block(k, s.B, x + 38, wy, 1, 17);
        block(k, s.y, x + 14, wy + 13, 5, 1); block(k, s.y, x + 37, wy + 13, 5, 1);
      }
    }
    var rugX = Math.floor(w * 0.36), rugW = Math.floor(w * 0.3), rugY = full ? floor + 61 : floor + 5;
    var rugH = Math.max(7, h - rugY - 4);
    block(k, s.k, rugX - 1, rugY - 1, rugW + 2, rugH + 2); block(k, s.y, rugX, rugY, rugW, rugH);
    block(k, s.b, rugX + 2, rugY + 2, rugW - 4, rugH - 4);
    for (x = rugX + 4; x < rugX + rugW - 4; x += 8) {
      block(k, s.B, x, rugY + 3, 3, rugH - 6); block(k, s.y, x + 1, rugY + Math.floor(rugH / 2), 1, 1);
    }
    if (inn) {
      for (x = 14; x < w - 30; x += 68) stamp(k, BED, s, x, floor - 8, 2);
      var fx = Math.floor(w * 0.78), fy = floor - 20;
      block(k, s.k, fx - 3, fy - 7, 30, 29); block(k, s.c, fx, fy - 7, 24, 27);
      for (y = fy - 5; y < floor; y += 5) block(k, s.K, fx, y, 24, 1);
      block(k, s.k, fx + 5, fy + 4, 14, 16); block(k, s.b, fx + 6, fy + 12, 12, 7);
      block(k, s.y, fx + 9, fy + 10, 7, 9); block(k, s.Y, fx + 11, fy + 8, 2, 10);
      block(k, s.k, fx - 2, fy, 28, 3); block(k, s.C, fx - 3, fy - 1, 30, 1);
      stamp(k, VILLAGER, folk(s.a), Math.floor(w * 0.55), floor - 6);
    } else {
      for (x = 14; x < w - 15; x += 47) {
        block(k, s.k, x - 1, floor - 22, 36, 24); block(k, wood, x, floor - 21, 34, 22);
        for (var shelf = 0; shelf < 2; shelf++) {
          var shelfY = floor - 18 + shelf * 11;
          block(k, s.k, x, shelfY + 7, 34, 2); block(k, woodLit, x, shelfY + 7, 34, 1);
          for (var b = 0; b < 5; b++) {
            var bottle = b % 3 === 0 ? s.a : b % 3 === 1 ? s.v : s.y;
            block(k, bottle, x + 3 + b * 6, shelfY + 2, 4, 5); block(k, s.C, x + 4 + b * 6, shelfY, 2, 2);
            block(k, s.w, x + 3 + b * 6, shelfY + 4, 1, 2);
          }
        }
      }
      stamp(k, VILLAGER, folk(s.v), Math.floor(w * 0.48), floor - 12);
      for (x = Math.floor(w * 0.27); x < w * 0.69; x += 29) stamp(k, COUNTER, s, x, floor - 5, 2);
    }
    for (x = 9; x < w; x += 60) {
      block(k, alpha(s.y, 0.1), x + 33, floor - 25, 13, 15);
      stamp(k, LANTERN, s, x + 31, floor - 23);
    }
    if (full) {
      block(k, s.k, 0, floor, 5, h - floor); block(k, woodLit, 1, floor, 1, h - floor);
      block(k, s.k, w - 5, floor, 5, h - floor); block(k, woodLit, w - 5, floor, 1, h - floor);
      if (inn) {
        for (x = 10; x < w - 25; x += 68) {
          block(k, s.x, x + 2, floor + 8, 4, 29); block(k, s.k, x, floor + 4, 3, 31);
          block(k, woodLit, x, floor + 4, 1, 30); block(k, s.k, x, floor + 34, 42, 3);
          block(k, woodLit, x, floor + 34, 42, 1);
          block(k, s.b, x + 9, floor + 29, 22, 4); block(k, s.y, x + 10, floor + 30, 20, 1);
        }
        for (x = 18; x < w - 25; x += 68) {
          var tableY = floor + 58;
          block(k, s.x, x + 2, tableY + 5, 32, 17); block(k, s.k, x, tableY, 31, 18);
          block(k, wood, x + 1, tableY + 1, 29, 12); block(k, woodLit, x + 2, tableY + 1, 27, 2);
          block(k, s.k, x + 2, tableY + 15, 3, 7); block(k, s.k, x + 26, tableY + 15, 3, 7);
          block(k, s.w, x + 5, tableY + 4, 7, 5); block(k, s.P, x + 6, tableY + 5, 5, 2);
          block(k, s.C, x + 20, tableY + 4, 5, 5); block(k, s.k, x + 21, tableY + 5, 3, 2);
          block(k, s.y, x + 15, tableY + 2, 2, 6); block(k, s.Y, x + 15, tableY, 2, 2);
          for (var chair = 0; chair < 2; chair++) {
            block(k, s.k, x + 3 + chair * 18, tableY + 22, 8, 9);
            block(k, s.r, x + 4 + chair * 18, tableY + 22, 6, 6);
            block(k, woodLit, x + 4 + chair * 18, tableY + 22, 6, 1);
          }
        }
        stamp(k, VILLAGER, folk(s.b), 25, floor + 50);
        stamp(k, VILLAGER, folk(s.v), Math.floor(w * 0.69), floor + 79);
        for (x = 12; x < 52; x += 10) barrel(k, x, h - 22, s);
        stamp(k, COUNTER, s, w - 42, h - 38, 2);
      } else {
        for (var rowN = 0; rowN < 2; rowN++) for (var shelfN = 0; shelfN < 3; shelfN++) {
          var bx = 15 + shelfN * Math.max(44, (w - 40) / 3), by = floor + 52 + rowN * 37;
          block(k, s.x, bx + 3, by + 4, 42, 21); block(k, s.k, bx, by, 41, 22);
          block(k, wood, bx + 1, by + 1, 39, 16); block(k, woodLit, bx + 1, by + 1, 39, 2);
          block(k, woodLit, bx + 1, by + 16, 39, 1); block(k, s.P, bx + 4, by + 19, 33, 1);
          for (var goods = 0; goods < 5; goods++) {
            var gx = bx + 4 + goods * 7, colour = goods % 3 === 0 ? s.v : goods % 3 === 1 ? s.a : s.y;
            if (rowN) {
              block(k, s.k, gx, by + 4, 5, 10); block(k, colour, gx, by + 4, 4, 8);
              block(k, s.w, gx + 1, by + 6, 2, 1); block(k, s.w, gx + 1, by + 10, 2, 1);
            } else {
              block(k, colour, gx, by + 7, 5, 6); block(k, s.C, gx + 1, by + 4, 3, 3);
              block(k, s.w, gx + 1, by + 8, 1, 3); block(k, s.y, gx + 1, by + 4, 3, 1);
            }
          }
        }
        stamp(k, VILLAGER, folk(s.b), Math.floor(w * 0.32), floor + 68);
        stamp(k, VILLAGER, folk(s.a), Math.floor(w * 0.73), floor + 77);
        for (x = w - 36; x < w - 10; x += 9) barrel(k, x, floor + 30, s);
      }
      block(k, s.k, w * 0.43, h - 5, w * 0.14, 5);
      block(k, s.C, w * 0.43 + 1, h - 4, w * 0.14 - 2, 1);
    }
  }

  /* ── what game.js asks for ──────────────────────────────── */
  var api: CnpeArtApi = {
    TILE: TILE, FRAMES: FRAMES, FAMILIES: FAMILIES,
    theme: function (p) { P = p; gen++; cache = {}; groundCache = {}; bright = lum(p.paper) > lum(p.ink) ? p.paper : p.ink; dark = bright === p.paper ? p.ink : p.paper; },
    grass: function (v, d) { return cached("g" + v + "." + d, function (k) { var s = ground(d); fill(k, s.g); stamp(k, GRASS[v % GRASS.length], s, 0, 0); }); },
    /* frame 0 is the flower at rest, which the terrain cache holds; 1 and 2 are the sway */
    flower: function (v, d, frame) {
      frame = ((frame || 0) % FRAMES + FRAMES) % FRAMES;
      return cached("f" + v + "." + d + "." + frame, function (k) {
        var s = ground(d), i = v % FLOWER.length;
        fill(k, s.g); stamp(k, GRASS[(v + 1) % GRASS.length], s, 0, 0);
        stamp(k, frame ? FLOWER_SWAY[i][frame - 1] : FLOWER[i], s, 0, 0);
      });
    },
    road: function (v, d, mask) {
      return cached("r" + v + "." + d + "." + mask, function (k) { var s = ground(d); fill(k, s.r); stamp(k, ROAD[v % ROAD.length], s, 0, 0); edges4(k, ROAD_EDGE, s, mask); });
    },
    sand: function (v, d) { return cached("s" + v + "." + d, function (k) { var s = ground(d); fill(k, s.s); stamp(k, SAND[v % SAND.length], s, 0, 0); }); },
    tree: function (v, d) { return cached("t" + v + "." + d, function (k) { var s = ground(d); fill(k, s.g); stamp(k, GRASS[v % GRASS.length], s, 0, 0); stamp(k, TREE[v % TREE.length], s, 0, 0); }); },
    cliff: function (v, d, mask) {
      return cached("c" + v + "." + d + "." + mask, function (k) {
        var s = cliffSlots(d); fill(k, s.c); stamp(k, CLIFF[v % CLIFF.length], s, 0, 0);
        if (mask & 4) stamp(k, CLIFF_S, s, 0, 0);
        if (mask & 8) stamp(k, CLIFF_W, s, 0, 0);
        if (mask & 2) stamp(k, flip(CLIFF_W), s, 0, 0);
        if (mask & 1) stamp(k, CLIFF_N, s, 0, 0);
      });
    },
    /* mask: N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128, set where the neighbour is land */
    water: function (mask, frame) {
      frame = ((frame % FRAMES) + FRAMES) % FRAMES;
      return cached("w" + mask + "." + frame, function (k) {
        var s = waterSlots(); fill(k, s.w); stamp(k, WATER[frame], s, 0, 0);
        var sides = rots4(SHORE[frame]);                                                                 // N E S W
        var corners = rots4(SHORE_CORNER);                                                               // NW NE SE SW
        var land = [!!(mask & 1), !!(mask & 4), !!(mask & 16), !!(mask & 64)];                            // N E S W
        for (var i = 0; i < 4; i++) if (land[i]) stamp(k, sides[i], s, 0, 0);
        if ((mask & 128) && !land[0] && !land[3]) stamp(k, corners[0], s, 0, 0);
        if ((mask & 2) && !land[0] && !land[1]) stamp(k, corners[1], s, 0, 0);
        if ((mask & 8) && !land[2] && !land[1]) stamp(k, corners[2], s, 0, 0);
        if ((mask & 32) && !land[2] && !land[3]) stamp(k, corners[3], s, 0, 0);
      });
    },
    bridge: function (vertical) {
      return cached("b" + (vertical ? "v" : "h"), function (k) {
        var w = waterSlots(); fill(k, w.w); stamp(k, WATER[0], w, 0, 0);
        var g = ground(1), s: Slots = { t: g.t, P: g.T, k: outline() };
        stamp(k, vertical ? rot(BRIDGE) : BRIDGE, s, 0, 0);
      });
    },
    town: function (d) { return cached("T" + d, function (k) { var g = ground(d); fill(k, g.g); stamp(k, GRASS[0], g, 0, 0); stamp(k, TOWN, stoneSlots(), 0, 0); }); },
    door: function (d, open) { return cached("D" + d + (open ? "o" : "s"), function (k) { var g = ground(d); fill(k, g.g); stamp(k, open ? DOOR_OPEN : DOOR_SEALED, stoneSlots(), 0, 0); }); },
    keep: function (d, cleared) {
      return cached("K" + d + (cleared ? "c" : "u"), function (k) {
        var g = ground(d); fill(k, g.g); stamp(k, GRASS[1], g, 0, 0);
        var s = stoneSlots(); s.F = cleared ? P!.ok : P!.bad;
        stamp(k, KEEPS[Math.max(0, Math.min(KEEPS.length - 1, d - 1))], s, 0, 0);
      });
    },
    /* state: 0 shut, 1 open, 2 passed */
    gate: function (state) {
      return cached("G" + state, function (k) {
        var p = P!, g = ground(0), s = stoneSlots();
        fill(k, g.s); stamp(k, SAND[0], g, 0, 0);
        s.a = state === 2 ? p.ok : state === 1 ? lighten(p.viol, 0.5) : darken(p.viol, 0.55);
        stamp(k, GATE, s, 0, 0);
        if (state === 0) stamp(k, GATE_BARS, { A: p.accent }, 0, 0);
      });
    },
    hero: function (face, frame) {
      var f = own(HERO, face) ? face : "d", i = ((frame || 0) % HERO_FRAMES + HERO_FRAMES) % HERO_FRAMES;
      return cached("h" + f + i, function (k) { stamp(k, HERO[f][i], heroSlots(), 0, 0); });
    },
    enemy: function (family, scale) {
      scale = scale || 3;
      var fam = own(ENEMIES, family) ? family : "workload";
      return cached("e" + fam + "." + scale, function (k) { stamp(k, ENEMIES[fam], enemySlots(fam), 0, 0, scale); }, 32 * scale, 32 * scale);
    },
    familyOf: familyOf,
    /** a transparent overlay for the living world, drawn over a tile the terrain already holds:
        "puff" over a town's chimney, "torch" over an open door's posts */
    ambient: function (kind, frame) {
      frame = ((frame || 0) % FRAMES + FRAMES) % FRAMES;
      return cached("a" + kind + "." + frame, function (k) {
        var p = P!;
        if (kind === "puff") stamp(k, PUFF[frame], { m: alpha(p.paper3, 0.6), M: alpha(p.paper2, 0.4) }, 0, 0);
        else stamp(k, TORCH[frame], { f: p.warn, F: lighten(p.warn, 0.5) }, 0, 0);
      });
    },
    /** the colour a region tints its ground with, for the minimap; the open sea's is the meadow's */
    tint: function (d) { return tintOf(d).c; },
    /** Cached pixel scenery; battles deliberately contain no actors. */
    backdrop: function (scene, d, w, h) {
      w = Number.isFinite(w) ? Math.max(1, Math.min(4096, Math.floor(w))) : 480;
      h = Number.isFinite(h) ? Math.max(1, Math.min(4096, Math.floor(h))) : 144;
      return cached("bd" + scene + "." + d + "." + w + "x" + h, function (k) {
        var pixel = scene === "battle" ? Math.max(1, Math.floor(h / 72)) :
          scene === "inn" || scene === "shop" ? Math.max(1, Math.min(3, Math.floor(Math.min(w / 240, h / 64)))) :
          Math.max(1, Math.floor(Math.min(w / 480, h / 144)));
        var sw = Math.ceil(w / pixel), sh = Math.ceil(h / pixel);
        k.save(); k.scale(pixel, pixel);
        if (scene === "inn" || scene === "shop") interior(k, sw, sh, d, scene === "inn");
        else if (scene === "battle") battleScene(k, sw, sh, d);
        else townScene(k, sw, sh, d, scene === "talk");
        k.restore();
      }, w, h);
    },
    /** the grids that are not the size they claim; empty when the art is sound */
    check: function () {
      var bad: string[] = [];
      var sq = function (name: string, g: Grid, n: number) { if (g.length !== n || g.some(function (r) { return r.length !== n; })) bad.push(name); };
      GRASS.forEach(function (g, i) { sq("grass" + i, g, TILE); }); FLOWER.forEach(function (g, i) { sq("flower" + i, g, TILE); });
      ROAD.forEach(function (g, i) { sq("road" + i, g, TILE); }); SAND.forEach(function (g, i) { sq("sand" + i, g, TILE); });
      WATER.forEach(function (g, i) { sq("water" + i, g, TILE); }); CLIFF.forEach(function (g, i) { sq("cliff" + i, g, TILE); });
      TREE.forEach(function (g, i) { sq("tree" + i, g, TILE); }); KEEPS.forEach(function (g, i) { sq("keep" + i, g, TILE); });
      FLOWER_SWAY.forEach(function (v, i) { v.forEach(function (g, j) { sq("flower-sway" + i + "." + j, g, TILE); }); });
      PUFF.forEach(function (g, i) { sq("puff" + i, g, TILE); }); TORCH.forEach(function (g, i) { sq("torch" + i, g, TILE); });
      if (FLOWER_SWAY.length !== FLOWER.length || FLOWER_SWAY.some(function (v) { return v.length !== FRAMES - 1; }) || PUFF.length !== FRAMES || TORCH.length !== FRAMES) bad.push("ambient-frames");
      [["bridge", BRIDGE], ["town", TOWN], ["door-sealed", DOOR_SEALED], ["door-open", DOOR_OPEN], ["gate", GATE], ["gate-bars", GATE_BARS], ["cliff-s", CLIFF_S], ["cliff-w", CLIFF_W]].forEach(function (x) { sq(x[0] as string, x[1] as Grid, TILE); });
      Object.keys(PROPS).forEach(function (n) { sq("prop-" + n, PROPS[n], TILE); });
      Object.keys(HERO).forEach(function (f) { HERO[f].forEach(function (g, i) { sq("hero-" + f + i, g, TILE); }); });
      // every facing has the standing frame, both halves of a stride and the pass, and the four all differ, or the walk would hop
      Object.keys(HERO).forEach(function (f) {
        var fr = HERO[f], same = false;
        for (var a = 0; a < fr.length; a++) for (var b = a + 1; b < fr.length; b++) if (fr[a].join() === fr[b].join()) same = true;
        if (fr.length !== HERO_FRAMES || same) bad.push("hero-frames-" + f);
      });
      FAMILIES.forEach(function (f) { sq("enemy-" + f, ENEMIES[f], 32); });
      [SHORE[0], SHORE[1], SHORE[2], SHORE_CORNER, CLIFF_N, ROAD_EDGE].forEach(function (g, i) { if (g.length > TILE || g.some(function (r) { return r.length !== TILE; })) bad.push("edge" + i); });
      // a turned band must land on the far side: the east shore in the last column, the south shore in the last row
      var east = rot(pad(SHORE[0])), south = rot(rot(pad(SHORE[0])));
      if (east[0][TILE - 1] === "." || east[TILE - 1][TILE - 1] === "." || east[0][0] !== ".") bad.push("shore-east");
      if (south[TILE - 1][0] === "." || south[TILE - 1][TILE - 1] === "." || south[0][0] !== ".") bad.push("shore-south");
      return bad;
    }
  };
  window.CNPE_ART = api;
})();
