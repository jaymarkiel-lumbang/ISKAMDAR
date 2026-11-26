"""
patch_analytics.py  (run from the project root, safe to run twice)

What it changes in your existing site (nothing else is touched):

1. WEB/script.js
   - adds a small function that saves ONE anonymous row per scan in this browser
     (input type, outcome, signs, response time). No message text, no URL.
   - calls it at the end of analyze().
2. WEB/index.html, result.html, about.html, trends.html, report.html
   - adds the "Analytics" link to the top menu.
   - bumps script.js?v=26 to script.js?v=27 so the browser loads the new file.

Every edit checks its anchor first. If an anchor is missing, nothing is written.
A backup is saved once as WEB/script.js.bak4.
"""
import re
import shutil
import sys
from pathlib import Path

WEB = Path("WEB")
JS = WEB / "script.js"
PAGES = ["index.html", "result.html", "about.html", "trends.html", "report.html"]
MARK = "logForAnalytics"


def fail(msg):
    print("STOPPED:", msg)
    sys.exit(1)


if not JS.exists():
    fail("Run this from the project root (the folder that contains WEB).")

js = JS.read_text(encoding="utf-8")

# ---------- script.js ----------
if MARK not in js:
    a1 = "  /** The whole pipeline: input -> routing -> text -> link -> page -> score. */\n  async function analyze(rawInput) {\n"
    a2 = "    const signals = [...found.values()].sort((a, b) => b.weight - a.weight);\n    const score = scoreSignals(signals);\n    return {\n      id: newId(),"
    for a in (a1, a2):
        if js.count(a) != 1:
            fail("Could not find the expected place in script.js. Send me the analyze() function.")

    logger = '''  /* ---- 3d-b. Anonymous scan log for the analytics page ------------ */
  const ANALYTICS_KEY = 'iskamdar.analytics.live.v1';

  /** Saves one metadata row per scan in this browser. No message text and no URL. */
  function logForAnalytics({ routed, signals, score, pageScanned, ms }) {
    try {
      const inputType = routed.kind === 'both' ? 'both' : routed.kind === 'link' ? 'link' : 'text';
      const wantedPage = routed.urls.length > 0 && Boolean(CONFIG.pageScanEndpoint);
      const outcome = wantedPage && !pageScanned ? 'unexamined' : 'scored';
      const rows = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]');
      rows.push({
        ts: Date.now(), inputType, outcome,
        signs: outcome === 'scored' ? signals.map((s) => s.id) : [],
        score: outcome === 'scored' ? score : null,
        failure: outcome === 'unexamined' ? 'Timeout or error' : null,
        ms: Math.round(ms),
      });
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(rows.slice(-500)));
    } catch { /* storage unavailable: analytics is optional */ }
  }

'''
    js = js.replace(a1, logger + a1 + "    const startedAt = performance.now();\n", 1)
    js = js.replace(
        a2,
        "    const signals = [...found.values()].sort((a, b) => b.weight - a.weight);\n    const score = scoreSignals(signals);\n"
        "    logForAnalytics({ routed, signals, score, pageScanned, ms: performance.now() - startedAt });\n"
        "    return {\n      id: newId(),",
        1,
    )
    if not Path(str(JS) + ".bak4").exists():
        shutil.copy(JS, str(JS) + ".bak4")
    print("script.js: scan log added")
else:
    print("script.js: already patched")

js = re.sub(r"script\.js\?v=\d+", "script.js?v=27", js)
JS.write_text(js, encoding="utf-8")

# ---------- menu link + cache bump on every page ----------
LINK = '<a href="analytics.html" data-nav="analytics">Analytics</a>'
for name in PAGES:
    p = WEB / name
    if not p.exists():
        print(name, ": not found, skipped")
        continue
    h = p.read_text(encoding="utf-8")
    if LINK not in h:
        m = re.search(r'(\n?[ \t]*)<a href="trends\.html" data-nav="trends"[^>]*>Scam Trends</a>', h)
        if not m:
            print(name, ": menu anchor not found, skipped (add the Analytics link by hand)")
            continue
        indent = m.group(1)
        h = h[: m.end()] + indent + LINK + h[m.end():]
        print(name, ": Analytics link added")
    else:
        print(name, ": link already there")
    h = re.sub(r"script\.js\?v=\d+", "script.js?v=27", h)
    p.write_text(h, encoding="utf-8")

print("Done.")
