"""
Makes MOCK test pages for the prototype (not real websites, not real scams).

Writes:
    mock_pages/*.html   10 mock "scam" pages and 5 mock "legit" pages
    urls_mock.csv       the mock pages as file:// links, with labels
    urls_real.csv       a starter list of real Philippine sites (label: legit)

Then run:
    python backend\\collect.py urls_mock.csv
    python backend\\collect.py urls_real.csv
    python backend\\check_signs.py

Some mock "scam" pages are deliberately polished, and some mock "legit" pages
are deliberately bare, so the demo shows where s1 and s2 are right and where
they are not.
"""
import csv
from pathlib import Path

OUT = Path("mock_pages")
OUT.mkdir(exist_ok=True)


def page(title, body, links=()):
    nav = "".join(f'<a href="{h}">{t}</a> ' for h, t in links)
    return (f"<!-- MOCK PAGE for testing. Not a real website. -->\n"
            f"<html><head><title>{title}</title></head><body>"
            f"{'<nav>' + nav + '</nav>' if nav else ''}{body}</body></html>")


PAGES = {}   # filename -> (label, html)

# ---------------- mock SCAM pages ----------------
PAGES["mock_scam_01_wfh_taglish_bare"] = ("scam", page(
    "Mag-work From Home Na!",
    "<h1>Kumita ng P5,000 araw-araw!</h1>"
    "<p>Lorem ipsum dolor sit amet. Walang experience na kailangan, para sa mga "
    "gustong kumita sa bahay. Mag-register na ngayon, limited slots lang!</p>"
    "<button>Register Now</button>"))

PAGES["mock_scam_02_invest_email_only"] = ("scam", page(
    "Mabilis na Pera Investment",
    "<h1>Mag-invest ng P5,000, kumita ng P50,000 sa loob ng 7 araw</h1>"
    "<p>Garantisado ang tubo. Ang mga unang investor ay kumita na ngayon. "
    "Mag-message sa amin ngayon para sa slot, limited lang ang pwesto.</p>"
    "<p>Email: invest@mabilispera-ph.example</p>",
    [("/home", "Home"), ("/join", "Join")]))

PAGES["mock_scam_03_job_fee_english"] = ("scam", page(
    "Home-Based Data Encoder Hiring",
    "<h1>Data Encoder Wanted - Earn P1,500 Per Day</h1>"
    "<p>No experience needed. Pay the registration fee of P500 to secure your "
    "slot and start working today. Slots are limited, apply now.</p>"
    "<p>Viber: 0917 123 4567</p>",
    [("/apply", "Apply")]))

PAGES["mock_scam_04_crypto_bare"] = ("scam", page(
    "Crypto Profit Platform",
    "<h1>Double Your Money in 24 Hours</h1>"
    "<p>Lorem ipsum dolor sit amet consectetur. Deposit now and watch your "
    "earnings grow, this is the best platform for your future.</p>"))

PAGES["mock_scam_05_polished_invest"] = ("scam", page(
    "Golden Harvest Capital Corp.",
    "<h1>Golden Harvest Capital Corp.</h1>"
    "<p>Our investors earn 30% every month with guaranteed returns. Join "
    "thousands of members and grow your savings with our trusted program.</p>"
    "<p>Visit us at 25 Ayala Avenue, Makati City. Call (02) 8123 4567 or "
    "email info@goldenharvest.example. SEC Registration No. 2024-123456.</p>"
    "<p>&copy; 2026 Golden Harvest Capital Corp.</p>",
    [("/about", "About"), ("/plans", "Plans"), ("/team", "Team"),
     ("/news", "News"), ("/privacy", "Privacy Policy")]))

PAGES["mock_scam_06_polished_job"] = ("scam", page(
    "Prime Talent Solutions Inc.",
    "<h1>Prime Talent Solutions Inc.</h1>"
    "<p>Hiring remote customer support agents. Earn P40,000 a month. "
    "Processing and training fee required before your first day.</p>"
    "<p>Office: 12 Ortigas Avenue, Pasig City. Email: hr@primetalent.example</p>",
    [("/jobs", "Jobs"), ("/about", "About"), ("/contact", "Contact"),
     ("/terms", "Terms and Conditions")]))

PAGES["mock_scam_07_taglish_task_bare"] = ("scam", page(
    "Like at Kumita",
    "<h1>Mag-like ng videos, kumita ng P300 bawat task!</h1>"
    "<p>Coming soon ang aming buong website. Sumali na ngayon para sa mga "
    "gustong kumita ng extra income, walang puhunan.</p>"))

PAGES["mock_scam_08_loan_mobile_only"] = ("scam", page(
    "Instant Cash Loan PH",
    "<h1>Instant Cash Loan - Walang Collateral</h1>"
    "<p>Mag-apply ngayon at makuha ang pera sa loob ng isang oras. Magbayad "
    "lang ng processing fee para ma-release ang loan mo.</p>"
    "<p>Mobile: 0918 765 4321</p>",
    [("/apply", "Apply"), ("/faq", "FAQ"), ("/rates", "Rates")]))

PAGES["mock_scam_09_trading_placeholder"] = ("scam", page(
    "Forex Master Group",
    "<h1>Forex Master Group</h1>"
    "<p>Your text here. Insert text about our trading signals and guaranteed "
    "profit. Join the best forex community for traders of all levels.</p>",
    [("/join", "Join")]))

PAGES["mock_scam_10_fb_style_job"] = ("scam", page(
    "Hiring Ngayon: Online Seller Assistant",
    "<h1>Online Seller Assistant, Work From Home</h1>"
    "<p>Kailangan namin ng mga assistant para sa aming online shop. Sahod "
    "hanggang P25,000 kada buwan. Mag-send ng message para sa interview.</p>",
    [("/apply", "Apply"), ("/hiring", "Hiring")]))

# ---------------- mock LEGIT pages ----------------
PAGES["mock_legit_01_bakery_taglish"] = ("legit", page(
    "Kapitbahay Bakery Co.",
    "<h1>Kapitbahay Bakery Co.</h1>"
    "<p>Ang aming tinapay ay sariwa araw-araw para sa mga pamilya sa Quezon "
    "City. Mag-order na ng pandesal, ensaymada, at cake para sa inyong "
    "selebrasyon.</p>"
    "<p>Matatagpuan kami sa 45 Kalayaan Avenue, Quezon City. Tumawag sa "
    "0917 555 1234 o mag-email sa hello@kapitbahay.example.</p>",
    [("/menu", "Menu"), ("/about", "About"), ("/orders", "Orders"),
     ("/terms", "Terms")]))

PAGES["mock_legit_02_sarisari_tiny"] = ("legit", page(
    "Maria's Sari-Sari Store",
    "<h1>Maria's Sari-Sari Store</h1>"
    "<p>Bukas kami araw-araw para sa inyong mga pangangailangan. Mag-text o "
    "mag-email para sa mga order.</p>"
    "<p>Email: maria@sarisari.example. Mobile: 0917 555 8899.</p>",
    [("/about", "About")]))

PAGES["mock_legit_03_accounting_en"] = ("legit", page(
    "Reyes and Santos Accounting Services, Inc.",
    "<h1>Reyes and Santos Accounting Services, Inc.</h1>"
    "<p>We provide bookkeeping, tax filing, and audit support for small and "
    "medium businesses across the Philippines.</p>"
    "<p>Office: 8 Paseo de Roxas Street, Makati City. Telephone: (02) 8765 4321. "
    "Email: info@reyessantos.example. SEC Registration No. CS201912345.</p>"
    "<p>&copy; 2026 Reyes and Santos Accounting Services, Inc.</p>",
    [("/about", "About"), ("/services", "Services"), ("/team", "Team"),
     ("/contact", "Contact"), ("/privacy", "Privacy Policy")]))

PAGES["mock_legit_04_clinic_taglish"] = ("legit", page(
    "Barangay Wellness Clinic",
    "<h1>Barangay Wellness Clinic</h1>"
    "<p>Ang aming klinika ay bukas Lunes hanggang Sabado para sa mga "
    "check-up at bakuna. Mag-book ng appointment para sa inyong pamilya.</p>"
    "<p>Address: 3 Rizal Street, Barangay San Roque, Marikina City. "
    "Telepono: 0922 333 4444.</p>",
    [("/services", "Services"), ("/schedule", "Schedule"),
     ("/privacy", "Privacy Notice")]))

PAGES["mock_legit_05_info_in_image"] = ("legit", page(
    "Tindahan ni Aling Nena",
    "<h1>Tindahan ni Aling Nena</h1>"
    "<p>Tingnan ang aming larawan para sa address at contact number.</p>"
    '<img src="contact-card.png" alt="">',
    [("/home", "Home")]))

# ---------------- write files ----------------
rows = []
for name, (label, html) in PAGES.items():
    path = OUT / f"{name}.html"
    path.write_text(html, encoding="utf-8")
    rows.append((path.resolve().as_uri(), label))

with open("urls_mock.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["url", "label"])
    w.writerows(rows)

# Real sites. Not checked by me: some may block automated browsers (HTTP 403)
# or be slow. Failed pages are recorded as n.a. and are not a problem.
REAL = [
    "https://www.up.edu.ph", "https://www.dlsu.edu.ph", "https://www.ust.edu.ph",
    "https://www.mapua.edu.ph", "https://www.dole.gov.ph", "https://www.dti.gov.ph",
    "https://www.philhealth.gov.ph", "https://www.bdo.com.ph",
    "https://www.bpi.com.ph", "https://www.metrobank.com.ph",
    "https://www.globe.com.ph", "https://www.jollibee.com.ph",
    "https://www.philippineairlines.com", "https://www.cebupacificair.com",
    "https://www.nationalbookstore.com",
]
with open("urls_real.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["url", "label"])
    w.writerows((u, "legit") for u in REAL)

print(f"Wrote {len(PAGES)} mock pages to {OUT}/, urls_mock.csv and urls_real.csv")