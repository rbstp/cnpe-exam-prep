Kyverno's API has moved. If `kubectl apply` here fails with "no matches for kind",
your version uses a different group/version; check what's actually served:

    kubectl api-resources | grep -i kyverno
    kubectl explain validatingpolicy --recursive | head -40

That lookup *is* the exam skill. Don't memorise these files; regenerate them
from `kubectl explain` and the docs each time.
