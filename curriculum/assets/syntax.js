"use strict";
/* CNPE curriculum: the colouring on command blocks. Escaped HTML in, escaped
   HTML out, no DOM, so tools/syntax-test.mjs drives it in bare node.
   Compiled into assets/syntax.js by tools/build-ts.sh. */
(function (root) {
    "use strict";
    var KWS = /\b(kubectl|helm|flux|argocd|argo|tkn|kubeseal|cosign|skopeo|trivy|docker|git|curl|jq|kustomize|istioctl|linkerd|hubble|cilium|crossplane|stern|kubectx|make|yq|base64|sudo|watch|source|echo|sleep|grep|awk|sed|sort|head|tail|wc|seq|for|do|done|while|if|then|fi|export)\b/g;
    // One language's passes, over a run with no string or comment left in it.
    function paint(s, lang) {
        if (!s)
            return s;
        if (lang === "yaml" || lang === "json") {
            s = s.replace(/(^|\n)([ \t-]*)([A-Za-z_][\w.\/-]*)(:)/g, '$1$2<span class="t-key">$3</span>$4');
            s = s.replace(/\b(true|false|null)\b/g, '<span class="t-kw">$1</span>');
            return s;
        }
        if (lang === "promql" || lang === "logql") {
            s = s.replace(/\b(sum|rate|increase|avg|count|max|min|by|without|histogram_quantile|absent|vector|topk|irate|delta|group_left|or|unless|and)\b/g, '<span class="t-kw">$1</span>');
            s = s.replace(/\b(\d+(\.\d+)?[smhdw]?)\b/g, '<span class="t-num">$1</span>');
            return s;
        }
        s = s.replace(KWS, function (m) { return '<span class="t-cmd">' + m + "</span>"; });
        s = s.replace(/(\s)(--?[A-Za-z][\w-]*)/g, '$1<span class="t-flag">$2</span>');
        s = s.replace(/(\$\{?[A-Za-z_][\w]*\}?)/g, '<span class="t-var">$1</span>');
        return s;
    }
    // Strings and comments first, so no pass paints inside a quoted run. Every
    // branch copies a slice through or wraps one, so nothing is unescaped.
    function highlight(html, lang) {
        var protectedRe = /(^|\n)([ \t]*#[^\n]*)|('[^'\n]*')|("[^"\n]*")/g;
        var out = "", last = 0, m;
        while ((m = protectedRe.exec(html)) !== null) {
            out += paint(html.slice(last, m.index), lang);
            if (m[2] != null)
                out += m[1] + '<span class="t-cm">' + m[2] + "</span>";
            else
                out += '<span class="t-str">' + m[0] + "</span>";
            last = m.index + m[0].length;
        }
        return out + paint(html.slice(last), lang);
    }
    root.CNPE_SYNTAX = { highlight: highlight, paint: paint };
})(typeof window !== "undefined" ? window : globalThis);
