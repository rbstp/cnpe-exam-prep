# 5.5 mTLS and workload identity: Istio and SPIRE

Competency: configuring secure service-to-service communication (domain 5, 15%). Needs: `make mesh` (second cluster, context `kind-mesh`) and `make spire` on the main cluster. Run them separately if the laptop complains; they don't interact.

Service-to-service security is two ideas wearing one acronym: encryption in transit, and cryptographic *identity*, meaning each workload can prove which service it is rather than which IP it squats on. mTLS delivers both at once, and the reason meshes exist is to deliver it without touching application code.

## Istio ambient, the shape of it

The mesh cluster runs Istio's ambient mode: no sidecars. A per-node proxy (ztunnel) intercepts traffic for enrolled namespaces and wraps it in mTLS using per-workload certificates issued by istiod; the identities inside the certs are SPIFFE IDs of the form `spiffe://cluster.local/ns/<namespace>/sa/<serviceaccount>`. Note what that string is built from: the ServiceAccount is the identity, which quietly upgrades every RBAC decision you made in 5.1 into network-level identity. Enrolment is one label: `istio.io/dataplane-mode=ambient` on the namespace, and the lab pre-enrols `default` on the mesh cluster.

The policy objects to know: PeerAuthentication sets the mTLS mode per mesh, namespace, or workload; `STRICT` refuses plaintext, `PERMISSIVE` (the default) accepts both while you migrate, and knowing that permissive-by-default is why "install mesh" ≠ "encrypted everywhere" is exam gold. AuthorizationPolicy then makes *authz* decisions on those identities, e.g. only `cluster.local/ns/default/sa/frontend` may call the payments service. L4 rules work with ztunnel alone; L7 rules (methods, paths) require a waypoint proxy, ambient's opt-in L7 tier.

## SPIRE, identity without a mesh

SPIRE is the identity half standalone: a server holds a CA and registration entries, per-node agents attest workloads (which node, which SA, which pod labels) and hand them short-lived SVIDs (SPIFFE Verifiable Identity Documents, X.509 or JWT) over the Workload API, a Unix socket the pod mounts via CSI driver. No traffic interception; applications or middlewares fetch their own certs and rotation is automatic. The lab installs the full stack plus a ClusterSPIFFEID CR that templates registrations for workloads. When an exam scenario says "workloads must authenticate to an external service with short-lived credentials, no mesh", this is the shelf to reach for.

Linkerd, since the tool list names it: same destination (automatic mTLS on by default, in fact), sidecar dataplane, `linkerd viz edges` shows the secured links. `MESH=linkerd make mesh` swaps the lab over if you want a session on it; the concepts transfer wholesale, only the nouns change.

## Exercises

All on `kind-mesh` (`kubectx kind-mesh`) except the SPIRE ones.

**See mTLS happen to plaintext apps.** Deploy two plain services in `default` and talk between them:

```bash
kubectl create deploy backend --image=ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine --port=8080
kubectl expose deploy backend --port=8080
kubectl run client --image=curlimages/curl:8.11.1 --restart=Never -- sh -c 'sleep 3600'
kubectl exec client -- curl -s -o /dev/null -w '%{http_code}\n' http://backend:8080
```

Verify the encryption claim with evidence, not vibes: `istioctl ztunnel-config workload` lists both pods with protocol HBONE (Istio's mTLS tunnel), and `kubectl -n istio-system logs ds/ztunnel | grep -i backend | tail` shows connections with source and destination SPIFFE identities. The app never changed; the platform upgraded it.

**Refuse plaintext.** Apply STRICT and attack from outside the mesh:

```bash
kubectl apply -f - <<'EOF'
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata: { name: default, namespace: default }
spec: { mtls: { mode: STRICT } }
EOF
kubectl create ns outsider   # not labelled ambient, therefore not in the mesh
kubectl -n outsider run intruder --image=curlimages/curl:8.11.1 --restart=Never -- \
  curl -s -m 5 -o /dev/null -w '%{http_code}' http://backend.default.svc:8080
```

Verify: the in-mesh client still gets 200; the outsider's curl fails (its plaintext is refused). Delete the PeerAuthentication and the outsider succeeds again. That triple (before, strict, after) is the demonstration the competency wording asks for.

**Authorize by identity.** With STRICT back on, add an AuthorizationPolicy allowing only the `client` pod's ServiceAccount to reach backend, then test from a second pod running as a different SA. Verify: allowed SA 200, other SA denied (L4 deny shows as connection reset/failure). You have now made a network decision based on *who*, not *where from*, which is the sentence to say about zero-trust if asked.

**Meet your SVIDs (main cluster).** `kubectx kind-cnpe`, then:

```bash
kubectl -n spire exec sts/spire-server -c spire-server -- \
  /opt/spire/bin/spire-server entry show
kubectl get clusterspiffeids
```

Verify: registration entries exist mapping SPIFFE IDs to Kubernetes selectors, and you can read one entry aloud: this ID is issued to workloads matching this namespace/SA, attested by this parent agent. Then inspect the ClusterSPIFFEID CR and connect its template to the entries it generated. If you want the full loop, mount the CSI socket (`csi.spiffe.io` driver) in a pod and list the socket file; the identities are delivered as files, no network call, which is the property that makes SPIRE composable with everything.

## Docs to know your way around

- istio.io: ambient overview, PeerAuthentication and AuthorizationPolicy references
- spiffe.io: the SPIFFE concepts page (ID, SVID, Workload API); spire-server entry syntax
- linkerd.io: automatic mTLS page, for the compare-and-contrast sentence
