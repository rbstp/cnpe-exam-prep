# 3.2 CRDs: extending the API server yourself

Competency: designing and creating Custom Resource Definitions for platform services (domain 3, 25%). Needs: `make up` (the final exercise reads a Crossplane-generated CRD, so it wants `make api` too). Everything else needs nothing installed; the whole point is that a CRD needs no controller to exist.

A CRD teaches the API server a new noun. That is all it does: storage, validation, RBAC integration, `kubectl` support, watch semantics, all inherited for free. Behaviour needs a controller (section 3.3). Splitting those two in your head, schema versus behaviour, is what makes the whole domain legible.

## Anatomy, field by field that matters

`group` + `names` (plural, singular, kind, shortNames, categories) + `scope` (Namespaced or Cluster) + `versions[]`. Each version carries `served` (API answers for it), `storage` (exactly one version is what etcd holds), and a `schema`. Deprecating a version means served true, storage moved on; removing it means served false. That three-state dance is the entire versioning story at exam depth.

The schema is OpenAPI v3, and validation is where design happens: types, `required`, `enum`, `pattern`, `minimum`/`maximum`, `default`. Two extensions worth knowing by name: `x-kubernetes-validations` embeds CEL rules with custom messages (validation that references other fields, e.g. `self.max >= self.min`), and `x-kubernetes-preserve-unknown-fields` opts a subtree out of pruning. By default anything not in the schema is silently pruned on write, which is a gotcha that looks like data loss and is actually the schema doing its job.

`subresources.status` splits `/status` into its own endpoint so controllers can update status without touching spec and vice versa; without it, `kubectl` writes to status silently vanish. `additionalPrinterColumns` decides what `kubectl get` shows, and a platform API without a useful READY column is user-hostile per section 3.1.

Once a CRD is applied, wait for the `Established` condition, then the new kind behaves like any built-in: RBAC rules can name it, quota can `count/` it, `kubectl explain` documents it from the schema descriptions you wrote. Descriptions are not decoration; they are the docs your users get.

## Exercises

**Write one from nothing.** A platform-flavoured example, typed out rather than pasted, because the exam gives you a task description, not a starting file:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: tenantbuckets.platform.lab.local
spec:
  group: platform.lab.local
  scope: Namespaced
  names: { plural: tenantbuckets, singular: tenantbucket, kind: TenantBucket, shortNames: [tb] }
  versions:
    - name: v1alpha1
      served: true
      storage: true
      subresources: { status: {} }
      additionalPrinterColumns:
        - { name: Tier,     type: string,  jsonPath: .spec.tier }
        - { name: SizeGB,   type: integer, jsonPath: .spec.sizeGB }
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: [tier]
              properties:
                tier:   { type: string, enum: [bronze, silver, gold], description: "Service tier; sets replication and backup policy." }
                sizeGB: { type: integer, minimum: 1, maximum: 500, default: 10 }
              x-kubernetes-validations:
                - rule: "self.tier != 'bronze' || self.sizeGB <= 50"
                  message: "bronze tier is capped at 50GB"
            status:
              type: object
              properties:
                phase: { type: string }
```

Apply it, then make the API server prove each design decision:

```bash
kubectl wait --for=condition=Established crd/tenantbuckets.platform.lab.local
kubectl apply -f - <<'EOF'
apiVersion: platform.lab.local/v1alpha1
kind: TenantBucket
metadata: { name: good, namespace: default }
spec: { tier: silver, sizeGB: 100 }
EOF
kubectl get tb    # printer columns show Tier and SizeGB, default filled in elsewhere
```

With `cicd` installed, that last command also prints a warning that `tb` could match Tekton's triggerbindings. Keep it; it is teaching you that short names are cluster-global and first-come, which is exactly the kind of collision a platform API designer owns.

Verify the rejections, which are the real test of the schema: `tier: platinum` must fail on the enum, `sizeGB: 900` on the maximum, and `tier: bronze, sizeGB: 100` on the CEL rule with *your* message in the error. Three different validators refusing three different ways; know which produced which text.

**Prove pruning and explain.** Apply a TenantBucket with an extra field `spec.color: red`, read it back, and observe the field is gone with no error. Then `kubectl explain tenantbucket.spec --recursive` and see your descriptions serving as live documentation. Verify: you can state the flag a schema author would set to keep unknown fields, and why a platform API mostly should not.

**Status is a separate door.** `kubectl patch tenantbucket good --subresource=status --type=merge -p '{"status":{"phase":"Ready"}}'`, then confirm `kubectl get tb good -o jsonpath='{.status.phase}'` says Ready and that a plain spec-edit did not clear it. This is the mechanism every operator in section 3.3 relies on.

**Study the production-grade instance.** `kubectl get crd appenvironments.platform.lab.local -o yaml` (Crossplane generated it from the lab's XRD). Compare its schema and printer columns against yours; note what a machine-generated platform API includes that your hand-rolled one lacks (conditions conventions, connection details). Steal the ideas.

## Docs to know your way around

- kubernetes.io: Extend the Kubernetes API with CustomResourceDefinitions (the one long page covers versions, pruning, CEL validation, and defaults), Versions in CustomResourceDefinitions
- `kubectl explain crd.spec.versions --recursive` when you forget field placement, which everyone does
