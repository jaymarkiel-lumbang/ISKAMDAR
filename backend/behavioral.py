"""
ISKAMDAR behavioral analysis (prototype): signs s3 to s6 and observations e1 to e3
from Section 3.7 of the paper (Tables 3.7.1 to 3.7.3).

It loads the page in headless Chromium (Playwright), lets the scripts run, watches
for about 10 seconds and scrolls the page ONCE. It never clicks, types, submits,
logs in, pays, accepts a permission request, or opens other pages of the site.
Downloads are off, and images, fonts and media are not loaded.

    s3  Redirect              3+ cross-domain hops, or the final domain differs from
                              the first non-shortener domain
    s4  Forced registration   an overlay covering at least half the viewport with
                              registration or login fields, and either no close control
                              or under 200 characters of offer text still visible
    s5  Payment request       a payment word (fee, deposit, recharge, bayad, magbayad)
                              within 200 characters of an amount or account detail, in an
                              instruction to pay, send or deposit
    s6  Countdown timer       an element with a time pattern, read at about 2 s and 5 s,
                              whose time falls by about the time that passed (within 1 s)

    e1  Sensitive-data form   (shown, not scored)
    e2  Fake live earnings    (shown, not scored)
    e3  Interaction block     (shown, not scored)

Values: 1 = sign found, 0 = checked and not found, None = could not be checked (n.a.).
n.a. is never turned into 0.

Use from Python:   analyze_behavior(url)  -> dict
Use from a shell:  python backend/behavioral.py https://example.com   (prints JSON)
"""
import ipaddress
import json
import re
import socket
import sys
import time
from urllib.parse import urlparse

WATCH_SECONDS = 10      # total watch time after the page has loaded
NAV_TIMEOUT_MS = 15000  # page load limit (paper: redirects, up to 15 s)

# ---------------------------------------------------------------- s3: redirects
SHORTENERS = {
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly",
    "cutt.ly", "shorturl.at", "s.id", "rb.gy", "tiny.cc", "t.ly", "bitly.com", "lnkd.in",
    "shorte.st", "adf.ly", "v.gd", "tr.ee",
}
_SECOND_LEVEL = {"co", "com", "org", "net", "gov", "edu", "ac"}


def reg_domain(host):
    """Rough registrable domain: example.co.uk -> example.co.uk, www.shop.com -> shop.com."""
    host = (host or "").lower().strip(".")
    if not host or re.fullmatch(r"[\d.]+|\[.*\]", host):
        return host
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    if len(parts[-1]) == 2 and parts[-2] in _SECOND_LEVEL:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def judge_redirect(chain):
    """chain = main-frame navigation URLs in order. Returns (s3, note, simple_chain)."""
    urls = [u for u in chain if u.startswith(("http://", "https://"))]
    # drop immediate repeats (a reload of the same address is not a hop)
    dedup = []
    for u in urls:
        if not dedup or dedup[-1] != u:
            dedup.append(u)
    if len(dedup) < 2:
        return 0, None, dedup
    doms = [reg_domain(urlparse(u).hostname) for u in dedup]
    start = next((i for i, d in enumerate(doms) if d not in SHORTENERS), len(doms) - 1)
    base, prev, cross = doms[start], doms[start], 0
    for d in doms[start + 1:]:
        if d != prev:
            cross += 1
            prev = d
    final = doms[-1]
    if cross >= 3:
        return 1, f"The link passes through {cross} different websites before the final page ({base} to {final}).", dedup
    if final != base:
        return 1, f"The link starts at {base} but lands on a different website, {final}.", dedup
    return 0, None, dedup


# ---------------------------------------------------------------- s5: payment
PAY_PHRASE = re.compile(r"\b(?:fees?|deposits?|recharge|magbayad|bayad)\b", re.I)
AMOUNT = re.compile(
    r"(?:₱|\bphp\b|\bP(?=\s?\d)|\$|\busd\b|\busdt\b)\s?\d[\d,.]*"
    r"|\d[\d,.]*\s?(?:pesos?|php|usdt)\b"
    r"|\b09\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|\+?63\s?9\d{9}"
    r"|\baccount\s*(?:no|number|#)\b|\bacct\b|\bwallet address\b|\bgcash\b|\bmaya\b|\bpaymaya\b"
    r"|\bbank transfer\b|\b\d{10,16}\b", re.I)
PAY_VERB = re.compile(
    r"\b(?:pay|send|deposit|transfer|remit|top[- ]?up|recharge|settle|"
    r"magbayad|bayad|mag-?deposit|ipadala|padala|ipasa)\b", re.I)
NEGATION = re.compile(r"\b(?:no|walang|wala|without|zero|free|hindi|not)\b\W+(?:\w+\W+){0,2}$", re.I)
NOT_AN_INSTRUCTION = re.compile(r"\b(?:minimum|min\.?|maximum|max\.?) (?:deposit|investment)\b", re.I)


def judge_payment(text):
    """Returns (s5, note)."""
    text = re.sub(r"\s+", " ", text or "")
    text = NOT_AN_INSTRUCTION.sub(" ", text)
    for m in PAY_PHRASE.finditer(text):
        before = text[max(0, m.start() - 40):m.start()]
        if NEGATION.search(before):
            continue
        window = text[max(0, m.start() - 200):m.end() + 200]
        if AMOUNT.search(window) and PAY_VERB.search(window):
            snippet = text[max(0, m.start() - 60):m.end() + 60].strip()
            return 1, f"The page asks for money: \"…{snippet}…\""
    return 0, None


# ---------------------------------------------------------------- s6: countdown
OFFER_WORDS = re.compile(
    r"offer|sale|discount|promo|slot|limited|bonus|reward|claim|prize|hurry|price|₱|\$|"
    r"libre|natitirang|last chance|apply|hiring|deposit|invest|earn|\bwin\b|\bfree\b", re.I)


def judge_countdown(snap_a, snap_b, dt):
    """snap_* = lists of {key, secs, offer, media}. Returns (s6, note)."""
    b = {x["key"]: x for x in snap_b}
    for x in snap_a:
        y = b.get(x["key"])
        if not y or x["media"] or not OFFER_WORDS.search(x.get("ctx", "") + " " + y.get("ctx", "")):
            continue
        fall = x["secs"] - y["secs"]
        if dt >= 2 and fall >= 1 and abs(fall - dt) <= 1.0:
            return 1, f"A clock on the page counts down ({x['text']} to {y['text']} in {dt:.0f} seconds)."
    return 0, None


# ---------------------------------------------------------------- e1, e2, e3
SENSITIVE_FIELD = re.compile(
    r"card|cvv|cvc|credit|debit|expir|\botp\b|one[- ]?time|\bpin\b|mpin|account[- ]?(?:no|num)|"
    r"acct|gcash|maya|bank|\bsss\b|umid|philsys|national[- ]?id|\btin\b|passport|\bssn\b|"
    r"gov(?:ernment)?[- ]?id|wallet|seed|mnemonic", re.I)
EARN_NOTICE = re.compile(
    r"withdr|nag-?withdraw|cash ?out|earned|received|credited|nakatanggap|nakakuha|nakapag", re.I)


def judge_forms(forms, page_host):
    """forms = [{action, fields:[{type, desc}]}]. Returns (e1, note)."""
    for f in forms:
        fields = f["fields"]
        sens = [x for x in fields if SENSITIVE_FIELD.search(x["desc"])]
        if sens:
            return 1, "A form asks for sensitive details (card, bank, e-wallet, ID, PIN or one-time password)."
        has_pw = any(x["type"] == "password" for x in fields)
        if has_pw and len(fields) >= 2:
            act = f["action"]
            p = urlparse(act) if act else None
            if p and p.scheme in ("http", "https"):
                if reg_domain(p.hostname) != reg_domain(page_host):
                    return 1, "A login form sends what you type to a different website."
                if p.scheme == "http":
                    return 1, "A login form sends what you type without encryption (http)."
    return 0, None


def judge_notices(notices):
    seen = []
    for n in notices:
        n = re.sub(r"\s+", " ", n).strip()
        if EARN_NOTICE.search(n) and AMOUNT.search(n) and n not in seen:
            seen.append(n)
    if len(seen) >= 2:
        return 1, f"Pop-up notices about other people's withdrawals or earnings appeared ({len(seen)} seen)."
    return 0, None


_CTX = re.compile(r"contextmenu", re.I)
_BLOCK = re.compile(r"preventDefault|return\s+false", re.I)


def judge_blocking(html, body_user_select):
    """Reads the page code only. Returns (e3, note)."""
    if body_user_select == "none":
        return 1, "The page switches off text selection."
    for m in _CTX.finditer(html):
        if _BLOCK.search(html[max(0, m.start() - 150):m.end() + 250]):
            return 1, "The page blocks the right-click menu."
    for m in re.finditer(r"selectstart|onselectstart|dragstart|copy\b", html, re.I):
        if _BLOCK.search(html[max(0, m.start() - 100):m.end() + 200]) and re.search(
                r"selectstart|dragstart", html[max(0, m.start() - 20):m.end() + 5], re.I):
            return 1, "The page blocks selecting or dragging text."
    if re.search(r"popstate", html, re.I) and re.search(r"pushState|history\.(?:go|forward|back)", html, re.I):
        return 1, "The page tries to trap the Back button."
    if re.search(r"onbeforeunload|addEventListener\(\s*['\"]beforeunload", html, re.I):
        return 1, "The page tries to stop you from leaving."
    return 0, None


# ---------------------------------------------------------------- page scripts
INIT_SCRIPT = """
(() => {
  window.__isk = { notices: [] };
  const seen = new Set();
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length < 200 && !seen.has(t)) { seen.add(t); window.__isk.notices.push(t); }
    }
  }).observe(document, { childList: true, subtree: true });
})();
"""

JS_TIMERS = r"""
() => {
  const colon = /(?:^|[^\d])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/;
  const unit = /^(?:(\d{1,2})(?:d|days?)?)?(?:(\d{1,2})(?:h|hr|hrs|hours?|oras))?(\d{1,2})(?:m|min|mins|minutes?)(\d{1,2})(?:s|sec|secs|seconds?)$/i;
  const secsOf = (txt) => {
    const t = txt.trim();
    let m = t.match(colon);
    if (m) return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    const flat = t.replace(/\s+/g, '');
    m = flat.match(/^(?:(\d{1,2})(?:h|hr|hrs|hours?|oras))?(\d{1,2})(?:m|min|mins|minutes?)(\d{1,2})(?:s|sec|secs|seconds?)$/i);
    if (m) return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
    return null;
  };
  const cands = [];
  const all = Array.from(document.body ? document.body.querySelectorAll('*') : []);
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const t = (el.textContent || '');
    if (t.length > 60 || t.length < 4) continue;
    const s = secsOf(t);
    if (s === null) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    cands.push({ el, s, t: t.replace(/\s+/g, ' ').trim() });
  }
  const leaf = cands.filter((c) => !cands.some((o) => o !== c && c.el.contains(o.el)));
  return leaf.map((c, i) => {
    let anc = c.el, ctx = c.t;
    for (let k = 0; k < 6 && anc.parentElement; k++) {
      anc = anc.parentElement;
      const tx = anc.innerText || '';
      if (tx.length > 600) break;
      ctx = tx;
    }
    const path = [];
    for (let n = c.el; n && n !== document.body; n = n.parentElement) {
      path.push(n.tagName + ':' + Array.prototype.indexOf.call(n.parentElement ? n.parentElement.children : [], n));
    }
    return {
      key: path.join('/'), secs: c.s, text: c.t,
      ctx: ctx.replace(/\s+/g, ' ').slice(0, 600),
      media: !!c.el.closest('video,audio,[class*="player" i],[id*="player" i],[aria-label*="player" i]'),
    };
  });
}
"""

JS_OVERLAY = r"""
() => {
  const vw = innerWidth, vh = innerHeight, va = vw * vh;
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const shown = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const closeRe = /^\s*(?:×|✕|✖|x|close|dismiss|skip|no thanks|maybe later|not now|later|isara|cancel)\s*$/i;
  const res = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const cs = getComputedStyle(el);
    const fixed = cs.position === 'fixed';
    const abs = (cs.position === 'absolute' || cs.position === 'sticky') && parseInt(cs.zIndex, 10) > 0;
    if (!fixed && !abs) continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const cover = (w * h) / va;
    if (cover < 0.5) continue;
    const inputs = Array.from(el.querySelectorAll('input,textarea,select')).filter(
      (i) => !['hidden', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset'].includes((i.type || '').toLowerCase()) && shown(i));
    if (!inputs.length) continue;
    const hasClose = !!el.querySelector('[aria-label*="close" i],[class*="close" i],[id*="close" i],[data-dismiss],[data-bs-dismiss],[title*="close" i]')
      || Array.from(el.querySelectorAll('button,a,span,div,i,[role="button"]')).some((b) => b.children.length === 0 && closeRe.test(b.textContent || ''));
    // offer text that is still visible outside the overlay
    let visible = 0;
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = tw.nextNode())) {
      const t = (node.textContent || '').trim();
      if (!t) continue;
      const p = node.parentElement;
      if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName) || el.contains(p) || !shown(p)) continue;
      const rg = document.createRange(); rg.selectNodeContents(node);
      const b = rg.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || b.bottom < 0 || b.top > vh || b.right < 0 || b.left > vw) continue;
      const hit = document.elementFromPoint(Math.min(Math.max(b.left + b.width / 2, 0), vw - 1), Math.min(Math.max(b.top + b.height / 2, 0), vh - 1));
      let covered = false;
      if (hit && el.contains(hit)) covered = !(hit === el && alpha(getComputedStyle(el).backgroundColor) < 0.95);
      if (!covered) visible += t.length;
    }
    res.push({ cover, fields: inputs.length, hasClose, visibleOfferChars: visible });
  }
  return res;
}
"""

JS_TEXT = r"""
() => {
  const skip = 'footer,[class*="terms" i],[id*="terms" i],[class*="legal" i],[id*="legal" i],[class*="disclaimer" i],[id*="disclaimer" i],[class*="privacy" i],[id*="privacy" i]';
  const out = [];
  const tw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const p = n.parentElement;
    if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(p.tagName)) continue;
    if (p.closest(skip)) continue;
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  for (const b of document.querySelectorAll('button,a,input[type=submit],input[type=button],[role=button]')) {
    if (b.closest(skip)) continue;
    const t = ((b.innerText || b.value || b.getAttribute('aria-label') || '') + '').replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out.join(' \n ');
}
"""

JS_FORMS = r"""
() => {
  const shown = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const labelOf = (i) => {
    let t = '';
    if (i.id) { const l = document.querySelector('label[for="' + CSS.escape(i.id) + '"]'); if (l) t += ' ' + l.textContent; }
    const pl = i.closest('label'); if (pl) t += ' ' + pl.textContent;
    return t;
  };
  const groups = [];
  const handled = new Set();
  const describe = (inputs) => inputs.filter((i) => !['hidden', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset'].includes((i.type || '').toLowerCase()) && shown(i))
    .map((i) => ({ type: (i.type || 'text').toLowerCase(), desc: [i.name, i.id, i.placeholder, i.getAttribute('aria-label'), i.autocomplete, labelOf(i)].join(' ') }));
  for (const f of document.forms) {
    const inputs = Array.from(f.querySelectorAll('input,textarea,select'));
    inputs.forEach((i) => handled.add(i));
    groups.push({ action: f.action || '', fields: describe(inputs) });
  }
  const loose = Array.from(document.querySelectorAll('input,textarea,select')).filter((i) => !handled.has(i));
  if (loose.length) groups.push({ action: '', fields: describe(loose) });
  return groups.filter((g) => g.fields.length);
}
"""


# ---------------------------------------------------------------- guards
_dns_cache = {}


def _public_host(host):
    """True when every address of the host is a public address (SSRF guard)."""
    if host in _dns_cache:
        return _dns_cache[host]
    ok = False
    try:
        infos = socket.getaddrinfo(host, None)
        ok = bool(infos)
        for info in infos:
            a = ipaddress.ip_address(info[4][0].split("%")[0])
            if (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved
                    or a.is_multicast or a.is_unspecified):
                ok = False
                break
    except Exception:
        ok = False
    _dns_cache[host] = ok
    return ok


def _empty(note):
    return {
        "available": False, "notes": [note],
        "s3": None, "s4": None, "s5": None, "s6": None,
        "e1": None, "e2": None, "e3": None,
        "s3Note": None, "s4Note": None, "s5Note": None, "s6Note": None,
        "redirectChain": [], "finalUrl": None,
    }


# ---------------------------------------------------------------- main entry
def analyze_behavior(url, allow_private=False, browser_args=None, watch_seconds=WATCH_SECONDS):
    """Watch one page. Never raises: returns n.a. values when it cannot."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return _empty("Behavioral check not available: Playwright is not installed.")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return _empty("Behavioral check not available: only http and https links can be watched.")
    if not allow_private and not _public_host(parsed.hostname):
        return _empty("Behavioral check not available: the address is private or cannot be resolved.")

    out = _empty("")
    out["notes"] = []
    chain = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=browser_args or [])
            try:
                ctx = browser.new_context(accept_downloads=False, java_script_enabled=True,
                                          viewport={"width": 1280, "height": 800})
                ctx.add_init_script(INIT_SCRIPT)
                page = ctx.new_page()

                def guard(route):
                    req = route.request
                    u = req.url
                    if u.startswith(("data:", "blob:", "about:")):
                        return route.continue_()
                    p = urlparse(u)
                    if p.scheme not in ("http", "https"):
                        return route.abort()
                    if req.resource_type in ("image", "media", "font"):
                        return route.abort()
                    if not allow_private and not _public_host(p.hostname or ""):
                        return route.abort()
                    return route.continue_()

                page.route("**/*", guard)
                page.on("request", lambda r: chain.append(r.url)
                        if r.is_navigation_request() and r.frame == page.main_frame else None)

                resp = page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                if resp is None or resp.status >= 400:
                    code = resp.status if resp else "no response"
                    return _empty(f"Behavioral check not available: the page did not open ({code}).")
                try:
                    page.wait_for_load_state("load", timeout=4000)
                except Exception:
                    pass
                t_load = time.time()

                def wait_until(seconds):
                    left = t_load + seconds - time.time()
                    if left > 0:
                        page.wait_for_timeout(int(left * 1000))

                def safe(fn, default=None):
                    try:
                        return fn()
                    except Exception:
                        return default

                # 1) about 2 s: first timer reading and first overlay check
                wait_until(2)
                snap_a = safe(lambda: page.evaluate(JS_TIMERS))
                t_a = time.time()
                overlay1 = safe(lambda: page.evaluate(JS_OVERLAY))

                # 2) about 5 s: second timer reading
                wait_until(5)
                snap_b = safe(lambda: page.evaluate(JS_TIMERS))
                t_b = time.time()

                # 3) one scroll from top to bottom, then check the overlay again
                safe(lambda: page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)"))
                page.wait_for_timeout(800)
                overlay2 = safe(lambda: page.evaluate(JS_OVERLAY))

                # 4) keep watching (pop-up notices, late redirects)
                wait_until(watch_seconds)
                text = safe(lambda: page.evaluate(JS_TEXT))
                forms = safe(lambda: page.evaluate(JS_FORMS))
                notices = safe(lambda: page.evaluate("window.__isk ? window.__isk.notices : []"))
                html = safe(lambda: page.content())
                user_select = safe(lambda: page.evaluate(
                    "getComputedStyle(document.body || document.documentElement).userSelect"))
                out["finalUrl"] = page.url
            finally:
                browser.close()
    except Exception as exc:  # timeout, DNS error, TLS error, crash
        msg = str(exc).splitlines()[0][:140] if str(exc) else exc.__class__.__name__
        return _empty(f"Behavioral check not available: {msg}")

    # ---- judge each sign on its own; a failed read stays n.a. (None) ----
    out["available"] = True
    out["s3"], out["s3Note"], out["redirectChain"] = judge_redirect(chain)

    overlays = (overlay1 or []) + (overlay2 or [])
    if overlay1 is None and overlay2 is None:
        out["s4"] = None
    else:
        bad = [o for o in overlays if not o["hasClose"] or o["visibleOfferChars"] < 200]
        out["s4"] = 1 if bad else 0
        if bad:
            o = bad[0]
            why = ("it has no close button" if not o["hasClose"]
                   else f"only {o['visibleOfferChars']} characters of the offer stay visible")
            out["s4Note"] = f"A sign-up or login box covers the page and {why}."

    if text is None:
        out["s5"] = None
    else:
        out["s5"], out["s5Note"] = judge_payment(text)

    if snap_a is None or snap_b is None:
        out["s6"] = None
    else:
        out["s6"], out["s6Note"] = judge_countdown(snap_a, snap_b, t_b - t_a)

    host = urlparse(out["finalUrl"] or url).hostname or ""
    e1, n1 = judge_forms(forms, host) if forms is not None else (None, None)
    e2, n2 = judge_notices(notices) if notices is not None else (None, None)
    e3, n3 = judge_blocking(html, user_select) if html is not None else (None, None)
    out.update({"e1": e1, "e2": e2, "e3": e3})
    out["observed"] = {"e1": n1, "e2": n2, "e3": n3}
    out["notes"] = [n for n in (out["s3Note"], out["s4Note"], out["s5Note"], out["s6Note"]) if n]
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Usage: python behavioral.py <url>")
    # the scan server calls this as a separate process and reads one line of JSON
    print(json.dumps(analyze_behavior(sys.argv[1])))
