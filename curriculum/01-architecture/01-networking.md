# 1.1 Platform networking

Competency: architecture best practices for networking (domain 1, 15%). Needs: `make up`, plus `make gitea gitops` for the traffic-tracing exercise and `make sec` for the team-a exercises (the tenant namespaces and their NetworkPolicies arrive with the security layer).

The exam angle here is being able to say, for any packet, what touches it and in what order: pod, CNI, Service, kube-proxy or its eBPF replacement, DNS, ingress. Most delivery and incident tasks in the other domains eventually come down to this.

## What you need to have internalised

Services first. ClusterIP is a virtual IP that only exists as translation rules on each node; nothing listens on it. NodePort opens the same service on a high port of every node. LoadBalancer is NodePort plus something external handing out a real IP, which in this lab is `cloud-provider-kind`. Headless (`clusterIP: None`) skips the VIP and returns pod IPs directly from DNS, which is what StatefulSets need for stable peer discovery.

The thing that makes a Service work is not the Service. It is the EndpointSlice behind it, and the selector that fills it. A Service with no ready endpoints resolves fine and then refuses connections, which is one of the most common exam-shaped failures. Check order: selector matches pod labels, pods are Ready (readiness gates endpoints), `kubectl get endpointslices -l kubernetes.io/service-name=<svc>`.

DNS: `<svc>.<ns>.svc.cluster.local`, served by CoreDNS in `kube-system`. Cross-namespace calls need at least `<svc>.<ns>`. The lab also teaches you the failure mode: `team-a` allows DNS egress through an explicit NetworkPolicy rule, and the `netpol` break drill removes it, leaving Running pods that cannot resolve anything.

This cluster runs Cilium instead of kube-proxy iptables mode with kindnet, for one load-bearing reason: kindnet does not enforce NetworkPolicy at all. Cilium also gives you Hubble, which shows you flows including the verdict (forwarded or dropped), and that is the fastest way to debug policy.

Ingress vs Gateway API: the exam-era answer is Gateway API. The model splits roles: GatewayClass (which controller), Gateway (a listener, owned by the platform team), HTTPRoute (match and backend rules, owned by app teams, can live in another namespace). This cluster installs the standard-channel CRDs so you can author and validate all of it; no controller programs a data plane for them on the main cluster, and I say so rather than let you believe a Gateway "worked". Istio on the mesh cluster serves Gateway API for real.

## Exercises

**Trace one request end to end.** With `gitops` up, Argo CD sits behind a LoadBalancer (running `server.insecure`, so plain http):

```bash
kubectl -n argocd get svc argocd-server -o wide      # note the EXTERNAL-IP
kubectl -n argocd get endpointslices -l kubernetes.io/service-name=argocd-server
curl -s -o /dev/null -w '%{http_code}\n' http://<EXTERNAL-IP>
```

The EXTERNAL-IP is real only while `cloud-provider-kind` runs; without it, `kubectl -n argocd port-forward svc/argocd-server 8080:80` and curl localhost:8080 instead, and the rest of the exercise is unchanged. Now break it in a way you can explain:

```bash
kubectl -n argocd patch svc argocd-server --type=merge -p '{"spec":{"selector":{"app":"nope"}}}'
```

Watch the endpointslice lose its endpoints and curl start failing while DNS still resolves. Then look at what your patch actually did before undoing it: `kubectl -n argocd get svc argocd-server -o jsonpath='{.spec.selector}'` shows the original two labels *plus* `app: nope`, because a JSON merge patch merges maps rather than replacing them. So the honest restore is removing your key, not re-adding theirs: `--type=merge -p '{"spec":{"selector":{"app":null}}}'`. Verify: the selector is back to exactly `app.kubernetes.io/name: argocd-server` and `app.kubernetes.io/instance: argocd`, and curl returns 200. Two lessons for the price of one; the merge-patch semantics come up on their own exam tasks.

**Watch the CNI make a decision.** Run a probe that policy must kill:

```bash
cilium hubble port-forward &
kubectl -n team-a run probe --image=curlimages/curl:8.11.1 --restart=Never \
  -- curl -s -m 5 http://example.com
hubble observe --namespace team-a --verdict DROPPED --last 20
```

Verify: DROPPED flows from the probe pod, and the pod's curl exits non-zero. This is the difference between "policy exists" and "policy enforces".

**Prove you can author Gateway API.** Write a Gateway named `web` using listener port 80, protocol HTTP, plus an HTTPRoute that matches path `/demo` and backends a Service `demo:80`. Don't copy from docs; build it from `kubectl explain gateway.spec.listeners` and `kubectl explain httproute.spec.rules`. Verify: both apply cleanly (schema-valid), and `kubectl get gateway web -o yaml` shows the spec you meant. Status stays unprogrammed here; on the mesh cluster Istio would accept the same manifests.

**DNS from inside.** From a pod in `default`, resolve short and long names:

```bash
kubectl run dnsprobe --image=busybox:1.37 --restart=Never -it --rm -- \
  sh -c 'nslookup argocd-server.argocd && nslookup argocd-server.argocd.svc.cluster.local'
```

Then repeat inside `team-a` and explain why it still works (the tenant policy allows port 53 to kube-dns explicitly; find that rule in `examples/multitenancy/team-a.yaml`).

## Docs to know your way around

- kubernetes.io: Services, DNS for Services and Pods, Network Policies
- gateway-api.sigs.k8s.io: the API model page with the role diagram
- docs.cilium.io: Hubble observe reference
