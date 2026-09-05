/* CNPE Quest: the command interpreter behind a battle.

   A battle's enemy is a fault, and the player fights it with real commands. This
   file turns a typed command into what a cluster carrying that fault would say.
   It is plain functions over the scenario's own resource table, no DOM, so
   tools/game-sim-test.mjs drives every scenario in bare node, the way merge.js
   and syntax.js are driven.

   Two layers. The generic handlers render any sensible kubectl, argocd, flux, tkn
   or crossplane command from the table, so a player who explores gets plausible
   answers everywhere rather than "unknown command". The scenario's own evidence,
   fix and wrong-fix matchers sit on top, written against the normalised form of
   a command so that "k get po -nteam-a", "kubectl get pods --namespace=team-a"
   and "kubectl -n team-a get pod | grep broken" are all one command. */
(function (root: Pick<Window, "CNPE_SIM">) {
  "use strict";

  /** the flags a normalised command carries, by canonical name; a bare flag is "true" */
  type Flags = Record<string, string>;
  /** argocd app get/list's fields, as the resource table declares them */
  type ArgoInfo = NonNullable<CnpeGameResource["argo"]>;
  /** the argo rollouts plugin's view of a Rollout */
  type RolloutInfo = NonNullable<CnpeGameResource["canary"]>;

  /* ── normalisation ──────────────────────────────────────── */
  var KINDS: Record<string, string> = {
    po: "pods", pod: "pods", pods: "pods",
    deploy: "deployments", deployment: "deployments", deployments: "deployments",
    svc: "services", service: "services", services: "services",
    ns: "namespaces", namespace: "namespaces", namespaces: "namespaces",
    rs: "replicasets", replicaset: "replicasets", replicasets: "replicasets",
    sa: "serviceaccounts", serviceaccount: "serviceaccounts", serviceaccounts: "serviceaccounts",
    netpol: "networkpolicies", networkpolicy: "networkpolicies", networkpolicies: "networkpolicies",
    pvc: "persistentvolumeclaims", persistentvolumeclaim: "persistentvolumeclaims", persistentvolumeclaims: "persistentvolumeclaims",
    pv: "persistentvolumes", persistentvolume: "persistentvolumes", persistentvolumes: "persistentvolumes",
    sc: "storageclasses", storageclass: "storageclasses", storageclasses: "storageclasses",
    hpa: "horizontalpodautoscalers", horizontalpodautoscaler: "horizontalpodautoscalers", horizontalpodautoscalers: "horizontalpodautoscalers",
    cm: "configmaps", configmap: "configmaps", configmaps: "configmaps",
    secret: "secrets", secrets: "secrets",
    ev: "events", event: "events", events: "events",
    quota: "resourcequotas", resourcequota: "resourcequotas", resourcequotas: "resourcequotas",
    limits: "limitranges", limitrange: "limitranges", limitranges: "limitranges",
    ep: "endpoints", endpoints: "endpoints",
    endpointslice: "endpointslices", endpointslices: "endpointslices",
    no: "nodes", node: "nodes", nodes: "nodes",
    role: "roles", roles: "roles", rolebinding: "rolebindings", rolebindings: "rolebindings",
    clusterrole: "clusterroles", clusterroles: "clusterroles",
    clusterrolebinding: "clusterrolebindings", clusterrolebindings: "clusterrolebindings",
    crd: "customresourcedefinitions", crds: "customresourcedefinitions", customresourcedefinition: "customresourcedefinitions", customresourcedefinitions: "customresourcedefinitions",
    app: "applications", apps: "applications", application: "applications", applications: "applications",
    appproj: "appprojects", appproject: "appprojects", appprojects: "appprojects",
    ks: "kustomizations", kustomization: "kustomizations", kustomizations: "kustomizations",
    gitrepo: "gitrepositories", gitrepository: "gitrepositories", gitrepositories: "gitrepositories",
    hr: "helmreleases", helmrelease: "helmreleases", helmreleases: "helmreleases",
    ro: "rollouts", rollout: "rollouts", rollouts: "rollouts",
    ar: "analysisruns", analysisrun: "analysisruns", analysisruns: "analysisruns",
    at: "analysistemplates", analysistemplate: "analysistemplates", analysistemplates: "analysistemplates",
    pr: "pipelineruns", pipelinerun: "pipelineruns", pipelineruns: "pipelineruns",
    tr: "taskruns", taskrun: "taskruns", taskruns: "taskruns",
    pipeline: "pipelines", pipelines: "pipelines", task: "tasks", tasks: "tasks",
    el: "eventlisteners", eventlistener: "eventlisteners", eventlisteners: "eventlisteners",
    tb: "triggerbindings", triggerbinding: "triggerbindings", triggerbindings: "triggerbindings",
    tt: "triggertemplates", triggertemplate: "triggertemplates", triggertemplates: "triggertemplates",
    appenvironment: "appenvironments", appenvironments: "appenvironments", appenv: "appenvironments",
    object: "objects", objects: "objects", "objects.kubernetes.m.crossplane.io": "objects", "object.kubernetes.m.crossplane.io": "objects",
    composite: "composite", composition: "compositions", compositions: "compositions",
    xrd: "compositeresourcedefinitions", compositeresourcedefinition: "compositeresourcedefinitions", compositeresourcedefinitions: "compositeresourcedefinitions",
    providerconfig: "providerconfigs", providerconfigs: "providerconfigs",
    vpol: "validatingpolicies", validatingpolicy: "validatingpolicies", validatingpolicies: "validatingpolicies",
    ivpol: "imagevalidatingpolicies", imagevalidatingpolicy: "imagevalidatingpolicies", imagevalidatingpolicies: "imagevalidatingpolicies",
    cpol: "clusterpolicies", clusterpolicy: "clusterpolicies", clusterpolicies: "clusterpolicies",
    polr: "policyreports", policyreport: "policyreports", policyreports: "policyreports",
    servicemonitor: "servicemonitors", servicemonitors: "servicemonitors", smon: "servicemonitors",
    podmonitor: "podmonitors", podmonitors: "podmonitors",
    prometheusrule: "prometheusrules", prometheusrules: "prometheusrules", promrule: "prometheusrules",
    prometheus: "prometheuses", prometheuses: "prometheuses",
    externalsecret: "externalsecrets", externalsecrets: "externalsecrets", es: "externalsecrets",
    secretstore: "secretstores", secretstores: "secretstores", ss: "secretstores",
    clustersecretstore: "clustersecretstores", clustersecretstores: "clustersecretstores", css: "clustersecretstores",
    opentelemetrycollector: "opentelemetrycollectors", opentelemetrycollectors: "opentelemetrycollectors", otelcol: "opentelemetrycollectors",
    workflow: "workflows", workflows: "workflows", wf: "workflows",
    all: "all"
  };
  // Kinds that live outside any namespace, so -n is neither needed nor shown.
  var CLUSTER: Record<string, number> = { namespaces: 1, nodes: 1, storageclasses: 1, persistentvolumes: 1, clusterroles: 1,
    clusterrolebindings: 1, customresourcedefinitions: 1, validatingpolicies: 1, imagevalidatingpolicies: 1,
    clusterpolicies: 1, clustersecretstores: 1, compositions: 1, compositeresourcedefinitions: 1, providerconfigs: 1 };

  function kindOf(k: string): string {
    var low = String(k || "").toLowerCase();
    var dot = low.indexOf(".");
    // deploy.apps or objects.kubernetes.m.crossplane.io: the alias table has the
    // long crossplane form, otherwise the group is dropped.
    if (KINDS[low]) return KINDS[low];
    if (dot > 0 && KINDS[low.slice(0, dot)]) return KINDS[low.slice(0, dot)];
    return low;
  }
  /** kind/name and kind,kind lists, into one canonical token */
  function kindTok(tok: string): string {
    return tok.split(",").map(function (part) {
      var slash = part.indexOf("/");
      if (slash > 0) return kindOf(part.slice(0, slash)) + " " + part.slice(slash + 1);
      return kindOf(part);
    }).join(",");
  }

  /** shell-ish split: quotes group, and the first pipe or chain ends the command */
  function tokens(s: string): string[] {
    var out: string[] = [], cur = "", q = "", i: number, c: string, had = false;
    for (i = 0; i < s.length; i++) {
      c = s[i];
      if (q) {
        if (c === q) q = ""; else cur += c;
        continue;
      }
      // A quote opens a group at the start of a token or right after an =, as
      // in -p '{...}' and --patch="{...}". Anywhere else it is a character: the
      // canonical form of a patch carries its JSON quotes bare, and has to
      // normalise to itself.
      if ((c === "'" || c === '"') && (cur === "" || cur[cur.length - 1] === "=")) { q = c; had = true; continue; }
      if (c === "\\" && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === "|" || c === ";" || (c === "&" && s[i + 1] === "&")) break;
      if (/\s/.test(c)) { if (cur || had) out.push(cur); cur = ""; had = false; continue; }
      cur += c;
    }
    if (cur || had) out.push(cur);
    // redirects are not part of the command either
    return out.filter(function (t) { return !/^\d?>/.test(t) && t !== "2>&1"; });
  }

  // Flags that take a value, by their canonical name.
  var VALUED: Record<string, string> = {
    "-n": "-n", "--namespace": "-n", "-o": "-o", "--output": "-o", "-l": "-l", "--selector": "-l",
    "--sort-by": "--sort-by", "--as": "--as", "--as-group": "--as-group", "--type": "--type",
    "--patch": "-p", "--tail": "--tail", "--since": "--since", "-c": "-c", "--container": "-c",
    "-f": "-f", "--filename": "-f", "--dry-run": "--dry-run", "--replicas": "--replicas",
    "--image": "--image", "--requests": "--requests", "--limits": "--limits", "--for": "--for",
    "--timeout": "--timeout", "--restart": "--restart", "--field-selector": "--field-selector",
    "--to-revision": "--to-revision", "--revision": "--revision", "--context": "", "--key": "--key", "--overrides": "--overrides",
    "--grace-period": "--grace-period", "--cascade": "--cascade", "--env": "--env",
    "--port": "--port", "--target-port": "--target-port", "--min": "--min", "--max": "--max",
    "--cpu-percent": "--cpu-percent", "--overwrite": "", "--source": "--source",
    "--kind": "--kind", "--path": "--path", "--interval": "--interval", "--target-namespace": "--target-namespace",
    "--from-literal": "--from-literal", "--from-file": "--from-file", "--serviceaccount": "--serviceaccount",
    "--clusterrole": "--clusterrole", "--role": "--role", "--verb": "--verb", "--resource": "--resource",
    "--user": "--user", "--group": "--group", "--schedule": "--schedule", "--limit": "--limit",
    "--label": "--label", "--message": "--message"
  };
  // The flags whose canonical order the matchers rely on; anything else is
  // appended sorted, so two spellings of one command still meet.
  var ORDER: string[] = ["-n", "-l", "-A", "-o", "--previous", "--sort-by", "--show-labels", "--as", "--as-group",
    "--type", "-p", "--tail", "--overwrite", "--image", "--requests", "--limits", "--replicas", "-f",
    "--dry-run", "-c", "--revision", "--for", "--timeout"];
  var BARE: Record<string, string> = { "-A": "-A", "--all-namespaces": "-A", "--previous": "--previous", "--show-labels": "--show-labels",
    "--overwrite": "--overwrite", "-w": "-w", "--watch": "-w", "-it": "-it", "-i": "-i", "-t": "-t",
    "--rm": "--rm", "--recursive": "--recursive", "-h": "--help", "--help": "--help", "--force": "--force",
    "--ignore-not-found": "--ignore-not-found", "--wait": "--wait", "--list": "--list", "--all": "--all",
    "--with-source": "--with-source", "--hard-refresh": "--hard-refresh", "--refresh": "--refresh",
    "--grpc-web": "--grpc-web", "--insecure": "--insecure", "--prune": "--prune", "--record": "--record",
    "--v": "--v", "--last": "--last", "--yes": "--yes", "--server-side": "--server-side", "--stdin": "--stdin",
    "--no-headers": "--no-headers", "--sudo": "--sudo", "--all-containers": "--all-containers" };
  var SHORT_BARE: Record<string, string> = { A: "-A", w: "-w", i: "-i", t: "-t", h: "--help" };

  /**
   * A command as the matchers see it: tool, then positionals, then flags in a
   * fixed order, each in one spelling. Empty for a blank line.
   */
  function normalize(cmd: string): string {
    var t = tokens(String(cmd || "").replace(/^\s*\$\s*/, ""));
    if (!t.length) return "";
    if (t[0] === "sudo" || t[0] === "watch") t.shift();
    if (!t.length) return "";
    if (t[0] === "k") t[0] = "kubectl";
    var tool = t[0].toLowerCase();
    var pos: string[] = [], flags: Record<string, string | true> = {}, verb = "", i: number, tok: string, m: RegExpExecArray | null, name: string, val: string | undefined, rest: string[] | null = null;
    for (i = 1; i < t.length; i++) {
      tok = t[i];
      if (rest !== null) { rest.push(tok); continue; }
      if (tok === "--") { rest = []; continue; }
      if (tok[0] === "-" && tok.length > 1 && !/^-\d/.test(tok)) {
        m = /^(--?[a-zA-Z][\w-]*)(?:=(.*))?$/.exec(tok);
        if (!m) { pos.push(tok); continue; }
        // long flags are case-insensitive here; -A and -a are not the same flag
        name = m[1].length > 2 ? m[1].toLowerCase() : m[1]; val = m[2];
        // -p is --previous for logs and --patch for patch; decide by the verb so far
        if (name === "-p") name = (verb === "logs" || (pos[0] === "logs")) ? "--previous" : "--patch";
        // and -f is --follow there, not --filename
        if (name === "-f" && val === undefined && (verb === "logs" || pos[0] === "logs")) { flags["-f"] = true; continue; }
        if (name in BARE && val === undefined) { flags[BARE[name]] = true; continue; }
        if (name in VALUED) {
          if (val === undefined) val = i + 1 < t.length ? t[++i] : "";
          if (VALUED[name]) flags[VALUED[name]] = val;
          continue;
        }
        // -nteam-a, -oyaml, -ltier=web: a short flag glued to its value
        m = /^-([nolcf])(.+)$/.exec(tok);
        if (m) { flags[VALUED["-" + m[1]]] = m[2]; continue; }
        // -itp and friends
        if (/^-[A-Za-z]{2,}$/.test(tok) && tok.slice(1).split("").every(function (ch) { return ch in SHORT_BARE; })) {
          tok.slice(1).split("").forEach(function (ch) { flags[SHORT_BARE[ch]] = true; });
          continue;
        }
        flags[val === undefined ? name : name + "=" + val] = true;
        continue;
      }
      pos.push(tok);
      if (!verb) verb = tok.toLowerCase();
    }
    // kubectl argo rollouts ... is its own tool
    if (tool === "kubectl" && pos[0] === "argo" && pos[1] === "rollouts") { tool = "kubectl argo rollouts"; pos = pos.slice(2); }
    if (tool === "crossplane" && pos[0] === "beta") { pos.shift(); tool = "crossplane beta"; }
    verb = (pos[0] || "").toLowerCase();
    if (pos.length) pos[0] = verb;
    // Where the kind sits, per verb, so aliases and kind/name collapse to one form.
    var kindAt = -1;
    if (tool === "kubectl") {
      if (["get", "describe", "delete", "edit", "patch", "label", "annotate", "scale", "explain", "expose", "top", "wait", "create"].indexOf(verb) >= 0) kindAt = 1;
      else if (verb === "set" || verb === "rollout") kindAt = 2;
      else if (verb === "logs" || verb === "exec" || verb === "port-forward") kindAt = 1;
      else if (verb === "auth" && pos[1] === "can-i") kindAt = 3;
    } else if (tool === "flux") {
      if (["get", "resume", "suspend", "reconcile", "tree", "delete", "export", "create", "logs"].indexOf(verb) >= 0) kindAt = 1;
      if (verb === "get" && pos[1] && /^sources?$/.test(pos[1].toLowerCase())) { pos[1] = "sources"; kindAt = -1; }
    } else if (tool === "tkn") {
      if (pos[0]) pos[0] = kindOf(pos[0]);
      if (pos[1]) pos[1] = pos[1].toLowerCase();
    } else if (tool === "crossplane beta" || tool === "kubectl argo rollouts") {
      if (["trace", "get", "retry", "promote", "abort", "undo", "restart", "status"].indexOf(verb) >= 0) kindAt = 1;
    } else if (tool === "argocd") {
      if (pos[1]) pos[1] = pos[1].toLowerCase();
    }
    if (kindAt > 0 && pos[kindAt] !== undefined && pos[kindAt] !== "-h") {
      var kt = kindTok(pos[kindAt]);
      // explain keeps its field path: deploy.spec.template -> deployments.spec.template
      if (verb === "explain") {
        var dot = pos[kindAt].indexOf(".");
        kt = dot > 0 && !KINDS[pos[kindAt].toLowerCase()] ? kindOf(pos[kindAt].slice(0, dot)) + pos[kindAt].slice(dot) : kindOf(pos[kindAt]);
      }
      var parts = kt.split(" ");
      pos = pos.slice(0, kindAt).concat(parts, pos.slice(kindAt + 1));
    }
    // logs pod/x, logs pods x and logs x are one command: the pod kind is the
    // default there, so it is not spelled
    if (tool === "kubectl" && (verb === "logs" || verb === "exec" || verb === "port-forward") && pos[1] === "pods" && pos[2]) pos.splice(1, 1);
    if (verb === "auth" && pos[1] === "can-i" && pos[2]) pos[2] = pos[2].toLowerCase();
    if (verb === "set" && pos[1]) pos[1] = pos[1].toLowerCase();
    if (verb === "rollout" && pos[1]) pos[1] = pos[1].toLowerCase();
    // the patch body reads as one token with no whitespace in it
    // The patch body loses its whitespace and its case, so a matcher can be
    // written once: JSON keys are camelCase in as many spellings as people type.
    if (typeof flags["-p"] === "string") flags["-p"] = flags["-p"].replace(/\s+/g, "").toLowerCase();
    if (typeof flags["-o"] === "string") flags["-o"] = flags["-o"].toLowerCase();
    if (typeof flags["--type"] === "string") flags["--type"] = flags["--type"].toLowerCase();
    var out = [tool].concat(pos);
    ORDER.forEach(function (f) {
      if (!(f in flags)) return;
      // a patch body reads as -p=..., the way every long flag does; the other
      // short flags keep their space
      out.push(flags[f] === true ? f : (f.length > 2 || f === "-p" ? f + "=" + flags[f] : f + " " + flags[f]));
      delete flags[f];
    });
    Object.keys(flags).sort().forEach(function (f) {
      out.push(flags[f] === true ? f : f + "=" + flags[f]);
    });
    // what follows -- is the container's command, and kubectl wants it last
    if (rest) out = out.concat(["--"], rest);
    return out.join(" ");
  }

  /** the tool family, for the prompt and the cheat sheets */
  function toolOf(cmd: string): string {
    var n = normalize(cmd);
    if (/^kubectl argo rollouts\b/.test(n) || /^argocd\b/.test(n)) return "argo";
    if (/^kubectl get (analysisruns|analysistemplates|rollouts|applications|workflows)\b/.test(n)) return "argo";
    if (/^flux\b/.test(n) || /^kubectl \S+ (kustomizations|gitrepositories|helmreleases)\b/.test(n)) return "flux";
    if (/^tkn\b/.test(n) || /^kubectl \S+ (pipelineruns|pipelines|tasks|taskruns|eventlisteners|triggerbindings|triggertemplates)\b/.test(n)) return "tekton";
    if (/^crossplane/.test(n) || /^kubectl \S+ (appenvironments|objects|compositions|compositeresourcedefinitions|providerconfigs)\b/.test(n)) return "crossplane";
    if (/^kubectl \S+ (servicemonitors|podmonitors|prometheusrules|prometheuses|opentelemetrycollectors|validatingpolicies|imagevalidatingpolicies|clusterpolicies|policyreports|externalsecrets|secretstores|clustersecretstores)\b/.test(n)) return "platform";
    if (/^kubectl\b/.test(n)) return "kubectl";
    return n.split(" ")[0] || "";
  }

  /* ── rendering ──────────────────────────────────────────── */
  var COLS: Record<string, string[]> = {
    pods: ["READY", "STATUS", "RESTARTS", "AGE"],
    deployments: ["READY", "UP-TO-DATE", "AVAILABLE", "AGE"],
    replicasets: ["DESIRED", "CURRENT", "READY", "AGE"],
    services: ["TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"],
    endpointslices: ["ADDRESSTYPE", "PORTS", "ENDPOINTS", "AGE"],
    endpoints: ["ENDPOINTS", "AGE"],
    persistentvolumeclaims: ["STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "AGE"],
    persistentvolumes: ["CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "AGE"],
    storageclasses: ["PROVISIONER", "RECLAIMPOLICY", "VOLUMEBINDINGMODE", "ALLOWVOLUMEEXPANSION", "AGE"],
    horizontalpodautoscalers: ["REFERENCE", "TARGETS", "MINPODS", "MAXPODS", "REPLICAS", "AGE"],
    configmaps: ["DATA", "AGE"], secrets: ["TYPE", "DATA", "AGE"],
    resourcequotas: ["AGE", "REQUEST", "LIMIT"],
    networkpolicies: ["POD-SELECTOR", "AGE"],
    serviceaccounts: ["SECRETS", "AGE"], roles: ["CREATED AT"], rolebindings: ["ROLE", "AGE"],
    clusterroles: ["CREATED AT"], clusterrolebindings: ["ROLE", "AGE"],
    namespaces: ["STATUS", "AGE"], nodes: ["STATUS", "ROLES", "AGE", "VERSION"],
    applications: ["SYNC STATUS", "HEALTH STATUS"],
    kustomizations: ["AGE", "READY", "STATUS"], gitrepositories: ["URL", "AGE", "READY", "STATUS"],
    rollouts: ["DESIRED", "CURRENT", "UP-TO-DATE", "AVAILABLE"],
    analysisruns: ["STATUS", "AGE"], analysistemplates: ["AGE"],
    pipelineruns: ["SUCCEEDED", "REASON", "STARTTIME", "COMPLETIONTIME"], pipelines: ["AGE"], tasks: ["AGE"],
    eventlisteners: ["ADDRESS", "AVAILABLE", "REASON", "READY", "REASON"],
    triggerbindings: ["AGE"], triggertemplates: ["AGE"],
    appenvironments: ["SYNCED", "READY", "COMPOSITION", "AGE"],
    objects: ["KIND", "PROVIDERCONFIG", "SYNCED", "READY", "AGE"],
    validatingpolicies: ["ADMISSION", "BACKGROUND", "READY", "AGE", "MESSAGE"],
    imagevalidatingpolicies: ["ADMISSION", "BACKGROUND", "READY", "AGE", "MESSAGE"],
    servicemonitors: ["AGE"], podmonitors: ["AGE"], prometheusrules: ["AGE"],
    externalsecrets: ["STORE", "REFRESH INTERVAL", "STATUS", "READY"],
    secretstores: ["AGE", "STATUS", "CAPABILITIES", "READY"], clustersecretstores: ["AGE", "STATUS", "CAPABILITIES", "READY"],
    opentelemetrycollectors: ["MODE", "VERSION", "READY", "AGE", "IMAGE", "MANAGEMENT"],
    customresourcedefinitions: ["CREATED AT"], limitranges: ["CREATED AT"], prometheuses: ["VERSION", "AGE"],
    compositions: ["XR-KIND", "XR-APIVERSION", "AGE"], providerconfigs: ["AGE"], taskruns: ["SUCCEEDED", "REASON", "STARTTIME", "COMPLETIONTIME"],
    policyreports: ["KIND", "NAME", "PASS", "FAIL", "WARN", "ERROR", "SKIP", "AGE"], workflows: ["STATUS", "AGE"],
    ocirepositories: ["URL", "AGE", "READY", "STATUS"], helmrepositories: ["URL", "AGE", "READY", "STATUS"], helmreleases: ["AGE", "READY", "STATUS"]
  };
  var EVENT_COLS: string[] = ["LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"];

  function table(head: string[], rows: string[][]): string {
    var w = head.map(function (h) { return h.length; });
    rows.forEach(function (r) { r.forEach(function (c, i) { if (String(c).length > (w[i] || 0)) w[i] = String(c).length; }); });
    function line(r: string[]): string {
      return r.map(function (c, i) {
        c = String(c);
        return i === r.length - 1 ? c : c + new Array(w[i] - c.length + 4).join(" ");
      }).join("");
    }
    return [line(head)].concat(rows.map(line)).join("\n");
  }
  /** singular, for kubectl's messages */
  function singular(kind: string): string {
    if (/ies$/.test(kind)) return kind.replace(/ies$/, "y");
    if (/(ss|us)es$/.test(kind)) return kind.replace(/es$/, "");
    return kind.replace(/s$/, "");
  }
  function fullName(kind: string, r: CnpeGameResource): string { return singular(kind) + "/" + r.name; }

  /**
   * The resources a command names, or null when the kind is unknown here.
   */
  function find(sc: CnpeGameScenario, kind: string, name?: string, ns?: string, all?: boolean, sel?: string): CnpeGameResource[] | null {
    var res = sc.resources.filter(function (r) { return r.kind === kind; });
    if (!(kind in COLS) && !res.length) return null;
    if (!CLUSTER[kind] && !all) res = res.filter(function (r) { return (r.ns || "default") === ns; });
    if (name) res = res.filter(function (r) { return r.name === name; });
    if (sel) {
      var wants = sel.split(",");
      res = res.filter(function (r) {
        var have = (r.labels || "").split(",");
        return wants.every(function (w) {
          var eq = w.indexOf("="), k = eq > 0 ? w.slice(0, eq) : w, v = eq > 0 ? w.slice(eq + 1) : null;
          return have.some(function (h) {
            var e = h.indexOf("=");
            return e > 0 && h.slice(0, e) === k && (v === null || h.slice(e + 1) === v);
          });
        });
      });
    }
    return res;
  }
  function notFound(kind: string, name: string): string {
    return 'Error from server (NotFound): ' + singular(kind) + ' "' + name + '" not found';
  }
  function none(kind: string, ns: string): string {
    return CLUSTER[kind] ? "No resources found" : "No resources found in " + ns + " namespace.";
  }

  /** two-space yaml of a resource, from what the table knows */
  function yamlOf(kind: string, r: CnpeGameResource): string {
    var lines = ["apiVersion: " + (r.api || "v1"), "kind: " + (r.kindName || kindName(kind)), "metadata:", "  name: " + r.name];
    if (!CLUSTER[kind]) lines.push("  namespace: " + (r.ns || "default"));
    if (r.labels) {
      lines.push("  labels:");
      r.labels.split(",").forEach(function (l) { var e = l.indexOf("="); lines.push("    " + l.slice(0, e) + ": " + l.slice(e + 1)); });
    }
    if (r.annotations) {
      lines.push("  annotations:");
      r.annotations.split(",").forEach(function (l) { var e = l.indexOf("="); lines.push("    " + l.slice(0, e) + ": " + l.slice(e + 1)); });
    }
    if (r.yaml) lines.push(r.yaml);
    return lines.join("\n");
  }
  function kindName(kind: string): string {
    var s = singular(kind);
    var map: Record<string, string> = { pod: "Pod", deployment: "Deployment", replicaset: "ReplicaSet", service: "Service", namespace: "Namespace",
      configmap: "ConfigMap", secret: "Secret", persistentvolumeclaim: "PersistentVolumeClaim", storageclass: "StorageClass",
      horizontalpodautoscaler: "HorizontalPodAutoscaler", resourcequota: "ResourceQuota", networkpolicy: "NetworkPolicy",
      serviceaccount: "ServiceAccount", rolebinding: "RoleBinding", clusterrolebinding: "ClusterRoleBinding", role: "Role",
      clusterrole: "ClusterRole", node: "Node", endpointslice: "EndpointSlice", application: "Application",
      kustomization: "Kustomization", gitrepository: "GitRepository", rollout: "Rollout", analysisrun: "AnalysisRun",
      analysistemplate: "AnalysisTemplate", pipelinerun: "PipelineRun", pipeline: "Pipeline", task: "Task",
      eventlistener: "EventListener", triggerbinding: "TriggerBinding", triggertemplate: "TriggerTemplate",
      appenvironment: "AppEnvironment", object: "Object", validatingpolicy: "ValidatingPolicy",
      imagevalidatingpolicy: "ImageValidatingPolicy", servicemonitor: "ServiceMonitor", prometheusrule: "PrometheusRule",
      externalsecret: "ExternalSecret", secretstore: "SecretStore", clustersecretstore: "ClusterSecretStore",
      opentelemetrycollector: "OpenTelemetryCollector" };
    return map[s] || (s.charAt(0).toUpperCase() + s.slice(1));
  }

  /** the events on one object, as describe prints them */
  function eventsOn(sc: CnpeGameScenario, kind: string, name: string): CnpeGameEvent[] {
    var key = (singular(kind) + "/" + name).toLowerCase();
    return (sc.events || []).filter(function (e) { return e.obj.toLowerCase() === key; });
  }
  function describe(sc: CnpeGameScenario, kind: string, r: CnpeGameResource): string {
    var lines = ["Name:         " + r.name];
    if (!CLUSTER[kind]) lines.push("Namespace:    " + (r.ns || "default"));
    lines.push("Labels:       " + (r.labels ? r.labels.split(",").join("\n              ") : "<none>"));
    lines.push("Annotations:  " + (r.annotations ? r.annotations.split(",").join("\n              ") : "<none>"));
    if (r.desc) lines.push(r.desc);
    var evs = eventsOn(sc, kind, r.name);
    if (!evs.length) lines.push("Events:       <none>");
    else {
      lines.push("Events:");
      lines.push("  " + table(["Type", "Reason", "Age", "From", "Message"],
        evs.map(function (e) { return [e.type, e.reason, e.age, e.from, e.msg]; })).split("\n").join("\n  "));
    }
    return lines.join("\n");
  }

  /** a jsonpath-ish lookup over what the resource declares */
  function jsonpath(r: CnpeGameResource, path: string): string {
    var p = path.replace(/^jsonpath=/, "").replace(/^\{|\}$/g, "").trim();
    if (r.fields && p in r.fields) return r.fields[p];
    if (p === ".metadata.name") return r.name;
    if (p === ".metadata.namespace") return r.ns || "default";
    var lab = /^\.metadata\.labels\.(.+)$/.exec(p) || /^\.metadata\.labels\['?"?([^'"\]]+)/.exec(p);
    if (lab && r.labels) {
      var hit = r.labels.split(",").filter(function (l) { return l.indexOf(lab![1] + "=") === 0; })[0];
      return hit ? hit.slice(lab[1].length + 1) : "";
    }
    var ann = /^\.metadata\.annotations\.(.+)$/.exec(p) || /^\.metadata\.annotations\['?"?([^'"\]]+)/.exec(p);
    if (ann && r.annotations) {
      var a = r.annotations.split(",").filter(function (l) { return l.indexOf(ann![1] + "=") === 0; })[0];
      return a ? a.slice(ann[1].length + 1) : "";
    }
    return "";
  }

  /** the reply to a get, in whatever output the flags ask for */
  function renderGet(sc: CnpeGameScenario, kind: string, res: CnpeGameResource[], f: Flags, many: boolean): string {
    var o = f["-o"] || "";
    if (/^yaml$/.test(o) || /^json$/.test(o)) {
      var docs = res.map(function (r) { return yamlOf(kind, r); });
      if (o === "json") return "(json output is long; try -o yaml, or -o jsonpath=...)\n" + docs.join("\n---\n");
      return res.length > 1 ? "apiVersion: v1\nitems:\n- " + docs.join("\n- ").split("\n").join("\n  ").replace(/\n  - /g, "\n- ") + "\nkind: List" : docs.join("\n---\n");
    }
    if (/^jsonpath/.test(o)) {
      return res.map(function (r) { return jsonpath(r, o); }).join(" ").replace(/\\n/g, "\n");
    }
    if (o && o !== "wide" && o !== "name") return 'error: unable to match a printer suitable for the output format "' + o + '", allowed formats are: wide,yaml,json,jsonpath';
    if (o === "name") return res.map(function (r) { return fullName(kind, r); }).join("\n");
    var head = ["NAME"].concat(COLS[kind] || []);
    if (f["-A"] && !CLUSTER[kind]) head.unshift("NAMESPACE");
    if (o === "wide" && res.some(function (r) { return r.wide; })) head = head.concat(res[0].wideCols || ["NODE"]);
    if (f["--show-labels"]) head.push("LABELS");
    var rows = res.map(function (r) {
      var row = [many ? fullName(kind, r) : r.name].concat(r.cols || []);
      while (row.length < 1 + (COLS[kind] || []).length) row.push("");
      if (f["-A"] && !CLUSTER[kind]) row.unshift(r.ns || "default");
      if (o === "wide" && head.length > row.length) row = row.concat(r.wide || []);
      if (f["--show-labels"]) row.push(r.labels || "<none>");
      return row;
    });
    return table(head, rows);
  }

  /* ── the generic handlers ───────────────────────────────── */
  var HELP: Record<string, string> = {
    kubectl: "kubectl controls the Kubernetes cluster manager.\n\nBasic Commands:\n  get, describe, logs, events, explain, auth can-i\n\nRepair Commands:\n  patch, set image|resources|env, scale, label, annotate, delete, rollout restart, create, apply -f\n\nUsage:\n  kubectl [flags] [options]",
    flux: "Command line utility for assembling Kubernetes CD pipelines.\n\nAvailable Commands:\n  get sources git | get kustomizations | get helmreleases\n  reconcile | resume | suspend  kustomization <name>\n  tree kustomization <name>",
    argocd: "argocd controls a Argo CD server\n\nAvailable Commands:\n  app get|list|sync|diff|set <name> [--revision <ref>]",
    tkn: "CLI for tekton pipelines\n\nAvailable Commands:\n  pipelinerun list|describe|logs   pipeline start   task list   eventlistener list|logs",
    "crossplane beta": "Run alpha and beta commands\n\nAvailable Commands:\n  trace <kind> <name> [-n <ns>]",
    "kubectl argo rollouts": "Manage argo rollouts\n\nAvailable Commands:\n  get rollout <name>   retry rollout <name>   promote|abort|undo <name>"
  };
  var EXPLAIN: Record<string, string> = {
    pods: "KIND:       Pod\nVERSION:    v1\n\nDESCRIPTION:\n    Pod is a collection of containers that can run on a host. Status carries\n    phase, conditions and the containerStatuses whose state and lastState say\n    why a container is waiting or restarting.",
    deployments: "KIND:       Deployment\nVERSION:    apps/v1\n\nDESCRIPTION:\n    Deployment enables declarative updates for Pods and ReplicaSets. Status\n    conditions include Available, Progressing and ReplicaFailure, the last\n    naming an admission or quota error the ReplicaSet hit.",
    replicasets: "KIND:       ReplicaSet\nVERSION:    apps/v1\n\nDESCRIPTION:\n    ReplicaSet ensures that a specified number of pod replicas are running at\n    any given time. A pod it could not create leaves a FailedCreate event on\n    the ReplicaSet, not on any pod.",
    services: "KIND:       Service\nVERSION:    v1\n\nDESCRIPTION:\n    Service is a named abstraction of software service consisting of a local\n    port that the proxy listens on, and the selector that determines which\n    pods will answer requests sent through the proxy.",
    persistentvolumeclaims: "KIND:       PersistentVolumeClaim\nVERSION:    v1\n\nDESCRIPTION:\n    PersistentVolumeClaim is a user's request for and claim to a persistent\n    volume. A claim on a WaitForFirstConsumer class stays Pending until a pod\n    that uses it is scheduled.",
    horizontalpodautoscalers: "KIND:       HorizontalPodAutoscaler\nVERSION:    autoscaling/v2\n\nDESCRIPTION:\n    HorizontalPodAutoscaler is the configuration for a horizontal pod\n    autoscaler, which automatically manages the replica count of any resource\n    implementing the scale subresource based on the metrics specified.",
    networkpolicies: "KIND:       NetworkPolicy\nVERSION:    networking.k8s.io/v1\n\nDESCRIPTION:\n    NetworkPolicy describes what network traffic is allowed for a set of Pods.\n    Policies are additive allow-lists: a pod selected by any policy with a\n    policyType is denied everything that policy type does not allow.",
    resourcequotas: "KIND:       ResourceQuota\nVERSION:    v1\n\nDESCRIPTION:\n    ResourceQuota sets aggregate quota restrictions enforced per namespace.\n    The API server rejects a create that would exceed spec.hard.",
    namespaces: "KIND:       Namespace\nVERSION:    v1\n\nDESCRIPTION:\n    Namespace provides a scope for Names. Pod Security admission reads the\n    pod-security.kubernetes.io/enforce label here."
  };

  /**
   * The scenario's answer to one command.
   * @param found evidence ids surfaced so far
   */
  function run(sc: CnpeGameScenario, found: Record<string, number>, cmd: string): CnpeSimResult {
    var n = normalize(cmd);
    if (!n) return { out: "", generic: true };
    var hit: CnpeGameEvidence | null = null, i: number;
    // The scenario's own matchers come first: evidence, then the fix, then the
    // repairs that look right and are not.
    for (i = 0; i < sc.evidence.length && !hit; i++) {
      if (sc.evidence[i].match.some(function (re) { return new RegExp(re).test(n); })) hit = sc.evidence[i];
    }
    if (hit) {
      var out = hit.out != null ? hit.out : generic(sc, n);
      var r = { out: out } as CnpeSimResult;
      if (!found[hit.id]) r.evidence = hit.id;
      return r;
    }
    if (sc.fix.some(function (re) { return new RegExp(re).test(n); })) return { out: sc.fixOut, fixed: true };
    for (i = 0; i < (sc.wrong || []).length; i++) {
      if (sc.wrong[i].match.some(function (re) { return new RegExp(re).test(n); })) return { out: sc.wrong[i].out, wrong: true };
    }
    return { out: generic(sc, n), generic: true };
  }

  /** @param n normalised command */
  function parts(n: string): { tool: string, pos: string[], f: Flags } {
    var t = n.split(" "), tool = t[0], i = 1, pos: string[] = [], f: Flags = {};
    if (tool === "kubectl" && t[1] === "argo" && t[2] === "rollouts") { tool = "kubectl argo rollouts"; i = 3; }
    if (tool === "crossplane" && t[1] === "beta") { tool = "crossplane beta"; i = 2; }
    for (; i < t.length; i++) {
      var tok = t[i];
      if (tok === "--") { f["--"] = t.slice(i + 1).join(" "); break; }
      if (tok[0] === "-" && tok.length > 1 && !/^-\d/.test(tok)) {
        var eq = tok.indexOf("=");
        if (eq > 0) f[tok.slice(0, eq)] = tok.slice(eq + 1);
        else if ((tok === "-n" || tok === "-l" || tok === "-o" || tok === "-c" || tok === "-f") && i + 1 < t.length) f[tok] = t[++i];
        else f[tok] = "true";
      } else pos.push(tok);
    }
    return { tool: tool, pos: pos, f: f };
  }

  function generic(sc: CnpeGameScenario, n: string): string {
    var p = parts(n), tool = p.tool, pos = p.pos, f = p.f, verb = pos[0] || "";
    var ns = f["-n"] || "default";
    if (f["--help"]) return HELP[tool] || ("bash: " + tool + ": command not found");
    if (tool === "kubectl") return kubectl(sc, pos, f, ns, verb);
    if (tool === "flux") return flux(sc, pos, f, ns, verb);
    if (tool === "argocd") return argocd(sc, pos, f, verb);
    if (tool === "tkn") return tkn(sc, pos, f, ns);
    if (tool === "kubectl argo rollouts") return rollouts(sc, pos, f, ns, verb);
    if (tool === "crossplane beta") return trace(sc, pos, f, ns, verb);
    if (tool === "cosign") return cosign(sc, pos, f, verb);
    if (tool === "helm") return "Error: no releases found here; this cluster's apps are managed by Argo CD and Flux";
    if (tool === "curl" || tool === "wget") return "curl: (7) Failed to connect: the terminal runs outside the cluster; kubectl exec into a pod to probe from inside";
    if (tool === "ls" || tool === "cat" || tool === "cd" || tool === "vim" || tool === "vi" || tool === "nano") return "bash: " + tool + ": this terminal has no filesystem; every repair is a kubectl, flux, argocd or tkn command";
    if (tool === "make") return "make: *** No rule to make target here; the lab's make targets run on your machine, not in the quest";
    return "bash: " + tool + ": command not found";
  }

  function kubectl(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string, verb: string): string {
    var kind: string, name: string | undefined, res: CnpeGameResource[] | null;
    switch (verb) {
      case "":
        return HELP.kubectl;
      case "get":
        if (!pos[1]) return "error: You must specify the type of resource to get. Use \"kubectl api-resources\" for a complete list of supported resources.";
        if (pos[1] === "events") return getEvents(sc, f, ns);
        if (pos[1] === "all") {
          var all = ["pods", "services", "deployments", "replicasets", "horizontalpodautoscalers", "rollouts"], blocks: string[] = [];
          all.forEach(function (k) {
            var rs = find(sc, k, "", ns, !!f["-A"], f["-l"]);
            if (rs && rs.length) blocks.push(renderGet(sc, k, rs, f, true));
          });
          return blocks.length ? blocks.join("\n\n") : none("pods", ns);
        }
        var kinds = pos[1].split(","), out: string[] = [];
        name = pos[2];
        for (var i = 0; i < kinds.length; i++) {
          kind = kinds[i];
          res = find(sc, kind, name, ns, !!f["-A"], f["-l"]);
          if (res === null) return 'error: the server doesn\'t have a resource type "' + kind + '"';
          if (name && !res.length) return notFound(kind, name);
          if (!res.length) { if (kinds.length === 1) return none(kind, ns); continue; }
          out.push(renderGet(sc, kind, res, f, kinds.length > 1));
        }
        return out.length ? out.join("\n\n") : none(kinds[0], ns);
      case "describe":
        kind = pos[1]; name = pos[2];
        if (!kind) return "error: You must specify the type of resource to describe.";
        if (kind === "events") return getEvents(sc, f, ns);
        res = find(sc, kind, name, ns, false, f["-l"]);
        if (res === null) return 'error: the server doesn\'t have a resource type "' + kind + '"';
        if (name && !res.length) return notFound(kind, name);
        if (!res.length) return none(kind, ns);
        return res.map(function (r) { return describe(sc, kind, r); }).join("\n\n\n");
      case "logs":
        return logs(sc, pos, f, ns);
      case "events":
        return getEvents(sc, f, ns);
      case "explain":
        kind = (pos[1] || "").split(".")[0];
        if (!pos[1]) return "You must specify the type of resource to explain.";
        if (EXPLAIN[kind]) return EXPLAIN[kind] + (pos[1].indexOf(".") > 0 ? "\n\nFIELD: " + pos[1].slice(pos[1].indexOf(".")) + "\n    (see kubectl explain " + kind + " --recursive on a live cluster for the full field list)" : "");
        if (kind in COLS) return "KIND:       " + kindName(kind) + "\n\nDESCRIPTION:\n    (this cluster knows the kind; the field-level reference is on a live one)";
        return "error: the server doesn't have a resource type \"" + kind + "\"";
      case "api-resources":
        var seen: Record<string, number> = {};
        sc.resources.forEach(function (r) { seen[r.kind] = 1; });
        return table(["NAME", "NAMESPACED", "KIND"], Object.keys(seen).sort().map(function (k) { return [k, CLUSTER[k] ? "false" : "true", kindName(k)]; }));
      case "auth":
        return canI(sc, pos, f, ns);
      case "top":
        kind = pos[1] || "";
        if (kind === "pods") {
          res = find(sc, "pods", pos[2], ns, !!f["-A"]);
          if (!res || !res.length) return "error: Metrics not available for pods in " + ns + " namespace";
          return table(["NAME", "CPU(cores)", "MEMORY(bytes)"], res.map(function (r) { return [r.name].concat(r.top || ["1m", "6Mi"]); }));
        }
        if (kind === "nodes") return table(["NAME", "CPU(cores)", "CPU%", "MEMORY(bytes)", "MEMORY%"], [["cnpe-control-plane", "412m", "10%", "2611Mi", "33%"], ["cnpe-worker", "388m", "9%", "2210Mi", "28%"], ["cnpe-worker2", "351m", "8%", "1980Mi", "25%"]]);
        return "error: unknown command \"" + kind + "\" for \"kubectl top\"";
      case "config":
        if (pos[1] === "get-contexts") return "CURRENT   NAME        CLUSTER     AUTHINFO    NAMESPACE\n*         kind-cnpe   kind-cnpe   kind-cnpe";
        if (pos[1] === "current-context") return "kind-cnpe";
        return "error: the quest runs on one cluster, kind-cnpe";
      case "version":
        return "Client Version: v1.34.1\nServer Version: v1.34.0";
      case "cluster-info":
        return "Kubernetes control plane is running at https://127.0.0.1:6443\nCoreDNS is running at https://127.0.0.1:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy";
      case "patch": case "set": case "scale": case "label": case "annotate": case "delete": case "rollout": case "apply": case "create": case "replace": case "edit": case "expose": case "autoscale": case "cordon": case "uncordon": case "drain": case "taint":
        return mutate(sc, pos, f, ns, verb);
      case "exec":
        return exec(sc, pos, f, ns);
      case "run": case "debug":
        if (verb === "debug") return "Defaulting debug container name to debugger-x9k2p.\n(the debugging container attaches, finds nothing the ticket did not already say, and exits; describe and the events are the faster read)";
        return 'pod/' + (pos[1] || "probe") + ' created\n(it comes up in ' + ns + ' with nothing wrong of its own; the fault is in what the ticket names)';
      case "port-forward":
        return "Forwarding from 127.0.0.1:8080 -> 8080\n(the quest's terminal cannot browse; kubectl exec and the resource status say the same thing)";
      case "wait":
        return "error: timed out waiting for the condition on " + (pos[1] || "the resource") + (pos[2] ? "/" + pos[2] : "");
      case "diff":
        return "(no local files to diff against in the quest)";
      case "cp": case "attach": case "proxy": case "certificate": case "completion": case "plugin":
        return "(not something this incident needs)";
      case "kustomize":
        return "error: no kustomization file found here";
      default:
        return 'error: unknown command "' + verb + '" for "kubectl"\nRun \'kubectl --help\' for usage.';
    }
  }

  function getEvents(sc: CnpeGameScenario, f: Flags, ns: string): string {
    var evs = (sc.events || []).filter(function (e) { return f["-A"] || (e.ns || sc.ns) === ns; });
    if (!evs.length) return none("events", ns);
    // lastTimestamp order is the order the scenario lists them in, oldest first;
    // the unsorted read is kubectl's own, which is by nothing in particular
    if (!f["--sort-by"]) evs = evs.slice().sort(function (a, b) { return (a.obj + a.reason) < (b.obj + b.reason) ? -1 : 1; });
    var head = EVENT_COLS.slice(), rows = evs.map(function (e) {
      var row = [e.age, e.type, e.reason, e.obj.toLowerCase(), e.msg];
      if (f["-A"]) row.unshift(e.ns || sc.ns);
      return row;
    });
    if (f["-A"]) head.unshift("NAMESPACE");
    return table(head, rows);
  }

  function logs(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string): string {
    var kind = "pods", name = pos[1], res: CnpeGameResource[] | undefined;
    if (!name) return "error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command";
    if (KINDS[name] && pos[2]) { kind = KINDS[name]; name = pos[2]; }
    if (kind === "pods") {
      // pods is in COLS, so find never answers null for it
      res = find(sc, "pods", name, ns, false, f["-l"])!;
      if (!res.length && !f["-l"]) {
        // logs of a workload picks one of its pods, as kubectl does
        var owner = find(sc, "deployments", name, ns) || [];
        if (!owner.length) return 'error: error from server (NotFound): pods "' + name + '" not found in namespace "' + ns + '"';
        kind = "deployments";
      }
    }
    if (kind !== "pods") {
      var pods = find(sc, "pods", "", ns)!.filter(function (r) { return r.name.indexOf(name + "-") === 0 || (r.owner || "") === name; });
      if (!pods.length) return "error: no pods found for " + singular(kind) + "/" + name + " in " + ns;
      res = [pods[0]];
      if (pods.length > 1) return "Found " + pods.length + " pods, using pod/" + pods[0].name + "\n" + podLogs(pods[0], f);
    }
    // one of the two branches above always ran, so res is set by here
    if (!res!.length) return none("pods", ns);
    return res!.map(function (r) { return podLogs(r, f); }).join("\n");
  }
  function podLogs(r: CnpeGameResource, f: Flags): string {
    if (f["--previous"]) {
      if (r.prevLogs != null) return r.prevLogs;
      return 'Error from server (BadRequest): previous terminated container "' + (r.container || "app") + '" in pod "' + r.name + '" not found';
    }
    if (r.logsErr) return r.logsErr;
    var text = r.logs != null ? r.logs : "(no output yet)";
    if (f["--tail"]) { var lines = text.split("\n"); text = lines.slice(Math.max(0, lines.length - (+f["--tail"] || 10))).join("\n"); }
    return text;
  }

  function canI(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string): string {
    if (pos[1] !== "can-i") return 'error: unknown command "' + (pos[1] || "") + '" for "kubectl auth"';
    var who = f["--as"] || "";
    var table_ = sc.canI || {};
    if (f["--list"]) {
      if (!who || !table_[who]) return "Resources   Non-Resource URLs   Resource Names   Verbs\n*.*         []                  []               [*]\n(you are cluster-admin here; --as=<subject> asks for someone else)";
      var rules = table_[who];
      return "Resources" + new Array(28).join(" ") + "Non-Resource URLs   Resource Names   Verbs\n" +
        (Object.keys(rules).length ? Object.keys(rules).map(function (k) { return k + new Array(Math.max(1, 36 - k.length)).join(" ") + "[]                  []               [" + rules[k] + "]"; }).join("\n")
          : "(none: the subject has no bindings in " + ns + ")\nselfsubjectreviews.authentication.k8s.io   []   []   [create]");
    }
    var verb = pos[2], res = pos[3];
    if (!verb || !res) return "error: you must specify two or three arguments: verb, resource, and optional resourceName";
    if (!who) return "yes";
    var mine = table_[who];
    if (!mine) return "no";
    var allowed = mine[res] || mine["*"] || "";
    return (allowed === "*" || allowed.split(",").indexOf(verb) >= 0) ? "yes" : "no";
  }

  function exec(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string): string {
    var name = pos[1] === "pods" ? pos[2] : pos[1];
    if (!name) return "error: you must specify at least one command for the container";
    var res = find(sc, "pods", name, ns);
    if (!res || !res.length) return 'Error from server (NotFound): pods "' + name + '" not found';
    var r = res[0], cmd = f["--"] || "";
    if (r.notRunning) return 'error: unable to upgrade connection: container not found ("' + (r.container || "app") + '")';
    if (!cmd) return "error: you must specify at least one command for the container";
    if (r.exec) {
      for (var k in r.exec) if (new RegExp(k).test(cmd)) return r.exec[k];
    }
    if (/^(sh|bash|ash)\b/.test(cmd) && !/-c/.test(cmd)) return "(an interactive shell does not run in the quest's terminal; pass the command after --, as in -- sh -c 'nslookup kubernetes.default')";
    if (/nslookup|dig|getent|host\b/.test(cmd)) return "Server:    10.96.0.10\nAddress:   10.96.0.10:53\n\nName:      kubernetes.default.svc.cluster.local\nAddress:   10.96.0.1";
    if (/wget|curl/.test(cmd)) return "Connecting to " + (/(\S+:\/\/\S+|\S+\.svc\S*)/.exec(cmd) || ["the address"])[0] + "\nHTTP/1.1 200 OK";
    if (/^(ls|cat|env|printenv|ps|id|whoami|hostname|date|uname|df|mount)\b/.test(cmd)) return "(" + cmd + ": runs, and shows nothing the fault touches)";
    return "sh: " + cmd.split(" ")[0] + ": not found";
  }

  function mutate(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string, verb: string): string {
    var kind: string, name: string | undefined, res: CnpeGameResource[] | null;
    if (verb === "edit") return "error: the quest has no editor. Use patch, set, scale, label, annotate or delete for the same edit.";
    if (verb === "apply" || verb === "replace") {
      if (f["-f"] === "-") return "error: no stdin in the quest's terminal; write the change as a patch";
      return 'error: the path "' + (f["-f"] || "") + '" does not exist (the terminal has no filesystem; repair with patch, set, scale, label, annotate or delete)';
    }
    if (verb === "create") {
      if (f["-f"]) return 'error: the path "' + f["-f"] + '" does not exist (the terminal has no filesystem)';
      if (!pos[1]) return "error: You must specify the type of resource to create.";
      if (!pos[2]) return "error: exactly one NAME is required, got 0";
      kind = pos[1]; name = pos[2];
      res = find(sc, kind, name, ns);
      if (res && res.length) return 'error: failed to create ' + singular(kind) + ': ' + singular(kind) + 's "' + name + '" already exists';
      return singular(kind) + "/" + name + " created\n(it exists now, but it is not what this fault is missing)";
    }
    if (verb === "rollout") {
      var sub = pos[1] || "";
      kind = pos[2]; name = pos[3];
      if (!kind || !name) return 'error: required resource not specified';
      res = find(sc, kind, name, ns);
      if (!res || !res.length) return notFound(kind, name);
      // a Rollout's rollout field is the plugin's object; the table only sets the string form on the kinds this reaches
      if (sub === "status") return res[0].rollout || ("Waiting for deployment \"" + name + "\" rollout to finish: 0 of 1 updated replicas are available...\nerror: timed out waiting for the condition");
      if (sub === "history") return singular(kind) + "/" + name + "\nREVISION  CHANGE-CAUSE\n1         <none>\n2         <none>";
      if (sub === "restart") return singular(kind) + "/" + name + " restarted\n(a new ReplicaSet, the same spec, the same fault)";
      if (sub === "undo") return singular(kind) + "/" + name + " rolled back\n(the previous revision carries the same fault; the change was not in the pod template)";
      return 'error: unknown command "' + sub + '" for "kubectl rollout"';
    }
    if (verb === "set") {
      var what = pos[1] || "";
      kind = pos[2]; name = pos[3];
      if (!kind || !name) return "error: required resource not specified";
      res = find(sc, kind, name, ns);
      if (!res || !res.length) return notFound(kind, name);
      if (what === "image") return (pos[4] ? singular(kind) + "/" + name + " image updated" : "error: at least one image update is required");
      if (what === "resources") return singular(kind) + "/" + name + " resource requirements updated";
      if (what === "env") return singular(kind) + "/" + name + " env updated";
      if (what === "serviceaccount") return singular(kind) + "/" + name + " serviceaccount updated";
      return 'error: unknown command "' + what + '" for "kubectl set"';
    }
    kind = pos[1]; name = pos[2];
    if (!kind) return "error: You must specify the type of resource.";
    res = find(sc, kind, name, ns, false, f["-l"]);
    if (res === null) return 'error: the server doesn\'t have a resource type "' + kind + '"';
    if (!name && !f["-l"] && !f["--all"]) return "error: resource(s) were provided, but no name was specified";
    if (!res.length) return name ? notFound(kind, name) : none(kind, ns);
    var target = res.map(function (r) { return fullName(kind, r); }).join("\n");
    switch (verb) {
      case "patch":
        if (!f["-p"]) return "error: must specify -p to patch";
        if (f["--type"] === "json" && !/^\[/.test(f["-p"])) return "error: unable to parse \"" + f["-p"] + "\": a json patch is a list of operations";
        return target + " patched\n(the object took the change, and the symptom is unchanged: that was not the field)";
      case "scale": return target + " scaled";
      case "label": return target + " labeled";
      case "annotate": return target + " annotated";
      case "delete":
        if (kind === "pods") return target.split("\n").map(function (t) { return t.split("/").join(' "') + '" deleted'; }).join("\n") + "\n(the controller replaces it, and the replacement carries the same fault)";
        return target.split("\n").map(function (t) { return t.split("/").join(' "') + '" deleted'; }).join("\n");
      case "expose": return "service/" + name + " exposed";
      case "autoscale": return "horizontalpodautoscaler.autoscaling/" + name + " autoscaled";
      default: return "node/" + name + " " + verb + "ed";
    }
  }

  function cosign(sc: CnpeGameScenario, pos: string[], f: Flags, verb: string): string {
    var ref = pos[1] || "";
    if (verb === "verify") {
      if (!ref) return "Error: accepts 1 arg(s), received 0";
      var signed = (sc.signed || []).some(function (s) { return ref.indexOf(s) === 0; });
      if (signed) return "Verification for " + ref + " --\nThe following checks were performed on each of these signatures:\n  - The signatures were verified against the specified public key";
      return "Error: no matching signatures: " + ref + "\nmain.go:74: error during command execution: no matching signatures";
    }
    if (verb === "sign") return ref ? "Pushing signature to: " + ref.split(":")[0] + "\n(signed with the key you named; admission verifies against the platform key, so only that one counts)" : "Error: accepts 1 arg(s), received 0";
    if (verb === "tree" || verb === "triangulate") return ref ? "Supply Chain Security Related artifacts for an image: " + ref + "\n(none)" : "Error: accepts 1 arg(s), received 0";
    return "A tool for Container Signing, Verification and Storage in an OCI registry.\n\nAvailable Commands:\n  sign | verify | attest | tree";
  }

  function flux(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string, verb: string): string {
    var kind = pos[1] || "", name = pos[2];
    if (!f["-n"]) ns = "flux-system";
    if (verb === "get") {
      if (kind === "sources") { kind = ({ git: "gitrepositories", oci: "ocirepositories", helm: "helmrepositories" } as Record<string, string>)[pos[2]] || ""; name = pos[3]; }
      if (!kind) return "error: accepts 1 arg(s), received 0\nUsage: flux get [command] (kustomizations, helmreleases, sources git)";
      var res = find(sc, kind, name, ns, !!f["-A"]);
      if (!res || !res.length) return "no " + kind + " objects found in " + ns + " namespace";
      return table(["NAME", "REVISION", "SUSPENDED", "READY", "MESSAGE"], res.map(function (r) { return [r.name].concat(r.flux || ["", "False", "True", "Applied revision"]); }));
    }
    if (verb === "resume" || verb === "suspend" || verb === "reconcile" || verb === "tree") {
      if (!kind || !name) return "error: " + verb + " needs a kind and a name, as in flux " + verb + " kustomization <name>";
      var one = find(sc, kind, name, ns);
      if (!one || !one.length) return "✕ " + kindName(kind) + " object '" + name + "' not found in \"" + ns + "\" namespace";
      if (verb === "tree") return kindName(kind) + "/" + ns + "/" + name + "\n" + (one[0].tree || "└── (nothing applied yet)");
      if (verb === "reconcile") return "► annotating " + kindName(kind) + " " + name + " in " + ns + " namespace\n✔ " + kindName(kind) + " annotated\n◎ waiting for " + kindName(kind) + " reconciliation\n" + (one[0].reconcile || "✔ " + kindName(kind) + " reconciliation completed\n✔ applied revision " + ((one[0].flux || [])[0] || "main"));
      return "► " + (verb === "resume" ? "resuming" : "suspending") + " " + kindName(kind) + " " + name + " in " + ns + " namespace\n✔ " + kindName(kind) + " " + verb + "d\n(and nothing changes: it was not suspended)";
    }
    if (verb === "logs") return "(flux logs stream from the controllers; the objects' READY column and MESSAGE say the same thing sooner)";
    if (verb === "check") return "► checking prerequisites\n✔ Kubernetes 1.34.0 >=1.30.0-0\n► checking controllers\n✔ all checks passed";
    return HELP.flux;
  }

  function argocd(sc: CnpeGameScenario, pos: string[], f: Flags, verb: string): string {
    if (verb !== "app") return verb ? 'Error: unknown command "' + verb + '" for "argocd"' : HELP.argocd;
    var sub = pos[1] || "", name = pos[2];
    var apps = find(sc, "applications", "", "argocd", true) || [];
    if (sub === "list") {
      if (!apps.length) return "NAME  CLUSTER  NAMESPACE  PROJECT  STATUS  HEALTH  SYNCPOLICY  CONDITIONS  REPO  PATH  TARGET";
      return table(["NAME", "CLUSTER", "NAMESPACE", "PROJECT", "STATUS", "HEALTH", "SYNCPOLICY", "CONDITIONS", "REPO", "PATH", "TARGET"],
        apps.map(function (a) { var g: ArgoInfo = a.argo || {}; return ["argocd/" + a.name, "https://kubernetes.default.svc", g.dest || "", "default", g.sync || (a.cols || [])[0] || "", g.health || (a.cols || [])[1] || "", "Auto-Prune", g.conditions || "<none>", g.repo || "", g.path || "", g.rev || ""]; }));
    }
    if (!name) return "Error: accepts 1 arg(s), received 0";
    var app = apps.filter(function (a) { return a.name === name; })[0];
    if (!app) return 'FATA[0000] rpc error: code = NotFound desc = applications.argoproj.io "' + name + '" not found';
    var g: ArgoInfo = app.argo || {};
    if (sub === "get") {
      return ["Name:               argocd/" + app.name, "Project:            default", "Server:             https://kubernetes.default.svc",
        "Namespace:          " + (g.dest || ""), "URL:                https://argocd.lab.local/applications/" + app.name,
        "Source:", "- Repo:             " + (g.repo || ""), "  Target:           " + (g.rev || ""), "  Path:             " + (g.path || ""),
        "SyncWindow:         Sync Allowed", "Sync Policy:        Automated (Prune)", "Sync Status:        " + (g.sync || ""),
        "Health Status:      " + (g.health || ""), g.condLines ? "\nCONDITION        MESSAGE\n" + g.condLines : "",
        g.resources ? "\n" + g.resources : ""].filter(function (l) { return l !== ""; }).join("\n");
    }
    if (sub === "sync") return g.syncOut || ("TIMESTAMP                  GROUP  KIND  NAMESPACE  NAME  STATUS  HEALTH  HOOK  MESSAGE\n" + new Date().toISOString().slice(0, 19) + "  apps   Deployment  " + (g.dest || "") + "  " + app.name + "  Synced  Healthy");
    if (sub === "diff") return g.diff || "(no differences between the live state and the target revision)";
    if (sub === "set") return "application '" + app.name + "' updated\n(the field changed, and the compare still fails: that was not the one)";
    if (sub === "history") return "ID  DATE                           REVISION\n1   " + new Date().toISOString().slice(0, 19) + "  main (a1b2c3d)";
    if (sub === "manifests" || sub === "resources") return g.resources || "(nothing rendered: the compare has not succeeded)";
    return 'Error: unknown command "' + sub + '" for "argocd app"';
  }

  function tkn(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string): string {
    var kind = pos[0] || "", sub = pos[1] || "", name = pos[2];
    if (!kind) return HELP.tkn;
    if (!(kind in COLS)) return 'Error: unknown command "' + kind + '" for "tkn"';
    var res = find(sc, kind, sub === "list" ? "" : name, ns);
    if (sub === "list") {
      if (!res || !res.length) return "No " + kindName(kind) + "s found";
      if (kind === "pipelineruns") return table(["NAME", "STARTED", "DURATION", "STATUS"], res.map(function (r) { var c = r.cols || []; return [r.name, c[2] || "", c[3] && c[3] !== "---" ? "2s" : "---", (c[0] === "True" ? "Succeeded" : c[0] === "False" ? "Failed(" + (c[1] || "") + ")" : "Running")]; }));
      if (kind === "eventlisteners") return table(["NAME", "AGE", "URL", "AVAILABLE"], res.map(function (r) { var c = r.cols || []; return [r.name, "1h", c[0] || "", c[1] || ""]; }));
      return table(["NAME", "AGE"], res.map(function (r) { return [r.name, (r.cols || [])[0] || "1h"]; }));
    }
    if (!name) return "Error: accepts 1 arg(s), received 0";
    if (!res || !res.length) return "Error: failed to find " + singular(kind) + ' "' + name + '"';
    var r = res[0];
    if (sub === "describe") return "Name:              " + r.name + "\nNamespace:         " + (r.ns || ns) + "\n" + (r.desc || "");
    if (sub === "logs") return r.logs || "(no logs: the run never started a pod)";
    if (sub === "start") return "PipelineRun started: " + name + "-run-x7q2k\n(and it fails the same way; a fresh run does not change what the pipeline references)";
    if (sub === "delete") return "PipelineRun deleted: " + name;
    return 'Error: unknown command "' + sub + '" for "tkn ' + kind + '"';
  }

  function rollouts(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string, verb: string): string {
    var name = pos[2];
    if (!verb) return HELP["kubectl argo rollouts"];
    if (pos[1] && pos[1] !== "rollouts") return 'Error: unknown resource "' + pos[1] + '" for "kubectl argo rollouts ' + verb + '"';
    if (verb === "list") return table(["NAME", "STRATEGY", "STATUS", "STEP", "SET-WEIGHT", "READY", "DESIRED", "UP-TO-DATE", "AVAILABLE"], (find(sc, "rollouts", "", ns) || []).map(function (r) { var g: RolloutInfo = r.canary || {}; return [r.name, "Canary", g.status || "", g.step || "", g.weight || "", "2/2", "2", "2", "2"]; }));
    if (!name) return "Error: accepts 1 arg(s), received 0";
    var res = find(sc, "rollouts", name, ns);
    if (!res || !res.length) return 'Error: rollouts.argoproj.io "' + name + '" not found';
    var r = res[0], g: RolloutInfo = r.canary || {};
    if (verb === "get") return g.get || ("Name:            " + r.name + "\nNamespace:       " + (r.ns || ns) + "\nStatus:          " + (g.status || "") + "\nStrategy:        Canary");
    if (verb === "retry" || verb === "promote" || verb === "abort" || verb === "undo" || verb === "restart") return "rollout '" + name + "' " + (verb === "retry" ? "retried" : verb === "promote" ? "promoted" : verb + "ed") + "\n(the same analysis runs against the same address, and fails the same way)";
    return 'Error: unknown command "' + verb + '" for "kubectl argo rollouts"';
  }

  function trace(sc: CnpeGameScenario, pos: string[], f: Flags, ns: string, verb: string): string {
    if (verb !== "trace") return HELP["crossplane beta"];
    var kind = pos[1] || "", name = pos[2];
    if (!kind || !name) return "Error: accepts 2 arg(s): crossplane beta trace <kind> <name>";
    var res = find(sc, kind, name, ns);
    if (!res || !res.length) return 'crossplane: error: ' + kindName(kind) + '.' + (kind === "appenvironments" ? "platform.lab.local" : "") + ' "' + name + '" not found in namespace ' + ns;
    var r = res[0];
    return r.trace || ("NAME" + new Array(40).join(" ") + "SYNCED   READY   STATUS\n" + kindName(kind) + "/" + r.name + new Array(Math.max(1, 43 - kindName(kind).length - r.name.length - 1)).join(" ") + ((r.cols || [])[0] || "True") + "     " + ((r.cols || [])[1] || "True") + "    Available");
  }

  root.CNPE_SIM = { normalize: normalize, run: run, toolOf: toolOf, kindOf: kindOf };
})((typeof window !== "undefined" ? window : globalThis) as Pick<Window, "CNPE_SIM">);
