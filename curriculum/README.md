# CNPE curriculum

A study path through every domain and competency in the official [CNPE curriculum](https://github.com/cncf/curriculum), built on the lab in this repo. Each section file is sized for one evening: read the concepts, do the exercises against the lab, and finish with a command whose output proves the thing works. The lab's rule applies here too. Never trust "the pod is Running"; make it do something.

## The exam

Facts from the [certification page](https://training.linuxfoundation.org/certification/certified-cloud-native-platform-engineer-cnpe/) and the official curriculum PDF, as of August 2026:

- Performance-based. You solve tasks on a remote Linux desktop with a terminal and web UIs, not multiple choice.
- 120 minutes. That is the number that should shape your prep. Roughly 15-20 tasks in two hours means 6-8 minutes each, which is why `make break` uses a 7-minute clock.
- Some documentation is available during the exam, but less than people assume: the [exam instructions](https://docs.linuxfoundation.org/tc-docs/certification/important-instructions-cnpe) allow browsing kubernetes.io/docs plus whatever task-specific links appear in each question's Quick Reference panel, and prohibit everything else. Tool docs reach you only through those links. That makes `kubectl explain`, `kubectl api-resources`, and `--help` your primary references, and it is why every section here leans on them. The per-section "Docs to know your way around" lists are for study time.
- Tools named as examples: Argo, Crossplane, Flagger, Flux, Gatekeeper, Grafana, Istio, Jaeger, Kyverno, Linkerd, OPA, OpenCost, OpenTelemetry, Prometheus, Tekton. The PDF is explicit that you will not be tested on deep tool-specific knowledge beyond the listed competencies.
- Registration includes two killer.sh simulator sessions (20 questions each), one retake, a 12-month eligibility window, and a certificate valid 2 years.
- The passing score is not disclosed. Ignore any number a course quotes.

## The map

| Domain | Weight | Sections | Lab layers |
|---|---|---|---|
| [1. Platform architecture and infrastructure](01-architecture/) | 15% | 5 | `up` |
| [2. GitOps and continuous delivery](02-gitops/) | 25% | 6 | `core cicd` (+`obs` `mesh` for progressive delivery) |
| [3. Platform APIs and self-service](03-platform-apis/) | 25% | 6 | `core api` (+`portal`) |
| [4. Observability and operations](04-observability/) | 20% | 6 | `obs` (+`core` for efficiency metrics) |
| [5. Security and policy enforcement](05-security/) | 15% | 6 | `sec` (+`cicd` `spire` `mesh`) |

Plus [mock-exam.md](mock-exam.md), fifteen timed tasks across all five domains with grading commands.

Weights are not study time. Domains 2 and 3 are half the exam and mostly mechanical skills that improve with reps. Domain 4's incident competency is a practice skill too. Domain 1 and half of domain 5 are things you likely already know if you run Kubernetes for a living; check yourself against the exercises before spending evenings there.

## Competency coverage

Every competency in the official PDF, where it is taught, and how the lab proves it. If a row's proof column says *exercise*, the evidence is a command inside the section rather than a `make validate` check.

| # | Competency (official wording, abbreviated) | Section | Proof |
|---|---|---|---|
| 1.1 | Architecture best practices: networking, storage, compute | [1.1](01-architecture/01-networking.md), [1.2](01-architecture/02-compute-right-sizing.md), [1.3](01-architecture/03-storage.md) | validate: nodes/zones/Gateway CRDs/metrics-server; storage exercises |
| 1.2 | Cost management for right-sizing and scaling | [1.5](01-architecture/05-cost.md), [1.2](01-architecture/02-compute-right-sizing.md) | validate: opencost ready; kubectl-cost exercises |
| 1.3 | Optimizing multi-tenancy resource usage | [1.4](01-architecture/04-multi-tenancy.md) | validate: tenant quotas, NetworkPolicies, egress probe |
| 2.1 | GitOps workflows for app and infra deployment | [2.1](02-gitops/01-gitops-fundamentals.md), [2.2](02-gitops/02-argocd.md), [2.3](02-gitops/03-flux.md) | validate: Argo CD + Flux wired to Gitea; drift-revert exercise |
| 2.2 | CI/CD pipelines integrated with Kubernetes | [2.4](02-gitops/04-tekton.md) | validate: tekton deployments + catalog tasks; pipeline run exercise |
| 2.3 | Progressive delivery (blue/green, canary) | [2.5](02-gitops/05-progressive-delivery.md) | validate: argo-rollouts, flagger; canary promote/abort exercise |
| 2.x | Troubleshooting delivery failures | [2.6](02-gitops/06-troubleshooting.md) | break drills + staged failures |
| 3.1 | Designing and creating CRDs | [3.1](03-platform-apis/01-apis-as-products.md), [3.2](03-platform-apis/02-crds.md) | exercise: hand-written CRD with validation, rejected bad input |
| 3.2 | Workflows for self-service provisioning | [3.4](03-platform-apis/04-argo-workflows.md) | exercise: workflow provisions a namespace end to end |
| 3.3 | Operators for automation and integration | [3.3](03-platform-apis/03-operators.md) | validate: XR reconciled, cnpg ready; operator diagnosis exercise |
| 3.4 | Automation frameworks for self-service | [3.5](03-platform-apis/05-crossplane.md), [3.6](03-platform-apis/06-kro-backstage-choosing.md) | validate: XR created its namespace, kro ready, golden path |
| 4.1 | Monitoring, alerting, logging, tracing | [4.1](04-observability/01-prometheus.md), [4.2](04-observability/02-alerting.md), [4.3](04-observability/03-dashboards-and-logs.md), [4.4](04-observability/04-tracing.md) | validate: targets UP/0 DOWN, loki holds streams; alert-fire and trace-find exercises |
| 4.2 | Platform efficiency via deployment metrics | [4.5](04-observability/05-platform-efficiency.md) | exercise: DORA-style PromQL over Argo CD metrics |
| 4.3 | Diagnosing and remediating incidents | [4.6](04-observability/06-incident-response.md) | `make break`, all seven faults under the clock |
| 5.1 | Secure service-to-service communication | [5.5](05-security/05-mtls-and-identity.md) | validate: ztunnel/istiod/SPIRE healthy; mTLS verification exercise |
| 5.2 | RBAC and security controls across resources | [5.1](05-security/01-rbac-and-secrets.md) | exercise: `auth can-i` matrix as user dev-a; rbac break drill |
| 5.3 | Audit trails and policy compliance (SBOM, reports) | [5.4](05-security/04-audit-and-compliance.md) | validate: audit log bytes, sbomreports, compliance reports |
| 5.4 | Policy engines and admission controllers | [5.2](05-security/02-policy-engines.md), [5.3](05-security/03-pod-security-standards.md) | validate: kyverno policies loaded; denied-pod exercises |
| 5.5 | Security scanning in deployment pipelines | [5.6](05-security/06-pipeline-security.md) | exercise: pipeline fails on CRITICAL CVE, cosign sign/verify |

Two honest gaps, called out where they occur: Linkerd appears only as the `MESH=linkerd make mesh` alternative (section 5.5 tells you what transfers), and classic Rego-based OPA is covered through Gatekeeper constraint templates in section 5.2, which is the form the exam tool list means.

## How to run a session

1. Bring up the layers named at the top of the section (`needs:` line). Tear down what you don't need; the full stack saturates a laptop.
2. Read the concepts. They are deliberately short. The exam tests hands, not recall.
3. Do every exercise. Each one ends with a verification command. If the output doesn't match, that is the real exercise starting.
4. Close the loop with `make validate` when a section says so.
5. Note what you had to look up. That list is your personal weak-spot index, and it beats any pre-made one.

## Study plan

Twenty-nine sections plus drills. At four sessions a week this is about seven weeks; compress by skipping sections whose exercises you can already do cold. The order matters more than the pace: domain 2 before 3 (Crossplane and Backstage build on Argo CD), domain 4 before the break drills, mocks last.

| Phase | Sessions | What |
|---|---|---|
| 1 | 1-5 | Domain 1, all sections. `make up`, keep the cluster. |
| 2 | 6-11 | Domain 2. Add `gitea gitops cicd`. Finish with three staged failures from 2.6. |
| 3 | 12-17 | Domain 3. Add `api`, then `portal` for section 3.6. |
| 4 | 18-23 | Domain 4. Swap `cicd` down if the laptop struggles, add `obs`. End with two `make break` drills. |
| 5 | 24-29 | Domain 5. Add `sec spire`, then `mesh` for 5.5. First killer.sh session after 5.3. |
| 6 | 30+ | [mock-exam.md](mock-exam.md) under 120 minutes. Daily `make break` with rotating `FAULT=`. Second killer.sh in the final week. Re-run every exercise you flagged. |

The two killer.sh sessions are the only external signal you get before the real thing. Don't burn both early: the first tells you what to fix, the second tells you whether you fixed it.

## Exam-day tactics

- Time-box at 7 minutes. Flag and move on; a stuck task costs you two easy ones. The mock exam trains this.
- Read `kubectl explain <kind> --recursive` before searching docs. It is faster and it is always version-correct for the cluster in front of you.
- `kubectl api-resources | grep <tool>` first on any unfamiliar tool. Every platform tool in this curriculum is operated through CRDs, and their names tell you most of the model.
- Always verify the way the grader would: create, then `get` and read status conditions, not just the apply exit code.
- Know your contexts. The exam, like this lab, can put tasks on more than one cluster. `kubectl config get-contexts` before anything else.
