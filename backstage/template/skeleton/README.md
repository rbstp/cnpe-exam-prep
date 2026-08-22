# ${{ values.name }}

${{ values.description }}

Scaffolded from the `golden-path-service` template.

| | |
|---|---|
| Owner | `${{ values.owner }}` |
| Manifests | `k8s/overlays/dev` |
| Deployed by | Argo CD ApplicationSet `golden-path` (SCM provider generator) |
| Namespace | `${{ values.name }}-dev` |

## Change the running deployment

Edit `k8s/overlays/dev/kustomization.yaml`, commit, push. Argo CD reconciles
within ~30 seconds. Nothing here is applied by hand — verify with:

```bash
kubectl -n argocd get app ${{ values.name }}-dev
argocd app diff ${{ values.name }}-dev
```

## Prove self-heal works

```bash
kubectl -n ${{ values.name }}-dev scale deploy/${{ values.name }} --replicas=99
# watch it snap back
```
