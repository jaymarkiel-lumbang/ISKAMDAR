"""
ISKAMDAR page collector (prototype).
Reads urls.csv (columns: url,label), loads each page in a headless browser,
and saves the rendered HTML plus a row in out/index.csv.

The script only LOADS and READS the page. It never clicks, types, logs in,
or pays, and downloads are blocked (same rule as the paper, Section 3.6).

Usage:
    python collect.py urls.csv
"""
import csv, hashlib, re, sys, time
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright
from py3langid.langid import classify, set_languages

# Only choose between English and Tagalog. Short pages otherwise get odd
# guesses (for example Tajik). Other Philippine languages will land in one
# of these two, so check them by eye.
set_languages(["en", "tl"])

OUT = Path("out")
HTML_DIR = OUT / "html"
HTML_DIR.mkdir(parents=True, exist_ok=True)

# Very common Filipino and English function words, used only for a rough
# "Taglish" hint. This is a heuristic, not a proven detector.
TL_WORDS = {"ang", "ng", "sa", "mga", "na", "ay", "para", "ako", "lang",
            "po", "ito", "kung", "kay", "araw", "kumita", "bayad",
            "magtrabaho", "mag", "ngayon", "libre"}
EN_WORDS = {"the", "and", "of", "to", "in", "for", "with", "is", "your",
            "you", "our", "we", "on", "this", "are", "from", "have"}


def language_info(text: str):
    """Top language plus a rough Taglish hint."""
    sample = text[:5000]
    if len(sample.strip()) < 40:
        return "unknown", 0, 0, False
    lang, _ = classify(sample)
    words = re.findall(r"[a-zA-Z']+", sample.lower())
    tl = sum(w in TL_WORDS for w in words)
    en = sum(w in EN_WORDS for w in words)
    # Taglish = both languages present AND Filipino words are a real share
    # (at least 15%), so an English page that only has a name like
    # "Bangko Sentral ng Pilipinas" is not flagged.
    taglish = tl >= 3 and en >= 3 and tl / (tl + en) >= 0.15
    return lang, tl, en, taglish


def collect(rows):
    index_path = OUT / "index.csv"
    new_file = not index_path.exists()
    with sync_playwright() as p, open(index_path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["id", "url", "label", "status", "lang", "tl_words",
                        "en_words", "taglish_hint", "text_chars", "html_file",
                        "collected", "error"])
        browser = p.chromium.launch()
        for row in rows:
            url, label = row["url"].strip(), row["label"].strip()
            rid = hashlib.sha256(url.encode()).hexdigest()[:12]
            status, err = "ok", ""
            lang, tl, en, taglish, nchars, html_file = "", 0, 0, False, 0, ""
            # fresh context per page: no cookies, no saved logins, no downloads
            ctx = browser.new_context(accept_downloads=False,
                                      viewport={"width": 1280, "height": 800})
            page = ctx.new_page()
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
                if resp is not None and resp.status >= 400:
                    raise RuntimeError(f"HTTP {resp.status}")
                try:
                    page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass  # some pages never go idle; keep what we have
                html = page.content()          # rendered page, after scripts ran
                text = page.inner_text("body") # visible text only
                nchars = len(text)
                lang, tl, en, taglish = language_info(text)
                html_file = f"html/{rid}.html"
                # errors="replace": some real pages contain broken characters
                # (lone surrogates) that cannot be written as UTF-8
                (OUT / html_file).write_text(html, encoding="utf-8", errors="replace")
            except Exception as e:
                status, err = "failed", str(e).splitlines()[0][:150]
            finally:
                ctx.close()
            w.writerow([rid, url, label, status, lang, tl, en, taglish,
                        nchars, html_file, date.today().isoformat(), err])
            f.flush()
            print(f"{status:6} {label:6} {lang or '-':4} taglish={taglish} {url}")
        browser.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python collect.py urls.csv")
    # utf-8-sig also accepts files that Windows PowerShell saved with a BOM
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
        collect(list(csv.DictReader(f)))