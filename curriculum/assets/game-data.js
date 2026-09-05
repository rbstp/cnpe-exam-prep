"use strict";
/* CNPE Quest: the content. Compiled into assets/game-data.js by tools/build-ts.sh. The overworld, the towns and their people, the
   techniques and items, and every fault the dungeons hold.

   Nothing here runs; game.js reads it and game-sim.js answers commands from the
   scenarios' resource tables. Trials are not here: a town's trial is its
   section's own self-check cards, read from CNPE_DRILL at play time.

   Scenario resources carry the fault where a real cluster would show it, so the
   generic handlers in game-sim.js render the tell without a script per command.
   The evidence matchers are regexes over the normalised command (see
   CNPE_SIM.normalize): kinds plural, -n after the positionals, patches with no
   whitespace. Every scenario is driven in bare node by tools/game-sim-test.mjs. */
window.CNPE_GAME_DATA = (function () {
    "use strict";
    /** a literal for use inside an evidence matcher: every regex metacharacter, the backslash included, escaped */
    function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    var IMG = "ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine";
    var POD = "broken-6b7f9c4d8-x2k4p";
    var OLD_POD = "broken-5c8d7b6f9-q7m3n";
    /** the team-a namespace and its tenancy objects, as examples/multitenancy/team-a.yaml lays them down */
    function tenancy(enforce) {
        return [
            { kind: "namespaces", name: "team-a", cols: ["Active", "12d"],
                labels: "kubernetes.io/metadata.name=team-a,pod-security.kubernetes.io/audit=restricted,pod-security.kubernetes.io/enforce=" + enforce + ",pod-security.kubernetes.io/warn=restricted,tenant=team-a" },
            { kind: "resourcequotas", name: "team-a-quota", ns: "team-a", cols: ["12d", "limits.cpu: 0/4, limits.memory: 0/8Gi, pods: 1/20, requests.cpu: 25m/2, requests.memory: 32Mi/4Gi", ""],
                desc: "Resource                Used   Hard\n--------                ----   ----\nlimits.cpu              0      4\nlimits.memory           0      8Gi\npersistentvolumeclaims  0      4\npods                    1      20\nrequests.cpu            25m    2\nrequests.memory         32Mi   4Gi\nservices.loadbalancers  0      1",
                yaml: "spec:\n  hard:\n    limits.cpu: \"4\"\n    limits.memory: 8Gi\n    persistentvolumeclaims: \"4\"\n    pods: \"20\"\n    requests.cpu: \"2\"\n    requests.memory: 4Gi\n    services.loadbalancers: \"1\"" },
            { kind: "limitranges", name: "team-a-limits", ns: "team-a", cols: ["12d"],
                desc: "Type       Resource  Min   Max  Default Request  Default Limit  Max Limit/Request Ratio\n----       --------  ---   ---  ---------------  -------------  -----------------------\nContainer  cpu       10m   1    50m              200m           -\nContainer  memory    16Mi  1Gi  64Mi             256Mi          -" },
            { kind: "networkpolicies", name: "default-deny", ns: "team-a", cols: ["<none>", "12d"],
                desc: "Spec:\n  PodSelector:     <none> (Allowing the specific traffic to all pods in this namespace)\n  Not affecting ingress traffic\n  Not affecting egress traffic\n  Policy Types: Ingress, Egress",
                yaml: "spec:\n  podSelector: {}\n  policyTypes:\n  - Ingress\n  - Egress" },
            { kind: "serviceaccounts", name: "default", ns: "team-a", cols: ["0", "12d"] },
            { kind: "roles", name: "developer", ns: "team-a", cols: ["2026-08-24T09:12:04Z"] },
            { kind: "rolebindings", name: "developer", ns: "team-a", cols: ["Role/developer", "12d"],
                desc: "Role:\n  Kind:  Role\n  Name:  developer\nSubjects:\n  Kind  Name   Namespace\n  ----  ----   ---------\n  User  dev-a" }
        ];
    }
    /** the tenant's DNS policy, whole or with the DNS egress rule stripped */
    function dnsPolicy(broken) {
        return { kind: "networkpolicies", name: "allow-dns-and-same-namespace", ns: "team-a", cols: ["<none>", "12d"],
            desc: "Spec:\n  PodSelector:     <none> (Allowing the specific traffic to all pods in this namespace)\n  Allowing ingress traffic:\n    To Port: <any> (traffic allowed to all ports)\n    From:\n      PodSelector: <none>\n  Allowing egress traffic:\n    To Port: <any> (traffic allowed to all ports)\n    To:\n      PodSelector: <none>" +
                (broken ? "" : "\n    ----------\n    To Port: 53/UDP\n    To Port: 53/TCP\n    To:\n      NamespaceSelector: kubernetes.io/metadata.name=kube-system\n      PodSelector: k8s-app=kube-dns") +
                "\n  Policy Types: Ingress, Egress",
            yaml: "spec:\n  egress:\n  - to:\n    - podSelector: {}" +
                (broken ? "" : "\n  - ports:\n    - port: 53\n      protocol: UDP\n    - port: 53\n      protocol: TCP\n    to:\n    - namespaceSelector:\n        matchLabels:\n          kubernetes.io/metadata.name: kube-system\n      podSelector:\n        matchLabels:\n          k8s-app: kube-dns") +
                "\n  ingress:\n  - from:\n    - podSelector: {}\n  podSelector: {}\n  policyTypes:\n  - Ingress\n  - Egress" };
    }
    /** the drill's deployment, its ReplicaSet and its pod, in whatever state the fault leaves them */
    function workload(o) {
        var rs = o.rsName || "broken-6b7f9c4d8", pn = o.podName || POD;
        var tpl = o.tpl || ("  containers:\n  - image: " + IMG + "\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    resources:\n      requests:\n        cpu: 25m\n        memory: 32Mi\n    securityContext:\n      allowPrivilegeEscalation: false\n      capabilities:\n        drop:\n        - ALL\n  securityContext:\n    runAsNonRoot: true\n    seccompProfile:\n      type: RuntimeDefault");
        var out = [
            { kind: "deployments", name: "broken", ns: "team-a", labels: "app=broken", cols: [o.ready, o.upd, o.avail, "1h"], api: "apps/v1",
                desc: "Selector:               app=broken\nReplicas:               " + (o.dep || "1 desired | 1 updated | 1 total | 0 available | 1 unavailable") + "\nStrategyType:           RollingUpdate\nPod Template:\n  Labels:  app=broken\n" + tpl.split("\n").join("\n  ") + "\nConditions:\n  Type           Status  Reason\n  ----           ------  ------\n" + (o.conds || "  Available      False   MinimumReplicasUnavailable\n  Progressing    True    ReplicaSetUpdated") + "\nNewReplicaSet:   " + rs + " (1/1 replicas created)",
                yaml: "spec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: broken\n  template:\n    metadata:\n      labels:\n        app: broken\n    spec:\n    " + tpl.split("\n").join("\n    ") + "\nstatus:\n  conditions:\n" + (o.conds || "  Available      False   MinimumReplicasUnavailable\n  Progressing    True    ReplicaSetUpdated").split("\n").map(function (l) { var p = l.trim().split(/\s+/); return "  - type: " + p[0] + "\n    status: \"" + p[1] + "\"\n    reason: " + p[2]; }).join("\n"),
                rollout: 'Waiting for deployment "broken" rollout to finish: 0 of 1 updated replicas are available...\nerror: timed out waiting for the condition' },
            { kind: "replicasets", name: rs, ns: "team-a", labels: "app=broken,pod-template-hash=" + rs.split("-")[1], cols: ["1", o.rsReady === "0" && o.podCols[1] === "-" ? "0" : "1", o.rsReady, "1h"], api: "apps/v1",
                desc: "Selector:       app=broken,pod-template-hash=" + rs.split("-")[1] + "\nControlled By:  Deployment/broken\nReplicas:       1 current / 1 desired\nPods Status:    " + (o.rsReady === "1" ? "1 Running" : "0 Running") + " / " + (o.podCols[1] === "Pending" || o.podCols[1] === "ContainerCreating" ? "1 Waiting" : "0 Waiting") + " / 0 Succeeded / 0 Failed" }
        ];
        if (o.podCols[1] !== "-") {
            out.push({ kind: "pods", name: pn, ns: "team-a", labels: "app=broken,pod-template-hash=" + rs.split("-")[1], cols: o.podCols, owner: "broken", container: "nginx-unprivileged",
                wide: ["10.244.1." + (o.podCols[1] === "Pending" ? "<none>" : "37"), o.podCols[1] === "Pending" ? "<none>" : "cnpe-worker"], wideCols: ["IP", "NODE"],
                desc: "Node:         " + (o.podCols[1] === "Pending" ? "<none>" : "cnpe-worker/172.18.0.3") + "\nStatus:       " + (o.podCols[1] === "Running" ? "Running" : "Pending") + "\nIP:           " + (o.podCols[1] === "Pending" ? "" : "10.244.1.37") + "\nControlled By:  ReplicaSet/" + rs + "\n" + o.podDesc,
                fields: { ".status.phase": o.podCols[1] === "Running" ? "Running" : "Pending" },
                logs: o.logs, prevLogs: o.prevLogs, logsErr: o.logsErr, notRunning: o.notRunning, exec: o.exec });
        }
        return out.concat(o.extraPods || []);
    }
    var WORKLOAD_TICKET = "team-a: our 'broken' deployment is not healthy and we cannot see why. It worked an hour ago.";
    var GET_PODS = ["^kubectl get pods(,\\S+)? -n team-a", "^kubectl get (deployments|replicasets|all)(,\\S+)? -n team-a", "^kubectl get pods -A"];
    var EVENTS = ["^kubectl (get|describe) events -n team-a", "^kubectl events -n team-a", "^kubectl get events -A"];
    var DESCRIBE_POD = ["^kubectl describe pods( broken\\S*)? -n team-a", "^kubectl get pods broken\\S* -n team-a -o (yaml|json)"];
    /* a pod refused at admission leaves its error on the ReplicaSet that tried to create it, not on any pod */
    var DESCRIBE_RS = ["^kubectl describe replicasets( \\S+)? -n team-a", "^kubectl describe deployments broken -n team-a", "^kubectl get (deployments|replicasets) broken\\S* -n team-a -o (yaml|json)"];
    /* the reflex that fixes nothing: a fresh pod meets whatever refused the last one */
    var RESTART = ["^kubectl (delete pods|rollout restart)"];
    /* ── the workload faults: make break's team-a drill ──────── */
    var SCENARIOS = [];
    SCENARIOS.push({
        id: "image", name: "Phantom Tag", d: 2, difficulty: 1, ns: "team-a",
        ticket: WORKLOAD_TICKET,
        answer: "deploy/broken was pointed at image tag 'does-not-exist'. Pods sit in ErrImagePull/ImagePullBackOff. Fix: set the image back to a tag that exists.",
        resources: tenancy("baseline").concat([dnsPolicy(false)], workload({
            ready: "0/1", upd: "1", avail: "0", rsReady: "0", podCols: ["0/1", "ImagePullBackOff", "0", "9m"],
            tpl: "  containers:\n  - image: ghcr.io/nginxinc/nginx-unprivileged:does-not-exist\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    resources:\n      requests:\n        cpu: 25m\n        memory: 32Mi",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          ghcr.io/nginxinc/nginx-unprivileged:does-not-exist\n    Port:           8080/TCP\n    State:          Waiting\n      Reason:       ImagePullBackOff\n    Ready:          False\n    Restart Count:  0\nConditions:\n  Type              Status\n  Initialized       True\n  Ready             False\n  ContainersReady   False\n  PodScheduled      True",
            logsErr: 'Error from server (BadRequest): container "nginx-unprivileged" in pod "' + POD + '" is waiting to start: trying and failing to pull image', notRunning: true
        })),
        events: [
            { type: "Normal", reason: "Scheduled", age: "9m", from: "default-scheduler", obj: "Pod/" + POD, msg: "Successfully assigned team-a/" + POD + " to cnpe-worker" },
            { type: "Normal", reason: "Pulling", age: "7m (x4 over 9m)", from: "kubelet", obj: "Pod/" + POD, msg: 'Pulling image "ghcr.io/nginxinc/nginx-unprivileged:does-not-exist"' },
            { type: "Warning", reason: "Failed", age: "7m (x4 over 9m)", from: "kubelet", obj: "Pod/" + POD, msg: 'Failed to pull image "ghcr.io/nginxinc/nginx-unprivileged:does-not-exist": manifest unknown' },
            { type: "Warning", reason: "Failed", age: "7m (x4 over 9m)", from: "kubelet", obj: "Pod/" + POD, msg: "Error: ErrImagePull" },
            { type: "Normal", reason: "BackOff", age: "2m (x28 over 9m)", from: "kubelet", obj: "Pod/" + POD, msg: 'Back-off pulling image "ghcr.io/nginxinc/nginx-unprivileged:does-not-exist"' },
            { type: "Warning", reason: "Failed", age: "2m (x28 over 9m)", from: "kubelet", obj: "Pod/" + POD, msg: "Error: ImagePullBackOff" }
        ],
        evidence: [
            { id: "status", match: GET_PODS, tell: "ImagePullBackOff", hint: "Start where every incident starts: what state is the pod in?" },
            { id: "reason", match: DESCRIBE_POD.concat(EVENTS), tell: "manifest unknown", hint: "The pod's events name the image that failed to pull, and why." },
            { id: "spec", match: ["^kubectl get deployments broken -n team-a -o (yaml|json|jsonpath=\\S*image\\S*)", "^kubectl describe deployments broken -n team-a"], tell: "does-not-exist", hint: "The tag came from the Deployment's template; read what it asks for." }
        ],
        fix: ["^kubectl set image deployments broken nginx-unprivileged=ghcr\\.io/nginxinc/nginx-unprivileged:(1\\.27-alpine|1\\.2\\d[\\w.-]*|stable[\\w.-]*|latest|alpine) -n team-a",
            "^kubectl set image deployments broken \\*=ghcr\\.io/nginxinc/nginx-unprivileged:(1\\.27-alpine|1\\.2\\d[\\w.-]*|stable[\\w.-]*|latest|alpine) -n team-a",
            "^kubectl patch deployments broken -n team-a .*nginx-unprivileged:(1\\.27-alpine|1\\.2\\d[\\w.-]*|stable[\\w.-]*|latest|alpine)"],
        fixOut: "deployment.apps/broken image updated\n\n$ kubectl -n team-a rollout status deploy/broken\nWaiting for deployment \"broken\" rollout to finish: 1 old replicas are pending termination...\ndeployment \"broken\" successfully rolled out",
        wrong: [
            { match: ["^kubectl set image deployments broken \\S+=\\S+:does-not-exist"], out: "deployment.apps/broken image updated\n(the same tag that does not exist; the new pod goes straight back to ImagePullBackOff)" },
            { match: ["^kubectl set image deployments broken \\S+=(?!ghcr\\.io/nginxinc/nginx-unprivileged)\\S+"], out: "deployment.apps/broken image updated\n\n$ kubectl -n team-a get pods\nNAME                      READY   STATUS             RESTARTS   AGE\nbroken-7f8d9c5b4-k2m9p    0/1     CrashLoopBackOff   2          40s\n(a different image runs a different program; the ticket wants the app back, on the tag it had)" },
            { match: ["^kubectl delete pods", "^kubectl rollout restart deployments broken"], out: "pod \"" + POD + "\" deleted\n(the ReplicaSet makes another from the same template, and it pulls the same missing tag)" },
            { match: ["^kubectl (set image|patch) (pods|replicasets) "], out: "error: the pod and the ReplicaSet are owned by the Deployment; edit the Deployment's template or the change is overwritten" }
        ]
    });
    SCENARIOS.push({
        id: "probe", name: "Deaf Sentinel", d: 4, difficulty: 1, ns: "team-a",
        ticket: WORKLOAD_TICKET,
        answer: "a readinessProbe was added against port 9999; the container listens on 8080. Pods run but never become Ready. Fix: correct or remove the probe.",
        resources: tenancy("baseline").concat([dnsPolicy(false)], workload({
            ready: "0/1", upd: "1", avail: "0", rsReady: "0", podCols: ["0/1", "Running", "0", "6m"],
            tpl: "  containers:\n  - image: " + IMG + "\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    readinessProbe:\n      httpGet:\n        path: /healthz\n        port: 9999\n      initialDelaySeconds: 1\n    resources:\n      requests:\n        cpu: 25m\n        memory: 32Mi",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    Port:           8080/TCP\n    State:          Running\n      Started:      6 minutes ago\n    Ready:          False\n    Restart Count:  0\n    Readiness:      http-get http://:9999/healthz delay=1s timeout=1s period=10s #success=1 #failure=3\nConditions:\n  Type              Status\n  Initialized       True\n  Ready             False\n  ContainersReady   False\n  PodScheduled      True",
            logs: "/docker-entrypoint.sh: Configuration complete; ready for start up\n2026/09/05 09:14:02 [notice] 1#1: nginx/1.27.5\n2026/09/05 09:14:02 [notice] 1#1: start worker processes",
            exec: { "8080": "HTTP/1.1 200 OK\nServer: nginx/1.27.5", "9999": "wget: can't connect to remote host (127.0.0.1): Connection refused", "netstat|ss ": "tcp   LISTEN 0  511  0.0.0.0:8080  0.0.0.0:*" },
            extraPods: [{ kind: "services", name: "broken", ns: "team-a", cols: ["ClusterIP", "10.96.141.7", "<none>", "80/TCP", "1h"], labels: "app=broken", desc: "Selector:          app=broken\nType:              ClusterIP\nPort:              http  80/TCP\nTargetPort:        8080/TCP\nEndpoints:         <none>" },
                { kind: "endpointslices", name: "broken-x8k2q", ns: "team-a", cols: ["IPv4", "8080", "10.244.1.37 (not ready)", "1h"], labels: "kubernetes.io/service-name=broken" }]
        })),
        events: [
            { type: "Normal", reason: "Scheduled", age: "6m", from: "default-scheduler", obj: "Pod/" + POD, msg: "Successfully assigned team-a/" + POD + " to cnpe-worker" },
            { type: "Normal", reason: "Pulled", age: "6m", from: "kubelet", obj: "Pod/" + POD, msg: 'Container image "' + IMG + '" already present on machine' },
            { type: "Normal", reason: "Started", age: "6m", from: "kubelet", obj: "Pod/" + POD, msg: "Started container nginx-unprivileged" },
            { type: "Warning", reason: "Unhealthy", age: "12s (x36 over 6m)", from: "kubelet", obj: "Pod/" + POD, msg: 'Readiness probe failed: Get "http://10.244.1.37:9999/healthz": dial tcp 10.244.1.37:9999: connect: connection refused' }
        ],
        evidence: [
            { id: "status", match: GET_PODS, tell: "0/1     Running", hint: "Running is not Ready. The READY column is the one to read." },
            { id: "probe", match: DESCRIBE_POD.concat(EVENTS), tell: "connection refused", hint: "Something is probing the pod and getting nothing back; the events say what and where." },
            { id: "port", match: ["^kubectl get deployments broken -n team-a -o (yaml|json)", "^kubectl describe deployments broken -n team-a", "^kubectl exec \\S+ -n team-a( -c \\S+)? -- .*(8080|9999|netstat|ss )", "^kubectl get (services|endpointslices)(,\\S+)? -n team-a", "^kubectl describe services broken -n team-a"], tell: "9999", hint: "Compare the port the probe knocks on with the port the container actually opens." }
        ],
        fix: ["^kubectl patch deployments broken -n team-a --type=json -p=\\[\\{\"op\":\"remove\",\"path\":\"/spec/template/spec/containers/0/readinessprobe\"\\}\\]",
            "^kubectl patch deployments broken -n team-a (?=.*readinessprobe)(?=.*(\"port\":8080|\"port\":\"?http\"?|/httpget/port\",\"value\":8080))",
            "^kubectl patch deployments broken -n team-a .*\"readinessprobe\":null"],
        fixOut: "deployment.apps/broken patched\n\n$ kubectl -n team-a get pods\nNAME                      READY   STATUS    RESTARTS   AGE\nbroken-7c6f8d9b5-p4w2z    1/1     Running   0          8s",
        wrong: [
            { match: ["^kubectl patch deployments broken -n team-a .*\"containerport\":9999", "^kubectl patch deployments broken -n team-a .*/ports/0/containerport\",\"value\":9999"], out: "deployment.apps/broken patched\n(containerPort is documentation; nginx still listens on 8080, and the probe still knocks on 9999)" },
            { match: ["^kubectl patch deployments broken -n team-a .*(initialdelayseconds|failurethreshold|periodseconds|timeoutseconds)"], out: "deployment.apps/broken patched\n(a slower probe against a closed port is still a failing probe)" },
            { match: ["^kubectl delete pods", "^kubectl rollout restart deployments broken"], out: "pod \"" + POD + "\" deleted\n(the replacement carries the same probe against the same closed port)" },
            { match: ["^kubectl patch deployments broken -n team-a .*livenessprobe"], out: "deployment.apps/broken patched\n(there is no liveness probe here; the failing one is the readiness probe)" }
        ]
    });
    SCENARIOS.push({
        id: "resources", name: "Gluttonous Request", d: 1, difficulty: 1, ns: "team-a",
        ticket: WORKLOAD_TICKET,
        answer: "requests were raised to cpu=8/memory=32Gi, more than any node has. Pods stay Pending with FailedScheduling. Fix: set requests something a node can satisfy.",
        resources: tenancy("baseline").concat([dnsPolicy(false)], workload({
            ready: "0/1", upd: "1", avail: "0", rsReady: "0", podCols: ["0/1", "Pending", "0", "11m"],
            tpl: "  containers:\n  - image: " + IMG + "\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    resources:\n      requests:\n        cpu: \"8\"\n        memory: 32Gi",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:      " + IMG + "\n    Port:       8080/TCP\n    Requests:\n      cpu:      8\n      memory:   32Gi\nConditions:\n  Type           Status\n  PodScheduled   False\nQoS Class:       Burstable",
            logsErr: 'Error from server (BadRequest): pod "' + POD + '" is not yet scheduled: no logs to show', notRunning: true,
            extraPods: [
                { kind: "nodes", name: "cnpe-control-plane", cols: ["Ready", "control-plane", "12d", "v1.34.0"], desc: "Capacity:\n  cpu:                4\n  memory:             7998816Ki\nAllocatable:\n  cpu:                4\n  memory:             7896416Ki\nAllocated resources:\n  Resource           Requests      Limits\n  --------           --------      ------\n  cpu                1150m (28%)   300m (7%)\n  memory             690Mi (8%)    500Mi (6%)\nTaints:             node-role.kubernetes.io/control-plane:NoSchedule" },
                { kind: "nodes", name: "cnpe-worker", cols: ["Ready", "<none>", "12d", "v1.34.0"], desc: "Capacity:\n  cpu:                4\n  memory:             7998816Ki\nAllocatable:\n  cpu:                4\n  memory:             7896416Ki\nAllocated resources:\n  Resource           Requests      Limits\n  --------           --------      ------\n  cpu                1275m (31%)   1 (25%)\n  memory             1226Mi (15%)  1548Mi (20%)" },
                { kind: "nodes", name: "cnpe-worker2", cols: ["Ready", "<none>", "12d", "v1.34.0"], desc: "Capacity:\n  cpu:                4\n  memory:             7998816Ki\nAllocatable:\n  cpu:                4\n  memory:             7896416Ki\nAllocated resources:\n  Resource           Requests      Limits\n  --------           --------      ------\n  cpu                980m (24%)    600m (15%)\n  memory             912Mi (11%)   1200Mi (15%)" }
            ]
        })),
        events: [
            { type: "Warning", reason: "FailedScheduling", age: "48s (x12 over 11m)", from: "default-scheduler", obj: "Pod/" + POD, msg: "0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient cpu, 2 Insufficient memory. preemption: 0/3 nodes are available: 3 No preemption victims found for incoming pod." }
        ],
        evidence: [
            { id: "status", match: GET_PODS, tell: "Pending", hint: "A pod that never left Pending never reached a node." },
            { id: "sched", match: DESCRIBE_POD.concat(EVENTS), tell: "Insufficient cpu", hint: "The scheduler leaves a note on the pod saying why every node was refused." },
            { id: "asks", match: ["^kubectl get deployments broken -n team-a -o (yaml|json|jsonpath=\\S*resources\\S*)", "^kubectl describe deployments broken -n team-a", "^kubectl describe nodes", "^kubectl top nodes"], tell: "32Gi", hint: "Set what the pod asks for beside what a node can give." }
        ],
        fix: ["^kubectl set resources deployments broken -n team-a --requests=(cpu=(\\d{1,3}m|[01](\\.\\d+)?),?(memory=(\\d{1,3}Mi|[01]Gi))?|memory=(\\d{1,3}Mi|[01]Gi),?(cpu=(\\d{1,3}m|[01](\\.\\d+)?))?)",
            "^kubectl patch deployments broken -n team-a .*\"requests\":\\{(\"cpu\":\"(\\d{1,3}m|[01])\",?|\"memory\":\"(\\d{1,3}Mi|[01]Gi)\",?){1,2}\\}"],
        fixOut: "deployment.apps/broken resource requirements updated\n\n$ kubectl -n team-a get pods\nNAME                      READY   STATUS    RESTARTS   AGE\nbroken-8d7c6f5b4-t3n8x    1/1     Running   0          6s",
        wrong: [
            { match: ["^kubectl set resources deployments broken -n team-a --requests=\\S*(cpu=([2-9]|\\d\\d+)|memory=(\\d\\d+Gi|[2-9]Gi))"], out: "deployment.apps/broken resource requirements updated\n(smaller, and still more than the 4 CPU and 7.5 GiB a node has left; the pod stays Pending)" },
            { match: ["^kubectl set resources deployments broken -n team-a --limits=\\S+$"], out: "deployment.apps/broken resource requirements updated\n(limits do not schedule a pod; requests do, and they are unchanged)" },
            { match: ["^kubectl (delete pods|rollout restart)", "^kubectl scale deployments broken"], out: "(a new pod asks for the same 8 CPU and 32Gi and is refused by the same three nodes)" },
            { match: ["^kubectl (taint|uncordon|cordon) nodes"], out: "node/cnpe-control-plane untainted\n(the control plane has 4 CPU and 7.5 GiB too; no node in this cluster can hold 8 CPU and 32Gi)" }
        ]
    });
    var SA = "system:serviceaccount:team-a:app-sa";
    SCENARIOS.push({
        id: "rbac", name: "Unbound Servant", d: 5, difficulty: 2, ns: "team-a",
        ticket: WORKLOAD_TICKET + " The app logs say it cannot list its own pods.",
        answer: "the pod was switched to sa/app-sa, which has no RBAC at all. Nothing in pod status shows it; only 'kubectl auth can-i --as=system:serviceaccount:team-a:app-sa' does. Fix: bind a Role with the needed verbs.",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "serviceaccounts", name: "app-sa", ns: "team-a", cols: ["0", "14m"] }], workload({
            ready: "1/1", upd: "1", avail: "1", rsReady: "1", podCols: ["1/1", "Running", "0", "14m"], dep: "1 desired | 1 updated | 1 total | 1 available | 0 unavailable",
            conds: "  Available      True    MinimumReplicasAvailable\n  Progressing    True    NewReplicaSetAvailable",
            tpl: "  containers:\n  - env:\n    - name: NEEDS_API\n      value: \"true\"\n    image: " + IMG + "\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    resources:\n      requests:\n        cpu: 25m\n        memory: 32Mi\n  serviceAccountName: app-sa",
            podDesc: "Service Account:  app-sa\nContainers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    Port:           8080/TCP\n    State:          Running\n    Ready:          True\n    Environment:\n      NEEDS_API:  true\nConditions:\n  Type              Status\n  Initialized       True\n  Ready             True\n  ContainersReady   True\n  PodScheduled      True",
            logs: "/docker-entrypoint.sh: Configuration complete; ready for start up\n2026/09/05 09:02:11 [notice] 1#1: start worker processes\nsidecar: GET https://kubernetes.default.svc/api/v1/namespaces/team-a/pods\nsidecar: 403 Forbidden: pods is forbidden: User \"system:serviceaccount:team-a:app-sa\" cannot list resource \"pods\" in API group \"\" in the namespace \"team-a\"\nsidecar: retrying in 30s",
            exec: { "curl|wget": 'HTTP/1.1 403 Forbidden\n{"kind":"Status","status":"Failure","message":"pods is forbidden: User \\"system:serviceaccount:team-a:app-sa\\" cannot list resource \\"pods\\" in API group \\"\\" in the namespace \\"team-a\\"","reason":"Forbidden","code":403}', "cat .*token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ii1... (a projected token for app-sa; the token is fine, the bindings are not)" }
        })),
        canI: (function () { var m = {}; m[SA] = {}; m["system:serviceaccount:team-a:default"] = {}; m["dev-a"] = { pods: "get,list,watch,create,update,patch,delete", deployments: "get,list,watch,create,update,patch,delete", secrets: "get,list" }; return m; })(),
        events: [
            { type: "Normal", reason: "Scheduled", age: "14m", from: "default-scheduler", obj: "Pod/" + POD, msg: "Successfully assigned team-a/" + POD + " to cnpe-worker" },
            { type: "Normal", reason: "Started", age: "14m", from: "kubelet", obj: "Pod/" + POD, msg: "Started container nginx-unprivileged" }
        ],
        evidence: [
            { id: "healthy", match: GET_PODS.concat(DESCRIBE_POD), tell: "Running", hint: "Everything reads healthy. That is the clue: the fault is not in the pod's lifecycle. Note whose identity the pod runs under." },
            { id: "logs", match: ["^kubectl logs \\S+ -n team-a", "^kubectl logs deployments broken -n team-a", "^kubectl exec \\S+ -n team-a( -c \\S+)? -- .*(curl|wget)"], tell: "403 Forbidden", hint: "The app is telling you what it cannot do. Read its logs." },
            { id: "cani", match: ["^kubectl auth can-i \\S+ \\S+ -n team-a --as=" + rx(SA), "^kubectl auth can-i -n team-a --as=" + rx(SA) + " --list", "^kubectl auth can-i --as=" + rx(SA) + " --list", "^kubectl get rolebindings(,\\S+)? -n team-a", "^kubectl describe rolebindings( \\S+)? -n team-a"], tell: "no", hint: "Ask the API server the question as the service account would: kubectl auth can-i ... --as=system:serviceaccount:team-a:app-sa." }
        ],
        fix: ["^kubectl create rolebindings \\S+ -n team-a --(clusterrole=(view|edit|admin)|role=developer) --serviceaccount=team-a:app-sa"],
        fixOut: "rolebinding.rbac.authorization.k8s.io/app-sa-view created\n\n$ kubectl auth can-i list pods -n team-a --as=system:serviceaccount:team-a:app-sa\nyes\n\n$ kubectl -n team-a logs deploy/broken --tail=1\nsidecar: 200 OK, 1 pod listed",
        wrong: [
            { match: ["^kubectl create clusterrolebindings \\S+ --clusterrole=cluster-admin"], out: "clusterrolebinding.rbac.authorization.k8s.io/app-sa-admin created\n(and the app can list its pods, along with every secret in the cluster; the ticket asked for least privilege, not root. Undo it and bind a Role in the namespace)" },
            { match: ["^kubectl create rolebindings \\S+ -n team-a .*--serviceaccount=team-a:default", "^kubectl create rolebindings \\S+ .*--user="], out: "rolebinding.rbac.authorization.k8s.io created\n(bound to the wrong subject; the pod runs as app-sa, and app-sa still gets 403)" },
            { match: ["^kubectl patch deployments broken -n team-a .*serviceaccountname\":\"default\"", "^kubectl set serviceaccount deployments broken default -n team-a"], out: "deployment.apps/broken serviceaccount updated\n(the default service account has no bindings either; same 403, different name in it)" },
            { match: RESTART, out: "pod \"" + POD + "\" deleted\n(a fresh pod under the same unbound account gets the same 403)" }
        ]
    });
    SCENARIOS.push({
        id: "quota", name: "Miser's Ledger", d: 1, difficulty: 2, ns: "team-a",
        ticket: WORKLOAD_TICKET + " We scaled to five replicas and only one is running.",
        answer: "the namespace ResourceQuota was clamped to pods=1 while replicas went to 5. The 'exceeded quota' error is on the ReplicaSet, not the pods. Fix: raise the quota or drop the replicas.",
        resources: tenancy("baseline").map(function (r) {
            if (r.kind !== "resourcequotas")
                return r;
            return { kind: "resourcequotas", name: "team-a-quota", ns: "team-a", cols: ["12d", "limits.cpu: 0/4, limits.memory: 0/8Gi, pods: 1/1, requests.cpu: 25m/2, requests.memory: 32Mi/4Gi", ""],
                desc: "Resource                Used   Hard\n--------                ----   ----\nlimits.cpu              0      4\nlimits.memory           0      8Gi\npersistentvolumeclaims  0      4\npods                    1      1\nrequests.cpu            25m    2\nrequests.memory         32Mi   4Gi\nservices.loadbalancers  0      1",
                yaml: "spec:\n  hard:\n    limits.cpu: \"4\"\n    limits.memory: 8Gi\n    persistentvolumeclaims: \"4\"\n    pods: \"1\"\n    requests.cpu: \"2\"\n    requests.memory: 4Gi\n    services.loadbalancers: \"1\"\nstatus:\n  hard:\n    pods: \"1\"\n  used:\n    pods: \"1\"" };
        }).concat([dnsPolicy(false)], workload({
            ready: "1/5", upd: "5", avail: "1", rsReady: "1", podCols: ["1/1", "Running", "0", "1h"], dep: "5 desired | 5 updated | 1 total | 1 available | 4 unavailable",
            conds: "  Progressing    True    ReplicaSetUpdated\n  Available      False   MinimumReplicasUnavailable\n  ReplicaFailure True    FailedCreate",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    State:          Running\n    Ready:          True",
            logs: "/docker-entrypoint.sh: Configuration complete; ready for start up"
        })).map(function (r) {
            if (r.kind !== "replicasets")
                return r;
            r.cols = ["5", "1", "1", "1h"];
            r.desc = "Selector:       app=broken,pod-template-hash=6b7f9c4d8\nControlled By:  Deployment/broken\nReplicas:       1 current / 5 desired\nPods Status:    1 Running / 0 Waiting / 0 Succeeded / 0 Failed\nConditions:\n  Type             Status  Reason\n  ----             ------  ------\n  ReplicaFailure   True    FailedCreate";
            return r;
        }),
        events: [
            { type: "Warning", reason: "FailedCreate", age: "23s (x19 over 8m)", from: "replicaset-controller", obj: "ReplicaSet/broken-6b7f9c4d8", msg: 'Error creating: pods "broken-6b7f9c4d8-9wz4k" is forbidden: exceeded quota: team-a-quota, requested: pods=1, used: pods=1, limited: pods=1' }
        ],
        evidence: [
            { id: "status", match: GET_PODS, tell: "1/5", hint: "Count what is running against what was asked for. Then notice there are no failing pods to describe: the missing four were never created." },
            { id: "rs", match: DESCRIBE_RS.concat(EVENTS), tell: "exceeded quota", hint: "A pod that was refused at admission leaves its error on the ReplicaSet that tried to create it." },
            { id: "quota", match: ["^kubectl (get|describe) resourcequotas(,\\S+)?( \\S+)? -n team-a"], tell: "pods                    1      1", hint: "Read the namespace's ResourceQuota: used against hard." }
        ],
        fix: ["^kubectl patch resourcequotas team-a-quota -n team-a .*\"pods\":\"([5-9]|[1-9]\\d)\"", "^kubectl scale deployments broken -n team-a --replicas=1$"],
        fixOut: "resourcequota/team-a-quota patched\n\n$ kubectl -n team-a get deploy broken\nNAME     READY   UP-TO-DATE   AVAILABLE   AGE\nbroken   5/5     5            5           1h",
        wrong: [
            { match: ["^kubectl patch resourcequotas team-a-quota -n team-a .*\"pods\":\"[2-4]\""], out: "resourcequota/team-a-quota patched\n(higher, and still below five: the ReplicaSet gets a little further and hits the same error)" },
            { match: ["^kubectl delete resourcequotas"], out: "resourcequota \"team-a-quota\" deleted\n(all five pods come up, and the namespace has no ceiling at all any more; the tenancy model was the quota. Raise the number instead)" },
            { match: ["^kubectl scale deployments broken -n team-a --replicas=([2-9]|\\d\\d+)"], out: "deployment.apps/broken scaled\n(still more than the quota's one pod; the ReplicaSet reports FailedCreate as before)" },
            { match: RESTART, out: "(the running pod is fine; deleting it frees one slot that its own replacement takes)" }
        ]
    });
    SCENARIOS.push({
        id: "netpol", name: "Silent Resolver", d: 4, difficulty: 3, ns: "team-a",
        ticket: WORKLOAD_TICKET + " The pod is Running, but every outbound call from it fails with 'could not resolve host'.",
        answer: "the DNS egress rule was stripped from NetworkPolicy allow-dns-and-same-namespace. With default-deny in place the pod runs but resolves nothing; only an in-pod nslookup shows it. Fix: restore the rule (re-apply examples/multitenancy/team-a.yaml).",
        resources: tenancy("baseline").concat([dnsPolicy(true)], workload({
            ready: "1/1", upd: "1", avail: "1", rsReady: "1", podCols: ["1/1", "Running", "0", "1h"], dep: "1 desired | 1 updated | 1 total | 1 available | 0 unavailable",
            conds: "  Available      True    MinimumReplicasAvailable\n  Progressing    True    NewReplicaSetAvailable",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    State:          Running\n    Ready:          True",
            logs: "/docker-entrypoint.sh: Configuration complete; ready for start up\n2026/09/05 09:31:40 [error] 29#29: *3 kubernetes.default could not be resolved (110: Operation timed out) while resolving",
            exec: { "nslookup|dig|getent|host ": ";; connection timed out; no servers could be reached", "cat /etc/resolv.conf": "search team-a.svc.cluster.local svc.cluster.local cluster.local\nnameserver 10.96.0.10\noptions ndots:5", "10\\.96\\.0\\.10|kube-dns": "wget: can't connect to remote host (10.96.0.10): Operation timed out", "10\\.96\\.0\\.1\\b|wget.*[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+": "Connecting to 10.96.0.1 (10.96.0.1:443)\nwget: server returned error: HTTP/1.1 403 Forbidden\n(the IP is reachable: it is names that are not)", "curl|wget": "wget: bad address 'kubernetes.default'" }
        })),
        events: [
            { type: "Normal", reason: "Started", age: "1h", from: "kubelet", obj: "Pod/" + POD, msg: "Started container nginx-unprivileged" }
        ],
        evidence: [
            { id: "healthy", match: GET_PODS.concat(DESCRIBE_POD, EVENTS), tell: "Running", hint: "Nothing in the pod's lifecycle is wrong. When Kubernetes has nothing to say, ask from inside the pod." },
            { id: "dns", match: ["^kubectl exec \\S+ -n team-a( -c \\S+)? -- .*(nslookup|dig|getent|wget|curl|host )", "^kubectl logs \\S+ -n team-a", "^kubectl logs deployments broken -n team-a", "^kubectl run \\S+ .*-n team-a.*(nslookup|dig)", "^kubectl run \\S+ -n team-a"], tell: "no servers could be reached", hint: "Resolve a name from inside the pod. A timeout to the DNS service, with the pod healthy, is a network policy." },
            { id: "policy", match: ["^kubectl (get|describe) networkpolicies(,\\S+)?( \\S+)? -n team-a", "^kubectl get networkpolicies \\S+ -n team-a -o (yaml|json)"], tell: "podSelector: {}", hint: "List the NetworkPolicies that select this pod and read the egress rules: something that used to allow port 53 to kube-dns is gone." }
        ],
        fix: ["^kubectl patch networkpolicies allow-dns-and-same-namespace -n team-a .*\"port\":53.*(kube-dns|kube-system)", "^kubectl patch networkpolicies allow-dns-and-same-namespace -n team-a .*(kube-dns|kube-system).*\"port\":53", "^kubectl apply -f \\S*examples/multitenancy/team-a\\.yaml", "^kubectl replace -f \\S*examples/multitenancy/team-a\\.yaml"],
        fixOut: "networkpolicy.networking.k8s.io/allow-dns-and-same-namespace patched\n\n$ kubectl -n team-a exec deploy/broken -- nslookup kubernetes.default\nServer:    10.96.0.10\nAddress:   10.96.0.10:53\nName:      kubernetes.default.svc.cluster.local\nAddress:   10.96.0.1",
        wrong: [
            { match: ["^kubectl delete networkpolicies default-deny", "^kubectl delete networkpolicies allow-dns-and-same-namespace", "^kubectl delete networkpolicies --all"], out: "networkpolicy.networking.k8s.io deleted\n(DNS works, and so does everything else: the tenant's isolation is gone with it. Put the DNS rule back instead)" },
            { match: ["^kubectl patch networkpolicies \\S+ -n team-a .*\"egress\":\\[\\]", "^kubectl patch networkpolicies \\S+ -n team-a .*\"policytypes\":\\[\"ingress\"\\]"], out: "networkpolicy.networking.k8s.io patched\n(that opens all egress from the namespace; the ticket wanted DNS back, not the perimeter down)" },
            { match: RESTART, out: "pod deleted\n(the new pod is selected by the same policies and resolves nothing either)" },
            { match: ["^kubectl patch (deployments|pods) \\S+ -n team-a .*(dnspolicy|dnsconfig|nameservers)"], out: "deployment.apps/broken patched\n(a different nameserver is still port 53 across the policy that does not allow it)" }
        ]
    });
    SCENARIOS.push({
        id: "config", name: "Missing Tome", d: 4, difficulty: 1, ns: "team-a",
        ticket: WORKLOAD_TICKET,
        answer: "a volume referencing ConfigMap 'missing-config' (which does not exist) was mounted. Pods stick in ContainerCreating and the reason only shows in describe events. Fix: create the ConfigMap or drop the volume.",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "configmaps", name: "kube-root-ca.crt", ns: "team-a", cols: ["1", "12d"] }], workload({
            ready: "0/1", upd: "1", avail: "0", rsReady: "0", podCols: ["0/1", "ContainerCreating", "0", "5m"],
            tpl: "  containers:\n  - image: " + IMG + "\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    resources:\n      requests:\n        cpu: 25m\n        memory: 32Mi\n    volumeMounts:\n    - mountPath: /etc/app\n      name: cfg\n  volumes:\n  - configMap:\n      name: missing-config\n    name: cfg",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    State:          Waiting\n      Reason:       ContainerCreating\n    Ready:          False\n    Mounts:\n      /etc/app from cfg (rw)\nConditions:\n  Type              Status\n  Initialized       True\n  Ready             False\n  ContainersReady   False\n  PodScheduled      True\nVolumes:\n  cfg:\n    Type:      ConfigMap (a volume populated by a ConfigMap)\n    Name:      missing-config\n    Optional:  false",
            logsErr: 'Error from server (BadRequest): container "nginx-unprivileged" in pod "' + POD + '" is waiting to start: ContainerCreating', notRunning: true
        })),
        events: [
            { type: "Normal", reason: "Scheduled", age: "5m", from: "default-scheduler", obj: "Pod/" + POD, msg: "Successfully assigned team-a/" + POD + " to cnpe-worker" },
            { type: "Warning", reason: "FailedMount", age: "3m (x2 over 5m)", from: "kubelet", obj: "Pod/" + POD, msg: "Unable to attach or mount volumes: unmounted volumes=[cfg], unattached volumes=[cfg kube-api-access-p7x2k]: timed out waiting for the condition" },
            { type: "Warning", reason: "FailedMount", age: "40s (x10 over 5m)", from: "kubelet", obj: "Pod/" + POD, msg: 'MountVolume.SetUp failed for volume "cfg" : configmap "missing-config" not found' }
        ],
        evidence: [
            { id: "status", match: GET_PODS, tell: "ContainerCreating", hint: "ContainerCreating for minutes means the kubelet cannot finish setting the pod up. Logs will not exist yet." },
            { id: "mount", match: DESCRIBE_POD.concat(EVENTS), tell: "not found", hint: "The kubelet's FailedMount event names the volume, and what it could not find." },
            { id: "cm", match: ["^kubectl get configmaps(,\\S+)?( \\S+)? -n team-a", "^kubectl describe configmaps"], tell: "kube-root-ca.crt", hint: "List the ConfigMaps in the namespace and compare with the one the volume asks for." }
        ],
        fix: ["^kubectl create configmaps missing-config -n team-a", "^kubectl create configmaps missing-config .*-n team-a", "^kubectl patch deployments broken -n team-a --type=json -p=\\[\\{\"op\":\"remove\",\"path\":\"/spec/template/spec/volumes\"\\},\\{\"op\":\"remove\",\"path\":\"/spec/template/spec/containers/0/volumemounts\"\\}\\]", "^kubectl patch deployments broken -n team-a --type=json -p=\\[\\{\"op\":\"remove\",\"path\":\"/spec/template/spec/containers/0/volumemounts\"\\},\\{\"op\":\"remove\",\"path\":\"/spec/template/spec/volumes\"\\}\\]", "^kubectl patch deployments broken -n team-a .*\"volumes\":null.*\"volumemounts\":null", "^kubectl patch deployments broken -n team-a .*\"volumemounts\":null.*\"volumes\":null", "^kubectl patch deployments broken -n team-a .*\"optional\":true"],
        fixOut: "configmap/missing-config created\n\n$ kubectl -n team-a get pods\nNAME                      READY   STATUS    RESTARTS   AGE\n" + POD + "    1/1     Running   0          6m",
        wrong: [
            { match: ["^kubectl create configmaps (?!missing-config)\\S+ -n team-a"], out: "configmap created\n(the volume asks for missing-config by name; a ConfigMap by any other name is not mounted)" },
            { match: ["^kubectl create configmaps missing-config( -n default)?$", "^kubectl create configmaps missing-config --from-literal=\\S+$"], out: "configmap/missing-config created\n(in the default namespace; the pod is in team-a and volumes do not cross namespaces)" },
            { match: ["^kubectl patch deployments broken -n team-a --type=json -p=\\[\\{\"op\":\"remove\",\"path\":\"/spec/template/spec/volumes\"\\}\\]$"], out: "The Deployment \"broken\" is invalid: spec.template.spec.containers[0].volumeMounts[0].name: Not found: \"cfg\"\n(the mount still names the volume; remove both, or create the ConfigMap)" },
            { match: RESTART, out: "pod deleted\n(the replacement waits on the same missing ConfigMap)" }
        ]
    });
    /* ── delivery: Argo CD, Flux, Rollouts, Tekton ────────────── */
    var REPO = "http://gitea.lab.local:3000/platform/platform.git";
    SCENARIOS.push({
        id: "argocd-rev", name: "Ghost Branch", d: 2, difficulty: 2, ns: "argocd",
        ticket: "app team: our staging app in the drill-gitops namespace is frozen. We merged to main twice this morning and nothing rolled out. Argo CD owns it.",
        answer: "Application drill-app spec.source.targetRevision was changed to 'release-2.4', a git ref that does not exist. The compare fails (ComparisonError condition), so nothing syncs. Fix: patch targetRevision back to main and refresh.",
        resources: [
            { kind: "namespaces", name: "argocd", cols: ["Active", "12d"] },
            { kind: "namespaces", name: "drill-gitops", cols: ["Active", "2h"] },
            { kind: "applications", name: "drill-app", ns: "argocd", api: "argoproj.io/v1alpha1", cols: ["Unknown", "Healthy"],
                argo: { dest: "drill-gitops", repo: REPO, path: "demo-app/overlays/staging", rev: "release-2.4", sync: "Unknown", health: "Healthy", conditions: "ComparisonError",
                    condLines: "ComparisonError  Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = failed to resolve revision release-2.4: unknown revision or path not in the working tree",
                    diff: "FATA[0000] rpc error: code = Unknown desc = failed to resolve revision release-2.4: unknown revision or path not in the working tree",
                    syncOut: "FATA[0000] rpc error: code = FailedPrecondition desc = error resolving repo revision: rpc error: code = Unknown desc = failed to resolve revision release-2.4: unknown revision or path not in the working tree" },
                desc: "Spec:\n  Destination:\n    Namespace:  drill-gitops\n    Server:     https://kubernetes.default.svc\n  Project:  default\n  Source:\n    Kustomize:\n      Namespace:      drill-gitops\n    Path:             demo-app/overlays/staging\n    Repo URL:         " + REPO + "\n    Target Revision:  release-2.4\n  Sync Policy:\n    Automated:\n      Prune:      true\n      Self Heal:  true\nStatus:\n  Conditions:\n    Last Transition Time:  2026-09-05T08:41:12Z\n    Message:               Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = failed to resolve revision release-2.4: unknown revision or path not in the working tree\n    Type:                  ComparisonError\n  Health:\n    Status:  Healthy\n  Sync:\n    Status:  Unknown\n  Reconciled At:  2026-09-05T09:40:02Z",
                yaml: "spec:\n  destination:\n    namespace: drill-gitops\n    server: https://kubernetes.default.svc\n  project: default\n  source:\n    kustomize:\n      namespace: drill-gitops\n    path: demo-app/overlays/staging\n    repoURL: " + REPO + "\n    targetRevision: release-2.4\n  syncPolicy:\n    automated:\n      prune: true\n      selfHeal: true\nstatus:\n  conditions:\n  - message: 'Failed to load target state: failed to resolve revision release-2.4: unknown revision or path not in the working tree'\n    type: ComparisonError\n  health:\n    status: Healthy\n  sync:\n    status: Unknown",
                fields: { ".spec.source.targetRevision": "release-2.4", ".status.sync.status": "Unknown", ".status.health.status": "Healthy", ".status.conditions[*].type": "ComparisonError", ".status.conditions[0].message": "Failed to load target state: failed to resolve revision release-2.4: unknown revision or path not in the working tree" } },
            { kind: "deployments", name: "staging-demo", ns: "drill-gitops", api: "apps/v1", cols: ["1/1", "1", "1", "2h"], labels: "app.kubernetes.io/instance=drill-app,app=demo",
                desc: "Selector:  app=demo\nReplicas:  1 desired | 1 updated | 1 total | 1 available\nPod Template:\n  Containers:\n   demo:\n    Image:  ghcr.io/nginxinc/nginx-unprivileged:1.26-alpine    (main has 1.27-alpine)" },
            { kind: "pods", name: "staging-demo-5f7c9b8d6-r4t2m", ns: "drill-gitops", cols: ["1/1", "Running", "0", "2h"], labels: "app=demo,pod-template-hash=5f7c9b8d6", owner: "staging-demo", logs: "/docker-entrypoint.sh: Configuration complete; ready for start up" },
            { kind: "services", name: "staging-demo", ns: "drill-gitops", cols: ["ClusterIP", "10.96.88.12", "<none>", "80/TCP", "2h"] }
        ],
        events: [
            { type: "Warning", reason: "ResourceUpdated", age: "3m (x14 over 58m)", from: "argocd-application-controller", obj: "Application/drill-app", ns: "argocd", msg: "Updated health status: Healthy -> Healthy; Updated sync status: Synced -> Unknown" }
        ],
        evidence: [
            { id: "status", match: ["^kubectl get applications(,\\S+)?( \\S+)? -n argocd", "^argocd app list", "^argocd app get drill-app$"], tell: "Unknown", hint: "Start with the Application's sync and health status; Unknown is neither Synced nor OutOfSync." },
            { id: "condition", match: ["^kubectl describe applications drill-app -n argocd", "^kubectl get applications drill-app -n argocd -o (yaml|json|jsonpath=\\S*conditions\\S*)", "^argocd app get drill-app", "^argocd app diff drill-app"].concat(["^kubectl (get|describe) events -n argocd"]), tell: "failed to resolve revision release-2.4", hint: "Conditions sit near the bottom of describe; a ComparisonError says why Argo CD could not even compare." },
            { id: "live", match: ["^kubectl get (deployments|pods|all)(,\\S+)?( \\S+)? -n drill-gitops", "^kubectl describe deployments staging-demo -n drill-gitops"], tell: "staging-demo", hint: "Check what is actually running in drill-gitops: the old image, healthy, and never going to change on its own." }
        ],
        fix: ["^kubectl patch applications drill-app -n argocd .*\"targetrevision\":\"(main|head)\"", "^argocd app set drill-app --revision=(main|HEAD)$"],
        fixOut: "application.argoproj.io/drill-app patched\n\n$ argocd app get drill-app\nSync Status:        Synced to main (e4f1a9c)\nHealth Status:      Healthy\n\n$ kubectl -n drill-gitops get deploy staging-demo -o jsonpath='{.spec.template.spec.containers[0].image}'\nghcr.io/nginxinc/nginx-unprivileged:1.27-alpine",
        wrong: [
            { match: ["^argocd app sync drill-app", "^kubectl annotate applications drill-app .*refresh", "^kubectl patch applications drill-app -n argocd .*\"operation\""], out: "FATA[0000] rpc error: code = FailedPrecondition desc = error resolving repo revision: failed to resolve revision release-2.4\n(a sync cannot run until the compare succeeds, and the compare cannot find the ref)" },
            { match: ["^kubectl patch applications drill-app -n argocd .*\"targetrevision\":\"(?!main|head)[^\"]+\""], out: "application.argoproj.io/drill-app patched\n(a different ref that also is not in the repo; ComparisonError again. The team merges to main)" },
            { match: ["^kubectl delete applications drill-app", "^argocd app delete drill-app"], out: "application.argoproj.io \"drill-app\" deleted\n(with prune, the finalizer takes the staging deployment down with it: the outage is now total)" },
            { match: ["^kubectl (set image|patch|rollout restart) deployments staging-demo -n drill-gitops", "^kubectl set image deployments staging-demo"], out: "deployment.apps/staging-demo image updated\n(a hand edit under an Argo CD app with selfHeal: the app cannot compare, so nothing reverts it yet, and the next time it can it will. This is drift, not a fix)" }
        ]
    });
    SCENARIOS.push({
        id: "flux-suspend", name: "Sleeping Reconciler", d: 2, difficulty: 2, ns: "flux-system",
        ticket: "app team: someone fat-fingered a kubectl delete on our prod deployment in the drill-gitops namespace. Flux is supposed to put it back. Twenty minutes later there is still nothing running.",
        answer: "Kustomization drill-app was suspended (spec.suspend: true), then the deployment it manages was deleted. A suspended Kustomization is skipped entirely, so drift is never corrected. Fix: flux resume kustomization drill-app (or patch suspend back to false).",
        resources: [
            { kind: "namespaces", name: "flux-system", cols: ["Active", "12d"] },
            { kind: "namespaces", name: "drill-gitops", cols: ["Active", "3h"] },
            { kind: "gitrepositories", name: "platform", ns: "flux-system", api: "source.toolkit.fluxcd.io/v1", cols: [REPO, "12d", "True", "stored artifact for revision 'main@sha1:e4f1a9c2'"], flux: ["main@sha1:e4f1a9c2", "False", "True", "stored artifact for revision 'main@sha1:e4f1a9c2'"] },
            { kind: "kustomizations", name: "platform-base", ns: "flux-system", api: "kustomize.toolkit.fluxcd.io/v1", cols: ["12d", "True", "Applied revision: main@sha1:e4f1a9c2"], flux: ["main@sha1:e4f1a9c2", "False", "True", "Applied revision: main@sha1:e4f1a9c2"] },
            { kind: "kustomizations", name: "drill-app", ns: "flux-system", api: "kustomize.toolkit.fluxcd.io/v1", cols: ["3h", "True", "Applied revision: main@sha1:e4f1a9c2"], flux: ["main@sha1:e4f1a9c2", "True", "True", "Applied revision: main@sha1:e4f1a9c2"],
                annotations: "kustomize.toolkit.fluxcd.io/reconcile=disabled",
                desc: "Spec:\n  Interval:          1m\n  Path:              ./demo-app/overlays/prod\n  Prune:             true\n  Source Ref:\n    Kind:  GitRepository\n    Name:  platform\n  Suspend:           true\n  Target Namespace:  drill-gitops\n  Timeout:           2m\n  Wait:              true\nStatus:\n  Conditions:\n    Last Transition Time:  2026-09-05T06:58:40Z\n    Message:               Applied revision: main@sha1:e4f1a9c2\n    Reason:                ReconciliationSucceeded\n    Status:                True\n    Type:                  Ready\n  Inventory:\n    Entries:\n      Id:  drill-gitops_prod-demo_apps_Deployment\n      Id:  drill-gitops_prod-demo__Service\n  Last Applied Revision:  main@sha1:e4f1a9c2",
                yaml: "spec:\n  interval: 1m\n  path: ./demo-app/overlays/prod\n  prune: true\n  sourceRef:\n    kind: GitRepository\n    name: platform\n  suspend: true\n  targetNamespace: drill-gitops\n  timeout: 2m\n  wait: true\nstatus:\n  conditions:\n  - lastTransitionTime: \"2026-09-05T06:58:40Z\"\n    message: 'Applied revision: main@sha1:e4f1a9c2'\n    reason: ReconciliationSucceeded\n    status: \"True\"\n    type: Ready\n  lastAppliedRevision: main@sha1:e4f1a9c2",
                fields: { ".spec.suspend": "true", ".status.conditions[?(@.type==\"Ready\")].status": "True", ".status.lastAppliedRevision": "main@sha1:e4f1a9c2" },
                tree: "├── Deployment/drill-gitops/prod-demo  (not found on the cluster)\n└── Service/drill-gitops/prod-demo",
                reconcile: "✕ Kustomization drill-app is suspended: resume it before reconciling" },
            { kind: "services", name: "prod-demo", ns: "drill-gitops", cols: ["ClusterIP", "10.96.42.9", "<none>", "80/TCP", "3h"], labels: "kustomize.toolkit.fluxcd.io/name=drill-app,kustomize.toolkit.fluxcd.io/namespace=flux-system",
                desc: "Selector:          app=demo\nType:              ClusterIP\nPort:              http  80/TCP\nTargetPort:        8080/TCP\nEndpoints:         <none>" }
        ],
        events: [
            { type: "Normal", reason: "ReconciliationSucceeded", age: "3h", from: "kustomize-controller", obj: "Kustomization/drill-app", ns: "flux-system", msg: "Reconciliation finished in 1.8s, next run in 1m0s" },
            { type: "Normal", reason: "Killing", age: "21m", from: "kubelet", obj: "Pod/prod-demo-7d9c8f6b5-w2x9k", ns: "drill-gitops", msg: "Stopping container demo" }
        ],
        evidence: [
            { id: "gone", match: ["^kubectl get (deployments|pods|all)(,\\S+)?( \\S+)? -n drill-gitops", "^kubectl describe services prod-demo -n drill-gitops", "^kubectl get services(,\\S+)? -n drill-gitops"], tell: "No resources found", hint: "Confirm the ticket: what is left in drill-gitops? A Service with no endpoints and no Deployment is what a deletion leaves." },
            { id: "suspended", match: ["^flux get kustomizations", "^kubectl get kustomizations(,\\S+)?( \\S+)? -n flux-system$"], tell: "True", hint: "flux get kustomizations has a SUSPENDED column. Read it." },
            { id: "spec", match: ["^kubectl get kustomizations drill-app -n flux-system -o (yaml|json|jsonpath=\\S*suspend\\S*)", "^kubectl describe kustomizations drill-app -n flux-system", "^flux tree kustomizations drill-app", "^flux export kustomizations drill-app"], tell: "suspend: true", hint: "The Kustomization's spec says it in one word: suspend. Its Ready condition is a memory of the last run, not the present." }
        ],
        fix: ["^flux resume kustomizations drill-app( -n flux-system)?$", "^kubectl patch kustomizations drill-app -n flux-system .*\"suspend\":false", "^kubectl patch kustomizations drill-app -n flux-system --type=json -p=\\[\\{\"op\":\"(remove|replace)\",\"path\":\"/spec/suspend\"(,\"value\":false)?\\}\\]"],
        fixOut: "► resuming kustomization drill-app in flux-system namespace\n✔ Kustomization resumed\n◎ waiting for Kustomization reconciliation\n✔ Kustomization reconciliation completed\n✔ applied revision main@sha1:e4f1a9c2\n\n$ kubectl -n drill-gitops get deploy\nNAME        READY   UP-TO-DATE   AVAILABLE   AGE\nprod-demo   2/2     2            2           14s",
        wrong: [
            { match: ["^flux reconcile kustomizations drill-app", "^kubectl annotate kustomizations drill-app .*reconcile"], out: "► annotating Kustomization drill-app in flux-system namespace\n✔ Kustomization annotated\n✕ Kustomization drill-app is suspended: the request is ignored until it is resumed" },
            { match: ["^flux resume kustomizations platform-base", "^flux resume kustomizations (?!drill-app)\\S+"], out: "► resuming kustomization in flux-system namespace\n✔ Kustomization resumed\n(it was not suspended; drill-app is)" },
            { match: ["^kubectl create deployments prod-demo -n drill-gitops", "^kubectl apply -f \\S+", "^kubectl run \\S+ -n drill-gitops"], out: "deployment.apps/prod-demo created\n(by hand, and outside Flux: not the image or the replicas git says, and pruned the moment the Kustomization is resumed. Let Flux do it)" },
            { match: ["^flux suspend kustomizations", "^kubectl delete kustomizations drill-app"], out: "(a suspended Kustomization is never deleted safely: its prune finalizer only runs on reconcile. Resume, do not delete)" },
            { match: ["^flux reconcile (sources|gitrepositories)", "^flux reconcile source git platform"], out: "► annotating GitRepository platform in flux-system namespace\n✔ GitRepository annotated\n✔ fetched revision main@sha1:e4f1a9c2\n(the source was never the problem; the consumer of it is asleep)" }
        ]
    });
    var PROM_GOOD = "http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090";
    var PROM_BAD = "http://prometheus.monitoring.svc:9090";
    SCENARIOS.push({
        id: "canary-analysis", name: "Blind Oracle", d: 2, difficulty: 3, ns: "team-a",
        ticket: "team-a: we shipped a config change to drill-web and the canary never finished. The rollout shows Degraded and nobody knows why; the same pipeline was green last week.",
        answer: "AnalysisTemplate drill-analysis was pointed at " + PROM_BAD + ", a service that does not exist (the real one is " + PROM_GOOD + "). Every metric query errors, the AnalysisRun fails, and the rollout aborts. Fix: correct the address, then retry the rollout (kubectl argo rollouts retry rollout drill-web -n team-a).",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "rollouts", name: "drill-web", ns: "team-a", api: "argoproj.io/v1alpha1", cols: ["2", "2", "1", "2"], labels: "app=drill-web",
                canary: { status: "Degraded", step: "1/3", weight: "0",
                    get: "Name:            drill-web\nNamespace:       team-a\nStatus:          ✕ Degraded\nMessage:         RolloutAborted: Rollout aborted update to revision 2: Metric \"canary-gate\" assessed Error due to consecutiveErrors (1) > consecutiveErrorLimit (0): \"Error Message: Post \\\"" + PROM_BAD + "/api/v1/query\\\": dial tcp: lookup prometheus.monitoring.svc: no such host\"\nStrategy:        Canary\n  Step:          1/3\n  SetWeight:     0\n  ActualWeight:  0\nImages:          ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine (stable)\nReplicas:\n  Desired:       2\n  Current:       2\n  Updated:       0\n  Ready:         2\n  Available:     2\n\nNAME                                   KIND         STATUS        AGE  INFO\n⟳ drill-web                            Rollout      ✕ Degraded    41m\n├──# revision:2\n│  ├──⧉ drill-web-7b8c9d6f5            ReplicaSet   • ScaledDown  9m   canary\n│  └──α drill-web-7b8c9d6f5-2          AnalysisRun  ✕ Error       9m   ✕ 1\n└──# revision:1\n   └──⧉ drill-web-5d6e7f8a9            ReplicaSet   ✔ Healthy     41m  stable\n      ├──□ drill-web-5d6e7f8a9-k2p4x   Pod          ✔ Running     41m  ready:1/1\n      └──□ drill-web-5d6e7f8a9-m8q1z   Pod          ✔ Running     41m  ready:1/1" },
                desc: "Spec:\n  Replicas:  2\n  Strategy:\n    Canary:\n      Steps:\n        Set Weight:  50\n        Analysis:\n          Templates:\n            Template Name:  drill-analysis\n        Set Weight:  100\nStatus:\n  Abort:          true\n  Aborted At:     2026-09-05T09:31:02Z\n  Message:        RolloutAborted: Rollout aborted update to revision 2: Metric \"canary-gate\" assessed Error due to consecutiveErrors (1) > consecutiveErrorLimit (0)\n  Phase:          Degraded\n  Current Step Index:  1",
                fields: { ".status.phase": "Degraded", ".status.message": "RolloutAborted: Rollout aborted update to revision 2: Metric \"canary-gate\" assessed Error due to consecutiveErrors (1) > consecutiveErrorLimit (0)" } },
            { kind: "analysistemplates", name: "drill-analysis", ns: "team-a", api: "argoproj.io/v1alpha1", cols: ["41m"],
                desc: "Spec:\n  Metrics:\n    Consecutive Error Limit:  1\n    Count:                    2\n    Failure Limit:            0\n    Interval:                 15s\n    Name:                     canary-gate\n    Provider:\n      Prometheus:\n        Address:  " + PROM_BAD + "\n        Query:    vector(1)\n    Success Condition:  len(result) == 1 && result[0] >= 1",
                yaml: "spec:\n  metrics:\n  - consecutiveErrorLimit: 1\n    count: 2\n    failureLimit: 0\n    interval: 15s\n    name: canary-gate\n    provider:\n      prometheus:\n        address: " + PROM_BAD + "\n        query: vector(1)\n    successCondition: len(result) == 1 && result[0] >= 1",
                fields: { ".spec.metrics[0].provider.prometheus.address": PROM_BAD } },
            { kind: "analysisruns", name: "drill-web-7b8c9d6f5-2", ns: "team-a", api: "argoproj.io/v1alpha1", cols: ["Error", "9m"], labels: "rollout-type=Step,rollouts-pod-template-hash=7b8c9d6f5,step-index=1",
                desc: "Status:\n  Message:  Metric \"canary-gate\" assessed Error due to consecutiveErrors (1) > consecutiveErrorLimit (0): \"Error Message: Post \\\"" + PROM_BAD + "/api/v1/query\\\": dial tcp: lookup prometheus.monitoring.svc on 10.96.0.10:53: no such host\"\n  Metric Results:\n    Consecutive Error:  1\n    Error:              1\n    Measurements:\n      Finished At:  2026-09-05T09:31:01Z\n      Message:      Post \"" + PROM_BAD + "/api/v1/query\": dial tcp: lookup prometheus.monitoring.svc on 10.96.0.10:53: no such host\n      Phase:        Error\n      Started At:   2026-09-05T09:31:01Z\n    Name:               canary-gate\n    Phase:              Error\n  Phase:                Error\n  Started At:           2026-09-05T09:31:00Z",
                fields: { ".status.phase": "Error", ".status.message": "Metric \"canary-gate\" assessed Error due to consecutiveErrors (1) > consecutiveErrorLimit (0): dial tcp: lookup prometheus.monitoring.svc: no such host" } },
            { kind: "replicasets", name: "drill-web-5d6e7f8a9", ns: "team-a", api: "apps/v1", cols: ["2", "2", "2", "41m"], labels: "app=drill-web,rollouts-pod-template-hash=5d6e7f8a9" },
            { kind: "replicasets", name: "drill-web-7b8c9d6f5", ns: "team-a", api: "apps/v1", cols: ["0", "0", "0", "9m"], labels: "app=drill-web,rollouts-pod-template-hash=7b8c9d6f5" },
            { kind: "pods", name: "drill-web-5d6e7f8a9-k2p4x", ns: "team-a", cols: ["1/1", "Running", "0", "41m"], labels: "app=drill-web,rollouts-pod-template-hash=5d6e7f8a9", owner: "drill-web", logs: "/docker-entrypoint.sh: Configuration complete; ready for start up" },
            { kind: "pods", name: "drill-web-5d6e7f8a9-m8q1z", ns: "team-a", cols: ["1/1", "Running", "0", "41m"], labels: "app=drill-web,rollouts-pod-template-hash=5d6e7f8a9", owner: "drill-web", logs: "/docker-entrypoint.sh: Configuration complete; ready for start up" },
            { kind: "services", name: "prometheus-kube-prometheus-prometheus", ns: "monitoring", cols: ["ClusterIP", "10.96.201.44", "<none>", "9090/TCP,8080/TCP", "12d"] },
            { kind: "services", name: "prometheus-operated", ns: "monitoring", cols: ["ClusterIP", "None", "<none>", "9090/TCP", "12d"] }
        ]),
        events: [
            { type: "Warning", reason: "RolloutAborted", age: "9m", from: "rollouts-controller", obj: "Rollout/drill-web", msg: "Rollout aborted update to revision 2: Metric \"canary-gate\" assessed Error due to consecutiveErrors (1) > consecutiveErrorLimit (0)" },
            { type: "Warning", reason: "MetricError", age: "9m", from: "rollouts-controller", obj: "AnalysisRun/drill-web-7b8c9d6f5-2", msg: "Metric 'canary-gate' Completed. Result: Error" },
            { type: "Warning", reason: "AnalysisRunError", age: "9m", from: "rollouts-controller", obj: "AnalysisRun/drill-web-7b8c9d6f5-2", msg: "AnalysisRun Completed. Result: Error" }
        ],
        evidence: [
            { id: "degraded", match: ["^kubectl argo rollouts get rollouts drill-web -n team-a", "^kubectl argo rollouts list", "^kubectl get rollouts(,\\S+)?( \\S+)? -n team-a", "^kubectl describe rollouts drill-web -n team-a"], tell: "Degraded", hint: "The rollout plugin shows the whole tree: which revision aborted and which step it was on." },
            { id: "run", match: ["^kubectl get analysisruns(,\\S+)?( \\S+)? -n team-a", "^kubectl describe analysisruns( \\S+)? -n team-a", "^kubectl get analysisruns \\S+ -n team-a -o (yaml|json|jsonpath\\S*)"].concat(EVENTS), tell: "Error", hint: "The canary step ran an analysis. Its AnalysisRun holds the metric's measurements, and the error message with them." },
            { id: "address", match: ["^kubectl (get|describe) analysistemplates( drill-analysis)? -n team-a", "^kubectl get analysistemplates drill-analysis -n team-a -o (yaml|json|jsonpath\\S*)", "^kubectl get services(,\\S+)?( \\S+)? -n monitoring"], tell: "prometheus.monitoring.svc:9090", hint: "Compare the address in the AnalysisTemplate with the Services that exist in the monitoring namespace." }
        ],
        fix: ["^kubectl patch analysistemplates drill-analysis -n team-a .*prometheus-kube-prometheus-prometheus\\.monitoring\\.svc(\\.cluster\\.local)?:9090"],
        fixOut: "analysistemplate.argoproj.io/drill-analysis patched\n\n$ kubectl argo rollouts retry rollout drill-web -n team-a\nrollout 'drill-web' retried\n\n$ kubectl argo rollouts get rollout drill-web -n team-a\nStatus:          ✔ Healthy\nStrategy:        Canary\n  Step:          3/3\n  SetWeight:     100\n  ActualWeight:  100",
        wrong: [
            { match: ["^kubectl argo rollouts (retry|promote|restart) rollouts drill-web", "^kubectl argo rollouts promote rollouts drill-web --full"], out: "rollout 'drill-web' retried\n(the canary runs the same analysis against the same address, errors once, and aborts again)" },
            { match: ["^kubectl argo rollouts (abort|undo) rollouts drill-web"], out: "rollout 'drill-web' aborted\n(it is already aborted; the stable pods serve, and the change never ships)" },
            { match: ["^kubectl patch analysistemplates drill-analysis -n team-a .*(consecutiveerrorlimit|failurelimit|\"count\")", "^kubectl patch analysistemplates drill-analysis -n team-a .*prometheus\\.monitoring\\.svc"], out: "analysistemplate.argoproj.io/drill-analysis patched\n(a more tolerant gate against an address that does not exist is still a gate that cannot measure; the retry errors again)" },
            { match: ["^kubectl patch rollouts drill-web -n team-a .*\"analysis\"", "^kubectl patch rollouts drill-web -n team-a --type=json -p=\\[\\{\"op\":\"remove\",\"path\":\"/spec/strategy/canary/steps/1\"\\}\\]"], out: "rollout.argoproj.io/drill-web patched\n(without the analysis step the canary promotes blind; the ticket wants the gate working, not gone)" },
            { match: ["^kubectl (create|expose) services prometheus -n monitoring"], out: "(a Service named prometheus with no selector pointing at the right pods; fix the template's address instead)" }
        ]
    });
    SCENARIOS.push({
        id: "tekton-task", name: "Nameless Step", d: 2, difficulty: 1, ns: "drill-ci",
        ticket: "CI channel: every run of the drill-build pipeline in the drill-ci namespace dies instantly. It was green yesterday and nobody changed the pipeline.",
        answer: "Pipeline drill-build references Task drill-lint, which does not exist in the namespace. The PipelineRun fails immediately with reason CouldntGetTask. Fix: create the drill-lint Task, then start a fresh PipelineRun (completed runs are immutable).",
        resources: [
            { kind: "namespaces", name: "drill-ci", cols: ["Active", "12d"] },
            { kind: "pipelines", name: "drill-build", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"],
                desc: "Spec:\n  Tasks:\n    Name:  lint\n    Task Ref:\n      Kind:  Task\n      Name:  drill-lint",
                yaml: "spec:\n  tasks:\n  - name: lint\n    taskRef:\n      kind: Task\n      name: drill-lint" },
            { kind: "tasks", name: "git-clone", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"] },
            { kind: "tasks", name: "kaniko", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"] },
            { kind: "pipelineruns", name: "drill-run", ns: "drill-ci", api: "tekton.dev/v1", cols: ["False", "CouldntGetTask", "4m", "4m"],
                desc: "Status\n\nSTARTED        DURATION   STATUS\n4 minutes ago  0s         Failed(CouldntGetTask)\n\nMessage\n\nPipeline drill-ci/drill-build can't be Run; it contains Tasks that don't exist: Couldn't retrieve Task \"drill-lint\": tasks.tekton.dev \"drill-lint\" not found\n\nTaskruns\n\nNo taskruns",
                yaml: "spec:\n  pipelineRef:\n    name: drill-build\nstatus:\n  completionTime: \"2026-09-05T09:44:10Z\"\n  conditions:\n  - lastTransitionTime: \"2026-09-05T09:44:10Z\"\n    message: 'Pipeline drill-ci/drill-build can''t be Run; it contains Tasks that don''t exist: Couldn''t retrieve Task \"drill-lint\": tasks.tekton.dev \"drill-lint\" not found'\n    reason: CouldntGetTask\n    status: \"False\"\n    type: Succeeded",
                fields: { ".status.conditions[0].reason": "CouldntGetTask", ".status.conditions[0].message": "Pipeline drill-ci/drill-build can't be Run; it contains Tasks that don't exist: Couldn't retrieve Task \"drill-lint\": tasks.tekton.dev \"drill-lint\" not found", ".status.conditions[?(@.type==\"Succeeded\")].status": "False" },
                logs: "(no logs: the run failed before any TaskRun was created)" }
        ],
        events: [
            { type: "Warning", reason: "Failed", age: "4m", from: "PipelineRun", obj: "PipelineRun/drill-run", msg: "Pipeline drill-ci/drill-build can't be Run; it contains Tasks that don't exist: Couldn't retrieve Task \"drill-lint\": tasks.tekton.dev \"drill-lint\" not found" }
        ],
        evidence: [
            { id: "failed", match: ["^tkn pipelineruns list", "^kubectl get pipelineruns(,\\S+)?( \\S+)? -n drill-ci$"], tell: "CouldntGetTask", hint: "List the PipelineRuns: the STATUS column carries the reason, not just Failed." },
            { id: "message", match: ["^tkn pipelineruns describe drill-run", "^kubectl describe pipelineruns drill-run -n drill-ci", "^kubectl get pipelineruns drill-run -n drill-ci -o (yaml|json|jsonpath\\S*)", "^tkn pipelineruns logs"].concat(["^kubectl (get|describe) events -n drill-ci"]), tell: "drill-lint", hint: "The run's Succeeded condition has a message that names exactly what could not be retrieved." },
            { id: "tasks", match: ["^kubectl get tasks(,\\S+)?( \\S+)? -n drill-ci", "^tkn tasks list", "^kubectl get pipelines drill-build -n drill-ci -o (yaml|json)", "^kubectl describe pipelines drill-build -n drill-ci"], tell: "git-clone", hint: "Compare the Tasks the Pipeline references with the Tasks the namespace has." }
        ],
        fix: ["^kubectl create tasks drill-lint -n drill-ci", "^kubectl apply -f \\S*drill-lint\\S*", "^kubectl patch pipelines drill-build -n drill-ci .*\"name\":\"(git-clone|kaniko)\""],
        fixOut: "task.tekton.dev/drill-lint created\n\n$ tkn pipeline start drill-build -n drill-ci\nPipelineRun started: drill-build-run-x7q2k\n\n$ tkn pipelinerun list -n drill-ci\nNAME                   STARTED         DURATION   STATUS\ndrill-build-run-x7q2k  10 seconds ago  8s         Succeeded\ndrill-run              6 minutes ago   0s         Failed(CouldntGetTask)",
        wrong: [
            { match: ["^tkn pipelines start drill-build", "^tkn pipelineruns delete", "^kubectl delete pipelineruns", "^kubectl create pipelineruns"], out: "PipelineRun started: drill-build-run-p3m9z\n\n$ tkn pipelinerun list -n drill-ci\nNAME                   STARTED        DURATION   STATUS\ndrill-build-run-p3m9z  2 seconds ago  0s         Failed(CouldntGetTask)\n(a fresh run resolves the same missing Task)" },
            { match: ["^kubectl patch pipelineruns drill-run"], out: "Error from server (BadRequest): admission webhook \"validation.webhook.pipeline.tekton.dev\" denied the request: invalid value: a completed PipelineRun is immutable" },
            { match: ["^kubectl create tasks (?!drill-lint)\\S+ -n drill-ci"], out: "task.tekton.dev created\n(the Pipeline references drill-lint by name; another Task does not satisfy it)" },
            { match: ["^kubectl create tasks drill-lint( -n default)?$"], out: "task.tekton.dev/drill-lint created\n(in the default namespace; the Pipeline is in drill-ci and a taskRef resolves in its own namespace)" },
            { match: ["^kubectl delete pipelines drill-build"], out: "pipeline.tekton.dev \"drill-build\" deleted\n(now every run fails with CouldntGetPipeline instead; the ticket wants it green)" }
        ]
    });
    SCENARIOS.push({
        id: "tekton-trigger", name: "Deaf Listener", d: 2, difficulty: 2, ns: "drill-ci",
        ticket: "platform channel: Gitea webhooks into drill-ci stopped landing and the event listener pod keeps restarting. It ran fine for weeks.",
        answer: "the RoleBinding drill-trigger-el (sa drill-trigger-sa -> ClusterRole tekton-triggers-eventlistener-roles) was deleted. The listener pod can no longer list/watch Triggers resources, fails its listers with 'forbidden', and crashloops. Fix: recreate the RoleBinding and delete the pod to skip the backoff.",
        resources: [
            { kind: "namespaces", name: "drill-ci", cols: ["Active", "12d"] },
            { kind: "eventlisteners", name: "drill-listener", ns: "drill-ci", api: "triggers.tekton.dev/v1beta1", cols: ["http://el-drill-listener.drill-ci.svc.cluster.local:8080", "False", "MinimumReplicasUnavailable", "False", "MinimumReplicasUnavailable"],
                desc: "Spec:\n  Service Account Name:  drill-trigger-sa\n  Triggers:\n    Bindings:\n      Ref:  drill-binding\n    Name:   on-push\n    Template:\n      Ref:  drill-template\nStatus:\n  Address:\n    URL:  http://el-drill-listener.drill-ci.svc.cluster.local:8080\n  Conditions:\n    Message:  Deployment does not have minimum availability.\n    Reason:   MinimumReplicasUnavailable\n    Status:   False\n    Type:     Available\n    Message:  Deployment does not have minimum availability.\n    Reason:   MinimumReplicasUnavailable\n    Status:   False\n    Type:     Ready",
                fields: { ".spec.serviceAccountName": "drill-trigger-sa", ".status.conditions[?(@.type==\"Ready\")].status": "False" } },
            { kind: "deployments", name: "el-drill-listener", ns: "drill-ci", api: "apps/v1", cols: ["0/1", "1", "0", "3d"], labels: "eventlistener=drill-listener",
                rollout: 'Waiting for deployment "el-drill-listener" rollout to finish: 0 of 1 updated replicas are available...' },
            { kind: "pods", name: "el-drill-listener-6c7d8e9f1-z4k8w", ns: "drill-ci", cols: ["0/1", "CrashLoopBackOff", "7 (2m ago)", "16m"], labels: "eventlistener=drill-listener,app.kubernetes.io/managed-by=EventListener", owner: "el-drill-listener", container: "event-listener",
                desc: "Service Account:  drill-trigger-sa\nContainers:\n  event-listener:\n    Image:          ghcr.io/tektoncd/triggers/eventlistenersink:v0.30.0\n    State:          Waiting\n      Reason:       CrashLoopBackOff\n    Last State:     Terminated\n      Reason:       Error\n      Exit Code:    1\n    Ready:          False\n    Restart Count:  7",
                logs: '{"level":"info","ts":"2026-09-05T09:47:31Z","logger":"eventlistener","msg":"Starting EventListener drill-listener"}\n{"level":"fatal","ts":"2026-09-05T09:47:31Z","logger":"eventlistener","msg":"Failed to start informers","error":"failed to wait for cache sync: triggers.triggers.tekton.dev is forbidden: User \\"system:serviceaccount:drill-ci:drill-trigger-sa\\" cannot list resource \\"triggers\\" in API group \\"triggers.tekton.dev\\" in the namespace \\"drill-ci\\""}',
                prevLogs: '{"level":"info","ts":"2026-09-05T09:45:02Z","logger":"eventlistener","msg":"Starting EventListener drill-listener"}\n{"level":"fatal","ts":"2026-09-05T09:45:02Z","logger":"eventlistener","msg":"Failed to start informers","error":"failed to wait for cache sync: triggers.triggers.tekton.dev is forbidden: User \\"system:serviceaccount:drill-ci:drill-trigger-sa\\" cannot list resource \\"triggers\\" in API group \\"triggers.tekton.dev\\" in the namespace \\"drill-ci\\""}' },
            { kind: "serviceaccounts", name: "drill-trigger-sa", ns: "drill-ci", cols: ["0", "3d"] },
            { kind: "serviceaccounts", name: "default", ns: "drill-ci", cols: ["0", "12d"] },
            { kind: "clusterrolebindings", name: "drill-trigger-el", api: "rbac.authorization.k8s.io/v1", cols: ["ClusterRole/tekton-triggers-eventlistener-clusterroles", "3d"],
                desc: "Role:\n  Kind:  ClusterRole\n  Name:  tekton-triggers-eventlistener-clusterroles\nSubjects:\n  Kind            Name              Namespace\n  ----            ----              ---------\n  ServiceAccount  drill-trigger-sa  drill-ci" },
            { kind: "clusterroles", name: "tekton-triggers-eventlistener-roles", api: "rbac.authorization.k8s.io/v1", cols: ["2026-08-24T10:02:11Z"] },
            { kind: "clusterroles", name: "tekton-triggers-eventlistener-clusterroles", api: "rbac.authorization.k8s.io/v1", cols: ["2026-08-24T10:02:11Z"] },
            { kind: "triggerbindings", name: "drill-binding", ns: "drill-ci", api: "triggers.tekton.dev/v1beta1", cols: ["3d"] },
            { kind: "triggertemplates", name: "drill-template", ns: "drill-ci", api: "triggers.tekton.dev/v1beta1", cols: ["3d"] },
            { kind: "pipelines", name: "drill-build", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"] },
            { kind: "tasks", name: "drill-lint", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"] }
        ],
        canI: { "system:serviceaccount:drill-ci:drill-trigger-sa": { clusterinterceptors: "get,list,watch", clustertriggerbindings: "get,list,watch" } },
        events: [
            { type: "Warning", reason: "BackOff", age: "2m (x41 over 16m)", from: "kubelet", obj: "Pod/el-drill-listener-6c7d8e9f1-z4k8w", msg: "Back-off restarting failed container event-listener in pod el-drill-listener-6c7d8e9f1-z4k8w" }
        ],
        evidence: [
            { id: "crash", match: ["^kubectl get (eventlisteners|pods|deployments|all)(,\\S+)?( \\S+)? -n drill-ci", "^tkn eventlisteners list", "^kubectl describe eventlisteners drill-listener -n drill-ci", "^kubectl describe pods( el-drill\\S+)? -n drill-ci"], tell: "CrashLoopBackOff", hint: "The listener is a Deployment like any other. Find its pod and its state." },
            { id: "forbidden", match: ["^kubectl logs \\S+ -n drill-ci", "^kubectl logs deployments el-drill-listener -n drill-ci", "^tkn eventlisteners logs"], tell: "forbidden", hint: "A crashlooping pod wrote down why it died. Read the logs, --previous if the current container has nothing yet." },
            { id: "binding", match: ["^kubectl get (rolebindings|serviceaccounts)(,\\S+)?( \\S+)? -n drill-ci", "^kubectl auth can-i \\S+ \\S+ -n drill-ci --as=system:serviceaccount:drill-ci:drill-trigger-sa", "^kubectl auth can-i -n drill-ci --as=system:serviceaccount:drill-ci:drill-trigger-sa --list", "^kubectl describe rolebindings( \\S+)? -n drill-ci", "^kubectl get clusterrolebindings drill-trigger-el"], tell: "drill-trigger-sa", hint: "The log names the subject and the verb. Ask what bindings that service account has in the namespace: there should be a RoleBinding to tekton-triggers-eventlistener-roles." }
        ],
        fix: ["^kubectl create rolebindings \\S+ -n drill-ci --clusterrole=tekton-triggers-eventlistener-roles --serviceaccount=drill-ci:drill-trigger-sa"],
        fixOut: "rolebinding.rbac.authorization.k8s.io/drill-trigger-el created\n\n$ kubectl -n drill-ci delete pod -l eventlistener=drill-listener\npod \"el-drill-listener-6c7d8e9f1-z4k8w\" deleted\n\n$ kubectl -n drill-ci get eventlistener drill-listener\nNAME             ADDRESS                                                 AVAILABLE   REASON                     READY   REASON\ndrill-listener   http://el-drill-listener.drill-ci.svc.cluster.local:8080   True        MinimumReplicasAvailable   True    MinimumReplicasAvailable",
        wrong: [
            { match: RESTART, out: "pod \"el-drill-listener-6c7d8e9f1-z4k8w\" deleted\n(the fresh pod starts its informers under the same unbound account and dies the same way)" },
            { match: ["^kubectl create clusterrolebindings \\S+ --clusterrole=cluster-admin"], out: "clusterrolebinding.rbac.authorization.k8s.io created\n(the listener comes up, as cluster-admin; a webhook receiver with root on the cluster is the wrong shape of fix. Bind the ClusterRole Tekton ships, in the namespace)" },
            { match: ["^kubectl create rolebindings \\S+ .*--clusterrole=tekton-triggers-eventlistener-clusterroles"], out: "rolebinding.rbac.authorization.k8s.io created\n(that ClusterRole covers the cluster-scoped kinds and is already bound cluster-wide; the namespaced listers still get forbidden)" },
            { match: ["^kubectl create rolebindings \\S+ .*--serviceaccount=drill-ci:default"], out: "rolebinding.rbac.authorization.k8s.io created\n(bound to the default account; the listener runs as drill-trigger-sa)" },
            { match: ["^kubectl patch eventlisteners drill-listener .*serviceaccountname", "^kubectl delete eventlisteners"], out: "(changing who the listener runs as does not give anyone the permissions; recreate the binding)" }
        ]
    });
    /* ── platform APIs: Crossplane ────────────────────────────── */
    var XP_SA = "provider-kubernetes-a1b2c3d4e5f6";
    var XP_SUBJ = "system:serviceaccount:crossplane-system:" + XP_SA;
    function composed(xr, kind, name, ok) {
        return { kind: "objects", name: xr + "-" + name, ns: "default", api: "kubernetes.m.crossplane.io/v1alpha1", cols: [kind, "default", ok ? "True" : "False", ok ? "True" : "False", "20m"],
            labels: "crossplane.io/composite=" + xr,
            desc: ok ? "Status:\n  Conditions:\n    Reason:  ReconcileSuccess\n    Status:  True\n    Type:    Synced\n    Reason:  Available\n    Status:  True\n    Type:    Ready"
                : "Spec:\n  For Provider:\n    Manifest:\n      Kind:  " + kind + "\n  Provider Config Ref:\n    Name:  default\nStatus:\n  Conditions:\n    Last Transition Time:  2026-09-05T09:32:18Z\n    Message:               observe failed: cannot get object: " + kind.toLowerCase() + "s is forbidden: User \"" + XP_SUBJ + "\" cannot get resource \"" + kind.toLowerCase() + "s\" in API group \"\" at the cluster scope\n    Reason:                ReconcileError\n    Status:                False\n    Type:                  Synced\n    Reason:                Creating\n    Status:                False\n    Type:                  Ready",
            fields: { ".status.conditions[?(@.type==\"Synced\")].status": ok ? "True" : "False", ".status.conditions[?(@.type==\"Synced\")].message": ok ? "" : "observe failed: cannot get object: " + kind.toLowerCase() + "s is forbidden: User \"" + XP_SUBJ + "\" cannot get resource \"" + kind.toLowerCase() + "s\" in API group \"\" at the cluster scope" } };
    }
    SCENARIOS.push({
        id: "xp-provider-rbac", name: "Disarmed Provider", d: 3, difficulty: 3, ns: "default",
        ticket: "developer: I requested a new AppEnvironment called drill-env twenty minutes ago. The team-drill namespace it should create never appeared, and the platform portal just says 'not ready'.",
        answer: "the ClusterRoleBinding that gives provider-kubernetes its in-cluster permissions (crossplane-" + XP_SA + ") was deleted. Every composed Object now fails with 'forbidden' in its Synced condition, so the XR never becomes Ready. Fix: recreate the binding (cluster-admin for the provider's service account, as scripts/40-platform-api.sh does).",
        resources: [
            { kind: "namespaces", name: "default", cols: ["Active", "12d"] },
            { kind: "namespaces", name: "crossplane-system", cols: ["Active", "12d"] },
            { kind: "namespaces", name: "team-c", cols: ["Active", "9d"], labels: "kubernetes.io/metadata.name=team-c,tenant=team-c" },
            { kind: "appenvironments", name: "drill-env", ns: "default", api: "platform.lab.local/v1alpha1", cols: ["False", "False", "appenvironment-namespaced", "20m"],
                desc: "Spec:\n  Cpu Quota:     1\n  Memory Quota:  1Gi\n  Team:          team-drill\n  Crossplane:\n    Composition Ref:\n      Name:  appenvironment-namespaced\n    Resource Refs:\n      Kind:  Object\n      Name:  drill-env-namespace\n      Kind:  Object\n      Name:  drill-env-quota\n      Kind:  Object\n      Name:  drill-env-limits\nStatus:\n  Conditions:\n    Last Transition Time:  2026-09-05T09:32:20Z\n    Message:               Composed resource \"namespace\" is not yet ready\n    Reason:                Creating\n    Status:                False\n    Type:                  Ready\n    Reason:                ReconcileSuccess\n    Status:                True\n    Type:                  Synced",
                fields: { ".status.conditions[?(@.type==\"Ready\")].status": "False", ".status.conditions[?(@.type==\"Ready\")].reason": "Creating" },
                trace: "NAME                                            SYNCED   READY   STATUS\nAppEnvironment/drill-env (default)              True     False   Creating: Composed resource \"namespace\" is not yet ready\n├─ Object/drill-env-namespace (default)         False    False   ReconcileError: observe failed: cannot get object: namespaces is forbidden: User \"" + XP_SUBJ + "\" cannot get resource \"namespaces\" in API group \"\" at the cluster scope\n├─ Object/drill-env-quota (default)             False    False   ReconcileError: observe failed: cannot get object: resourcequotas is forbidden: User \"" + XP_SUBJ + "\" cannot get resource \"resourcequotas\" in API group \"\" at the cluster scope\n└─ Object/drill-env-limits (default)            False    False   ReconcileError: observe failed: cannot get object: limitranges is forbidden: User \"" + XP_SUBJ + "\" cannot get resource \"limitranges\" in API group \"\" at the cluster scope" },
            { kind: "appenvironments", name: "team-c-dev", ns: "default", api: "platform.lab.local/v1alpha1", cols: ["True", "True", "appenvironment-namespaced", "9d"],
                desc: "Spec:\n  Cpu Quota:     4\n  Team:          team-c\nStatus:\n  Conditions:\n    Status:  True\n    Type:    Ready\n    Status:  True\n    Type:    Synced\n(observed before the outage; its composed Objects now fail to observe too, but the namespace already exists)",
                trace: "NAME                                            SYNCED   READY   STATUS\nAppEnvironment/team-c-dev (default)             True     True    Available\n├─ Object/team-c-dev-namespace (default)        False    True    ReconcileError: observe failed: cannot get object: namespaces is forbidden\n├─ Object/team-c-dev-quota (default)            False    True    ReconcileError: observe failed: cannot get object: resourcequotas is forbidden\n└─ Object/team-c-dev-limits (default)           False    True    ReconcileError: observe failed: cannot get object: limitranges is forbidden" },
            composed("drill-env", "Namespace", "namespace", false), composed("drill-env", "ResourceQuota", "quota", false), composed("drill-env", "LimitRange", "limits", false),
            { kind: "serviceaccounts", name: XP_SA, ns: "crossplane-system", cols: ["0", "12d"] },
            { kind: "serviceaccounts", name: "crossplane", ns: "crossplane-system", cols: ["0", "12d"] },
            { kind: "clusterrolebindings", name: "crossplane", api: "rbac.authorization.k8s.io/v1", cols: ["ClusterRole/crossplane", "12d"] },
            { kind: "clusterrolebindings", name: "crossplane:provider:provider-kubernetes-a1b2c3d4e5f6:system", api: "rbac.authorization.k8s.io/v1", cols: ["ClusterRole/crossplane:provider:provider-kubernetes-a1b2c3d4e5f6:system", "12d"],
                desc: "Role:\n  Kind:  ClusterRole\n  Name:  crossplane:provider:provider-kubernetes-a1b2c3d4e5f6:system\n(Crossplane's own binding: rights over the provider's managed-resource kinds, not over the objects those kinds create)\nSubjects:\n  Kind            Name                                Namespace\n  ServiceAccount  " + XP_SA + "  crossplane-system" },
            { kind: "pods", name: XP_SA + "-7f8d9c6b5-q2w3e", ns: "crossplane-system", cols: ["1/1", "Running", "0", "12d"], labels: "pkg.crossplane.io/provider=provider-kubernetes", container: "package-runtime",
                logs: '2026-09-05T09:32:18Z\tDEBUG\tprovider-kubernetes\tCannot observe external resource\t{"controller": "managed/object.kubernetes.m.crossplane.io", "request": {"name":"drill-env-namespace","namespace":"default"}, "error": "cannot get object: namespaces is forbidden: User \\"' + XP_SUBJ + '\\" cannot get resource \\"namespaces\\" in API group \\"\\" at the cluster scope"}' },
            { kind: "providerconfigs", name: "default", api: "kubernetes.m.crossplane.io/v1alpha1", cols: ["12d"], desc: "Spec:\n  Credentials:\n    Source:  InjectedIdentity" }
        ],
        canI: (function () { var m = {}; m[XP_SUBJ] = { "objects.kubernetes.m.crossplane.io": "*", "providerconfigs.kubernetes.m.crossplane.io": "*" }; return m; })(),
        events: [
            { type: "Warning", reason: "CannotObserveExternalResource", age: "1m (x22 over 20m)", from: "managed/object.kubernetes.m.crossplane.io", obj: "Object/drill-env-namespace", msg: "cannot get object: namespaces is forbidden: User \"" + XP_SUBJ + "\" cannot get resource \"namespaces\" in API group \"\" at the cluster scope" },
            { type: "Normal", reason: "ComposeResources", age: "1m (x22 over 20m)", from: "defined/compositeresourcedefinition.apiextensions.crossplane.io", obj: "AppEnvironment/drill-env", msg: "Successfully composed resources" }
        ],
        evidence: [
            { id: "notready", match: ["^kubectl get appenvironments(,\\S+)?( \\S+)? -n default", "^kubectl describe appenvironments drill-env -n default", "^kubectl get appenvironments drill-env -n default -o (yaml|json|jsonpath\\S*)"], tell: "False", hint: "The XR itself: Synced but not Ready is the composite waiting on something it composed." },
            { id: "forbidden", match: ["^crossplane beta trace appenvironments drill-env( -n default)?", "^kubectl get objects(,\\S+)?( \\S+)? -n default", "^kubectl describe objects( \\S+)? -n default", "^kubectl get objects \\S+ -n default -o (yaml|json|jsonpath\\S*)", "^kubectl logs \\S+ -n crossplane-system"].concat(["^kubectl (get|describe) events -n default"]), tell: "forbidden", hint: "Follow the composite down to what it composed: crossplane beta trace, or the Objects themselves. Their Synced condition carries the error." },
            { id: "binding", match: ["^kubectl get clusterrolebindings", "^kubectl auth can-i \\S+ \\S+( -n \\S+)? --as=" + rx(XP_SUBJ), "^kubectl auth can-i --as=" + rx(XP_SUBJ) + " --list", "^kubectl describe clusterrolebindings( \\S+)?"], tell: "crossplane:provider", hint: "The error names a service account in crossplane-system. List the ClusterRoleBindings for it: the one that granted it cluster-admin over the objects it creates is missing." }
        ],
        fix: ["^kubectl create clusterrolebindings \\S+ --clusterrole=cluster-admin --serviceaccount=crossplane-system:" + XP_SA + "$"],
        fixOut: "clusterrolebinding.rbac.authorization.k8s.io/crossplane-" + XP_SA + " created\n\n$ crossplane beta trace appenvironment drill-env -n default\nNAME                                            SYNCED   READY   STATUS\nAppEnvironment/drill-env (default)              True     True    Available\n├─ Object/drill-env-namespace (default)         True     True    Available\n├─ Object/drill-env-quota (default)             True     True    Available\n└─ Object/drill-env-limits (default)            True     True    Available\n\n$ kubectl get ns team-drill\nNAME         STATUS   AGE\nteam-drill   Active   9s",
        wrong: [
            { match: ["^kubectl create clusterrolebindings \\S+ --clusterrole=cluster-admin --serviceaccount=crossplane-system:crossplane$"], out: "clusterrolebinding.rbac.authorization.k8s.io created\n(bound to Crossplane's core account, which already has what it needs; the provider's pod runs as " + XP_SA + " and is still forbidden)" },
            { match: ["^kubectl create rolebindings \\S+ -n default", "^kubectl create clusterrolebindings \\S+ --clusterrole=(view|edit|admin) "], out: "rolebinding created\n(a namespace-scoped grant, or a role without namespaces and quotas in it: the provider creates cluster-scoped Namespaces and needs cluster-wide rights)" },
            { match: ["^kubectl create namespaces team-drill", "^kubectl create resourcequotas"], out: "namespace/team-drill created\n(by hand; the Objects still cannot observe it and the XR never turns Ready, and the next environment anyone requests fails the same way)" },
            { match: ["^kubectl delete appenvironments drill-env", "^kubectl (delete|rollout restart) (pods|deployments) \\S+ -n crossplane-system"], out: "(recreating the request or restarting the provider changes nothing: the permissions are gone, not the pod)" },
            { match: ["^kubectl patch (objects|appenvironments) \\S+ -n default"], out: "patched\n(the spec is right; the controller cannot act on it)" }
        ]
    });
    SCENARIOS.push({
        id: "xr-paused", name: "Frozen Composite", d: 3, difficulty: 2, ns: "default",
        ticket: "team-c: we asked for a cpu quota bump on our AppEnvironment yesterday. The edit is visible on the XR but the actual ResourceQuota in our namespace never changed.",
        answer: "the XR team-c-dev carries the crossplane.io/paused=true annotation, so Crossplane skips reconciliation entirely (Synced=False, reason ReconcilePaused) and the cpuQuota change never reaches the ResourceQuota. Fix: remove the annotation.",
        resources: [
            { kind: "namespaces", name: "default", cols: ["Active", "12d"] },
            { kind: "namespaces", name: "team-c", cols: ["Active", "9d"], labels: "kubernetes.io/metadata.name=team-c,tenant=team-c" },
            { kind: "appenvironments", name: "team-c-dev", ns: "default", api: "platform.lab.local/v1alpha1", cols: ["False", "True", "appenvironment-namespaced", "9d"],
                annotations: "crossplane.io/paused=true",
                desc: "Spec:\n  Cpu Quota:     6\n  Memory Quota:  8Gi\n  Team:          team-c\n  Crossplane:\n    Composition Ref:\n      Name:  appenvironment-namespaced\n    Resource Refs:\n      Kind:  Object\n      Name:  team-c-dev-namespace\n      Kind:  Object\n      Name:  team-c-dev-quota\n      Kind:  Object\n      Name:  team-c-dev-limits\nStatus:\n  Conditions:\n    Last Transition Time:  2026-09-04T16:20:41Z\n    Message:               Reconciliation is paused via the pause annotation\n    Reason:                ReconcilePaused\n    Status:                False\n    Type:                  Synced\n    Reason:                Available\n    Status:                True\n    Type:                  Ready",
                yaml: "spec:\n  cpuQuota: \"6\"\n  memoryQuota: 8Gi\n  team: team-c\n  crossplane:\n    compositionRef:\n      name: appenvironment-namespaced\nstatus:\n  conditions:\n  - lastTransitionTime: \"2026-09-04T16:20:41Z\"\n    message: Reconciliation is paused via the pause annotation\n    reason: ReconcilePaused\n    status: \"False\"\n    type: Synced\n  - reason: Available\n    status: \"True\"\n    type: Ready",
                fields: { ".spec.cpuQuota": "6", ".status.conditions[?(@.type==\"Synced\")].reason": "ReconcilePaused", ".status.conditions[?(@.type==\"Synced\")].status": "False", ".metadata.annotations": "map[crossplane.io/paused:true]" },
                trace: "NAME                                            SYNCED   READY   STATUS\nAppEnvironment/team-c-dev (default)             False    True    ReconcilePaused: Reconciliation is paused via the pause annotation\n├─ Object/team-c-dev-namespace (default)        True     True    Available\n├─ Object/team-c-dev-quota (default)            True     True    Available\n└─ Object/team-c-dev-limits (default)           True     True    Available" },
            composed("team-c-dev", "Namespace", "namespace", true),
            (function () { var o = composed("team-c-dev", "ResourceQuota", "quota", true); o.desc = "Spec:\n  For Provider:\n    Manifest:\n      Spec:\n        Hard:\n          requests.cpu:  4        (the composite says 6; the Object was last rendered before the pause)\n" + o.desc; return o; })(),
            composed("team-c-dev", "LimitRange", "limits", true),
            { kind: "resourcequotas", name: "tenant-quota", ns: "team-c", cols: ["9d", "requests.cpu: 1250m/4, requests.memory: 2Gi/8Gi", ""],
                desc: "Resource         Used   Hard\n--------         ----   ----\nrequests.cpu     1250m  4\nrequests.memory  2Gi    8Gi",
                yaml: "spec:\n  hard:\n    requests.cpu: \"4\"\n    requests.memory: 8Gi", fields: { ".spec.hard.requests\\.cpu": "4", ".spec.hard": "map[requests.cpu:4 requests.memory:8Gi]" } },
            { kind: "compositions", name: "appenvironment-namespaced", api: "apiextensions.crossplane.io/v1", cols: ["12d"] }
        ],
        events: [
            { type: "Normal", reason: "ReconcilePaused", age: "17h", from: "defined/compositeresourcedefinition.apiextensions.crossplane.io", obj: "AppEnvironment/team-c-dev", msg: "Reconciliation is paused via the pause annotation" }
        ],
        evidence: [
            { id: "mismatch", match: ["^kubectl (get|describe) resourcequotas( tenant-quota)? -n team-c", "^kubectl get resourcequotas tenant-quota -n team-c -o (yaml|json|jsonpath\\S*)", "^kubectl get appenvironments team-c-dev -n default -o jsonpath=\\S*cpuquota\\S*"], tell: "4", hint: "Confirm the two numbers disagree: the quota in team-c against the cpuQuota on the XR." },
            { id: "paused", match: ["^kubectl describe appenvironments team-c-dev -n default", "^kubectl get appenvironments team-c-dev -n default -o (yaml|json|jsonpath\\S*(conditions|annotations)\\S*)", "^crossplane beta trace appenvironments team-c-dev( -n default)?", "^kubectl get appenvironments(,\\S+)?( team-c-dev)? -n default$"].concat(["^kubectl (get|describe) events -n default"]), tell: "ReconcilePaused", hint: "describe the XR and read two places: the conditions at the bottom, and the annotations at the top." },
            { id: "objects", match: ["^kubectl get objects(,\\S+)?( \\S+)? -n default", "^kubectl describe objects team-c-dev-quota -n default", "^kubectl get objects team-c-dev-quota -n default -o (yaml|json)"], tell: "team-c-dev-quota", hint: "The composed Objects are healthy and stale: nothing re-rendered them, because nothing reconciled the composite." }
        ],
        fix: ["^kubectl annotate appenvironments team-c-dev crossplane\\.io/paused- -n default", "^kubectl annotate appenvironments team-c-dev crossplane\\.io/paused=false -n default --overwrite", "^kubectl patch appenvironments team-c-dev -n default .*\"crossplane\\.io/paused\":(null|\"false\")", "^kubectl patch appenvironments team-c-dev -n default --type=json -p=\\[\\{\"op\":\"remove\",\"path\":\"/metadata/annotations/crossplane\\.io~1paused\"\\}\\]"],
        fixOut: "appenvironment.platform.lab.local/team-c-dev annotated\n\n$ kubectl -n default get appenvironment team-c-dev\nNAME         SYNCED   READY   COMPOSITION                 AGE\nteam-c-dev   True     True    appenvironment-namespaced   9d\n\n$ kubectl -n team-c get resourcequota tenant-quota -o jsonpath='{.spec.hard.requests\\.cpu}'\n6",
        wrong: [
            { match: ["^kubectl patch resourcequotas tenant-quota -n team-c"], out: "resourcequota/tenant-quota patched\n(by hand, under a composite that owns it: the next reconcile writes the desired state back over it, and the XR is still paused, so nobody notices until it does)" },
            { match: ["^kubectl patch appenvironments team-c-dev -n default .*cpuquota", "^kubectl annotate appenvironments team-c-dev .*paused=true"], out: "appenvironment.platform.lab.local/team-c-dev patched\n(the spec is already what the team asked for; the controller is not looking at it)" },
            { match: ["^kubectl delete appenvironments team-c-dev"], out: "(deleting a paused composite is worse than it sounds: its finalizer waits for a reconcile that never comes, and the request the team made is gone with it)" },
            { match: ["^kubectl annotate objects \\S+ crossplane\\.io/paused-", "^kubectl patch objects"], out: "(the Objects are not paused; the composite above them is)" },
            { match: ["^kubectl (delete|rollout restart) (pods|deployments) \\S+ -n crossplane-system"], out: "(a restarted Crossplane reads the same annotation and pauses the same XR)" }
        ]
    });
    /* ── security: admission ──────────────────────────────────── */
    SCENARIOS.push({
        id: "kyverno-deny", name: "Uninvited Warden", d: 5, difficulty: 2, ns: "team-a",
        ticket: "team-a: nothing deploys any more. Every new pod in our namespace is rejected with some policy error, and nobody on OUR team shipped a policy today.",
        answer: "a cluster-wide Kyverno ValidatingPolicy named drill-deny (Deny action, scoped to the team-a namespace) requires a billing-code label on every pod. The admission webhook rejects the ReplicaSet's pods, so the deployment reports ReplicaFailure while the old pod keeps running. Fix: delete the policy (or add the label the policy demands).",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "validatingpolicies", name: "drill-deny", api: "policies.kyverno.io/v1", cols: ["True", "True", "True", "12m", "Ready"],
                desc: "Spec:\n  Match Constraints:\n    Namespace Selector:\n      Match Labels:\n        tenant:  team-a\n    Resource Rules:\n      API Groups:\n      API Versions:  v1\n      Operations:    CREATE\n      Resources:     pods\n  Validation Actions:  Deny\n  Validations:\n    Expression:  has(object.metadata.labels) && 'billing-code' in object.metadata.labels\n    Message:     every pod needs a billing-code label (policy drill-deny)",
                yaml: "spec:\n  matchConstraints:\n    namespaceSelector:\n      matchLabels:\n        tenant: team-a\n    resourceRules:\n    - apiGroups: [\"\"]\n      apiVersions: [v1]\n      operations: [CREATE]\n      resources: [pods]\n  validationActions: [Deny]\n  validations:\n  - expression: has(object.metadata.labels) && 'billing-code' in object.metadata.labels\n    message: every pod needs a billing-code label (policy drill-deny)" },
            { kind: "validatingpolicies", name: "require-requests", api: "policies.kyverno.io/v1", cols: ["True", "True", "True", "12d", "Ready"], desc: "Validation Actions:  Audit\n(the platform's own policy; it audits, it does not deny)" },
            { kind: "clusterpolicies", name: "disallow-latest-tag", api: "kyverno.io/v1", cols: ["Audit", "true", "True", "12d", "Ready"] }
        ], workload({
            ready: "1/1", upd: "0", avail: "1", rsReady: "1", podCols: ["1/1", "Running", "0", "1h"], dep: "1 desired | 0 updated | 1 total | 1 available | 0 unavailable",
            rsName: "broken-5c8d7b6f9", podName: OLD_POD,
            conds: "  Available      True    MinimumReplicasAvailable\n  Progressing    True    ReplicaSetUpdated\n  ReplicaFailure True    FailedCreate",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    State:          Running\n    Ready:          True",
            logs: "/docker-entrypoint.sh: Configuration complete; ready for start up",
            extraPods: [{ kind: "replicasets", name: "broken-6b7f9c4d8", ns: "team-a", api: "apps/v1", cols: ["1", "0", "0", "12m"], labels: "app=broken,pod-template-hash=6b7f9c4d8",
                    desc: "Selector:       app=broken,pod-template-hash=6b7f9c4d8\nControlled By:  Deployment/broken\nReplicas:       0 current / 1 desired\nPods Status:    0 Running / 0 Waiting / 0 Succeeded / 0 Failed\nConditions:\n  Type             Status  Reason\n  ----             ------  ------\n  ReplicaFailure   True    FailedCreate" }]
        })),
        events: [
            { type: "Warning", reason: "FailedCreate", age: "31s (x17 over 12m)", from: "replicaset-controller", obj: "ReplicaSet/broken-6b7f9c4d8", msg: "Error creating: admission webhook \"vpol.validate.kyverno.svc-fail\" denied the request: Policy drill-deny failed: every pod needs a billing-code label (policy drill-deny)" },
            { type: "Normal", reason: "ScalingReplicaSet", age: "12m", from: "deployment-controller", obj: "Deployment/broken", msg: "Scaled up replica set broken-6b7f9c4d8 from 0 to 1" }
        ],
        evidence: [
            { id: "stuck", match: GET_PODS, tell: "0", hint: "The old pod is Running, the new ReplicaSet has zero: something between the controller and the pod says no." },
            { id: "denied", match: DESCRIBE_RS.concat(EVENTS), tell: "drill-deny", hint: "An admission denial lands as a FailedCreate event on the ReplicaSet, and it names the policy." },
            { id: "policy", match: ["^kubectl get validatingpolicies", "^kubectl describe validatingpolicies", "^kubectl get (clusterpolicies|policies|policyreports)"], tell: "drill-deny", hint: "Kyverno's policies are cluster resources: kubectl get validatingpolicies, then read the one the event named." }
        ],
        fix: ["^kubectl delete validatingpolicies drill-deny", "^kubectl patch deployments broken -n team-a .*\"labels\":\\{[^}]*\"billing-code\":\"[^\"]+\"", "^kubectl patch validatingpolicies drill-deny .*\"validationactions\":\\[\"audit\"\\]"],
        fixOut: "validatingpolicy.policies.kyverno.io \"drill-deny\" deleted\n\n$ kubectl -n team-a get deploy broken\nNAME     READY   UP-TO-DATE   AVAILABLE   AGE\nbroken   1/1     1            1           1h",
        wrong: [
            { match: ["^kubectl delete validatingpolicies (require-requests|--all)", "^kubectl delete clusterpolicies"], out: "deleted\n(that was the platform's own policy, and it only audited; drill-deny is still denying)" },
            { match: ["^kubectl label pods \\S+ -n team-a billing-code=", "^kubectl label replicasets"], out: "pod/" + OLD_POD + " labeled\n(the running pod does not need the label; the pods the ReplicaSet tries to create do, and they get it from the Deployment's template)" },
            { match: RESTART, out: "(every new pod is denied at admission; the old one is the only thing serving, and now it is gone too)" },
            { match: ["^kubectl (delete|scale|rollout restart) deployments \\S+ -n kyverno", "^kubectl delete (pods|deployments) \\S+ -n kyverno"], out: "(taking the admission controller down opens the whole cluster to unchecked pods; the fix is the one policy, not the engine)" },
            { match: ["^kubectl label namespaces team-a tenant-"], out: "namespace/team-a unlabeled\n(the policy no longer matches team-a, and neither does the platform's quota automation or the network policy generator: a fix that breaks three other things)" }
        ]
    });
    SCENARIOS.push({
        id: "pss-restricted", name: "Iron Gatekeeper", d: 5, difficulty: 2, ns: "team-a",
        ticket: "team-a: after this morning's 'security hardening' change our app cannot start new pods. The old pod is still running; replacements never come up.",
        answer: "the namespace was flipped to pod-security.kubernetes.io/enforce=restricted while the pod's securityContext was stripped at the same time. The PodSecurity admission controller rejects every new pod ('violates PodSecurity restricted:latest'). Fix: restore a restricted-compliant securityContext (runAsNonRoot, seccompProfile, allowPrivilegeEscalation=false, drop ALL); break-fix also puts the enforce label back to baseline.",
        resources: tenancy("restricted").concat([dnsPolicy(false)], workload({
            ready: "1/1", upd: "0", avail: "1", rsReady: "1", podCols: ["1/1", "Running", "0", "1h"], dep: "1 desired | 0 updated | 1 total | 1 available | 0 unavailable",
            rsName: "broken-5c8d7b6f9", podName: OLD_POD,
            conds: "  Available      True    MinimumReplicasAvailable\n  Progressing    True    ReplicaSetUpdated\n  ReplicaFailure True    FailedCreate",
            tpl: "  containers:\n  - image: " + IMG + "\n    name: nginx-unprivileged\n    ports:\n    - containerPort: 8080\n    resources:\n      requests:\n        cpu: 25m\n        memory: 32Mi",
            podDesc: "Containers:\n  nginx-unprivileged:\n    Image:          " + IMG + "\n    State:          Running\n    Ready:          True\n    Security Context:\n      allowPrivilegeEscalation:  false\n      capabilities:  drop [ALL]\n(this is the old pod, from the template before the change)",
            logs: "/docker-entrypoint.sh: Configuration complete; ready for start up",
            extraPods: [{ kind: "replicasets", name: "broken-6b7f9c4d8", ns: "team-a", api: "apps/v1", cols: ["1", "0", "0", "24m"], labels: "app=broken,pod-template-hash=6b7f9c4d8",
                    desc: "Selector:       app=broken,pod-template-hash=6b7f9c4d8\nControlled By:  Deployment/broken\nReplicas:       0 current / 1 desired\nConditions:\n  Type             Status  Reason\n  ----             ------  ------\n  ReplicaFailure   True    FailedCreate" }]
        })),
        events: [
            { type: "Warning", reason: "FailedCreate", age: "40s (x22 over 24m)", from: "replicaset-controller", obj: "ReplicaSet/broken-6b7f9c4d8", msg: 'Error creating: pods "broken-6b7f9c4d8-h7t4c" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "nginx-unprivileged" must set securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "nginx-unprivileged" must set securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true (pod or container "nginx-unprivileged" must set securityContext.runAsNonRoot=true), seccompProfile (pod or container "nginx-unprivileged" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")' },
            { type: "Normal", reason: "ScalingReplicaSet", age: "24m", from: "deployment-controller", obj: "Deployment/broken", msg: "Scaled up replica set broken-6b7f9c4d8 from 0 to 1" }
        ],
        evidence: [
            { id: "stuck", match: GET_PODS, tell: "0", hint: "A new ReplicaSet with zero pods and an old one still serving: the replacement is being refused." },
            { id: "violates", match: DESCRIBE_RS.concat(EVENTS), tell: "violates PodSecurity", hint: "The ReplicaSet's FailedCreate event is the whole diagnosis: which profile, and each field that violates it." },
            { id: "label", match: ["^kubectl get namespaces team-a --show-labels", "^kubectl get namespaces team-a -o (yaml|json|jsonpath\\S*)", "^kubectl describe namespaces team-a", "^kubectl get namespaces --show-labels"], tell: "enforce=restricted", hint: "Pod Security is a namespace label. Read team-a's: enforce used to say baseline." }
        ],
        fix: ["^kubectl patch deployments broken -n team-a .*\"runasnonroot\":true.*\"seccompprofile\".*\"allowprivilegeescalation\":false.*\"drop\":\\[\"all\"\\]", "^kubectl patch deployments broken -n team-a .*\"allowprivilegeescalation\":false.*\"drop\":\\[\"all\"\\].*\"runasnonroot\":true.*\"seccompprofile\"", "^kubectl patch deployments broken -n team-a (?=.*\"runasnonroot\":true)(?=.*\"seccompprofile\")(?=.*\"allowprivilegeescalation\":false)(?=.*\"drop\":\\[\"all\"\\])", "^kubectl label namespaces team-a pod-security\\.kubernetes\\.io/enforce=baseline --overwrite"],
        fixOut: "deployment.apps/broken patched\n\n$ kubectl -n team-a get pods\nNAME                      READY   STATUS    RESTARTS   AGE\nbroken-8f9e7d6c5-v2b7n    1/1     Running   0          7s",
        wrong: [
            { match: ["^kubectl label namespaces team-a pod-security\\.kubernetes\\.io/enforce=privileged", "^kubectl label namespaces team-a pod-security\\.kubernetes\\.io/enforce-"], out: "namespace/team-a labeled\n(the pods come up, with no Pod Security at all in a tenant namespace; the tenancy model was baseline, and the app can meet restricted anyway)" },
            { match: ["^kubectl patch deployments broken -n team-a (?!.*\"runasnonroot\":true)(?=.*(\"allowprivilegeescalation\"|\"drop\"|\"seccompprofile\"))", "^kubectl patch deployments broken -n team-a (?=.*\"runasnonroot\":true)(?!.*\"seccompprofile\")"], out: "deployment.apps/broken patched\n\n$ kubectl -n team-a describe rs broken-9a8b7c6d5 | tail -1\n  Warning  FailedCreate  2s  replicaset-controller  Error creating: pods \"broken-9a8b7c6d5-x\" is forbidden: violates PodSecurity \"restricted:latest\": (fewer violations, still some; restricted wants all four)" },
            { match: ["^kubectl label namespaces team-a pod-security\\.kubernetes\\.io/(audit|warn)="], out: "namespace/team-a labeled\n(audit and warn do not block; enforce does, and it still says restricted)" },
            { match: RESTART, out: "(the old pod is the only one serving; a new one is refused at admission)" }
        ]
    });
    /* ── the quest's own faults, so every domain has dungeons ─── */
    var WEB_POD = "web-7d4f8c9b6-n3k7p", WEB_POD2 = "web-7d4f8c9b6-r8m2q";
    function webPods(labels) {
        return [WEB_POD, WEB_POD2].map(function (n) {
            return { kind: "pods", name: n, ns: "team-a", cols: ["1/1", "Running", "0", "2h"], labels: labels + ",pod-template-hash=7d4f8c9b6", owner: "web", container: "web",
                wide: ["10.244.1." + (n === WEB_POD ? "51" : "52"), "cnpe-worker"], wideCols: ["IP", "NODE"], logs: "/docker-entrypoint.sh: Configuration complete; ready for start up", exec: { "8080": "HTTP/1.1 200 OK" } };
        });
    }
    SCENARIOS.push({
        id: "svc-selector", name: "Hollow Beacon", d: 1, difficulty: 1, ns: "team-a",
        ticket: "team-a: our web Service resolves in DNS and every connection is refused. The pods are Running, we checked. It broke right after someone renamed the app label.",
        answer: "Service web selects app=web, but the Deployment's pods are labelled app=web-frontend, so the EndpointSlice is empty and connections go nowhere. Fix: make the Service's selector match the pod labels (or the labels match the selector).",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "services", name: "web", ns: "team-a", cols: ["ClusterIP", "10.96.77.30", "<none>", "80/TCP", "2h"], labels: "app=web",
                desc: "Selector:          app=web\nType:              ClusterIP\nIP:                10.96.77.30\nPort:              http  80/TCP\nTargetPort:        8080/TCP\nEndpoints:         <none>\nSession Affinity:  None",
                yaml: "spec:\n  clusterIP: 10.96.77.30\n  ports:\n  - name: http\n    port: 80\n    protocol: TCP\n    targetPort: 8080\n  selector:\n    app: web\n  type: ClusterIP", fields: { ".spec.selector": "map[app:web]", ".spec.selector.app": "web" } },
            { kind: "endpointslices", name: "web-k9x2m", ns: "team-a", cols: ["IPv4", "<unset>", "<unset>", "2h"], labels: "kubernetes.io/service-name=web,endpointslice.kubernetes.io/managed-by=endpointslice-controller.k8s.io" },
            { kind: "endpoints", name: "web", ns: "team-a", cols: ["<none>", "2h"] },
            { kind: "deployments", name: "web", ns: "team-a", api: "apps/v1", cols: ["2/2", "2", "2", "2h"], labels: "app=web-frontend",
                desc: "Selector:               app=web-frontend\nReplicas:               2 desired | 2 updated | 2 total | 2 available | 0 unavailable\nPod Template:\n  Labels:  app=web-frontend\n  Containers:\n   web:\n    Image:        " + IMG + "\n    Port:         8080/TCP",
                yaml: "spec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app: web-frontend\n  template:\n    metadata:\n      labels:\n        app: web-frontend\n    spec:\n      containers:\n      - image: " + IMG + "\n        name: web\n        ports:\n        - containerPort: 8080", fields: { ".spec.template.metadata.labels": "map[app:web-frontend]", ".spec.selector.matchLabels.app": "web-frontend" } }
        ], webPods("app=web-frontend")),
        events: [],
        evidence: [
            { id: "empty", match: ["^kubectl describe services web -n team-a", "^kubectl get (endpointslices|endpoints)(,\\S+)?( \\S+)? -n team-a", "^kubectl get services web -n team-a -o (yaml|json|jsonpath\\S*)"], tell: "<none>", hint: "A Service is a selector and a list of endpoints. Describe it: are there any?" },
            { id: "labels", match: ["^kubectl get pods(,\\S+)? -n team-a --show-labels", "^kubectl get pods -n team-a -o (yaml|json|wide --show-labels|jsonpath\\S*labels\\S*)", "^kubectl describe pods web\\S* -n team-a", "^kubectl get pods -n team-a -l app=web$", "^kubectl describe deployments web -n team-a", "^kubectl get deployments web -n team-a -o (yaml|json|jsonpath\\S*)"], tell: "app=web-frontend", hint: "Put the pods' labels beside the Service's selector. kubectl get pods --show-labels, or -l with the selector to see whether it matches anything." },
            { id: "running", match: GET_PODS.concat(["^kubectl exec \\S+ -n team-a( -c \\S+)? -- .*8080"]), tell: "Running", hint: "Confirm the pods themselves are fine: Running, Ready, answering on their port. Then the fault is in the wiring, not the app." }
        ],
        fix: ["^kubectl patch services web -n team-a .*\"selector\":\\{\"app\":\"web-frontend\"\\}", "^kubectl patch deployments web -n team-a (?=.*\"matchlabels\":\\{\"app\":\"web\"\\})(?=.*\"labels\":\\{\"app\":\"web\"\\})", "^kubectl label pods app=web -n team-a (?=.*(-l app=web-frontend|--all))", "^kubectl label pods( web-7d4f8c9b6-\\S+)+ app=web -n team-a"],
        fixOut: "service/web patched\n\n$ kubectl -n team-a get endpointslices -l kubernetes.io/service-name=web\nNAME        ADDRESSTYPE   PORTS   ENDPOINTS                   AGE\nweb-k9x2m   IPv4          8080    10.244.1.51,10.244.1.52     2h",
        wrong: [
            { match: ["^kubectl patch deployments web -n team-a (?=.*\"matchlabels\")(?!.*\"labels\":\\{\"app\":\"web\"\\})", "^kubectl patch deployments web -n team-a .*\"matchlabels\":\\{\"app\":\"web\"\\}"], out: "The Deployment \"web\" is invalid: spec.selector: Invalid value: field is immutable\n(a Deployment's selector cannot change in place, and the template labels must match it anyway; change the Service's selector instead)" },
            { match: ["^kubectl patch services web -n team-a .*\"selector\":\\{\"app\":\"(?!web-frontend)[^\"]+\"\\}"], out: "service/web patched\n(a selector that matches no pod still gives an empty EndpointSlice)" },
            { match: ["^kubectl (delete pods|rollout restart)", "^kubectl scale deployments web"], out: "(new pods with the same labels are still not what the Service selects)" },
            { match: ["^kubectl patch services web -n team-a .*\"targetport\"", "^kubectl patch services web -n team-a .*\"port\":8080"], out: "service/web patched\n(ports only matter once there are endpoints; the slice is still empty)" },
            { match: ["^kubectl delete services web", "^kubectl expose deployments web"], out: "(a new Service by the same name has the same problem unless its selector matches; expose would work but drops the ClusterIP clients have cached)" }
        ]
    });
    SCENARIOS.push({
        id: "pvc-pending", name: "Patient Vault", d: 1, difficulty: 1, ns: "team-a",
        ticket: "team-a: we created a PVC for our reports job an hour ago and it is still Pending with no volume. The StorageClass is the cluster default. Is the provisioner broken?",
        answer: "PVC reports uses StorageClass standard, whose volumeBindingMode is WaitForFirstConsumer: it stays Pending, by design, until a pod that mounts it is scheduled. Nothing is broken. Fix: create the pod that uses the claim (or, if the team really needs eager binding, use a class with Immediate mode).",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "persistentvolumeclaims", name: "reports", ns: "team-a", cols: ["Pending", "", "", "", "standard", "1h"],
                desc: "StorageClass:  standard\nStatus:        Pending\nVolume:\nCapacity:\nAccess Modes:\nVolumeMode:    Filesystem\nUsed By:       <none>",
                yaml: "spec:\n  accessModes:\n  - ReadWriteOnce\n  resources:\n    requests:\n      storage: 1Gi\n  storageClassName: standard\n  volumeMode: Filesystem\nstatus:\n  phase: Pending", fields: { ".status.phase": "Pending", ".spec.storageClassName": "standard" } },
            { kind: "persistentvolumeclaims", name: "cache", ns: "team-a", cols: ["Bound", "pvc-3f1a9c2e-7b4d-4e8f-9a1b-2c3d4e5f6a7b", "2Gi", "RWO", "standard", "9d"],
                desc: "StorageClass:  standard\nStatus:        Bound\nUsed By:       cache-0" },
            { kind: "storageclasses", name: "standard", api: "storage.k8s.io/v1", cols: ["rancher.io/local-path", "Delete", "WaitForFirstConsumer", "false", "12d"], annotations: "storageclass.kubernetes.io/is-default-class=true",
                desc: "IsDefaultClass:        Yes\nProvisioner:           rancher.io/local-path\nReclaimPolicy:         Delete\nVolumeBindingMode:     WaitForFirstConsumer\nAllowVolumeExpansion:  <unset>",
                yaml: "provisioner: rancher.io/local-path\nreclaimPolicy: Delete\nvolumeBindingMode: WaitForFirstConsumer", fields: { ".volumeBindingMode": "WaitForFirstConsumer" } },
            { kind: "storageclasses", name: "fast-immediate", api: "storage.k8s.io/v1", cols: ["rancher.io/local-path", "Retain", "Immediate", "true", "12d"] },
            { kind: "pods", name: "cache-0", ns: "team-a", cols: ["1/1", "Running", "0", "9d"], labels: "app=cache", logs: "ready to accept connections" },
            { kind: "pods", name: "local-path-provisioner-8c9d7f6b5-t2x4w", ns: "local-path-storage", cols: ["1/1", "Running", "0", "12d"], labels: "app=local-path-provisioner", logs: 'time="2026-09-05T09:50:01Z" level=info msg="Provisioner started"\n(no request for team-a/reports has arrived: a WaitForFirstConsumer claim is not handed to the provisioner until a pod is scheduled)' },
            { kind: "deployments", name: "local-path-provisioner", ns: "local-path-storage", api: "apps/v1", cols: ["1/1", "1", "1", "12d"] }
        ]),
        events: [
            { type: "Normal", reason: "WaitForFirstConsumer", age: "12s (x241 over 1h)", from: "persistentvolume-controller", obj: "PersistentVolumeClaim/reports", msg: "waiting for first consumer to be created before binding" }
        ],
        evidence: [
            { id: "pending", match: ["^kubectl get persistentvolumeclaims(,\\S+)?( \\S+)? -n team-a", "^kubectl get persistentvolumeclaims -A"], tell: "Pending", hint: "Start with the claim: Pending, no volume, and which class it asked for." },
            { id: "waiting", match: ["^kubectl describe persistentvolumeclaims( reports)? -n team-a"].concat(EVENTS), tell: "waiting for first consumer", hint: "The claim's events say exactly what it is waiting for. It is not an error." },
            { id: "mode", match: ["^kubectl (get|describe) storageclasses( standard)?", "^kubectl get storageclasses standard -o (yaml|json|jsonpath\\S*)"], tell: "WaitForFirstConsumer", hint: "Read the StorageClass's volumeBindingMode. That one word is the whole ticket." }
        ],
        fix: ["^kubectl run \\S+ .*-n team-a", "^kubectl run \\S+ -n team-a", "^kubectl create (deployments|job|jobs|cronjob|cronjobs) \\S+ -n team-a", "^kubectl create (deployments|job|jobs) \\S+ .*-n team-a", "^kubectl patch persistentvolumeclaims reports -n team-a .*\"storageclassname\":\"fast-immediate\""],
        fixOut: "pod/reports-job created\n\n$ kubectl -n team-a get pvc reports\nNAME      STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE\nreports   Bound    pvc-9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b   1Gi        RWO            standard       1h\n\n(the first consumer arrived, the scheduler picked its node, the provisioner made the volume there: WaitForFirstConsumer working as designed)",
        wrong: [
            { match: ["^kubectl (delete|rollout restart) (pods|deployments) \\S+ -n local-path-storage"], out: "(the provisioner was never asked; restarting it changes nothing about a claim the scheduler has not handed over)" },
            { match: ["^kubectl delete persistentvolumeclaims reports", "^kubectl patch persistentvolumeclaims reports -n team-a .*(\"storage\"|\"accessmodes\")"], out: "(a new or resized claim on the same class waits for the same first consumer)" },
            { match: ["^kubectl patch storageclasses standard .*volumebindingmode"], out: "The StorageClass \"standard\" is invalid: volumeBindingMode: Forbidden: updates to volumeBindingMode are forbidden\n(and switching the cluster default to Immediate would provision volumes in zones pods cannot reach; the class is right, the expectation was wrong)" },
            { match: ["^kubectl patch persistentvolumeclaims reports -n team-a .*\"storageclassname\":\"standard\""], out: "The PersistentVolumeClaim \"reports\" is invalid: spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims" },
            { match: ["^kubectl create persistentvolumes", "^kubectl patch persistentvolumeclaims reports -n team-a .*\"volumename\""], out: "(a hand-made PersistentVolume for a dynamic class is the kind of fix that has to be undone later; the claim binds on its own once a pod uses it)" }
        ]
    });
    SCENARIOS.push({
        id: "hpa-unknown", name: "Blindfolded Scaler", d: 1, difficulty: 2, ns: "team-a",
        ticket: "team-a: our HorizontalPodAutoscaler has said <unknown>/60% for a day and never scales. Load tests peg the CPU and nothing happens.",
        answer: "HPA web targets 60% CPU, but the web Deployment's container declares no CPU request, so a utilisation percentage cannot be computed: the HPA reports FailedGetResourceMetric / missing request for cpu. Fix: set a CPU request on the container (kubectl set resources).",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "horizontalpodautoscalers", name: "web", ns: "team-a", api: "autoscaling/v2", cols: ["Deployment/web", "cpu: <unknown>/60%", "2", "6", "2", "1d"],
                desc: "Reference:                                             Deployment/web\nMetrics:                                               ( current / target )\n  resource cpu on pods  (as a percentage of request):  <unknown> / 60%\nMin replicas:                                          2\nMax replicas:                                          6\nDeployment pods:                                       2 current / 2 desired\nConditions:\n  Type            Status  Reason                   Message\n  ----            ------  ------                   -------\n  AbleToScale     True    SucceededGetScale        the HPA controller was able to get the target's current scale\n  ScalingActive   False   FailedGetResourceMetric  the HPA was unable to compute the replica count: failed to get cpu utilization: missing request for cpu in container web of Pod web-7d4f8c9b6-n3k7p",
                yaml: "spec:\n  maxReplicas: 6\n  metrics:\n  - resource:\n      name: cpu\n      target:\n        averageUtilization: 60\n        type: Utilization\n    type: Resource\n  minReplicas: 2\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: web\nstatus:\n  conditions:\n  - reason: SucceededGetScale\n    status: \"True\"\n    type: AbleToScale\n  - message: 'the HPA was unable to compute the replica count: failed to get cpu utilization: missing request for cpu in container web of Pod web-7d4f8c9b6-n3k7p'\n    reason: FailedGetResourceMetric\n    status: \"False\"\n    type: ScalingActive\n  currentReplicas: 2\n  desiredReplicas: 2",
                fields: { ".status.conditions[?(@.type==\"ScalingActive\")].reason": "FailedGetResourceMetric", ".status.conditions[?(@.type==\"ScalingActive\")].message": "the HPA was unable to compute the replica count: failed to get cpu utilization: missing request for cpu in container web of Pod web-7d4f8c9b6-n3k7p" } },
            { kind: "deployments", name: "web", ns: "team-a", api: "apps/v1", cols: ["2/2", "2", "2", "2h"], labels: "app=web",
                desc: "Selector:               app=web\nReplicas:               2 desired | 2 updated | 2 total | 2 available | 0 unavailable\nPod Template:\n  Labels:  app=web\n  Containers:\n   web:\n    Image:        " + IMG + "\n    Port:         8080/TCP\n    Limits:\n      memory:  128Mi\n    Requests:\n      memory:  64Mi",
                yaml: "spec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app: web\n  template:\n    metadata:\n      labels:\n        app: web\n    spec:\n      containers:\n      - image: " + IMG + "\n        name: web\n        ports:\n        - containerPort: 8080\n        resources:\n          limits:\n            memory: 128Mi\n          requests:\n            memory: 64Mi", fields: { ".spec.template.spec.containers[0].resources": "map[limits:map[memory:128Mi] requests:map[memory:64Mi]]", ".spec.template.spec.containers[0].resources.requests": "map[memory:64Mi]" } },
            { kind: "deployments", name: "metrics-server", ns: "kube-system", api: "apps/v1", cols: ["1/1", "1", "1", "12d"] },
            { kind: "pods", name: "metrics-server-6f8d9c7b5-k4j2h", ns: "kube-system", cols: ["1/1", "Running", "0", "12d"], labels: "k8s-app=metrics-server", logs: "I0905 09:51:02.113 scraper.go:140] \"Scraping metrics from nodes\" nodes=3\n(scrapes are healthy; the metrics exist, the percentage does not)" }
        ], webPods("app=web").map(function (p) { p.top = ["412m", "38Mi"]; p.desc = "Containers:\n  web:\n    Image:     " + IMG + "\n    Limits:\n      memory:  128Mi\n    Requests:\n      memory:  64Mi\n    State:     Running\n    Ready:     True\nQoS Class:   Burstable"; return p; })),
        events: [
            { type: "Warning", reason: "FailedGetResourceMetric", age: "9s (x5731 over 1d)", from: "horizontal-pod-autoscaler", obj: "HorizontalPodAutoscaler/web", msg: "failed to get cpu utilization: missing request for cpu in container web of Pod web-7d4f8c9b6-n3k7p" },
            { type: "Warning", reason: "FailedComputeMetricsReplicas", age: "9s (x5731 over 1d)", from: "horizontal-pod-autoscaler", obj: "HorizontalPodAutoscaler/web", msg: "invalid metrics (1 invalid out of 1), first error is: failed to get cpu utilization: missing request for cpu in container web of Pod web-7d4f8c9b6-n3k7p" }
        ],
        evidence: [
            { id: "unknown", match: ["^kubectl get horizontalpodautoscalers(,\\S+)?( \\S+)? -n team-a"], tell: "<unknown>", hint: "The HPA's TARGETS column: <unknown> means it cannot compute the current value, not that the value is zero." },
            { id: "reason", match: ["^kubectl describe horizontalpodautoscalers( web)? -n team-a", "^kubectl get horizontalpodautoscalers web -n team-a -o (yaml|json|jsonpath\\S*)"].concat(EVENTS), tell: "missing request for cpu", hint: "describe the HPA and read the ScalingActive condition: it says what it could not compute, and why." },
            { id: "metrics", match: ["^kubectl top pods(,\\S+)?( \\S+)? -n team-a", "^kubectl get (deployments|pods) \\S+ -n team-a -o (yaml|json|jsonpath\\S*resources\\S*)", "^kubectl describe (deployments web|pods web\\S*)( \\S+)? -n team-a", "^kubectl get (deployments|pods) \\S+ -n (team-a|kube-system) -o yaml"], tell: "memory", hint: "Metrics exist (kubectl top shows CPU), so the metrics pipeline is fine. Look at what the container requests: a percentage of a request needs a request." }
        ],
        fix: ["^kubectl set resources deployments web -n team-a --requests=\\S*cpu=\\d+m?", "^kubectl patch deployments web -n team-a .*\"requests\":\\{[^}]*\"cpu\":\"\\d+m?\"", "^kubectl patch horizontalpodautoscalers web -n team-a .*\"type\":\"averagevalue\""],
        fixOut: "deployment.apps/web resource requirements updated\n\n$ kubectl -n team-a get hpa web\nNAME   REFERENCE        TARGETS        MINPODS   MAXPODS   REPLICAS   AGE\nweb    Deployment/web   cpu: 82%/60%   2         6         3          1d",
        wrong: [
            { match: ["^kubectl set resources deployments web -n team-a --limits=\\S*cpu=\\S+$", "^kubectl set resources deployments web -n team-a --limits=\\S+$"], out: "deployment.apps/web resource requirements updated\n(a limit is not a request; utilisation is measured against the request, and there still is none. Though: with a limit and no request, the request defaults to the limit. Check the pod: if it did, you are done, and if the LimitRange's default took over, it did not)" },
            { match: ["^kubectl (delete|rollout restart) (pods|deployments) \\S+ -n kube-system"], out: "(metrics-server was scraping fine; kubectl top proved it)" },
            { match: ["^kubectl patch horizontalpodautoscalers web -n team-a .*averageutilization", "^kubectl autoscale deployments web", "^kubectl delete horizontalpodautoscalers web"], out: "horizontalpodautoscaler.autoscaling/web patched\n(a different percentage of nothing is still nothing; the request is missing)" },
            { match: ["^kubectl (delete pods|rollout restart deployments web|scale deployments web)"], out: "(new pods with the same template have the same missing request; and scaling by hand is what the HPA was for)" },
            { match: ["^kubectl set resources deployments web -n team-a --requests=memory=\\S+$"], out: "deployment.apps/web resource requirements updated\n(memory was never the metric; the HPA targets cpu)" }
        ]
    });
    /* observability */
    SCENARIOS.push({
        id: "servicemonitor-labels", name: "Unheard Herald", d: 4, difficulty: 2, ns: "monitoring",
        ticket: "team-a: our web app exposes /metrics and we created a ServiceMonitor for it two hours ago. Prometheus shows no target and the dashboard is empty.",
        answer: "ServiceMonitor web selects the Service by label app=web, but the Service carries app=web-frontend, so it matches nothing (and the Prometheus object only picks up ServiceMonitors with release=prometheus, which the monitor also lacks). Fix: label the ServiceMonitor release=prometheus and make its selector match the Service's labels.",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "servicemonitors", name: "web", ns: "team-a", api: "monitoring.coreos.com/v1", cols: ["2h"], labels: "team=team-a",
                desc: "Spec:\n  Endpoints:\n    Interval:  30s\n    Path:      /metrics\n    Port:      http\n  Namespace Selector:\n    Match Names:\n      team-a\n  Selector:\n    Match Labels:\n      app: web",
                yaml: "spec:\n  endpoints:\n  - interval: 30s\n    path: /metrics\n    port: http\n  namespaceSelector:\n    matchNames:\n    - team-a\n  selector:\n    matchLabels:\n      app: web", fields: { ".spec.selector.matchLabels": "map[app:web]", ".metadata.labels": "map[team:team-a]" } },
            { kind: "servicemonitors", name: "prometheus-kube-prometheus-kube-state-metrics", ns: "monitoring", api: "monitoring.coreos.com/v1", cols: ["12d"], labels: "app.kubernetes.io/name=kube-state-metrics,release=prometheus" },
            { kind: "servicemonitors", name: "prometheus-kube-prometheus-node-exporter", ns: "monitoring", api: "monitoring.coreos.com/v1", cols: ["12d"], labels: "app.kubernetes.io/name=prometheus-node-exporter,release=prometheus" },
            { kind: "prometheuses", name: "prometheus-kube-prometheus-prometheus", ns: "monitoring", api: "monitoring.coreos.com/v1", cols: ["2", "12d"], labels: "release=prometheus",
                desc: "Spec:\n  Service Monitor Namespace Selector:  {}\n  Service Monitor Selector:\n    Match Labels:\n      release:  prometheus\n  Pod Monitor Selector:\n    Match Labels:\n      release:  prometheus\nStatus:\n  Available Replicas:  1",
                yaml: "spec:\n  serviceMonitorNamespaceSelector: {}\n  serviceMonitorSelector:\n    matchLabels:\n      release: prometheus", fields: { ".spec.serviceMonitorSelector": "map[matchLabels:map[release:prometheus]]", ".spec.serviceMonitorSelector.matchLabels.release": "prometheus" } },
            { kind: "services", name: "web", ns: "team-a", cols: ["ClusterIP", "10.96.77.30", "<none>", "80/TCP", "2h"], labels: "app=web-frontend",
                desc: "Selector:          app=web-frontend\nType:              ClusterIP\nPort:              http  80/TCP\nTargetPort:        8080/TCP\nEndpoints:         10.244.1.51:8080,10.244.1.52:8080", fields: { ".metadata.labels": "map[app:web-frontend]" } },
            { kind: "deployments", name: "web", ns: "team-a", api: "apps/v1", cols: ["2/2", "2", "2", "2h"], labels: "app=web-frontend" },
            { kind: "pods", name: "prometheus-prometheus-kube-prometheus-prometheus-0", ns: "monitoring", cols: ["2/2", "Running", "0", "12d"], labels: "app.kubernetes.io/name=prometheus,prometheus=prometheus-kube-prometheus-prometheus", container: "prometheus",
                logs: 'ts=2026-09-05T09:52:10.412Z caller=main.go:1240 level=info msg="Completed loading of configuration file" filename=/etc/prometheus/config_out/prometheus.env.yaml\n(no scrape job named team-a/web/0 was generated: the operator never selected that ServiceMonitor)',
                exec: { "targets|api/v1": '{"status":"success","data":{"activeTargets":[{"labels":{"job":"kube-state-metrics"},"health":"up"},{"labels":{"job":"node-exporter"},"health":"up"},{"labels":{"job":"apiserver"},"health":"up"}]}}\n(no target for team-a/web)' } }
        ], webPods("app=web-frontend").map(function (p) { p.exec = { "metrics": "# HELP http_requests_total The total number of HTTP requests.\n# TYPE http_requests_total counter\nhttp_requests_total{code=\"200\"} 18342" }; return p; })),
        events: [],
        evidence: [
            { id: "selector", match: ["^kubectl describe servicemonitors web -n team-a", "^kubectl get servicemonitors web -n team-a -o (yaml|json|jsonpath\\S*)"], tell: "app: web", hint: "Read the ServiceMonitor: which Service labels it selects, and which labels it carries itself." },
            { id: "svc", match: ["^kubectl get services(,\\S+)?( web)? -n team-a --show-labels", "^kubectl get services web -n team-a -o (yaml|json|jsonpath\\S*)", "^kubectl describe services web -n team-a", "^kubectl get services -n team-a -l app=web$", "^kubectl exec \\S+ -n team-a( -c \\S+)? -- .*metrics"], tell: "app=web-frontend", hint: "A ServiceMonitor selects Services, not pods, by label. Compare its matchLabels with the Service's labels (--show-labels)." },
            { id: "release", match: ["^kubectl get servicemonitors(,\\S+)? -A( --show-labels)?", "^kubectl get servicemonitors -n monitoring( --show-labels)?", "^kubectl (get|describe) prometheuses( \\S+)? -n monitoring", "^kubectl get prometheuses \\S+ -n monitoring -o (yaml|json|jsonpath\\S*)", "^kubectl logs \\S+ -n monitoring", "^kubectl exec \\S+ -n monitoring( -c \\S+)? -- .*(targets|api/v1)"], tell: "release", hint: "The Prometheus object itself has a serviceMonitorSelector. The monitors it does scrape all carry a label yours does not." }
        ],
        fix: ["^kubectl patch servicemonitors web -n team-a (?=.*\"release\":\"prometheus\")(?=.*\"matchlabels\":\\{\"app\":\"web-frontend\"\\})", "^kubectl label servicemonitors web release=prometheus -n team-a( --overwrite)?$"],
        fixOut: "servicemonitor.monitoring.coreos.com/web labeled\n\n(one of two: the Prometheus object now selects the monitor. If the monitor's own selector still says app=web, patch it to app=web-frontend as well; a labelled monitor that matches no Service is a scrape job with zero targets)\n\n$ kubectl -n team-a patch servicemonitor web --type merge -p '{\"spec\":{\"selector\":{\"matchLabels\":{\"app\":\"web-frontend\"}}}}'\nservicemonitor.monitoring.coreos.com/web patched\n\n$ kubectl -n monitoring exec prometheus-prometheus-kube-prometheus-prometheus-0 -c prometheus -- wget -qO- localhost:9090/api/v1/targets | grep -c team-a/web\n2",
        wrong: [
            { match: ["^kubectl patch servicemonitors web -n team-a (?!.*\"release\":\"prometheus\").*\"matchlabels\":\\{\"app\":\"web-frontend\"\\}"], out: "servicemonitor.monitoring.coreos.com/web patched\n(the selector matches the Service now, and Prometheus still has no such target: the operator does not select a monitor without release=prometheus on it)" },
            { match: ["^kubectl label services web -n team-a app=web", "^kubectl label services web app=web -n team-a"], out: "service/web labeled\n(the ServiceMonitor's selector matches the Service now; the Prometheus object still does not select the monitor. Half a fix)" },
            { match: ["^kubectl patch prometheuses \\S+ -n monitoring .*servicemonitorselector\":\\{\\}", "^kubectl patch prometheuses \\S+ -n monitoring .*\"servicemonitorselector\":null"], out: "prometheus.monitoring.coreos.com patched\n(every ServiceMonitor in the cluster is now scraped, whoever wrote it, however badly; the platform's convention was one label. Add the label to the monitor)" },
            { match: ["^kubectl (delete|rollout restart) (pods|statefulsets) \\S+ -n monitoring", "^kubectl delete pods prometheus"], out: "(Prometheus reloads its configuration on its own; the configuration never had the target in it)" },
            { match: ["^kubectl create servicemonitors", "^kubectl delete servicemonitors web"], out: "(a new monitor needs the same two things: the release label and a selector that matches the Service)" }
        ]
    });
    SCENARIOS.push({
        id: "alert-never-fires", name: "Mute Bell", d: 4, difficulty: 2, ns: "monitoring",
        ticket: "team-a: our HighErrorRate alert never fires. We pushed a PrometheusRule this morning and the error rate has been over the threshold for an hour. Alertmanager shows nothing.",
        answer: "PrometheusRule team-a-alerts lacks the release=prometheus label the Prometheus object's ruleSelector requires, so the rule was never loaded; and its 'for' is set to 24h, so even loaded it would sit Pending for a day. Fix: label the rule release=prometheus and set 'for' to something like 5m.",
        resources: [
            { kind: "namespaces", name: "monitoring", cols: ["Active", "12d"] },
            { kind: "namespaces", name: "team-a", cols: ["Active", "12d"], labels: "tenant=team-a" },
            { kind: "prometheusrules", name: "team-a-alerts", ns: "team-a", api: "monitoring.coreos.com/v1", cols: ["1h"], labels: "team=team-a",
                desc: "Spec:\n  Groups:\n    Name:  team-a.rules\n    Rules:\n      Alert:  HighErrorRate\n      Expr:   sum(rate(http_requests_total{namespace=\"team-a\",code=~\"5..\"}[5m])) / sum(rate(http_requests_total{namespace=\"team-a\"}[5m])) > 0.05\n      For:    24h\n      Labels:\n        Severity:  critical\n      Annotations:\n        Summary:  team-a error rate above 5%",
                yaml: "spec:\n  groups:\n  - name: team-a.rules\n    rules:\n    - alert: HighErrorRate\n      expr: sum(rate(http_requests_total{namespace=\"team-a\",code=~\"5..\"}[5m])) / sum(rate(http_requests_total{namespace=\"team-a\"}[5m])) > 0.05\n      for: 24h\n      labels:\n        severity: critical\n      annotations:\n        summary: team-a error rate above 5%", fields: { ".metadata.labels": "map[team:team-a]", ".spec.groups[0].rules[0].for": "24h" } },
            { kind: "prometheusrules", name: "prometheus-kube-prometheus-kubernetes-apps", ns: "monitoring", api: "monitoring.coreos.com/v1", cols: ["12d"], labels: "app=kube-prometheus-stack,release=prometheus" },
            { kind: "prometheusrules", name: "prometheus-kube-prometheus-general.rules", ns: "monitoring", api: "monitoring.coreos.com/v1", cols: ["12d"], labels: "app=kube-prometheus-stack,release=prometheus" },
            { kind: "prometheuses", name: "prometheus-kube-prometheus-prometheus", ns: "monitoring", api: "monitoring.coreos.com/v1", cols: ["2", "12d"], labels: "release=prometheus",
                desc: "Spec:\n  Rule Namespace Selector:  {}\n  Rule Selector:\n    Match Labels:\n      release:  prometheus\n  Alerting:\n    Alertmanagers:\n      Name:  prometheus-kube-prometheus-alertmanager\n      Port:  http-web",
                yaml: "spec:\n  ruleNamespaceSelector: {}\n  ruleSelector:\n    matchLabels:\n      release: prometheus", fields: { ".spec.ruleSelector": "map[matchLabels:map[release:prometheus]]", ".spec.ruleSelector.matchLabels.release": "prometheus" } },
            { kind: "configmaps", name: "prometheus-prometheus-kube-prometheus-prometheus-rulefiles-0", ns: "monitoring", cols: ["31", "12d"], desc: "Data\n====\nmonitoring-prometheus-kube-prometheus-general.rules.yaml\nmonitoring-prometheus-kube-prometheus-kubernetes-apps.yaml\n... (31 files, none of them from team-a)" },
            { kind: "pods", name: "prometheus-prometheus-kube-prometheus-prometheus-0", ns: "monitoring", cols: ["2/2", "Running", "0", "12d"], labels: "app.kubernetes.io/name=prometheus", container: "prometheus",
                logs: 'ts=2026-09-05T09:53:40.118Z caller=manager.go:1010 level=info component="rule manager" msg="Starting rule manager..."\nts=2026-09-05T09:53:40.220Z caller=main.go:1240 level=info msg="Completed loading of configuration file"\n(the rule files mounted are the 31 the operator selected; team-a.rules is not among them)',
                exec: { "rules|api/v1": '{"status":"success","data":{"groups":[{"name":"general.rules"},{"name":"kubernetes-apps"},{"name":"node-exporter"}]}}\n(no group named team-a.rules)', "alerts": '{"status":"success","data":{"alerts":[{"labels":{"alertname":"Watchdog","severity":"none"},"state":"firing"}]}}' } },
            { kind: "pods", name: "alertmanager-prometheus-kube-prometheus-alertmanager-0", ns: "monitoring", cols: ["2/2", "Running", "0", "12d"], labels: "app.kubernetes.io/name=alertmanager", container: "alertmanager", logs: 'ts=2026-09-05T09:53:41Z level=info msg="Completed loading of configuration file"', exec: { "alerts|api/v2": '[{"labels":{"alertname":"Watchdog"},"status":{"state":"active"}}]\n(Watchdog only: nothing from team-a has ever reached Alertmanager)' } }
        ],
        events: [],
        evidence: [
            { id: "rule", match: ["^kubectl describe prometheusrules team-a-alerts -n team-a", "^kubectl get prometheusrules team-a-alerts -n team-a -o (yaml|json|jsonpath\\S*)"], tell: "24h", hint: "Read the rule as Prometheus would: the expr, the labels on the object, and the for clause." },
            { id: "notloaded", match: ["^kubectl exec \\S+ -n monitoring( -c \\S+)? -- .*(rules|alerts|api/v1|api/v2)", "^kubectl logs \\S+ -n monitoring", "^kubectl (get|describe) configmaps \\S*rulefiles\\S* -n monitoring", "^kubectl get configmaps(,\\S+)? -n monitoring"], tell: "team-a.rules", hint: "Ask Prometheus what rule groups it has loaded (its /api/v1/rules, or the rulefiles ConfigMap the operator renders). Is team-a.rules there at all?" },
            { id: "selector", match: ["^kubectl (get|describe) prometheuses( \\S+)? -n monitoring", "^kubectl get prometheuses \\S+ -n monitoring -o (yaml|json|jsonpath\\S*)", "^kubectl get prometheusrules(,\\S+)? -A( --show-labels)?", "^kubectl get prometheusrules -n monitoring( --show-labels)?"], tell: "release", hint: "The Prometheus object has a ruleSelector; the rules it did load all carry a label yours does not." }
        ],
        fix: ["^kubectl patch prometheusrules team-a-alerts -n team-a (?=.*\"release\":\"prometheus\")(?=.*(\"for\":\"|/for\",\"value\":\")([1-9]|1\\d|[2-5]\\d)m\")", "^kubectl label prometheusrules team-a-alerts release=prometheus -n team-a( --overwrite)?$"],
        fixOut: "prometheusrule.monitoring.coreos.com/team-a-alerts labeled\n\n(one of two: the operator now loads the group. With for: 24h the alert then sits Pending for a day; patch it down to a few minutes as well)\n\n$ kubectl -n team-a patch prometheusrule team-a-alerts --type json -p '[{\"op\":\"replace\",\"path\":\"/spec/groups/0/rules/0/for\",\"value\":\"5m\"}]'\nprometheusrule.monitoring.coreos.com/team-a-alerts patched\n\n$ kubectl -n monitoring exec prometheus-prometheus-kube-prometheus-prometheus-0 -c prometheus -- wget -qO- 'localhost:9090/api/v1/alerts' | grep -o '\"alertname\":\"HighErrorRate\",\"[^}]*\"state\":\"[a-z]*\"'\n\"alertname\":\"HighErrorRate\",...\"state\":\"firing\"",
        wrong: [
            { match: ["^kubectl patch prometheusrules team-a-alerts -n team-a (?!.*\"release\":\"prometheus\").*(\"for\":\"|/for\",\"value\":\")\\d+m\""], out: "prometheusrule.monitoring.coreos.com/team-a-alerts patched\n(a shorter for on a rule Prometheus never loaded; the group is still not in /api/v1/rules)" },
            { match: ["^kubectl patch prometheusrules team-a-alerts -n team-a .*(\"for\":\"|/for\",\"value\":\")(\\d+h|\\d{3,}m)\""], out: "prometheusrule.monitoring.coreos.com/team-a-alerts patched\n(still hours before it could fire, and still not loaded)" },
            { match: ["^kubectl patch prometheuses \\S+ -n monitoring .*ruleselector\":\\{\\}", "^kubectl patch prometheuses \\S+ -n monitoring .*\"ruleselector\":null"], out: "prometheus.monitoring.coreos.com patched\n(now every PrometheusRule in the cluster loads, any team's typo included, and the platform's one-label convention is gone. Label the rule instead)" },
            { match: ["^kubectl (delete|rollout restart) (pods|statefulsets) \\S+ -n monitoring"], out: "(the rule manager reloads on its own; there was nothing new to load)" },
            { match: ["^kubectl patch prometheusrules team-a-alerts -n team-a .*\"expr\""], out: "prometheusrule.monitoring.coreos.com/team-a-alerts patched\n(the expression was right, and it is still not evaluated by anyone)" }
        ]
    });
    SCENARIOS.push({
        id: "otel-exporter", name: "Voiceless Courier", d: 4, difficulty: 2, ns: "tracing",
        ticket: "team-a: our traces stopped showing up in Jaeger after the collector was 'upgraded' at noon. The app still logs a trace id per request, and the collector pod is Running.",
        answer: "OpenTelemetryCollector otel's traces pipeline lists only the debug exporter; the otlp exporter to Jaeger (jaeger-collector.tracing.svc:4317) is defined but no longer in pipelines.traces.exporters, so spans are received, logged and dropped. Fix: put the otlp exporter back in the traces pipeline.",
        resources: [
            { kind: "namespaces", name: "tracing", cols: ["Active", "12d"] },
            { kind: "opentelemetrycollectors", name: "otel", ns: "tracing", api: "opentelemetry.io/v1beta1", cols: ["deployment", "0.128.0", "1/1", "12d", "otel/opentelemetry-collector-contrib:0.128.0", "managed"],
                desc: "Spec:\n  Config:\n    Receivers:\n      Otlp:\n        Protocols:\n          Grpc:\n            Endpoint:  0.0.0.0:4317\n          Http:\n            Endpoint:  0.0.0.0:4318\n    Processors:\n      Batch:  {}\n    Exporters:\n      Debug:\n        Verbosity:  basic\n      Otlp:\n        Endpoint:  jaeger-collector.tracing.svc:4317\n        Tls:\n          Insecure:  true\n    Service:\n      Pipelines:\n        Traces:\n          Receivers:   [otlp]\n          Processors:  [batch]\n          Exporters:   [debug]\n  Mode:  deployment",
                yaml: "spec:\n  config:\n    receivers:\n      otlp:\n        protocols:\n          grpc:\n            endpoint: 0.0.0.0:4317\n          http:\n            endpoint: 0.0.0.0:4318\n    processors:\n      batch: {}\n    exporters:\n      debug:\n        verbosity: basic\n      otlp:\n        endpoint: jaeger-collector.tracing.svc:4317\n        tls:\n          insecure: true\n    service:\n      pipelines:\n        traces:\n          receivers: [otlp]\n          processors: [batch]\n          exporters: [debug]\n  mode: deployment", fields: { ".spec.config.service.pipelines.traces.exporters": "[debug]", ".spec.config.service.pipelines.traces": "map[exporters:[debug] processors:[batch] receivers:[otlp]]" } },
            { kind: "deployments", name: "otel-collector", ns: "tracing", api: "apps/v1", cols: ["1/1", "1", "1", "12d"], labels: "app.kubernetes.io/name=otel-collector" },
            { kind: "pods", name: "otel-collector-5b8c7d9f6-w4t2j", ns: "tracing", cols: ["1/1", "Running", "0", "2h"], labels: "app.kubernetes.io/name=otel-collector,app.kubernetes.io/component=opentelemetry-collector", container: "otc-container",
                logs: "2026-09-05T12:01:03.412Z\tinfo\tservice@v0.128.0/service.go:186\tEverything is ready. Begin running and processing data.\n2026-09-05T12:01:19.007Z\tinfo\tTraces\t{\"resource spans\": 1, \"spans\": 14}\n2026-09-05T12:01:22.551Z\tinfo\tTraces\t{\"resource spans\": 1, \"spans\": 9}\n2026-09-05T12:01:25.118Z\tinfo\tTraces\t{\"resource spans\": 2, \"spans\": 31}\n(the debug exporter, counting spans that go nowhere else)" },
            { kind: "services", name: "otel-collector", ns: "tracing", cols: ["ClusterIP", "10.96.150.12", "<none>", "4317/TCP,4318/TCP", "12d"] },
            { kind: "services", name: "jaeger-collector", ns: "tracing", cols: ["ClusterIP", "10.96.150.40", "<none>", "4317/TCP,4318/TCP,14268/TCP", "12d"] },
            { kind: "services", name: "jaeger-query", ns: "tracing", cols: ["ClusterIP", "10.96.150.41", "<none>", "16686/TCP", "12d"] },
            { kind: "pods", name: "jaeger-7c6d5e4f3-p9q8r", ns: "tracing", cols: ["1/1", "Running", "0", "12d"], labels: "app=jaeger", container: "jaeger",
                logs: '{"level":"info","ts":1757073600.1,"caller":"grpc/builder.go:74","msg":"Agent requested insecure grpc connection to collector(s)"}\n{"level":"info","ts":1757073662.4,"msg":"last span received 2h4m ago"}',
                exec: { "api/services|services": '{"data":["jaeger-all-in-one"],"total":1}\n(no service named web: nothing has arrived since noon)' } },
            { kind: "pods", name: WEB_POD, ns: "team-a", cols: ["1/1", "Running", "0", "2h"], labels: "app=web", container: "web",
                logs: '{"level":"info","msg":"GET /api/orders 200","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7"}\n{"level":"info","msg":"exporter: sent 12 spans to http://otel-collector.tracing.svc:4318/v1/traces (200 OK)"}' }
        ],
        events: [
            { type: "Normal", reason: "ScalingReplicaSet", age: "2h", from: "deployment-controller", obj: "Deployment/otel-collector", ns: "tracing", msg: "Scaled up replica set otel-collector-5b8c7d9f6 from 0 to 1" }
        ],
        evidence: [
            { id: "arriving", match: ["^kubectl logs \\S+ -n tracing", "^kubectl logs deployments otel-collector -n tracing", "^kubectl logs \\S+ -n team-a"], tell: "spans", hint: "Follow the spans: the app says it sends them, the collector logs say it receives them. So where do they go next?" },
            { id: "pipeline", match: ["^kubectl describe opentelemetrycollectors otel -n tracing", "^kubectl get opentelemetrycollectors otel -n tracing -o (yaml|json|jsonpath\\S*)", "^kubectl get opentelemetrycollectors(,\\S+)?( otel)? -n tracing$"], tell: "[debug]", hint: "Read the collector's config: a pipeline is receivers, processors and exporters, and the traces pipeline's exporters list is where spans leave." },
            { id: "jaeger", match: ["^kubectl exec \\S+ -n tracing( -c \\S+)? -- .*(services|api)", "^kubectl get services(,\\S+)?( \\S+)? -n tracing", "^kubectl describe services jaeger-collector -n tracing"], tell: "jaeger-collector", hint: "The destination exists and is idle: Jaeger's collector Service is there on 4317, and Jaeger has seen nothing for two hours." }
        ],
        fix: ["^kubectl patch opentelemetrycollectors otel -n tracing .*\"exporters\":\\[(\"debug\",)?\"otlp\"(,\"debug\")?\\]", "^kubectl patch opentelemetrycollectors otel -n tracing --type=json -p=\\[\\{\"op\":\"(add|replace)\",\"path\":\"/spec/config/service/pipelines/traces/exporters(/-|/0|/1)?\",\"value\":(\"otlp\"|\\[(\"debug\",)?\"otlp\"(,\"debug\")?\\])\\}\\]"],
        fixOut: "opentelemetrycollector.opentelemetry.io/otel patched\n\n$ kubectl -n tracing logs deploy/otel-collector --tail=2\n2026-09-05T14:06:10.201Z\tinfo\tservice@v0.128.0/service.go:186\tEverything is ready. Begin running and processing data.\n2026-09-05T14:06:14.877Z\tinfo\tTraces\t{\"resource spans\": 1, \"spans\": 11}\n\n$ kubectl -n tracing exec deploy/jaeger -- wget -qO- localhost:16686/api/services\n{\"data\":[\"jaeger-all-in-one\",\"web\"],\"total\":2}",
        wrong: [
            { match: ["^kubectl patch opentelemetrycollectors otel -n tracing .*\"exporters\":\\[\"debug\"\\]", "^kubectl patch opentelemetrycollectors otel -n tracing .*\"verbosity\""], out: "opentelemetrycollector.opentelemetry.io/otel patched\n(louder logging of spans that still go nowhere)" },
            { match: ["^kubectl (delete|rollout restart) (pods|deployments) \\S+ -n tracing"], out: "(the collector restarts with the same pipeline; the spans are dropped just as before)" },
            { match: ["^kubectl patch opentelemetrycollectors otel -n tracing .*\"endpoint\":\"(?!jaeger-collector)[^\"]*\""], out: "opentelemetrycollector.opentelemetry.io/otel patched\n(a different address on an exporter no pipeline uses)" },
            { match: ["^kubectl patch (deployments|pods) \\S+ -n team-a", "^kubectl set env deployments web"], out: "(the app is exporting fine; the collector logs prove the spans arrive)" },
            { match: ["^kubectl patch opentelemetrycollectors otel -n tracing .*\"receivers\""], out: "opentelemetrycollector.opentelemetry.io/otel patched\n(receiving was never the problem)" }
        ]
    });
    /* security */
    SCENARIOS.push({
        id: "eso-store-auth", name: "Locked Reliquary", d: 5, difficulty: 2, ns: "team-a",
        ticket: "team-a: our app's database password comes from an ExternalSecret and the Secret has not been refreshed since last night. New pods fail to start because the Secret is missing entirely.",
        answer: "ExternalSecret db-creds references SecretStore vault, whose service account (eso-team-a) lost the RoleBinding that let it read the backing Secret in the platform-secrets namespace; the store reports SecretSyncedError with a 403 and the ExternalSecret never materialises the Secret. Fix: restore the RoleBinding for eso-team-a in platform-secrets.",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "namespaces", name: "platform-secrets", cols: ["Active", "12d"] },
            { kind: "externalsecrets", name: "db-creds", ns: "team-a", api: "external-secrets.io/v1", cols: ["vault", "1h", "SecretSyncedError", "False"],
                desc: "Spec:\n  Refresh Interval:  1h\n  Secret Store Ref:\n    Kind:  SecretStore\n    Name:  vault\n  Target:\n    Name:  db-creds\n    Creation Policy:  Owner\n  Data:\n    Secret Key:  password\n    Remote Ref:\n      Key:       team-a/db\n      Property:  password\nStatus:\n  Conditions:\n    Last Transition Time:  2026-09-04T23:10:44Z\n    Message:               could not get secret data from provider: secrets \"team-a-db\" is forbidden: User \"system:serviceaccount:team-a:eso-team-a\" cannot get resource \"secrets\" in API group \"\" in the namespace \"platform-secrets\"\n    Reason:                SecretSyncedError\n    Status:                False\n    Type:                  Ready\n  Refresh Time:  2026-09-04T22:10:41Z",
                yaml: "spec:\n  refreshInterval: 1h\n  secretStoreRef:\n    kind: SecretStore\n    name: vault\n  target:\n    name: db-creds\n    creationPolicy: Owner\n  data:\n  - secretKey: password\n    remoteRef:\n      key: team-a/db\n      property: password\nstatus:\n  conditions:\n  - message: 'could not get secret data from provider: secrets \"team-a-db\" is forbidden: User \"system:serviceaccount:team-a:eso-team-a\" cannot get resource \"secrets\" in API group \"\" in the namespace \"platform-secrets\"'\n    reason: SecretSyncedError\n    status: \"False\"\n    type: Ready", fields: { ".status.conditions[0].reason": "SecretSyncedError", ".status.conditions[0].message": "could not get secret data from provider: secrets \"team-a-db\" is forbidden: User \"system:serviceaccount:team-a:eso-team-a\" cannot get resource \"secrets\" in API group \"\" in the namespace \"platform-secrets\"" } },
            { kind: "secretstores", name: "vault", ns: "team-a", api: "external-secrets.io/v1", cols: ["9d", "Invalid", "ReadWrite", "False"],
                desc: "Spec:\n  Provider:\n    Kubernetes:\n      Auth:\n        Service Account:\n          Name:  eso-team-a\n      Remote Namespace:  platform-secrets\n      Server:\n        Ca Provider:\n          Type:  ConfigMap\n          Name:  kube-root-ca.crt\n          Key:   ca.crt\nStatus:\n  Conditions:\n    Message:  unable to validate store: could not verify if the client is valid: secrets is forbidden: User \"system:serviceaccount:team-a:eso-team-a\" cannot list resource \"secrets\" in API group \"\" in the namespace \"platform-secrets\"\n    Reason:   ValidationFailed\n    Status:   False\n    Type:     Ready",
                yaml: "spec:\n  provider:\n    kubernetes:\n      auth:\n        serviceAccount:\n          name: eso-team-a\n      remoteNamespace: platform-secrets\n      server:\n        caProvider:\n          type: ConfigMap\n          name: kube-root-ca.crt\n          key: ca.crt", fields: { ".spec.provider.kubernetes.auth.serviceAccount.name": "eso-team-a", ".status.conditions[0].reason": "ValidationFailed" } },
            { kind: "serviceaccounts", name: "eso-team-a", ns: "team-a", cols: ["0", "9d"] },
            { kind: "secrets", name: "team-a-db", ns: "platform-secrets", cols: ["Opaque", "2", "9d"], labels: "tenant=team-a" },
            { kind: "roles", name: "eso-reader-team-a", ns: "platform-secrets", cols: ["2026-08-27T14:02:18Z"], desc: "PolicyRule:\n  Resources  Resource Names  Verbs\n  ---------  --------------  -----\n  secrets    [team-a-db]     [get list watch]\n  selfsubjectrulesreviews.authorization.k8s.io  []  [create]" },
            { kind: "rolebindings", name: "eso-reader-team-b", ns: "platform-secrets", cols: ["Role/eso-reader-team-b", "9d"], desc: "Role:\n  Kind:  Role\n  Name:  eso-reader-team-b\nSubjects:\n  Kind            Name        Namespace\n  ServiceAccount  eso-team-b  team-b" },
            { kind: "deployments", name: "api", ns: "team-a", api: "apps/v1", cols: ["0/1", "1", "0", "1d"], labels: "app=api" },
            { kind: "pods", name: "api-6d5c4b3a2-h8j7k", ns: "team-a", cols: ["0/1", "CreateContainerConfigError", "0", "40m"], labels: "app=api,pod-template-hash=6d5c4b3a2", owner: "api", container: "api", notRunning: true,
                desc: "Containers:\n  api:\n    State:          Waiting\n      Reason:       CreateContainerConfigError\n    Environment:\n      DB_PASSWORD:  <set to the key 'password' in secret 'db-creds'>  Optional: false",
                logsErr: 'Error from server (BadRequest): container "api" in pod "api-6d5c4b3a2-h8j7k" is waiting to start: CreateContainerConfigError' },
            { kind: "pods", name: "external-secrets-7f6e5d4c3-b2n1m", ns: "external-secrets", cols: ["1/1", "Running", "0", "12d"], labels: "app.kubernetes.io/name=external-secrets", container: "external-secrets",
                logs: '{"level":"error","ts":1757074101.2,"logger":"controllers.ExternalSecret","msg":"could not get secret data from provider","ExternalSecret":{"name":"db-creds","namespace":"team-a"},"SecretStore":"vault","error":"secrets \\"team-a-db\\" is forbidden: User \\"system:serviceaccount:team-a:eso-team-a\\" cannot get resource \\"secrets\\" in API group \\"\\" in the namespace \\"platform-secrets\\""}' }
        ]),
        canI: { "system:serviceaccount:team-a:eso-team-a": {}, "system:serviceaccount:team-b:eso-team-b": { secrets: "get,list,watch" } },
        events: [
            { type: "Warning", reason: "UpdateFailed", age: "3m (x14 over 1h)", from: "external-secrets", obj: "ExternalSecret/db-creds", msg: "could not get secret data from provider: secrets \"team-a-db\" is forbidden: User \"system:serviceaccount:team-a:eso-team-a\" cannot get resource \"secrets\" in API group \"\" in the namespace \"platform-secrets\"" },
            { type: "Warning", reason: "Failed", age: "1m (x22 over 40m)", from: "kubelet", obj: "Pod/api-6d5c4b3a2-h8j7k", msg: "Error: secret \"db-creds\" not found" }
        ],
        evidence: [
            { id: "notsynced", match: ["^kubectl get externalsecrets(,\\S+)?( \\S+)? -n team-a", "^kubectl get (secrets|pods)(,\\S+)?( \\S+)? -n team-a", "^kubectl describe pods( api\\S+)? -n team-a"], tell: "SecretSyncedError", hint: "Start with the ExternalSecret: its READY and STATUS columns say whether the last sync worked." },
            { id: "forbidden", match: ["^kubectl describe (externalsecrets|secretstores) \\S+ -n team-a", "^kubectl get (externalsecrets|secretstores) \\S+ -n team-a -o (yaml|json|jsonpath\\S*)", "^kubectl logs \\S+ -n external-secrets"].concat(EVENTS), tell: "forbidden", hint: "describe the ExternalSecret, or the SecretStore it uses: the condition message carries the provider's error, and the provider here is the Kubernetes API." },
            { id: "binding", match: ["^kubectl get (rolebindings|roles)(,\\S+)?( \\S+)? -n platform-secrets", "^kubectl describe (rolebindings|roles)\\S* -n platform-secrets", "^kubectl auth can-i \\S+ secrets -n platform-secrets --as=system:serviceaccount:team-a:eso-team-a", "^kubectl auth can-i -n platform-secrets --as=system:serviceaccount:team-a:eso-team-a --list"], tell: "eso-reader-team-b", hint: "The store authenticates as a service account and reads from platform-secrets. List the RoleBindings there: team-b's is present, team-a's is not." }
        ],
        fix: ["^kubectl create rolebindings \\S+ -n platform-secrets --role=eso-reader-team-a --serviceaccount=team-a:eso-team-a"],
        fixOut: "rolebinding.rbac.authorization.k8s.io/eso-reader-team-a created\n\n$ kubectl -n team-a annotate externalsecret db-creds force-sync=$(date +%s) --overwrite\nexternalsecret.external-secrets.io/db-creds annotated\n\n$ kubectl -n team-a get externalsecret db-creds\nNAME       STORE   REFRESH INTERVAL   STATUS         READY\ndb-creds   vault   1h                 SecretSynced   True\n\n$ kubectl -n team-a get secret db-creds\nNAME       TYPE     DATA   AGE\ndb-creds   Opaque   1      4s",
        wrong: [
            { match: ["^kubectl create secrets \\S+ db-creds -n team-a", "^kubectl create secrets generic db-creds"], out: "secret/db-creds created\n(by hand, with whatever password you typed; the ExternalSecret with creationPolicy Owner takes it over and deletes it on its next failed sync, and the real password lives in platform-secrets)" },
            { match: ["^kubectl create clusterrolebindings \\S+ --clusterrole=cluster-admin", "^kubectl create clusterrolebindings \\S+ .*--serviceaccount=team-a:eso-team-a"], out: "clusterrolebinding created\n(eso-team-a can now read every Secret in the cluster, team-b's included; the Role that scopes it to team-a-db is right there in platform-secrets)" },
            { match: ["^kubectl create rolebindings \\S+ -n platform-secrets .*--role=eso-reader-team-b", "^kubectl create rolebindings \\S+ -n team-a"], out: "rolebinding created\n(the wrong Role, or the wrong namespace: the read happens in platform-secrets, by eso-team-a, and needs eso-reader-team-a)" },
            { match: ["^kubectl (delete pods|rollout restart)", "^kubectl delete externalsecrets"], out: "(a new pod waits on the same missing Secret; a new ExternalSecret gets the same 403)" },
            { match: ["^kubectl patch (externalsecrets|secretstores) \\S+ -n team-a .*refreshinterval", "^kubectl annotate externalsecrets db-creds"], out: "externalsecret.external-secrets.io/db-creds annotated\n(a forced refresh fails the same way: forbidden)" }
        ]
    });
    SCENARIOS.push({
        id: "image-unsigned", name: "Sealed Gate", d: 5, difficulty: 3, ns: "team-a",
        ticket: "team-a: our hotfix will not deploy. The pipeline built and pushed registry.lab.local/team-a/api:1.4.2 but the new pods are rejected with a signature error. The 1.4.1 pods are fine.",
        answer: "ImageValidatingPolicy require-signed-images (Deny) verifies cosign signatures on registry.lab.local/team-a/* against the platform key. The hotfix pipeline ran without its sign step (the Tekton PipelineRun shows the cosign-sign task skipped), so 1.4.2 is unsigned and admission refuses it. Fix: sign the image (cosign sign, or re-run the pipeline with signing), not weaken the policy.",
        resources: tenancy("baseline").concat([dnsPolicy(false),
            { kind: "imagevalidatingpolicies", name: "require-signed-images", api: "policies.kyverno.io/v1alpha1", cols: ["True", "False", "True", "12d", "Ready"],
                desc: "Spec:\n  Validation Actions:  Deny\n  Match Constraints:\n    Resource Rules:\n      Resources:  pods\n  Match Image References:\n    Glob:  registry.lab.local/team-a/*\n  Attestors:\n    Name:  platform-key\n    Cosign:\n      Key:\n        Data:  -----BEGIN PUBLIC KEY-----\\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\\n-----END PUBLIC KEY-----\n  Validations:\n    Expression:  images.containers.map(image, verifyImageSignatures(image, [attestors.platform-key])).all(e, e > 0)\n    Message:     every team-a image must carry a signature from the platform key",
                yaml: "spec:\n  validationActions: [Deny]\n  matchConstraints:\n    resourceRules:\n    - resources: [pods]\n  matchImageReferences:\n  - glob: registry.lab.local/team-a/*\n  attestors:\n  - name: platform-key\n    cosign:\n      key:\n        data: |\n          -----BEGIN PUBLIC KEY-----\n          MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\n          -----END PUBLIC KEY-----\n  validations:\n  - expression: images.containers.map(image, verifyImageSignatures(image, [attestors.platform-key])).all(e, e > 0)\n    message: every team-a image must carry a signature from the platform key" },
            { kind: "deployments", name: "api", ns: "team-a", api: "apps/v1", cols: ["1/1", "0", "1", "3d"], labels: "app=api",
                desc: "Selector:               app=api\nReplicas:               1 desired | 0 updated | 1 total | 1 available | 0 unavailable\nPod Template:\n  Containers:\n   api:\n    Image:  registry.lab.local/team-a/api:1.4.2\nConditions:\n  Type           Status  Reason\n  Available      True    MinimumReplicasAvailable\n  ReplicaFailure True    FailedCreate\nOldReplicaSets:  api-5a4b3c2d1 (1/1 replicas created)\nNewReplicaSet:   api-9e8f7a6b5 (0/1 replicas created)", fields: { ".spec.template.spec.containers[0].image": "registry.lab.local/team-a/api:1.4.2" } },
            { kind: "replicasets", name: "api-5a4b3c2d1", ns: "team-a", api: "apps/v1", cols: ["1", "1", "1", "3d"], labels: "app=api,pod-template-hash=5a4b3c2d1", desc: "Controlled By:  Deployment/api\nImage:  registry.lab.local/team-a/api:1.4.1" },
            { kind: "replicasets", name: "api-9e8f7a6b5", ns: "team-a", api: "apps/v1", cols: ["1", "0", "0", "18m"], labels: "app=api,pod-template-hash=9e8f7a6b5",
                desc: "Controlled By:  Deployment/api\nReplicas:       0 current / 1 desired\nImage:          registry.lab.local/team-a/api:1.4.2\nConditions:\n  Type             Status  Reason\n  ReplicaFailure   True    FailedCreate" },
            { kind: "pods", name: "api-5a4b3c2d1-m2n3b", ns: "team-a", cols: ["1/1", "Running", "0", "3d"], labels: "app=api,pod-template-hash=5a4b3c2d1", owner: "api", container: "api", desc: "Containers:\n  api:\n    Image:  registry.lab.local/team-a/api:1.4.1\n    State:  Running", logs: "listening on :8080 (version 1.4.1)" },
            { kind: "pipelineruns", name: "api-release-1-4-1-x2k9p", ns: "drill-ci", api: "tekton.dev/v1", cols: ["True", "Succeeded", "3d", "3d"], desc: "Status\n\nSTARTED     DURATION   STATUS\n3 days ago  4m12s      Succeeded\n\nTaskruns\n\nNAME                                   TASK NAME     STARTED     DURATION   STATUS\napi-release-1-4-1-x2k9p-scan           trivy-scan    3 days ago  1m40s      Succeeded\napi-release-1-4-1-x2k9p-build          kaniko        3 days ago  2m01s      Succeeded\napi-release-1-4-1-x2k9p-sign           cosign-sign   3 days ago  9s         Succeeded" },
            { kind: "pipelineruns", name: "api-hotfix-1-4-2-q7w3e", ns: "drill-ci", api: "tekton.dev/v1", cols: ["True", "Succeeded", "22m", "19m"],
                desc: "Status\n\nSTARTED         DURATION   STATUS\n22 minutes ago  3m05s      Succeeded\n\nParams\n\nNAME    VALUE\nsign    \"false\"\n\nTaskruns\n\nNAME                                   TASK NAME     STARTED         DURATION   STATUS\napi-hotfix-1-4-2-q7w3e-scan            trivy-scan    22 minutes ago  1m12s      Succeeded\napi-hotfix-1-4-2-q7w3e-build           kaniko        22 minutes ago  1m50s      Succeeded\n\nSkipped Tasks\n\nNAME   REASON\nsign   When Expressions evaluated to false",
                yaml: "spec:\n  params:\n  - name: image\n    value: registry.lab.local/team-a/api:1.4.2\n  - name: sign\n    value: \"false\"\n  pipelineRef:\n    name: api-release\nstatus:\n  conditions:\n  - reason: Succeeded\n    status: \"True\"\n    type: Succeeded\n  skippedTasks:\n  - name: sign\n    reason: When Expressions evaluated to false", fields: { ".status.skippedTasks[*].name": "sign", ".spec.params[?(@.name==\"sign\")].value": "false" } },
            { kind: "tasks", name: "cosign-sign", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"] },
            { kind: "pipelines", name: "api-release", ns: "drill-ci", api: "tekton.dev/v1", cols: ["12d"], desc: "Spec:\n  Params:\n    Name:     sign\n    Default:  \"true\"\n  Tasks:\n    trivy-scan, kaniko, cosign-sign (when: $(params.sign) == \"true\")" },
            { kind: "secrets", name: "cosign-key", ns: "drill-ci", cols: ["Opaque", "3", "12d"] }
        ]),
        signed: ["registry.lab.local/team-a/api:1.4.1"],
        events: [
            { type: "Warning", reason: "FailedCreate", age: "27s (x15 over 18m)", from: "replicaset-controller", obj: "ReplicaSet/api-9e8f7a6b5", msg: 'Error creating: admission webhook "ivpol.validate.kyverno.svc-fail" denied the request: Policy require-signed-images failed: image registry.lab.local/team-a/api:1.4.2: no matching signatures found for attestor platform-key: every team-a image must carry a signature from the platform key' }
        ],
        evidence: [
            { id: "denied", match: ["^kubectl describe replicasets( \\S+)? -n team-a", "^kubectl describe deployments api -n team-a", "^kubectl get (deployments|replicasets) api\\S* -n team-a -o (yaml|json)"].concat(EVENTS, GET_PODS), tell: "no matching signatures found", hint: "The new ReplicaSet's FailedCreate event carries the admission message: which policy, which image, what it lacked." },
            { id: "policy", match: ["^kubectl get imagevalidatingpolicies", "^kubectl describe imagevalidatingpolicies", "^kubectl get imagevalidatingpolicies \\S+ -o (yaml|json)"], tell: "require-signed-images", hint: "Read the ImageValidatingPolicy the event named: what it matches, and which key it verifies against." },
            { id: "pipeline", match: ["^tkn pipelineruns (list|describe)", "^kubectl get pipelineruns(,\\S+)?( \\S+)? -n drill-ci", "^kubectl describe pipelineruns \\S+ -n drill-ci", "^kubectl get pipelineruns \\S+ -n drill-ci -o (yaml|json|jsonpath\\S*)"], tell: "sign", hint: "Both pipelines succeeded. Compare the release run with the hotfix run: which tasks ran, and which were skipped." }
        ],
        fix: ["^cosign sign registry\\.lab\\.local/team-a/api(:1\\.4\\.2|@sha256:\\S+)( --key=\\S+)?$", "^tkn pipelines start api-release\\b", "^kubectl create pipelineruns"],
        fixOut: "Pushing signature to: registry.lab.local/team-a/api\n\n$ cosign verify --key k8s://drill-ci/cosign-key registry.lab.local/team-a/api:1.4.2\nVerification for registry.lab.local/team-a/api:1.4.2 --\nThe following checks were performed on each of these signatures:\n  - The signatures were verified against the specified public key\n\n$ kubectl -n team-a rollout restart deploy/api && kubectl -n team-a get pods\nNAME                   READY   STATUS    RESTARTS   AGE\napi-9e8f7a6b5-z3x4c    1/1     Running   0          6s",
        wrong: [
            { match: ["^kubectl delete imagevalidatingpolicies", "^kubectl patch imagevalidatingpolicies \\S+ .*\"validationactions\":\\[\"audit\"\\]"], out: "imagevalidatingpolicy.policies.kyverno.io deleted\n(the hotfix deploys, and so would anything anyone pushes to the registry; the control that caught an unsigned image is gone because it caught one)" },
            { match: ["^kubectl patch imagevalidatingpolicies \\S+ .*(\"glob\"|matchimagereferences)", "^kubectl patch imagevalidatingpolicies \\S+ .*\"data\""], out: "imagevalidatingpolicy.policies.kyverno.io patched\n(the policy now looks away from team-a, or trusts a different key; the image is still unsigned)" },
            { match: ["^kubectl set image deployments api \\S+=registry\\.lab\\.local/team-a/api:1\\.4\\.1", "^kubectl rollout undo deployments api"], out: "deployment.apps/api rolled back\n(1.4.1 was never broken; the ticket wants the hotfix out, and 1.4.2 is still unsigned)" },
            { match: ["^kubectl (delete pods|rollout restart deployments api)"], out: "(the ReplicaSet tries again, admission refuses again)" },
            { match: ["^kubectl label (namespaces team-a|pods|deployments api)"], out: "(an ImageValidatingPolicy matches on the image reference, not on labels)" },
            { match: ["^cosign sign registry\\.lab\\.local/team-a/api:1\\.4\\.1"], out: "Pushing signature to: registry.lab.local/team-a/api\n(1.4.1 was already signed; 1.4.2 is the one admission refuses)" }
        ]
    });
    /* ── techniques: the command families the townsfolk teach ──── */
    /* {ns} is the battle's namespace; {res} {pod} {kind} {sa} {app} {name} open a
       target list; a word in CAPITALS or a trailing = is left for the player to
       finish in the prompt. fix: true puts it in the Fix menu. */
    var TECHNIQUES = {
        "k-get": { cmd: "kubectl get {kind} -n {ns}", about: "list a kind: the state column is the first read of any incident", tool: "kubectl" },
        "k-describe": { cmd: "kubectl describe {res} -n {ns}", about: "one object in full, with its events at the bottom", tool: "kubectl" },
        "k-events": { cmd: "kubectl get events -n {ns} --sort-by=.lastTimestamp", about: "the namespace's timeline, newest last", tool: "kubectl" },
        "k-logs": { cmd: "kubectl logs {pod} -n {ns}", about: "what the container says for itself", tool: "kubectl" },
        "k-logs-prev": { cmd: "kubectl logs {pod} -n {ns} --previous", about: "a crashed container's last words", tool: "kubectl" },
        "k-yaml": { cmd: "kubectl get {res} -n {ns} -o yaml", about: "the whole object: spec and status, nothing summarised", tool: "kubectl" },
        "k-wide": { cmd: "kubectl get {kind} -n {ns} -o wide", about: "the extra columns: node, IP, images", tool: "kubectl" },
        "k-labels": { cmd: "kubectl get {kind} -n {ns} --show-labels", about: "labels beside names, for matching selectors by eye", tool: "kubectl" },
        "k-endpoints": { cmd: "kubectl get endpointslices -n {ns}", about: "who a Service actually sends to, address by address", tool: "kubectl" },
        "k-exec-dns": { cmd: "kubectl exec {pod} -n {ns} -- nslookup kubernetes.default", about: "resolve a name from inside the pod", tool: "kubectl" },
        "k-exec-http": { cmd: "kubectl exec {pod} -n {ns} -- wget -qO- localhost:8080", about: "knock on the container's own port from inside", tool: "kubectl" },
        "k-top": { cmd: "kubectl top pods -n {ns}", about: "live CPU and memory per pod, from metrics-server", tool: "kubectl" },
        "k-nodes": { cmd: "kubectl describe nodes", about: "capacity, allocatable and what is already requested", tool: "kubectl" },
        "k-quota": { cmd: "kubectl describe resourcequotas -n {ns}", about: "used against hard, one line per resource", tool: "kubectl" },
        "k-netpol": { cmd: "kubectl get networkpolicies -n {ns} -o yaml", about: "every policy selecting the namespace's pods, rule by rule", tool: "kubectl" },
        "k-sc": { cmd: "kubectl get storageclasses", about: "provisioner, reclaim policy, binding mode and expansion in one line", tool: "kubectl" },
        "k-hpa": { cmd: "kubectl describe horizontalpodautoscalers -n {ns}", about: "the autoscaler's conditions say what it could not compute", tool: "kubectl" },
        "k-ns-labels": { cmd: "kubectl get namespaces {name} --show-labels", about: "a namespace's labels: tenancy, Pod Security, selectors", tool: "kubectl" },
        "k-cani": { cmd: "kubectl auth can-i --list -n {ns} --as={sa}", about: "ask the API server what a subject may do", tool: "kubectl" },
        "k-rb": { cmd: "kubectl get rolebindings -n {ns}", about: "who is bound to what, in this namespace", tool: "kubectl" },
        "k-crb": { cmd: "kubectl get clusterrolebindings", about: "the cluster-wide grants, controllers' included", tool: "kubectl" },
        "k-explain": { cmd: "kubectl explain {kind}", about: "the field reference, version-correct for this cluster", tool: "kubectl" },
        "k-rollout": { cmd: "kubectl rollout status {res} -n {ns}", about: "is the rollout progressing, or stuck", tool: "kubectl" },
        "argo-get": { cmd: "argocd app get {app}", about: "sync status, health, conditions and the resource tree", tool: "argo" },
        "argo-list": { cmd: "argocd app list", about: "every Application, its two status axes and its target", tool: "argo" },
        "argo-diff": { cmd: "argocd app diff {app}", about: "rendered manifests against live objects", tool: "argo" },
        "ro-get": { cmd: "kubectl argo rollouts get rollouts {name} -n {ns}", about: "the rollout's steps, revisions and analysis runs as a tree", tool: "argo" },
        "ar-get": { cmd: "kubectl get analysisruns -n {ns}", about: "the canary's measurements, and their verdict", tool: "argo" },
        "flux-ks": { cmd: "flux get kustomizations", about: "revision, suspended, ready and message per Kustomization", tool: "flux" },
        "flux-src": { cmd: "flux get sources git", about: "what the source controller last fetched", tool: "flux" },
        "flux-tree": { cmd: "flux tree kustomizations {name}", about: "what a Kustomization applied, object by object", tool: "flux" },
        "tkn-list": { cmd: "tkn pipelineruns list -n {ns}", about: "every run with its status and reason", tool: "tekton" },
        "tkn-desc": { cmd: "tkn pipelineruns describe {name} -n {ns}", about: "one run: message, taskruns, skipped tasks", tool: "tekton" },
        "tkn-tasks": { cmd: "kubectl get tasks -n {ns}", about: "the Tasks a Pipeline can reference", tool: "tekton" },
        "xp-trace": { cmd: "crossplane beta trace {res} -n {ns}", about: "the composite and everything it composed, with conditions", tool: "crossplane" },
        "xp-objects": { cmd: "kubectl get objects -n {ns}", about: "provider-kubernetes's composed Objects, synced and ready", tool: "crossplane" },
        "k-vpol": { cmd: "kubectl get validatingpolicies", about: "Kyverno's cluster-wide policies", tool: "platform" },
        "k-ivpol": { cmd: "kubectl get imagevalidatingpolicies -o yaml", about: "the image verification policies and their keys", tool: "platform" },
        "k-smon": { cmd: "kubectl get servicemonitors -A --show-labels", about: "every scrape declaration and the labels the operator selects on", tool: "platform" },
        "k-prom": { cmd: "kubectl get prometheuses -n monitoring -o yaml", about: "the Prometheus object's own selectors", tool: "platform" },
        "k-rules": { cmd: "kubectl get prometheusrules -A --show-labels", about: "every rule file, and whether Prometheus would load it", tool: "platform" },
        "k-otel": { cmd: "kubectl get opentelemetrycollectors -n {ns} -o yaml", about: "the collector's receivers, processors and exporters", tool: "platform" },
        "k-es": { cmd: "kubectl get externalsecrets -n {ns}", about: "each ExternalSecret's store, status and readiness", tool: "platform" },
        "cosign-verify": { cmd: "cosign verify --key k8s://drill-ci/cosign-key IMAGE", about: "does a signature exist for this image, under this key", tool: "platform" },
        /* repairs */
        "f-set-image": { cmd: "kubectl set image deployments {name} -n {ns} CONTAINER=IMAGE", about: "point a Deployment at another image", tool: "kubectl", fix: true },
        "f-set-res": { cmd: "kubectl set resources deployments {name} -n {ns} --requests=cpu=,memory=", about: "change what a container asks for", tool: "kubectl", fix: true },
        "f-patch": { cmd: "kubectl patch {res} -n {ns} --type merge -p '{}'", about: "merge a fragment into an object", tool: "kubectl", fix: true },
        "f-json-patch": { cmd: "kubectl patch {res} -n {ns} --type json -p '[{\"op\":\"remove\",\"path\":\"\"}]'", about: "remove or replace one path in an object", tool: "kubectl", fix: true },
        "f-scale": { cmd: "kubectl scale deployments {name} -n {ns} --replicas=", about: "change a workload's replica count", tool: "kubectl", fix: true },
        "f-label": { cmd: "kubectl label {res} -n {ns} KEY=VALUE --overwrite", about: "set a label; KEY- removes it", tool: "kubectl", fix: true },
        "f-annotate": { cmd: "kubectl annotate {res} -n {ns} KEY-", about: "remove an annotation; KEY=VALUE sets one", tool: "kubectl", fix: true },
        "f-delete": { cmd: "kubectl delete {res} -n {ns}", about: "remove an object the cluster is better off without", tool: "kubectl", fix: true },
        "f-create-cm": { cmd: "kubectl create configmaps NAME -n {ns} --from-literal=KEY=VALUE", about: "make the ConfigMap a pod is waiting on", tool: "kubectl", fix: true },
        "f-rb": { cmd: "kubectl create rolebinding NAME -n {ns} --clusterrole=ROLE --serviceaccount={ns}:SA", about: "grant a subject a role in one namespace", tool: "kubectl", fix: true },
        "f-crb": { cmd: "kubectl create clusterrolebinding NAME --clusterrole=ROLE --serviceaccount=NAMESPACE:SA", about: "grant a subject a role everywhere; rarely the right default", tool: "kubectl", fix: true },
        "f-run": { cmd: "kubectl run NAME -n {ns} --image=busybox:1.36 --restart=Never -- sleep 3600", about: "start a pod, for a probe or as a first consumer", tool: "kubectl", fix: true },
        "f-argo-set": { cmd: "argocd app set {app} --revision main", about: "move an Application's target revision", tool: "argo", fix: true },
        "f-ro-retry": { cmd: "kubectl argo rollouts retry rollouts {name} -n {ns}", about: "run an aborted rollout again", tool: "argo", fix: true },
        "f-flux-resume": { cmd: "flux resume kustomizations {name}", about: "wake a suspended Kustomization", tool: "flux", fix: true },
        "f-flux-reconcile": { cmd: "flux reconcile kustomizations {name} --with-source", about: "reconcile now, source first", tool: "flux", fix: true },
        "f-tkn-start": { cmd: "tkn pipelines start {name} -n {ns}", about: "a fresh PipelineRun; completed runs are immutable", tool: "tekton", fix: true },
        "f-create-task": { cmd: "kubectl create tasks NAME -n {ns}", about: "create the Task a Pipeline references", tool: "tekton", fix: true },
        "f-cosign-sign": { cmd: "cosign sign --key k8s://drill-ci/cosign-key IMAGE", about: "sign an image with the platform key", tool: "platform", fix: true }
    };
    /* ── items ─────────────────────────────────────────────────── */
    var ITEMS = {
        scroll: { name: "Hint Scroll", about: "Names the next thing to inspect.", price: 30 },
        lens: { name: "Lens", about: "Reveals one piece of evidence outright, for no xp.", price: 60 },
        elixir: { name: "Elixir", about: "Restores half your health, mid-fight.", price: 40 },
        "sheet-kubectl": { name: "Cheat Sheet: kubectl", about: "Prints every kubectl technique's syntax in the terminal. Permanent.", price: 120, permanent: true },
        "sheet-argo": { name: "Cheat Sheet: Argo", about: "argocd and the rollouts plugin, syntax on demand. Permanent.", price: 120, permanent: true },
        "sheet-flux": { name: "Cheat Sheet: Flux", about: "flux get, tree, resume and reconcile. Permanent.", price: 120, permanent: true },
        "sheet-tekton": { name: "Cheat Sheet: Tekton", about: "tkn and the Tekton kinds. Permanent.", price: 120, permanent: true },
        "sheet-crossplane": { name: "Cheat Sheet: Crossplane", about: "trace and the composed Objects. Permanent.", price: 120, permanent: true },
        "sheet-platform": { name: "Cheat Sheet: platform", about: "Prometheus operator kinds, Kyverno policies, External Secrets, cosign. Permanent.", price: 120, permanent: true }
    };
    /* ── the level ladder: xp needed for each level, index 0 is level 1 ── */
    var LEVELS = [];
    for (var lv = 0; lv < 30; lv++)
        LEVELS.push(Math.round(60 * Math.pow(lv, 1.55)));
    /* ── the overworld: authored by tools' mapgen, a fixed piece of content ── */
    var TILES = { ".": "grass", ",": "flower", "#": "road", "~": "water", "^": "cliff", "T": "tree", "t": "town", "d": "door", "K": "keep", "G": "gate", "=": "bridge", "s": "sand" };
    var MAP = [
        "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~.TT.......................T.....,......~......T........T..T...........TT.TT...~..........T,.....,.......T......,....~~",
        "~~..............T..............T...T.....~.,......T.......TT.......T............~...........................,....T....~~",
        "~~.....................T...............T.~T.........,.......................T...~...........T...T....................T~~",
        "~~............T......T,..................~.............T......t##d##########....~..........T............t##d#####.....~~",
        "~~......t##d##############t##d####.^^^,..~.....t##d############...~~.......#..T,~.T...t##d###############.....,.#.....~~",
        "~~......#............,....#......#^^^^^..~......................~~~~~......#....~..............,................#.....~~",
        "~~T.T.T.#.,...............#,.....#^^^^^..~....T,................~~~~~.T...T#....~......T.....................T..#.....~~",
        "~~.....T........T.........#.T..,.#.^^^^..~..T...............T...~~~~~......#....~TT.......,....TT..~~~..........#,..T.~~",
        "~~.....T......TT.T.......T#......#.T^^..,~...................T...~~.T...T..#....~....,....T.T.T...~~~~~...TT....#.....~~",
        "~~.......T...TT...........#......#.......~..................T..............#....~.T.T.....T......~~~~~~.TT...T..#....T~~",
        "~~T....T...........T......#......#.......~......###########################t##d#=######...T......~~~~~~~........#T....~~",
        "~~............,........T..#....T.#.......~......#..............,................~.....#........T.~~~~~~.........#.....~~",
        "~~.....,.T.T.....T..T.....#..T...#..T....~......#....,.......T..................~.,...############=====#########t##d..~~",
        "~~,......T.......,........#.T....#.......~......#...TT..T.........T...,.........~.T..T#T..T........~~~.....T..T.......~~",
        "~~.......T.T............T.#......#.......~......#..,..............T.............~.T...#.....................T.......T.~~",
        "~~......,.....###################t##d####=#######,............,.................~.....#..............T...T...T.TT...T.~~",
        "~~............t##d#######.#..............~......#......,.....T......T....T......~.,.,.#........T......T...,T..........~~",
        "~~.,.T..T...............#.#..............~...,..t##d#############.......T..T...T~.....t##d###########..........TT..T,.~~",
        "~~......,T...TT....TT.T.#.#..............~...............T....T.#.....T....T....~.,.................#........T..^^....~~",
        "~~.,T....T..............#,#.....,........~.T...TT......T########t##d......T.....~T..........,..,....#......,.,^^^^^...~~",
        "~~.............T..T..T..#.#..T...........~.....T..TT..T.#.....T.#..............,~.T......,..########t##d....T.^^^^^..T~~",
        "~~..........T.........,.#T#TTT.........,.~T.....T.T.....#.T.....#...........T...~.T......TT.#..T...........T...^^^.T..~~",
        "~~,...T,T.........T.....#.#..............~...,..........#,.T...T#.......T.......~...T......T#.T.T..............^^.....~~",
        "~~......,.T...T.........#.#T.~~~,........~.......T.....T#.....,.#..........T....~.....T.....#.....T........T........T.~~",
        "~~..T....T..............#.#.~~~~~........~...........T..#.,.....#.......^^..TT..~...........#.........T.,.....T.......~~",
        "~~.....,...^^...........#.#~~~~~~~....T..~TT..T.T^^^....#T...T..#.TT..^^^^..,..T~........^^T#.........................~~",
        "~~.......T^^^^^......T..#.#~~~~~~~.......~.T.T..^^^^^...#.T.T...#...T.^^^^^....T~....,TT^^^^#...T......T...,.....T....~~",
        "~~.......^^^^^^.........#.#.~~~~~T.......~....T^^^^^^^,.#,......#.....^^^^......~......^^^^^#^..T.,...................~~",
        "~~T...TT.^^^^^^^..T.....#.#.~~~~~..T.,.T.~.....^^^^^^^.T#.......#.......^^....T.~......^^^^^#^........T.T..T,......T,.~~",
        "~~....T...^^^^^.........t##d#===####..T..~.....^^^^^^...#.....T.#......T........~T.....^^^^.#.............,.T........T~~",
        "~~........^^^^^....T......#........K.,..T~....T.^^^^^...t##d###############.....~.....T.^^^.t##d###############.......~~",
        "~~.T.......^^^............#.............T~.....T.^^^....#.......#.........K..T..~TT.......^.#........T..T.....K......T~~",
        "~~.T.......T..............#...T,..T......~..............#.....T.#,..T...........~...........#.............,T..........~~",
        "~~..T.....................#..T..,........~..............#T.T....#......,...T.T..~.....TT....#.........................~~",
        "~~..,T...............T..T.#.........T..T.~..........T...#.T.TT..#.,........T....~T..T.......#..........T..............~~",
        "~~.........TTT...T..T.....#.T............~..T,..........#T..#..T#TT..T.......T.T~...........#.....T.............T.T...~~",
        "~~....................,..T#....T........................#sss#sss#..T.,...T..T..........T..T.#......T,..T....T,....T...~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~~~=~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#sssGsss=~~~~~~~~~~~~~~~~~~~~~~~~~~~=~~~~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~~~=~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#sss#sss=~~~~~~~~~~~~~~~~~~~~~~~~~~~=~~~~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~.T....T..,...........T..#................T.....,......#sss#sss#..........T....T,.TT.......#..T,.....,.....T...TT,...~~",
        "~~....T.................T.#.T..T.T......,..............T#T..#T..#.........TT.....T.....T....#......T.T,.T...T......T..~~",
        "~~...........T.........T..#TT....T............T.###################......T.T..T.............#..TT....T..TT..T.........~~",
        "~~.,T.....T.,TT...T..T....#...TT.......,T.......#########..~~...#####...,...T.........T.#####.......T....T..T.........~~",
        "~~.,.........T...T..,.....#TT........T.......,..#........T.~~...TT#.#.....T....,........#....T......T.................~~",
        "~~......t##d###############....T................#..........~~.....##t##d################t##d################t##d.T....~~",
        "~~T.......################t##d##################t##d...T,..~~..T..#.......T...T.......,.........,.....T.T........T....~~",
        "~~.....^^^#..T........TT.......T.......,..............T..,.~~.....#.T.....................T.................^^^^^..T..~~",
        "~~,T..T^^^#.........T....T....,T............,,T.........T..~~..T..#.............,..T..T...........T.T..T,...^^^^^^....~~",
        "~~,...^^^^#.....T.............T.....TT.T.T....T....T.......~~.....#........T.......,......T.T...........T,.^^^^^^^....~~",
        "~~..T..^^^#............T................T...T......,..,....~~....T#.T..................T....TT....T...T,.,..^^^^^.....~~",
        "~~......^^#..T...........TT.TT.........TT...T.......T.....T~~.T.T.#T..........T.T....T......................^^^^^....T~~",
        "~~........#......................,...............^^^.......~~,..T.#.........T........^^^...........TT.T....TT.^^T,....~~",
        "~~........#............T.......,.T...........TT.^^^^.......~~.T...#.....,T........T,T^^^.....................T.....T..~~",
        "~~........#...TT...T......T..............,......^^^^^.....T~~.....#..............,..^^^^^...T......T..................~~",
        "~~........#..T..........................T....T...^^^^......~~..,..#..................^^^^..T.......,...T.......T......~~",
        "~~......T.#......................,T.....,..T......^^..T....~~..T..#.T.T.TT...........^^,TT............................~~",
        "~~........#.......T...............T.T......................~~T..T.#.....T..............T....T........................T~~",
        "~~..T.....#.......,..................T........T........T...~~.....#...........T..,...........,.........T........T....,~~",
        "~~T.......t##d#################.....T....T....,.....,....,#==#####t##d#################..........,...............T.T..~~",
        "~~.T,................,........#.......TT.......T.TT.......#~~...,.......T.............#............................T..~~",
        "~~.,TTT...TT............,.....t##d###############.........#~~..T..T.TT................t##d################t##d#.TTT...~~",
        "~~.T..T...........T,.~~~T,....#.....T...........#.T......T#~~.........T.............T.........T..T............#.......~~",
        "~~......T.......T...~~~~~T....#..........T......#.........#~~..........T..........TT.....,....T.......TTT.....#...T...~~",
        "~~....,............~~~~~~~....#......,...T.,....#....T....#~~............T...T..T....,........T..T...T....,...#T..,T..~~",
        "~~..T.T...#########=======######################t##d#######~~........................,...,.T...~~.............#T......~~",
        "~~........#......T.~~~~~~~....#......,.T........#..........~~......T.....T.....T.........T..~~~~~~......T...,.#.......~~",
        "~~......T.#.T.......~~~~~.....#...............T.#.........T~~.....T.TT,.TT.....T......T,,...~~~~~~~.,...T.....#...T.T.~~",
        "~~........#.......T..~~~.TT...#..T.....^^T......#.......TTT~~..........T.......T............~~~~~~~~.T..T.....#.,.....~~",
        "~~......T.#...,......TT.......###################..T......T~~.............^^....,.......,..~~~~~~~~~......T,..#....TT.~~",
        "~~...T....#...............TT.....,....^^^^^^T..............~~T...........^^^^^..,.....,....~~~~~~~~~....T.T...#.......~~",
        "~~........#........,..............T..^^^^^^^..T............~~....T.......^^^^^.........T....~~~~~~~T.......T..#.......~~",
        "~~T...T...K..,T........T..............^^^^^^...............~~.......T...T.^^^^T.............~~~~~~....T...T...K...T...~~",
        "~~............T.......,......T.TT.....^^^^^.T...T.T..T.....~~T...,...T.....^.T..............,.~~.........T.........T..~~",
        "~~........,...T,.......,,............T..^^TT........TTT..T.~~.T..,......T.............................T......T.T..T...~~",
        "~~................T.....TT..............T..,......T,,T.T...~~.......T........T...T................,.......TT..,.......~~",
        "~~.T...........T....T...T................T.............T...~~.........................T.........,T........T........T..~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"
    ];
    var REGIONS = [
        { d: 1, name: "Substrate Downs", boss: ["quota", "hpa-unknown"], keep: { x: 35, y: 32 } },
        { d: 2, name: "Reconcile Reach", boss: ["argocd-rev", "canary-analysis"], keep: { x: 74, y: 33 } },
        { d: 3, name: "Compositor Heights", boss: ["xp-provider-rbac", "xr-paused"], keep: { x: 110, y: 33 } },
        { d: 4, name: "Signal Fens", boss: ["otel-exporter", "netpol"], keep: { x: 10, y: 73 } },
        { d: 5, name: "Warden's March", boss: ["image-unsigned", "kyverno-deny"], keep: { x: 110, y: 73 } }
    ];
    // where each town and its dungeon door sit; the towns below read this
    var POS = { "1.1": { "x": 8, "y": 6, "door": { "x": 11, "y": 6 } }, "1.2": { "x": 26, "y": 6, "door": { "x": 29, "y": 6 } }, "1.3": { "x": 33, "y": 17, "door": { "x": 36, "y": 17 } }, "1.4": { "x": 14, "y": 18, "door": { "x": 17, "y": 18 } }, "1.5": { "x": 24, "y": 31, "door": { "x": 27, "y": 31 } }, "2.1": { "x": 47, "y": 6, "door": { "x": 50, "y": 6 } }, "2.2": { "x": 62, "y": 5, "door": { "x": 65, "y": 5 } }, "2.3": { "x": 75, "y": 12, "door": { "x": 78, "y": 12 } }, "2.4": { "x": 48, "y": 19, "door": { "x": 51, "y": 19 } }, "2.5": { "x": 64, "y": 21, "door": { "x": 67, "y": 21 } }, "2.6": { "x": 56, "y": 32, "door": { "x": 59, "y": 32 } }, "3.1": { "x": 86, "y": 6, "door": { "x": 89, "y": 6 } }, "3.2": { "x": 104, "y": 5, "door": { "x": 107, "y": 5 } }, "3.3": { "x": 112, "y": 14, "door": { "x": 115, "y": 14 } }, "3.4": { "x": 86, "y": 19, "door": { "x": 89, "y": 19 } }, "3.5": { "x": 100, "y": 22, "door": { "x": 103, "y": 22 } }, "3.6": { "x": 92, "y": 32, "door": { "x": 95, "y": 32 } }, "4.1": { "x": 8, "y": 46, "door": { "x": 11, "y": 46 } }, "4.2": { "x": 26, "y": 47, "door": { "x": 29, "y": 47 } }, "4.3": { "x": 48, "y": 47, "door": { "x": 51, "y": 47 } }, "4.4": { "x": 10, "y": 60, "door": { "x": 13, "y": 60 } }, "4.5": { "x": 30, "y": 62, "door": { "x": 33, "y": 62 } }, "4.6": { "x": 48, "y": 66, "door": { "x": 51, "y": 66 } }, "5.1": { "x": 68, "y": 46, "door": { "x": 71, "y": 46 } }, "5.2": { "x": 88, "y": 46, "door": { "x": 91, "y": 46 } }, "5.3": { "x": 108, "y": 46, "door": { "x": 111, "y": 46 } }, "5.4": { "x": 66, "y": 60, "door": { "x": 69, "y": 60 } }, "5.5": { "x": 86, "y": 62, "door": { "x": 89, "y": 62 } }, "5.6": { "x": 106, "y": 62, "door": { "x": 109, "y": 62 } } };
    var FINALE = { pool: SCENARIOS.map(function (s) { return s.id; }), pick: 3, keep: { x: 60, y: 39 } };
    var START = { x: 8, y: 8 };
    /* ── the towns: one per section, their people distilled from its panels ── */
    function town(sec, name, dungeon, blurb, npcs) {
        var p = POS[sec];
        return { sec: sec, name: name, blurb: blurb, x: p.x, y: p.y, door: p.door, dungeon: dungeon, npcs: npcs };
    }
    function npc(name, lines, teaches) { var n = { name: name, lines: lines }; if (teaches)
        n.teaches = teaches; return n; }
    var TOWNS = [
        /* ── Substrate Downs: domain 1 ── */
        town("1.1", "Portmouth", "svc-selector", "A harbour town where every road ends at a Service. The wiring here is what everything else stands on.", [
            npc("Harbourmaster Selda", ["A Service is not the thing that makes a Service work. The <code>EndpointSlice</code> behind it is, and the selector that fills it.", "A Service with no ready endpoints resolves fine and then refuses connections. Check in order: selector matches pod labels, pods are Ready, then the slice itself.", "<code>kubectl get endpointslices -l kubernetes.io/service-name=X</code> beats describe: it shows ready, serving and terminating per address."], "k-endpoints"),
            npc("Ropewalker Ines", ["Four rules of the network model: every pod gets its own routable IP, no NAT pod to pod, agents reach pods on their node, a pod sees its own IP as others do. The CNI is whatever makes those true.", "When those rules do not hold, nothing above them behaves. So the first fork in any network diagnosis is: CNI problem, or Service problem?", "Labels beside names is how you match a selector by eye. Learn to read <code>--show-labels</code> quickly."], "k-labels"),
            npc("Old Resolver Bram", ["Names are <code>svc.ns.svc.cluster.local</code>, served by CoreDNS behind a Service still called kube-dns. Pods get <code>ndots:5</code>, so short names cost several lookups.", "DNS fails quietly. Every pod Running, every probe green, and nothing resolves. No listing shows it. You find it by making something try: an nslookup from inside the pod."], "k-exec-dns"),
            npc("Gatewright Tamsin", ["NetworkPolicies select pods, never Services. A pod is isolated the moment any policy selects it for a direction. Rules are additive allow-lists: there is no deny, so you tighten only by removing.", "An <code>ipBlock</code> naming a ClusterIP never matches: DNAT rewrites the destination to a pod IP before policy is evaluated. That one fact explains a whole family of 'my policy does nothing' tickets.", "Gateway API splits the roles Ingress mashed together, and grades your work with conditions: Accepted, Programmed, ResolvedRefs. Read those three before guessing."])
        ]),
        town("1.2", "Millrace", "hpa-unknown", "Water wheels and CPU cycles. Two numbers per container decide everything here: what you request and what you are limited to.", [
            npc("Miller Osk", ["A request is a claim against the scheduler's arithmetic. A limit is a ceiling the kernel enforces at runtime. Nothing reconciles the two afterwards, which is how a node can be 30% used and 100% requested at once.", "The scheduler sums requests against allocatable, never live usage. A node at 5% CPU with every millicore requested is completely full."], "k-nodes"),
            npc("Throttled Pell", ["CPU is compressible: past the limit, CFS stops giving you cycles until the next period. Latency stalls that look like network problems are throttling; <code>container_cpu_cfs_throttled_periods_total</code> is where the truth lives.", "Memory is incompressible. There is no slow down, only the OOM kill. In a crash-looping Deployment the evidence is in <code>lastState.terminated.reason</code>, not <code>state</code>; read the wrong field and you will swear there was no OOM.", "<code>kubectl top</code> is the live view: what a pod uses now, from metrics-server. Compare it with what it asked for."], "k-top"),
            npc("Scheduler Wren", ["Under memory pressure the kubelet evicts pods whose usage exceeds their requests first, then by priority, then by how far over they are. QoS class is a consequence of that first test, not an input.", "Taints repel, tolerations only permit; nothing attracts. Pair a taint with nodeAffinity to dedicate a pool. And read the node labels before writing a spread constraint against a key no node carries."]),
            npc("Autoscaler Dree", ["The HPA scales replicas on a metric; the VPA rewrites requests; the cluster autoscaler adds nodes. Three scalers, three jobs. Do not ask one to do another's.", "A percentage of a request needs a request. An HPA targeting CPU utilisation on a container with no CPU request reports <code>&lt;unknown&gt;</code> forever, and its conditions say exactly why.", "<code>kubectl describe hpa</code>: the ScalingActive condition names what could not be computed."], "k-hpa")
        ]),
        town("1.3", "Vaultbrook", "pvc-pending", "Cellars and claims. Three objects, one relationship, and four states you will be asked to explain.", [
            npc("Cellarer Maud", ["A PersistentVolume is real storage. A PersistentVolumeClaim is a request for one. A StorageClass is the recipe, and its provisioner names the code that cooks it. Dynamic provisioning is the assumed default.", "<code>kubectl get sc</code> first, every time: provisioner, reclaim policy, binding mode and expansion in one line. Then <code>kubectl get pvc -A</code> for anything not Bound."], "k-sc"),
            npc("Patient Ilse", ["A claim on a <code>WaitForFirstConsumer</code> class stays Pending until a pod that uses it is scheduled. That is not a fault. It is the class considering topology so the volume lands where the pod can reach it.", "PVC Pending with no events is WaitForFirstConsumer with no pod yet. PVC Pending with a provisioning error is a controller-side message. Pod stuck ContainerCreating with a mount error is node-side. Three states, three causes."]),
            npc("Finalizer Grett", ["<code>pvc-protection</code> blocks deleting a claim a pod mounts; <code>pv-protection</code> blocks deleting a bound PV. The fix is never to strip the finalizer. Remove the consumer and let the controller clean up.", "RWX is a property of the backing storage, not a wish. Requesting it does not turn a local disk into a shared filesystem. RWOP is the strict one: exactly one pod, enforced by the scheduler."]),
            npc("Backup Warden Coll", ["StatefulSets exist for stable identity and stable storage: every replica gets its own PVC, and deleting the set keeps them, so scaling back up reattaches the old data.", "GitOps rebuilds manifests, never the contents of a PV. Snapshots, a backup tool like Velero, or the operator's own backup story fill that gap. Delete for ephemeral tenant work, Retain for anything whose loss ends in a postmortem."])
        ]),
        town("1.4", "Fencehold", "quota", "Fences around every plot. A namespace is a folder; a tenant is a namespace with a stack of controls attached.", [
            npc("Reeve Anselm", ["ResourceQuota caps the namespace total: requests, limits, object counts, storage per class. A quota naming <code>requests.cpu</code> rejects any pod that fails to declare one.", "Quota is enforced by admission against a usage cache, so the failure appears one level down: the Deployment applies fine, the ReplicaSet logs 'exceeded quota', replicas stall. Describe the ReplicaSet, not the Deployment.", "<code>kubectl describe quota</code>: used against hard, one line per resource. Whichever line binds is the answer."], "k-quota"),
            npc("LimitRanger Bea", ["LimitRange fills in per-container defaults and bounds, so a bare pod arrives at the quota check with numbers attached. Mutating admission runs before validating admission: LimitRanger injects, then quota and policy validate.", "Being able to name the refusing control from one line of error text is the difference between fixing the right object and guessing."]),
            npc("Fencer Dov", ["Default-deny plus explicit allows. team-a allows same-namespace traffic and DNS to kube-dns, nothing else. Additive allow-lists mean a missing rule looks exactly like a rule that was never there.", "A cross-namespace call needs an egress allow on the caller's side and an ingress allow on the callee's. Read every policy that selects the pod, rule by rule."], "k-netpol"),
            npc("Ladder-keeper Sunniva", ["Multi-tenancy is a ladder, not a switch: namespaces with quota, policy and RBAC; then dedicated node pools by taint; then virtual clusters; then separate clusters. Each rung costs idle capacity.", "A PriorityClass decides who is evicted when the cluster is full. Platform components should outrank tenant workloads: a tenant that can preempt your metrics stack can blind you.", "The default ServiceAccount should have nothing attached, and quota should cap what costs money outside the cluster: LoadBalancers, PVCs, NodePorts."])
        ]),
        town("1.5", "Ledgerton", "resources", "A counting house. Cost is max(request, usage) times price times hours, sliced every way OpenCost can slice it.", [
            npc("Accountant Voss", ["For each container: <code>cost = max(request, usage) × unit price × hours</code>, summed over CPU, memory, storage and network, attributed to namespace, label or owner. Everything OpenCost shows is that expression.", "Why is my namespace expensive when nothing runs? Because request won the max. Requests, not usage, drive spend."]),
            npc("Right-sizer Quill", ["The loop is the competency: measure usage, compare with requests per container, adjust, then confirm nothing degraded. Right-sizing that introduces throttling or OOM kills is worse than the waste it removed.", "Memory to roughly peak plus headroom. CPU to a sane request with a generous or absent limit. Then <code>kubectl set resources</code>, or better, the manifest in git.", "A request no node can satisfy is a Pending pod forever. The scheduler's FailedScheduling event lists why every node refused."], "f-set-res"),
            npc("Bin-packer Hal", ["Idle capacity is unrequested space on nodes you bought whole. OpenCost can show it separately or spread it across tenants. Separate makes the platform team accountable for packing; spread makes tenants feel the true cost. Neither is wrong.", "Object sprawl bills whether or not traffic flows: LoadBalancers, PVs, snapshots, forgotten namespaces. That is why quota is a cost tool, not just fairness.", "Right-size the pods, then right-size the nodes. Say it in that order."]),
            npc("Metrics Clerk Oda", ["OpenCost joins pod and node inventory with Prometheus series and a price list. A broken scrape shows up as missing cost, not as an error. 'Why is this namespace zero' is a Prometheus problem.", "<code>kubectl cost --opencost</code>: forget the flag and it looks for Kubecost and fails in a way that looks like OpenCost is broken. Use <code>--window 1d</code> for stable numbers."])
        ]),
        /* ── Reconcile Reach: domain 2 ── */
        town("2.1", "Commitvale", "tekton-trigger", "Every change here arrives as a commit. The valley reconciles, forever, whether you watch or not.", [
            npc("Archivist Lenne", ["Four nouns: declarative, versioned and immutable, pulled automatically, continuously reconciled. Graders like those words; learn them and you can rebuild the sentences.", "A change made with kubectl edit does not fail. It gets reverted on the next loop if self-heal is on, or reported as drift if not. 'Why did my manual fix disappear' is the canonical ticket."]),
            npc("Pull-agent Ferro", ["CI pushing manifests needs cluster credentials outside the cluster and only knows the state at deploy time. A pull-based agent keeps credentials in-cluster and never stops comparing.", "CI builds and tests and, at most, opens a pull request that bumps an image tag. CD is the agent reconciling git. A Jenkins job running kubectl apply against production fails all four properties: say all four.", "A webhook is how a git event reaches a pipeline. When webhooks stop landing, the receiver's pod and its permissions are the first two things to read."], "tkn-list"),
            npc("Overlay-smith Brann", ["Kustomize layers patches over a base with no templating: what you see is YAML all the way down, and <code>kustomize build</code> shows exactly what will be applied. Helm renders from values and is a release manager too.", "Never push an overlay you have not built locally. <code>kustomize build</code> and <code>helm template</code> work offline in the exam terminal.", "Plain Secrets cannot live in git. Sealed Secrets encrypt for git; External Secrets keeps pointers in git and truth in a store; SOPS encrypts values the agent decrypts."]),
            npc("Watchman Tobe", ["Failure modes to recognise on sight: two controllers on one resource is an infinite war; a manual fix disappears because self-heal did its job; prune deletes production when you delete a file; immutable fields need delete and recreate.", "Stale but green: suspended reconciliation, a lost webhook, a long interval. Everything healthy and nothing current. Always check when it last synced before believing a green dashboard."])
        ]),
        town("2.2", "Argo Harbor", "argocd-rev", "Ships named Application, each with two flags: sync status and health status. Know both, and know which pod's logs to read.", [
            npc("Pilot Marisol", ["Two status axes. Sync says whether live matches git; health says whether what is live is working. Every combination means something different and has one right first move.", "Git said run a broken image, and the cluster faithfully runs it broken: Synced and Degraded. Clicking sync again does nothing. The fix is a commit.", "<code>argocd app get</code> shows both axes, the conditions and the resource tree. Conditions are where a compare failure speaks."], "argo-get"),
            npc("Revision Clerk Hux", ["For targetRevision, HEAD or a branch means whatever moves there; a tag or SHA means immutable. A ref that does not exist means a ComparisonError: nothing renders, so nothing syncs, and sync status reads Unknown.", "When a task says the app will not sync, the first fork is: did rendering fail in the repo-server, or did applying fail in the controller? The message tells you which pod's logs to read.", "<code>argocd app set --revision</code> moves the target; <code>--refresh</code> forces a re-compare, <code>--hard-refresh</code> drops the manifest cache too."], "f-argo-set"),
            npc("Wave-caller Dima", ["Manual sync waits for a human. <code>automated.selfHeal</code> reverts live drift. <code>automated.prune</code> deletes what vanished from git: without it a renamed resource lives forever, with it a deleted file deletes production.", "Sync runs in phases, and in waves within the Sync phase: lower <code>sync-wave</code> first, and Argo waits for each wave to be healthy. Hooks are ordinary manifests annotated PreSync, Sync, PostSync."]),
            npc("Fleet Admiral Roque", ["An AppProject is a policy boundary: which repos, which destinations, which kinds. App-of-apps is one Application whose manifests are Applications. An ApplicationSet stamps them out from generators: list, clusters, git, scmProvider, pullRequest.", "Read a generator block and predict exactly which Applications will exist. That is the testable skill.", "<code>argocd app list</code>: every app, both axes, the target revision. The whole fleet in one table."], "argo-list")
        ]),
        town("2.3", "Fluxmoor", "flux-suspend", "A toolkit of small controllers on a wide moor. Sources fetch, appliers apply, and a suspended one just sleeps.", [
            npc("Source-keeper Yrsa", ["Flux is small controllers composed by reference: a GitRepository fetches, a Kustomization applies a path from it, a HelmRelease installs a chart. One source can feed many Kustomizations.", "<code>flux get sources git</code> tells you what the source controller last fetched. If the revision is fresh and nothing applied, the fault is downstream."], "flux-src"),
            npc("Moorwarden Cael", ["<code>flux get kustomizations</code> has a SUSPENDED column. A suspended Kustomization is skipped entirely: no drift correction, no prune, no error. Its Ready condition is a memory of the last run.", "Never delete a suspended Kustomization: its prune finalizer only runs on reconcile. Resume it first.", "<code>flux resume kustomization X</code> wakes it, or patch <code>spec.suspend</code> back to false."], "flux-ks"),
            npc("Translator Piet", ["Flux's Kustomization is kustomize.toolkit.fluxcd.io and points at a directory. Kustomize's Kustomization is kustomize.config.k8s.io and lives in that directory. Exam tasks love that ambiguity.", "The translation table: Application is Kustomization plus GitRepository; sync waves are dependsOn; selfHeal is the default; prune is a field. Practise crossing it both ways."], "f-flux-resume"),
            npc("Tree-reader Solvi", ["<code>flux tree kustomization X</code> lists what a Kustomization applied, object by object. An object missing from the cluster shows up right there.", "<code>flux reconcile kustomization X --with-source</code> reconciles now, source first. On a suspended one it does nothing, and says so."], "flux-tree")
        ]),
        town("2.4", "Pipewright", "tekton-task", "Pipes and steps. Every failure you will ever debug here is a container in a pod that exited non-zero.", [
            npc("Master Pipewright Aldo", ["A Task is steps, containers sharing one pod. A Pipeline sequences Tasks. Running either means a TaskRun or a PipelineRun. That is the whole object model.", "A Pipeline referencing a Task that does not exist fails instantly with reason <code>CouldntGetTask</code>. The run's Succeeded condition carries the message and the missing name.", "<code>tkn pipelinerun describe</code>: the message, the taskruns, the skipped tasks. <code>kubectl get pipelinerun -o jsonpath='{.status.conditions[0].message}'</code> is the scriptable form."], "tkn-desc"),
            npc("Journeyman Kip", ["Params have types and defaults. Results are small and travel through status: a digest or a count, never a log. Workspaces are bound at run time by the PipelineRun.", "Tasks with no runAfter and no shared results run in parallel. Consuming a result creates an implicit dependency; if order matters, say it with runAfter.", "<code>kubectl get tasks</code> shows what a Pipeline can reference. Compare the list with the refs."], "tkn-tasks"),
            npc("Trigger-hand Nessa", ["Three CRDs turn a push into a run: an EventListener receives the webhook, a TriggerBinding extracts fields, a TriggerTemplate stamps out the PipelineRun. Interceptors filter and verify before anything runs.", "The listener pod runs as a ServiceAccount and lists Triggers resources on start. Take away its RoleBinding and it crashloops with 'forbidden' in its logs, over and over."]),
            npc("Kaniko Rin", ["The pipeline pushes to <code>kind-registry:5000</code> from inside the cluster, where localhost is the pod itself. From the host the same store is localhost:5001. Know which name works from where.", "Every step is a container named step-NAME in the TaskRun's pod, so <code>kubectl logs POD -c step-build</code> works when tkn is unhelpful. Completed runs are immutable: fix the definition, then start a fresh run."], "f-tkn-start")
        ]),
        town("2.5", "Canary Cross", "canary-analysis", "A crossroads where two versions serve at once. The question is always: what actually shifts the traffic?", [
            npc("Signalman Ivo", ["Argo Rollouts without a traffic provider approximates a canary by replica count: 20% weight is 20% of the pods, and the split is statistical. With a mesh or Gateway API the split is a route weight, exact and independent of replicas.", "A Rollout is a Deployment with a richer strategy. It owns a stable ReplicaSet and a canary one, which is why <code>kubectl get rs</code> during a rollout is so legible.", "<code>kubectl argo rollouts get rollout</code> draws the tree: revisions, ReplicaSets, AnalysisRuns, each with its status."], "ro-get"),
            npc("Oracle Beatrix", ["An analysis step runs an AnalysisTemplate: a metric provider, a query, a success condition, error limits. Every measurement lands in an AnalysisRun, and a run that errors aborts the rollout.", "Choose metrics the user feels: success rate and latency over the canary's own series. An analysis that measures the stable version will happily promote a broken release.", "<code>kubectl get analysisruns</code>, then describe the newest: the error message names the address it could not reach."], "ar-get"),
            npc("Flagger Ottilie", ["Flagger inverts the model: you author a plain Deployment, and its Canary resource generates the primary Deployment, the Services and the routing, then shifts real traffic. Between rollouts your Deployment sits at 0/0 and that is the system working.", "A canary with no traffic produces no metrics. Flagger's load-test webhook is what makes an analysis measurable."]),
            npc("Retry-master Gus", ["Fix the template, then retry: <code>kubectl argo rollouts retry rollout X</code>. Retrying against the same broken address fails the same way.", "Cannot afford double capacity: canary. Need instant rollback and a clean cutover: blue-green. Per-user comparison: A/B, which needs L7. And if you abort without reverting git, the next sync re-applies the bad image."], "f-ro-retry")
        ]),
        town("2.6", "Driftwatch", "image", "A watchtower over the reach. Bucket first, then descend: the expensive mistake is fixing in the wrong layer.", [
            npc("Watch Captain Hedda", ["Four buckets. Synced and Degraded: the controller did its job, fix the commit. Sync fails outright: the API server rejected something, read its message. Controller trouble: repo, credentials, its own RBAC. Stale but green: nothing current.", "Say the bucket out loud before you touch anything. It costs three seconds and it stops you editing live state when the problem is a commit."]),
            npc("Image-reader Tancred", ["Synced plus Degraded is a bad image tag, an impossible request, a missing ConfigMap key, a probe that cannot pass. Pod events carry the real error: ImagePullBackOff, CreateContainerConfigError, FailedScheduling.", "<code>kubectl get deploy -o yaml</code> shows the template as it is, tag and all. Compare it with the events, and the fix writes itself."], "k-yaml"),
            npc("Drift-hunter Mab", ["With self-heal on, drift self-corrects and the question becomes what keeps recreating this thing. Owner references or the <code>app.kubernetes.io/instance</code> label prove it. With self-heal off, <code>argocd app diff</code> is the tool.", "Compare rendered manifests with live objects rather than reading source YAML: <code>argocd app manifests</code> catches overlay mistakes that review misses."], "argo-diff"),
            npc("Set-image Roald", ["A wrong tag is fixed where it lives: the Deployment's template. <code>kubectl set image deploy/X container=image:tag</code> does it; deleting the pod only makes another from the same template.", "In GitOps the real fix is the commit, and the live edit is drift the controller will revert. Know which one you are doing, and say so."], "f-set-image")
        ]),
        /* ── Compositor Heights: domain 3 ── */
        town("3.1", "Thinvale", "xr-paused", "The thinnest viable town. Vocabulary and judgement live here, and the paper's own words are the answer key.", [
            npc("Elder Corvin", ["A platform is an integrated collection of capabilities, defined and presented according to the needs of its users. The key word is users: a product with internal customers, not an infrastructure inventory.", "Thinnest Viable Platform: the smallest layer that provides consistency and accelerates delivery, kept small on purpose. Platform teams build interfaces; they should not rebuild capabilities."]),
            npc("Pathfinder Elke", ["A golden path is a templated composition of well-integrated code and capabilities, documentation included. Paved, not mandatory.", "Self-service: a user requests a capability and receives it automatically, no human in the loop. Every tool in this region is a different way to deliver that property.", "Capability is the thing offered; the interface is how. A portal over a ticket queue is a nicer ticket queue."]),
            npc("Contract Scribe Nils", ["Designing an API is five decisions: abstraction level, validation at admission, status reporting, deliberate versioning, documentation in the schema. Write the ten-line YAML your user will type before you write the schema.", "A platform API without a meaningful READY column is user-hostile, and the support burden lands on you.", "<code>kubectl explain KIND</code> is the documentation your users will actually read, because it is where they already work."], "k-explain"),
            npc("Maturity Assessor Ada", ["Provisional, operational, scalable, optimizing. Tickets and a shared spreadsheet is operational at best.", "Anti-patterns to name: the platform as a gate, the leaky abstraction, the mandated platform, the rebuilt wheel."])
        ]),
        town("3.2", "Schemastead", "xp-provider-rbac", "A town of scribes. A CRD exists without a controller: typed, validated, RBAC-aware, documented, and doing nothing at all.", [
            npc("Scribe Halvard", ["A CRD is group plus names plus scope plus versions. The metadata name must be exactly <code>plural.group</code>; getting that wrong is the most common first error.", "Deprecating a version means served true with storage moved on; removing it means served false. Different schemas need conversion: None or a Webhook."]),
            npc("Validator Ysolde", ["The schema is OpenAPI v3: types, required, enum, pattern, ranges, defaults. <code>x-kubernetes-validations</code> adds CEL rules with human messages: cross-field constraints, immutability with <code>self == oldSelf</code>.", "Anything not in the schema is silently pruned on write. Users say 'my setting is ignored'; the truth is it was never stored."]),
            npc("Status-keeper Ferdi", ["<code>subresources.status</code> splits /status into its own endpoint: writes to the main resource ignore status, writes to /status ignore the rest. The classic 'my controller's status writes vanish' is the subresource working.", "<code>additionalPrinterColumns</code> decide what kubectl get shows. Wait for the Established condition before using a new kind."]),
            npc("Explorer Bo", ["Three commands operate an operator you have never met: <code>kubectl api-resources | grep TOOL</code> for the nouns, <code>kubectl explain KIND --recursive</code> for the schema, <code>kubectl get crd NAME -o yaml</code> for columns and validation.", "Crossplane's XRD and kro's ResourceGraphDefinition generate CRDs for you: the same thing you hand-write here, produced by a higher-level API."], "k-get")
        ]),
        town("3.3", "Loopwell", "xr-paused", "A well that never stops turning. Observe, compare, step, write status, requeue.", [
            npc("Loop-tender Marek", ["A controller watches a kind and runs the same function for each object: observe actual state, compare with desired, take one step, write status, requeue. It acts on the state it finds, not the event that woke it.", "Missed events cost nothing, duplicates are harmless, and the loop is safe to restart. That is level-based reconciliation, and it is why deleting things is so often safe."]),
            npc("Condition Reader Alva", ["Conditions are typed: type, status, reason in CamelCase, message for you, lastTransitionTime, observedGeneration. Ready is the summary; the others say which phase is stuck.", "If observedGeneration lags metadata.generation, the controller has not processed your edit and status describes a previous spec. Check it first; almost nobody does.", "<code>kubectl describe</code> puts conditions and annotations on one screen. A paused annotation and a ReconcilePaused reason are two lines apart."], "k-describe"),
            npc("Owner-tracer Jory", ["Operator-created resources carry ownerReferences. That answers what keeps recreating this thing, drives cascade deletion, and lets you rebuild the object tree without documentation.", "A deletion stuck in Terminating has a finalizer, and a controller doing teardown, or dead. Find whose finalizer and why its controller is not running. Stripping it leaks whatever the teardown owned."]),
            npc("Level-setter Gwen", ["Operator capability levels: basic install, seamless upgrades, full lifecycle, deep insights, auto-pilot. A yardstick when a scenario asks whether to adopt an operator or run something yourself.", "A dead controller means nothing converges. A dead webhook with failurePolicy Fail means nothing it matches can be written. Different failure modes; know which one you are looking at."])
        ]),
        town("3.4", "Stepstone", "xp-provider-rbac", "Stepping stones across a stream: run to completion, not converge forever.", [
            npc("Ferryman Osric", ["A workflow runs to completion; a controller converges forever. That distinction is the whole decision table: stamp this out once when asked is a workflow, keep this true for three years is an operator.", "The controller here watches the argo and default namespaces. A Workflow created elsewhere sits untouched forever and looks exactly like a broken controller."]),
            npc("Template-keeper Ines", ["A Workflow is an entrypoint and templates: container, script, resource, dag, steps. Parameters flow between tasks through outputs; when gates branches; withItems fans out.", "A WorkflowTemplate with typed, defaulted, documented parameters is an API. A Workflow with hard-coded values is a script you happened to run in a pod."]),
            npc("Forbidden Fenn", ["Workflow pods run as a ServiceAccount. A resource template that creates namespaces needs cluster-scoped rights that default does not have. A Forbidden error inside a workflow node is an RBAC problem, not a workflow problem.", "Every workflow ServiceAccount needs create and patch on <code>workflowtaskresults.argoproj.io</code>, or a perfectly correct workflow fails before your real permission problem surfaces.", "<code>kubectl auth can-i --list --as=system:serviceaccount:NS:SA</code> asks the API server the question the pod is asking."], "k-cani"),
            npc("Grader Pim", ["Grade a provisioning task twice: the workflow reached Succeeded, and the objects it was supposed to create exist with the right content. A green workflow that produced nothing is still a failure.", "Idempotency is your job: resource templates with action apply, or a when guard on an existence check. Workflows do not reconcile."])
        ]),
        town("3.5", "Crossplain", "xp-provider-rbac", "A wide plain where an XRD promises, a Composition fulfils, and an XR is the ten lines a developer types.", [
            npc("Composer Idunn", ["XRD is the API you promise. Composition is the recipe: a pipeline of functions producing composed resources. XR is an instance a developer creates. Crossplane generates the CRD and reconciles each XR forever.", "Failure bubbles bottom-up: a composed resource fails, its condition says why, the XR's Ready goes False with a summary. The read path is XR conditions, then composed resource conditions, then the underlying object's error.", "<code>crossplane beta trace KIND NAME</code> draws the composite and everything it composed, with Synced and Ready per row."], "xp-trace"),
            npc("Provider-wright Sefton", ["Providers are controllers for external APIs; Functions are pipeline steps. A ProviderConfig tells a provider how to authenticate. Step zero of any diagnosis: every package Installed and Healthy.", "provider-kubernetes acts on the cluster with its own ServiceAccount's rights. Take away the ClusterRoleBinding and every composed Object fails to observe with 'forbidden' in its Synced condition.", "<code>kubectl get objects</code> shows the composed Objects: which kind, which ProviderConfig, synced, ready."], "xp-objects"),
            npc("Version-keeper Runa", ["This is Crossplane v2: namespaced XRs, no claims, the pipeline in the Composition. A namespaced XR uses the namespaced Object variant, kubernetes.m.crossplane.io, authenticated by ClusterProviderConfig.", "<code>kubectl explain composition.spec</code> settles a version-skew argument in three seconds."]),
            npc("Pause-warden Teo", ["The <code>crossplane.io/paused: true</code> annotation stops reconciliation entirely: Synced False, reason ReconcilePaused, and no spec change reaches the composed resources.", "Removing an annotation is <code>kubectl annotate KIND NAME key-</code>, with the trailing dash. Editing the composed resources by hand is drift the next reconcile erases."], "f-annotate")
        ]),
        town("3.6", "Goldpath", "xr-paused", "A paved road from a form to a running workload. Each hop is a thing that can break.", [
            npc("Orchestrator Kel", ["kro occupies Crossplane's niche with less apparatus: one ResourceGraphDefinition declares a schema and the resources it expands to, with CEL wiring the fields. No providers, no functions, no packages.", "Both sentences are true: same result, one file, no providers; and no provider ecosystem, no connection secrets, alpha-grade stability."]),
            npc("Portal-keeper Sanne", ["Backstage is the portal half: a software catalog, software templates with a scaffolder, TechDocs, plugins. A template commits to git, an ApplicationSet notices, an app deploys.", "Narrate the chain hop by hop: template action, generator filter, generated Application's destination, the workload itself. Each hop is a thing you may be asked about.", "<code>kubectl get KIND -o wide</code> shows the extra columns: node, IP, images. The cheapest way to see what a hop actually produced."], "k-wide"),
            npc("Decider Frode", ["Three questions choose the engine. Forever or once? An API object, a schedule, a git event, or a human? A developer writing YAML, clicking a form, or another system?", "When two engines both work, say so and pick the thinnest one. That is the TVP instinct applied to your own tooling."]),
            npc("Brace-smith Ulla", ["Keep kro's substitutions in block style. Inside flow braces the expression's own brace closes the map early and the whole manifest fails to parse with a message that points nowhere.", "kro's API moves. <code>kubectl explain resourcegraphdefinition.spec</code> is the arbiter when the manifest disagrees with your version."])
        ]),
        /* ── Signal Fens: domain 4 ── */
        town("4.1", "Scrapeholm", "servicemonitor-labels", "An island of targets. What to scrape is declared, not configured, and a selector decides who is heard.", [
            npc("Scraper Ingrid", ["Prometheus scrapes endpoints on an interval into a local TSDB. Each series is a name plus labels, and every distinct label combination is a series: cardinality is the resource you manage.", "A ServiceMonitor says scrape the endpoints of Services matching these labels, on this port name, at this path. A PodMonitor does it without a Service. It selects Services by label, never pods.", "<code>kubectl get servicemonitors -A --show-labels</code>: every declaration and the labels the operator selects on."], "k-smon"),
            npc("Selector Ansgar", ["Prometheus only picks up ServiceMonitors matching its own serviceMonitorSelector. On a stock install that is the release label. A perfect monitor without it is silently ignored: no error, no event, no target.", "Read the Prometheus object's selector before blaming the monitor. The namespace selector is the second half of the same trap.", "<code>kubectl get prometheus -n monitoring -o yaml</code>: the selectors are in the spec."], "k-prom"),
            npc("Port-namer Liv", ["Port name, not number. The monitor's endpoints[].port is the Service's port name. An unnamed port cannot be referenced, and the monitor matches while scraping nothing.", "Four causes of a missing target: the selector, the port name, no endpoints behind the Service, RBAC or network policy in the way. Diagnosis order: Status, Targets, then <code>up{job=...}</code>, then those four."]),
            npc("Query-writer Sten", ["<code>rate</code> first, then <code>sum by</code>. A range selector makes a range vector, required by rate and forbidden everywhere else. <code>absent(x)</code> is how you alert on a metric that stopped existing.", "<code>count(up == 0)</code> is the cluster's own health check. Any 'is monitoring healthy' question starts there."])
        ]),
        town("4.2", "Bellmarsh", "alert-never-fires", "A marsh with a bell tower. Thresholds and durations are Prometheus; grouping and routing are Alertmanager.", [
            npc("Bell-ringer Osk", ["A PrometheusRule holds groups of rules. An alerting rule is an expression plus <code>for</code>, labels for routing and annotations for humans. Inactive, then Pending while for elapses, then Firing.", "Pending alerts appear on the Alerts page and nowhere else. They have not been sent. Add evaluation interval plus for plus group_wait before concluding alerting is broken.", "<code>kubectl get prometheusrules -A --show-labels</code>: which rule files exist, and which carry the label the ruleSelector wants."], "k-rules"),
            npc("Rule-selector Maren", ["Rules are only evaluated if they match the Prometheus object's ruleSelector. An unmatched rule produces no evaluation and no error. Yet another place where a selector silently decides.", "Ask Prometheus itself what it loaded: its rules API, or the rulefiles ConfigMap the operator renders. If your group is not there, no threshold matters."]),
            npc("Router Bjarne", ["Routing happens first: an alert descends the route tree to the most specific match, and that route decides the group and the timers. Only then do inhibition, silences and de-duplication run.", "Silences mute notification, never truth. Inhibition suppresses alerts when a related, more severe one fires. The Watchdog fires always: a dead man's switch for the pipeline itself."]),
            npc("Symptom-seeker Wen", ["Alert on symptoms the user feels, not on every cause. If nobody would act at 3am it is a dashboard panel. A <code>runbook_url</code> annotation is the cheapest reliability improvement there is.", "Burn-rate alerting, fast and slow windows, pages on error budget consumption instead of arbitrary thresholds. Even the phrase multi-window multi-burn-rate says you have read the material."])
        ]),
        town("4.3", "Lanternquay", "config", "Lanterns along a quay. Dashboards ship as code here, and logs are stored by label, not by content.", [
            npc("Provisioner Hilde", ["Grafana dashboards are provisioned, not clicked together: a sidecar watches ConfigMaps labelled <code>grafana_dashboard: \"1\"</code> and loads the JSON inside. That is why forty dashboards exist without anyone making them.", "Lead with the symptom. RED for services, USE for resources, the four golden signals if you prefer. Template over variables so one dashboard serves every tenant."]),
            npc("Log-keeper Amund", ["Loki indexes labels, not content: streams are stored against a small label set and content matching scans at query time. Every query starts from a label selector. Label cardinality is what you must keep small.", "Collection is Alloy tailing pods through the kubelet and pushing to Loki. A running Loki with no shipper looks healthy and holds nothing."]),
            npc("Stern Watcher Kaja", ["<code>kubectl logs --previous</code> is the only way to read a crashed container's last words. stern tails many pods at once. Loki is for an hour ago across the fleet; kubectl is for right now.", "A container that never started has no logs at all. ContainerCreating for minutes means the kubelet cannot finish setting the pod up, and the reason is in the events."], "k-logs-prev"),
            npc("Question-asker Rurik", ["Metrics answer how much and how often, cheaply, over long windows. Logs answer what exactly happened to this one thing. Traces answer where in the request path it went wrong.", "Find the error message is a log question. How many failed is a metric question. Which hop was slow is a trace question. Knowing which you are asking picks the tool."])
        ]),
        town("4.4", "Spanbridge", "otel-exporter", "A bridge of spans. A trace is only a trace if context propagated, and the collector is where the platform team decides what happens to it.", [
            npc("Bridge-keeper Signe", ["A trace is one request's journey; a span is one timed operation within it, with a trace ID, its own span ID and a parent. A trace is a tree, and the root span is the entry point.", "Context propagation links spans across services: the caller injects <code>traceparent</code>, the callee extracts it. Broken propagation looks like many single-span traces, none joined."]),
            npc("Collector Vidar", ["The collector is the platform's control point: receivers take telemetry in, processors batch and redact, exporters send it on. A pipeline is those three lists, and spans leave through the exporters list.", "A pipeline whose only exporter is debug logs every span and sends it nowhere. The app says it sent, the collector says it received, and Jaeger stays empty.", "<code>kubectl get opentelemetrycollector -o yaml</code>: read the service.pipelines block before anything else."], "k-otel"),
            npc("Address-keeper Nora", ["The in-cluster OTLP endpoints are <code>otel-collector.tracing.svc:4317</code> for gRPC and 4318 for HTTP. Memorise the shape svc.ns.svc:port; every tracing task starts by knowing the address.", "Jaeger's collector listens on the same ports next door. If the destination exists and is idle, the fault is in what points at it."]),
            npc("Injector Halla", ["Auto-instrumentation is an annotation on the pod template that makes a webhook inject the language agent at admission. Annotate the Deployment's own metadata and nothing happens; annotate running pods and nothing happens until they restart.", "Those two mistakes account for most 'the annotation does nothing' reports, and both are one-line fixes once you know where to look."])
        ]),
        town("4.5", "Doramere", "probe", "A lake with four gauges. Delivery performance says how well software reaches production; platform effectiveness says how well the platform serves its users.", [
            npc("Gauge-keeper Arvid", ["The DORA four: deployment frequency, lead time, change failure rate, time to restore. Platform effectiveness is fulfillment latency, adoption, time to first contribution, satisfaction. A platform can ship fast and still be miserable to use.", "Argo CD exposes its metrics, but Prometheus does not scrape them until you add a ServiceMonitor. The wiring is the exercise; the PromQL is five lines."]),
            npc("Counter Ebba", ["<code>argocd_app_sync_total</code> with a phase label gives deployment frequency and change failure rate. <code>argocd_app_info</code> carries sync and health as labels, so how many apps are unhealthy is a count over it.", "Deployment frequency from syncs is an approximation: a self-heal of an unchanged app is not a deployment. Say the approximation you are making and what would make it exact."]),
            npc("Readiness Warden Tove", ["Deployment metrics say the platform ships fast. Restart rates, unavailable replicas and pending pods say whether it runs what it shipped. Answer 'how would you measure this' with both halves.", "Running is not Ready. A readiness probe that never passes leaves a pod Running with 0/1 forever, and the Service drains it. The events say what the probe knocked on.", "<code>kubectl exec POD -- wget -qO- localhost:8080</code>: knock on the port yourself, from inside, and compare with the port the probe uses."], "k-exec-http"),
            npc("Rollout Watcher Per", ["<code>kubectl rollout status</code> tells you whether a rollout is progressing or stuck waiting on replicas that never become available. It is the same question a Deployment's Available condition answers.", "A probe against the wrong port is fixed in the template: correct the port, or remove the probe, with a JSON patch."], "k-rollout")
        ]),
        town("4.6", "Pagerfield", "netpol", "A field where the pager goes off. Under a clock, the difference between five minutes and twenty is a method you follow.", [
            npc("Incident Commander Ragna", ["Blast radius first: what is broken and what still works. One namespace or all? Timeline second: what changed. Then descend one resource at a time: describe, events, logs, previous logs, exec. Resist skipping levels.", "Fix the cause, then prove recovery with the same signal that showed the failure. If a failing curl found it, the incident ends with that curl succeeding.", "<code>kubectl get events --sort-by=.lastTimestamp</code> is the timeline. Most incidents turn out to be a recent change."], "k-events"),
            npc("Quiet Pod Dagny", ["Running but broken is the hardest row. It is where kubectl get pods stops helping and network, identity and config tooling starts.", "The netpol drill strips the DNS egress rule. Every pod Running, every probe green, nothing resolves. No pod listing shows it. Only an nslookup from inside, and then the policy's rules, do."]),
            npc("Postmortem Scribe Lars", ["Five lines you can write in five minutes: symptom with a timestamp, blast radius, root cause as a mechanism not a culprit, the fix including what turned out irrelevant, proof of recovery with the follow-up that prevents recurrence.", "MTTD, MTTA, MTTR, error budget, toil. Blameless, mechanism-focused, short enough that you will actually write it."]),
            npc("Node Nurse Edda", ["When the fault is the node: cordon stops new pods landing, drain evicts the rest respecting PodDisruptionBudgets, which is why it hangs, and uncordon puts it back.", "First restore service, then fix the cause properly. Two different actions with two different urgencies. Say which one you are doing.", "Two commands you have known since the first town: <code>kubectl get</code> for the state column, and <code>kubectl logs</code> for what the container says. Under a clock, they are still where you start."], "k-logs")
        ]),
        /* ── Warden's March: domain 5 ── */
        town("5.1", "Bindgate", "rbac", "A gate with a ledger of bindings. Every Forbidden error decomposes the same way: subject, verb, resource, namespace.", [
            npc("Gatekeeper Aurelie", ["Every RBAC rule is an allow; there is no deny. Your permission set is the union of matching rules, so debugging RBAC is always find the missing rule or the missing binding.", "A RoleBinding can reference a ClusterRole and grant it in one namespace only. That is how you define developer once and bind it per tenant. A ClusterRoleBinding grants everywhere and is almost always the wrong default.", "<code>kubectl get rolebindings -n NS</code>: who is bound to what, here. The one that is missing is the whole answer."], "k-rb"),
            npc("Verb-splitter Casimir", ["get, list and watch are separate verbs. Granting get and expecting kubectl get pods to work is a classic mistake. Subresources are their own strings: pods/log, pods/exec, deployments/scale.", "Built-ins: view reads without secrets, edit writes without RBAC, admin manages RBAC in the namespace, cluster-admin is everything. Least privilege says bind the smallest one that works.", "<code>kubectl create rolebinding NAME --clusterrole=view --serviceaccount=NS:SA -n NS</code>: the shape of most fixes in this march."], "f-rb"),
            npc("Token-keeper Mira", ["ServiceAccounts are objects and how software gets identity: system:serviceaccount:NS:NAME. Modern tokens are short-lived, audience-bound and projected. Set automountServiceAccountToken false on pods that never call the API.", "Users and groups are asserted by authentication and are not objects, which is why <code>--as=dev-a</code> works for testing without dev-a existing anywhere."]),
            npc("Secret-keeper Yves", ["A stock Secret is base64, not encryption. Anyone with get secrets has the plaintext. Sealed Secrets encrypt for git; External Secrets keeps pointers in git and truth in a store, with rotation and audit.", "A SecretStore declares where secrets live and how to authenticate, usually a ServiceAccount. An ExternalSecret declares what to materialise. Read its conditions: a failure names the store, the key, or the auth error.", "<code>kubectl get externalsecrets</code>: store, refresh interval, status, ready. SecretSyncedError is the start of the trail."], "k-es")
        ]),
        town("5.2", "Wardenhall", "kyverno-deny", "The hall of admission. Mutate first, then validate, and every webhook is an availability dependency of the API server.", [
            npc("Pipeline Marshal Ottar", ["The request pipeline: authentication, authorization, mutating admission, schema validation, validating admission, then etcd. Validating policies see the object after mutation, so a mutation can satisfy a validation the user never wrote.", "Admission applies at write time only. Tightening a policy never touches existing objects; you need an audit or a report for those."]),
            npc("Policy-scribe Ilka", ["Kyverno speaks two dialects: classic ClusterPolicy with validate, mutate, generate and verifyImages rules, and the newer ValidatingPolicy and ImageValidatingPolicy in CEL. Gatekeeper is a ConstraintTemplate in Rego plus Constraints. ValidatingAdmissionPolicy is native CEL.", "A denial arrives in the apply error, verbatim. For a Deployment it lands one level down, as a FailedCreate event on the ReplicaSet.", "<code>kubectl get validatingpolicies</code>: the cluster-wide policies, and which one the event named."], "k-vpol"),
            npc("Rollout Choreographer Dag", ["Ship in Audit, read the reports to find every existing offender, fix or exempt them, then flip to Deny. PolicyReports exist for exactly that middle step.", "failurePolicy Fail means an unreachable webhook blocks the write: secure, and able to freeze the cluster if the policy pods die. Ignore means writes proceed unchecked. There is only a deliberate choice."]),
            npc("Remover Hanne", ["The fix for a policy that should not exist is to delete the policy, not the engine. Taking the admission controller down opens the whole cluster.", "<code>kubectl delete KIND NAME</code> removes an object the cluster is better off without. Make sure it is the right one: the platform's own audit policies look similar."], "f-delete")
        ]),
        town("5.3", "Baselin", "pss-restricted", "A walled town with three gates: privileged, baseline, restricted. Baseline stops you being dangerous; restricted forces you to be safe.", [
            npc("Profile-keeper Hjalmar", ["Privileged allows everything. Baseline blocks known escalations: host namespaces, privileged containers, most capabilities. Restricted requires runAsNonRoot, a seccomp profile, allowPrivilegeEscalation false and dropping ALL capabilities.", "PSP was removed. If a scenario mentions it, the answer is PSS, or a policy engine for anything PSS cannot express."]),
            npc("Label-reader Sigrun", ["The modes are namespace labels, set independently: <code>pod-security.kubernetes.io/enforce</code> rejects at admission, audit annotates the log, warn prints to the client. A version suffix pins the profile.", "<code>kubectl get ns X --show-labels</code> shows the whole grammar in one line. Enforce used to say baseline; when it says restricted, every new pod must be restricted-shaped."], "k-ns-labels"),
            npc("Indirection Sage Thora", ["PSS evaluates pods. A Deployment whose template violates the profile is created successfully and then fails to make pods. The evidence is on the ReplicaSet, one level below where you were looking. Same indirection as quota.", "Enforcement is admission-time. Tightening a label does not evict existing violators; they run until their next write. Which is why the dry-run preview exists."]),
            npc("Context-smith Eyvind", ["Restricted wants four things in the securityContext, and a patch that gives it three still fails. Put them all in: <code>runAsNonRoot</code>, <code>seccompProfile</code>, <code>allowPrivilegeEscalation: false</code>, <code>capabilities.drop: [ALL]</code>.", "Or set the label back to what the tenancy model said. Flipping a tenant namespace to privileged is a fix that removes the control."], "f-label")
        ]),
        town("5.4", "Auditmoor", "image-unsigned", "A moor of ledgers. Who did what to what, what is inside the thing we shipped, and which controls are we failing right now.", [
            npc("Recorder Brynja", ["A policy file tells the API server what to record and at what level: None, Metadata, Request, RequestResponse. Rules match in order, first hit wins: drop the noise, elevate the sensitive, catch the rest at Metadata.", "If the audit policy file the apiserver points at is missing, the API server does not start at all. An audit misconfiguration can present as a completely dead cluster."]),
            npc("SBOM-keeper Leif", ["An SBOM lists components and versions. It is not a vulnerability report; you join it against a CVE database, which is why one generated at build time stays useful after new CVEs land.", "CycloneDX and SPDX are the two formats; which is a compatibility question, not a quality one. When the next log4shell drops, you query your SBOMs instead of rescanning the world."]),
            npc("Report-reader Frida", ["Trivy Operator rescans continuously and materialises results as CRs: VulnerabilityReports, SBOMReports, ConfigAuditReports, ClusterComplianceReports. Compliance as queryable API objects rather than PDF attachments.", "kubectl, RBAC, GitOps and dashboards all work on your compliance data for free once it is an object."]),
            npc("Verifier Odd", ["Three different documents, one trust story: provenance says how it was built, an SBOM says what is inside, a signature says who vouches for it.", "<code>cosign verify --key KEY IMAGE</code>: does a signature exist for this exact digest under this key? No matching signatures is the whole answer to a refused deploy."], "cosign-verify")
        ]),
        town("5.5", "Cipherford", "eso-store-auth", "A ford where every crossing shows a certificate. Who is this workload, cryptographically? The ServiceAccount is the identity.", [
            npc("Tunnel-keeper Yngve", ["Istio ambient has no sidecars: a per-node ztunnel wraps traffic in mTLS over HBONE using per-workload certificates from istiod. Enrolment is one label on the namespace.", "The identities inside are SPIFFE IDs: <code>spiffe://cluster.local/ns/NS/sa/SA</code>. Note what that is built from: the ServiceAccount is the identity."]),
            npc("Strict Warden Asta", ["Installing a mesh does not encrypt everything. PERMISSIVE accepts mTLS and plaintext so you can migrate. You must apply STRICT, and prove it by having a plaintext connection refused.", "L4 rules, which identity may connect, work with ztunnel alone. L7 rules need a waypoint proxy, the opt-in tier."]),
            npc("Attestor Gudrun", ["SPIFFE is the standard, SPIRE the implementation. An SVID proves the identity, fetched over a Unix socket: no network call, no secret to mount, automatic rotation. The agent attests the node, then each workload by its ServiceAccount and labels.", "Mesh for transparent mTLS between services. SPIRE alone when workloads must authenticate to something outside with short-lived credentials and no static secrets."]),
            npc("Store-minder Eskil", ["A SecretStore that authenticates as a ServiceAccount is only as able as that account's bindings in the namespace it reads from. A 403 in the store's condition is an RBAC fix in another namespace, not a secrets fix.", "<code>kubectl get clusterrolebindings</code> shows the cluster-wide grants, controllers' own included. When a controller loses one, everything it touches fails with forbidden at once."], "k-crb")
        ]),
        town("5.6", "Signet", "image-unsigned", "A town of seals. Five controls sit between a git push and a running pod, and each catches a failure class the others cannot.", [
            npc("Scanner Marit", ["In the pipeline a Trivy task with <code>--exit-code 1 --severity HIGH,CRITICAL</code> is a gate: it stops a bad image before it exists. In the cluster the operator is surveillance for CVEs published after you shipped. Teams that only scan in CI are blind to every CVE younger than their last deploy.", "A gate that always fails gets disabled. Keep an auditable ignore file with expiry dates rather than a loosened threshold."]),
            npc("Signer Torvald", ["cosign signs an image digest with a key and pushes the signature to the registry beside the image. The thing signed is the digest, which is why tags are mutable but signed supply chains are not.", "Keyless mode: a CI identity gets a short-lived certificate from Fulcio and the signature is recorded in Rekor, a public transparency log. Fulcio, Rekor, OIDC: know the three names.", "<code>cosign sign --key k8s://drill-ci/cosign-key IMAGE</code> signs with the platform key the policy trusts. A pipeline that skipped its sign step ships an image admission will refuse."], "f-cosign-sign"),
            npc("Enforcer Solveig", ["Without enforcement, signing is decoration. An ImageValidatingPolicy holds the key, intercepts pod creation, resolves each image, checks its signature, rejects on failure. It can also mutate the reference to its digest.", "The fix for a refused image is to sign it, not to weaken the policy that caught it.", "<code>kubectl get imagevalidatingpolicies -o yaml</code>: which images it matches, which key it verifies against."], "k-ivpol"),
            npc("Registry-keeper Jorun", ["The pipeline pushes to kind-registry:5000 from inside the cluster; the policy fetches the signature from inside too. Know which name works from where.", "Compare the release run with the hotfix run: both succeeded, one skipped its sign task. tkn shows skipped tasks and the when expression that skipped them."])
        ])
    ];
    return {
        map: MAP, tiles: TILES, regions: REGIONS, towns: TOWNS, techniques: TECHNIQUES, items: ITEMS,
        scenarios: SCENARIOS, finale: FINALE, levels: LEVELS, start: START
    };
})();
