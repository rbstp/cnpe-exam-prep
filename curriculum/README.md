# CNPE curriculum

This directory is a small self-contained site, not markdown. Open **[`index.html`](index.html)**
in a browser (no server, no build step, `file://` works), or run `make study` from the repo root.
GitHub will not render it in place; clone the repo (or use raw + a local browser) to read it.

- `index.html`: the dashboard, with the map, competency coverage, study plan and exam-day tactics
- `mock-exam.html`, `mock-exam-2.html`: two papers of 15 timed tasks each (no task repeated between them, scored separately) with grading commands and a 120-minute clock
- `drill.html`: every self-check question as flashcards, each on its own spaced-repetition schedule and weighted toward what you miss; ten a day is the drill's daily goal, and any study action (a card answered, an exercise verified, a section completed, a mock task scored) is a heartbeat for the dashboard's console-wide study uptime
- `game.html`: CNPE Quest, a role-playing game over the whole curriculum. Five regions are the five domains and 29 towns are the 29 sections; the townsfolk teach a section's ideas and hand out its command families, the town's trial is its own self-check cards as multiple choice (every answer written into the drill's record, and a heartbeat for the streak), and the dungeon behind it holds a fault, the kind `make break` injects, fought with real `kubectl`, `argocd`, `flux`, `tkn`, `crossplane` and `cosign` commands against a simulated cluster. A keep per region chains two faults; the Exam gate draws three
- `0*-…/*.html`: the 29 sections, each theory + exercises + self-check
- `assets/`: the stylesheet (`style.css`), the section manifest (`nav.js`), the two DOM-free modules the runtime reads (`merge.js`, the progress merge and the rules around it, and `syntax.js`, the command-block coloring; neither touches the DOM, storage or the network, which is what lets `tools/merge-test.mjs` and `tools/syntax-test.mjs` drive them in bare node; both are compiled from TypeScript in `src/console/`), the page runtime (`app.js`), the interactive figures (`widgets.js`), the drill (`drill.js`), the optional progress sync (`sync.js`), the theme switch (`theme.js`, loaded from `<head>`; `onChange`/`offChange` for a listener that comes and goes with a mount) and the typefaces
- The quest is four more scripts and a stylesheet, loaded only by `game.html` (and inlined into the bundle). It is written in TypeScript: the sources are `src/game/*.ts`, `tools/build-ts.sh` (or `make ts`) compiles them with `tsc` into `assets/`, and the compiled scripts are committed, so the site still needs no build step and `file://` still works; `tools/build-ts.sh --check` fails CI when the committed output drifts from its source, the way `extract-drill.py --check` does for the drill bank
  - `game-data.js`: the map, the towns and their people, the techniques and items, and the 24 fault scenarios with their fake-cluster resource tables, evidence matchers and fixes
  - `game-sim.js`: the DOM-free command interpreter that normalizes a typed command and answers it from a scenario's table; `tools/game-sim-test.mjs` drives it in bare node
  - `game-art.js`: every tile, the player, the eight enemy families and the town scenery as small palette-indexed pixel grids, painted to canvases from the theme's colors on demand, so the same grids serve both themes and nothing is a picture file
  - `game.js`, the engine. The overworld is a canvas: the whole map is one terrain cache blitted per frame at the camera's pixel position, repainted in full only for a new palette and patched tile by tile when a door, a keep or the gate changes state. Over it move the water, the flowers, the chimney smoke and the door torches (one 420 ms beat, only where in view), the banners and the player. A step is a 120 ms tween through whole pixels, the walk cycle keyed to its five sub-positions (standing, the two halves of a stride and the pass between them), the next step queued behind one in flight so a held key never skips a tile; back on the map from a scene, the camera eases to the player over 180 ms, never through a step and not at all where it already stands or under reduced motion. The minimap is a pixel a tile, its backing store scaled for the device's pixel ratio behind the box `game.css` sets in a custom property, built from the cache and touched only where the player's dot, the viewport's frame (in the accent while the stage has focus) and the signpost's ring move. The signpost is where next, as a road sign would put it: the nearest town still offering its trial or its dungeon, then the nearest open keep, then the Exam gate; it is named with its steps and its way in the where window, ringed on the minimap and said in the canvas's label. All of it runs on `requestAnimationFrame` behind a dirty flag, with instant steps, still tiles and a steady dot under `prefers-reduced-motion`. The town, trial, battle and shop scenes are DOM; the battle screen is built once and updated in place so a long terminal log stays cheap, with a per-battle command history on the prompt's arrows, damage and xp floating up from the monster and the guard bar, the guard bar shaking on evidence, the stage's edge flashing on a hit (CSS classes lifted on `animationend`, or by the clock under reduced motion, and recorded in `data-fx`) and a fall per fault family on a win
  - `game.css`: the quest page around the game and the game's own windows and scenes
  - `CNPE_GAME.mount()` builds into `#game-app`; `CNPE_GAME.unmount()` takes everything down again (the animation frame, the beat, every timer, the listeners including the theme's through `CNPE_THEME.offChange`, the observers and the caches), so the bundle's router can call the pair around every visit to `#GM`. `CNPE_GAME.debug()` reports the renderer's frame, cache, patch, minimap, camera and step counters for the browser checks and for profiling, and carries two test hooks, `tick()` (one beat of the water's ticker) and `settle()` (every pending one-shot timer and a keep's pending swap, fired now), so the checks drive time rather than wait on it; the types are in `assets/cnpe.d.ts`
  - The game's progress is the `game` bucket of the `cnpe:v2` store: xp, gold and items as per-browser counters that add up across browsers, towns cleared, techniques learned, battles won and where you stood; `merge.js` merges it with the rest and the sync carries it unchanged
- Two of those ship per page rather than site-wide, because most pages do not use them. `widgets.js` is 52 KB and twelve pages draw a figure, so only those twelve pull it. The question bank splits in two: `drill-data.js` carries every question and answer and only the drill loads it, while the dashboard loads `drill-index.js`, the same cards stripped to id and section, which is all its due-count and weak-spots panel read. Both pairings are asserted by `tools/check-site.sh`, so a page that grows a figure, or reaches for the bank it does not need, fails the deploy
- `assets/fonts/`: IBM Plex Serif, Sans and Mono, shipped so the console needs no network; the sans is one variable file covering wght 100-700, the other six are static weights. Pages use sans-serif prose and navigation, serif page titles, and monospaced commands; the quest's menus use the sans and the mono. SIL OFL 1.1, see `OFL.txt`. Each face carries only the characters the console writes, cut from the latin builds in `tools/fonts-src/` by `tools/subset-fonts.py`. A cut is a Modified Version, and the OFL reserves the name "Plex", so the faces present as `CNPE Serif`, `CNPE Sans` and `CNPE Mono` (which is what the stylesheet asks for); IBM's copyright, version and license records travel with them untouched, and each face carries a description naming what it was cut from
- `tools/bundle.py`: bundles the whole console into one hash-routed HTML file (`python3 tools/bundle.py`, or `--fragment` for a host that supplies its own `<head>`), handy for sharing or reading it somewhere that takes a single document
- `tools/extract-drill.py`: regenerates `assets/drill-data.js` and `assets/drill-index.js` from the section pages' self-check panels; run it after editing any self-check question (CI fails the deploy if either file is stale)
- `tools/subset-fonts.py`: re-cuts `assets/fonts/` from the untouched latin builds in `tools/fonts-src/` down to the characters the pages, scripts, stylesheet and generated 404 actually use, which is 118 characters out of everything those builds carry: 308 KB of faces becomes 124 KB, twice over, since the bundle inlines them again. It also renames each face off the reserved "Plex", leaving the attribution records alone. It needs `fonttools` and `brotli`, so the result is committed rather than built, and it writes everything the check needs into `tools/fonts-src/cut.txt`: the codepoints it removed, and a hash of every face on both sides. `--check` reads that file and no font, so CI needs no font library, and it fails on either half: new prose reaching for a character the cut removed, or faces that have drifted from the record. Run `make fonts` and commit `assets/fonts/` with `cut.txt` when it fires
- `tools/syntax-test.mjs`: drives `assets/syntax.js` over plain strings: which runs each language paints, that a quoted string or a whole-line comment shields what is inside it, and that markup the page already escaped round-trips untouched (`node tools/syntax-test.mjs`, or `make syntax`); no dependencies, no browser, and CI runs it on every PR
- `tools/game-sim-test.mjs`: drives `assets/game-sim.js` and every scenario in `assets/game-data.js` in bare node: the normalization table (one command, many spellings), and for each of the 24 faults the commands that surface each piece of evidence, the documented fix, a plausible wrong fix and an unrelated command, plus the world's own consistency (every door leads to a real fault, every map char is a tile, every character is one the fonts carry); `node tools/game-sim-test.mjs`, or `make sim`; CI runs it on every PR
- `tools/merge-test.mjs`: drives `assets/merge.js` over plain objects: the whole base/local/remote truth table, the counter maxima, the guards on a payload that arrives over the network, and the sync's own rules for reading a base and shaping a payload (`node tools/merge-test.mjs`, or `make merge`); no dependencies, no browser, and CI runs it on every PR
- `tools/browser-checks/`: drives a staged copy of the site in headless Chromium (Playwright) and asserts its behavior end to end: the study streak, the command palette and keyboard shortcuts, the mock-exam clock, the drill's scheduled deck, export/import/reset, the optional sync, two tabs of one browser converging, the section-page controls, the weak-spots panel and the quest (a trial answer landing in the drill's record, a sealed door opening, a battle won in the terminal, the bundle's `#GM` route, both themes, the terrain cache repainted in full on a theme change and patched one tile on a door opening, a step tweening to the exact tile and skipping the tween under reduced motion, the walk cycle running stride, pass, stride over a step's sub-positions and the camera sliding with the sprite a pixel or two a frame under a driven clock, the living tiles moving on the beat and counted only in view, the camera easing back to the player through whole pixels and snapping under reduced motion, the minimap built once with its dot blinking and its frame following the camera on a HiDPI backing and taking the accent while the stage has focus, the signpost naming the trial, then the dungeon, then the nearest town left and ringing it on the minimap, three round trips through `#GM` leaving one animation loop, one ticker and no theme listener, the water stilled under reduced motion, the enemy sprite and the battle screen updating in place, the prompt's history, the floating numbers, the guard bar's shake and the stage edge's flash lifted by their animation or the clock, and the fall per fault family; the beat and the timers are driven through `debug().tick()` and `debug().settle()`, one real-time check per ticker aside) (`node tools/browser-checks/run.js <site-dir>`); CI runs it on every PR
- `src/`: the console's TypeScript, two directories each with its own strict `tsconfig.json` (target ES2017, plain scripts rather than modules, so each file compiles to the one global-assigning script the pages load): `src/game/` is the quest, `src/console/` is `merge.js` and `syntax.js`, the two DOM-free modules whose tests run in bare node. `make typecheck` checks them alongside the JS, `make ts` writes the compiled files, and `make ts-check` (CI) fails when a committed file drifts from its source
- `assets/cnpe.d.ts` + `jsconfig.json` (+ `tools/browser-checks/tsconfig.json`): JSDoc-based type checking for all of the above JS via `tsc --noEmit` (`make typecheck` from the repo root); the compiled quest files are excluded there, being checked at their TypeScript source; the `.d.ts` documents the types the scripts share (the section manifest, the drill bank, the `cnpe:v2` progress store and the `CNPE_*` window globals), and CI runs the check on every PR. It is a check only: the browser still loads the plain `.js` files and nothing is compiled

Most command blocks carry a collapsed **output** drawer underneath: the real result of that
command, so the sections read self-contained even away from a running cluster. Each drawer is
dated with the day it was captured against the lab. The original blocks carry
**August 26, 2026**, bar one on the 27th; the 163 exercises added in September carry **September 12** or
**September 13, 2026**, and were captured on Kubernetes 1.36.1, the `K8S_IMAGE` pin in force at
the time, before it moved to 1.37.0. Expand a drawer only after predicting what it should say; the lab's tool versions
float, so details may drift from what your lab prints.

The cluster those September drawers were captured against reported:

```
$ kubectl version
Client Version: v1.36.4
Kustomize Version: v5.8.1
Server Version: v1.36.1
```

No drawer is a placeholder: every one holds output that a real cluster produced. (Manifest
fragments in the theory panels are shown without a drawer; there is nothing to run.)

Press `/` in any page to jump to a section by name, tool or concept, `g` for a drill session, `q` for the quest,
`t` to switch dark / light (dark by default) and `?` for the shortcuts.
Progress (exercises verified, sections completed, drill history, the quest's level, gold and wins, the study streak) is stored in your browser's local storage.
On the hosted site, **Sign in** in the header optionally mirrors it to your GitHub account so a laptop and a
desktop agree; it is off by default, and signed out (or over `file://`) the console makes no network request at all.
See [../docs/progress-sync.md](../docs/progress-sync.md).
Thirteen interactive figures sit across twelve sections (QoS and eviction, node capacity, quota
binding, right-sizing cost, the request path, the reconciliation loop, sync × health,
canary weights, counters and `rate()`, alert timing, the admission pipeline, PSS profiles
and RBAC scope), each wired to the concept it explains.

## Quest presentation

The quest is drawn with its own 16-bit pixel art (no third-party characters, music or
assets) inside beveled game windows that take the console's charcoal-and-gold palette
from the page; `game.css` gives the scenery its natural terrain accents on `.gm`. The
engine reads the palette from the game host, so standalone and bundled play look alike,
and the dark/light switch repaints the art with the windows. Town scenes are 480 by 304
art pixels, fitted without cropping beside the upper-left menu with a full-width dialogue
panel below; battle backdrops are 480 by 144, layering the monster, player, guard/health
windows and action feedback over the scenery. On a phone, scene, compact menu and
dialogue stack.

Click or tap the map to plan a walkable route; direction keys, Escape and B cancel
travel, and intermediate landmarks are not entered automatically. The quest journal
(`q` on the map) lists all five regions and lets you track a town's trial and then its
dungeon on the compass and minimap for the visit; the usual nearest-objective guidance
resumes when that dungeon is cleared. Dungeons sit in impassable stone with one approach
from the town, drawn as a coordinated two-by-three-tile crypt; a sealed entrance stops
movement and battle entry alike, including auto-travel, and unlocking repaints only the
doorway. The public road bends around each dungeon and grants no progress.

Desktop mouse/keyboard play hides the touch-controller strip; fullscreen stays in the
toolbar on every device. Town conversations page with Next/Previous, keeping every
authored line and granting learning XP once. Shop stock pages in single rows, and
entering or paging a menu keeps keyboard focus in that menu. Sound is opt-in per visit
and synthesized with Web Audio: no audio assets, no network. Scene wipes, spell effects,
inn transitions and victory reveals follow `prefers-reduced-motion`. Evidence chains,
answer streaks, victory ranks and level-up callouts are feedback only; the simulator,
the XP/gold rules, the drill records and the progress schema do not see them.
`tools/browser-checks/game-presentation.js` covers these surfaces; `game.js` covers the
renderer, the study integration and the battle.

## Reading interface

Every page, the quest and the bundle included, is set from `style.css` alone: the
black-and-gold palette (dark by default, `t` for light), sans-serif reading
copy in a fluid column that uses the desktop width, bold menus, a larger breadcrumb, 32px
page titles (28px on a phone), 14px sidebar navigation and 13px supporting labels. The
decorative captions under section headings are hidden. Desktop tables may wrap long
identifiers; command and captured-output blocks never wrap. Read / Practice / Recall and
the exercise index are shortcuts into one continuous document, not content gates, and
opening an exercise from the index expands it. Reading links keep browser history; in the
single-file console a link such as `#2.2/application` names the lesson and the topic, so
a copied link or one opened in another tab lands in the same place without resetting an
open lesson's interactive models.

Each page opens with a **needs** chip naming the `make` targets its exercises want, and
ten of them close with a **free before x.y** chip: the layers the next section does not
need, and the `make down-<layer>` that removes each one. Both chips copy on click, and
the ten are only the transitions where something can actually be freed.

**Contents** opens the navigation at narrower widths. **Aa** switches reading copy
between 18px and 21px and stores the choice in `cnpe:reading-size`, apart from `cnpe:v2`,
so it is neither exported nor synchronized. **Focus view** (`f`) hides the rail and the
metadata and narrows the column while keeping Contents available; it lasts the visit.
Neither control appears on the quest page, whose quick-help panel starts collapsed. On
the quest page, desktop progress sits in a compact right-hand rail beside a game that fits
the remaining viewport height; a phone uses a four-column progress strip.

The 13 interactive models keep their controls, with 44px touch targets and readable
labels in both themes. The Argo CD model also lets you change the desired image and apply
it to the modeled live state; reapplying a missing image stays degraded. Models never
connect to a cluster or mark an exercise verified. The counter chart scrolls on its own
on narrow screens rather than shrinking its labels. `tools/browser-checks/reading.js`
checks the reading controls, the authored copy, bundle navigation and all 13 models'
interactions, type sizes, touch targets and accessibility in both themes;
`reading-layout.js` and `reading-navigation.js` cover the type scale, tables, overlap and
link history.
