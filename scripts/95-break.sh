#!/usr/bin/env bash
# "Diagnosing and Remediating Platform Issue and Incident Scenarios" is 1/3 of
# domain 4 and the hardest thing to practise alone. This injects one fault at
# random into team-a and starts a timer. Don't read the source before playing.
source "$(dirname "$0")/lib.sh"
need kubectl
NS=team-a
kubectl get ns "$NS" >/dev/null 2>&1 || kubectl apply -f "$REPO_ROOT/examples/multitenancy/team-a.yaml" >/dev/null

kubectl -n "$NS" delete deploy broken --ignore-not-found >/dev/null 2>&1
FAULTS=(image probe resources rbac quota netpol config)
# FAULT=<name> drills one specific fault instead of a random one, e.g.
#   FAULT=netpol make break
# Leave it unset for the real exercise -- not knowing which one it is is the point.
if [ -n "${FAULT:-}" ]; then
  printf '%s\n' "${FAULTS[@]}" | grep -qx "$FAULT" || die "FAULT must be one of: ${FAULTS[*]}"
  F="$FAULT"
else
  F=${FAULTS[$RANDOM % ${#FAULTS[@]}]}
fi

# Create the baseline in ONE apply with a compliant securityContext already set.
# Doing it as create -> set resources -> patch emits a PodSecurity warning on every
# intermediate step (team-a warns at 'restricted'), and three walls of warnings hide
# the fault you are meant to find.
kubectl -n "$NS" apply -f - >/dev/null <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: broken
  labels: { app: broken }
spec:
  replicas: 1
  selector: { matchLabels: { app: broken } }
  template:
    metadata:
      labels: { app: broken }
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: nginx-unprivileged
          image: ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine
          ports: [{ containerPort: 8080 }]
          resources:
            requests: { cpu: 25m, memory: 32Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
YAML
kubectl -n "$NS" rollout status deploy/broken --timeout=120s >/dev/null 2>&1 || true

case "$F" in
  image)     kubectl -n "$NS" set image deploy/broken nginx-unprivileged=ghcr.io/nginxinc/nginx-unprivileged:does-not-exist >/dev/null ;;
  probe)     kubectl -n "$NS" patch deploy broken --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe","value":{"httpGet":{"path":"/healthz","port":9999},"initialDelaySeconds":1}}]' >/dev/null ;;
  resources) kubectl -n "$NS" set resources deploy/broken --requests=cpu=8,memory=32Gi >/dev/null ;;
  rbac)      kubectl -n "$NS" create sa app-sa >/dev/null 2>&1
             kubectl -n "$NS" patch deploy broken -p '{"spec":{"template":{"spec":{"serviceAccountName":"app-sa"}}}}' >/dev/null
             kubectl -n "$NS" set env deploy/broken NEEDS_API=true >/dev/null ;;
  quota)     kubectl -n "$NS" patch resourcequota team-a-quota --type=merge -p '{"spec":{"hard":{"pods":"1"}}}' >/dev/null
             kubectl -n "$NS" scale deploy/broken --replicas=5 >/dev/null ;;
  netpol)    # NetworkPolicies are ADDITIVE allow-lists. Adding a narrower policy
             # cannot revoke an allowance granted by another one, so the old version
             # of this fault (adding an egress-to-pods-only policy) did nothing at
             # all: allow-dns-and-same-namespace still permitted DNS. To actually
             # break name resolution you have to remove the DNS rule itself.
             kubectl -n "$NS" patch networkpolicy allow-dns-and-same-namespace \
               --type=json -p='[{"op":"remove","path":"/spec/egress/1"}]' >/dev/null
             ;;
  config)    kubectl -n "$NS" patch deploy broken --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/volumeMounts","value":[{"name":"cfg","mountPath":"/etc/app"}]},{"op":"add","path":"/spec/template/spec/volumes","value":[{"name":"cfg","configMap":{"name":"missing-config"}}]}]' >/dev/null ;;
esac

cat <<TXT

  ⏱  Fault injected into namespace '$NS'. Deployment: broken
     Find it and fix it. Target: under 7 minutes (exam pace).

     Start here, in this order; it works for every one of these:
       kubectl -n $NS get pods
       kubectl -n $NS describe pod <pod>
       kubectl -n $NS get events --sort-by=.lastTimestamp | tail -20
       kubectl -n $NS logs <pod> --previous

     Reveal the answer when you're done:  make break-answer
TXT
echo "$F" > /tmp/cnpe-lab/.last-fault
