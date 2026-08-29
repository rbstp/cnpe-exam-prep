# The lab was the easy half. This is the curriculum that drives it

[Last time](https://gist.github.com/rbstp/310b6468965d431012494df3d860ca13) I published the CNPE lab, an internal developer platform on `kind` as layered `make` targets, with 71 checks that ask whether things work rather than whether pods are Running. That was the machinery. It says nothing about what to do with it on a Tuesday evening.

This is the other half.

**cnpe.rbstp.dev**

Twenty-nine sections across the five exam domains, one evening each, covering every competency in the official curriculum PDF. Concepts, exercises against the lab, then a self-check. It is a static site with no build step, so `curriculum/index.html` opens straight out of the clone and `make study` does it for you. Thirteen of the figures are interactive, because dragging a pod's memory request until the QoS class flips beats reading about eviction order.

## Every exercise ends in a command

The lab's rule carries over. Never trust "the pod is Running", make it do something. All 123 exercises finish with a command whose output proves the thing worked.

Seventy-one of those command blocks carry a collapsed drawer holding the real output. I ran every one against a freshly built lab on 26 August 2026 and captured what it printed, the failures included. Predict the output first, then open the drawer. Chart versions float on purpose, so yours will drift from mine, and working out why is the exercise.

## Two hours is the whole design constraint

The exam is 120 minutes of performance-based tasks on a remote desktop. 15 to 20 tasks in two hours is 6 to 8 minutes each, and everything here falls out of that number. `make break` runs a 7-minute clock. Both mock exams carry a 120-minute clock and a grading block you run with `make grade`, fifteen tasks each, no task shape shared between the papers. The first exam-day tactic on the dashboard is to flag and move on, because a stuck task costs you two easy ones.

Documentation is tighter than people expect. The instructions allow kubernetes.io/docs plus the task-specific links in each question's Quick Reference panel, and prohibit the rest. Tool documentation reaches you only through those links. So `kubectl explain --recursive`, `kubectl api-resources | grep <tool>` and `--help` are your real references, and every section leans on them rather than on a URL you will not be able to open.

Domain weights are not study time. Domains 2 and 3 are half the exam and mostly mechanical skills that improve with reps. Domain 1 and half of domain 5 are things you already know if you run Kubernetes for a living. Check yourself against the exercises before spending evenings there.

## The drill

The 148 self-check questions double as flashcards on an expanding review interval, scaled by how often you miss the card. First review a day later, then four days, then multiply. Miss one and it comes back immediately, a rung lower. Nothing rests longer than 21 days, because the exam is weeks away and not years. A weak-spots panel splits lifetime accuracy by domain and wants five answers in a domain before calling it weak, since one bad card is noise.

## Using it

```
git clone https://github.com/rbstp/cnpe-exam-prep.git && cd cnpe-exam-prep
make study          # opens curriculum/index.html, no server, no build
make grade EXAM=1   # runs mock exam 1's grading block against your lab
```

Or read it at cnpe.rbstp.dev. There is a single-file build at cnpe.rbstp.dev/console.html too, all 33 pages and the fonts inlined into one 1.1 MB document that works offline. Progress lives in local storage, Export and Import move it as JSON, and signing in with GitHub is optional, off by default and identity only. The OAuth scope is empty, so the token opens nothing.

Twenty-nine evening-sized sections over the whole CNPE curriculum, every exercise ending in a command that proves it, published as a static site with no build step. #certification #cnpe #kubernetes #platformengineering
