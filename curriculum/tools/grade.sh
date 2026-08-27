#!/usr/bin/env bash
# Grade a mock exam against the live cluster by running the grading block
# straight from the exam page. The page is the single source of truth: this
# extracts the <code> block from its Grading section and executes it with
# 'bash -v', so each command (and its expected-value comment) prints right
# before its output, exactly as if you had pasted the block yourself.
#
#     tools/grade.sh [1|2]        # default 1;  or: make grade EXAM=2
#
# Grading is meant to run ONCE against finished work: a few lines are not
# idempotent (task namespaces get created), and the two observability checks
# start port-forwards, which this wrapper reaps on the way out.
set -uo pipefail   # no -e: a failing grading line is a lost point, not a crash

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(dirname "$HERE")"
case "${1:-1}" in
  1) PAGE="$SRC/mock-exam.html" ;;
  2) PAGE="$SRC/mock-exam-2.html" ;;
  *) echo "usage: grade.sh [1|2]" >&2; exit 2 ;;
esac

BLOCK="$(python3 - "$PAGE" <<'PY'
import html, re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'id="grading".*?<pre><code>(.*?)</code></pre>', text, re.S)
if not m:
    sys.exit("no grading block found in " + sys.argv[1])
print(html.unescape(m.group(1)))
PY
)" || exit 1

echo "── grading block from ${PAGE##*/}: each line prints what earns the points"
bash -v <<<"$BLOCK"
echo "── done: compare every output against its trailing # comment"
pkill -f 'port-forward svc/prometheus-kube-prometheus-prometheus 19090' 2>/dev/null
pkill -f 'port-forward svc/prometheus-kube-prometheus-alertmanager 9093' 2>/dev/null
exit 0
