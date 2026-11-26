"""
Connects the front end (WEB/script.js) to the behavioral check (s3 to s6, e1 to e3).

Run once from the project root, AFTER patch_frontend.py was already run:
    python backend\\patch_frontend_behavior.py

It saves a backup as WEB/script.js.bak2 and stops without changing anything if a
piece of text it expects is not found exactly once.
"""
import shutil, sys
from pathlib import Path

WEB = Path("WEB")
JS = WEB / "script.js"

EDITS = [
    # 1. wording of the four behavioral signs (paper Table 3.7.1)
    ("""    payment_request: {
      source: 'page', severity: 'danger', weight: 0.7,
      title: 'Payment requested on the page',
      detail: 'The page asks for a fee or payment before hiring.',
      clause: 'asks for a payment on the page',
    },
    hidden_redirect: {
      source: 'page', severity: 'danger', weight: 0.6,
      title: 'Hidden redirect',
      detail: 'The page sends you somewhere else without telling you.',
      clause: 'redirects you without telling you',
    },""",
     """    // s5: a payment word (fee, deposit, recharge, bayad) next to an amount or account, in an instruction to pay
    payment_request: {
      source: 'page', severity: 'danger', weight: 0.7,
      title: 'Payment requested on the page',
      detail: 'The page asks for a fee or payment before hiring.',
      clause: 'asks for a payment on the page',
    },
    // s3: three or more hops between websites, or the final website differs from the one first given
    hidden_redirect: {
      source: 'page', severity: 'danger', weight: 0.6,
      title: 'Redirect to another website',
      detail: 'The link sends you to a different website than the one it started with.',
      clause: 'sends you to a different website than the link shows',
    },"""),
    ("""    countdown_timer: {
      source: 'page', severity: 'warn', weight: 0.45,
      title: 'Countdown timer',
      detail: 'A fake clock is pushing you to decide fast.',
      clause: 'shows a countdown timer to rush you',
    },
    forced_signup: {
      source: 'page', severity: 'warn', weight: 0.4,
      title: 'Forced sign-up',
      detail: 'The page demands an account or personal details before showing anything.',
      clause: 'forces you to sign up before showing anything',
    },""",
     """    // s6: a clock that really counts down, read twice a few seconds apart
    countdown_timer: {
      source: 'page', severity: 'warn', weight: 0.45,
      title: 'Countdown timer',
      detail: 'A clock on the page counts down to push you to decide fast.',
      clause: 'shows a countdown timer to rush you',
    },
    // s4: a sign-up or login box covers the page and hides the offer
    forced_signup: {
      source: 'page', severity: 'warn', weight: 0.4,
      title: 'Forced registration',
      detail: 'A sign-up or login box covers the page and hides the offer until you register.',
      clause: 'forces you to register before showing the offer',
    },"""),

    # 2. the behavioral check opens the page in a browser, so it needs more time
    ("    pageScanEndpoint: 'http://localhost:5000/scan', // page scan: structural check (s1, s2) from scan_server.py",
     "    pageScanEndpoint: 'http://localhost:5000/scan', // page scan: structural (s1, s2) and behavioral (s3 to s6)\n"
     "    scanTimeoutMs: 40000, // the behavioral check watches the page for about 12 seconds"),
    ("""    const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
    try {
      const res = await fetch(CONFIG.pageScanEndpoint, {""",
     """    const timer = setTimeout(() => ctrl.abort(), CONFIG.scanTimeoutMs);
    try {
      const res = await fetch(CONFIG.pageScanEndpoint, {"""),

    # 3. read the behavioral result and the reason texts
    ("""    const structural = st && st.available ? { s1: st.s1, s2: st.s2 } : null;
    return {
      ids,
      details,
      structural,""",
     """    const structural = st && st.available ? { s1: st.s1, s2: st.s2 } : null;
    const bh = data?.behavioral ?? null;
    if (bh) {
      [['s3Note', 'hidden_redirect'], ['s4Note', 'forced_signup'], ['s5Note', 'payment_request'], ['s6Note', 'countdown_timer']]
        .forEach(([k, id]) => { if (typeof bh[k] === 'string') details[id] = bh[k].slice(0, 300); });
    }
    const behavioral = bh && bh.available
      ? { s3: bh.s3, s4: bh.s4, s5: bh.s5, s6: bh.s6, e1: bh.e1, e2: bh.e2, e3: bh.e3 }
      : null;
    return {
      ids,
      details,
      structural,
      behavioral,"""),
    ("evidence = { ...scan.evidence, structural: scan.structural };",
     "evidence = { ...scan.evidence, structural: scan.structural, behavioral: scan.behavioral };"),

    # 4. show s3 to s6 and e1 to e3 in the evidence table
    ("""  function renderDeep(scan) {""",
     """  function behaviorLabel(bh, key, scored = true) {
    if (!bh) return 'Not checked';
    if (bh[key] === 1) return scored ? 'Warning sign found' : 'Seen on the page';
    if (bh[key] === 0) return scored ? 'Not found' : 'Not seen';
    return 'Not available';
  }

  function renderDeep(scan) {"""),
    ("""      ['Page design (s2)', structuralLabel(ev.structural, 's2')],""",
     """      ['Page design (s2)', structuralLabel(ev.structural, 's2')],
      ['Redirect to another website (s3)', behaviorLabel(ev.behavioral, 's3')],
      ['Forced registration (s4)', behaviorLabel(ev.behavioral, 's4')],
      ['Payment request (s5)', behaviorLabel(ev.behavioral, 's5')],
      ['Countdown timer (s6)', behaviorLabel(ev.behavioral, 's6')],
      ['Form asking for sensitive details (e1, not scored)', behaviorLabel(ev.behavioral, 'e1', false)],
      ['Fake live-earnings pop-ups (e2, not scored)', behaviorLabel(ev.behavioral, 'e2', false)],
      ['Blocked right-click or selection (e3, not scored)', behaviorLabel(ev.behavioral, 'e3', false)],"""),

    # 5. the demo notice
    ("['Text and page-structure analysis', 'Paste a message, a link, or both. A link gets a structural check (business information and page design). Behavioral checks are not included yet.'],",
     "['Text, page-structure and behavior analysis', 'Paste a message, a link, or both. A link is opened in a safe browser that only watches: it never clicks, types or pays. This takes about 15 seconds.'],"),
]


def main():
    if not JS.exists():
        sys.exit("WEB/script.js not found. Run this from the project root.")
    text = JS.read_text(encoding="utf-8")
    if "behaviorLabel" in text:
        sys.exit("Already patched. Nothing to do.")
    if "structuralLabel" not in text:
        sys.exit("Run patch_frontend.py first (the structural patch is missing).")
    for old, _ in EDITS:
        n = text.count(old)
        if n != 1:
            sys.exit(f"Stopped: expected 1 match but found {n} for:\n{old[:90]}...\n"
                     "Nothing was changed. Send me this message.")
    shutil.copyfile(JS, WEB / "script.js.bak2")
    for old, new in EDITS:
        text = text.replace(old, new)
    JS.write_text(text, encoding="utf-8")
    for page in WEB.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        if "script.js?v=22" in html:
            page.write_text(html.replace("script.js?v=22", "script.js?v=23"), encoding="utf-8")
    print("Done. Backup saved as WEB/script.js.bak2")


if __name__ == "__main__":
    main()
