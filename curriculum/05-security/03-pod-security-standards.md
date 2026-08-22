# 5.3 Pod Security Standards: the built-in baseline

Competency: applying Pod Security Standards to strengthen workload security, under the policy-engines umbrella (domain 5, 15%). Needs: `make up sec` (the tenant namespaces carry PSS labels).

PSS is the admission control you get without installing anything: three named profiles enforced by the built-in Pod Security admission controller, driven entirely by namespace labels. It is less expressive than Kyverno or Gatekeeper and that is its virtue; know exactly what each profile means and the label grammar, and these become the fastest points on the paper.

## Profiles and modes

The profiles: `privileged` is unrestricted. `baseline` blocks the known-bad: privileged containers, hostNetwork/hostPID/hostPath, added capabilities beyond a safe list. `restricted` demands actively-good: runAsNonRoot, `allowPrivilegeEscalation: false`, all capabilities dropped, seccompProfile RuntimeDefault. The one-liner: baseline stops you being dangerous, restricted forces you to be safe.

The modes, settable independently per namespace: `enforce` rejects at admission, `audit` annotates the audit log, `warn` prints warnings to the client. Label grammar: `pod-security.kubernetes.io/<mode>: <profile>`, plus optional `<mode>-version` pinning. team-a runs the recommended production stance: enforce baseline, warn and audit restricted, meaning nothing overtly dangerous gets in, and every restricted violation is visible to both the user (warning) and the platform (audit log) before anyone tightens the screw. That staged posture mirrors the Audit→Enforce choreography from 5.2; the pattern generalises.

Two operational facts that decide troubleshooting tasks: PSS evaluates *pods*, so a Deployment whose template violates the profile creates successfully and then fails to make pods, with the evidence in the ReplicaSet's events, two levels below where you were looking. And enforcement applies at admission, so tightening a namespace label does not evict existing violators; `kubectl label --dry-run=server --overwrite ns <ns> pod-security.kubernetes.io/enforce=restricted` previews who *would* break, which is the single most useful PSS command to know exists.

The demo app's manifest (`examples/demo-app/base/deployment.yaml`) is a worked answer to "make this pass restricted": read its securityContext blocks line by line, because writing exactly that block from memory is a plausible task.

## Exercises

**Get rejected by each profile.** In team-a (enforce: baseline):

```bash
kubectl -n team-a run priv --image=busybox:1.37 --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"priv","image":"busybox:1.37","command":["sleep","300"],"securityContext":{"privileged":true}}]}}'
```

Verify: rejected at admission, error naming the violated control. Then run a merely-lazy pod (`kubectl -n team-a run lazy --image=busybox:1.37 --restart=Never -- sleep 300`) and read the *warnings* it prints: admitted under baseline, flagged against restricted by the warn label. Two different outcomes, one namespace, and you can name which label produced each line of output.

**Fix a workload up to restricted.** Create namespace `hardened` with enforce restricted. Take the lazy pod spec and make it pass: runAsNonRoot true (busybox needs `runAsUser` too, e.g. 1000), allowPrivilegeEscalation false, capabilities drop ALL, seccompProfile RuntimeDefault. Iterate against the live error messages; they name the missing control each time, which makes PSS self-documenting under exam conditions. Verify: the pod runs in `hardened`, and diff your final securityContext against the demo app's; they should agree.

**Diagnose the two-level failure.** In `hardened`, `kubectl create deploy sneaky --image=busybox:1.37 -- sleep 300`. The deploy is created; no pod appears. Find the rejection where it actually lives:

```bash
kubectl -n hardened get deploy sneaky   # READY 0/1, no error here
kubectl -n hardened describe rs -l app=sneaky | tail -5
```

Verify: the ReplicaSet events carry the PSS denial. This indirection is a stock exam scenario for every admission mechanism (5.2's engines included); PSS is just where it is cheapest to practise.

**Preview a tightening like a platform team would.** `kubectl label --dry-run=server --overwrite ns team-b pod-security.kubernetes.io/enforce=restricted` and read which existing pods would violate. Verify: a warning per non-compliant pod, zero mutations made. Pair with the audit log (section 5.4) to see what the `audit` label has been quietly recording all along.

## Docs to know your way around

- kubernetes.io: Pod Security Standards (the profile tables; do not memorise the capability lists, know where they are) and Enforce Pod Security Standards with Namespace Labels
