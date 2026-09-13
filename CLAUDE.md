# CLAUDE.md

Guidance for Claude Code and any other agent working in this repo. The repo is an
unofficial CNPE exam lab plus a self-contained study site under `curriculum/`.
Most of the work here is prose, so the writing rules come first.

## Writing style

These apply to everything: curriculum prose, the READMEs, `docs/`, code comments,
test descriptions, commit messages and PR bodies.

- **Concise.** Say the thing, then stop. No preamble, no restating the question
  back, no summary paragraph that repeats what the section just said.
- **Pragmatic.** Prefer what a reader does next over what a topic represents.
  Every claim should be checkable against the lab or the docs.
- **No em dashes.** Use a colon, a comma, parentheses, or two sentences. The
  box-drawing runs in code comments (`── like this ──`) are not em dashes and
  stay as they are.
- **American spelling**, matching the existing prose: normalize, materialize,
  behavior, defense, color, center, labeled, canceled, gray, practice (noun and
  verb). Keep the British form only where it is part of a name that has to match
  something real: the `aria-labelledby` attribute, Tekton's `CancelledRunFinally`
  and friends, Flagger's `Finalising` canary phase, the `cost-centre` label this
  lab's Kyverno policy writes, the `unlabelled` Deployment 5.2's policy exercise
  creates, the two shell comments in 4.3 and 5.5 whose drawers echo them, and the
  quest's NPC names, which are stored keys (`Harbourmaster Selda` stays as she
  is).
- **Say what a thing does**, not what it resembles. A metaphor that needs
  unpacking costs more than the sentence it saved.

### Words that read as machine-written

Avoid these. They were removed from the whole repo in one pass and should not
come back:

| Avoid | Use instead |
| --- | --- |
| shape, shaped (as a catch-all noun) | fields, pattern, form, task, mode, how it works |
| canonical | normalized (in code), the one you will see most (in prose) |
| load-bearing | the part everything else rests on, the decisive reason |
| seam, spine | interface, where they join, the line down the middle |
| footgun, smoking gun | the trap, the evidence |
| belt-and-suspenders, belt-and-braces | two independent checks |
| and honestly, one honest caveat, to be fair | drop the preamble, make the claim |
| gently push back, I'd push back on | say plainly what is wrong |
| leverage (as a verb or adjective) | use, the section that pays back the most |
| delve, robust, seamless, holistic, cornerstone | plain equivalents |

Three nuances:

- **`scope` is fine as Kubernetes terminology**: cluster-scoped, namespace-scoped,
  RBAC scope, an OAuth scope. Avoid it as a filler noun for the extent of
  something.
- **`blast radius` is fine, and wanted.** It is ordinary SRE and platform
  vocabulary, the exam's included, so this site should teach it rather than talk
  around it. A pass once replaced all 20 uses and they were put back.
- **Keep a listed word when it is the literal term of art.** The repo already
  does this for OperatorHub's `Seamless Upgrades` capability level, the Kyverno
  policy named `legacy-shape` in captured lab output, and the literal sprite and
  tile shapes in the quest renderer. Captured terminal output is never edited for
  style.

A `<details class="out">` drawer opens by echoing the command that produced it,
as `<b>$ …</b>`. That echo has to stay identical to the line in the command block
above it, comments included. So a word in a command block is only editable if you
edit it in the drawer too, and the drawer is frozen: leave both alone. Two shell
comments were caught this way during the American-spelling pass.

## Working in this repo

### Generated files are committed, so regenerate them

The site has no build step at read time. Anything generated is committed, and CI
fails when it drifts from its source.

| Change | Run | CI check |
| --- | --- | --- |
| `curriculum/src/**/*.ts` | `make ts` | `make ts-check` |
| a `<details class="quiz">` self-check panel | `python3 curriculum/tools/extract-drill.py` | `--check` |
| prose reaching for a new character | `make fonts` | `python3 curriculum/tools/subset-fonts.py --check` |

Never hand-edit `curriculum/assets/game*.js`, `merge.js`, `syntax.js`,
`drill-data.js` or `drill-index.js`.

### Checks to run before pushing

```
make typecheck                   # tsc over the JSDoc and the TypeScript sources
make ts-check                    # compiled assets match their sources
make merge syntax sim worker     # the DOM-free suites, plain node
make site && curriculum/tools/check-site.sh _site
make browser                     # headless Chromium end to end
```

`make browser` needs a Playwright Chromium matching the pinned version. Where the
environment ships a different build, point the runner at it:
`CHROMIUM_BIN=/path/to/chrome node curriculum/tools/browser-checks/run.js _site`.

### Stored progress is keyed on text

Two identifiers come from prose, so editing that prose resets what a reader had
ticked:

- exercise completion is keyed on `slug(data-title)` of a `.exercise`
- drill cards are keyed on the first 48 characters of the question text

Changing either is allowed, but say so in the PR body, and add the old key and the
new one to `MOVED_EX` or `MOVED_DRILL` in `curriculum/src/console/merge.ts`. That
table is the rename: it runs on both sides of every merge and once per load, so a
reader keeps the tick and the card keeps its score. Without it the old key stays
in the store forever, counted in the section totals while the exercise itself
reads unverified. Only ever add a key that genuinely moved; an entry says "these
two are one record", and folding two live keys together loses one of them.

`drill-index.js` coming back byte-identical from the regenerator is the proof that
no card id moved.
