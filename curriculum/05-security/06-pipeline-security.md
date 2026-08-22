# 5.6 Pipeline security: scan, sign, verify

Competency: integrating security scanning and compliance checks into deployment pipelines (domain 5, 15%). Needs: `make core cicd sec`, and the Dockerfile you pushed to demo-app in section 2.4.

Supply-chain security in one breath: scan what you build, sign what you ship, and refuse at admission anything unsigned or unscanned. The lab has all three stations: Trivy scans (in-pipeline and continuously via the operator), cosign signs against the local registry, and Kyverno verifies at the cluster door. The pipeline from 2.4 already contains the scan gate; this section completes the chain around it.

## The chain, station by station

Scanning belongs at two points, and the difference is the insight: in the pipeline (Trivy task, `--exit-code 1 --severity HIGH,CRITICAL`) it is a *gate*, stopping a bad image before it exists in the registry; in the cluster (Trivy Operator, section 5.4) it is *surveillance*, catching CVEs published after you shipped. Teams that only scan in CI are blind to every CVE younger than their last deploy; say that sentence in an exam answer and mean it.

Signing: cosign signs an image digest with a private key and pushes the signature to the registry alongside the image. Keyless mode (OIDC, Fulcio, Rekor) is the direction the ecosystem is moving and worth knowing as words; key-pair mode is what you can practise offline and what the mechanics teach. The thing being signed is the *digest*, which is why tags are mutable but signed supply chains are not.

Verification at admission is what makes signatures matter: a Kyverno image-verification policy holds the public key, intercepts pod creation, resolves each image, checks its signature, and rejects on failure. Without the admission half, signing is decoration. (Gatekeeper does this via external data providers; Kyverno's is the built-in one and the one to practise.) The lab's `scripts/60-security.sh` leaves a comment trail pointing exactly here.

SLSA, since the word appears in supply-chain material: levels of provenance rigour, from "you have a build process" to "hermetic, attested builds". At exam depth: provenance is an attestation of *how* an artifact was built, SBOMs say *what is inside*, signatures say *who vouches*; three different documents, one trust story.

## Exercises

**Rerun the gate consciously.** From 2.4 you have `build-and-scan` and a real image in the registry. Rerun it (`tkn pipeline start build-and-scan --last`) and this time read the scan step's output in full: `tkn pipelinerun logs --last -t scan`. Verify: you can state what would have to appear in that output for the run to fail, and where the SBOM the task generates ends up (the workspace, plus a digest in the task's results; `kubectl get taskrun <name> -o jsonpath='{.status.results}'`).

**Sign what you built.** The pipeline pushed `demo:v1` under its in-cluster name (`kind-registry:5000`); from the host the same store answers as `localhost:5001`, and the digest is identical from both sides because a digest names content, not a location:

```bash
cd $(mktemp -d) && cosign generate-key-pair   # passphrase: pick one, remember it
DIGEST=$(skopeo inspect --tls-verify=false docker://localhost:5001/demo:v1 | jq -r .Digest)
cosign sign --key cosign.key --allow-http-registry -y localhost:5001/demo@$DIGEST
cosign verify --key cosign.pub --allow-http-registry localhost:5001/demo@$DIGEST
```

Verify: "The signatures were verified against the specified public key". Then verify a *tag* instead of the digest and note cosign resolves it to the digest anyway; then try verifying an image you never signed (`localhost:5001/validate:v1` exists if you ran `make validate`) and read the failure. One success, one refusal, both understood.

**Close the door at admission.** Kyverno's current kind for this is ImageValidatingPolicy (`kubectl explain imagevalidatingpolicies.spec`; the API has moved before and the checking *is* the exercise). Three facts shape the setup, each bought with an hour of somebody's debugging:

1. Kyverno fetches signatures itself, from inside the cluster, so the pod images and the policy globs must use the in-cluster registry name (`kind-registry:5000`, which the lab wires into CoreDNS and containerd), never `localhost:5001`, which inside the Kyverno pod is the Kyverno pod.
2. The registry is plain http, and the knob for that is on the *engine*, not the policy: the lab installs Kyverno with `features.registryClient.allowInsecure=true`. Without it, every verification dies on `server gave HTTP response to HTTPS client` before any signature is read.
3. cosign v3 pushes its new bundle format by default, and Kyverno's verifier currently reads the legacy `.sig` tag, so sign a second time in legacy form for the engine's benefit: `cosign sign --key cosign.key --allow-http-registry -y --use-signing-config=false --new-bundle-format=false --tlog-upload=false localhost:5001/demo@$DIGEST`. Version skew between signer and verifier is not a lab quirk; it is the current state of the ecosystem, and recognising "no signatures found" as a *format* problem is the transferable skill.

The policy: match pods, `matchImageReferences` glob `kind-registry:5000/demo*`, one attestor with `cosign.key.data` holding your `cosign.pub` (plus `cosign.ctlog.insecureIgnoreTlog: true`, since the legacy signature skipped the transparency log), and one validation expression from the Kyverno docs' IVP examples: `images.containers.map(image, verifyImageSignatures(image, [attestors.keyed])).all(e, e > 0)`. Then:

```bash
kubectl -n team-b run signed --image=kind-registry:5000/demo:v1 --restart=Never -- sleep 60
docker tag busybox:1.37 localhost:5001/demo:unsigned && docker push localhost:5001/demo:unsigned
kubectl -n team-b run unsigned --image=kind-registry:5000/demo:unsigned --restart=Never -- sleep 60
```

Verify: signed admits, unsigned is rejected with your policy's message. Same repo, same cluster, different provenance, different fate; that pair of pod creations is the entire supply-chain argument, compressed. If the signed pod is rejected too, `kubectl -n kyverno logs deploy/kyverno-admission-controller | grep -i verif` names the real reason (registry scheme, missing `.sig`, tlog), which is precisely the diagnosis ladder above. Clean up the policy so later sections' pods admit freely.

**Wire the gate order into one sentence each.** Five controls now exist between a git push and a running pod in this lab: pipeline scan gate (2.4), registry signature (here), admission verification (here), PSS (5.3), continuous rescanning (5.4). Write one line per control naming the failure class only it catches. Verify against this: gate catches known-bad before publish; signature catches tampering and untrusted builders; admission catches bypassing the pipeline entirely; PSS catches dangerous runtime shape regardless of provenance; operator catches CVEs discovered after ship. If your five lines cover those five distinct failure classes, this competency is done.

## Docs to know your way around

- docs.sigstore.dev: cosign sign/verify with keys; skim keyless so the words are familiar
- kyverno.io: image verification policies (current kind and fields)
- slsa.dev: the levels table, five minutes
