# 3.3 Operators: reconciliation and how to read it

Competency: using Kubernetes operators for platform automation and integration (domain 3, 25%). Needs: `make up api` (CloudNativePG is the teaching operator).

The exam will not ask you to write a controller in Go. It will ask you to operate, integrate, and above all *diagnose* operators, which means reading their outputs fluently: status conditions, events, owned resources, and logs, in that order.

## The reconcile loop, precisely

A controller watches a kind, and for each object runs the same function: observe actual state, compare with desired spec, take one step toward convergence, write status, requeue. Level-based, not edge-based: it acts on the state it finds, not on the event that woke it, so missed events cost nothing and the loop is safe to run at any time. That is why deleting an operator-owned pod is a non-event; the next reconcile recreates it without knowing or caring that you deleted it.

The conventions that make operators readable:

- Status conditions: typed, with Type/Status/Reason/Message/LastTransitionTime. Ready is the summary; the others tell you which phase is stuck. Reason is machine-speak, Message is for you.
- `observedGeneration` in status against `metadata.generation` in spec: if they differ, the controller has not yet processed your latest edit, and whatever status says is about a *previous* spec. Checking this first avoids diagnosing stale information, and almost nobody does it.
- Owner references: operator-created resources carry `ownerReferences` to their parent. `kubectl get <child> -o jsonpath='{.metadata.ownerReferences[0].kind}'` answers "what keeps recreating this", and cascade deletion follows the same links.
- Finalizers: a deletion sticks in Terminating while a finalizer is present, because the controller is doing teardown work (or is dead and can't). A stuck namespace or CR almost always means "find whose finalizer, and why its controller isn't running".

## Exercises

**Run a real database through its operator.** In `default` (deliberately; the tenant-namespace variant comes last):

```bash
kubectl apply -f - <<'EOF'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: pg, namespace: default }
spec:
  instances: 2
  storage: { size: 1Gi }
EOF
kubectl get cluster pg -w
```

While it converges, watch like a diagnostician: `kubectl get events --field-selector involvedObject.name=pg --sort-by=.lastTimestamp`, `kubectl get cluster pg -o jsonpath='{.status.conditions}' | jq`, and `kubectl get pods,pvc,svc -l cnpg.io/cluster=pg`. Verify: Cluster reports Ready, two instance pods, each with its own PVC (section 1.3's semantics, live), and three Services (rw, ro, r). Name what created each object without guessing: ownerReferences.

**Prove level-based reconciliation.** `kubectl delete pod pg-1` and time what happens. Verify: a replacement appears within seconds and the Cluster's conditions ripple through a degraded state and back to Ready. Then scale the honest way, `kubectl patch cluster pg --type=merge -p '{"spec":{"instances":3}}'`, and check `observedGeneration` catches up to `generation` before you trust the new status. Two probes, two core behaviours.

**Read a stuck operator without the answer key.** The lab ships a booby-trapped manifest: `examples/crossplane/pg-cluster.yaml` targets `team-a`, where the default-deny NetworkPolicy silently strangles the instance's access to the API server. Apply it, and diagnose from evidence only: conditions say Initialized True but Ready False, phase "Setting up primary" forever, and `kubectl -n team-a logs job/pg-1-initdb` ends in `dial tcp 10.96.0.1:443: i/o timeout`. The file's comments explain why the obvious ipBlock fix fails (ClusterIP is DNAT'd before policy evaluation) and give the Cilium `toEntities: [kube-apiserver]` answer; do not read them until you have formed your own theory. Verify: after applying the CiliumNetworkPolicy from the comments, the cluster converges Ready in team-a. This exercise is the single best half-hour in domain 3.

**Operators as platform integration.** Crossplane, Kyverno, Trivy Operator, Prometheus Operator: every layer of this lab is operators consuming CRDs. Pick two you have installed and, for each, name the watched kind, find one owned resource via ownerReferences, and locate the controller deployment. Verify: `kubectl api-resources --api-group=<group>` and a one-line answer each. The point is transferable fluency: an unfamiliar operator on the exam is the same four questions.

A note on building: `kubebuilder` is on your PATH (`make tools`) and scaffolding a controller once (`kubebuilder init`, `kubebuilder create api`) is genuinely instructive for understanding what operators are made of, but it is beyond what the CNPE tests. Rainy-day material.

## Docs to know your way around

- kubernetes.io: Operator pattern, and the API conventions doc's conditions section (github.com/kubernetes/community, api-conventions.md) for what Reason/Message promise
- cloudnative-pg.io: the Cluster API reference, mostly to practise navigating a big operator's docs quickly
