"""
Connects the front end (WEB/script.js) to the structural check (s1, s2).

It edits your existing WEB/script.js in place, so any other changes you made
to that file are kept. It first saves a backup as WEB/script.js.bak, and it
stops without changing anything if a piece of text it expects is not found.

Run once from the project root:
    python backend\\patch_frontend.py
"""
import shutil, sys
from pathlib import Path

WEB = Path("WEB")
JS = WEB / "script.js"

EDITS = [
    # 1. turn on the page scan
    ("pageScanEndpoint: '', // text-analysis prototype: no page scan",
     "pageScanEndpoint: 'http://localhost:5000/scan', // page scan: structural check (s1, s2) from scan_server.py"),

    # 2. the two structural signs (paper Table 3.6.1)
    ("""    no_business_info: {
      source: 'page', severity: 'danger', weight: 0.55,
      title: 'No verifiable business info',
      detail: 'The page names no registered company or address.',
      clause: 'names no registered company or address',
    },""",
     """    // s1: fewer than 2 of 4 kinds of business information (name, address, contact, registration no.)
    no_business_info: {
      source: 'page', severity: 'danger', weight: 0.55,
      title: 'Missing or unclear business information',
      detail: 'The page does not clearly say who runs the business or how to reach it.',
      clause: 'does not clearly say who runs the business',
    },
    // s2: at least 2 of 3 conditions (few links, placeholder text, no privacy/terms link)
    suspicious_design: {
      source: 'page', severity: 'warn', weight: 0.4,
      title: 'Suspicious page design',
      detail: 'The page looks bare or unfinished instead of like a real business page.',
      clause: 'looks bare or unfinished, unlike a real business page',
    },"""),

    # 3. read the structural result and the reason text sent by the server
    ("""    return {
      ids,
      evidence: {""",
     """    const st = data?.structural ?? null;
    const details = {};
    if (st && typeof st.s1Note === 'string') details.no_business_info = st.s1Note.slice(0, 300);
    if (st && typeof st.s2Note === 'string') details.suspicious_design = st.s2Note.slice(0, 300);
    const structural = st && st.available ? { s1: st.s1, s2: st.s2 } : null;
    return {
      ids,
      details,
      structural,
      evidence: {"""),

    # 4. use the reason text and keep the structural result in the evidence
    ("scan.ids.forEach((id) => add({ id }));",
     "scan.ids.forEach((id) => add({ id, ...(scan.details[id] ? { detail: scan.details[id] } : {}) }));"),
    ("evidence = scan.evidence;",
     "evidence = { ...scan.evidence, structural: scan.structural };"),

    # 5. the demo notice said links are not scanned, which is no longer true
    ("['Text analysis only', 'Paste a message. Links and web pages are not scanned in this version.'],",
     "['Text and page-structure analysis', 'Paste a message, a link, or both. A link gets a structural check (business information and page design). Behavioral checks are not included yet.'],"),

    # 6. the server's flagCount is just the number of signs on this one page, but
    #    the report page presents it as "flagged N times this month". Do not use it.
    ("flagCount = scan.flagCount;",
     "flagCount = null; // server flagCount is signs on this page, not a monthly report count"),

    # 7. show s1 and s2 in the evidence table
    ("  function renderDeep(scan) {",
     """  function structuralLabel(st, key) {
    if (!st) return 'Not checked';
    if (st[key] === 1) return 'Warning sign found';
    if (st[key] === 0) return 'Not found';
    return 'Not available';
  }

  function renderDeep(scan) {"""),
    ("      ['Known scam pattern match',",
     """      ['Business information (s1)', structuralLabel(ev.structural, 's1')],
      ['Page design (s2)', structuralLabel(ev.structural, 's2')],
      ['Known scam pattern match',"""),
]


def main():
    if not JS.exists():
        sys.exit("WEB/script.js not found. Run this from the project root.")
    text = JS.read_text(encoding="utf-8")
    if "structuralLabel" in text:
        sys.exit("Already patched. Nothing to do.")
    for old, _ in EDITS:
        n = text.count(old)
        if n != 1:
            sys.exit(f"Stopped: expected 1 match but found {n} for:\n{old[:90]}...\n"
                     "Nothing was changed. Send me this message.")
    shutil.copyfile(JS, WEB / "script.js.bak")
    for old, new in EDITS:
        text = text.replace(old, new)
    JS.write_text(text, encoding="utf-8")
    # the browser caches script.js?v=21, so bump the version in every page
    for page in WEB.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        if "script.js?v=21" in html:
            page.write_text(html.replace("script.js?v=21", "script.js?v=22"), encoding="utf-8")
    print("Done. Backup saved as WEB/script.js.bak")


if __name__ == "__main__":
    main()