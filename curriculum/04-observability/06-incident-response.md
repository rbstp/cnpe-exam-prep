# 4.6 Incident response: diagnosis under a clock

Competency: diagnosing and remediating platform issue and incident scenarios (domain 4, 20%). Needs: `make core obs sec` for the full drill set; individual faults need less.

This is the highest-leverage section in the curriculum. Incident tasks are where exam time evaporates, and the repo's `make break` exists precisely because this skill cannot be read into existence. The concepts fit in half a page; the rest is reps.

## A method, so you never freelance under pressure

1. Blast radius first: what is broken and what still works. `kubectl get pods -A | grep -v Running`, `make status`, the top-level dashboards. One namespace or all? Data plane or control plane?
2. Timeline second: what changed. `kubectl get events -A --sort-by=.lastTimestamp | tail -30`, recent syncs in Argo CD, `helm list -A` for fresh revisions. Most incidents are deployments wearing a costume.
3. Then descend one resource at a time: describe → events → logs → previous logs (`--previous`, for crash loops) → exec/debug. Resist skipping levels; the fast-looking jump is where wrong theories come from.
4. Fix the cause, then *prove recovery* with the same signal that showed the failure. If you found it via a failing curl, the incident ends with that curl succeeding, not with a pod showing Running.

The signal-to-layer map worth memorising: Pending pods → scheduling (resources, taints, PVCs, quota). ImagePullBackOff → registry, tag, pull secrets. CrashLoopBackOff → the app itself, read `--previous`. Running-but-broken → network policy, DNS, config, RBAC, and this is where `kubectl get pods` stops helping and Hubble, `auth can-i`, and application logs start. OOMKilled → limits (section 1.2). Forbidden in a controller's logs → RBAC, not the workload.

Two tools people forget exist: `kubectl debug -it <pod> --image=busybox --target=<container>` attaches an ephemeral container to a distroless pod that has no shell, and `kubectl debug node/<node> -it --image=busybox` gets you a node shell without SSH. The exam environment has both.

## Exercises

**The seven faults, cold.** One session per few days, not all at once:

```bash
make break            # random; 7-minute target
make break-answer     # only after you have committed to a diagnosis
```

Then drill the ones that hurt, by name: `FAULT=image`, `probe`, `resources`, `rbac`, `quota`, `netpol`, `config`. The rbac fault is invisible in pod listings and only surfaces under `kubectl auth can-i --as=...`; the netpol fault leaves everything Running while DNS is dead (the additive-allow-list lesson from 1.4). Verify each drill honestly: your diagnosis written down *before* `make break-answer`, and the fix confirmed by the failing behaviour now succeeding. `make break-fix` afterwards shows the evidence trail a systematic diagnosis would have followed; compare it with the path you actually took and note where you diverged.

**Diagnose with telemetry, not just kubectl.** Run `FAULT=probe make break`, but restrict yourself for the first three minutes to Grafana, Prometheus, and Loki only: find the symptom in the namespace dashboard (restarts, readiness), the failing pod in `kube_pod_container_status_ready`, and the evidence in its logs via Explore. Then finish with kubectl. Verify: the telemetry told you which pod and roughly why before you ever described it. The exam's observability tasks assume tools-first diagnosis, and this inverts your kubectl habit deliberately.

**One structured postmortem.** After any drill, write five lines: symptom, blast radius, root cause, fix, the check that proves recovery. Verify: a stranger could re-run your incident from those lines. Five minutes, once per drill; this is what a "structured incident response process" reduces to in practice.

**The stack repair.** Course platforms end this module with a scripted "repair a broken stack" lab; the version here is meaner and unscripted: pick a layer, delete something load-bearing but subtle (a ServiceMonitor, the Loki datasource ConfigMap, kyverno's webhook... choose while *not* thinking about diagnosis), do something else for an hour, then come back and find it via `make validate`, whose failing checks are your incident ticket. Verify: `make validate` returns to PASS with FAIL 0. Self-inflicted incidents with a validation suite are the closest thing to a free exam simulator this repo has.

## Docs to know your way around

- kubernetes.io: Debug Pods / Debug Running Pods (the ephemeral containers page), Troubleshooting Applications flowchart
- Your own postmortem notes; by the third drill they are the best incident doc you own
