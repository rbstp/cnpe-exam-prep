# 3.6 kro, the golden path, and choosing the right engine

Competency: automation frameworks for self-service provisioning, and the judgment call between them (domain 3, 25%). Needs: `make core api`, plus `make portal` for the golden path walk (budget the 20 minutes it takes to build).

Domain 3 hands you four ways to turn a request into resources: CRD+operator, Crossplane, workflows, and portal templates. This section adds the newest option, walks the lab's end-to-end golden path, and then forces the comparison, because "evaluate when to use operators, workflows, or pipelines" is a named outcome and a cheap scenario question.

## kro in one sitting

kro (Kube Resource Orchestrator) occupies Crossplane's niche with less machinery: one ResourceGraphDefinition declares a schema *and* the resources it expands to, kro generates the CRD and runs the reconciliation, no providers or functions involved. CEL expressions wire fields together. The same tenant API from 3.5, in kro dialect:

```yaml
apiVersion: kro.run/v1alpha1
kind: ResourceGraphDefinition
metadata: { name: tenantspace }
spec:
  schema:
    apiVersion: v1alpha1
    kind: TenantSpace
    spec:
      team: string
      cpu: string | default="1"
  resources:
    - id: ns
      template:
        apiVersion: v1
        kind: Namespace
        metadata:
          name: ${schema.spec.team}
          labels:
            tenant: ${schema.spec.team}
    - id: quota
      template:
        apiVersion: v1
        kind: ResourceQuota
        metadata:
          name: tenant-quota
          namespace: ${ns.metadata.name}
        spec:
          hard:
            requests.cpu: ${schema.spec.cpu}
```

One YAML lesson bought with real pain: keep kro's `${...}` substitutions in block style. Inside flow-style braces (`labels: { tenant: ${schema.spec.team} }`) the expression's own `}` closes the map early and the whole manifest fails to parse.

kro is young and its API moves; if this manifest disagrees with your installed version, `kubectl explain resourcegraphdefinition.spec` is the arbiter, and practising that recovery is worth more than the manifest.

## Exercises

**Stand up the kro API.** Apply the RGD above, then:

```bash
kubectl get rgd tenantspace -o jsonpath='{.status.state}{"\n"}'   # wants: Active
kubectl apply -f - <<'EOF'
apiVersion: kro.run/v1alpha1
kind: TenantSpace
metadata: { name: team-h, namespace: default }
spec: { team: team-h, cpu: "2" }
EOF
kubectl get ns team-h && kubectl -n team-h get resourcequota tenant-quota
```

Verify: the RGD is Active (meaning kro generated and established the TenantSpace CRD), and the namespace and quota exist with your values. Then compare effort honestly against 3.5: same result, one file, no providers; also no provider ecosystem, no connection secrets, alpha-grade stability. Both sentences are true and an exam answer may need either.

**Walk the golden path.** With `make portal` done and Backstage running (`cd portal && yarn start`), create a component from the "Golden path service" template. Then trace every hop with commands, because each hop is a thing that can break and a thing you may be asked about: new repo in the Gitea `services` org (`http://gitea.lab:3000/services`), the SCM-generator ApplicationSet notices it (`kubectl -n argocd get applicationset golden-path -o yaml`, read the generator block), a generated Application appears (`kubectl -n argocd get applications`), workload deploys. Verify: `make validate` flips the portal checks to green, including "Applications auto-generated from git". This is the white paper's golden path attribute implemented, and being able to *narrate* the pipeline from template to running pod is a better exam asset than any single command in it.

**The choosing drill.** For each request, pick the engine and one sentence of why: (a) every team needs a Postgres with backups that self-heals for years; (b) on request, stamp a namespace with quotas and labels from three parameters; (c) nightly, rebuild and rescan all base images, notify on failure; (d) on every push, build, test, and deploy a service; (e) offer non-technical users a form that creates a new service from a skeleton. Defensible answers: (a) operator, long-lived lifecycle with domain logic; (b) Crossplane or kro, declarative expansion, no imperative steps; (c) CronWorkflow, scheduled run-to-completion; (d) Tekton, event-driven CI; (e) Backstage template feeding GitOps. The differentiators to reason from: does state need reconciling *forever* or produced *once*; is the trigger an API object, a schedule, or a git event; who is the audience. If two engines both work, say so and pick the thinnest one; that answer style scores.

## Docs to know your way around

- kro.run: the ResourceGraphDefinition documentation and examples
- backstage.io: Software Templates (actions and parameters), plus the lab's own template at `backstage/template/template.yaml`, which is small enough to read whole
