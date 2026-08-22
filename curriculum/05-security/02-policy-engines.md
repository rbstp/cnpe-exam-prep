# 5.2 Policy engines: admission control, Kyverno, Gatekeeper

Competency: using policy engines and admission controllers for governance (domain 5, 15%). Needs: `make up sec`.

Admission control is the API server's last word: after authentication and authorization, every write passes through mutating admission (webhooks may change it) and then validating admission (webhooks may reject it), and only then reaches etcd. Policy engines are just well-organised admission webhooks plus reporting. Three engines matter here: Kubernetes' own ValidatingAdmissionPolicy (CEL, in-process, no webhook), Kyverno, and OPA Gatekeeper. The lab runs all three, which sounds redundant and is exactly the point: the same rule expressed three ways is the fastest way to learn what is engine-specific and what is admission-generic.

## The three dialects

Kyverno, current API: policies are dedicated kinds now, `ValidatingPolicy` and `MutatingPolicy` with CEL expressions, not the old `ClusterPolicy` with typed rules that most tutorials still show. The lab's `examples/kyverno/` pair is the modern form: `require-resources.yaml` validates every container declares requests (in `Audit` mode, flip to `Deny` to enforce), `add-tenant-label.yaml` mutates a cost-centre label onto Deployments at admission. Kyverno also produces PolicyReports: `kubectl get policyreports -A` is governance-as-data, and Audit mode plus reports is how you roll a policy out without breaking every team on day one. That rollout choreography (Audit → read reports → fix offenders → Enforce) is a better exam answer than "apply the policy".

Gatekeeper: two-step. A ConstraintTemplate defines a parameterised policy in Rego and generates a CRD; a Constraint is an instance of that CRD binding it to resources with parameters. `enforcementAction` on the constraint (deny, warn, dryrun) is its Audit/Enforce dial, and `kubectl get constraints` shows violation counts from the audit sweep. This is also where the exam's "OPA" lives in practice: Rego inside templates.

ValidatingAdmissionPolicy: native, CEL, no controller to install, paired with a ...Binding object. Worth one rep because it is what the other two increasingly compile down to, and because a task could hand it to you.

For all engines the debugging move is the same: the denial message arrives in the *apply error*, verbatim, and the webhook configuration (`kubectl get validatingwebhookconfigurations`) tells you what is intercepted. A cluster that rejects everything mysteriously usually has a policy engine's webhook with a dead backend; know that failurePolicy exists and what Fail vs Ignore trades.

## Exercises

**Flip the lab policy to enforce and feel the difference.** One trap to dodge first, and it is the best lesson in this section: the tenant namespaces cannot demonstrate this policy at all, because their LimitRanges inject requests and LimitRanger is a built-in *mutating* admission plugin that runs before validating webhooks. By the time Kyverno sees a team-a or team-b pod, it already has requests. Admission order is mutate, then validate, and a validation policy can be satisfied by a mutation the user never wrote. So drill in a namespace with no LimitRange:

```bash
kubectl create ns policy-test
kubectl -n policy-test run naked --image=busybox:1.37 --restart=Never -- sleep 60   # succeeds: Audit
kubectl get policyreports -n policy-test    # the violation is recorded instead
kubectl patch validatingpolicy require-resource-requests --type=merge \
  -p '{"spec":{"validationActions":["Deny"]}}'
kubectl -n policy-test run naked2 --image=busybox:1.37 --restart=Never -- sleep 60
```

Verify: the second run is rejected and the error quotes the policy's own message ("every container must set cpu and memory requests"), while the same pod in team-b still sails through with LimitRange-injected requests. Flip back to `["Audit"]` when done.

**Watch the mutation happen.** Create a Deployment in team-b, then read it back: `kubectl -n team-b get deploy <name> -o jsonpath='{.metadata.labels.cost-centre}'` prints the namespace name, put there at admission by `add-cost-centre-label`. Verify against a deployment created *before* the policy existed (none of the lab's have the label): mutation is admission-time only, and retro-fitting existing objects is a separate Kyverno capability (mutating existing resources) you should know exists without memorising its current field name.

**Write the Gatekeeper twin.** Same rule, Rego dialect, same LimitRange-free namespace. ConstraintTemplate `k8srequireresources` whose Rego denies containers missing resource requests, then a constraint targeting Pods in `policy-test` with `enforcementAction: warn` first. Gatekeeper's library (open-policy-agent/gatekeeper-library) has a `containerlimits` template to adapt; adapting library Rego rather than writing from scratch is the honest workflow. Verify: a naked pod now triggers a warning on create (visible in the kubectl output), then set deny and confirm rejection; `kubectl get k8srequireresources -o yaml` shows audit violations counted. You have now enforced one rule in two engines and can articulate the trade: CEL policies read like schemas, Rego like code; Kyverno mutates and generates, Gatekeeper's audit and library are mature.

**One native rep.** Express the same rule as a ValidatingAdmissionPolicy + binding (CEL: `object.spec.containers.all(c, has(c.resources.requests))`, match Pods, bound to `policy-test`). Verify: rejection with your message, no engine involved. Delete it after, along with the `policy-test` namespace, so the engines' results stay interpretable.

**Read the interception surface.** `kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations` and, for one Kyverno entry, read rules (which resources), namespaceSelector (what is exempt) and failurePolicy. Verify: you can answer "if Kyverno's pods all died right now, could anyone still deploy?" from the failurePolicy alone, and say what that choice trades. (Check `kube-system` in the selector while you are there; policy engines exempting the control plane is itself a governance decision.)

## Docs to know your way around

- kyverno.io: ValidatingPolicy/MutatingPolicy references and the policy library
- open-policy-agent.github.io/gatekeeper: ConstraintTemplate walkthrough; the gatekeeper-library repo
- kubernetes.io: Validating Admission Policy, and Dynamic Admission Control for the webhook plumbing
