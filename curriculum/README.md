# CNPE curriculum

This directory is a small self-contained site, not markdown. Open **[`index.html`](index.html)**
in a browser (no server, no build step, `file://` works), or run `make study` from the repo root.
GitHub will not render it in place; clone the repo (or use raw + a local browser) to read it.

- `index.html`: the dashboard, with the map, competency coverage, study plan and exam-day tactics
- `mock-exam.html`, `mock-exam-2.html`: two papers of 15 timed tasks each (no task shape shared, scored separately) with grading commands and a 120-minute clock
- `drill.html`: every self-check question as flashcards, weighted toward what you miss; ten a day is the drill's daily goal, and any study action (a card answered, an exercise verified, a section completed, a mock task scored) is a heartbeat for the dashboard's console-wide study uptime
- `0*-…/*.html`: the 29 sections, each theory + exercises + self-check
- `assets/`: one stylesheet, the section manifest (`nav.js`), the page runtime (`app.js`), the interactive figures (`widgets.js`), the theme switch (`theme.js`, loaded from `<head>`) and the typefaces
- `assets/fonts/`: IBM Plex Sans, Sans Condensed and Mono (latin subsets), shipped so the console needs no network; SIL OFL 1.1, see `OFL.txt`
- `tools/bundle.py`: bundles the whole console into one hash-routed HTML file (`python3 tools/bundle.py`, or `--fragment` for a host that supplies its own `<head>`), handy for sharing or reading it somewhere that takes a single document
- `tools/extract-drill.py`: regenerates `assets/drill-data.js` from the section pages' self-check panels; run it after editing any self-check question (CI fails the deploy if the file is stale)
- `tools/browser-checks/`: drives a staged copy of the site in headless Chromium (Playwright) and asserts its behaviour end to end — the study streak, the command palette and keyboard shortcuts, the mock-exam clock, the drill's weighted deck, export/import/reset, the section-page controls and the weak-spots panel (`node tools/browser-checks/run.js <site-dir>`); CI runs it on every PR
- `assets/cnpe.d.ts` + `jsconfig.json` (+ `tools/browser-checks/tsconfig.json`): JSDoc-based type checking for all of the above JS via `tsc --noEmit` (`make typecheck` from the repo root); the `.d.ts` documents the shapes the scripts share — the section manifest, the drill bank, the `cnpe:v2` progress store and the `CNPE_*` window globals — and CI runs the check on every PR. It is a check only: the browser still loads the plain `.js` files and nothing is compiled

Most command blocks carry a collapsed **output** drawer underneath: the real result of that
command, so the sections read self-contained even away from a running cluster. Every command block
in the curriculum was run, and its output captured, against a freshly built lab on
**August 26, 2026** (the date each drawer carries). Expand a drawer only after predicting what
it should say; the lab's tool versions float, so details may drift from what your lab prints.

Press `/` in any page to jump to a section by name, tool or concept, `g` for a drill session,
`t` to switch the theme (system, light or dark; system by default) and `?` for the shortcuts.
Progress (exercises verified, sections completed, drill history, the study streak) is stored in your browser's local storage.
Thirteen interactive figures sit across twelve sections (QoS and eviction, node capacity, quota
binding, right-sizing cost, the request path, the reconciliation loop, sync × health,
canary weights, counters and `rate()`, alert timing, the admission pipeline, PSS profiles
and RBAC scope), each wired to the concept it explains.
