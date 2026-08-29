<!-- Gist filename: cnpe-study-console.md
     Gist description (one line, shown in the gist list and on the blog card):

     Twenty-nine evening-sized sections over the whole CNPE curriculum, every exercise
     ending in a command that proves it, published as a site with no build step that
     also runs off a USB stick. #certification #cnpe #study
-->

# The lab was the easy half. This is the curriculum that drives it

[Last time](https://gist.github.com/rbstp/310b6468965d431012494df3d860ca13) I published the CNPE
lab: an internal developer platform on `kind` as layered `make` targets, with 71 checks that ask
whether things work rather than whether pods are Running. That was the machinery. It does not tell
you what to actually *do* with it on a Tuesday evening.

This is the other half: twenty-nine evenings of study plan, and about 58,000 words of it.

**[cnpe.rbstp.dev](https://cnpe.rbstp.dev)**

Twenty-nine sections across the five exam domains, each sized for one evening, covering every
competency in the official curriculum PDF. Concepts, then exercises against the lab, then a
self-check. It is a self-contained site rather than a pile of markdown, so opening
`curriculum/index.html` in a browser works with no server and no build step, and `make study` does
it from the clone.

## Every exercise ends in a command

The lab's rule carries over: never trust "the pod is Running", make it do something. All 123
exercises finish with a command whose output proves the thing worked, and there is no exercise
without one.

Underneath seventy-one of the command blocks sits a collapsed drawer holding the real output of
that command. Not an illustrative sample: every one of them was captured against a freshly built
lab on 26 August 2026, and each drawer carries that date. It means the sections read on a train,
away from a cluster, and it means the honest failures are in there too. Expand a drawer only after
predicting what it should say, because the guessing is the exercise. The lab's chart versions float
on purpose, so your output will drift from mine, and noticing which parts drifted is worth more
than the reading.

Writing that down changed the curriculum more than anything else I did. Predicting what a command
prints and then running it is where the drift between what I believed and what Kubernetes does
showed up, section after section.

## Two hours is the entire design constraint

The exam is 120 minutes of performance-based tasks on a remote desktop. Roughly 15 to 20 tasks in
two hours is 6 to 8 minutes each, and every design decision here falls out of that number. It is
why `make break` runs a 7-minute clock. It is why both mock exams (fifteen tasks each, no task
shape shared between the papers, scored separately) carry a built-in 120-minute clock and a
grading block you run with `make grade`. It is why the first exam-day tactic on the dashboard is
to flag and move on, because a stuck task costs you two easy ones.

The other constraint people underestimate is documentation. The exam instructions allow
kubernetes.io/docs plus the task-specific links in each question's Quick Reference panel, and
prohibit the rest. Tool documentation reaches you only through those links. That makes
`kubectl explain --recursive`, `kubectl api-resources | grep <tool>` and `--help` your primary
references, so every section leans on them rather than on a URL you will not be able to open.

Domain weights are not study time, either. Domains 2 and 3 are half the exam and are mostly
mechanical skills that improve with reps. Domain 1 and half of domain 5 are things you probably
already know if you run Kubernetes for a living. Check yourself against the exercises before
spending evenings there.

## The drill remembers what you keep missing

The 148 self-check questions double as flashcards. Each card sits on its own schedule: SM-2's
shape, but over the counters the console already kept, so nothing new is stored. Right net of
missed puts a card on a rung; each rung waits longer than the last by an ease its own miss rate
sets; a miss costs a rung and makes the card due now. Reviews cap at 21 days, because the exam is
weeks away and not years.

Ten cards fills the day. A weak-spots panel splits lifetime accuracy by domain and will not call a
domain weak until you have answered five in it, since one bad card is noise and a trend is a
signal. And any study action at all, a card answered, an exercise verified, a section completed, a
mock task scored, keeps the day green on the dashboard's streak.

## Thirteen figures you can break

Thirteen figures across twelve sections are interactive rather than decorative, which was a
deliberate choice about which concepts get a picture at all. Drag a pod's memory request until the
QoS class flips, and the eviction verdict underneath flips with it. Ask a canary for 10% of traffic
at four replicas and watch what it actually gets, because a replica count cannot express that
weight. Restart a process mid-window and watch `rate()` add back the counter it lost, where a plain
subtraction would go negative and lie to you. Those are the ideas people get wrong under time
pressure, and a diagram you can break teaches them better than a paragraph does.

## Four things that cost me real time

**`file://` has no origin, and that decides the whole architecture.** An ES module loaded from a
local file is a cross-origin request from a null origin, so it never loads, and `fetch()` of a
sibling JSON file fails the same way. A study site you can read on a plane therefore cannot have a
module graph, a bundler, or a data file it loads at runtime. Everything is plain script tags, and
the flashcard bank is *generated* into a JS file that assigns a global. Which creates the next
problem: that file can go stale the moment you edit a question. CI regenerates it and fails the
build if the result differs.

**Un-ticking does not survive last-write-wins.** Progress syncs between browsers if you sign in,
and my first version compared timestamps. Untick an exercise on the laptop, open the desktop, and
the desktop's older copy still holds the tick, so it comes back. Newer is not the same thing as
correct. What you need is the last state both sides agreed on, kept locally as a base, and a
three-way merge: if local still equals the base, take the remote, otherwise keep local. A removal
travels then. One corollary matters more than it looks: a key that is simply absent from the other
copy is a key that copy never had, not one it deleted, so un-ticking writes a 0 and never drops the
key. Otherwise a browser that saved an old copy of everything reads as a mass deletion.

**Counters and tick-boxes cannot merge the same way.** Right and miss totals are lifetime records,
so they take the per-field maximum: replacing a record wholesale with the other side's copy loses
answers. Only the last-answer fields follow the clock, and on an exact timestamp tie the miss wins
so both machines land on the same record rather than diverging forever. A running exam clock
travels nowhere at all: it stays on the machine that started it, which is the only reading of a
120-minute timer that is not a lie.

**GitHub Pages caches every file for ten minutes, so a deploy arrives in pieces.** For those ten
minutes a browser can hold the new HTML against the stylesheet it cached before it, which looks
exactly like a CSS bug and is not one. The staging script now stamps every asset reference with a
hash of that file's bytes, fonts first so a changed font changes the stylesheet's hash too. The URL
changes precisely when the file changes, and a page always pulls its own version of the console.

## Using it

```
git clone https://github.com/rbstp/cnpe-exam-prep.git && cd cnpe-exam-prep
make study          # opens curriculum/index.html, no server, no build
make grade EXAM=1   # runs mock exam 1's grading block against your lab
```

Or read it at [cnpe.rbstp.dev](https://cnpe.rbstp.dev). There is also a single-file build at
[cnpe.rbstp.dev/console.html](https://cnpe.rbstp.dev/console.html): all 33 pages, the figures, the
drill and the fonts inlined into one 1.1 MB document. Save it and it works offline forever, which
is the version I would put on a USB stick.

Press `/` to jump to any section by name, tool or concept, `g` for a drill session, `t` for the
theme and `?` for the rest. Progress lives in your browser's local storage; Export and Import move
it between machines as a JSON file. On the hosted site you can optionally sign in with GitHub to
keep a copy across machines: off by default, identity only (the OAuth scope is literally empty, so
the token opens nothing), and signed out, or over `file://`, the console makes no network request
at all.

MIT licensed, same repo as the lab: **[github.com/rbstp/cnpe-exam-prep](https://github.com/rbstp/cnpe-exam-prep)**.
I am still working through the material, so both halves keep moving.
