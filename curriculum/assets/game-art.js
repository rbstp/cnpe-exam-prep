"use strict";
/* CNPE Quest: the art. Every sprite is a small grid of characters, one per
   pixel, each character a slot in a colour map that is filled from the theme's
   palette when the page paints. So the same grids draw the light and the dark
   console, nothing here is a picture file, and a whole tileset weighs a few
   kilobytes of text.

   The grids are ASCII only: tools/subset-fonts.py counts every character in
   assets/*.js as one the fonts must carry, and these must not add a glyph.

   game.js asks for tiles by name and state, keeps the canvases this returns,
   and calls theme() when the palette changes, which drops the cache. Nothing
   below touches the DOM until a sprite is asked for, so node can load it to
   check the grids (see tools/browser-checks/game.js, which does the same in
   the browser). */
(function () {
    "use strict";
    var TILE = 16;
    var FRAMES = 3; // water frames
    function parse(c) {
        c = String(c || "").trim();
        var m = /^#([0-9a-f]{3,8})$/i.exec(c);
        if (m) {
            var h = m[1];
            if (h.length === 3 || h.length === 4)
                h = h.split("").map(function (x) { return x + x; }).join("");
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
    function css(c) { return c[3] >= 1 ? "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")" : "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (+c[3].toFixed(3)) + ")"; }
    /** a mixed into b by t, as css */
    function mix(a, b, t) {
        var x = parse(a), y = parse(b);
        return css([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, x[3] + (y[3] - x[3]) * t]);
    }
    function alpha(a, t) { var x = parse(a); return css([x[0], x[1], x[2], t]); }
    function lum(c) { var x = parse(c); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; }
    /* ── the palette, and the colour sets built from it ─────── */
    var P = null;
    var bright = "#fff", dark = "#000"; // whichever of ink and paper is the lighter, per theme
    var gen = 0; // bumps on theme(); part of every cache key
    var cache = {};
    /** lighter in both themes: toward the palette's brighter end */
    function lighten(c, t) { return mix(c, bright, t); }
    function darken(c, t) { return mix(c, dark, t); }
    /** each region tints its ground a little: five domains, five landscapes */
    function tintOf(d) {
        var p = P;
        switch (d) {
            case 2: return { c: p.accentDim, t: 0.22 }; // Reconcile Reach: cool blue
            case 3: return { c: p.viol, t: 0.2 }; // Compositor Heights: violet stone
            case 4: return { c: p.warnDim, t: 0.22 }; // Signal Fens: marsh olive
            case 5: return { c: p.bad, t: 0.16 }; // Warden's March: rust
            default: return { c: p.ok, t: 0.08 }; // Substrate Downs: plain meadow
        }
    }
    var groundCache = {};
    function ground(d) {
        var key = gen + ":" + d;
        if (groundCache[key])
            return groundCache[key];
        var p = P, tint = tintOf(d);
        var g = mix(mix(p.s2, p.ok, 0.18), tint.c, tint.t);
        var r = mix(mix(p.s3, p.warnDim, 0.28), tint.c, tint.t * 0.5);
        var s = mix(mix(p.warnDim, p.s3, 0.5), tint.c, tint.t * 0.4);
        var l = mix(p.ok, tint.c, tint.t * 0.6);
        var slots = {
            g: g, G: mix(lighten(g, 0.14), p.ok, 0.12), h: darken(g, 0.16),
            f: p.warn, e: p.bad, F: bright, L: lighten(l, 0.2),
            r: r, R: lighten(r, 0.16), q: darken(r, 0.3),
            s: s, S: lighten(s, 0.2), n: darken(s, 0.14),
            t: p.warnDim, l: l, m: lighten(l, 0.3), o: darken(l, 0.35),
            x: alpha(dark, 0.3)
        };
        groundCache[key] = slots;
        return slots;
    }
    function waterSlots() {
        var p = P, w = p.accentDim;
        return { w: w, W: mix(w, p.accent, 0.5), v: darken(w, 0.16), o: lighten(w, 0.55), O: lighten(w, 0.3) };
    }
    function cliffSlots(d) {
        var p = P, tint = tintOf(d), c = mix(p.rule, tint.c, tint.t * 0.5);
        return { c: c, C: lighten(c, 0.3), k: darken(c, 0.35), K: darken(c, 0.55), g: ground(d).g };
    }
    function stoneSlots() {
        var p = P, c = p.rule2;
        return { p: p.paper2, P: p.paper3, k: darken(p.paper2, 0.55), b: p.bad, y: p.warn, c: c, C: lighten(c, 0.3), K: darken(c, 0.45), v: p.viol, V: lighten(p.viol, 0.35), a: p.accent, A: lighten(p.accent, 0.3), x: alpha(dark, 0.3), w: bright };
    }
    function rot(g) {
        var h = g.length, w = g[0].length, out = [];
        for (var y = 0; y < w; y++) {
            var row = "";
            for (var x = 0; x < h; x++)
                row += g[h - 1 - x][y];
            out.push(row);
        }
        return out;
    }
    function flip(g) { return g.map(function (r) { return r.split("").reverse().join(""); }); }
    var GRASS = [
        ["................", "....G...........", "................", "..........h.....", ".G..............", "................", ".......G........", "................",
            "....h...........", "............G...", "................", ".G..............", ".........h......", "................", ".....G..........", "................"],
        ["................", "..............G.", "....G.G.........", ".....G..........", "................", "..........h.h...", "...........h....", "................",
            ".G..............", "................", ".......G........", "................", "..h.h.........G.", "...h............", "................", "................"],
        ["................", "................", "........G.......", "................", "..h.............", "................", "............G.G.", ".............G..",
            "................", "....G...........", "................", "................", "..........h.....", ".G..............", "................", "......h........."],
        [".......h........", "................", "...G............", "................", "................", ".........G......", "................", "..h.............",
            "................", "..............G.", "......G.G.......", ".......G........", "................", "................", "...h.......G....", "................"]
    ];
    var FLOWER = [
        ["................", "................", "...........f....", "..........fFf...", "...........f....", "................", "................", "....e...........",
            "...eFe..........", "....e...........", "....L...........", "................", "................", "...........f....", "..........fFf...", "...........f...."],
        ["................", "....e...........", "...eFe..........", "....e...........", "...........L....", "..........f.....", ".........fFf....", "..........f.....",
            "................", "................", "................", ".....f..........", "....fFf.........", ".....f..........", ".....L..........", "................"]
    ];
    var ROAD = [
        ["................", "..R.............", "................", ".........q......", "................", "....R...........", "................", "..........R.....",
            "................", "................", "..q.............", "................", "............R...", "....R...........", "................", "................"],
        ["................", "................", "......q.........", "................", "..R........R....", "................", "................", "................",
            "....R...........", "..........q.....", "................", "................", ".R..............", "................", ".........R......", "................"]
    ];
    var ROAD_EDGE = ["qqqqqqqqqqqqqqqq", ".q...q..q..q...."]; // the north edge; the others are turns of it
    var SAND = [
        ["................", "..S.............", ".........n......", "................", "................", "......S.........", "................", "............S...",
            "................", "..n.............", "................", ".........S......", "................", "................", "....S.......n...", "................"],
        ["................", "................", "......S.........", "................", "..n.........S...", "................", "................", "....S...........",
            "................", "...........n....", ".S..............", "................", "................", ".......S........", "................", "................"]
    ];
    /* three frames of open water; the wave lines drift right one pixel a frame */
    var WATER = [
        ["................", "................", "...WWW..........", "................", "................", "..........WWWW..", "...........vv...", "................",
            "................", ".WWW............", "..vv............", "................", "................", "........WWW.....", "................", "................"],
        ["................", "................", "....WWW.........", "................", "................", "...........WWWW.", "............vv..", "................",
            "................", "..WWW...........", "...vv...........", "................", "................", ".........WWW....", "................", "................"],
        ["................", "................", ".....WWW........", "................", "................", "............WWWW", ".............vv.", "................",
            "................", "...WWW..........", "....vv..........", "................", "................", "..........WWW...", "................", "................"]
    ];
    /* the shoreline: land to the north; foam dashes step along a pixel a frame */
    var SHORE = [
        ["oooooooooooooooo", "OO.OOO.OO.OOO.OO", "..O.........O..."],
        ["oooooooooooooooo", "OOO.OO.OOO.OO.OO", "...O.........O.."],
        ["oooooooooooooooo", ".OOO.OO.OOO.OO.O", "O...O.........O."]
    ];
    var SHORE_CORNER = ["oo..............", "oO..............", "................"]; // land to the north-west only
    var CLIFF = [
        ["cccccccccccccccc", "cccccccccccccccc", "ccccCccccccccccc", "cccCCcccccccKccc", "ccccccccccccKccc", "cccccccccKcccccc", "ccccccccKccccccc", "cCccccccccccccCc",
            "cccccccccccccccc", "ccccKccccccccccc", "cccccKcccccCcccc", "cccccccccccccccc", "cccccccccccccccc", "cCcccccccKcccccc", "ccccccccccccccCc", "cccccccccccccccc"],
        ["cccccccccccccccc", "ccccccccccCccccc", "cccccccccCCccccc", "cccccccccccccccc", "ccKccccccccccccc", "cccKcccccccccccc", "cccccccccccccKcc", "cccccccccccccccc",
            "cccccCcccccccccc", "cccccccccccccccc", "ccccccccccKccccc", "ccccccccccKccccc", "cCcccccccccccccc", "cccccccccccccccc", "ccccccccccccCccc", "ccccccKccccccccc"]
    ];
    var CLIFF_N = ["CCCCCCCCCCCCCCCC", "CCCCCCCCCCCCCCCC", ".C.C.C.C.C.C.C.C"]; // the rim, lit
    var CLIFF_S = ["................", "................", "................", "................", "................", "................", "................", "................",
        "................", "................", "................", "................", "K.K.K.K.K.K.K.K.", "KKKKKKKKKKKKKKKK", "KKKKKKKKKKKKKKKK", "kkkkkkkkkkkkkkkk"]; // the foot, in shadow
    var CLIFF_W = ["K...............", "K...............", "K...............", "KK..............", "K...............", "K...............", "KK..............", "K...............",
        "K...............", "KK..............", "K...............", "K...............", "K...............", "KK..............", "K...............", "K..............."];
    var TREE = [
        ["................", "......ooo.......", "....ollllo......", "...olmmlllllo...", "..olmmlllllllo..", "..ollllllllllo..", "..oollllllllloo.", "..oooollllooooo.",
            "...ooolllloooo..", "....oooooooo....", "......ttt.......", "......ttt.......", "......ttt.......", ".....ttttt......", "...xxxxxxxxxx...", "................"],
        ["................", "......ooo.......", ".....olllo......", "....ollmmlo.....", "...ollllmmllo...", "...ollllllllo...", "..oolllllllloo..", "..ooollllloooo..",
            "...oooollooooo..", "....ooooooo.....", ".......ttt......", ".......ttt......", ".......ttt......", "......ttttt.....", "....xxxxxxxxx...", "................"]
    ];
    /* a bridge crossing east-west: planks between two rails, over the water */
    var BRIDGE = ["................", "kkkkkkkkkkkkkkkk", "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt", "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt",
        "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt", "ttttPttttPttttPt", "PPPPtPPPPtPPPPtP", "ttttPttttPttttPt", "kkkkkkkkkkkkkkkk", "................"];
    /* ── landmarks ──────────────────────────────────────────── */
    var TOWN = ["................", "................", "......bb........", ".....bbbb..bb...", "....bbbbbbbbbb..", "...bbbbbbbbbbbb.", "..bbbbbbbbbbbbbb", "..pppppppppppppp",
        "..ppyppkkpppyppp", "..ppyppkkpppyppp", "..pppppkkppppppp", "..pppppkkppppppp", "..pppppkkppppppp", ".xxxxxxxxxxxxxxx", "................", "................"];
    var DOOR_SEALED = ["................", "....CCCCCCCC....", "...CccccccccC...", "..CccKKKKKKccC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", "..CcKCCCCCCKcC..", "..CcKKKKKKKKcC..",
        "..CcKKKKKKKKcC..", "..CcKCCCCCCKcC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", ".xxxxxxxxxxxxxx.", "................", "................"];
    var DOOR_OPEN = ["................", "....CCCCCCCC....", "...CccccccccC...", "..CccvvvvvvccC..", "..CcvvVVVVvvcC..", "..CcvVVVVVVvcC..", "..CcvVVVVVVvcC..", "..CcvVVVVVVvcC..",
        "..CcvVVVVVVvcC..", "..CcvVVVVVVvcC..", "..CcvvVVVVvvcC..", "..CcKKKKKKKKcC..", "..CcKKKKKKKKcC..", ".xxxxxxxxxxxxxx.", "................", "................"];
    /* five keeps, one silhouette a region; "F" is the flag, red until the keep falls, green after */
    var KEEPS = [
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
    var GATE = ["....vvvvvvvv....", "...vVVVVVVVVv...", "..vVvvvvvvvvVv..", ".vVvaaaaaaaavVv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.",
        ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", ".vvvaaaaaaaavvv.", "xxxxxxxxxxxxxxxx", "................", "................"];
    var GATE_BARS = ["................", "................", "................", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....",
        ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", ".....A..A..A....", "................", "................", "................"];
    /* ── the player: four facings, two frames each ──────────── */
    var HERO = {
        d: [
            ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSSSH....", "....HSeSSeSH....", ".....SSSSSS.....", "......SSSS......",
                "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.S...", ".....tttttt.....", ".....BB..BB.....", ".....BB..BB.....", ".....xxxxxx....."],
            ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSSSH....", "....HSeSSeSH....", ".....SSSSSS.....", "......SSSS......",
                "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", ".....TTTTTT.....", ".....tttttt.....", "....BB....BB....", "....BB....BB....", "....xxxxxxxx...."]
        ],
        u: [
            ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHSSSSHH....", ".....SSSSSS.....", "......SSSS......",
                "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", "...S.TTTTTT.S...", ".....tttttt.....", ".....BB..BB.....", ".....BB..BB.....", ".....xxxxxx....."],
            ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHHHHHHH....", "....HHSSSSHH....", ".....SSSSSS.....", "......SSSS......",
                "....TTTTTTTT....", "...TTTTTTTTTT...", "...STTTTTTTTS...", ".....TTTTTT.....", ".....tttttt.....", "....BB....BB....", "....BB....BB....", "....xxxxxxxx...."]
        ],
        l: [
            ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSHHH....", "....HeSSSHHH....", ".....SSSSSH.....", "......SSSS......",
                ".....TTTTTTT....", "....TTTTTTTTT...", "....STTTTTTTT...", "....S.TTTTTT....", ".....tttttt.....", ".....BBB.BB.....", ".....BBB.BB.....", ".....xxxxxx....."],
            ["................", ".....HHHHHH.....", "....HHHHHHHH....", "....HHHHHHHH....", "....HSSSSHHH....", "....HeSSSHHH....", ".....SSSSSH.....", "......SSSS......",
                ".....TTTTTTT....", "....TTTTTTTTT...", "....STTTTTTTT...", "....S.TTTTTT....", ".....tttttt.....", "....BB...BBB....", "....BB...BBB....", "....xxxxxxxx...."]
        ]
    };
    HERO.r = [flip(HERO.l[0]), flip(HERO.l[1])];
    /** skin and hair that read in both themes: the warm colours pulled toward the light and the dark end */
    function skin() { return lighten(P.warn, 0.55); }
    function hair() { return darken(P.warnDim, 0.35); }
    function heroSlots() {
        var p = P;
        return { H: hair(), S: skin(), e: dark, T: p.accent, t: p.accentDim, B: dark, x: alpha(dark, 0.35) };
    }
    function folk(coat) { return { k: hair(), p: skin(), a: coat, x: alpha(dark, 0.3) }; }
    /* ── the enemies: one shape per fault family, 32 by 32 ───── */
    /* b the body, dark; d the outline, darker; l the family colour as a highlight;
       e the glow of an eye; p the black inside a maw or a socket; a metal, smoke or
       chain; w a fang or a bone; s the shadow on the ground */
    var ENEMIES = {
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
    var FAMILIES = Object.keys(ENEMIES);
    /** a family's colour is its highlight; the body is that colour pulled far toward the dark, the eyes burn */
    function enemySlots(family) {
        var p = P;
        var hue = family === "workload" ? p.bad : family === "networking" ? p.accent : family === "storage" ? p.warnDim : family === "gitops" ? p.viol :
            family === "ci" ? p.warn : family === "crossplane" ? p.info : family === "observability" ? p.accentLit : p.rule2;
        var eye = family === "gitops" || family === "observability" ? p.viol : family === "networking" || family === "crossplane" ? p.accent : family === "security" ? p.bad : p.warn;
        var metal = family === "ci" || family === "security" ? mix(p.rule2, hue, 0.3) : family === "workload" ? alpha(dark, 0.35) : darken(hue, 0.3);
        return { b: darken(hue, 0.55), d: darken(hue, 0.82), l: hue, e: lighten(eye, 0.25), p: darken(hue, 0.9), a: metal, w: lighten(p.paper3, 0.4), s: alpha(dark, 0.35) };
    }
    /** the fault family a scenario belongs to, by its id; the sprite and its colour follow */
    function familyOf(id, domain) {
        if (/^(argocd|flux|canary)/.test(id))
            return "gitops";
        if (/^(tekton|image-unsigned)/.test(id))
            return "ci";
        if (/^(xp-|xr-)/.test(id))
            return "crossplane";
        if (/^(servicemonitor|alert|otel)/.test(id))
            return "observability";
        if (/^(rbac|kyverno|pss|eso)/.test(id))
            return "security";
        if (/^(svc|netpol|dns|ingress)/.test(id))
            return "networking";
        if (/^(pvc|storage|volume)/.test(id))
            return "storage";
        if (domain === 3)
            return "crossplane";
        if (domain === 4)
            return "observability";
        if (domain === 5)
            return "security";
        return "workload";
    }
    /* ── props for the town backdrops ───────────────────────── */
    var HOUSE = ["................", ".......bb.......", "......bbbb......", ".....bbbbbb.....", "....bbbbbbbb....", "...bbbbbbbbbb...", "..bbbbbbbbbbbb..", ".pppppppppppppp.",
        ".ppyyppppppyypp.", ".ppyyppkkppyypp.", ".ppppppkkpppppp.", ".ppppppkkpppppp.", ".ppppppkkpppppp.", ".ppppppkkpppppp.", "xxxxxxxxxxxxxxxx", "................"];
    var INN = ["................", "....bbbbbbbbbb..", "...bbbbbbbbbbbb.", "..bbbbbbbbbbbbbb", ".ppppppppppppppp", ".ppyyppyyppyyppp", ".ppyyppyyppyyppp", ".ppppppppppppppp",
        ".pppppppppppyyyp", ".ppyyppkkpppyayp", ".ppyyppkkpppyyyp", ".ppppppkkppppppp", ".ppppppkkppppppp", ".ppppppkkppppppp", "xxxxxxxxxxxxxxxx", "................"];
    var SHOP = ["................", "................", "................", ".aAaAaAaAaAaAaA.", ".AaAaAaAaAaAaAa.", ".ppppppppppppppp", ".ppppppppppppppp", ".ppyyyyyyyppkkpp",
        ".ppyyyyyyyppkkpp", ".ppyyyyyyyppkkpp", ".ppyyyyyyyppkkpp", ".ppyyyyyyyppkkpp", ".ppppppppppkkppp", ".ppppppppppkkppp", "xxxxxxxxxxxxxxxx", "................"];
    var WELL = ["................", "......kkkk......", ".....kbbbbk.....", "....kbbbbbbk....", "....k......k....", "....k......k....", "....k..kk..k....", "....k......k....",
        "....CCCCCCCC....", "....cCccccCc....", "....ccKKKKcc....", "....ccKKKKcc....", "....cCccccCc....", "....CCCCCCCC....", "...xxxxxxxxxx...", "................"];
    var BED = ["................", "................", "................", ".kk.............", ".kk.............", ".kkwwwwwwwwwwwk.", ".kkwwwwwaaaaaak.", ".kkkkkkkkkkkkkk.",
        ".kkppppppppppkk.", ".kkppppppppppkk.", ".kkkkkkkkkkkkkk.", ".kk..........kk.", ".kk..........kk.", "................", "xxxxxxxxxxxxxxxx", "................"];
    var COUNTER = ["................", "................", "................", "..yy....aa......", "..yy....aa..vv..", "..yy.ww.aa..vv..", ".kkkkkkkkkkkkkk.", ".kppppppppppppk.",
        ".kppppppppppppk.", ".kkkkkkkkkkkkkk.", ".kp...........k.", ".kp...........k.", ".kp...........k.", "................", "xxxxxxxxxxxxxxxx", "................"];
    var VILLAGER = ["................", "......kkkk......", ".....kkkkkk.....", ".....kppppk.....", ".....kpkkpk.....", "......pppp......", ".......pp.......", ".....aaaaaa.....",
        "....aaaaaaaa....", "....paaaaaap....", "....p.aaaa.p....", "......aaaa......", "......kkkk......", "......kk.kk.....", "......kk.kk.....", ".....xxxxxxx...."];
    var LANTERN = ["................", ".......kk.......", "......kkkk......", "......kyyk......", "......kyyk......", "......kkkk......", ".......k........", ".......k........",
        ".......k........", ".......k........", ".......k........", ".......k........", ".......k........", "......kkk.......", "......xxx.......", "................"];
    var PROPS = { house: HOUSE, inn: INN, shop: SHOP, well: WELL, bed: BED, counter: COUNTER, villager: VILLAGER, lantern: LANTERN };
    /* ── the painter ────────────────────────────────────────── */
    function canvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
    function k2d(c) { var k = c.getContext("2d"); k.imageSmoothingEnabled = false; return k; }
    /** draw a grid at (x, y), each cell s pixels; runs of one colour are one fillRect */
    function stamp(k, g, slots, x, y, s) {
        s = s || 1;
        for (var r = 0; r < g.length; r++) {
            var row = g[r], c = 0;
            while (c < row.length) {
                var ch = row[c];
                if (ch === "." || !slots[ch]) {
                    c++;
                    continue;
                }
                var e = c + 1;
                while (e < row.length && row[e] === ch)
                    e++;
                k.fillStyle = slots[ch];
                k.fillRect(x + c * s, y + r * s, (e - c) * s, s);
                c = e;
            }
        }
    }
    function cached(key, build, w, h) {
        key = gen + "|" + key;
        var c = cache[key];
        if (c)
            return c;
        c = canvas(w || TILE, h || TILE);
        build(k2d(c), c);
        cache[key] = c;
        return c;
    }
    function fill(k, c) { k.fillStyle = c; k.fillRect(0, 0, TILE, TILE); }
    /** N=1 E=2 S=4 W=8: the sides whose neighbour is a different kind of ground */
    function edges4(k, g, slots, mask) {
        var dirs = [g, rot(g), rot(rot(g)), rot(rot(rot(g)))];
        for (var i = 0; i < 4; i++)
            if (mask & (1 << i))
                stamp(k, dirs[i], slots, 0, 0);
    }
    /* ── what game.js asks for ──────────────────────────────── */
    var api = {
        TILE: TILE, FRAMES: FRAMES, FAMILIES: FAMILIES,
        theme: function (p) { P = p; gen++; cache = {}; groundCache = {}; bright = lum(p.paper) > lum(p.ink) ? p.paper : p.ink; dark = bright === p.paper ? p.ink : p.paper; },
        ready: function () { return !!P; },
        mix: mix,
        grass: function (v, d) { return cached("g" + v + "." + d, function (k) { var s = ground(d); fill(k, s.g); stamp(k, GRASS[v % GRASS.length], s, 0, 0); }); },
        flower: function (v, d) { return cached("f" + v + "." + d, function (k) { var s = ground(d); fill(k, s.g); stamp(k, GRASS[(v + 1) % GRASS.length], s, 0, 0); stamp(k, FLOWER[v % FLOWER.length], s, 0, 0); }); },
        road: function (v, d, mask) {
            return cached("r" + v + "." + d + "." + mask, function (k) { var s = ground(d); fill(k, s.r); stamp(k, ROAD[v % ROAD.length], s, 0, 0); edges4(k, ROAD_EDGE, s, mask); });
        },
        sand: function (v, d) { return cached("s" + v + "." + d, function (k) { var s = ground(d); fill(k, s.s); stamp(k, SAND[v % SAND.length], s, 0, 0); }); },
        tree: function (v, d) { return cached("t" + v + "." + d, function (k) { var s = ground(d); fill(k, s.g); stamp(k, GRASS[v % GRASS.length], s, 0, 0); stamp(k, TREE[v % TREE.length], s, 0, 0); }); },
        cliff: function (v, d, mask) {
            return cached("c" + v + "." + d + "." + mask, function (k) {
                var s = cliffSlots(d);
                fill(k, s.c);
                stamp(k, CLIFF[v % CLIFF.length], s, 0, 0);
                if (mask & 4)
                    stamp(k, CLIFF_S, s, 0, 0);
                if (mask & 8)
                    stamp(k, CLIFF_W, s, 0, 0);
                if (mask & 2)
                    stamp(k, flip(CLIFF_W), s, 0, 0);
                if (mask & 1)
                    stamp(k, CLIFF_N, s, 0, 0);
            });
        },
        /* mask: N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128, set where the neighbour is land */
        water: function (mask, frame) {
            frame = ((frame % FRAMES) + FRAMES) % FRAMES;
            return cached("w" + mask + "." + frame, function (k) {
                var s = waterSlots();
                fill(k, s.w);
                stamp(k, WATER[frame], s, 0, 0);
                var shore = SHORE[frame], sides = [shore, rot(shore), rot(rot(shore)), rot(rot(rot(shore)))];
                var corner = SHORE_CORNER, corners = [corner, rot(corner), rot(rot(corner)), rot(rot(rot(corner)))]; // NW NE SE SW
                var land = [!!(mask & 1), !!(mask & 4), !!(mask & 16), !!(mask & 64)]; // N E S W
                for (var i = 0; i < 4; i++)
                    if (land[i])
                        stamp(k, sides[i], s, 0, 0);
                if ((mask & 128) && !land[0] && !land[3])
                    stamp(k, corners[0], s, 0, 0);
                if ((mask & 2) && !land[0] && !land[1])
                    stamp(k, corners[1], s, 0, 0);
                if ((mask & 8) && !land[2] && !land[1])
                    stamp(k, corners[2], s, 0, 0);
                if ((mask & 32) && !land[2] && !land[3])
                    stamp(k, corners[3], s, 0, 0);
            });
        },
        bridge: function (vertical) {
            return cached("b" + (vertical ? "v" : "h"), function (k) {
                var w = waterSlots();
                fill(k, w.w);
                stamp(k, WATER[0], w, 0, 0);
                var p = P, s = { t: p.warnDim, P: lighten(p.warnDim, 0.25), k: darken(p.warnDim, 0.5) };
                stamp(k, vertical ? rot(BRIDGE) : BRIDGE, s, 0, 0);
            });
        },
        town: function (d) { return cached("T" + d, function (k) { var g = ground(d); fill(k, g.g); stamp(k, GRASS[0], g, 0, 0); stamp(k, TOWN, stoneSlots(), 0, 0); }); },
        door: function (d, open) { return cached("D" + d + (open ? "o" : "s"), function (k) { var g = ground(d); fill(k, g.g); stamp(k, open ? DOOR_OPEN : DOOR_SEALED, stoneSlots(), 0, 0); }); },
        keep: function (d, cleared) {
            return cached("K" + d + (cleared ? "c" : "u"), function (k) {
                var g = ground(d);
                fill(k, g.g);
                stamp(k, GRASS[1], g, 0, 0);
                var s = stoneSlots();
                s.F = cleared ? P.ok : P.bad;
                stamp(k, KEEPS[Math.max(0, Math.min(KEEPS.length - 1, d - 1))], s, 0, 0);
            });
        },
        /* state: 0 shut, 1 open, 2 passed */
        gate: function (state) {
            return cached("G" + state, function (k) {
                var p = P, g = ground(0), s = stoneSlots();
                fill(k, g.s);
                stamp(k, SAND[0], g, 0, 0);
                s.a = state === 2 ? p.ok : state === 1 ? lighten(p.viol, 0.5) : darken(p.viol, 0.55);
                stamp(k, GATE, s, 0, 0);
                if (state === 0)
                    stamp(k, GATE_BARS, { A: p.accent }, 0, 0);
            });
        },
        hero: function (face, frame) {
            var f = HERO[face] ? face : "d";
            return cached("h" + f + (frame & 1), function (k) { stamp(k, HERO[f][frame & 1], heroSlots(), 0, 0); });
        },
        enemy: function (family, scale) {
            scale = scale || 3;
            var fam = ENEMIES[family] ? family : "workload";
            return cached("e" + fam + "." + scale, function (k) { stamp(k, ENEMIES[fam], enemySlots(fam), 0, 0, scale); }, 32 * scale, 32 * scale);
        },
        familyOf: familyOf,
        /** a strip of scenery behind a town menu: the square, the inn, the shop, or the people */
        backdrop: function (scene, d, w, h) {
            return cached("bd" + scene + "." + d + "." + w + "x" + h, function (k) {
                var p = P, g = ground(d), s = stoneSlots();
                k.fillStyle = mix(p.s1, tintOf(d).c, 0.08);
                k.fillRect(0, 0, w, h);
                var floor = h - TILE * 2;
                var x;
                if (scene === "inn" || scene === "shop") {
                    k.fillStyle = darken(p.s2, 0.1);
                    k.fillRect(0, 0, w, floor); // the wall
                    k.fillStyle = darken(p.s3, 0.2);
                    k.fillRect(0, floor, w, h - floor); // the boards
                    k.fillStyle = darken(p.s3, 0.35);
                    for (x = 0; x < w; x += 12)
                        k.fillRect(x, floor, 1, h - floor);
                    if (scene === "inn") {
                        stamp(k, BED, s, 24, floor - 24, 2);
                        stamp(k, BED, s, 64, floor - 24, 2);
                        stamp(k, LANTERN, s, 112, floor - 40, 2);
                        stamp(k, VILLAGER, folk(p.warnDim), 160, floor - 28, 2);
                    }
                    else {
                        stamp(k, COUNTER, s, 20, floor - 22, 2);
                        stamp(k, VILLAGER, folk(p.viol), 100, floor - 28, 2);
                        stamp(k, LANTERN, s, 150, floor - 40, 2);
                    }
                }
                else {
                    for (x = 0; x < w; x += TILE) {
                        k.drawImage(api.grass((x / TILE) % 4, d), x, floor);
                        k.drawImage(api.grass((x / TILE + 2) % 4, d), x, floor + TILE);
                    }
                    k.fillStyle = g.r;
                    k.fillRect(0, floor + 6, w, TILE); // the road through the square
                    k.fillStyle = g.q;
                    k.fillRect(0, floor + 6, w, 1);
                    k.fillRect(0, floor + 6 + TILE - 1, w, 1);
                    stamp(k, HOUSE, s, 8, floor - 30, 2);
                    stamp(k, INN, s, 56, floor - 30, 2);
                    stamp(k, SHOP, s, 104, floor - 30, 2);
                    stamp(k, WELL, s, 160, floor - 24, 2);
                    stamp(k, TREE[0], g, 200, floor - 30, 2);
                    if (scene === "talk") {
                        stamp(k, VILLAGER, folk(p.accent), 236, floor - 26, 2);
                        stamp(k, VILLAGER, folk(p.bad), 262, floor - 26, 2);
                    }
                }
            }, w, h);
        },
        /** the grids that are not the size they claim; empty when the art is sound */
        check: function () {
            var bad = [];
            var sq = function (name, g, n) { if (g.length !== n || g.some(function (r) { return r.length !== n; }))
                bad.push(name); };
            GRASS.forEach(function (g, i) { sq("grass" + i, g, TILE); });
            FLOWER.forEach(function (g, i) { sq("flower" + i, g, TILE); });
            ROAD.forEach(function (g, i) { sq("road" + i, g, TILE); });
            SAND.forEach(function (g, i) { sq("sand" + i, g, TILE); });
            WATER.forEach(function (g, i) { sq("water" + i, g, TILE); });
            CLIFF.forEach(function (g, i) { sq("cliff" + i, g, TILE); });
            TREE.forEach(function (g, i) { sq("tree" + i, g, TILE); });
            KEEPS.forEach(function (g, i) { sq("keep" + i, g, TILE); });
            [["bridge", BRIDGE], ["town", TOWN], ["door-sealed", DOOR_SEALED], ["door-open", DOOR_OPEN], ["gate", GATE], ["gate-bars", GATE_BARS], ["cliff-s", CLIFF_S], ["cliff-w", CLIFF_W]].forEach(function (x) { sq(x[0], x[1], TILE); });
            Object.keys(PROPS).forEach(function (n) { sq("prop-" + n, PROPS[n], TILE); });
            Object.keys(HERO).forEach(function (f) { HERO[f].forEach(function (g, i) { sq("hero-" + f + i, g, TILE); }); });
            FAMILIES.forEach(function (f) { sq("enemy-" + f, ENEMIES[f], 32); });
            [SHORE[0], SHORE[1], SHORE[2], SHORE_CORNER, CLIFF_N, ROAD_EDGE].forEach(function (g, i) { if (g.some(function (r) { return r.length !== TILE; }))
                bad.push("edge" + i); });
            return bad;
        }
    };
    window.CNPE_ART = api;
})();
