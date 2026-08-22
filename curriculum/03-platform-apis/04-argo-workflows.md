# 3.4 Argo Workflows: orchestration for self-service

Competency: implementing workflows for self-service provisioning using platform APIs (domain 3, 25%). Needs: `make core` (Workflows installs with the gitops layer; the controller watches the `argo` and `default` namespaces).

Argo Workflows runs DAGs of containers. It is not CI (that is Tekton's job in this lab) and not reconciliation (that is operators); it is imperative orchestration with dependencies, retries, and parameters, which makes it the right engine for provisioning sequences: validate the request, create the resources, register them elsewhere, notify. Run to completion, not converge forever, and that distinction is section 3.6's whole decision table.

## The model

A Workflow is a spec with an `entrypoint` and a list of `templates`. Templates come in flavours: `container` (run this image), `script` (inline code), `resource` (create/patch a Kubernetes object, the provisioning workhorse), `steps` (sequential groups, `--` for serial and `-` for parallel within a group), and `dag` (tasks with `dependencies`, the shape to default to). Parameters flow via `{{workflow.parameters.x}}` and between tasks via outputs; `when` gates conditional branches.

Reusable pieces: WorkflowTemplate (namespaced library you invoke with `workflowTemplateRef` or from the UI), CronWorkflow (scheduled). The controller stamps out pods per step; a workflow's failure diagnostics are therefore pod diagnostics plus one layer: `kubectl get workflow <name> -o jsonpath='{.status.nodes}'` shows each node's phase and message.

RBAC is the part that actually fails in practice. Workflow pods run as a ServiceAccount, and a `resource` template creating namespaces needs cluster-scoped rights that `default` does not have. The exam-shaped skill is wiring SA → Role/ClusterRole → binding → `spec.serviceAccountName` and recognising a Forbidden error in a workflow node as an RBAC problem, not a workflow problem.

## Exercises

**Provision a tenant with a workflow.** The self-service story from 3.1, made concrete. First the identity:

```bash
kubectl -n default create sa provisioner
kubectl create clusterrole tenant-provisioner --verb=create,get --resource=namespaces,resourcequotas
kubectl create clusterrolebinding tenant-provisioner --clusterrole=tenant-provisioner --serviceaccount=default:provisioner
# Argo's executor reports each step's outcome through its own CRD, so every
# workflow SA needs this too; forget it and even a correct workflow fails:
kubectl -n default create role wf-taskresults --verb=create,patch --resource=workflowtaskresults.argoproj.io
kubectl -n default create rolebinding wf-taskresults --role=wf-taskresults --serviceaccount=default:provisioner
```

Then the workflow, a two-node DAG using `resource` templates:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata: { generateName: provision-tenant-, namespace: default }
spec:
  entrypoint: provision
  serviceAccountName: provisioner
  arguments: { parameters: [{ name: team, value: team-d }] }
  templates:
    - name: provision
      dag:
        tasks:
          - name: namespace
            template: make-ns
          - name: quota
            template: make-quota
            dependencies: [namespace]
    - name: make-ns
      resource:
        action: create
        manifest: |
          apiVersion: v1
          kind: Namespace
          metadata:
            name: "{{workflow.parameters.team}}"
            labels: { tenant: "{{workflow.parameters.team}}" }
    - name: make-quota
      resource:
        action: create
        manifest: |
          apiVersion: v1
          kind: ResourceQuota
          metadata:
            name: default-quota
            namespace: "{{workflow.parameters.team}}"
          spec:
            hard: { requests.cpu: "1", requests.memory: 2Gi, pods: "10" }
```

`kubectl create -f` it (generateName forbids apply), then watch: `kubectl get workflow -w`. Verify the platform way: the workflow reaches Succeeded, *and* `kubectl get ns team-d --show-labels` plus `kubectl -n team-d get resourcequota` show the artifacts. A green workflow that produced nothing would still be a failure; check the output, not the runner.

**Break it on RBAC, on purpose.** Rerun with `serviceAccountName: default` and a new team name. Verify: the workflow fails, and `kubectl get workflow <name> -o jsonpath='{.status.nodes}' | jq '.[] | {phase, message}'` contains a `forbidden` message naming a missing verb and resource. Which rule it names first is instructive: with the bare default SA the executor usually trips over `workflowtaskresults` (its own reporting channel) before your namespace rule even gets a chance, an Argo-specific wrinkle that looks baffling until you have seen it once. Either way, the message structure is identical for every RBAC failure you will ever debug.

**Parameterise from outside.** Submit the same workflow for `team-e` without editing the file. The UI's submit flow lists WorkflowTemplates, not bare Workflows, so either promote yours to a `WorkflowTemplate` first (change the kind, drop generateName for a name) and submit it from the UI with the parameter overridden, or stay in the shell and `sed 's/team-d/team-e/' workflow.yaml | kubectl create -f -`. Verify: two tenants exist, one workflow spec. Parameters-at-submit is what makes a workflow a self-service endpoint rather than a script, and the WorkflowTemplate promotion is exactly how you would productise it.

**A guardrail branch (stretch).** Add a first DAG node `check` using a `script` template that exits non-zero when `{{workflow.parameters.team}}` doesn't match `^team-[a-z]+$`, and make the other nodes depend on it. Verify: a run with `team=Team_X` fails at check and creates nothing. Input validation before side effects; the same shape as admission, one layer earlier.

Clean up the test tenants when done: `kubectl delete ns team-d team-e`.

## Docs to know your way around

- argo-workflows.readthedocs.io: the core concepts page, the fields reference for `resource` templates, and the walk-through's DAG examples
- The Workflows UI's built-in examples (submit → examples) are a legitimate crib sheet during practice
