# 1.2 Compute: requests, limits, QoS, scheduling, autoscaling

Competency: architecture best practices for compute, plus the scaling half of cost management (domain 1, 15%). Needs: `make up`. Nothing else.

Requests and limits look like beginner material and then show up everywhere: quotas count requests, OpenCost bills requests, LimitRanges inject them, Kyverno policies demand them, and the `resources` break drill corrupts them. Get the mechanics exact.

## The mechanics, exactly

A request is a scheduling claim: the scheduler places the pod on a node with that much unallocated, whether or not the pod uses it. A limit is a runtime ceiling: CPU over the limit is throttled, memory over the limit is an OOMKill. Nothing reconciles the two after scheduling, which is how a node can be 30% used and 100% requested at the same time. That gap is the entire cost domain in one sentence.

QoS falls out of the combination and you should be able to derive it, not recall it:

- Guaranteed: every container has requests == limits for both cpu and memory
- Burstable: at least one request or limit set, but not Guaranteed
- BestEffort: nothing set at all

Under node memory pressure the kubelet evicts BestEffort first, then Burstable pods using more than they requested, Guaranteed last. CPU never evicts; it only throttles.

Scheduling levers, in the order you reach for them: nodeSelector (blunt), affinity/anti-affinity (expressive, `requiredDuringScheduling` vs `preferred`), taints and tolerations (nodes repel pods, not the other way around), and topologySpreadConstraints (spread across a label domain). This cluster labels its workers into two zones precisely so spread constraints do something observable.

Autoscaling: HPA changes replica count from live metrics (needs metrics-server, which `make up` installs). VPA changes the requests themselves, and its `updateMode: "Off"` is the exam-relevant trick, because it turns VPA into a pure recommendation engine you can read for right-sizing answers without letting it evict anything.

## Exercises

**Derive QoS.** Create three pods in `default`: one with requests==limits, one with only requests, one with nothing. Predict each class before checking:

```bash
kubectl get pod <name> -o jsonpath='{.status.qosClass}{"\n"}'
```

Verify: three different answers, all matching your prediction. Delete them.

**Watch a limit do its two different things.** Memory first. `kubectl run` lost its resource flags a while back, so this is also a rep for the `--overrides` escape hatch:

```bash
kubectl run oom --image=polinux/stress --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"oom","image":"polinux/stress","command":["stress","--vm","1","--vm-bytes","128M","--vm-hang","0"],"resources":{"requests":{"memory":"64Mi"},"limits":{"memory":"64Mi"}}}]}}'
kubectl get pod oom -w    # until STATUS shows OOMKilled
```

Verify: `kubectl get pod oom -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}'` prints `OOMKilled` (with `--restart=Never` nothing restarts, so the evidence sits in `state`, not `lastState`; in a crash-looping Deployment it is the other way round, and knowing which field to read is half the diagnosis). CPU, by contrast, would have throttled silently. Remember which is which; the exam loves the difference.

**Spread across zones.** Deploy 4 replicas of anything with:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector: { matchLabels: { app: spread-demo } }
```

Verify: `kubectl get pods -l app=spread-demo -o wide` shows 2+2 across the two worker zones, and `kubectl get nodes -L topology.kubernetes.io/zone` confirms which zone each node carries.

**HPA under load.** Deploy `examples/demo-app/base` into `default` (`kubectl apply -k examples/demo-app/base`), then:

```bash
kubectl autoscale deploy demo --min=2 --max=6 --cpu-percent=20
kubectl run load --image=busybox:1.37 --restart=Never -- \
  sh -c 'while true; do wget -qO- http://demo.default.svc:80 >/dev/null; done'
kubectl get hpa demo -w
```

Verify: REPLICAS climbs above 2 within a couple of minutes. Kill `load` and watch it settle back after the stabilisation window (about 5 minutes; knowing that downscale lag exists is worth a mark). Note the demo container requests 25m CPU, which is why 20% is reachable at all.

**Ask VPA what the right size is.** With demo still running:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata: { name: demo, namespace: default }
spec:
  targetRef: { apiVersion: apps/v1, kind: Deployment, name: demo }
  updatePolicy: { updateMode: "Off" }
```

Give it a few minutes, then:

```bash
kubectl get vpa demo -o jsonpath='{.status.recommendation.containerRecommendations[0]}' | jq
```

Verify: a target/lowerBound/upperBound block. Compare target against the 25m request in the manifest and say, out loud, whether this workload is over- or under-provisioned. Section 1.5 turns that comparison into money.

## Docs to know your way around

- kubernetes.io: Resource Management for Pods, Pod QoS, Node-pressure Eviction, Assigning Pods to Nodes, HorizontalPodAutoscaler walkthrough
- github.com/kubernetes/autoscaler: VPA README (the updateMode table)
