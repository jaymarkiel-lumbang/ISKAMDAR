"""
ISKAMDAR page-scan backend.
Fetches a URL, runs heuristic signal detection, returns JSON.

Run:  py backend/scan_server.py
      (or double-click start_scan_server.bat)
"""

import ipaddress
import json
import re
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

from structural import analyze_structure  # s1 and s2 from the paper (Table 3.6.1)

app = Flask(__name__)
# Ports for the usual ways of serving the front end (3000 = http.server / serve,
# 5500 = VS Code "Go Live"). Add yours here if it is different.
_FRONTEND_PORTS = (3000, 5500, 5501, 8000, 8080)
CORS(app, origins=[f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in _FRONTEND_PORTS])

_TIMEOUT = 8          # seconds
_MAX_BYTES = 500_000  # 500 KB

# ---------------------------------------------------------------------------
# SSRF guard
# ---------------------------------------------------------------------------

def _resolve_safe(hostname: str) -> str:
    """Raise ValueError if hostname resolves to a private / loopback address."""
    try:
        ip = socket.gethostbyname(hostname)
    except socket.gaierror as exc:
        raise ValueError(f"Cannot resolve hostname: {exc}") from exc
    addr = ipaddress.ip_address(ip)
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        raise ValueError(f"Blocked address: {ip}")
    return ip


# ---------------------------------------------------------------------------
# Fetcher
# ---------------------------------------------------------------------------

def _fetch(url: str) -> tuple[str, dict]:
    """Return (html_body, response_meta).  Raises on failure."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http/https URLs are supported.")
    _resolve_safe(parsed.hostname or "")

    resp = requests.get(
        url,
        timeout=_TIMEOUT,
        headers={"User-Agent": "ISKAMDAR-Scanner/1.0"},
        stream=True,
        allow_redirects=True,
    )
    resp.raise_for_status()

    chunks = []
    total = 0
    for chunk in resp.iter_content(chunk_size=4096):
        total += len(chunk)
        if total > _MAX_BYTES:
            break
        chunks.append(chunk)
    html = b"".join(chunks).decode("utf-8", errors="replace")

    meta = {
        "finalUrl": resp.url,
        "statusCode": resp.status_code,
        "contentType": resp.headers.get("content-type", ""),
    }
    return html, meta


# ---------------------------------------------------------------------------
# Signal detectors
# ---------------------------------------------------------------------------

def _detect_no_business_info(html: str) -> bool:
    has_contact = bool(re.search(
        r"(?i)(contact\s+us|about\s+us|privacy\s+policy|terms\s+of\s+service|@[\w.]+\.[a-z]{2,})",
        html,
    ))
    return not has_contact


def _detect_copied_layout(html: str) -> bool:
    # Looks for mismatched brand references (page title vs internal links domain)
    title_match = re.search(r"(?i)<title[^>]*>([^<]{3,80})</title>", html)
    if not title_match:
        return False
    title = title_match.group(1).lower()
    known_brands = ["facebook", "google", "paypal", "amazon", "apple", "microsoft",
                    "netflix", "shopee", "lazada", "gcash", "bpi", "bdo", "metrobank"]
    for brand in known_brands:
        if brand in title:
            # Check if the actual links in the page point elsewhere
            links = re.findall(r'href=["\']https?://([^/"\']+)', html)
            if links and not any(brand in lnk.lower() for lnk in links[:30]):
                return True
    return False


def _detect_new_domain(hostname: str) -> dict:
    """Attempt WHOIS-free heuristic: very numeric/long subdomains suggest freshly registered."""
    parts = hostname.split(".")
    suspicious = False
    # TLDs common in phishing farms
    phishing_tlds = {".xyz", ".top", ".club", ".info", ".online", ".site", ".tk", ".ml", ".ga", ".cf"}
    tld = "." + parts[-1] if parts else ""
    if tld in phishing_tlds:
        suspicious = True
    # Random-looking second-level domain (lots of digits or very long)
    sld = parts[-2] if len(parts) >= 2 else ""
    digit_ratio = sum(c.isdigit() for c in sld) / max(len(sld), 1)
    if digit_ratio > 0.4 or len(sld) > 20:
        suspicious = True
    return {"detected": suspicious, "tld": tld, "sld": sld}


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Behavioral analysis runs in its own process (behavioral.py). That keeps the
# browser away from the web server's threads, and a crash or a stuck page can
# be stopped without taking the server down.
# ---------------------------------------------------------------------------

_BEHAVIOR_SCRIPT = Path(__file__).resolve().parent / "behavioral.py"
_BEHAVIOR_LIMIT = 45                       # seconds, whole process
_behavior_slots = threading.Semaphore(2)   # at most 2 browsers at once


def _unavailable(note: str) -> dict:
    return {"available": False, "notes": [note],
            "s3": None, "s4": None, "s5": None, "s6": None,
            "e1": None, "e2": None, "e3": None,
            "s3Note": None, "s4Note": None, "s5Note": None, "s6Note": None,
            "redirectChain": [], "finalUrl": None, "observed": {}}


def _run_behavior(target: str) -> dict:
    """Watch the page. The address is the one the visitor was given, so the
    redirect check (s3) starts from it."""
    if not _behavior_slots.acquire(timeout=5):
        return _unavailable("Behavioral check not available: the scanner is busy.")
    try:
        done = subprocess.run(
            [sys.executable, str(_BEHAVIOR_SCRIPT), target],
            capture_output=True, text=True, timeout=_BEHAVIOR_LIMIT,
        )
        line = (done.stdout or "").strip().splitlines()[-1] if (done.stdout or "").strip() else ""
        return json.loads(line) if line else _unavailable("Behavioral check not available: no result.")
    except subprocess.TimeoutExpired:
        return _unavailable("Behavioral check not available: the page took too long.")
    except Exception as exc:
        return _unavailable(f"Behavioral check not available: {exc.__class__.__name__}")
    finally:
        _behavior_slots.release()


@app.route("/scan", methods=["POST"])
def scan():
    body = request.get_json(silent=True) or {}
    url = (body.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400

    # Normalise — add scheme if missing
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    try:
        html, meta = _fetch(url)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except requests.RequestException as exc:
        return jsonify({"error": f"Fetch failed: {exc}"}), 502

    signals = []

    if _detect_copied_layout(html):
        signals.append("copied_layout")

    domain_info = _detect_new_domain(hostname)
    if domain_info["detected"]:
        signals.append("new_domain")

    evidence = {
        "hostname": hostname,
        "finalUrl": meta["finalUrl"],
        "suspiciousTld": domain_info["tld"],
    }

    # Structural analysis (s1, s2). Kept separate from "signals" so the existing
    # front end keeps working; read it from the "structural" field.
    structural = analyze_structure(html, meta["finalUrl"])
    # s1 and s2 replace the old loose "no_business_info" check. If the page could
    # not be checked (None) no sign is raised: n.a. is never treated as 0.
    if structural["s1"] == 1:
        signals.append("no_business_info")
    if structural["s2"] == 1:
        signals.append("suspicious_design")

    # Behavioral analysis (s3 to s6, plus e1 to e3 which are shown but not scored).
    # The page is opened in a headless browser, so this takes about 12 seconds.
    # If it cannot run, the signs are n.a. and no sign is raised.
    behavioral = _run_behavior(url)
    for sign, sig_id in (("s3", "hidden_redirect"), ("s4", "forced_signup"),
                         ("s5", "payment_request"), ("s6", "countdown_timer")):
        if behavioral.get(sign) == 1:
            signals.append(sig_id)

    return jsonify({
        "signals": signals,
        "evidence": evidence,
        "flagCount": len(signals),
        "structural": structural,
        "behavioral": behavioral,
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "ts": datetime.now(timezone.utc).isoformat()})


if __name__ == "__main__":
    print("ISKAMDAR scan server running on http://localhost:5000")
    print("Press Ctrl+C to stop.\n")
    app.run(host="127.0.0.1", port=5000, debug=False)