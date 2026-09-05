/* Direct tests for the quest's command interpreter and every battle it holds.
 * Plain node, no dependencies:
 *
 *     node curriculum/tools/game-sim-test.mjs
 *
 * assets/game-sim.js touches no DOM and assets/game-data.js is data, so the
 * whole fight is checked here rather than through a browser: the normalisation
 * table, and for every scenario the commands a player would type to surface each
 * piece of evidence, the documented fix, a plausible wrong fix, and a command
 * the scenario never heard of. The probe commands are the ones make break's
 * hints print, spelled the way people spell them. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis;                       // the data file writes window.CNPE_GAME_DATA
const req = createRequire(import.meta.url);
req(fileURLToPath(new URL("../assets/game-sim.js", import.meta.url)));
req(fileURLToPath(new URL("../assets/game-data.js", import.meta.url)));
const S = globalThis.CNPE_SIM, D = globalThis.CNPE_GAME_DATA;

let checks = 0, failures = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) console.log("  ok  " + label);
  else { failures++; console.log("  FAIL " + label); }
};
const group = t => console.log(t);

/* ── normalisation ─────────────────────────────────────────── */
group("one command, many spellings");
const SAME = [
  ["kubectl get pods -n team-a", ["k get po -nteam-a", "kubectl get pod --namespace=team-a", "kubectl -n team-a get pods | grep broken",
    "sudo kubectl --context kind-cnpe get pods -n team-a", "$ kubectl get pods --namespace team-a 2>&1", "kubectl get pods -n team-a; echo done"]],
  ["kubectl describe pods broken-x -n team-a", ["kubectl -n team-a describe pod/broken-x", "kubectl describe po broken-x --namespace team-a"]],
  ["kubectl logs broken-x -n team-a --previous", ["kubectl -n team-a logs broken-x -p", "kubectl logs -p broken-x -n team-a", "kubectl logs pod/broken-x --previous -n team-a"]],
  ["kubectl get pods -n team-a -o yaml", ["kubectl get po -oyaml -n team-a", "kubectl -n team-a get pods --output=yaml", "kubectl get pods -o=YAML -n team-a"]],
  ["kubectl get events -n team-a --sort-by=.lastTimestamp", ["kubectl -n team-a get ev --sort-by .lastTimestamp | tail -20", "kubectl get events --sort-by=.lastTimestamp -n team-a"]],
  ["kubectl get deployments,replicasets -n team-a", ["kubectl -n team-a get deploy,rs", "kubectl get deployment,replicaset -n team-a"]],
  ["kubectl get deployments broken -n team-a -o yaml", ["kubectl get deploy/broken -n team-a -o yaml", "kubectl -n team-a get deployment broken -oyaml"]],
  ["kubectl patch kustomizations drill-app -n flux-system --type=merge -p={\"spec\":{\"suspend\":false}}",
    ["kubectl -n flux-system patch kustomization drill-app --type merge -p '{\"spec\": {\"suspend\": false}}'", "kubectl patch ks drill-app -n flux-system --type=merge --patch '{ \"spec\": { \"suspend\": false } }'"]],
  ["flux resume kustomizations drill-app", ["flux resume ks drill-app", "flux resume kustomization drill-app"]],
  ["kubectl auth can-i list pods -n team-a --as=system:serviceaccount:team-a:app-sa", ["kubectl auth can-i list pods --as system:serviceaccount:team-a:app-sa -n team-a", "kubectl -n team-a auth can-i list po --as=system:serviceaccount:team-a:app-sa"]],
  ["kubectl exec broken-x -n team-a -- sh -c nslookup kubernetes.default", ["kubectl -n team-a exec broken-x -- sh -c 'nslookup kubernetes.default'", "kubectl exec -n team-a pod/broken-x -- sh -c \"nslookup kubernetes.default\""]],
  ["kubectl get pods -A", ["kubectl get pods --all-namespaces", "kubectl get po -A"]],
  ["kubectl get namespaces team-a --show-labels", ["kubectl get ns team-a --show-labels", "kubectl get namespace/team-a --show-labels"]],
  ["kubectl argo rollouts get rollouts drill-web -n team-a", ["kubectl argo rollouts get rollout drill-web -n team-a", "kubectl -n team-a argo rollouts get rollout drill-web"]],
  ["tkn pipelineruns list -n drill-ci", ["tkn -n drill-ci pr list", "tkn pipelinerun list -n drill-ci"]],
  ["crossplane beta trace appenvironments drill-env -n default", ["crossplane beta trace appenvironment drill-env -n default", "crossplane beta trace AppEnvironment/drill-env -n default"]],
  ["kubectl set image deployments broken nginx-unprivileged=img:1 -n team-a", ["kubectl -n team-a set image deploy/broken nginx-unprivileged=img:1", "kubectl set image deployment broken nginx-unprivileged=img:1 --namespace team-a"]],
  ["kubectl label namespaces team-a pod-security.kubernetes.io/enforce=baseline --overwrite", ["kubectl label ns team-a pod-security.kubernetes.io/enforce=baseline --overwrite", "kubectl label --overwrite namespace team-a pod-security.kubernetes.io/enforce=baseline"]],
  ["kubectl explain deployments.spec.template", ["kubectl explain deploy.spec.template", "kubectl explain deployment.spec.template"]],
  ["kubectl logs broken-x -n team-a -f", ["kubectl logs -f broken-x -n team-a", "kubectl -n team-a logs broken-x --follow".replace("--follow", "-f")]],
];
SAME.forEach(([want, forms]) => {
  forms.forEach(f => {
    const got = S.normalize(f);
    ok(got === want, JSON.stringify(f) + " -> " + want + (got === want ? "" : ", got " + got));
  });
  ok(S.normalize(want) === want, "and the canonical form is a fixed point: " + want);
});
ok(S.normalize("") === "" && S.normalize("   ") === "" && S.normalize("$") === "", "a blank line normalises to nothing");
ok(S.normalize("kubectl get pods -a") === "kubectl get pods -a", "-a and -A are different flags");
[["kubectl get pods", "kubectl"], ["flux get ks", "flux"], ["argocd app get x", "argo"], ["kubectl argo rollouts get rollout x", "argo"],
  ["tkn pr list", "tekton"], ["crossplane beta trace x y", "crossplane"], ["kubectl get servicemonitors -A", "platform"],
  ["kubectl get kustomizations -A", "flux"], ["kubectl get pipelineruns -n drill-ci", "tekton"], ["nonsense", "nonsense"]].forEach(([cmd, want]) => {
  const got = S.toolOf(cmd);
  ok(got === want, "toolOf names the family: " + JSON.stringify(cmd) + " -> " + want + (got === want ? "" : ", got " + got));
});

/* ── the probes: what a player types, per scenario ─────────── */
// evidence: one command per piece, in the scenario's order; fix; wrong; other: a
// valid command the scenario has no special answer for.
const PROBES = {
  image: { evidence: ["kubectl -n team-a get pods", "kubectl -n team-a describe pod broken-6b7f9c4d8-x2k4p", "kubectl -n team-a get deploy broken -o yaml"],
    fix: "kubectl -n team-a set image deploy/broken nginx-unprivileged=ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine",
    wrong: "kubectl -n team-a rollout restart deploy/broken", other: "kubectl -n team-a get svc" },
  probe: { evidence: ["kubectl get pods -n team-a", "kubectl -n team-a get events --sort-by=.lastTimestamp | tail -20", "kubectl -n team-a get deploy broken -o yaml"],
    fix: "kubectl -n team-a patch deploy broken --type=json -p='[{\"op\":\"remove\",\"path\":\"/spec/template/spec/containers/0/readinessProbe\"}]'",
    wrong: "kubectl -n team-a patch deploy broken --type=json -p='[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/ports/0/containerPort\",\"value\":9999}]'", other: "kubectl -n team-a get quota" },
  resources: { evidence: ["kubectl get pods -n team-a", "kubectl -n team-a describe pod broken-6b7f9c4d8-x2k4p", "kubectl -n team-a get deploy broken -o yaml"],
    fix: "kubectl -n team-a set resources deploy/broken --requests=cpu=25m,memory=32Mi", wrong: "kubectl -n team-a set resources deploy/broken --requests=cpu=4,memory=8Gi", other: "kubectl -n team-a get netpol" },
  rbac: { evidence: ["kubectl -n team-a describe pod broken-6b7f9c4d8-x2k4p", "kubectl -n team-a logs deploy/broken", "kubectl auth can-i list pods --as=system:serviceaccount:team-a:app-sa -n team-a"],
    fix: "kubectl -n team-a create rolebinding app-sa-view --clusterrole=view --serviceaccount=team-a:app-sa", wrong: "kubectl create clusterrolebinding app-sa-admin --clusterrole=cluster-admin --serviceaccount=team-a:app-sa", other: "kubectl -n team-a get events" },
  quota: { evidence: ["kubectl -n team-a get deploy,rs", "kubectl -n team-a describe rs broken-6b7f9c4d8", "kubectl -n team-a describe quota team-a-quota"],
    fix: "kubectl -n team-a patch resourcequota team-a-quota --type=merge -p '{\"spec\":{\"hard\":{\"pods\":\"20\"}}}'", wrong: "kubectl -n team-a delete resourcequota team-a-quota", other: "kubectl -n team-a get limitrange" },
  netpol: { evidence: ["kubectl -n team-a describe pod broken-6b7f9c4d8-x2k4p", "kubectl -n team-a exec broken-6b7f9c4d8-x2k4p -- nslookup kubernetes.default", "kubectl -n team-a get netpol allow-dns-and-same-namespace -o yaml"],
    fix: "kubectl apply -f examples/multitenancy/team-a.yaml", wrong: "kubectl -n team-a delete netpol default-deny", other: "kubectl -n team-a get sa" },
  config: { evidence: ["kubectl get po -n team-a", "kubectl -n team-a get events --sort-by=.lastTimestamp", "kubectl -n team-a get cm"],
    fix: "kubectl -n team-a create configmap missing-config --from-literal=mode=prod", wrong: "kubectl create configmap missing-config --from-literal=mode=prod", other: "kubectl -n team-a get sa" },
  "argocd-rev": { evidence: ["kubectl -n argocd get applications", "kubectl -n argocd describe application drill-app", "kubectl -n drill-gitops get deploy,pods"],
    fix: "kubectl -n argocd patch application drill-app --type merge -p '{\"spec\":{\"source\":{\"targetRevision\":\"main\"}}}'", wrong: "argocd app sync drill-app", other: "kubectl -n drill-gitops get svc" },
  "flux-suspend": { evidence: ["kubectl -n drill-gitops get deploy,pods", "flux get kustomizations", "kubectl -n flux-system get kustomization drill-app -o yaml"],
    fix: "flux resume kustomization drill-app", wrong: "flux reconcile kustomization drill-app --with-source", other: "flux get sources git" },
  "canary-analysis": { evidence: ["kubectl argo rollouts get rollout drill-web -n team-a", "kubectl -n team-a get analysisruns", "kubectl -n team-a get analysistemplate drill-analysis -o yaml"],
    fix: "kubectl -n team-a patch analysistemplate drill-analysis --type=json -p='[{\"op\":\"replace\",\"path\":\"/spec/metrics/0/provider/prometheus/address\",\"value\":\"http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090\"}]'",
    wrong: "kubectl argo rollouts retry rollout drill-web -n team-a", other: "kubectl -n team-a get pods" },
  "tekton-task": { evidence: ["tkn -n drill-ci pipelinerun list", "kubectl -n drill-ci describe pipelinerun drill-run", "kubectl -n drill-ci get tasks"],
    fix: "kubectl -n drill-ci create task drill-lint", wrong: "tkn pipeline start drill-build -n drill-ci", other: "kubectl -n drill-ci get pipelines" },
  "tekton-trigger": { evidence: ["kubectl -n drill-ci get eventlisteners,pods", "kubectl -n drill-ci logs deploy/el-drill-listener --tail=20", "kubectl -n drill-ci get sa,rolebindings"],
    fix: "kubectl -n drill-ci create rolebinding drill-trigger-el --clusterrole=tekton-triggers-eventlistener-roles --serviceaccount=drill-ci:drill-trigger-sa",
    wrong: "kubectl -n drill-ci delete pod -l eventlistener=drill-listener", other: "kubectl -n drill-ci get triggerbindings" },
  "xp-provider-rbac": { evidence: ["kubectl -n default get appenvironment", "crossplane beta trace appenvironment drill-env -n default", "kubectl get clusterrolebindings"],
    fix: "kubectl create clusterrolebinding crossplane-provider-kubernetes-a1b2c3d4e5f6 --clusterrole=cluster-admin --serviceaccount=crossplane-system:provider-kubernetes-a1b2c3d4e5f6",
    wrong: "kubectl create ns team-drill", other: "kubectl -n crossplane-system get pods" },
  "xr-paused": { evidence: ["kubectl -n team-c get resourcequota tenant-quota -o yaml", "kubectl -n default describe appenvironment team-c-dev", "kubectl -n default get objects.kubernetes.m.crossplane.io"],
    fix: "kubectl -n default annotate appenvironment team-c-dev crossplane.io/paused-", wrong: "kubectl -n team-c patch resourcequota tenant-quota --type merge -p '{\"spec\":{\"hard\":{\"requests.cpu\":\"6\"}}}'", other: "kubectl get compositions" },
  "kyverno-deny": { evidence: ["kubectl -n team-a get deploy,rs", "kubectl -n team-a get events --sort-by=.lastTimestamp | tail -10", "kubectl get validatingpolicies"],
    fix: "kubectl delete validatingpolicy drill-deny", wrong: "kubectl delete validatingpolicy require-requests", other: "kubectl -n team-a get netpol" },
  "pss-restricted": { evidence: ["kubectl -n team-a get deploy,rs", "kubectl -n team-a describe rs broken-6b7f9c4d8", "kubectl get ns team-a --show-labels"],
    fix: "kubectl -n team-a patch deploy broken --type merge -p '{\"spec\":{\"template\":{\"spec\":{\"securityContext\":{\"runAsNonRoot\":true,\"seccompProfile\":{\"type\":\"RuntimeDefault\"}},\"containers\":[{\"name\":\"nginx-unprivileged\",\"securityContext\":{\"allowPrivilegeEscalation\":false,\"capabilities\":{\"drop\":[\"ALL\"]}}}]}}}}'",
    wrong: "kubectl label ns team-a pod-security.kubernetes.io/enforce=privileged --overwrite", other: "kubectl -n team-a get quota" },
  "svc-selector": { evidence: ["kubectl -n team-a describe svc web", "kubectl -n team-a get pods --show-labels", "kubectl -n team-a get pods"],
    fix: "kubectl -n team-a patch svc web -p '{\"spec\":{\"selector\":{\"app\":\"web-frontend\"}}}'", wrong: "kubectl -n team-a patch svc web -p '{\"spec\":{\"selector\":{\"app\":\"frontend\"}}}'", other: "kubectl -n team-a get netpol" },
  "pvc-pending": { evidence: ["kubectl -n team-a get pvc", "kubectl -n team-a describe pvc reports", "kubectl get sc standard -o yaml"],
    fix: "kubectl -n team-a run reports-job --image=busybox:1.36 --restart=Never --overrides='{\"spec\":{\"volumes\":[{\"name\":\"r\",\"persistentVolumeClaim\":{\"claimName\":\"reports\"}}]}}' -- sleep 3600",
    wrong: "kubectl -n local-path-storage rollout restart deploy/local-path-provisioner", other: "kubectl get pv" },
  "hpa-unknown": { evidence: ["kubectl -n team-a get hpa", "kubectl -n team-a describe hpa web", "kubectl -n team-a get deploy web -o yaml"],
    fix: "kubectl -n team-a set resources deploy/web --requests=cpu=100m", wrong: "kubectl -n kube-system rollout restart deploy/metrics-server", other: "kubectl -n team-a get svc" },
  "servicemonitor-labels": { evidence: ["kubectl -n team-a get servicemonitor web -o yaml", "kubectl -n team-a get svc --show-labels", "kubectl -n monitoring get prometheus prometheus-kube-prometheus-prometheus -o yaml"],
    fix: "kubectl -n team-a label servicemonitor web release=prometheus", wrong: "kubectl -n team-a label svc web app=web --overwrite", other: "kubectl -n monitoring get pods" },
  "alert-never-fires": { evidence: ["kubectl -n team-a get prometheusrule team-a-alerts -o yaml", "kubectl -n monitoring exec prometheus-prometheus-kube-prometheus-prometheus-0 -c prometheus -- wget -qO- localhost:9090/api/v1/rules", "kubectl get prometheusrules -A --show-labels"],
    fix: "kubectl -n team-a label prometheusrule team-a-alerts release=prometheus", wrong: "kubectl -n team-a patch prometheusrule team-a-alerts --type json -p '[{\"op\":\"replace\",\"path\":\"/spec/groups/0/rules/0/for\",\"value\":\"5m\"}]'", other: "kubectl -n monitoring get svc" },
  "otel-exporter": { evidence: ["kubectl -n tracing logs deploy/otel-collector --tail=5", "kubectl -n tracing get opentelemetrycollector otel -o yaml", "kubectl -n tracing get svc"],
    fix: "kubectl -n tracing patch opentelemetrycollector otel --type json -p '[{\"op\":\"replace\",\"path\":\"/spec/config/service/pipelines/traces/exporters\",\"value\":[\"debug\",\"otlp\"]}]'",
    wrong: "kubectl -n tracing rollout restart deploy/otel-collector", other: "kubectl -n tracing get deploy" },
  "eso-store-auth": { evidence: ["kubectl -n team-a get externalsecrets", "kubectl -n team-a describe secretstore vault", "kubectl -n platform-secrets get rolebindings"],
    fix: "kubectl -n platform-secrets create rolebinding eso-reader-team-a --role=eso-reader-team-a --serviceaccount=team-a:eso-team-a", wrong: "kubectl -n team-a create secret generic db-creds --from-literal=password=hunter2", other: "kubectl -n team-a get sa" },
  "image-unsigned": { evidence: ["kubectl -n team-a describe rs api-9e8f7a6b5", "kubectl get imagevalidatingpolicies", "tkn -n drill-ci pipelinerun describe api-hotfix-1-4-2-q7w3e"],
    fix: "cosign sign --key k8s://drill-ci/cosign-key registry.lab.local/team-a/api:1.4.2", wrong: "kubectl delete imagevalidatingpolicy require-signed-images", other: "kubectl -n drill-ci get tasks" },
};

/* ── every scenario ─────────────────────────────────────────── */
const ALLOWED = new Set(" ±·×÷α–“”•…›←↑→↓↻−≈≠⌕⌘⏎⏱─│┌┐└┘├┤┬┴┼═█░■□▲▶▸►▼▾◀◌◎⚠✓✔✕✖✚❚⟳⧉".split(""));
const glyphsOk = text => [...text].every(c => c.charCodeAt(0) < 128 || ALLOWED.has(c));
const looksLikeError = out => /command not found|unknown command|doesn't have a resource type|NotFound|You must specify/.test(out);

group("\n" + D.scenarios.length + " scenarios, each with a fight in it");
ok(D.scenarios.length === 24, "twenty-four faults: the sixteen make break injects and eight of the quest's own");
ok(new Set(D.scenarios.map(s => s.id)).size === D.scenarios.length, "no two share an id");
ok(new Set(D.scenarios.map(s => s.name)).size === D.scenarios.length, "nor a monster's name");
[1, 2, 3, 4, 5].forEach(d => {
  const mine = D.scenarios.filter(s => s.d === d);
  ok(mine.length >= 2, "domain " + d + " has dungeons of its own: " + mine.map(s => s.id).join(", "));
});

D.scenarios.forEach(sc => {
  group("\n" + sc.id + ": " + sc.name);
  const p = PROBES[sc.id];
  ok(!!p, "has a probe table");
  if (!p) return;
  ok(sc.evidence.length >= 3 && sc.evidence.length === p.evidence.length, sc.evidence.length + " pieces of evidence, one probe each");
  ok(sc.evidence.every(e => e.hint && e.match.length) && sc.fix.length && sc.wrong.length >= 3 && sc.ticket && sc.answer && sc.ns,
    "every piece has a hint and matchers; the fault has a fix, wrong turns, a ticket and an answer");
  ok(sc.difficulty >= 1 && sc.difficulty <= 3 && sc.d >= 1 && sc.d <= 5, "difficulty " + sc.difficulty + " in domain " + sc.d);
  // every regex compiles
  let bad = null;
  [].concat(...sc.evidence.map(e => e.match), sc.fix, ...sc.wrong.map(w => w.match)).forEach(re => { try { new RegExp(re); } catch (e) { bad = re; } });
  ok(!bad, "every matcher is a regex" + (bad ? ": " + bad : ""));

  // the evidence, in order, each probe surfacing one new piece
  const found = {};
  p.evidence.forEach((cmd, i) => {
    const r = S.run(sc, found, cmd);
    if (r.evidence) found[r.evidence] = 1;
    ok(r.evidence === sc.evidence[i].id && !r.fixed && !r.wrong,
      JSON.stringify(cmd) + " surfaces " + sc.evidence[i].id + (r.evidence === sc.evidence[i].id ? "" : ", got " + JSON.stringify({ e: r.evidence, fixed: r.fixed, wrong: r.wrong })));
    ok(r.out.length > 0 && !looksLikeError(r.out), "  and answers with output, not an error: " + r.out.split("\n")[0].slice(0, 70));
    const tell = sc.evidence[i].tell;
    if (tell) ok(r.out.indexOf(tell) >= 0, "  the tell is in it: " + tell);
    const again = S.run(sc, found, cmd);
    ok(!again.evidence, "  and running it again surfaces nothing new");
  });
  ok(Object.keys(found).length === sc.evidence.length, "all " + sc.evidence.length + " pieces found");

  const fx = S.run(sc, found, p.fix);
  ok(fx.fixed === true && !fx.evidence && !fx.wrong && fx.out.length > 0, "the fix wins: " + JSON.stringify(p.fix).slice(0, 90));
  ok(S.run(sc, {}, p.fix).fixed === true, "  and wins with no evidence found, which the game scores as luck");
  const wr = S.run(sc, found, p.wrong);
  ok(wr.wrong === true && !wr.fixed && !wr.evidence && wr.out.length > 0, "a plausible wrong fix is refused with output: " + JSON.stringify(p.wrong).slice(0, 90));
  const ot = S.run(sc, found, p.other);
  ok(ot.generic === true && ot.out.length > 0 && !looksLikeError(ot.out), "an unrelated valid command gets a generic answer: " + JSON.stringify(p.other) + " -> " + ot.out.split("\n")[0].slice(0, 60));
  ok(S.run(sc, found, "kubectl frobnicate").out.indexOf("unknown command") >= 0 && S.run(sc, found, "frobnicate").out.indexOf("command not found") >= 0,
    "an unknown verb and an unknown tool are errors of the right shape");
  ok(S.run(sc, found, "kubectl get pods -n nowhere-" + sc.id).out === "No resources found in nowhere-" + sc.id + " namespace.", "a wrong namespace is empty, not an error");

  // every resource renders three ways without throwing or leaking undefined
  let rendered = 0, broke = null;
  const kinds = [...new Set(sc.resources.map(r => r.kind))];
  kinds.forEach(k => {
    const nss = [...new Set(sc.resources.filter(r => r.kind === k).map(r => r.ns || "default"))];
    nss.forEach(ns => {
      [`kubectl get ${k} -n ${ns}`, `kubectl get ${k} -n ${ns} -o wide`, `kubectl get ${k} -n ${ns} -o yaml`, `kubectl describe ${k} -n ${ns}`, `kubectl get ${k} -n ${ns} --show-labels`].forEach(c => {
        try {
          const out = S.run(sc, {}, c).out;
          if (!out || /undefined|\[object Object\]/.test(out)) broke = c + " -> " + out.slice(0, 60);
          if (!glyphsOk(out)) broke = c + " -> a glyph the fonts do not carry";
          rendered++;
        } catch (e) { broke = c + " threw " + e.message; }
      });
    });
  });
  ok(!broke, rendered + " renderings of " + kinds.length + " kinds, none broken" + (broke ? ": " + broke : ""));
  sc.resources.filter(r => r.kind === "pods").forEach(r => {
    const out = S.run(sc, {}, `kubectl logs ${r.name} -n ${r.ns || "default"}`).out;
    ok(out.length > 0 && !/undefined/.test(out), "logs of " + r.name + " answer: " + out.split("\n")[0].slice(0, 60));
  });
  const text = JSON.stringify(sc);
  ok(glyphsOk(text), "every character in the scenario is one the fonts carry");
});

/* ── fixes a reviewer found the matchers rejecting ─────────── */
group("\nevery legitimate spelling of a fix wins");
[
  ["probe", "kubectl -n team-a patch deploy broken --type=json -p='[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/readinessProbe/httpGet/port\",\"value\":8080}]'"],
  ["probe", "kubectl -n team-a patch deploy broken -p '{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"nginx-unprivileged\",\"readinessProbe\":{\"httpGet\":{\"path\":\"/\",\"port\":8080}}}]}}}}'"],
  ["svc-selector", "kubectl -n team-a label pods -l app=web-frontend app=web --overwrite"],
  ["svc-selector", "kubectl label pods --all -n team-a app=web --overwrite"],
  ["svc-selector", "kubectl -n team-a label pod web-7d4f8c9b6-n3k7p web-7d4f8c9b6-r8m2q app=web --overwrite"],
  ["svc-selector", "kubectl -n team-a label pod web-7d4f8c9b6-n3k7p app=web"],
  ["resources", "kubectl -n team-a set resources deploy/broken --limits=cpu=1,memory=256Mi --requests=cpu=50m,memory=64Mi"],
  ["hpa-unknown", "kubectl -n team-a set resources deploy/web --limits=cpu=500m --requests=cpu=100m"],
  ["quota", "kubectl scale deploy broken --replicas=1 -n team-a"],
  ["xr-paused", "kubectl annotate appenvironment team-c-dev -n default crossplane.io/paused-"],
  ["servicemonitor-labels", "kubectl label servicemonitor web -n team-a release=prometheus"],
  ["alert-never-fires", "kubectl label prometheusrule team-a-alerts -n team-a release=prometheus"],
].forEach(([id, cmd]) => {
  const sc = D.scenarios.find(s => s.id === id);
  const r = S.run(sc, {}, cmd);
  ok(r.fixed === true, id + ": " + JSON.stringify(cmd).slice(0, 110) + (r.fixed ? "" : " -> " + JSON.stringify({ e: r.evidence, wrong: r.wrong, g: r.generic })));
});
ok(D.scenarios.every(sc => sc.fix.every(re => !/;/.test(re))), "no matcher waits for a ; the tokenizer ends the command at");

/* ── the world around the fights ───────────────────────────── */
group("\nthe bosses chain real fights");
const ids = new Set(D.scenarios.map(s => s.id));
ok(D.regions.length === 5, "five regions");
D.regions.forEach(r => {
  ok(r.boss.length === 2 && r.boss.every(b => ids.has(b)), "region " + r.d + " (" + r.name + ") chains two faults: " + r.boss.join(" + "));
  ok(r.boss.every(b => D.scenarios.find(s => s.id === b).d === r.d), "  both from its own domain");
});
ok(D.finale.pool.length >= 10 && D.finale.pool.every(b => ids.has(b)) && D.finale.pick === 3, "the final gate draws three from a pool of " + D.finale.pool.length);
group("the towns, the map and the ladder");
ok(D.towns.length === 29 && new Set(D.towns.map(t => t.sec)).size === 29, "twenty-nine towns, one per section");
const secs = new Set(D.towns.map(t => t.sec));
ok(["1.1", "2.6", "3.6", "4.6", "5.6", "1.5"].every(s => secs.has(s)), "with the section ids the manifest uses");
ok(D.towns.every(t => t.npcs.length >= 3 && t.npcs.length <= 5 && t.npcs.every(n => n.name && n.lines.length >= 2 && (!n.teaches || D.techniques[n.teaches]))),
  "every town has three to five people with lines, teaching techniques that exist");
ok(D.towns.every(t => ids.has(t.dungeon)), "every town's door leads to a real fault");
ok(D.scenarios.every(s => D.towns.some(t => t.dungeon === s.id)), "and every fault is behind some door");
ok(Object.keys(D.techniques).every(k => D.techniques[k].cmd && D.techniques[k].about && D.techniques[k].tool), "every technique has a command, a line and a tool");
// what pickTechnique() offers targets for and finishPick() fills in; anything
// else would reach the prompt with a literal {placeholder} in it
const FILLED = ["ns", "res", "pod", "kind", "sa", "app", "name", "image", "container"];
const oddTech = Object.keys(D.techniques).filter(k => (D.techniques[k].cmd.match(/\{([a-z]+)\}/g) || []).some(m => FILLED.indexOf(m.slice(1, -1)) < 0));
ok(!oddTech.length, "and only placeholders the battle fills in" + (oddTech.length ? ": " + oddTech.map(k => D.techniques[k].cmd).join(", ") : ""));
// pickTechnique() offers one target and finishPick() fills one in, so a second
// would reach the prompt as a literal {name} for the player to type over
const TARGETS = ["res", "pod", "kind", "sa", "app", "name"];
const twoTargets = Object.keys(D.techniques).filter(k => (D.techniques[k].cmd.match(/\{([a-z]+)\}/g) || []).filter(m => TARGETS.indexOf(m.slice(1, -1)) >= 0).length > 1);
ok(!twoTargets.length, "and at most one target placeholder each, which is all the target menu asks for" + (twoTargets.length ? ": " + twoTargets.map(k => D.techniques[k].cmd).join(", ") : ""));
ok(D.map.length > 40 && D.map.every(row => row.length === D.map[0].length), "the map is rectangular: " + D.map[0].length + "x" + D.map.length);
ok(D.map.every(row => [...row].every(ch => D.tiles[ch])), "every map char is a tile");
const at = (x, y) => D.map[y] && D.map[y][x];
ok(D.towns.every(t => D.tiles[at(t.x, t.y)] === "town" && D.tiles[at(t.door.x, t.door.y)] === "door"), "every town and door sits on its tile");
ok(D.regions.every(r => D.tiles[at(r.keep.x, r.keep.y)] === "keep") && D.tiles[at(D.finale.keep.x, D.finale.keep.y)] === "gate", "every keep and the gate too");
// game.js indexes what stands on a tile by that tile, so two landmarks on one
// would hide each other: the town you cannot enter, the door that opens the
// wrong dungeon.
const landmarks = [].concat(
  D.towns.map(t => [t.x, t.y, t.name]), D.towns.map(t => [t.door.x, t.door.y, t.name + "'s door"]),
  D.regions.map(r => [r.keep.x, r.keep.y, r.name + " keep"]), [[D.finale.keep.x, D.finale.keep.y, "the Exam gate"]]);
const onTile = {};
const shared = landmarks.filter(([x, y, what]) => {
  const k = x + "," + y, was = onTile[k];
  onTile[k] = what;
  return !!was;
}).map(([x, y, what]) => what + " at " + x + "," + y);
ok(!shared.length, "no two landmarks share a tile: " + landmarks.length + " of them" + (shared.length ? ", but " + shared.join(", ") : ""));

// Nothing may be walled off. The walk table mirrors game.js's; every kind the
// map uses has to be in one of the two lists, so a new kind cannot slip through
// this as walkable by default.
const WALK = { grass: 1, flower: 1, road: 1, sand: 1, bridge: 1, town: 1, door: 1, keep: 1, gate: 1 };
const BLOCKED = { water: 1, cliff: 1, tree: 1 };
const kinds = [...new Set(Object.values(D.tiles))].sort();
ok(kinds.every(k => WALK[k] || BLOCKED[k]), "every tile kind is one the walk table knows: " + kinds.join(", "));
const W = D.map[0].length, H = D.map.length;
const kindAt = (x, y) => (D.map[y] && D.map[y][x] ? D.tiles[D.map[y][x]] : "void");
const reached = new Set([D.start.x + "," + D.start.y]), queue = [[D.start.x, D.start.y]];
for (let q = 0; q < queue.length; q++) {
  const [x, y] = queue[q];
  [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].forEach(([nx, ny]) => {
    const k = nx + "," + ny;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || reached.has(k) || !WALK[kindAt(nx, ny)]) return;
    reached.add(k); queue.push([nx, ny]);
  });
}
const stranded = landmarks.filter(([x, y]) => !reached.has(x + "," + y)).map(([, , what]) => what);
ok(!stranded.length, "and every one can be walked to from the start" + (stranded.length ? ", except: " + stranded.join(", ") : ": " + reached.size + " tiles reachable"));
ok(D.tiles[at(D.start.x, D.start.y)] === "grass" || D.tiles[at(D.start.x, D.start.y)] === "road", "you start on walkable ground");
ok(D.levels.length >= 20 && D.levels[0] === 0 && D.levels.every((v, i) => i === 0 || v > D.levels[i - 1]), "the level ladder climbs: " + D.levels.length + " rungs");
ok(glyphsOk(JSON.stringify(D)), "every character in the content is one the fonts carry");

group("the shop and the pack");
const itemIds = Object.keys(D.items);
ok(itemIds.every(id => D.items[id].name && D.items[id].about), itemIds.length + " items, each with a name and a line");
ok(itemIds.every(id => !("price" in D.items[id]) || D.items[id].price > 0), "and a price worth gold where it has one");
// a cheat sheet prints its family's techniques, so a family with none would sell an empty page
const families = [...new Set(Object.keys(D.techniques).map(k => D.techniques[k].tool))].sort();
const emptySheets = itemIds.filter(id => /^sheet-/.test(id) && families.indexOf(id.slice(6)) < 0);
ok(!emptySheets.length, "every cheat sheet names a tool family that has techniques" + (emptySheets.length ? ": " + emptySheets.join(", ") : ": " + families.join(", ")));
ok(families.every(f => D.items["sheet-" + f]), "and every family has a sheet to buy: " + families.map(f => (D.items["sheet-" + f] ? "" : "no ") + f).join(", "));


console.log("\n" + checks + " checks, " + failures + " failures");
process.exitCode = failures ? 1 : 0;
