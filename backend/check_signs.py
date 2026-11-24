"""
Batch runner: applies s1 and s2 (structural.py) to every page saved by
collect.py and writes out/signs.csv.

    python backend\\check_signs.py
"""
import csv, re
from pathlib import Path

from structural import PageReader, check_s1, check_s2

OUT = Path("out")


# ---------- run on every saved page ----------
def main():
    index = OUT / "index.csv"
    if not index.exists():
        raise SystemExit("out/index.csv not found. Run collect.py first.")
    rows_out = []
    with open(index, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["status"] != "ok" or not r["html_file"]:
                rows_out.append([r["id"], r["url"], r["label"], "n.a.", "n.a.",
                                 "page could not be checked"])
                continue
            html = (OUT / r["html_file"]).read_text(encoding="utf-8", errors="replace")
            page = PageReader()
            page.feed(html)
            text = re.sub(r"\s+", " ", " ".join(page.text))
            s1, n1, _ = check_s1(page, text)
            s2, n2, _ = check_s2(page, text, r["url"])
            rows_out.append([r["id"], r["url"], r["label"], s1, s2,
                             " ".join(n1 + n2)])
    with open(OUT / "signs.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "url", "label", "s1", "s2", "notes"])
        w.writerows(rows_out)
    print(f"{'label':6} {'s1':>4} {'s2':>4}  url")
    for r in rows_out:
        print(f"{r[2]:6} {str(r[3]):>4} {str(r[4]):>4}  {r[1]}")
        if r[5]:
            print(f"{'':17}{r[5]}")


if __name__ == "__main__":
    main()