# 1.4 Multi-tenancy: isolation you can defend

Competency: optimizing multi-tenancy resource usage (domain 1, 15%). Needs: `make up sec` (the `sec` layer applies the tenant examples).

`examples/multitenancy/team-a.yaml` is the whole syllabus for this section in 75 lines: one namespace carrying every guardrail the exam can ask about. Read it top to bottom before doing anything else; every exercise below pokes at one of its objects.

## The isolation stack

Namespace-per-tenant is the model the exam assumes. What makes it a tenant rather than a folder is the stack of controls attached:

1. ResourceQuota caps the namespace total: requests, limits, object counts (`pods: "20"`, `count/services.loadbalancers: "1"`). A quota that lists `requests.*` or `limits.*` rejects any pod that fails to declare them, which leads directly to point 2.
2. LimitRange fills in per-container defaults and bounds, so a bare pod arrives at the quota check with numbers already attached. LimitRange defaulting is what keeps tenant onboarding friction-free while the quota stays enforceable.
3. NetworkPolicy default-deny plus explicit allows. team-a allows same-namespace traffic and DNS to kube-dns, nothing else. Additive allow-lists mean you loosen by adding policies and tighten only by removing rules, an asymmetry the netpol break drill exploits.
4. Pod Security Standards labels on the namespace (enforce baseline, warn and audit restricted here). Covered properly in section 5.3.
5. RBAC scoping: a Role and RoleBinding giving user `dev-a` real rights inside team-a and none outside. Covered properly in section 5.1.

Isolation models beyond namespaces, worth knowing as words at least: node-pool isolation via taints when tenants must not share kernels, virtual clusters (vcluster) when they need their own API servers, and separate clusters when compliance says so. The trade is always the same: stronger isolation costs more idle capacity, which is why "optimizing" is in the competency name.

## Exercises

**Exhaust a quota on purpose.**

```bash
kubectl -n team-a get resourcequota team-a-quota -o yaml   # read used vs hard
kubectl -n team-a create deploy filler --image=ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine --replicas=25
kubectl -n team-a get rs -l app=filler -o jsonpath='{.items[0].status.replicas}'
kubectl -n team-a get events --sort-by=.lastTimestamp | grep -i quota | tail -3
```

Verify: replicas stall below 25, and the ReplicaSet events say exactly which quota line refused. Do the arithmetic before peeking: the LimitRange injects 50m requests and 200m limits per container, so `requests.cpu: "2"` allows 40 pods but `limits.cpu: "4"` allows exactly 20, tying with `pods: "20"`. Whichever line the event names, you should be able to derive why. The skill is reading `exceeded quota: team-a-quota, requested: ..., used: ..., limited: ...` fluently. Clean up with `kubectl -n team-a delete deploy filler`.

**Prove the LimitRange writes the requests.** Run a pod with no resources block and read what it got:

```bash
kubectl -n team-a run bare --image=busybox:1.37 --restart=Never -- sleep 300
kubectl -n team-a get pod bare -o jsonpath='{.spec.containers[0].resources}' | jq
```

Verify: requests 50m/64Mi and limits 200m/256Mi, injected by `team-a-limits`, matching nothing you typed. Then try to exceed the max: request `cpu: "2"` in a pod and confirm admission rejects it with a LimitRange error, not a quota error. Knowing which of the two refused you is a real exam differentiator.

**Cross-tenant traffic must die.** team-b exists with the same guardrails:

```bash
kubectl -n team-b run web --image=ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine --port=8080 --expose
kubectl -n team-a run poke --image=curlimages/curl:8.11.1 --restart=Never -- \
  curl -s -m 5 -o /dev/null -w '%{http_code}' http://web.team-b.svc:8080
kubectl -n team-a wait --for=jsonpath='{.status.phase}'=Failed pod/poke --timeout=60s \
  || kubectl -n team-a get pod poke -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}'
```

Verify: the curl times out (exit 28). Then write the pair of policies that would allow exactly this one flow, an egress rule in team-a and an ingress rule in team-b, apply them, and rerun until you get a 200. Both ends must open; discovering that empirically once saves you re-deriving it under exam pressure.

**The DNS trap, on demand.** `FAULT=netpol make break` strips the DNS egress rule. Diagnose it without the answer, but remember drops only show when something *tries*: the resident nginx pods never resolve anything, so generate the evidence yourself with `kubectl -n team-a exec deploy/<whatever runs there> -- nslookup kubernetes.default` (or run a busybox pod), then read `hubble observe --namespace team-a --verdict DROPPED` and see port 53 dying. `make break-answer` to confirm, `make break-fix` to restore. Verify: the same nslookup now succeeds.

## Docs to know your way around

- kubernetes.io: Resource Quotas, Limit Ranges, Network Policies
- The multi-tenancy section of kubernetes.io docs (Concepts > Security > Multi-tenancy) reads like it was written for this competency
