"""Score data/prototype_demo.csv with the trained model and show how the three groups come out.
Run after train_text.py:  python demo_check.py
Writes outputs/demo_scores.csv."""
import joblib
import pandas as pd
from common import preprocess

m = joblib.load("models/text_model.joblib")
vec, clf = m["vectorizer"], m["model"]
df = pd.read_csv("data/prototype_demo.csv")
df["score"] = (clf.predict_proba(vec.transform(df["text"].map(preprocess)))[:, 1] * 100).round().astype(int)
df["level"] = pd.cut(df["score"], [-1, 29, 69, 100], labels=["Low", "Suspicious", "High"])
print(pd.crosstab(df["label"], df["level"]).reindex(["legit", "uncertain", "scam"]))
print("\nmedian score:", df.groupby("label")["score"].median().to_dict())
sc, lg = df[df.label == "scam"], df[df.label == "legit"]
print(f"scam caught (score >= 30): {(sc.score >= 30).sum()}/{len(sc)}")
print(f"legit kept low (score < 30): {(lg.score < 30).sum()}/{len(lg)}")
import os; os.makedirs("outputs", exist_ok=True)
df.to_csv("outputs/demo_scores.csv", index=False)
print("\nMissed scams (scored Low):"); print(sc[sc.score < 30][["score", "text"]].to_string(index=False, max_colwidth=90))
print("\nLegit flagged (score >= 30):"); print(lg[lg.score >= 30][["score", "text"]].to_string(index=False, max_colwidth=90))
