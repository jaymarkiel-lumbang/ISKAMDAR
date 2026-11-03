import re

SEED = 42
CUTOFF_SCORE = 30  
CUTOFF_P = CUTOFF_SCORE / 100

URL_RE = re.compile(r"(https?://\S+|www\.\S+|\b[\w-]+\.(?:com|net|org|ph|xyz|top|vip|club|site|online|link|co)\b\S*)", re.I)
PHONE_RE = re.compile(r"(\+?63|0)9\d{9}\b|\b9\d{9}\b")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")

LEET = str.maketrans({"@": "a", "0": "o", "$": "s", "!": "i"})

def anonymize(text: str) -> str:
    """Replace personal identifiers with placeholders (Section 3.4, Cleaning)."""
    text = EMAIL_RE.sub(" <email> ", text)
    text = PHONE_RE.sub(" <phone> ", text)
    return text

def preprocess(text: str) -> str:
    """Lowercase, mask URLs/numbers, undo simple leetspeak, keep Taglish words as-is."""
    text = str(text)
    text = anonymize(text)
    text = URL_RE.sub(" <url> ", text)
    
    def fix(m):
        w = m.group(0)
        return w.translate(LEET) if re.search(r"[A-Za-z]", w) and re.search(r"[@0$]", w) and not re.search(r"\d[1-9]|[1-9]\d", w) else w
    text = re.sub(r"\S+", fix, text)
    text = text.lower()
    text = re.sub(r"\d[\d,\.]*", " <num> ", text)
    text = re.sub(r"[^\w<>\s']", " ", text)
    return re.sub(r"\s+", " ", text).strip()

def level(score: int) -> str:
    return "Safe" if score < 30 else ("Suspicious" if score < 70 else "Scam")