"""Build data/labeled.csv for train_text.py from three sources.

  1. data/tagalog-sms.xlsx          real Philippine SMS (Kaggle "Tagalog SMS Dataset")
                                    notifs, otp, ads, gov -> legit (0) | spam -> scam (1)
  2. data/to_label.csv              our collected SMS, all scam (1)
  3. data/synthetic_job_invest.csv  job and investment examples we wrote (see make_synthetic.py)

The sender column is NOT used: scam texts come from random mobile numbers and legit texts from
names like GCash or BDO, so the sender would give the answer away.

Run:  python build_dataset.py
"""
import re

import pandas as pd

from common import preprocess

XLSX = "data/tagalog-sms.xlsx"
OURS = "data/to_label.csv"
SYNTH = "data/synthetic_job_invest.csv"
OUT = "data/labeled.csv"

LEGIT_CATS = {"notifs", "otp", "ads", "gov"}

TOPICS = [
    ("gambling", r"\b(slot|jackpot|casino|bet|spin|bingo|cockfight|sabong|tumaya|panalo|bonus|win big|lucky|pulang sobre|deposit)"),
    ("loan", r"\b(loan|utang|pautang|credit limit|unsecured)"),
    ("job", r"(job|trabaho|hiring|hr |interview|resume|applicant|work from home|part-time|salary|sahod|recruit)"),
    ("investment", r"(invest|crypto|forex|trading|interest|dividend|time deposit|shares|nav|returns|doble)"),
    ("bank_otp", r"(otp|one-time|verification code|access code|bdo|gcash|maya|coins\.ph|bank|account)"),
    ("parcel", r"(parcel|package|delivery|j&t|lazada|shopee|courier)"),
    ("telco_promo", r"(globe|smart|tnt|gomo|dito|promo|data|load|unli|gb\b)"),
    ("gov", r"(ntc|ndrrmc|dti|sec\.gov|doh|warning|babala|paalala)"),
]


def topic_of(text):
    t = str(text).lower()
    hits = [name for name, rx in TOPICS if re.search(rx, t)]
    return ",".join(hits[:2]) if hits else "other"


def norm_key(text):
    return preprocess(text)


def main():
    parts = []

    x = pd.read_excel(XLSX)
    x["category"] = x["category"].astype(str).str.strip().str.lower()
    x = x[x["category"].isin(LEGIT_CATS | {"spam"})].copy()
    x["label"] = x["category"].map(lambda c: "legit" if c in LEGIT_CATS else "scam")
    x["source"] = "tagalog_sms"
    parts.append(x[["text", "label", "source"]])

    o = pd.read_csv(OURS)
    o["label"] = "scam"
    o["source"] = "our_sms"
    parts.append(o[["text", "label", "source"]])

    s = pd.read_csv(SYNTH)
    parts.append(s[["text", "label", "source"]])

    df = pd.concat(parts, ignore_index=True)
    df["text"] = df["text"].astype(str).str.strip()
    df = df[df["text"].str.len() > 0]
    df["key"] = df["text"].map(norm_key)
    before = len(df)
    df = df.drop_duplicates("key").drop(columns="key").reset_index(drop=True)
    df["topic_hint"] = df["text"].map(topic_of)
    df.insert(0, "id", range(1, len(df) + 1))
    df[["id", "text", "topic_hint", "label", "source"]].to_csv(OUT, index=False, encoding="utf-8")

    print(f"read {before} messages, kept {len(df)} after removing repeats")
    print(df.groupby(["source", "label"]).size().unstack(fill_value=0))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
