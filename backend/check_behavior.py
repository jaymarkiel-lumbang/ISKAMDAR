"""
Runs the behavioral check (s3 to s6, e1 to e3) on a list of pages and prints a table.

    python backend\\check_behavior.py --mock              # built-in test pages with known answers
    python backend\\check_behavior.py urls_behavior.csv   # your own list (columns: url,label)
    python backend\\check_behavior.py urls_behavior.csv --limit 5

--mock needs no internet. It serves small test pages from your own computer
(http://a.test:8765 and friends are mapped to 127.0.0.1 inside the test browser only)
and compares the result with the answer each page was built to give.

For a real list, writes out\\behavior.csv. Pages are only watched: nothing is
clicked, typed, submitted or paid, and downloads are off. Phishing pages can see
your IP address when they load, so do not run a list of live scam links on a
network you do not want to expose.
"""
import csv
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from behavioral import analyze_behavior  # noqa: E402

PORT = 8765
HOSTS = ["a.test", "b.test", "c.test", "d.test", "shop.test", "www.shop.test", "plain.test"]
RULES = ",".join(f"MAP {h} 127.0.0.1" for h in HOSTS)

LOREM = ("We are a small team that helps people find work. " * 12)

# ----------------------------------------------------------------- test pages
PAGES = {
    "plain": "<html><head><title>Plain</title></head><body><h1>Maria's Bakery</h1><p>Fresh bread every morning. " + LOREM + "</p></body></html>",

    "pay_yes": "<html><body><h1>Hiring now</h1><p>To secure your slot, pay the registration fee of P500 via GCash 0917 123 4567 today.</p></body></html>",
    "pay_negated": "<html><body><h1>Hiring now</h1><p>There is no registration fee. Walang bayad. Salary P15,000 per month.</p></body></html>",
    "pay_footer_terms": "<html><body><h1>Shop</h1><p>Fresh bread daily.</p><footer>Terms: a late fee of P50 applies. Pay within 7 days.</footer></body></html>",
    "pay_min_investment": "<html><body><h1>Fund</h1><p>Minimum investment: P5,000. Minimum deposit P5,000 for new accounts.</p></body></html>",
    "pay_tagalog": "<html><body><h1>Trabaho</h1><p>Magbayad ng P1,000 na processing fee para makapagsimula ka.</p></body></html>",

    "timer_down": """<html><body><h1>Limited offer, claim your reward before the slots run out</h1>
<div class="box"><span id="t">00:30:00</span></div>
<script>let s=1800;setInterval(()=>{s--;const m=String(Math.floor(s/60)).padStart(2,'0'),x=String(s%60).padStart(2,'0');document.getElementById('t').textContent='00:'+m+':'+x;},1000);</script></body></html>""",
    "timer_up": """<html><body><h1>Our story</h1><p>Open since 1999. Offer: none.</p>
<div><span id="t">00:00:10</span></div>
<script>let s=10;setInterval(()=>{s++;const m=String(Math.floor(s/60)).padStart(2,'0'),x=String(s%60).padStart(2,'0');document.getElementById('t').textContent='00:'+m+':'+x;},1000);</script></body></html>""",
    "timer_player": """<html><body><h1>Watch our promo video, limited offer</h1>
<div class="video-player"><span id="t">03:00</span></div>
<script>let s=180;setInterval(()=>{s--;document.getElementById('t').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},1000);</script></body></html>""",
    "timer_session": """<html><body><h1>Account settings</h1><p>Your session will end soon.</p>
<div><span id="t">05:00</span></div>
<script>let s=300;setInterval(()=>{s--;document.getElementById('t').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},1000);</script></body></html>""",
    "timer_units": """<html><body><h1>Hurry! Bonus slots left</h1>
<div><b id="h">00</b><i>Hours</i><b id="m">10</b><i>Minutes</i><b id="s">59</b><i>Seconds</i></div>
<script>let n=659;setInterval(()=>{n--;document.getElementById('m').textContent=String(Math.floor(n/60)).padStart(2,'0');document.getElementById('s').textContent=String(n%60).padStart(2,'0');},1000);</script></body></html>""",

    "overlay_noclose": """<html><body><h1>Earn P5,000 a day</h1><p>""" + LOREM + """</p>
<div style="position:fixed;inset:0;background:#fff;z-index:99;padding:60px"><h2>Register to continue</h2>
<input type="email" placeholder="Email"><input type="password" placeholder="Password"><button>Sign up</button></div></body></html>""",
    "overlay_close_offertext": """<html><body><h1>Our products</h1><p>""" + LOREM * 3 + """</p>
<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99">
<div style="position:absolute;left:30%;top:30%;width:40%;background:#fff;padding:20px">
<button aria-label="Close" style="float:right">x</button><h3>Newsletter</h3><input type="email" placeholder="Email"><button>Join</button></div></div></body></html>""",
    "cookie_banner": """<html><body><h1>Our products</h1><p>""" + LOREM + """</p>
<div style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#eee;z-index:99">We use cookies. <button>Accept</button></div></body></html>""",
    "overlay_small_form": """<html><body><h1>Home</h1><p>""" + LOREM + """</p>
<div style="position:fixed;top:10px;right:10px;width:200px;height:100px;background:#fff;z-index:99"><input type="email"></div></body></html>""",

    "form_otp": "<html><body><h1>Verify</h1><form action='/x'><input name='otp' placeholder='Enter OTP'><input name='pin' placeholder='PIN'></form></body></html>",
    "form_newsletter": "<html><body><h1>News</h1><form action='/x'><input type='email' name='email' placeholder='Email'></form></body></html>",
    "form_login_other": "<html><body><h1>Login</h1><form action='http://d.test:8765/steal'><input type='email' name='u'><input type='password' name='p'></form></body></html>",
    "form_password_only": "<html><body><h1>Unlock</h1><form action='/x'><input type='password' name='p'></form></body></html>",

    "notices_yes": """<html><body><h1>Earn daily</h1><div id="box"></div>
<script>const m=['Juan just withdrew P5,000','Ana earned P3,200 today','Ben just withdrew P7,500'];let i=0;setInterval(()=>{if(i<3){const d=document.createElement('div');d.textContent=m[i++];document.getElementById('box').appendChild(d);}},1200);</script></body></html>""",
    "notices_no": "<html><body><h1>Store</h1><p>Welcome</p></body></html>",

    "block_yes": "<html><body oncontextmenu='return false' style='user-select:none'><h1>Do not copy</h1><script>document.addEventListener('contextmenu',e=>e.preventDefault());</script></body></html>",

    "all_scam": """<html><body><h1>Earn P5,000 daily, limited offer</h1><p>Deposit P1,000 now and send it to GCash 0917 123 4567 to claim your reward.</p>
<span id="t">00:20:00</span><div id="box"></div>
<div style="position:fixed;inset:0;background:#fff;z-index:99;padding:60px"><h2>Register to see the offer</h2><input type="email"><input type="password"><input name="gcash" placeholder="GCash number"></div>
<script>let s=1200;setInterval(()=>{s--;document.getElementById('t').textContent='00:'+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},1000);
const m=['Juan just withdrew P5,000','Ana earned P3,200'];let i=0;setInterval(()=>{if(i<2){const d=document.createElement('div');d.textContent=m[i++];document.getElementById('box').appendChild(d);}},1000);
document.addEventListener('contextmenu',e=>e.preventDefault());</script></body></html>""",
}

# What each page was built to give: (s3, s4, s5, s6, e1, e2, e3). None = n.a.
EXPECT = {
    "plain": (0, 0, 0, 0, 0, 0, 0),
    "pay_yes": (0, 0, 1, 0, 0, 0, 0),
    "pay_negated": (0, 0, 0, 0, 0, 0, 0),
    "pay_footer_terms": (0, 0, 0, 0, 0, 0, 0),
    "pay_min_investment": (0, 0, 0, 0, 0, 0, 0),
    "pay_tagalog": (0, 0, 1, 0, 0, 0, 0),
    "timer_down": (0, 0, 0, 1, 0, 0, 0),
    "timer_up": (0, 0, 0, 0, 0, 0, 0),
    "timer_player": (0, 0, 0, 0, 0, 0, 0),
    "timer_session": (0, 0, 0, 0, 0, 0, 0),
    "timer_units": (0, 0, 0, 1, 0, 0, 0),
    "overlay_noclose": (0, 1, 0, 0, 0, 0, 0),
    "overlay_close_offertext": (0, 0, 0, 0, 0, 0, 0),
    "cookie_banner": (0, 0, 0, 0, 0, 0, 0),
    "overlay_small_form": (0, 0, 0, 0, 0, 0, 0),
    "form_otp": (0, 0, 0, 0, 1, 0, 0),
    "form_newsletter": (0, 0, 0, 0, 0, 0, 0),
    "form_login_other": (0, 0, 0, 0, 1, 0, 0),
    "form_password_only": (0, 0, 0, 0, 0, 0, 0),
    "notices_yes": (0, 0, 0, 0, 0, 1, 0),
    "notices_no": (0, 0, 0, 0, 0, 0, 0),
    "block_yes": (0, 0, 0, 0, 0, 0, 1),
    "all_scam": (0, 1, 1, 1, 1, 1, 1),
}

# redirect cases: name -> (start URL, expected s3)
REDIRECTS = {
    "redir_3hops": (f"http://a.test:{PORT}/r/a1", 1),            # a -> b -> c -> d (3 cross-domain hops)
    "redir_1cross": (f"http://a.test:{PORT}/r/x1", 1),           # a -> b (final differs)
    "redir_www": (f"http://shop.test:{PORT}/r/w1", 0),           # bare -> www (same domain)
    "redir_none": (f"http://plain.test:{PORT}/p/plain", 0),
}
BLOCKED = f"http://plain.test:{PORT}/blocked"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body="", headers=None):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        data = body.encode("utf-8")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path
        if p.startswith("/p/"):
            return self._send(200, PAGES.get(p[3:], "<h1>missing</h1>"))
        nxt = {
            "/r/a1": f"http://b.test:{PORT}/r/a2", "/r/a2": f"http://c.test:{PORT}/r/a3",
            "/r/a3": f"http://d.test:{PORT}/p/plain",
            "/r/x1": f"http://b.test:{PORT}/p/plain",
            "/r/w1": f"http://www.shop.test:{PORT}/p/plain",
        }
        if p in nxt:
            return self._send(302, "", {"Location": nxt[p]})
        if p == "/blocked":
            return self._send(403, "Forbidden")
        if p == "/steal":
            return self._send(200, "ok")
        self._send(404, "not found")


def flat(r):
    return tuple(r[k] for k in ("s3", "s4", "s5", "s6", "e1", "e2", "e3"))


def show(v):
    return "n.a." if v is None else str(v)


def run_mock():
    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    args = [f"--host-resolver-rules={RULES}"]
    print(f"{'page':26} {'s3 s4 s5 s6 | e1 e2 e3':26} expected   result")
    print("-" * 78)
    ok = bad = 0
    for name, exp in EXPECT.items():
        r = analyze_behavior(f"http://plain.test:{PORT}/p/{name}", allow_private=True,
                             browser_args=args, watch_seconds=7)
        got = flat(r)
        good = r["available"] and got == exp
        ok, bad = ok + good, bad + (not good)
        line = " ".join(show(v) for v in got[:4]) + " | " + " ".join(show(v) for v in got[4:])
        print(f"{name:26} {line:26} {'OK' if good else 'DIFFERENT'}"
              + ("" if good else f"   wanted {exp}  {r['notes']}"))
    for name, (start, exp) in REDIRECTS.items():
        r = analyze_behavior(start, allow_private=True, browser_args=args, watch_seconds=3)
        good = r["available"] and r["s3"] == exp
        ok, bad = ok + good, bad + (not good)
        print(f"{name:26} s3={show(r['s3']):<22} {'OK' if good else 'DIFFERENT'}  {r['s3Note'] or ''}")
    r = analyze_behavior(BLOCKED, allow_private=True, browser_args=args, watch_seconds=3)
    good = (not r["available"]) and all(v is None for v in flat(r))
    ok, bad = ok + good, bad + (not good)
    print(f"{'blocked_403':26} {'all n.a.':26} {'OK' if good else 'DIFFERENT'}  {r['notes']}")
    print("-" * 78)
    print(f"{ok} matched, {bad} different")
    srv.shutdown()


def run_list(path, limit):
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    if limit:
        rows = rows[:limit]
    Path("out").mkdir(exist_ok=True)
    cols = ["url", "label", "available", "s3", "s4", "s5", "s6", "e1", "e2", "e3", "finalUrl", "notes"]
    print(f"{'url':52} {'s3 s4 s5 s6 | e1 e2 e3'}")
    with open("out/behavior.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for row in rows:
            url, label = row["url"].strip(), row.get("label", "")
            r = analyze_behavior(url)
            got = flat(r)
            line = " ".join(show(v) for v in got[:4]) + " | " + " ".join(show(v) for v in got[4:])
            print(f"{url[:52]:52} {line}   {' '.join(r['notes'])[:80]}")
            w.writerow([url, label, r["available"], *got, r["finalUrl"], " | ".join(r["notes"])])
    print("\nSaved out\\behavior.csv")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if a[0] == "--mock":
        run_mock()
    else:
        lim = int(a[a.index("--limit") + 1]) if "--limit" in a else 0
        run_list(a[0], lim)
