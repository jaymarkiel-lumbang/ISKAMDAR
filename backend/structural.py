"""
ISKAMDAR structural analysis (prototype): signs s1 and s2 from Table 3.6.1.

Pure rules, standard library only. Used by scan_server.py and check_signs.py.

    s1  Missing or unclear business information:
        FOUND when fewer than 2 of these 4 kinds of information are on the page
          (1) business name  (2) business address
          (3) contact details  (4) registration number
    s2  Suspicious page design:
        FOUND when at least 2 of these 3 conditions are true
          (1) fewer than 3 links to other pages of the same site
          (2) unfinished or placeholder text ("Lorem ipsum", template wording)
          (3) no link to a privacy policy or terms page

Values: 1 = sign found, 0 = not found. analyze_structure returns None (shown
as n.a.) when the page could not be checked, never 0.

Entry point: analyze_structure(html, page_url)
"""
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

# ---------- read the saved page ----------
class PageReader(HTMLParser):
    """Collects visible text, links, the title and the main header."""

    SKIP = {"script", "style", "noscript", "template", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text, self.links = [], []
        self.title, self.h1 = "", ""
        self._skip = 0
        self._in = None  # "title" or "h1"
        self._a_text, self._a_href = None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in = "title"
        elif tag == "h1":
            self._in = "h1"
        elif tag == "a" and a.get("href"):
            self._a_href, self._a_text = a["href"], []

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag in ("title", "h1"):
            self._in = None
        elif tag == "a" and self._a_href is not None:
            self.links.append((self._a_href, " ".join(self._a_text).strip()))
            self._a_href, self._a_text = None, None

    def handle_data(self, data):
        if self._in == "title":
            self.title += data
        if self._skip:
            return
        if self._in == "h1":
            self.h1 += data
        self.text.append(data)
        if self._a_text is not None:
            self._a_text.append(data)


# ---------- s1: four kinds of business information ----------
LEGAL = re.compile(r"\b(Inc|Corp|Corporation|Co|Ltd|LLC|Incorporated|Limited)\b\.?")
COPYRIGHT = re.compile(r"(©|\(c\)|copyright)\s*(\d{4}\s*)?[A-Za-z]", re.I)

STREET = re.compile(
    r"\b(street|st\.|avenue|ave\.?|road|rd\.|boulevard|blvd|highway|hwy|"
    r"building|bldg|tower|floor|flr|barangay|brgy|village|subdivision)\b", re.I)
CITY = re.compile(
    r"\b(Metro Manila|Manila|Makati|Quezon City|Taguig|Pasig|Mandaluyong|Pasay|"
    r"Paranaque|Parañaque|Muntinlupa|Caloocan|Marikina|Cebu|Davao|Baguio|"
    r"Iloilo|Cagayan de Oro|Angeles|Antipolo|[A-Z][a-z]+ City|Municipality)\b")

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
MOBILE = re.compile(r"(\+?63|\b0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}")
LANDLINE = re.compile(r"\(?\b0?[2-8]\d?\)?[\s-]?\d{3,4}[\s-]?\d{4}\b")
REGNO = re.compile(
    r"\b(SEC|DTI|CDA|registration\s+(no|number|#))\b[^\n]{0,40}?\d", re.I)


def check_s1(page, text):
    found, notes = {}, []
    found["business name"] = bool(
        LEGAL.search(text) or COPYRIGHT.search(text)
        or page.title.strip() or page.h1.strip())
    found["business address"] = bool(STREET.search(text) and CITY.search(text))
    found["contact details"] = bool(
        EMAIL.search(text) or MOBILE.search(text) or LANDLINE.search(text))
    found["registration number"] = bool(REGNO.search(text))
    n = sum(found.values())
    missing = [k for k, v in found.items() if not v]
    sign = 1 if n < 2 else 0
    if sign:
        notes.append(f"Only {n} of 4 kinds of business information found "
                     f"(missing: {', '.join(missing)}).")
    return sign, notes, found


# ---------- s2: three page-design conditions ----------
PLACEHOLDER = re.compile(
    r"lorem ipsum|dolor sit amet|your text here|insert (your )?text|"
    r"welcome to your new (web)?site|just another wordpress site|"
    r"coming soon|under construction|sample page|hello world!", re.I)
PRIVACY = re.compile(r"privacy|terms|data protection", re.I)


def same_site(url_a, url_b):
    host = lambda u: urlparse(u).netloc.lower().removeprefix("www.")
    return host(url_a) == host(url_b)


def check_s2(page, text, page_url):
    internal = set()
    for href, _ in page.links:
        href = href.strip()
        if href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full = urljoin(page_url, href)
        if same_site(full, page_url):
            base = full.split("#")[0].rstrip("/")
            if base != page_url.split("#")[0].rstrip("/"):
                internal.add(base)
    c1 = len(internal) < 3
    c2 = bool(PLACEHOLDER.search(text))
    c3 = not any(PRIVACY.search(h) or PRIVACY.search(t) for h, t in page.links)
    conds = {"fewer than 3 internal links": c1,
             "placeholder text": c2,
             "no privacy or terms link": c3}
    hit = [k for k, v in conds.items() if v]
    sign = 1 if len(hit) >= 2 else 0
    notes = [f"Page looks bare or unfinished: {', '.join(hit)}."] if sign else []
    return sign, notes, conds


# ---------- one call for the scan server ----------
def analyze_structure(html: str, page_url: str) -> dict:
    """Run s1 and s2 on one page. Never raises: returns n.a. if it cannot."""
    try:
        page = PageReader()
        page.feed(html)
        text = re.sub(r"\s+", " ", " ".join(page.text))
        if len(text) < 20:
            raise ValueError("page has almost no readable text")
        s1, n1, f1 = check_s1(page, text)
        s2, n2, c2 = check_s2(page, text, page_url)
    except Exception as exc:  # parser or rule failure
        return {"s1": None, "s2": None, "available": False,
                "s1Note": None, "s2Note": None,
                "notes": [f"Structural check not available: {exc}"],
                "businessInfo": None, "designConditions": None}
    return {
        "s1": s1, "s2": s2, "available": True, "notes": n1 + n2,
        "s1Note": n1[0] if n1 else None, "s2Note": n2[0] if n2 else None,
        "businessInfo": {"name": f1["business name"],
                         "address": f1["business address"],
                         "contact": f1["contact details"],
                         "registration": f1["registration number"]},
        "designConditions": {"fewInternalLinks": c2["fewer than 3 internal links"],
                             "placeholderText": c2["placeholder text"],
                             "noPrivacyOrTerms": c2["no privacy or terms link"]},
    }