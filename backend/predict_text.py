"""Score one message with the trained text model.

Run:  python predict_text.py "HIRING NA!!! Kumita ng P5,000 daily. Magbayad ng registration fee"
"""
import sys

import joblib
import numpy as np

from common import preprocess

bundle = joblib.load("models/text_model.joblib")
VEC, CLF = bundle["vectorizer"], bundle["model"]


def level(score: int) -> str:
    return "Low risk" if score < 30 else ("Suspicious" if score < 70 else "High risk")


def score_text(text: str, top_n: int = 5) -> dict:
    X = VEC.transform([preprocess(text)])
    pt = float(CLF.predict_proba(X)[0, 1])
    contrib = X.multiply(CLF.coef_[0]).toarray()[0]
    terms = np.array(VEC.get_feature_names_out())
    order = np.argsort(contrib)[::-1][:top_n]
    top = [(terms[i], round(float(contrib[i]), 3)) for i in order if contrib[i] > 0 and terms[i] != "num"]
    score = round(100 * pt)
    return {"pt": round(pt, 3), "score": score, "level": level(score), "top_words": top}


if __name__ == "__main__":
    print(score_text(" ".join(sys.argv[1:]) or "Earn 5k daily, pay 500 registration fee, limited slots today"))
