# cnpe-exam-prep

An unofficial lab for the CNCF [Certified Cloud Native Platform Engineer (CNPE)](https://training.linuxfoundation.org/certification/certified-cloud-native-platform-engineer-cnpe/) exam.

The exam is hands-on and covers five domains, so reading docs is not enough. This repo builds a working internal developer platform on `kind` and then proves each piece actually functions. Not "the pod is Running", but "a repo pushed to Gitea produced an Argo CD Application that deployed itself, and reverting drift works".

Every layer installs and uninstalls on its own. That matters on a laptop, because running all of it at once will saturate the CPU.

## Curriculum

The lab is the machinery; [curriculum/](curriculum/index.html) is the study plan that drives it. It covers all five domains and every competency in the official curriculum PDF, split into 29 evening-sized sections, each one concepts plus exercises against this lab, each exercise ending with a command that proves the thing worked.

It is a small self-contained site rather than a pile of markdown: open `curriculum/index.html` in a browser (no server, no build step — `file://` is fine). Every code block has a copy button, `/` jumps to any section by name, tool or concept, exercises tick off as you verify them, and the dashboard tracks how far through the plan you are. Progress lives in that browser's local storage, so use the same one.

The [dashboard](curriculum/index.html) maps every official competency to a section and to the `make validate` check or exercise that demonstrates it, and there is a [15-task mock exam](curriculum/mock-exam.html) with grading commands and a built-in 120-minute clock.

| | |
|---|---|
| [1. Platform architecture and infrastructure](curriculum/01-architecture/) (15%) | networking, right-sizing, storage, multi-tenancy, cost |
| [2. GitOps and continuous delivery](curriculum/02-gitops/) (25%) | GitOps fundamentals, Argo CD, Flux, Tekton, progressive delivery, troubleshooting |
| [3. Platform APIs and self-service](curriculum/03-platform-apis/) (25%) | the platforms white paper, CRDs, operators, Argo Workflows, Crossplane, kro + Backstage |
| [4. Observability and operations](curriculum/04-observability/) (20%) | Prometheus, alerting, dashboards + logs, tracing, DORA metrics, incident response |
| [5. Security and policy enforcement](curriculum/05-security/) (15%) | RBAC + secrets, policy engines, PSS, audit + SBOM, mTLS + SPIRE, pipeline security |

## What it builds

| Layer | Tools | Exam domain |
|---|---|---|
| `up` | [kind](https://kind.sigs.k8s.io/) (3 nodes, 2 zones), [Cilium](https://cilium.io/), [Gateway API](https://gateway-api.sigs.k8s.io/), [metrics-server](https://github.com/kubernetes-sigs/metrics-server), [VPA](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler), local registry, API audit logging | Platform architecture (15%) |
| `gitea` | [Gitea](https://about.gitea.com/) on the kind network, resolvable in-cluster as `gitea.lab` through CoreDNS | GitOps (25%) |
| `gitops` | [Argo CD](https://argo-cd.readthedocs.io/), [Argo Rollouts](https://argo-rollouts.readthedocs.io/), [Argo Workflows](https://argo-workflows.readthedocs.io/), [Flux](https://fluxcd.io/) | GitOps (25%) |
| `cicd` | [Tekton](https://tekton.dev/) Pipelines/Triggers/Dashboard, [Trivy Operator](https://aquasecurity.github.io/trivy-operator/) | GitOps, Security |
| `api` | [Crossplane](https://crossplane.io/) v2, provider-kubernetes, provider-helm, [CloudNativePG](https://cloudnative-pg.io/), [kro](https://kro.run/) | Platform APIs (25%) |
| `obs` | [Prometheus](https://prometheus.io/), [Grafana](https://grafana.com/oss/grafana/), [OpenTelemetry](https://opentelemetry.io/), [Jaeger](https://www.jaegertracing.io/), [Loki](https://grafana.com/oss/loki/) + [Alloy](https://grafana.com/docs/alloy/latest/), [OpenCost](https://www.opencost.io/) | Observability (20%) |
| `sec` | [Kyverno](https://kyverno.io/), [OPA Gatekeeper](https://open-policy-agent.github.io/gatekeeper/), [Sealed Secrets](https://github.com/bitnami/sealed-secrets), [External Secrets](https://external-secrets.io/), Pod Security Standards, quotas | Security (15%) |
| `spire` | [SPIFFE/SPIRE](https://spiffe.io/), workload identity | Security (15%) |
| `mesh` | Second cluster with [Istio](https://istio.io/) ambient and [Flagger](https://flagger.app/) | Security (15%) |
| `portal` | [Backstage](https://backstage.io/) on the host, with a software template that publishes to Gitea | Platform APIs (25%) |

Versions as tested: Kubernetes 1.36.1, kind 0.32.0, Helm 4.2.2, Cilium 1.20.1, Argo CD 10.4.0 (chart), Crossplane 2.4.0 (chart), kube-prometheus-stack 88.5.3, Istio 1.30.3, Flux 2.9.4.

Only the Kubernetes node image is pinned, by digest, in `lab.env`. Helm charts and the Tekton release manifests intentionally float, so a fresh install gets whatever is current and the list above will drift. That is the right trade for exam prep, because chart values and API versions moving under you is the thing the exam actually tests. If something breaks, `kubectl api-resources | grep <tool>` and `kubectl explain <kind>` are the fix, and pinning `--version` in `scripts/lib.sh`'s `helmi` is a one-line change if you want reproducibility instead.

## Tools

Everything the lab installs, with a link to each project. The CNCF exam tool list is
broad, so I aimed for coverage of it rather than picking favourites.

Cluster and networking:
[Kubernetes](https://kubernetes.io/) ·
[kind](https://kind.sigs.k8s.io/) ·
[Cilium](https://cilium.io/) ·
[Hubble](https://github.com/cilium/hubble) ·
[Gateway API](https://gateway-api.sigs.k8s.io/) ·
[cloud-provider-kind](https://github.com/kubernetes-sigs/cloud-provider-kind) ·
[metrics-server](https://github.com/kubernetes-sigs/metrics-server) ·
[Vertical Pod Autoscaler](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)

Packaging and templating:
[Helm](https://helm.sh/) ·
[Kustomize](https://kustomize.io/)

Git and GitOps:
[Gitea](https://about.gitea.com/) ·
[Argo CD](https://argo-cd.readthedocs.io/) ·
[Argo Rollouts](https://argo-rollouts.readthedocs.io/) ·
[Argo Workflows](https://argo-workflows.readthedocs.io/) ·
[Flux](https://fluxcd.io/) ·
[Flagger](https://flagger.app/)

CI and supply chain:
[Tekton](https://tekton.dev/) ·
[Trivy](https://trivy.dev/) ·
[Trivy Operator](https://aquasecurity.github.io/trivy-operator/) ·
[Cosign](https://docs.sigstore.dev/cosign/signing/overview/) ·
[skopeo](https://github.com/containers/skopeo)

Platform APIs and self-service:
[Crossplane](https://crossplane.io/) ·
[kro](https://kro.run/) ·
[CloudNativePG](https://cloudnative-pg.io/) ·
[Kubebuilder](https://book.kubebuilder.io/) ·
[Backstage](https://backstage.io/)

Observability and cost:
[Prometheus](https://prometheus.io/) ·
[Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) ·
[Grafana](https://grafana.com/oss/grafana/) ·
[OpenTelemetry](https://opentelemetry.io/) ·
[Jaeger](https://www.jaegertracing.io/) ·
[Loki](https://grafana.com/oss/loki/) ·
[Alloy](https://grafana.com/docs/alloy/latest/) ·
[OpenCost](https://www.opencost.io/) ·
[kubectl-cost](https://github.com/kubecost/kubectl-cost)

Security, policy and identity:
[Kyverno](https://kyverno.io/) ·
[OPA Gatekeeper](https://open-policy-agent.github.io/gatekeeper/) ·
[Sealed Secrets](https://github.com/bitnami/sealed-secrets) ·
[External Secrets Operator](https://external-secrets.io/) ·
[SPIFFE/SPIRE](https://spiffe.io/) ·
[Istio](https://istio.io/) ·
[Linkerd](https://linkerd.io/) (alternative to Istio, `MESH=linkerd make mesh`)

Shell tooling installed by `make tools`:
[k9s](https://k9scli.io/) ·
[stern](https://github.com/stern/stern) ·
[kubectx](https://github.com/ahmetb/kubectx) ·
[mise](https://mise.jdx.dev/) (pins Node 22 for Backstage)

## Hardware and build time

I built and tested this on a 2019 Intel MacBook Pro, Core i9-9880H (8 cores, 16 threads), 32 GB RAM, running Omarchy 4 (Arch). It is not fast hardware for this. The CPU is the bottleneck, never the memory.

| Step | Time | Notes |
|---|---|---|
| `make host` | ~1 min | Needs sudo |
| `make tools` | ~5 min | Mostly downloads |
| `make up` | ~4 min | Cluster ready in under 3 |
| `make gitea` | ~1 min | |
| `make gitops` | ~5 min | |
| `make cicd` | ~6 min | Trivy scans every workload on install |
| `make api` | ~6 min | Crossplane packages pull slowly |
| `make obs` | ~10 min | The heaviest layer |
| `make sec` | ~5 min | |
| `make spire` | ~3 min | |
| `make mesh` | ~6 min | Builds a second cluster |
| `make portal` | ~20 min | Backstage pulls a large npm tree |

Around 70 minutes for everything, or about 25 minutes for a useful subset (`make core cicd api`).

At rest the full stack uses roughly 21 GB of RAM across two clusters, 85 pods and 20 Helm releases, plus about 19 GB of Docker images and volumes. Load average sits near 18 during the observability install and settles to about 3 afterwards.

If you are on the same chassis, install `mbpfan` so the fans ramp before the CPU throttles:

```bash
yay -S mbpfan-git && sudo systemctl enable --now mbpfan
watch -n2 'grep MHz /proc/cpuinfo | head'   # ~800 MHz means you are throttling
```

## Quick start

```bash
git clone https://github.com/rbstp/cnpe-exam-prep.git && cd cnpe-exam-prep
cp lab.env.example lab.env      # set GITEA_PASS
make host                       # sysctls, docker, kernel limits. needs sudo
make tools                      # every CLI into ~/.local/bin
make core                       # cluster + git server + Argo CD/Flux/Rollouts/Workflows
make cicd api obs sec spire     # the rest, one at a time
make validate                   # 71 functional checks
make urls                       # where everything is
```

Run the layers one at a time and watch `make status` in between. Running two at once on this hardware makes both slower.

### What needs root, and what it touches

More than just `make host`, so it is worth knowing before you run any of it:

- `make host` adds you to the `docker` group (root-equivalent), writes `/etc/sysctl.d/99-cnpe-lab.conf` and a systemd drop-in for docker, and creates `/etc/docker/daemon.json` only if absent. It restarts dockerd when the limits drop-in changes, which bounces every container on the machine, and it warns before doing so.
- `make gitea` appends one line to `/etc/hosts` mapping `gitea.lab`, and only when the entry is missing or the IP moved.
- `make up` starts `cloud-provider-kind` under `sudo -b` so LoadBalancer Services get real IPs. It needs root to bind ports 80 and 443, it records its PID, and it skips itself with a warning if sudo would prompt.
- `make down` stops that process by the recorded PID.
- `make portal` runs `sudo npm i -g yarn` only if yarn is missing.

`make tools` installs every CLI into `~/.local/bin` and needs sudo only for the `pacman` packages. Three upstream installers are piped to a shell unpinned (crossplane, istioctl, linkerd), which is how those projects document installation, but read them first if that bothers you.

## Targets

```
make host            Kernel limits, docker, thermal advice (run once, needs sudo)
make tools           Install every CLI into ~/.local/bin
make up              Create the cluster: kind + Cilium + LB + metrics + VPA + registry
make gitea           Local git server, seeded repos, CoreDNS entry
make gitops          Argo CD, Argo Rollouts, Argo Workflows, Flux
make cicd            Tekton Pipelines/Triggers/Dashboard, Trivy Operator
make api             Crossplane, CloudNativePG, kro
make obs             Prometheus, Grafana, OTel, Jaeger, Loki+Alloy, OpenCost
make sec             Kyverno, Gatekeeper, sealed/external secrets, PSS
make spire           SPIFFE/SPIRE workload identity
make mesh            Second cluster + Istio ambient + Flagger
make portal          Scaffold Backstage on the host
make core            Minimum useful lab (~4 GB)
make full            Everything on the main cluster (~14 GB)
make validate        Functionally verify every layer (FAST=1 to skip probes)
make fix-cp-metrics  Expose control-plane metrics on an existing cluster
make urls            Every UI, its URL/port-forward, and credentials
make forward         Start a background port-forward for every UI
make forward-stop    Kill all port-forwards started by 'make forward'
make status          Clusters, endpoints, unhealthy pods, host load
make break           Inject a random fault, then diagnose it under time pressure
make break-answer    Reveal the last injected fault
make break-fix       Auto-diagnose and repair whatever 'make break' injected
make down            Delete both clusters (keeps git history + registry)
make nuke            Delete everything including Gitea data
```

## make validate

The part I care about most. It checks behaviour, not pod status.

```
── Domain 3 — Platform APIs & self-service
  ✓ crossplane providers unhealthy                 0
  ✓ crossplane functions unhealthy                 0
  ✓ XRD established                                True
  ✓ example XR reconciled (Ready)                  True
  ✓ XR actually created its namespace              team-c
  ✓ cloudnative-pg operator ready                  1
  ✓ kro ready                                      1

── NetworkPolicy enforcement (the thing kindnet fakes)
  ✓ egress blocked by NetworkPolicy                curl exit=28 (denied, correct)

── Portal — Backstage golden path
  ✓ backstage app scaffolded                       /path/to/clone/portal
  ✓ gitea scaffolder module registered
  ✓ golden-path template installed
  ✓ backstage serving on :3000                     running
  ✓ golden-path ApplicationSet healthy             False
  ✓ Applications auto-generated from git           1

──────────────────────────────────────────────
  PASS 71   FAIL 0   SKIP 0
──────────────────────────────────────────────

Lab is fully functional.
```

## make urls

The Argo CD and Gitea passwords are redacted here; the real ones print locally.
Grafana is genuinely `admin` / `admin`, set by `scripts/50-observability.sh`.

```
──────────────────────────────────────────────────────────────────────────────
 ok  cloud-provider-kind is running — LoadBalancer IPs below are reachable directly
──────────────────────────────────────────────────────────────────────────────

SERVICE           URL                      ACCESS
───────────────── ──────────────────────── ──────
Argo CD           http://172.18.0.10:80    admin / see below
Argo Rollouts     http://172.18.0.12:3100  no auth
Argo Workflows    http://172.18.0.16:2746  no auth (server authMode)
Tekton Dashboard  http://172.18.0.11:9097  no auth
Grafana           http://172.18.0.9:80     admin / admin  (3000 is Backstage)
Prometheus        http://172.18.0.13:9090  no auth
Alertmanager      http://localhost:9093    no auth
                    kubectl -n monitoring port-forward svc/prometheus-kube-prometheus-alertmanager 9093:9093
Jaeger            http://172.18.0.14:16686 no auth
OpenCost          http://172.18.0.15:9090  UI on /
Hubble UI         http://localhost:12000   Cilium network flows
                    kubectl -n kube-system port-forward svc/hubble-ui 12000:80

Backstage portal (runs on the HOST, not in the cluster)
  Portal           http://localhost:3000     start: cd <clone>/portal && yarn start
                   backend API on :7007      (needs Node 22 — mise.toml pins it)
  Golden path      Create -> "Golden path service" -> publishes to gitea org 'services'
                   Argo CD then generates an Application automatically

Always-on (no port-forward needed)
  Gitea            http://gitea.lab:3000   (also http://localhost:3001)
                   lab / <redacted>
  OCI registry     localhost:5001   (push: docker push localhost:5001/demo:v1)

Credentials
  Argo CD    admin / <redacted>
  Grafana    admin / admin

No-UI things worth knowing
  API audit log    docker exec -it cnpe-control-plane tail -f /var/log/kubernetes/audit.log | jq .
  Rollouts TUI     kubectl argo rollouts dashboard
  Hubble CLI       cilium hubble port-forward &  then: hubble observe
  Cost CLI         kubectl cost --opencost namespace --show-all-resources
  Compliance       kubectl get clustercompliancereports,vulnerabilityreports,sbomreports -A
  SPIRE identities kubectl -n spire exec sts/spire-server -c spire-server -- \
                     /opt/spire/bin/spire-server entry show
  Golden path apps kubectl -n argocd get applicationset,applications
```

Real LoadBalancer IPs need `cloud-provider-kind`, which wants root to bind ports 80 and 443. Skip it and use `make forward` instead if you would rather not run a root process.

## make break

Incident response is a third of the observability domain and the hardest thing to practise alone. `make break` injects one of seven faults into `team-a` at random and starts you on a clock. Target is 7 minutes, which is roughly exam pace.

The seven are image, probe, resources, rbac, quota, netpol and config. Each fails differently, and some are invisible in `kubectl get pods`. The rbac one only shows up under `kubectl auth can-i --as=...`, and the netpol one strips the DNS egress rule off the tenant policy, leaving a Running pod that cannot resolve anything. That last one is worth understanding: NetworkPolicies are additive allow-lists, so you cannot break DNS by *adding* a restrictive policy. You have to remove the rule that allowed it.

```bash
make break            # random fault
FAULT=netpol make break   # drill one specific fault
make break-answer     # reveal what was injected
make break-fix        # auto-diagnose, repair, and explain why it broke
```

`make break-fix` detects faults from cluster state rather than reading the answer file, and prints the evidence it matched on. Use it to reset, or to check your own diagnosis after you have had a go.

## Credentials

Nothing sensitive is committed. `lab.env` is gitignored, so copy the template first:

```bash
cp lab.env.example lab.env
```

`GITEA_PASS` is the only value you need to set. It is the admin password for a throwaway Gitea container that only listens on localhost, so it is not a real secret, but it does not belong in git either.

Everything else is generated at runtime and gitignored:

- `.gitea-token`, an API token created by `make gitea`, mode 600
- `.gitea-info`, a connection summary
- The Argo CD admin password, random per install, read it with `make urls`
- `portal/`, the scaffolded Backstage app, which contains its own generated config

## Things worth knowing if you build something similar

These cost me real time, and none of them are obvious from the upstream docs.

**Use Cilium, not kindnet.** kindnet does not enforce NetworkPolicy, so every network-policy exercise silently passes and you learn nothing. `make validate` proves enforcement with an egress probe that must fail.

**Turn on API server audit logging.** Generating audit trails is an explicit exam competency and almost nobody practises it. One gotcha: the apiserver is started with `--audit-policy-file=/etc/kubernetes/audit/policy.yaml`, so the mounted directory must contain a file named exactly `policy.yaml`. A missing audit policy stops kube-apiserver from starting at all, which looks like a cluster that never boots.

**kubeadm binds control-plane metrics to localhost.** kube-controller-manager, kube-scheduler and etcd all listen on 127.0.0.1, so Prometheus cannot scrape them and Grafana's control-plane dashboards stay empty. Fix it in the kind config with `bind-address: 0.0.0.0` and `listen-metrics-urls`, plus a `KubeProxyConfiguration` patch for kube-proxy. `make fix-cp-metrics` retrofits a running cluster.

**A namespaced Crossplane v2 XR cannot compose cluster-scoped resources.** provider-kubernetes serves `Object` as cluster-scoped in `kubernetes.crossplane.io` and namespaced in `kubernetes.m.crossplane.io`. Mixing them gives you `cannot apply cluster scoped composed resource`. The namespaced variant also needs a `ClusterProviderConfig` rather than a `ProviderConfig`.

**Argo CD's Gitea SCM generator needs an organisation, not a user.** It lists repos through the org API, so repos owned by a user account return `error listing repos: not found`. It also wants a token with `write:repository`, `write:organization` and `read:issue`, and each missing scope only shows up as a runtime ApplicationSet error. Set `cloneProtocol: https` too, or `{{ .url }}` resolves to an SSH URL and Argo CD fails with `SSH agent requested but SSH_AUTH_SOCK not-specified`.

**Run the service mesh on a second cluster.** Istio ambient and Cilium both rewrite the dataplane. Debugging that interaction teaches you nothing about the exam, and a broken mesh should not cost you your GitOps state.

**Gateway API v1.5 and later blocks older CRDs.** It ships a ValidatingAdmissionPolicy that rejects any Gateway API CRD before v1.5.0. cloud-provider-kind embeds an older bundle and installs it at startup, so it gets denied and its service controller dies, and no LoadBalancer ever gets an IP. Start it with `--gateway-channel=disabled`.

**Backstage wants an even LTS Node.** It supports 20, 22 and 24. Arch ships 26, and `create-app` fails on it. `mise.toml` pins 22 for this directory. `create-app` also has no `--name` flag and always prompts, so it hangs when scripted, and the `.yarnrc.yml` it generates sets `npmMinimalAgeGate: 3d` which can reject one of Backstage's own fresh dependencies.

**Trivy's node-collector needs a toleration.** It is pinned to each node by nodeSelector but does not tolerate the control-plane taint, so that node silently produces no compliance report. `nodeCollector.tolerations` and `trivyOperator.scanJobTolerations` are separate chart keys and you need both.

**The local registry needs two names and a CoreDNS entry.** Pods pull `localhost:5001/...` through a containerd mirror, but anything that runs *inside* a pod and talks to the registry itself (kaniko pushing, Kyverno fetching signatures) needs `kind-registry:5000`, and pods cannot resolve that name until CoreDNS is taught it. The cluster script now wires both names into containerd and the registry IP into CoreDNS. Kyverno additionally needs `features.registryClient.allowInsecure=true` or every image verification dies on `server gave HTTP response to HTTPS client`.

**cosign v3 signs in a format Kyverno does not read yet.** Its default is the new bundle format (a `sha256-<digest>` tag); Kyverno's ImageValidatingPolicy looks for the legacy `sha256-<digest>.sig`. Sign with `--use-signing-config=false --new-bundle-format=false --tlog-upload=false` and verification works. "no signatures found" on an image you definitely signed is a format-skew symptom, not a key problem.

## Not included

No cloud provider. Everything runs locally, which means no real cloud Crossplane providers and no managed services. That is deliberate, because the exam gives you a cluster and not an AWS account.

## License

MIT. See [LICENSE](LICENSE).

## Reference

- [CNPE certification page](https://training.linuxfoundation.org/certification/certified-cloud-native-platform-engineer-cnpe/)
- [Exam tool list](https://docs.linuxfoundation.org/tc-docs/certification/important-instructions-cnpe)
- [CNCF curriculum repo](https://github.com/cncf/curriculum)
- [CNCF Platforms white paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/)
