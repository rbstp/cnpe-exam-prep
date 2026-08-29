SHELL := /bin/bash
S     := ./scripts

.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## ── one-time ────────────────────────────────────────────────────────────
host:    ## Kernel limits, docker, thermal advice (run once, needs sudo)
	@$(S)/00-host-setup.sh
tools:   ## Install every CLI into ~/.local/bin
	@$(S)/01-tools.sh

## ── the lab ─────────────────────────────────────────────────────────────
up:      ## Create the cluster: kind + Cilium + LB + metrics + VPA + registry
	@$(S)/10-cluster-up.sh
gitea:   ## Local git server, seeded repos, CoreDNS entry
	@$(S)/11-gitea.sh
gitops:  ## Argo CD, Argo Rollouts, Argo Workflows, Flux        [domain 2]
	@$(S)/20-gitops.sh
cicd:    ## Tekton Pipelines/Triggers/Dashboard, Trivy Operator [domain 2]
	@$(S)/30-cicd.sh
api:     ## Crossplane, CloudNativePG, kro, kubebuilder hints   [domain 3]
	@$(S)/40-platform-api.sh
obs:     ## Prometheus, Grafana, OTel, Jaeger, Loki+Alloy, OpenCost    [domain 4]
	@$(S)/50-observability.sh
sec:     ## Kyverno, Gatekeeper, sealed/external secrets, PSS   [domain 5]
	@$(S)/60-security.sh
spire:   ## SPIFFE/SPIRE workload identity                   [domain 5]
	@$(S)/65-spire.sh
mesh:    ## Second cluster + Istio (MESH=linkerd works) + Flagger [domain 5]
	@$(S)/70-mesh.sh
portal:  ## Scaffold Backstage on the host                      [domain 3]
	@$(S)/80-backstage.sh

core: up gitea gitops              ## Minimum useful lab (~4 GB)
full: core cicd api obs sec spire  ## Everything on the main cluster (~14 GB)

## ── daily ───────────────────────────────────────────────────────────────
fix-cp-metrics: ## Expose control-plane metrics on an existing cluster (Prometheus targets)
	@$(S)/94-fix-cp-metrics.sh
validate: ## Functionally verify every layer (FAST=1 to skip probes)
	@$(S)/92-validate.sh
forward: ## Start a background port-forward for every UI
	@$(S)/93-forward.sh start
forward-stop: ## Kill all port-forwards started by 'make forward'
	@$(S)/93-forward.sh stop
grade:   ## Run a mock exam's grading block from its page (EXAM=1|2)
	@bash curriculum/tools/grade.sh "$(or $(EXAM),1)"
study:   ## Open the CNPE study console (curriculum) in a browser
	@f="$(CURDIR)/curriculum/index.html"; \
	 if command -v xdg-open >/dev/null; then xdg-open "$$f" >/dev/null 2>&1 & \
	 elif command -v open >/dev/null; then open "$$f"; \
	 else echo "open file://$$f"; fi
fonts:   ## Re-cut assets/fonts from tools/fonts-src to the console's charset (needs fonttools, brotli)
	@python3 curriculum/tools/subset-fonts.py
site:    ## Stage the study console exactly as Pages publishes it, into ./_site
	@curriculum/tools/stage-site.sh "$(CURDIR)/_site"
	@echo "serve it: python3 -m http.server -d _site 8080"
browser: ## Browser-check the staged console like CI does (needs the playwright npm package)
	@curriculum/tools/stage-site.sh "$(CURDIR)/_site" >/dev/null
	@node curriculum/tools/browser-checks/run.js "$(CURDIR)/_site"
worker:  ## Test the progress-sync Worker against a stub D1 (plain node, no deps)
	@node sync/test.mjs
merge:   ## Test the progress merge over plain objects (plain node, no deps)
	@node curriculum/tools/merge-test.mjs
syntax:  ## Test the command-block highlighting over plain strings (plain node, no deps)
	@node curriculum/tools/syntax-test.mjs
typecheck: ## Type-check the console's JS via JSDoc (needs typescript, @types/node, playwright resolvable)
	@npx tsc -p curriculum/jsconfig.json
	@npx tsc -p curriculum/tools/browser-checks/tsconfig.json
	@npx tsc -p sync/jsconfig.json
	@echo "typecheck clean"
urls:    ## Every UI, its URL/port-forward, and credentials
	@$(S)/91-urls.sh
status:  ## Clusters, endpoints, unhealthy pods, host load
	@$(S)/90-status.sh
break:   ## Inject a random fault, then diagnose it under time pressure (DOMAIN=/FAULT= to scope)
	@$(S)/95-break.sh
break-fix: ## Auto-diagnose and repair whatever 'make break' injected
	@$(S)/96-break-fix.sh
down:    ## Delete both clusters (keeps git history + registry)
	@$(S)/99-down.sh clusters
nuke:    ## Delete everything including Gitea data
	@$(S)/99-down.sh all

.PHONY: help host tools up gitea gitops cicd api obs sec mesh portal core full spire validate fix-cp-metrics study fonts site browser worker merge syntax typecheck urls forward forward-stop status break break-fix down nuke

break-answer: ## Reveal the last injected fault
	@cat /tmp/cnpe-lab/.last-fault 2>/dev/null || echo "none injected yet"
