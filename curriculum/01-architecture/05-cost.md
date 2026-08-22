# 1.5 Cost: OpenCost and right-sizing

Competency: using cost management solutions for right-sizing and scaling (domain 1, 15%). Needs: `make up obs` (OpenCost ships in the `obs` layer and reads from Prometheus).

Cost on Kubernetes is an allocation problem, not a billing problem. The cluster costs what it costs; the question is which namespace, workload, or label is responsible for how much of it, and the answer is computed from requests, usage, and time. OpenCost does that math from the same Prometheus metrics you already collect.

## What drives spend, in the order it matters

1. Requests, not usage. Capacity planning and most pricing allocate by what you reserved. A deployment requesting 4 CPU and using 200m costs 4 CPU. The gap between the two is the "efficiency" number OpenCost reports, and closing it is right-sizing.
2. Idle capacity. Nodes are bought whole; unrequested space is idle cost that OpenCost can either show separately or spread across tenants. Know that both accounting choices exist.
3. Object sprawl: LoadBalancers, PVs, and forgotten namespaces bill whether or not traffic flows. This is why the team-a quota caps `count/services.loadbalancers` at 1, and why quota is a cost tool, not just a fairness tool.

The right-sizing loop the exam wants you to demonstrate: measure usage (Prometheus, `kubectl top`, VPA recommendations), compare with requests, adjust requests, confirm nothing degrades. You built the measuring half in section 1.2; this section adds the money view.

## Exercises

**Read the allocation.** OpenCost's UI is on the LoadBalancer `make urls` prints, but the CLI is faster and exam-shaped. One flag to burn in: kubectl-cost assumes a Kubecost install by default, and `--opencost` is what points it at this stack (different service name, port, and API path, all bundled in the one flag):

```bash
kubectl cost --opencost namespace --show-all-resources
kubectl cost --opencost namespace --historical --window 1d
```

Verify: a table where `monitoring` dominates (kube-prometheus-stack is the heaviest thing installed) and the team namespaces are near zero. If the command errors, diagnose the path: kubectl-cost talks to the opencost service, which talks to Prometheus; `kubectl -n opencost get deploy,svc` and the pod logs tell you which hop broke.

**Find the worst request/usage gap in the cluster.** Two views of the same truth. From cost:

```bash
kubectl cost --opencost namespace --show-efficiency
```

From raw metrics, CPU requested minus used, per namespace (run in the Prometheus UI from `make urls`):

```promql
sum by (namespace) (kube_pod_container_resource_requests{resource="cpu"})
  - sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[10m]))
```

The `container!=""` matters: cadvisor also emits pod-level and node-level aggregate series, and without the filter you count the same CPU twice.

Verify: the namespace at the top of the PromQL result matches the low efficiency scores in kubectl-cost. Name the top offender and what you would change.

**Right-size one workload end to end.** Deploy the demo app with a deliberate oversize:

```bash
kubectl apply -k examples/demo-app/base
kubectl set resources deploy demo --requests=cpu=500m,memory=512Mi
```

Wait ten minutes for metrics to accumulate, get the VPA recommendation for it (section 1.2), then apply sane numbers with `kubectl set resources` again. Verify: `kubectl cost --opencost namespace --show-efficiency` for `default` improves between the two states, and the pods never restarted into a Pending state (right-sizing that breaks scheduling is worse than the waste).

**Connect quota to cost.** Compute what team-a can maximally cost: its quota hard-caps requests at 2 CPU / 4Gi. That number is a budget expressed in Kubernetes objects. Write the one-sentence explanation of why a platform team sets quotas even when nobody fights over capacity. If your sentence does not mention predictable spend, read this section again.

## Docs to know your way around

- opencost.io: allocation API and the efficiency definition
- github.com/kubecost/kubectl-cost: flag reference, it has more views than the two used here
