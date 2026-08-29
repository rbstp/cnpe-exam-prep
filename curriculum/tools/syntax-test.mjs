/* Direct tests for the command-block highlighting. Plain node, no dependencies:
 *
 *     node curriculum/tools/syntax-test.mjs
 *
 * assets/syntax.js touches no DOM, so what it does to a line of shell or YAML
 * is checked here rather than through a staged site and a real browser. */
import { createRequire } from "node:module";

createRequire(import.meta.url)("../assets/syntax.js");   // a browser script; it finds globalThis
const S = globalThis.CNPE_SYNTAX;

let checks = 0, failures = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) console.log("  ok  " + label);
  else { failures++; console.log("  FAIL " + label); }
};
const group = (name) => console.log("\n" + name);

// Strip the tags back off and the input must return exactly.
const strip = (s) => s.replace(/<span class="t-[a-z]+">/g, "").replace(/<\/span>/g, "");
const spans = (s) => (s.match(/<span class="t-([a-z]+)">/g) || [])
  .map((m) => m.replace(/^<span class="t-|">$/g, ""));

group("shell: commands, flags and variables");
{
  const out = S.highlight("kubectl get pods --all-namespaces", "bash");
  ok(spans(out).includes("cmd"), "kubectl is painted as a command");
  ok(spans(out).includes("flag"), "--all-namespaces is painted as a flag");
  ok(strip(out) === "kubectl get pods --all-namespaces", "and stripping the tags gives the input back");

  const v = S.highlight("echo ${HOME} and $USER", "bash");
  ok(spans(v).filter((s) => s === "var").length === 2, "both ${HOME} and $USER are variables");
  ok(strip(v) === "echo ${HOME} and $USER", "round trip: " + JSON.stringify(strip(v)));

  ok(!spans(S.highlight("kubectlx get", "bash")).includes("cmd"),
    "kubectlx is not kubectl: the keyword list is bounded on the right");
  ok(!spans(S.highlight("xkubectl get", "bash")).includes("cmd"),
    "and on the left: xkubectl is not kubectl either");
  ok(!spans(S.highlight("a-b", "bash")).includes("flag"),
    "a hyphen mid-word is not a flag");
}

group("shell: strings and comments shield what is inside them");
{
  // Shielding covers what is inside the quotes, not a command before them.
  const q = S.highlight('echo "kubectl --now"', "bash");
  ok(spans(q).join() === "cmd,str",
    "the command outside paints, the quoted run is one string: " + spans(q).join());
  ok(!/t-cmd">kubectl|t-flag/.test(q), "and kubectl and --now inside it are left alone");
  ok(strip(q) === 'echo "kubectl --now"', "round trip");

  const s = S.highlight("echo 'git --hard'", "bash");
  ok(spans(s).join() === "cmd,str", "single quotes shield the same way");
  ok(!/t-cmd">git|t-flag/.test(s), "git and --hard inside them are left alone");

  // Match the whole span, not just its class: an empty span in the right place
  // and the text beside it satisfies spans() and strip() both.
  const c = S.highlight("# kubectl --dry-run\nkubectl apply", "bash");
  ok(/<span class="t-cm"># kubectl --dry-run<\/span>/.test(c),
    "a leading # is a comment, and the comment is what the span holds: " + JSON.stringify(c));
  ok(spans(c).includes("cmd"), "and the line after it still highlights");
  ok(strip(c) === "# kubectl --dry-run\nkubectl apply", "round trip across the newline");

  const i = S.highlight("  # indented", "bash");
  ok(spans(i).join() === "cm", "an indented comment is still a comment");
  const mid = S.highlight("kubectl get # trailing", "bash");
  ok(!spans(mid).includes("cm"), "but a # mid-line is not: only whole comment lines are shielded");
}

group("yaml and json");
{
  const y = S.highlight("apiVersion: v1\n  name: web\n  - kind: Pod", "yaml");
  ok(spans(y).filter((s) => s === "key").length === 3,
    "three keys, indented and list-dashed alike: " + spans(y).join());
  ok(strip(y) === "apiVersion: v1\n  name: web\n  - kind: Pod", "round trip");

  const b = S.highlight("enabled: true\nmissing: null", "yaml");
  ok(spans(b).filter((s) => s === "kw").length === 2, "true and null are keywords");
  ok(!spans(S.highlight("url: http://x/y", "yaml")).includes("flag"),
    "yaml never runs the shell passes, so a URL is not a flag");
  // json must actually reach the yaml pass, or the two assertions below hold
  // just as well for a json routed to the shell one.
  ok(spans(S.highlight("a: 1", "json")).includes("key"), "json takes the yaml pass");
  // Quotes are shielded before any language pass, so a json key is a string,
  // never a key. Always has been; pinning the shape, not fixing it.
  const j = S.highlight('{\n  "a": 1\n}', "json");
  ok(spans(j).join() === "str", 'a quoted json key lands as a string: ' + spans(j).join());
  ok(strip(j) === '{\n  "a": 1\n}', "round trip");
}

group("promql and logql");
{
  const p = S.highlight("sum(rate(http_total[5m])) by (job)", "promql");
  ok(spans(p).filter((s) => s === "kw").length >= 3, "sum, rate and by are keywords: " + spans(p).join());
  ok(spans(p).includes("num"), "5m is a number with a unit");
  ok(strip(p) === "sum(rate(http_total[5m])) by (job)", "round trip");
  ok(spans(S.highlight("sum(rate(x[5m]))", "logql")).join() === "kw,kw,num",
    "logql takes the same pass as promql, keywords and all");
  ok(spans(S.highlight('{app="web"}', "logql")).join() === "str",
    "and a label value in it is still a string");
}

group("the input is the page's own escaped markup, and stays escaped");
{
  const esc = "echo &lt;script&gt; &amp;&amp; kubectl get";
  const out = S.highlight(esc, "bash");
  ok(!/<script/.test(out), "an escaped tag is never unescaped");
  ok(strip(out) === esc, "round trip leaves every entity intact: " + JSON.stringify(strip(out)));
  ok(spans(out).includes("cmd"), "and the real command still highlights");
}

group("the contract: escaped markup in, or the output is not markup");
{
  // app.js only ever hands this the first <code> in a .cb, which authors write
  // as escaped text. Raw tags are outside the contract and this is what they
  // cost, recorded so that changing the call site shows up as a failure here.
  const raw = S.highlight('<b class="x">kubectl</b>', "bash");
  ok(raw !== '<b class="x">kubectl</b>', "a raw attribute is not left alone");
  ok(/t-str">"x"/.test(raw), "the quote rule eats it as a string: " + JSON.stringify(raw));
  ok(strip(raw) === '<b class="x">kubectl</b>', "the text still round trips, but the markup is broken");
}

group("the guards");
{
  ok(S.highlight("", "bash") === "", "empty input gives empty output");
  ok(S.paint("", "bash") === "", "so does an empty paint");
  const unknown = S.highlight("kubectl --x", "rust");
  ok(spans(unknown).includes("cmd"), "an unknown language falls through to the shell passes");
  ok(strip(S.highlight("a".repeat(4000) + " kubectl", "bash")).length === 4008,
    "a long line round trips whole");
}

console.log("\n" + checks + " checks, " + failures + " failures");
process.exit(failures ? 1 : 0);
