"""
New design for the "Learn more" (Deep Analysis) dialog. Shows s1 to s6 (scored)
and e1 to e3 (shown for information only, not scored).

Run from the project root:
    python backend\\patch_deep_design.py

Safe to run again: it replaces an earlier version of this design if one is there.
It edits WEB/result.html, WEB/script.js and WEB/style.css, saves backups with the
ending .bak3 (the first time only), and stops without changing anything if a
piece it expects is missing.
"""
import re, shutil, sys
from pathlib import Path

WEB = Path("WEB")
HTML, JS, CSS = WEB / "result.html", WEB / "script.js", WEB / "style.css"

# ------------------------------------------------------------------ markup
DIALOG = """  <dialog class="dlg dlg--lg dx" id="dlg-deep" aria-labelledby="dlg-deep-title" data-level="high">
    <div class="dx__body">
      <header class="dx__head">
        <div class="dx__head-text">
          <h2 class="dx__title" id="dlg-deep-title"><span class="text-blue">Deep Analysis:</span> Understanding the Risk</h2>
          <p class="dx__lead" id="deep-lead"></p>
        </div>
        <div class="dx__score" aria-label="Risk score">
          <p class="dx__score-num"><span id="deep-score">0</span><small>%</small></p>
          <p class="dx__level" id="deep-level">High risk</p>
          <div class="dx__meter" aria-hidden="true"><i id="deep-meter"></i></div>
        </div>
        <button class="dx__x" type="button" data-close aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>

      <section class="dx__section" aria-labelledby="dx-flags-h">
        <h3 class="dx__h" id="dx-flags-h">Red flag breakdown</h3>
        <ul class="dx__flags" id="deep-flags"></ul>
      </section>

      <div class="dx__cols">
        <section class="dx__section" aria-labelledby="dx-checks-h">
          <h3 class="dx__h" id="dx-checks-h">Verifiable evidence</h3>
          <div class="dx__checks" id="deep-evidence"></div>
        </section>

        <aside class="dx__section dx__tips" aria-labelledby="dx-tips-h">
          <h3 class="dx__h" id="dx-tips-h">Mitigation tips</h3>
          <ul class="dx__tiplist">
            <li>Do not transact or share data</li>
            <li>Block and report</li>
            <li>Never cash unverified checks</li>
            <li>Do not click additional links</li>
            <li>Verify via official accounts</li>
            <li>Report to authorities</li>
          </ul>
        </aside>
      </div>

      <footer class="dx__actions">
        <button class="btn btn--ghost" type="button" data-close>Close</button>
        <a class="btn btn--danger" href="report.html?src=result">Report</a>
      </footer>
    </div>
  </dialog>
"""

# ------------------------------------------------------------------ script
JS_CHUNK = r"""  /* ---- Deep analysis dialog (Learn more) ---------------------------- */

  // s1 to s6 enter the model (paper Table 3.8.1). e1 to e3 are only shown (Table 3.7.2).
  const DEEP_GROUPS = [
    ['Structure', 'What the page shows', true, [
      ['s1', 'Business information', 'no_business_info', 'structural'],
      ['s2', 'Page design', 'suspicious_design', 'structural'],
    ]],
    ['Behavior', 'What the page does', true, [
      ['s3', 'Redirect to another website', 'hidden_redirect', 'behavioral'],
      ['s4', 'Forced registration', 'forced_signup', 'behavioral'],
      ['s5', 'Payment request', 'payment_request', 'behavioral'],
      ['s6', 'Countdown timer', 'countdown_timer', 'behavioral'],
    ]],
    ['Also observed', 'For your information, not part of the score', false, [
      ['e1', 'Form asking for sensitive details', null, 'behavioral'],
      ['e2', 'Fake live-earnings pop-ups', null, 'behavioral'],
      ['e3', 'Blocked right-click or selection', null, 'behavioral'],
    ]],
  ];

  function checkState(group, key, severity, scored) {
    if (!group) return { tone: 'idle', text: 'Not checked' };
    if (group[key] === 1) {
      return scored
        ? { tone: severity === 'warn' ? 'warn' : 'danger', text: 'Warning sign found' }
        : { tone: 'info', text: 'Seen on the page' };
    }
    if (group[key] === 0) return scored ? { tone: 'ok', text: 'Not found' } : { tone: 'idle', text: 'Not seen' };
    return { tone: 'idle', text: 'Not available' };
  }

  function pill(tone, text) {
    return el('span', { class: 'dx__st dx__st--' + tone, text });
  }

  function renderDeep(scan) {
    const dlg = $('#dlg-deep');
    dlg.dataset.level = scan.level;
    $('#deep-score').textContent = scan.score;
    $('#deep-meter').style.width = Math.max(2, Math.min(100, scan.score)) + '%';
    $('#deep-level').textContent = LEVELS[scan.level].label;
    $('#deep-lead').textContent = LEVELS[scan.level].heading;

    // red flags
    const flags = $('#deep-flags');
    flags.replaceChildren();
    const shown = scan.signals.slice(0, 6);
    if (!shown.length) {
      flags.append(el('li', { class: 'dx__flag' }, [
        icon('i-shield-check', 'flags__icon flags__icon--warn'),
        el('div', { class: 'dx__flag-text' }, [
          el('p', { class: 'dx__flag-title', text: 'No red flags' }),
          el('p', { class: 'dx__flag-detail', text: 'Nothing in what you shared matched our scam patterns.' }),
        ]),
      ]));
    }
    shown.forEach((s) => {
      const info = sig(s);
      flags.append(el('li', { class: 'dx__flag' }, [
        icon('i-alert', 'flags__icon' + (info.severity === 'warn' ? ' flags__icon--warn' : '')),
        el('div', { class: 'dx__flag-text' }, [
          el('p', { class: 'dx__flag-title', text: info.title }),
          el('p', { class: 'dx__flag-detail', text: info.detail }),
        ]),
      ]));
    });

    // page checks: s1 to s6, grouped
    const ev = scan.evidence || {};
    const box = $('#deep-evidence');
    box.replaceChildren();

    const scanned = scan.pageScanned ? 'Completed' : scan.urls.length ? 'Not available' : 'No link given';
    const meta = [['Page scan', scanned, scan.pageScanned ? 'ok' : 'idle']];
    if (ev.pageAgeDays != null) meta.push(['Page age', `${ev.pageAgeDays} day${ev.pageAgeDays === 1 ? '' : 's'}`, ev.pageAgeDays < NEW_DOMAIN_DAYS ? 'warn' : 'ok']);
    if (ev.registrar) meta.push(['Domain registrar', ev.registrar, 'idle']);

    box.append(el('div', { class: 'dx__group' }, [
      el('div', { class: 'dx__group-head' }, [el('p', { class: 'dx__group-name', text: 'Scan' })]),
      ...meta.map(([label, value, tone]) => el('div', { class: 'dx__row dx__row--plain' }, [
        el('span', { class: 'dx__label', text: label }),
        pill(tone, value),
      ])),
    ]));

    DEEP_GROUPS.forEach(([name, note, scored, rows]) => {
      box.append(el('div', { class: 'dx__group' + (scored ? '' : ' dx__group--extra') }, [
        el('div', { class: 'dx__group-head' }, [
          el('p', { class: 'dx__group-name', text: name }),
          el('p', { class: 'dx__group-note', text: note }),
        ]),
        ...rows.map(([id, label, signalId, layer]) => {
          const st = checkState(ev[layer], id, signalId ? SIGNALS[signalId]?.severity : null, scored);
          return el('div', { class: 'dx__row' }, [
            el('span', { class: 'dx__id', text: id }),
            el('span', { class: 'dx__label', text: label }),
            pill(st.tone, st.text),
          ]);
        }),
      ]));
    });
  }

"""

# ------------------------------------------------------------------ styles
CSS_BLOCK = r"""
/* ---------------------------------------------------------------------
   Deep analysis dialog (Learn more)
   ------------------------------------------------------------------- */
#dlg-deep.dx {
  --level: var(--level-high);
  width: min(920px, calc(100vw - 32px));
  background: #fff;
  border-radius: 28px;
  box-shadow: var(--shadow-dialog);
}
#dlg-deep.dx[data-level="medium"] { --level: #b87000; }
#dlg-deep.dx[data-level="low"] { --level: var(--green); }

.dx__body { position: relative; padding: 0 40px; }

.dx__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 36px 52px 22px 0; border-bottom: 2px solid var(--ink); }
.dx__head-text { min-width: 0; }
.dx__title { margin: 0; font-size: clamp(1.35rem, 2.4vw, 1.7rem); font-weight: 700; line-height: 1.25; color: var(--ink); }
.dx__lead { margin: 8px 0 0; font-size: 0.95rem; color: var(--muted); }

.dx__score { flex: none; text-align: right; }
.dx__score-num { margin: 0; font-size: 3rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: var(--ink); }
.dx__score-num small { margin-left: 2px; font-size: 1.15rem; font-weight: 600; color: var(--muted); }
.dx__level { margin: 6px 0 8px; font-size: 0.95rem; font-weight: 700; color: var(--level); }
.dx__meter { width: 150px; height: 6px; margin-left: auto; background: var(--line); border-radius: 3px; overflow: hidden; }
.dx__meter i { display: block; height: 100%; width: 0; background: var(--level); }

.dx__x {
  position: absolute; top: 18px; right: 18px; display: grid; place-items: center;
  width: 34px; height: 34px; padding: 0; color: var(--ink-soft);
  background: #fff; border: 1px solid var(--line-strong); border-radius: 50%; cursor: pointer;
}
.dx__x:hover { background: #eef0f5; }
.dx__x:focus-visible, .dx__actions .btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

.dx__section { margin-top: 26px; }
.dx__h { margin: 0 0 4px; font-size: 1.05rem; font-weight: 700; color: var(--ink); }

/* red flags: a plain ruled list */
.dx__flags { margin: 0; padding: 0; list-style: none; }
.dx__flag { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 16px; align-items: start; padding: 14px 0; border-top: 1px solid var(--line); }
.dx__flag:last-child { border-bottom: 1px solid var(--line); }
.dx__flag .flags__icon { margin-top: 1px; }
.dx__flag-title { margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--ink); }
.dx__flag-detail { margin: 3px 0 0; font-size: 0.86rem; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }

.dx__cols { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 0 44px; align-items: start; }

/* evidence: one ruled list per group */
.dx__group { margin-top: 14px; }
.dx__group-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; padding-bottom: 4px; }
.dx__group-name { margin: 0; font-size: 0.86rem; font-weight: 700; color: var(--ink); }
.dx__group-note { margin: 0; font-size: 0.76rem; color: var(--muted); }
.dx__row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: baseline; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
.dx__row--plain { grid-template-columns: minmax(0, 1fr) auto; }
.dx__id { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; color: var(--muted); }
.dx__label { font-size: 0.9rem; color: var(--ink); }
.dx__group--extra { margin-top: 22px; }
.dx__group--extra .dx__label { color: var(--ink-soft); }

.dx__st { font-size: 0.84rem; font-weight: 500; white-space: nowrap; color: var(--muted); }
.dx__st--danger { font-weight: 700; color: #d3141c; }
.dx__st--warn { font-weight: 700; color: #a86a00; }
.dx__st--ok { color: #17844a; }
.dx__st--info { font-weight: 600; color: var(--blue); }

/* mitigation: same outlined box the site already uses */
.dx__tips { padding: 20px 22px 12px; border: 2px solid var(--ink); border-radius: 20px; }
.dx__tips .dx__h { margin-bottom: 6px; }
.dx__tiplist { margin: 0; padding: 0; list-style: none; }
.dx__tiplist li { position: relative; padding: 9px 0 9px 28px; font-size: 0.9rem; color: var(--ink); border-top: 1px solid var(--line); }
.dx__tiplist li::before {
  content: ""; position: absolute; left: 0; top: 50%; width: 16px; height: 16px; transform: translateY(-50%);
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a5fa8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12.5l5 5L20 6.5'/%3E%3C/svg%3E") center / contain no-repeat;
}

.dx__actions { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 12px; margin: 28px -40px 0; padding: 16px 40px 22px; background: #fff; border-top: 1px solid var(--line); }

@media (max-width: 860px) {
  .dx__cols { grid-template-columns: 1fr; }
  .dx__tips { margin-top: 26px; }
}
@media (max-width: 560px) {
  .dx__body { padding: 0 20px; }
  .dx__head { flex-direction: column; align-items: flex-start; gap: 16px; padding: 28px 40px 18px 0; }
  .dx__score { text-align: left; }
  .dx__meter { margin-left: 0; }
  .dx__row { grid-template-columns: 28px minmax(0, 1fr); }
  .dx__row .dx__st { grid-column: 2; }
  .dx__row--plain { grid-template-columns: minmax(0, 1fr); }
  .dx__row--plain .dx__st { grid-column: 1; }
  .dx__actions { margin: 24px -20px 0; padding: 14px 20px 18px; flex-direction: column-reverse; }
  .dx__actions .btn { width: 100%; }
}
"""


def main():
    for f in (HTML, JS, CSS):
        if not f.exists():
            sys.exit(f"{f} not found. Run this from the project root.")
    html, js, css = (f.read_text(encoding="utf-8") for f in (HTML, JS, CSS))

    # html: the old dialog, or an earlier version of this design
    a = max(html.find('  <dialog class="dlg dlg--lg dx" id="dlg-deep"'),
            html.find('  <dialog class="dlg dlg--lg" id="dlg-deep"'))
    b = html.find("  </dialog>\n", a) if a >= 0 else -1
    # script: the old functions, or an earlier version of this design
    s1 = js.find("  /* ---- Deep analysis dialog (Learn more)")
    if s1 < 0:
        s1 = js.find("  function structuralLabel(st, key) {")
    s2 = js.find("  function fillPreview(prefix, scan) {")
    if min(a, b, s1, s2) < 0 or s2 < s1 or js.count("  function fillPreview(prefix, scan) {") != 1:
        sys.exit("Stopped: could not find the Deep Analysis code. Nothing was changed. Send me this message.")

    for f in (HTML, JS, CSS):
        bak = f.with_name(f.name + ".bak3")
        if not bak.exists():
            shutil.copyfile(f, bak)
    html = html[:a] + DIALOG + html[b + len("  </dialog>\n"):]
    js = js[:s1] + JS_CHUNK + js[s2:]
    mark = css.find("Deep analysis dialog (Learn more)")
    if mark >= 0:
        css = css[:css.rfind("/* ---", 0, mark)]
    CSS.write_text(css.rstrip() + "\n" + CSS_BLOCK, encoding="utf-8")
    HTML.write_text(html, encoding="utf-8")
    JS.write_text(js, encoding="utf-8")

    # browsers cache these files, so raise the version number in every page
    for page in WEB.glob("*.html"):
        t = page.read_text(encoding="utf-8")
        t2 = re.sub(r"script\.js\?v=\d+", "script.js?v=26", t)
        t2 = re.sub(r"style\.css\?v=\d+", "style.css?v=24", t2)
        if t2 != t:
            page.write_text(t2, encoding="utf-8")
    print("Done. Backups saved with the ending .bak3")


if __name__ == "__main__":
    main()