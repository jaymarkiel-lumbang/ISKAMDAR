import pandas as pd
from common import anonymize, preprocess

RAW = "data/raw_sms.csv"

TOPICS = {
    "job": r"job|hiring|trabaho|work from home|wfh|part.?time|sahod|salary|apply|recruit",
    "investment": r"invest|crypto|usdt|profit|trading|partner|dividend|returns",
    "loan": r"loan|utang|cash advance",
    "gambling": r"bingo|casino|spin|slot|jili|panalo|sabong|jackpot|bet\b",
    "parcel": r"parcel|delivery|package",
    "real_estate": r"condo|studio units|lot for sale|property",
    "bank_otp": r"otp|bdo|bpi|gcash|maya|landbank|metrobank",
}

def tag(text: str) -> str:
    t = text.lower()
    hits = [k for k, p in TOPICS.items() if pd.Series([t]).str.contains(p, regex=True).iloc[0]]
    return ",".join(hits) if hits else "other"

def main():
    df = pd.read_csv(RAW)
    df = df[["date", "text", "carrier"]].copy()
    df["text"] = df["text"].astype(str).map(anonymize)
    before = len(df)
    df["norm"] = df["text"].map(preprocess)
    df = df.drop_duplicates(subset="norm").reset_index(drop=True)
    df.insert(0, "id", range(1, len(df) + 1))
    print(f"{before} rows -> {len(df)} after removing duplicates")

    df.to_csv("data/clean.csv", index=False)

    out = df[["id", "text"]].copy()
    out["topic_hint"] = df["text"].map(tag)
    out["label"] = ""
    out.to_csv("data/to_label.csv", index=False)
    print(out["topic_hint"].value_counts().head(10))
    print("Wrote data/clean.csv and data/to_label.csv")

if __name__ == "__main__":
    main()