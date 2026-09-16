# Security policy

## Reporting a vulnerability

Report privately through GitHub, not in a public issue:
[**Report a vulnerability**](https://github.com/rbstp/cnpe-exam-prep/security/advisories/new)
(Security tab, then "Report a vulnerability").

Include what you did, what happened, and what you expected. A command or a
request that reproduces it is worth more than a description of it.

Expect an acknowledgment within 5 business days and a fix or a decision within
30 days. This is a side project maintained by one person, so those are targets,
not a contract. You will get a straight answer either way, and credit in the
advisory unless you would rather not have it.

## What is in scope

The code this repo ships and the services it runs:

- the study console under `curriculum/`, including the hosted site at
  [cnpe.rbstp.dev](https://cnpe.rbstp.dev)
- the progress-sync Cloudflare Worker under `sync/`, its D1 schema and its
  GitHub OAuth flow (see [docs/progress-sync.md](docs/progress-sync.md))
- the lab scripts under `scripts/` and the GitHub Actions workflows under
  `.github/workflows/`

Things worth reporting: stored progress readable across accounts, an OAuth or
session flaw in the sync Worker, script injection into a study page, a lab
script that writes outside the paths it claims, a workflow that lets branch
content reach a privileged token.

## What is not in scope

The lab is deliberately weak, because it is a teaching lab that runs on one
machine:

- `make break` injects real faults on purpose. That is the exercise.
- Gitea runs in a throwaway container bound to localhost with an admin password
  you set yourself. The README says outright that it is not a real secret.
- The `kind` clusters, the generated tokens under the repo root, and the
  permissive defaults in the example manifests are lab fixtures. Several
  exercises exist so a reader finds those weaknesses and fixes them.
- Vulnerabilities in the upstream tools the lab installs belong with those
  projects. Point them out in an issue here if the lab should stop using a
  version, and the tool refresh will pick it up.

Nothing sensitive is committed. If you find something that looks like a live
credential in this repo's history, that is in scope and worth reporting.
