# 1.3 Storage: volumes, claims, classes

Competency: architecture best practices for storage (domain 1, 15%). Needs: `make up`. The last exercise also wants `make api` for CloudNativePG.

The lab has no storage layer to install because kind ships one: the `standard` StorageClass backed by the local-path provisioner. That is enough to exercise every concept the exam touches, and its limitations are themselves instructive.

## The model

Three objects, one relationship. A PersistentVolume is a piece of real storage. A PersistentVolumeClaim is a request for one. A StorageClass is the recipe for making PVs on demand, and its `provisioner` field names the code that does it. Static provisioning (admin pre-creates PVs) still exists but dynamic is the assumed default: PVC references a class, provisioner makes the PV, they bind one-to-one.

The fields that decide exam tasks:

- `accessModes`: RWO (one node), ROX, RWX (many nodes), RWOP (one pod). A claim binds only to a PV that offers what it asks. local-path only does RWO, so a RWX claim here pends forever, and recognising *why* a claim pends is the skill.
- `volumeBindingMode: WaitForFirstConsumer` on the class means the PVC stays Pending until a pod uses it, so topology can be considered. Not a bug. The `standard` class here uses it, so you will see this "problem" immediately.
- `persistentVolumeReclaimPolicy`: Delete throws the data away with the claim; Retain keeps the PV around in Released state, and it will not rebind until someone clears `spec.claimRef`. Released-but-unusable PVs are a classic troubleshooting scenario.
- `allowVolumeExpansion`: only classes that set it let you grow a PVC by editing `spec.resources.requests.storage`.

StatefulSets tie in through `volumeClaimTemplates`: each replica gets its own PVC named `<template>-<sts>-<ordinal>`, and deleting the StatefulSet does not delete the PVCs. That retention is deliberate and it is why scaling a StatefulSet back up reattaches old data.

## Exercises

**Watch WaitForFirstConsumer do its thing.**

```bash
kubectl get storageclass standard -o yaml   # read provisioner, bindingMode, reclaimPolicy
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: scratch, namespace: default }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
  storageClassName: standard
EOF
kubectl get pvc scratch    # Pending, and that is CORRECT
```

Now consume it:

```bash
kubectl run writer --image=busybox:1.37 --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"writer","image":"busybox:1.37","command":["sh","-c","echo survived > /data/proof && sleep 3600"],"volumeMounts":[{"name":"d","mountPath":"/data"}]}],"volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"scratch"}}]}}'
kubectl get pvc scratch    # Bound, seconds after the pod scheduled
```

Verify persistence the honest way: delete the pod, recreate it with a command of `cat /data/proof`, and `kubectl logs writer` must print `survived`.

**Diagnose a claim that can never bind.** Create a PVC identical to the above but `accessModes: [ReadWriteMany]`, plus a pod that mounts it (without a consumer, WaitForFirstConsumer keeps the events silent and you learn nothing). Now it pends with a reason: `kubectl describe pvc` events show the provisioner refusing, because local-path only does RWO. Verify: you can state the fix (RWO, or a class whose provisioner supports RWX) and then delete pod and claim. The general lesson: a Pending PVC under WaitForFirstConsumer is normal *until* a pod consumes it; only then does silence become a finding.

**Read a real operator's storage.** `make api` installs the CloudNativePG operator; a Postgres exists once you create one (section 3.3 does, and it is worth jumping ahead for its first exercise). With one running:

```bash
kubectl get pvc -A | grep -v Bound        # unbound + consumed = a finding (your own scratch claims excepted)
kubectl get pvc -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,SC:.spec.storageClassName,MODE:.spec.accessModes[0],SIZE:.spec.resources.requests.storage'
```

Verify: you can point at each PVC and name what created it (a volumeClaimTemplate, an operator, a human). Note that a CNPG instance's PVC survives `kubectl delete pod` of the instance, and the new pod mounts the same data. That is the operator relying on exactly the PVC semantics above.

**One static PV, for completeness.** Create a PV of type `hostPath` (1Gi, RWO, `storageClassName: manual`), a PVC requesting it by the same class name, and show they bind with no provisioner involved. Verify: `kubectl get pv` shows STATUS Bound and CLAIM pointing at your PVC. Then delete the PVC and explain what the PV's new status means given its reclaim policy.

## Docs to know your way around

- kubernetes.io: Persistent Volumes (the access-modes and reclaim tables), Storage Classes, StatefulSet volumeClaimTemplates
