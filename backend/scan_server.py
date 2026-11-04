"""
ISKAMDAR page-scan backend.
Fetches a URL, runs heuristic signal detection, returns JSON.

Run:  py backend/scan_server.py
      (or double-click start_scan_server.bat)
"""

import ipaddress
import re
import socket
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"])

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

def _detect_payment_request(html: str) -> bool:
    patterns = [
        r"(?i)(send\s+money|wire\s+transfer|bank\s+transfer|gcash|paymaya|bitcoin|crypto\s+payment)",
        r"(?i)(pay\s+now|payment\s+required|enter\s+card|credit\s+card\s+number)",
    ]
    return any(re.search(p, html) for p in patterns)


def _detect_no_business_info(html: str) -> bool:
    has_contact = bool(re.search(
        r"(?i)(contact\s+us|about\s+us|privacy\s+policy|terms\s+of\s+service|@[\w.]+\.[a-z]{2,})",
        html,
    ))
    return not has_contact


def _detect_hidden_redirect(html: str) -> bool:
    # meta refresh or JS location redirects hidden in obfuscated code
    patterns = [
        r"(?i)<meta[^>]+http-equiv=['\"]refresh['\"][^>]*>",
        r"(?i)window\.location\s*=\s*['\"]https?://(?!localhost)",
        r"(?i)document\.location\.href\s*=",
    ]
    return any(re.search(p, html) for p in patterns)


def _detect_countdown_timer(html: str) -> bool:
    patterns = [
        r"(?i)(countdown|time.?left|offer\s+expires|limited\s+time|act\s+now|only\s+\d+\s+(hours?|minutes?|seconds?)\s+left)",
        r"(?i)(setInterval|setTimeout)[^;]{0,80}(timer|count|second)",
    ]
    return any(re.search(p, html) for p in patterns)


def _detect_forced_signup(html: str) -> bool:
    patterns = [
        r"(?i)(sign\s*up\s+to\s+(continue|access|unlock|view)|create\s+account\s+to\s+(get|claim|receive))",
        r"(?i)(register\s+now\s+to|join\s+now\s+to\s+get)",
    ]
    return any(re.search(p, html) for p in patterns)


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

    if _detect_payment_request(html):
        signals.append("payment_request")
    if _detect_no_business_info(html):
        signals.append("no_business_info")
    if _detect_hidden_redirect(html):
        signals.append("hidden_redirect")
    if _detect_copied_layout(html):
        signals.append("copied_layout")
    if _detect_countdown_timer(html):
        signals.append("countdown_timer")
    if _detect_forced_signup(html):
        signals.append("forced_signup")

    domain_info = _detect_new_domain(hostname)
    if domain_info["detected"]:
        signals.append("new_domain")

    evidence = {
        "hostname": hostname,
        "finalUrl": meta["finalUrl"],
        "suspiciousTld": domain_info["tld"],
    }

    return jsonify({
        "signals": signals,
        "evidence": evidence,
        "flagCount": len(signals),
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "ts": datetime.now(timezone.utc).isoformat()})


if __name__ == "__main__":
    print("ISKAMDAR scan server running on http://localhost:5000")
    print("Press Ctrl+C to stop.\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
