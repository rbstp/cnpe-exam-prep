# CNPE curriculum

This directory is a small self-contained site, not markdown. Open **[`index.html`](index.html)**
in a browser — no server, no build step, `file://` works — or run `make study` from the repo root.
GitHub will not render it in place; clone the repo (or use raw + a local browser) to read it.

- `index.html` — dashboard: the map, competency coverage, study plan, exam-day tactics
- `mock-exam.html` — 15 timed tasks with grading commands and a 120-minute clock
- `0*-…/*.html` — the 29 sections, each theory + exercises + self-check
- `assets/` — one stylesheet, the section manifest (`nav.js`), and the page runtime (`app.js`)

Press `/` in any page to jump to a section by name, tool or concept, and `?` for the shortcuts.
Progress (exercises verified, sections completed) is stored in your browser's local storage.
