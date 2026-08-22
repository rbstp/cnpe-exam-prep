#!/usr/bin/env bash
# Domain 5 (15%): Kyverno, Gatekeeper/OPA, RBAC, signing, secrets.
source "$(dirname "$0")/lib.sh"
need helm; need kubectl

log "Kyverno"
repo_add kyverno https://kyverno.github.io/kyverno/
helmi kyverno kyverno/kyverno kyverno \
  --set admissionController.replicas=1 \
  --set backgroundController.replicas=1 \
  --set cleanupController.replicas=1 \
  --set reportsController.replicas=1 \
  --set features.policyExceptions.enabled=true \
  --set features.registryClient.allowInsecure=true
  # allowInsecure: the lab registry (kind-registry:5000) is plain http, and
  # without this every ImageValidatingPolicy dies on "server gave HTTP response
  # to HTTPS client" before it ever sees a signature.

log "OPA Gatekeeper (the other engine on the exam list — know both)"
repo_add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
helmi gatekeeper gatekeeper/gatekeeper gatekeeper-system \
  --set replicas=1 --set audit.replicas=1

# NOTE: the chart repo moved from bitnami-labs.github.io to bitnami.github.io
# (the GitHub org renamed bitnami-labs/sealed-secrets -> bitnami/sealed-secrets).
# The old URL now 404s, which the "|| warn optional" below used to hide.
log "Sealed Secrets + External Secrets (secret delivery patterns)"
repo_add sealed-secrets https://bitnami.github.io/sealed-secrets
helmi sealed-secrets sealed-secrets/sealed-secrets kube-system || warn "sealed-secrets optional"
repo_add external-secrets https://charts.external-secrets.io
helmi external-secrets external-secrets/external-secrets external-secrets \
  --set installCRDs=true --set webhook.replicaCount=1 --set certController.replicaCount=1 \
  || warn "external-secrets optional"

log "Applying starter Kyverno policies (audit mode — read the reports, don't just install)"
kubectl apply -f "$REPO_ROOT/examples/kyverno/" || warn "examples/kyverno not applied (error above)"

log "Applying Pod Security Standards + quota examples"
kubectl apply -f "$REPO_ROOT/examples/multitenancy/" || warn "examples/multitenancy not applied (error above)"

cat <<'INFO'

  Kyverno    kubectl get policyreports -A
             kubectl get clusterpolicies,validatingpolicies
  Gatekeeper kubectl get constrainttemplates,constraints
             kubectl -n gatekeeper-system logs deploy/gatekeeper-audit
  Audit log  docker exec -it cnpe-control-plane tail -f /var/log/kubernetes/audit.log | jq .
             (that is a real API audit trail — filter by user, verb, resource)

  RBAC drill:
    kubectl auth can-i --list --as=system:serviceaccount:team-a:default -n team-a
    kubectl auth can-i create deployments -n team-b --as=dev-a

  Supply chain drill:
    cosign generate-key-pair
    cosign sign --key cosign.key localhost:5001/demo:v1
    # then write a Kyverno ImageValidatingPolicy that requires that key

INFO
ok "Security layer ready"
