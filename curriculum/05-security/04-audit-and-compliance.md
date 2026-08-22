# 5.4 Audit trails, SBOMs, and compliance reports

Competency: generating audit trails and enforcing policy compliance, SBOM and compliance reports included (domain 5, 15%). Needs: `make up cicd` (Trivy Operator rides in with `cicd`); the PSS-audit crossover also wants `sec`.

This competency is listed explicitly in the official PDF and is the least-practised one in the domain, because almost no home lab turns on API audit logging. This one does, at cluster build, precisely for that reason.

## API server audit logs

The audit pipeline: a policy file tells the API server what to record and at what level (None, Metadata, Request, RequestResponse), and a backend (here, a log file on the control-plane node) receives one JSON event per stage of each request. The policy is `kind/audit-policy.yaml` in this repo; read it and note the shape: high-value resources (secrets, RBAC) at higher levels, noise (events, leases) dropped, a catch-all Metadata rule at the end. Policy rules match in order, first hit wins, which is the same mental model as Alertmanager routes.

The events themselves are the exam skill. Fields that answer real questions: `user.username` (who), `verb` and `objectRef` (did what to what), `responseStatus.code` (did it work), `stageTimestamp`, and `annotations` including the authorization reason and, neatly, PSS audit-mode violations from 5.3. Reading audit JSON with jq is "generating audit trails" cashed out as a task.

One operational scar the repo already documents: the apiserver is started with `--audit-policy-file` pointing into a mounted directory, and if the file is missing the API server does not start at all. An audit misconfiguration can present as a dead cluster; file that away.

## Supply-chain paper trail: Trivy Operator

The operator rescans continuously and materialises results *as CRDs*, which is the platform move: compliance as queryable API objects rather than PDF attachments. The inventory: `vulnerabilityreports` (CVEs per workload image), `sbomreports` (CycloneDX per image), `configauditreports` (misconfigurations), `exposedsecretreports`, `rbacassessmentreports`, `clusterinfraassessmentreports` (per-node), and `clustercompliancereports` (CIS, NSA, PSS rollups). `make validate` demands minimum counts of these, so a fresh `cicd` layer gives you a populated dataset to practise queries on.

## Exercises

**Interrogate the audit log.** It lives on the control-plane node, reachable through docker:

```bash
docker exec cnpe-control-plane tail -1 /var/log/kubernetes/audit.log | jq .
```

Now answer three questions an auditor would ask, each with one jq line: who read any secret today (`select(.objectRef.resource=="secrets" and .verb=="get")`, print user and name); every delete that succeeded (`select(.verb=="delete" and .responseStatus.code<300)`); all denied requests (`select(.annotations["authorization.k8s.io/decision"]=="forbid")`). Verify the loop is closed end to end: do something distinctive (`kubectl -n team-a delete pod bare --ignore-not-found`, or a `kubectl auth can-i` as dev-a from 5.1), then find your own action in the log within seconds. An audit trail you have personally queried for your own fingerprints is one you can be examined on.

**Find the PSS echo.** With 5.3 done, grep the audit log for `pod-security.kubernetes.io` in annotations. Verify: the lazy pod's restricted violations were recorded by the namespace's `audit: restricted` label, timestamped and attributed. Three sections (5.2, 5.3, 5.4) just met in one log line, which is roughly how a real compliance program works.

**Mine the vulnerability data.** Not "are there reports" but questions with answers:

```bash
kubectl get vulnerabilityreports -A -o json | jq -r '
  .items[] | [.metadata.namespace, .metadata.name,
  (.report.summary.criticalCount|tostring), (.report.summary.highCount|tostring)] | @tsv' | sort -t$'\t' -k3 -rn | head
```

Verify: a ranked worst-offenders list. Pick the top image and drill in: which CVE, which package, is there a fix version (`.report.vulnerabilities[] | select(.severity=="CRITICAL")`). That triage, from fleet view to one actionable package bump, is the whole vulnerability-management job in miniature.

**Produce and read an SBOM.** Fleet-side: `kubectl get sbomreports -A | head`, then extract one and count its components (`kubectl get sbomreport <name> -n <ns> -o jsonpath='{.report.components.components}' | jq length`). Artifact-side, the pipeline angle from 2.4: `trivy image --format cyclonedx --output sbom.json ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine` and confirm both SBOMs speak the same CycloneDX. Verify: you can say what an SBOM is *for* in one sentence (when the next log4shell drops, you query your SBOMs for the package instead of rescanning the world).

**Read a compliance rollup.** `kubectl get clustercompliancereports` (CIS, NSA, PSS variants), then one in detail: `kubectl get clustercompliancereport cis -o jsonpath='{.status.summary}'`, and find one failing control's ID and description in the full output. Verify: you can trace a failed control to the check behind it and say which earlier curriculum section would fix it. Most CIS findings in this lab trace back to sections 5.1-5.3 controls, which is a satisfying way to discover the curriculum is a compliance program wearing a study plan's clothes.

## Docs to know your way around

- kubernetes.io: Auditing (policy levels, stages, and the event schema)
- aquasecurity.github.io/trivy-operator: the CRD reference pages, one per report kind
