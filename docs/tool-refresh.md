# Updating the lab tools

This lab follows current upstream releases on purpose. Run `make tools` to compare
the installed CLIs with each project's latest GitHub release and upgrade anything
that is behind. Arch packages come from the current pacman repositories. GitHub
release assets use the SHA-256 digest published by GitHub when one is available.

Run `make refresh` for the full local refresh. It also updates every configured
Helm repository and pulls `gitea/gitea:latest` when a Gitea container already
exists. It does not create Gitea on a machine that has never run `make gitea`.
When the image changed, the refresh starts the replacement against the existing
`gitea-data` volume and waits for its health endpoint. If startup fails, it puts
the previous container back.

The commands write `.lab-versions.json`. This gitignored file records CLI version
output and binary hashes, the exact Helm chart versions selected during installs,
and known image references or digests. Attach it when reporting an upstream
compatibility problem.

The scheduled `Cluster smoke` GitHub Actions workflow checks the current kind
release against the configured Kubernetes node image once a week. It runs the
same `make up` path with `CNPE_SMOKE=1`, then tests node readiness, scheduling,
cluster DNS, Service routing, and API audit logging. Smoke mode omits the local
registry, cloud-provider-kind, Gateway API, metrics-server, and VPA. It never
starts Gitea, GitOps controllers, the second cluster, or the full platform stack.
