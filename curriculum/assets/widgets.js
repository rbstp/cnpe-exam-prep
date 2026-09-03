/* CNPE curriculum: interactive figures. */
(function () {
  "use strict";

  /* ── tiny helpers ─────────────────────────────────────────── */
  var NS = "http://www.w3.org/2000/svg";
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) k === "html" ? (e.innerHTML = attrs[k]) : e.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    return e;
  }
  var figSeq = 0;
  function frame(title, hint) {
    var w = h("figure", { "class": "wfig" });
    var id = "wfig-" + (++figSeq);
    w.setAttribute("aria-labelledby", id);
    var head = h("figcaption", { "class": "whead" });
    var t = h("span", { "class": "wtitle", html: title });
    t.id = id;
    head.appendChild(t);
    if (hint) head.appendChild(h("span", { "class": "whint", html: hint }));
    w.appendChild(head);
    var bodyEl = h("div", { "class": "wbody" });
    w.appendChild(bodyEl);
    return { root: w, body: bodyEl };
  }
  var ctlSeq = 0;
  function control(label, input, valueEl) {
    var row = h("div", { "class": "wctl" });
    var id = "wctl-" + (++ctlSeq);
    var lbl = h("label", { "class": "wlbl", html: label });
    lbl.setAttribute("for", id);
    input.id = id;
    row.appendChild(lbl);
    row.appendChild(input);
    if (valueEl) { valueEl.setAttribute("aria-hidden", "true"); row.appendChild(valueEl); }
    return row;
  }
  function slider(min, max, step, val) {
    var i = h("input");
    i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = val;
    return i;
  }
  function toggle(label, checked) {
    var i = h("input"); i.type = "checkbox"; i.checked = !!checked;
    var l = h("label", { "class": "wtog" });
    l.appendChild(i); l.appendChild(h("span", { html: label }));
    l.input = i;
    return l;
  }
  function verdict(state, text) {
    return '<span class="wverdict ' + state + '">' + text + "</span>";
  }
  function bar(pct, cls) {
    return '<span class="wbar"><i class="' + (cls || "") + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></span>';
  }

  /* ── 1.2 · QoS, throttling and eviction ───────────────────── */
  function qos(mount) {
    var f = frame("Requests, limits and what the kernel does with them",
                  "move the sliders; the class and the failure mode fall out");
    var st = { cpuReq: 100, cpuLim: 500, memReq: 128, memLim: 256, cpuUse: 300, memUse: 208 };
    var out = announce(h("div", { "class": "wout" }));
    var ctls = h("div", { "class": "wctls" });

    function mk(key, label, min, max, step, unit) {
      var val = h("span", { "class": "wval" });
      var s = slider(min, max, step, st[key]);
      s.addEventListener("input", function () { st[key] = +s.value; draw(); });
      var row = control(label, s, val);
      row.update = function () { val.textContent = st[key] ? st[key] + unit : "unset"; };
      ctls.appendChild(row);
      return row;
    }
    var rows = [
      mk("cpuReq", "cpu request", 0, 1000, 25, "m"),
      mk("cpuLim", "cpu limit", 0, 1000, 25, "m"),
      mk("memReq", "memory request", 0, 512, 16, "Mi"),
      mk("memLim", "memory limit", 0, 512, 16, "Mi"),
      mk("cpuUse", "actual cpu use", 0, 1000, 25, "m"),
      mk("memUse", "actual memory use", 0, 512, 16, "Mi")
    ];

    function draw() {
      rows.forEach(function (r) { r.update(); });
      var anySet = st.cpuReq || st.cpuLim || st.memReq || st.memLim;
      var guaranteed = st.cpuReq && st.cpuLim && st.memReq && st.memLim &&
                       st.cpuReq === st.cpuLim && st.memReq === st.memLim;
      var klass = !anySet ? "BestEffort" : guaranteed ? "Guaranteed" : "Burstable";
      var kcls = klass === "Guaranteed" ? "ok" : klass === "Burstable" ? "warn" : "bad";
      var evict = klass === "Guaranteed" ? "evicted last"
                : klass === "Burstable" ? (st.memUse > st.memReq ? "evicted early, using more memory than it requested" : "evicted after BestEffort")
                : "evicted first";
      var throttled = st.cpuLim && st.cpuUse > st.cpuLim;
      var oom = st.memLim && st.memUse > st.memLim;
      var claims = st.cpuReq || st.memReq;

      var invalid = (st.cpuLim && st.cpuReq > st.cpuLim) || (st.memLim && st.memReq > st.memLim);
      out.innerHTML =
        (invalid ? '<div class="wnote bad">The API server rejects this pod before any of the below applies: a container\'s request may not exceed its limit.</div>' : "") +
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">QoS class</span>' + verdict(kcls, klass) + "</div>" +
          '<div class="wcell"><span class="wk">under memory pressure</span><span class="wv">' + evict + "</span></div>" +
          '<div class="wcell"><span class="wk">cpu at runtime</span>' +
            (throttled ? verdict("warn", "throttled to " + st.cpuLim + "m")
                       : verdict("ok", "runs at " + st.cpuUse + "m")) + "</div>" +
          '<div class="wcell"><span class="wk">memory at runtime</span>' +
            (oom ? verdict("bad", "OOMKilled") : verdict("ok", "within the limit")) + "</div>" +
          '<div class="wcell wspan"><span class="wk">the scheduler reserves</span><span class="wv">' +
            (claims ? (st.cpuReq ? st.cpuReq + "m cpu" : "no cpu") + " / " + (st.memReq ? st.memReq + "Mi" : "no memory") +
                      " on a node, whether or not it is used" +
                      (st.cpuReq && st.cpuUse < st.cpuReq ? "; " + (st.cpuReq - st.cpuUse) + "m of that is waste you still pay for" : "")
                    : "nothing: a BestEffort pod claims no capacity, so the scheduler will pack it anywhere") +
          "</span></div>" +
        "</div>" +
        '<div class="wmeter"><span class="wk">cpu</span>' + bar(st.cpuUse / 10, throttled ? "warn" : "") +
          '<span class="wv">use ' + st.cpuUse + "m · req " + (st.cpuReq ? st.cpuReq + "m" : "unset") +
          " · lim " + (st.cpuLim ? st.cpuLim + "m" : "none") + "</span></div>" +
        '<div class="wmeter"><span class="wk">mem</span>' + bar(st.memUse / 5.12, oom ? "bad" : "") +
          '<span class="wv">use ' + st.memUse + "Mi · req " + (st.memReq ? st.memReq + "Mi" : "unset") +
          " · lim " + (st.memLim ? st.memLim + "Mi" : "none") + "</span></div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 1.2 · node capacity: allocatable vs requested vs used ── */
  function capacity(mount) {
    var f = frame("One node, four numbers", "the gap between requested and used is the whole cost domain");
    var st = { alloc: 3800, req: 3600, use: 1100 };
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));
    var rows = [];
    [["req", "sum of requests", 0, 3800], ["use", "actual usage", 0, 3800]].forEach(function (d) {
      var val = h("span", { "class": "wval" });
      var s = slider(d[2], d[3], 50, st[d[0]]);
      s.addEventListener("input", function () { st[d[0]] = +s.value; draw(); });
      var row = control(d[1], s, val);
      row.update = function () { val.textContent = st[d[0]] + "m"; };
      ctls.appendChild(row); rows.push(row);
    });
    function draw() {
      rows.forEach(function (r) { r.update(); });
      var cap = 4000, free = st.alloc - st.req, eff = st.req ? Math.round(st.use / st.req * 100) : 0;
      out.innerHTML =
        '<div class="wstack">' +
          row("capacity", cap, cap, "", "4000m: the machine you pay for") +
          row("allocatable", st.alloc, cap, "dim", "3800m: minus kubelet, system and eviction reserves") +
          row("requested", st.req, cap, "blue", st.req + "m: what the scheduler counts") +
          row("used", st.use, cap, "green", st.use + "m: what the processes actually burn") +
        "</div>" +
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">room for another pod</span>' +
            (free > 0 ? verdict("ok", free + "m unrequested") : verdict("bad", "none: Pending")) + "</div>" +
          '<div class="wcell"><span class="wk">request efficiency</span>' +
            verdict(eff > 70 ? "ok" : eff > 40 ? "warn" : "bad", eff + "%") + "</div>" +
          '<div class="wcell"><span class="wk">paid for, never used</span><span class="wv">' +
            Math.max(0, st.req - st.use) + "m of reservation + " + Math.max(0, st.alloc - st.req) + "m idle on the node</span></div>" +
        "</div>";
    }
    function row(label, v, max, cls, note) {
      return '<div class="wrow"><span class="wk">' + label + "</span>" + bar(v / max * 100, cls) +
             '<span class="wv">' + note + "</span></div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 1.4 · which quota line binds first ───────────────────── */
  function quota(mount) {
    var f = frame("Which quota line refuses you", "team-a's guardrails, with the LimitRange doing the defaulting");
    var st = { replicas: 12, cpuReq: 50, cpuLim: 200, explicit: false };
    var hard = { "requests.cpu": 2000, "limits.cpu": 4000, pods: 20 };
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));

    var tog = toggle("declare resources explicitly (otherwise the LimitRange injects 50m / 200m)", false);
    tog.input.addEventListener("change", function () { st.explicit = tog.input.checked; sync(); draw(); });

    function mk(key, label, min, max, step, unit) {
      var val = h("span", { "class": "wval" });
      var s = slider(min, max, step, st[key]);
      s.addEventListener("input", function () { st[key] = +s.value; draw(); });
      var row = control(label, s, val);
      row.update = function () { val.textContent = st[key] + unit; s.disabled = (key !== "replicas" && !st.explicit); };
      row.el = s;
      ctls.appendChild(row);
      return row;
    }
    var rowsHost = [mk("replicas", "replicas", 1, 40, 1, ""), mk("cpuReq", "cpu request each", 10, 500, 10, "m"), mk("cpuLim", "cpu limit each", 50, 1000, 50, "m")];
    ctls.appendChild(tog);
    function sync() { if (!st.explicit) { st.cpuReq = 50; st.cpuLim = 200; } }

    function draw() {
      rowsHost.forEach(function (r) { r.update(); });
      var used = { "requests.cpu": st.replicas * st.cpuReq, "limits.cpu": st.replicas * st.cpuLim, pods: st.replicas };
      var lines = Object.keys(hard).map(function (k) {
        var over = used[k] > hard[k];
        var max = Math.floor(hard[k] / (used[k] / st.replicas));
        return { k: k, used: used[k], hard: hard[k], over: over, max: max };
      });
      var binding = lines.filter(function (l) { return l.over; }).sort(function (a, b) { return a.max - b.max; })[0];
      out.innerHTML =
        '<div class="wtable">' +
          '<div class="wtr wth"><span>quota line</span><span>hard</span><span>would use</span><span>fits</span></div>' +
          lines.map(function (l) {
            return '<div class="wtr' + (binding && binding.k === l.k ? " wtr-hit" : "") + '">' +
              "<span>" + l.k + "</span><span>" + l.hard + "</span><span>" + l.used + "</span>" +
              "<span>" + (l.over ? '<b class="bad">refused at ' + (l.max + 1) + " pods</b>" : '<b class="ok">yes</b>') + "</span></div>";
          }).join("") +
        "</div>" +
        (binding
          ? (function () {
              var per = used[binding.k] / st.replicas;
              var q = function (v) { return binding.k === "pods" ? String(v) : (v % 1000 === 0 ? v / 1000 : v + "m"); };
              return '<div class="wnote bad"><code>exceeded quota: team-a-quota, requested: ' + binding.k + "=" + q(per) +
                ", used: " + binding.k + "=" + q(binding.max * per) + ", limited: " + binding.k + "=" + q(binding.hard) +
                "</code><br>The ReplicaSet stalls at " + binding.max + " pods, and this is the line the event names.</div>";
            })()
          : '<div class="wnote ok">all ' + st.replicas + " pods admit. Raise the replicas until something binds; note which line goes first.</div>");
    }
    f.body.appendChild(ctls); f.body.appendChild(out); sync(); draw();
    mount.appendChild(f.root);
  }

  /* ── 1.5 · right-sizing and what it costs ─────────────────── */
  function efficiency(mount) {
    var f = frame("Right-sizing, in money", "notional rates: $28/CPU-month, $3.50/GiB-month");
    var st = { req: 500, use: 90, replicas: 6, mem: 512, memUse: 192 };
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));
    var rows = [];
    [["req", "cpu request each", 25, 1000, 25, "m"], ["use", "cpu actually used", 10, 1000, 10, "m"],
     ["mem", "memory request each", 64, 1024, 64, "Mi"], ["memUse", "memory actually used", 32, 1024, 32, "Mi"],
     ["replicas", "replicas", 1, 20, 1, ""]].forEach(function (d) {
      var val = h("span", { "class": "wval" });
      var s = slider(d[2], d[3], d[4], st[d[0]]);
      s.addEventListener("input", function () { st[d[0]] = +s.value; draw(); });
      var row = control(d[1], s, val);
      row.update = function () { val.textContent = st[d[0]] + d[5]; };
      ctls.appendChild(row); rows.push(row);
    });
    function draw() {
      rows.forEach(function (r) { r.update(); });
      var cpuCost = st.replicas * (Math.max(st.req, st.use) / 1000) * 28;
      var memCost = st.replicas * (Math.max(st.mem, st.memUse) / 1024) * 3.5;
      var billed = cpuCost + memCost;
      var wouldBe = st.replicas * ((Math.max(25, Math.round(st.use * 1.3 / 25) * 25)) / 1000) * 28 +
                    st.replicas * ((Math.max(64, Math.round(st.memUse * 1.25 / 64) * 64)) / 1024) * 3.5;
      var cpuEff = Math.round(st.use / st.req * 100), memEff = Math.round(st.memUse / st.mem * 100);
      var risky = st.use > st.req * 0.9 || st.memUse > st.mem * 0.9;
      out.innerHTML =
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">cpu efficiency</span>' + verdict(cpuEff > 60 ? "ok" : cpuEff > 30 ? "warn" : "bad", cpuEff + "%") + bar(cpuEff) + "</div>" +
          '<div class="wcell"><span class="wk">memory efficiency</span>' + verdict(memEff > 60 ? "ok" : memEff > 30 ? "warn" : "bad", memEff + "%") + bar(memEff) + "</div>" +
          '<div class="wcell"><span class="wk">billed by allocation</span><span class="wv wnum">$' + billed.toFixed(2) + " / month</span></div>" +
          '<div class="wcell"><span class="wk">right-sized (usage + headroom)</span><span class="wv wnum">$' + wouldBe.toFixed(2) + " / month</span></div>" +
          '<div class="wcell wspan"><span class="wk">on the table</span>' +
            verdict(billed - wouldBe > 5 ? "warn" : "ok", "$" + Math.max(0, billed - wouldBe).toFixed(2) + " / month across " + st.replicas + " replicas") + "</div>" +
        "</div>" +
        '<div class="wnote ' + (risky ? "warn" : "ok") + '">' +
          (risky ? "Careful: usage is within 10% of the request. Cutting further buys throttling and OOM kills, which cost more than the waste."
                 : "Safe to trim: usage sits well under the reservation, so a smaller request keeps the same headroom.") + "</div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 2.2 · the sync × health matrix ───────────────────────── */
  function syncmatrix(mount) {
    var f = frame("Sync status × health status", "click a cell; each combination has exactly one right move");
    var cells = [
      { s: "Synced", hh: "Healthy", cls: "ok", t: "Nothing to do. Live matches git and the workloads are up. The only question worth asking is <em>when</em> it last synced; a stale-but-green app looks exactly like this." },
      { s: "Synced", hh: "Degraded", cls: "bad", t: "<b>Git is wrong, the cluster is faithful.</b> Bad image tag, impossible request, missing key. Re-syncing does nothing: the diff is already empty. Fix the commit." },
      { s: "OutOfSync", hh: "Healthy", cls: "warn", t: "Drift, or an un-synced change waiting. If self-heal is on it corrects itself in seconds; if not, <code>argocd app diff</code> shows exactly what diverged. Also the shape of a permanent diff from a mutating webhook, which wants <code>ignoreDifferences</code>." },
      { s: "OutOfSync", hh: "Degraded", cls: "bad", t: "Two problems stacked, and the sync failure usually caused the health one. Read the sync operation message first: admission denial, immutable field, missing CRD." },
      { s: "Unknown", hh: "n/a", cls: "bad", t: "<b>Access, not workload.</b> The controller cannot reach the repo or compare state: bad credentials, unreachable git, RBAC. The error names the controller's own identity and no pod is involved." },
      { s: "Synced", hh: "Progressing", cls: "warn", t: "A rollout in flight, or a Deployment that will flip to Degraded once <code>progressDeadlineSeconds</code> expires. Do not wait it out: the pod events already tell you which one it is." }
    ];
    var grid = h("div", { "class": "wchips" });
    var detail = h("div", { "class": "wnote" , html: "Pick a combination." });
    cells.forEach(function (c, i) {
      var b = h("button", { "class": "wchip " + c.cls, type: "button",
        html: '<span class="cs">' + c.s + "</span><span class='ch'>" + c.hh + "</span>" });
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(grid.children, function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
        detail.className = "wnote " + c.cls;
        detail.innerHTML = c.t;
      });
      grid.appendChild(b);
      if (i === 1) b.click();
    });
    f.body.appendChild(grid); f.body.appendChild(detail);
    mount.appendChild(f.root);
  }

  /* ── 2.5 · canary steps, replica weight vs route weight ───── */
  function canary(mount) {
    var f = frame("Canary progression", "step through it, and switch how the traffic is actually split");
    var steps = [
      { label: "setWeight: 20", w: 20 },
      { label: "pause: 60s", w: 20, pause: true },
      { label: "analysis", w: 20, analysis: true },
      { label: "setWeight: 50", w: 50 },
      { label: "pause: {}", w: 50, pause: true },
      { label: "setWeight: 100", w: 100 }
    ];
    var st = { i: 0, replicas: 4, route: false, healthy: true, aborted: false };
    var ctls = h("div", { "class": "wctls wctls-row" });
    var out = announce(h("div", { "class": "wout" }));

    var next = h("button", { "class": "wbtn", type: "button", html: "▶ promote to next step" });
    var abort = h("button", { "class": "wbtn danger", type: "button", html: "■ abort" });
    var reset = h("button", { "class": "wbtn ghost", type: "button", html: "reset" });
    var mode = toggle("traffic provider (route weight) instead of replica ratio", false);
    var bad = toggle("new version is failing its metric", false);
    next.addEventListener("click", function () {
      if (st.aborted) return;
      if (steps[st.i].analysis && bad.input.checked) { st.aborted = true; draw(); return; }
      st.i = Math.min(st.i + 1, steps.length - 1); draw();
    });
    abort.addEventListener("click", function () { st.aborted = true; draw(); });
    reset.addEventListener("click", function () { st.i = 0; st.aborted = false; draw(); });
    mode.input.addEventListener("change", draw);
    bad.input.addEventListener("change", draw);
    [next, abort, reset].forEach(function (b) { ctls.appendChild(b); });
    var togs = h("div", { "class": "wctls" }); togs.appendChild(mode); togs.appendChild(bad);

    function draw() {
      var s = steps[st.i];
      var want = st.aborted ? 0 : s.w;
      var canaryPods = mode.input.checked
        ? Math.round(st.replicas * want / 100)
        : Math.max(want > 0 ? 1 : 0, Math.round(st.replicas * want / 100));
      var actual = mode.input.checked ? want : Math.round(canaryPods / st.replicas * 100);
      out.innerHTML =
        '<div class="wsteps">' + steps.map(function (x, i) {
          var cls = st.aborted ? (i <= st.i ? "done aborted" : "") : i < st.i ? "done" : i === st.i ? "cur" : "";
          return '<span class="wstep ' + cls + '">' + x.label + "</span>";
        }).join('<span class="warr">→</span>') + "</div>" +
        '<div class="wsplit">' +
          '<div class="wsplit-bar"><i class="stable" style="width:' + (100 - actual) + '%"><span>stable ' + (100 - actual) + "%</span></i>" +
          '<i class="cnry" style="width:' + actual + '%"><span>' + (actual >= 12 ? "canary " + actual + "%" : "") + "</span></i></div>" +
        "</div>" +
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">requested weight</span><span class="wv wnum">' + want + "%</span></div>" +
          '<div class="wcell"><span class="wk">traffic the canary really gets</span>' +
            verdict(actual === want ? "ok" : "warn", actual + "%" + (actual === want ? "" : " (rounded to whole pods)")) + "</div>" +
          '<div class="wcell"><span class="wk">replicas</span><span class="wv">' + (st.replicas - canaryPods) + " stable / " + canaryPods + " canary</span></div>" +
          '<div class="wcell"><span class="wk">rollout status</span>' +
            (st.aborted ? verdict("bad", "Degraded: aborted, stable serving")
              : st.i === steps.length - 1 ? verdict("ok", "Healthy: fully promoted")
              : s.analysis ? verdict(bad.input.checked ? "bad" : "warn", "running AnalysisRun")
              : verdict("warn", s.pause ? "paused, waiting" : "progressing")) + "</div>" +
        "</div>" +
        '<div class="wnote ' + (st.aborted ? "bad" : "") + '">' +
          (st.aborted
            ? "Aborted. All traffic is back on stable, but <code>spec</code> still asks for the new image, so status stays Degraded until you <code>undo</code> (and under GitOps, until you revert the commit)."
            : mode.input.checked
              ? "With a traffic provider the split is a <b>route weight</b>: exact, and independent of replica count."
              : "Without a traffic provider the split is a <b>replica ratio</b>: " + st.replicas + " replicas means the finest step you can express is " + Math.round(100 / st.replicas) + "%.") +
        "</div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(togs); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 4.1 · counters, rate() and the window ────────────────── */
  function promrate(mount) {
    var f = frame("A counter, and what rate() makes of it", "drag the window, and restart the process to see a reset");
    var st = { win: 5, spike: false, reset: false };
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));
    var val = h("span", { "class": "wval" });
    var s = slider(1, 15, 1, st.win);
    s.addEventListener("input", function () { st.win = +s.value; draw(); });
    var row = control("rate window [Xm]", s, val); ctls.appendChild(row);
    var spike = toggle("traffic spike halfway through", false);
    var reset = toggle("process restarts (counter resets to 0)", false);
    spike.input.addEventListener("change", function () { st.spike = spike.input.checked; draw(); });
    reset.input.addEventListener("change", function () { st.reset = reset.input.checked; draw(); });
    ctls.appendChild(spike); ctls.appendChild(reset);

    function series() {
      var pts = [], v = 0;
      for (var t = 0; t <= 30; t++) {
        var per = (st.spike && t > 15 && t < 23) ? 40 : 8;
        v += per;
        if (st.reset && t === 20) v = 0;
        pts.push({ t: t, v: v });
      }
      return pts;
    }
    function draw() {
      val.textContent = st.win + "m";
      var LBL = "fill: var(--paper-3)";
      var pts = series(), W = 640, H = 200, padL = 52, padR = 14, top = 16, base = H - 28;
      var maxV = Math.max.apply(null, pts.map(function (p) { return p.v; })) || 1;
      var x = function (t) { return padL + t / 30 * (W - padL - padR); };
      var y = function (v) { return base - v / maxV * (base - top); };
      var g = svg("svg", { viewBox: "0 0 " + W + " " + H, "class": "wsvg" });
      [0, .25, .5, .75, 1].forEach(function (q) {
        var gy = y(maxV * q);
        g.appendChild(svg("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, style: "stroke: var(--rule)", "stroke-width": 1 }));
        var tl = svg("text", { x: padL - 8, y: gy + 3.5, style: LBL, "font-size": 10, "text-anchor": "end" });
        tl.textContent = String(Math.round(maxV * q));
        g.appendChild(tl);
      });
      [0, 10, 20, 30].forEach(function (t) {
        var tl = svg("text", { x: x(t), y: H - 9, style: LBL, "font-size": 10, "text-anchor": "middle" });
        tl.textContent = t + "m";
        g.appendChild(tl);
      });
      var ylab = svg("text", { x: 12, y: (top + base) / 2, style: LBL, "font-size": 10,
                               transform: "rotate(-90 12 " + (top + base) / 2 + ")", "text-anchor": "middle" });
      ylab.textContent = "http_requests_total";
      g.appendChild(ylab);
      var t1 = 30, t0 = Math.max(0, 30 - st.win);
      var band = svg("rect", { x: x(t0), y: top, width: x(t1) - x(t0), height: base - top, style: "fill: var(--accent)", opacity: .10 });
      g.appendChild(band);
      var d = pts.map(function (p, i) { return (i ? "L" : "M") + x(p.t) + " " + y(p.v); }).join(" ");
      g.appendChild(svg("path", { d: d, fill: "none", style: "stroke: var(--ok)", "stroke-width": 2 }));
      pts.forEach(function (p) { if (p.t % 5 === 0) g.appendChild(svg("circle", { cx: x(p.t), cy: y(p.v), r: 2.5, style: "fill: var(--ok)" })); });
      var lbl = svg("text", { x: x(t0) + 6, y: top + 13, style: "fill: var(--accent)", "font-size": 11 });
      lbl.textContent = "[" + st.win + "m] window";
      g.appendChild(lbl);
      out.innerHTML = "";
      out.appendChild(g);

      var a = pts[Math.max(0, Math.round(t0))].v, b = pts[30].v;
      var naive = (b - a) / (st.win * 60);
      var corrected = st.reset && t0 < 20 ? (b + pts[19].v - a) / (st.win * 60) : naive;
      var info = h("div", { "class": "wgrid" });
      info.innerHTML =
        '<div class="wcell"><span class="wk">raw counter now</span><span class="wv wnum">' + b + "</span></div>" +
        '<div class="wcell"><span class="wk">naive (last − first) / window</span>' +
          verdict(naive < 0 ? "bad" : "ok", naive.toFixed(2) + " /s") + "</div>" +
        '<div class="wcell"><span class="wk">rate(), reset-aware</span>' + verdict("ok", Math.max(0, corrected).toFixed(2) + " /s") + "</div>" +
        '<div class="wcell wspan"><span class="wk">why it matters</span><span class="wv">' +
          (st.reset && t0 <= 20
            ? "The counter fell to zero mid-window. A plain subtraction goes negative and lies; <code>rate()</code> detects the reset and adds the pre-reset value back."
            : st.spike && st.win > 8
              ? "A long window averages the spike away: the burst is real, and a " + st.win + "m window barely shows it. Shorter windows are twitchier but see events."
              : "Counters only climb, so the value itself is meaningless. Every useful question about a counter is a question about its rate.") +
        "</span></div>";
      out.appendChild(info);
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 4.2 · alert lifecycle timeline ───────────────────────── */
  function alertstate(mount) {
    var f = frame("From condition true to phone buzzing", "the delay is the sum of four settings, not one");
    var st = { evalI: 30, forS: 120, groupWait: 30, blip: 45 };
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));
    var rows = [];
    [["evalI", "evaluation interval", 15, 120, 15, "s"], ["forS", "for:", 0, 600, 30, "s"],
     ["groupWait", "group_wait", 0, 300, 15, "s"], ["blip", "how long the condition actually holds", 15, 900, 15, "s"]]
      .forEach(function (d) {
        var val = h("span", { "class": "wval" });
        var s = slider(d[2], d[3], d[4], st[d[0]]);
        s.addEventListener("input", function () { st[d[0]] = +s.value; draw(); });
        var row = control(d[1], s, val);
        row.update = function () { val.textContent = st[d[0]] + d[5]; };
        ctls.appendChild(row); rows.push(row);
      });
    function draw() {
      rows.forEach(function (r) { r.update(); });
      var detect = st.evalI;
      var fires = Math.ceil((detect + st.forS) / st.evalI) * st.evalI;        // Pending → Firing, on an evaluation tick
      var notified = fires + st.groupWait;
      var everFires = st.blip >= fires;
      var total = Math.max(notified, st.blip) * 1.15;
      var pct = function (v) { return Math.max(0, Math.min(100, v / total * 100)); };
      var span = function (left, width) { return Math.max(0, Math.min(100 - left, width)); };
      out.innerHTML =
        '<div class="wtl">' +
          '<div class="wtl-track"><i class="cond" style="left:0;width:' + span(0, pct(st.blip)) + '%"><span>condition true</span></i></div>' +
          '<div class="wtl-track"><i class="pend" style="left:' + pct(detect) + '%;width:' +
            span(pct(detect), pct(Math.min(st.forS, Math.max(0, st.blip - detect)))) + '%"><span>Pending</span></i>' +
            (everFires ? '<i class="fire" style="left:' + pct(fires) + '%;width:' +
              span(pct(fires), Math.max(8, pct(st.blip - fires))) + '%"><span>Firing</span></i>' : "") + "</div>" +
          '<div class="wtl-track">' + (everFires ? '<i class="notif" style="left:' + pct(notified) + '%;width:' +
            span(pct(notified), Math.max(11, pct(total * 0.11))) + '%"><span>notified</span></i>' : "") + "</div>" +
          '<div class="wtl-axis">' + [0, 0.25, 0.5, 0.75, 1].map(function (q) {
            return "<span>" + Math.round(total * q) + "s</span>";
          }).join("") + "</div>" +
        "</div>" +
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">seen by Prometheus at</span><span class="wv wnum">' + detect + "s</span></div>" +
          '<div class="wcell"><span class="wk">Firing at</span>' + (everFires ? verdict("warn", fires + "s") : verdict("bad", "never")) + "</div>" +
          '<div class="wcell"><span class="wk">receiver hears at</span>' + (everFires ? verdict("bad", notified + "s") : verdict("ok", "silence")) + "</div>" +
          '<div class="wcell"><span class="wk">total lag</span><span class="wv wnum">' + (everFires ? notified + "s" : "none") + "</span></div>" +
        "</div>" +
        '<div class="wnote ' + (everFires ? "" : "ok") + '">' +
          (!everFires
            ? "The condition cleared after " + st.blip + "s, before the alert could survive detection (" + detect + "s) plus <code>for: " + st.forS + "s</code>, so it never fired and nobody was told. That is exactly what <code>for:</code> is for: swallowing blips."
            : st.forS === 0
              ? "With <code>for: 0</code> the alert goes straight to Firing on the first evaluation that sees it: no Pending window at all. Fast, and it will page you for a single scrape's worth of noise."
              : "The alert is visible as Pending in Prometheus " + detect + "s in, and <em>nowhere else</em> until " + fires +
                "s; note the transition lands on an evaluation tick, not exactly at detection + for:. If someone says \"the alert is showing but nothing paged\", that is this window.") +
        "</div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 5.3 · which PSS profile admits this pod ──────────────── */
  function pss(mount) {
    var f = frame("Build a pod, see which profile admits it", "toggle the securityContext and watch the three verdicts move");
    var opts = [
      ["privileged", "privileged: true", false, ["baseline", "restricted"]],
      ["hostNet", "hostNetwork / hostPID", false, ["baseline", "restricted"]],
      ["hostPath", "hostPath volume", false, ["baseline", "restricted"]],
      ["addCaps", "capabilities.add: [SYS_ADMIN]", false, ["baseline", "restricted"]],
      ["nonRoot", "runAsNonRoot: true", false, []],
      ["noEsc", "allowPrivilegeEscalation: false", false, []],
      ["dropAll", "capabilities.drop: [ALL]", false, []],
      ["seccomp", "seccompProfile: RuntimeDefault", false, []]
    ];
    var st = {};
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));
    opts.forEach(function (o) {
      st[o[0]] = o[2];
      var t = toggle(o[1], o[2]);
      t.input.addEventListener("change", function () { st[o[0]] = t.input.checked; draw(); });
      ctls.appendChild(t);
    });
    function draw() {
      var baselineBreaks = [];
      if (st.privileged) baselineBreaks.push("privileged containers");
      if (st.hostNet) baselineBreaks.push("host namespaces");
      if (st.hostPath) baselineBreaks.push("hostPath volumes");
      if (st.addCaps) baselineBreaks.push("added capabilities");
      var restrictedMissing = [];
      if (!st.nonRoot) restrictedMissing.push("runAsNonRoot: true");
      if (!st.noEsc) restrictedMissing.push("allowPrivilegeEscalation: false");
      if (!st.dropAll) restrictedMissing.push("capabilities.drop: [ALL]");
      if (!st.seccomp) restrictedMissing.push("seccompProfile: RuntimeDefault");
      var okBaseline = baselineBreaks.length === 0;
      var okRestricted = okBaseline && restrictedMissing.length === 0;
      out.innerHTML =
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">privileged</span>' + verdict("ok", "admitted") + '<span class="wv">no restrictions at all</span></div>' +
          '<div class="wcell"><span class="wk">baseline</span>' +
            (okBaseline ? verdict("ok", "admitted") : verdict("bad", "rejected")) +
            '<span class="wv">' + (okBaseline ? "nothing overtly dangerous" : "violates: " + baselineBreaks.join(", ")) + "</span></div>" +
          '<div class="wcell"><span class="wk">restricted</span>' +
            (okRestricted ? verdict("ok", "admitted") : verdict("bad", "rejected")) +
            '<span class="wv">' + (okRestricted ? "actively safe" : (okBaseline ? "missing: " + restrictedMissing.join(", ") : "fails baseline first")) + "</span></div>" +
        "</div>" +
        '<div class="wnote">In a namespace with <code>enforce: baseline</code> and <code>warn: restricted</code> (the lab\'s team-a), this pod would ' +
          (okBaseline ? "<b class='ok'>be admitted</b>" : "<b class='bad'>be rejected</b>") +
          (okBaseline && !okRestricted ? ", and print a warning naming " + restrictedMissing.length + " restricted violation" + (restrictedMissing.length === 1 ? "" : "s") + " that the audit log also records." : ".") +
        "</div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 5.1 · RBAC scope explorer ────────────────────────────── */
  function rbacscope(mount) {
    var f = frame("Role or ClusterRole, RoleBinding or ClusterRoleBinding", "four combinations, and only one of them is usually right");
    var st = { role: "Role", binding: "RoleBinding", verb: "list", res: "pods" };
    var ctls = h("div", { "class": "wctls wctls-row" });
    var out = announce(h("div", { "class": "wout" }));
    function picker(label, key, values) {
      var wrap = h("div", { "class": "wpick" });
      wrap.appendChild(h("span", { "class": "wlbl", html: label }));
      values.forEach(function (v) {
        var b = h("button", { "class": "wchip small" + (st[key] === v ? " sel" : ""), type: "button", html: v });
        b.addEventListener("click", function () {
          st[key] = v;
          Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (x) { x.classList.remove("sel"); });
          b.classList.add("sel"); draw();
        });
        wrap.appendChild(b);
      });
      ctls.appendChild(wrap);
    }
    picker("rules live in", "role", ["Role", "ClusterRole"]);
    picker("granted by", "binding", ["RoleBinding", "ClusterRoleBinding"]);
    picker("on", "res", ["pods", "secrets", "nodes"]);

    function draw() {
      var clusterScoped = st.res === "nodes";
      var invalid = st.binding === "ClusterRoleBinding" && st.role === "Role";
      var rows = [
        { ns: "team-a", label: "the bound namespace" },
        { ns: "team-b", label: "another namespace" },
        { ns: "cluster-scoped", label: "nodes, PVs, CRDs" }
      ];
      out.innerHTML = invalid
        ? '<div class="wnote bad">Not a valid combination: a ClusterRoleBinding can only reference a ClusterRole. The API server rejects the binding itself.</div>'
        : '<div class="wtable">' +
            '<div class="wtr wth"><span>where you ask</span><span>' + st.verb + " " + st.res + "</span><span>why</span></div>" +
            rows.map(function (r) {
              var allow, why;
              if (r.ns === "cluster-scoped") {
                allow = st.binding === "ClusterRoleBinding" && clusterScoped;
                why = clusterScoped
                  ? (allow ? "cluster-scoped resources need a ClusterRoleBinding" : "a RoleBinding can never grant cluster-scoped access")
                  : "not applicable: " + st.res + " are namespaced";
                if (!clusterScoped) allow = null;
              } else if (st.binding === "ClusterRoleBinding") {
                allow = !clusterScoped || false;
                why = clusterScoped ? "nodes are not in a namespace" : "a ClusterRoleBinding grants everywhere, usually more than you meant";
                if (clusterScoped) allow = false;
              } else {
                allow = r.ns === "team-a" && !clusterScoped;
                why = clusterScoped ? "namespaced binding, cluster-scoped resource" :
                      r.ns === "team-a" ? (st.role === "ClusterRole"
                        ? "a RoleBinding to a ClusterRole grants its rules <em>in this namespace only</em>"
                        : "the Role and its binding both live here")
                      : "the binding does not reach this namespace";
              }
              return '<div class="wtr"><span>' + r.ns + ' <em class="dimtext">' + r.label + "</em></span>" +
                "<span>" + (allow === null ? '<b class="dimtext">n/a</b>' : allow ? '<b class="ok">yes</b>' : '<b class="bad">no</b>') + "</span>" +
                "<span>" + why + "</span></div>";
            }).join("") +
          "</div>" +
          '<div class="wnote ' + (st.binding === "ClusterRoleBinding" && !clusterScoped ? "warn" : "") + '">' +
            (st.role === "ClusterRole" && st.binding === "RoleBinding"
              ? "<b>The pattern worth memorising:</b> define the role once as a ClusterRole, bind it per tenant with a RoleBinding. One definition, per-namespace grants."
              : st.binding === "ClusterRoleBinding" && !clusterScoped
                ? "This grants the rules in <em>every</em> namespace, including ones that do not exist yet. Almost always the wrong default, and the check an exam task adds to catch it is \"and not in team-b\"."
                : "Namespaced and self-contained. Fine for one tenant; you will copy the Role into every new namespace.") +
          "</div>";
      var proof = h("div", { "class": "wproof", html:
        '<code>kubectl auth can-i ' + st.verb + " " + st.res + " --as=dev-a -n team-b</code>: end every RBAC task with this." });
      out.appendChild(proof);
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }


  /* ── 1.1 · where the request dies ─────────────────────────── */
  function netpath(mount) {
    var f = frame("Follow one request until it fails", "flip a condition and watch which hop drops it");
    var st = { dns: true, selector: true, ready: true, policy: true, port: true };
    var ctls = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));
    [["dns", "DNS egress to kube-dns is allowed"],
     ["selector", "Service selector matches the pod labels"],
     ["ready", "pods pass their readiness probe"],
     ["policy", "NetworkPolicy allows the caller (both ends)"],
     ["port", "targetPort matches the container's port"]].forEach(function (o) {
      var t = toggle(o[1], true);
      t.input.addEventListener("change", function () { st[o[0]] = t.input.checked; draw(); });
      ctls.appendChild(t);
    });
    function draw() {
      var hops = [
        { n: "client pod", ok: true, note: "curl http://backend.team-a.svc:8080" },
        { n: "DNS (CoreDNS)", ok: st.dns,
          fail: "name does not resolve; every pod stays Running and nothing works",
          cmd: "kubectl exec … -- nslookup backend.team-a  ·  hubble observe --verdict DROPPED" },
        { n: "Service (ClusterIP)", ok: true, note: "a VIP, translated by the datapath; nothing listens on it" },
        { n: "EndpointSlice", ok: st.selector && st.ready,
          fail: st.selector ? "no ready endpoints; readiness gates slice membership" : "empty slice; the selector matches nothing",
          cmd: "kubectl get endpointslices -l kubernetes.io/service-name=backend" },
        { n: "NetworkPolicy", ok: st.policy,
          fail: "dropped; an egress allow on the caller and an ingress allow on the callee are both required",
          cmd: "hubble observe --namespace team-a --verdict DROPPED" },
        { n: "pod:targetPort", ok: st.port,
          fail: "connection refused; the Service points at a port nothing listens on",
          cmd: "kubectl get svc backend -o jsonpath='{.spec.ports[*].targetPort}'" }
      ];
      var firstBad = hops.filter(function (x) { return !x.ok; })[0];
      out.innerHTML =
        '<div class="wpath narrow">' + hops.map(function (x, i) {
          var state = x.ok ? (firstBad && hops.indexOf(firstBad) < i ? "skip" : "pass") : "fail";
          return '<div class="whop ' + state + '"><span class="whop-n">' + x.n + "</span>" +
                 '<span class="whop-s">' + (state === "pass" ? "✓" : state === "fail" ? "✕" : "·") + "</span></div>";
        }).join('<span class="whop-arr">↓</span>') + "</div>" +
        (firstBad
          ? '<div class="wnote bad"><b>' + firstBad.n + "</b>: " + firstBad.fail +
            '<div class="wproof" style="margin-top:6px"><code>' + firstBad.cmd + "</code></div></div>"
          : '<div class="wnote ok">200. Every hop is doing its job, and this is the state you have to reproduce before you can claim an incident is over.</div>') +
        '<div class="wnote">Symptom as the user reports it: <b>' +
          (!st.dns ? "“it hangs”: DNS timeouts look like a slow app"
           : !st.selector || !st.ready ? "“connection refused”: the name resolves, nothing is behind it"
           : !st.policy ? "“it hangs, then times out”: drops are silent by design"
           : !st.port ? "“connection refused”: instantly, from the pod itself"
           : "nothing to report") + "</b></div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 2.1 · the reconciliation loop ────────────────────────── */
  function gitops(mount) {
    var f = frame("The reconciliation loop, poked", "change git, change the cluster, then let the controller tick");
    var st = { git: 3, live: 3, gitHasSvc: true, liveHasSvc: true, selfHeal: true, prune: false, suspended: false, log: [] };
    var ctls = h("div", { "class": "wctls wctls-row" });
    var togs = h("div", { "class": "wctls" });
    var out = announce(h("div", { "class": "wout" }));

    function btn(label, fn, cls) {
      var b = h("button", { "class": "wbtn " + (cls || ""), type: "button", html: label });
      b.addEventListener("click", function () { fn(); draw(); });
      ctls.appendChild(b);
      return b;
    }
    btn("commit: replicas 5", function () { st.git = 5; note("git now says 5 replicas; nothing has happened in the cluster yet"); });
    btn("kubectl scale --replicas=9", function () { st.live = 9; note("live drift: someone scaled by hand"); });
    btn("delete service.yaml from git", function () { st.gitHasSvc = false; note("the Service manifest is gone from git"); }, "danger");
    btn("⟳ reconcile now", tick);
    btn("reset", function () { st.git = 3; st.live = 3; st.gitHasSvc = true; st.liveHasSvc = true; st.log = []; }, "ghost");

    [["selfHeal", "selfHeal (Argo) / re-apply at interval (Flux)"],
     ["prune", "prune"],
     ["suspended", "reconciliation suspended"]].forEach(function (o) {
      var t = toggle(o[1], st[o[0]]);
      t.input.addEventListener("change", function () { st[o[0]] = t.input.checked; draw(); });
      togs.appendChild(t);
    });

    function note(s) { st.log.unshift(s); st.log = st.log.slice(0, 4); }
    function tick() {
      if (st.suspended) { note("suspended: the controller did nothing, and reported no error either"); return; }
      var acted = false;
      if (st.live !== st.git) {
        if (st.live > st.git && !st.selfHeal) { note("OutOfSync reported: live " + st.live + " ≠ git " + st.git + ". Nothing corrected: selfHeal is off"); }
        else { note("applied git: replicas " + st.live + " → " + st.git); st.live = st.git; acted = true; }
      }
      if (!st.gitHasSvc && st.liveHasSvc) {
        if (st.prune) { st.liveHasSvc = false; note("pruned: the live Service was deleted because its manifest left git"); acted = true; }
        else { note("the Service is gone from git but stays in the cluster; without prune it lingers forever"); }
      }
      if (!acted && st.live === st.git && st.gitHasSvc) note("nothing to do: live already matches git");
    }
    function draw() {
      var drift = st.live !== st.git || st.gitHasSvc !== st.liveHasSvc;
      out.innerHTML =
        '<div class="wgrid">' +
          '<div class="wcell"><span class="wk">git (desired)</span><span class="wv wnum">' + st.git + ' replicas</span>' +
            '<span class="wv">service.yaml ' + (st.gitHasSvc ? "present" : "removed") + "</span></div>" +
          '<div class="wcell"><span class="wk">cluster (live)</span><span class="wv wnum">' + st.live + ' replicas</span>' +
            '<span class="wv">Service ' + (st.liveHasSvc ? "running" : "deleted") + "</span></div>" +
          '<div class="wcell"><span class="wk">sync status</span>' +
            (st.suspended ? verdict("warn", "Suspended") : drift ? verdict("bad", "OutOfSync") : verdict("ok", "Synced")) + "</div>" +
          '<div class="wcell"><span class="wk">what a green dashboard hides</span><span class="wv">' +
            (st.suspended ? "a suspended app reports no error at all; check suspension first"
                          : drift ? "the diff is real until the next tick" : "nothing right now") + "</span></div>" +
        "</div>" +
        '<div class="wlog">' + (st.log.length ? st.log.map(function (l) { return "<div>› " + l + "</div>"; }).join("")
                                              : "<div>› press a button, then reconcile</div>") + "</div>";
    }
    f.body.appendChild(ctls); f.body.appendChild(togs); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  /* ── 5.2 · the admission pipeline ─────────────────────────── */
  function admission(mount) {
    var f = frame("One pod through the admission pipeline", "the order is what makes policies fire, or silently not");
    var st = { limitRange: true, declares: false, privileged: false, kyverno: "Audit", pss: "baseline" };
    var ctls = h("div", { "class": "wctls" });
    var picks = h("div", { "class": "wctls wctls-row" });
    var out = announce(h("div", { "class": "wout" }));

    [["limitRange", "namespace has a LimitRange (defaults 50m/64Mi)"],
     ["declares", "the pod declares its own requests"],
     ["privileged", "the pod asks for privileged: true"]].forEach(function (o) {
      var t = toggle(o[1], st[o[0]]);
      t.input.addEventListener("change", function () { st[o[0]] = t.input.checked; draw(); });
      ctls.appendChild(t);
    });
    function picker(label, key, values) {
      var wrap = h("div", { "class": "wpick" });
      wrap.appendChild(h("span", { "class": "wlbl", html: label }));
      values.forEach(function (v) {
        var b = h("button", { "class": "wchip small" + (st[key] === v ? " sel" : ""), type: "button", html: v });
        b.addEventListener("click", function () {
          st[key] = v;
          Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (x) { x.classList.remove("sel"); });
          b.classList.add("sel"); draw();
        });
        wrap.appendChild(b);
      });
      picks.appendChild(wrap);
    }
    picker("kyverno require-requests", "kyverno", ["Audit", "Deny"]);
    picker("PSS enforce", "pss", ["privileged", "baseline", "restricted"]);

    function draw() {
      var hasRequests = st.declares || st.limitRange;
      var stages = [];
      stages.push({ n: "authn + authz (RBAC)", ok: true, note: "the caller may create pods here" });
      stages.push({ n: "mutating admission", ok: true,
        note: st.limitRange ? (st.declares ? "LimitRanger leaves the declared values alone"
                                           : "LimitRanger injects requests 50m / 64Mi")
                            : "nothing to mutate" });
      var pssFail = (st.pss === "baseline" || st.pss === "restricted") && st.privileged;
      stages.push({ n: "PodSecurity (" + st.pss + ")", ok: !pssFail,
        note: pssFail ? "violates the profile: privileged containers are not allowed"
                      : st.pss === "restricted" && !st.privileged ? "would also demand runAsNonRoot, drop ALL, seccomp; assume they are set"
                      : "nothing dangerous declared" });
      var kyvFail = st.kyverno === "Deny" && !hasRequests;
      stages.push({ n: "kyverno ValidatingPolicy", ok: !kyvFail,
        note: !hasRequests
          ? (st.kyverno === "Deny" ? "rejected: every container must set cpu and memory requests"
                                   : "violation recorded in a PolicyReport, pod admitted")
          : (st.limitRange && !st.declares
              ? "sees requests that the LimitRange injected; the policy passes on values the user never wrote"
              : "requests are present") });
      var firstBad = stages.filter(function (s) { return !s.ok; })[0];
      stages.push({ n: "persisted to etcd", ok: !firstBad, note: firstBad ? "never reached" : "the pod exists" });

      out.innerHTML =
        '<div class="wpath">' + stages.map(function (s, i) {
          var idx = stages.indexOf(firstBad);
          var state = !s.ok ? "fail" : (firstBad && idx > -1 && i > idx) ? "skip" : "pass";
          return '<div class="whop ' + state + '"><span class="whop-n">' + s.n + "</span>" +
                 '<span class="whop-s">' + (state === "pass" ? "✓" : state === "fail" ? "✕" : "·") + "</span>" +
                 '<span class="whop-note">' + s.note + "</span></div>";
        }).join('<span class="whop-arr">↓</span>') + "</div>" +
        (firstBad ? '<div class="wnote bad">Rejected at <b>' + firstBad.n + "</b>. The message arrives in the apply error, verbatim, and if this were a Deployment, it would land on the ReplicaSet instead of on your terminal.</div>"
                  : '<div class="wnote ok">Admitted.</div>') +
        (st.limitRange && !st.declares && st.kyverno === "Deny" && hasRequests
          ? '<div class="wnote warn">Note what just happened: the policy is in <b>Deny</b> and the pod declared nothing, yet it passed, because a <em>mutation</em> ran first and satisfied the validation. This is why the lab drills that policy in a namespace with no LimitRange.</div>'
          : "");
    }
    f.body.appendChild(ctls); f.body.appendChild(picks); f.body.appendChild(out); draw();
    mount.appendChild(f.root);
  }

  function announce(node) { node.setAttribute("aria-live", "polite"); return node; }

  var REGISTRY = {
    qos: qos, capacity: capacity, quota: quota, efficiency: efficiency,
    syncmatrix: syncmatrix, canary: canary, promrate: promrate,
    alertstate: alertstate, pss: pss, rbacscope: rbacscope,
    netpath: netpath, gitops: gitops, admission: admission
  };

  window.CNPE_WIDGETS = {
    mount: function () {
      Array.prototype.forEach.call(document.querySelectorAll(".widget"), function (m) {
        if (m.getAttribute("data-built")) return;
        var fn = REGISTRY[m.getAttribute("data-widget")];
        if (!fn) return;
        m.innerHTML = "";
        try { fn(m); m.setAttribute("data-built", "1"); }
        catch (e) { m.innerHTML = '<div class="wnote bad">widget failed: ' + e.message + "</div>"; }
      });
    }
  };
})();
