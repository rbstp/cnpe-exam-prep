# 5.1 RBAC and secrets: least privilege in practice

Competency: applying RBAC and security controls across platform resources (domain 5, 15%). Needs: `make up sec` (the tenant Role and the secrets controllers come with `sec`).

RBAC questions are gift questions if the model is exact and time sinks if it is fuzzy. The model: Roles and ClusterRoles are bags of allowed verbs on resources (allow-only; there is no deny). Bindings attach a bag to a subject (User, Group, ServiceAccount). Scope composes in one asymmetric way that exams love: a RoleBinding can reference a ClusterRole, granting its rules *within one namespace only*, which is how you define "developer" once and bind it per tenant. A ClusterRoleBinding grants everywhere, and it is almost always the wrong default.

Subjects: Users and Groups are asserted by the authentication layer (certificates, OIDC), not stored as objects, which is why you can bind to `dev-a` without any `dev-a` existing anywhere. ServiceAccounts are objects, and they are how *software* gets identity; every controller failure that says Forbidden traces to some SA's missing rule. Verbs worth care: `list` vs `get` vs `watch` are separate; `create` on `pods/exec` is what exec needs; wildcards exist and least privilege says don't.

The two interrogation commands: `kubectl auth can-i <verb> <resource> --as=<user> -n <ns>` (also `--as=system:serviceaccount:<ns>:<name>`), and `kubectl auth can-i --list --as=... -n <ns>` for the full matrix. Every RBAC task should end with one of these as proof.

Secrets, the controls half. A stock Secret is base64, not encryption, and anyone with `get secrets` in the namespace has the plaintext. The platform answers: Sealed Secrets encrypts *for git* (kubeseal encrypts against the controller's public key; only the in-cluster controller can decrypt, so the sealed form is safe to commit, solving GitOps' secret problem), and External Secrets Operator syncs *from external stores* (a SecretStore says where and how to authenticate, an ExternalSecret says which keys to materialise as a Secret). Different problems: sealed = encrypted at rest in git; ESO = git holds only references, the store holds truth.

## Exercises

**Interrogate the tenant role.** `examples/multitenancy/team-a.yaml` binds Role `developer` to user `dev-a`. Predict, then check, each of these:

```bash
kubectl auth can-i create deployments --as=dev-a -n team-a
kubectl auth can-i delete secrets     --as=dev-a -n team-a
kubectl auth can-i list secrets       --as=dev-a -n team-a
kubectl auth can-i create pods        --as=dev-a -n team-b
kubectl auth can-i list nodes         --as=dev-a
```

Verify: yes, no, yes, no, no, and for each "no", name the missing piece (rule vs binding vs scope). The secrets split (read yes, write no) is deliberate least-privilege design; find the comment in the file.

**Promote the role to a reusable ClusterRole.** Convert `developer` into a ClusterRole and bind it into team-b with a RoleBinding for user `dev-b`. Verify: `kubectl auth can-i create deployments --as=dev-b -n team-b` yes, `-n team-a` no. One definition, per-tenant grants; this shape is the answer to most "design RBAC for tenants" prompts.

**Give software an identity.** Create SA `reporter` in team-a allowed only to `get,list` pods, then prove it from inside:

```bash
kubectl -n team-a create sa reporter
kubectl -n team-a create role pod-reader --verb=get,list --resource=pods
kubectl -n team-a create rolebinding reporter --role=pod-reader --serviceaccount=team-a:reporter
kubectl -n team-a run api-probe --image=bitnami/kubectl:latest --restart=Never \
  --overrides='{"spec":{"serviceAccountName":"reporter"}}' -- get pods
kubectl -n team-a logs api-probe
```

(The image's entrypoint is already `kubectl`, so the args are just `get pods`; doubling it up runs `kubectl kubectl`.) Verify: the pod lists pods successfully; then re-run with `-- get secrets` and read the Forbidden message, noting it names the SA, the verb, and the resource. That message format is the same one you met in workflow failures (3.4) and will meet again in operator logs.

**Seal a secret for git.** The controller from `make sec` is in kube-system:

```bash
kubectl -n team-a create secret generic db-pass --from-literal=password=hunter2 \
  --dry-run=client -o yaml | kubeseal --controller-namespace kube-system --controller-name sealed-secrets -o yaml > sealed.yaml
grep -c hunter2 sealed.yaml   # must print 0
kubectl apply -f sealed.yaml
kubectl -n team-a get secret db-pass -o jsonpath='{.data.password}' | base64 -d
```

Verify: the sealed file contains no plaintext, yet the unsealed Secret round-trips to `hunter2`. Now delete the Secret only and watch the controller recreate it from the SealedSecret; that reconcile is why the sealed form is the source of truth you commit.

**ESO with a fake store.** External Secrets ships a `fake` provider made for exactly this practice: create a SecretStore of provider fake holding key `pg/password`, an ExternalSecret targeting it, and verify the materialised Secret appears with the value, refreshed on interval. Verify: `kubectl get externalsecret` shows SecretSynced True. The provider is fake; the CRD mechanics, which are what the exam could touch, are entirely real.

**The drill.** `FAULT=rbac make break`. Everything looks Running; only the can-i matrix shows the hole. Target: found and fixed in 7 minutes, proven by the restored `auth can-i` output.

## Docs to know your way around

- kubernetes.io: Using RBAC Authorization (the RoleBinding-to-ClusterRole pattern is spelled out there)
- sealed-secrets and external-secrets docs: one page each on their CRDs; the fake provider is under ESO's provider list
