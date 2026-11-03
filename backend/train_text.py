"""Train the ISKAMDAR text model (Sections 3.5 and 3.8) and export it for the web app.

Input : data/labeled.csv     columns id,text,label   (label: 1/scam, 0/legit; blank or 'uncertain' rows are skipped)
Model : TF-IDF (words + two-word phrases) + logistic regression with L2 penalty, seed 42
Split : about 60 / 15 / 25 train / validation / test; near-duplicate messages (cosine >= 0.8) stay in the same split
Tuning: min_df and C on the validation split; cut-offs T1 (best F2) and T2 (best F0.5) on the validation split
Test  : scored once at the end
Out   : models/text_model.joblib
        models/textmodel.js    <- copy this next to script.js in the web app
        outputs/test_predictions.csv

Run:  python train_text.py
"""
import json
import os
import shutil
import subprocess

import joblib
import numpy as np
import pandas as pd
from scipy.sparse.csgraph import connected_components
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, brier_score_loss, confusion_matrix, f1_score,
                             fbeta_score, precision_score, recall_score)
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import StratifiedGroupKFold

from common import SEED, preprocess

LABELED = "data/labeled.csv"
LABEL_MAP = {"scam": 1, "1": 1, "1.0": 1, "legitimate": 0, "legit": 0, "0": 0, "0.0": 0}


def load():
    df = pd.read_csv(LABELED)
    df["label"] = df["label"].astype(str).str.strip().str.lower()
    df = df[df["label"].isin(LABEL_MAP)].copy()
    df["y"] = df["label"].map(LABEL_MAP)
    df["norm"] = df["text"].map(preprocess)
    df = df[df["norm"].str.len() > 0].reset_index(drop=True)
    if df["y"].nunique() < 2:
        raise SystemExit("Need both scam and legitimate labels before training.")
    return df


def check_labels(df):
    """Stop if the labels just repeat the topic. A model trained on that learns topics, not scams."""
    if "topic_hint" not in df:
        return
    top = df["topic_hint"].fillna("other").astype(str).str.split(",").str[0]
    stats = df.groupby(top)["y"].agg(["count", "mean"])
    print("\nShare of 'scam' labels by topic_hint (check this makes sense):")
    print(stats.round(2).to_string())
    bad = stats[(stats["count"] >= 30) & ((stats["mean"] >= 0.97) | (stats["mean"] <= 0.03))]
    if len(bad):
        print("\nWARNING: these topics have almost only one label:", ", ".join(bad.index))
        print("The model may learn the topic instead of what makes a message a scam. Review those labels.")
        if os.environ.get("ISK_FORCE") != "1":
            raise SystemExit("Stopped. Fix the labels, or run with ISK_FORCE=1 to train anyway (demo only).")


def groups_of(norm):
    X = TfidfVectorizer().fit_transform(norm)
    return connected_components(cosine_similarity(X) >= 0.8, directed=False)[1]


def split(df, groups):
    y = df["y"].values
    outer = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=SEED)
    rest, te = next(outer.split(df, y, groups))
    inner = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    tr_i, va_i = next(inner.split(df.iloc[rest], y[rest], groups[rest]))
    return rest[tr_i], rest[va_i], te


def fit(texts, y, min_df, C):
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=min_df, sublinear_tf=True)
    X = vec.fit_transform(texts)
    clf = LogisticRegression(C=C, class_weight="balanced", max_iter=2000, random_state=SEED).fit(X, y)
    return vec, clf


def best_t(y, p, beta):
    grid = np.arange(0.05, 0.96, 0.01)
    return float(grid[int(np.argmax([fbeta_score(y, p >= t, beta=beta, zero_division=0) for t in grid]))])


def main():
    df = load()
    check_labels(df)
    y = df["y"].values
    tr, va, te = split(df, groups_of(df["norm"]))
    if "source" in df:  # messages we wrote ourselves are used for training only, never for validation or test
        own = (df["source"].astype(str) == "synthetic").values
        moved = np.array([i for i in np.concatenate([va, te]) if own[i]], dtype=int)
        tr = np.concatenate([tr, moved]).astype(int)
        va = np.array([i for i in va if not own[i]], dtype=int)
        te = np.array([i for i in te if not own[i]], dtype=int)
    print(f"\nrecords {len(df)} | train {len(tr)} | validation {len(va)} | test {len(te)}")
    for name, idx in (("train", tr), ("validation", va), ("test", te)):
        n1 = int(y[idx].sum())
        print(f"  {name}: scam {n1}, legitimate {len(idx) - n1}")
        if n1 == 0 or n1 == len(idx):
            raise SystemExit(f"The {name} split has only one class. Label more messages of the missing kind.")

    best = None
    for min_df in (1, 2, 3):
        for C in (0.1, 0.3, 1, 3, 10, 30):
            vec, clf = fit(df.loc[tr, "norm"], y[tr], min_df, C)
            p = clf.predict_proba(vec.transform(df.loc[va, "norm"]))[:, 1]
            f1 = f1_score(y[va], p >= 0.5, zero_division=0)
            if best is None or f1 > best[0]:
                best = (f1, min_df, C, vec, clf, p)
    f1, min_df, C, vec, clf, p_val = best
    print(f"\nbest on validation: min_df={min_df} C={C} F1={f1:.3f} Brier={brier_score_loss(y[va], p_val):.3f}")
    t1, t2 = best_t(y[va], p_val, 2), best_t(y[va], p_val, 0.5)
    t2 = max(t2, t1)
    print(f"tuned cut-offs on validation: T1={t1:.2f} (F2), T2={t2:.2f} (F0.5)")
    print("The web app uses the proposal's development cut-offs 30 / 70 until you decide to switch.")

    p_te = clf.predict_proba(vec.transform(df.loc[te, "norm"]))[:, 1]
    cut = 0.30
    pred = (p_te >= cut).astype(int)
    tn, fp, fn, tp = confusion_matrix(y[te], pred, labels=[0, 1]).ravel()
    res = dict(cutoff=cut, tp=int(tp), fp=int(fp), fn=int(fn), tn=int(tn),
               accuracy=accuracy_score(y[te], pred), precision=precision_score(y[te], pred, zero_division=0),
               recall=recall_score(y[te], pred, zero_division=0), f1=f1_score(y[te], pred, zero_division=0))
    print(f"\nTEST at cut-off {cut:.2f}:  TP={tp} FP={fp} FN={fn} TN={tn}")
    print("  accuracy {accuracy:.3f}  precision {precision:.3f}  recall {recall:.3f}  F1 {f1:.3f}".format(**res))

    os.makedirs("models", exist_ok=True)
    os.makedirs("outputs", exist_ok=True)
    joblib.dump({"vectorizer": vec, "model": clf, "t1": t1, "t2": t2}, "models/text_model.joblib")
    out = df.loc[te, ["id", "norm"]].assign(label=y[te], p_text=p_te, score=(p_te * 100).round().astype(int))
    out.to_csv("outputs/test_predictions.csv", index=False)

    meta = dict(version=1, t1=0.30, t2=0.70, tuned_t1=t1, tuned_t2=t2, n_train=int(len(tr)), n_total=int(len(df)), test=res)
    model = dict(terms=list(vec.get_feature_names_out()), idf=[float(x) for x in vec.idf_],
                 coef=[float(x) for x in clf.coef_[0]], intercept=float(clf.intercept_[0]), meta=meta)
    engine = open("textmodel_engine.js", encoding="utf-8").read()
    js = (engine + "\nconst __M = " + json.dumps(model, separators=(",", ":")) + ";\n"
          "const __score = makeScorer(__M);\n"
          "window.IskTextModel = { meta: __M.meta, score: __score };\n")
    with open("models/textmodel.js", "w", encoding="utf-8") as f:
        f.write(js)
    print("\nSaved models/text_model.joblib, models/textmodel.js, outputs/test_predictions.csv")
    parity(model)


def parity(model):
    """Check the browser engine gives the same probabilities as scikit-learn."""
    if not shutil.which("node"):
        print("(node not found: skipped the browser parity check)")
        return
    test = pd.read_csv("outputs/test_predictions.csv").head(40)
    test[["norm", "p_text"]].to_json("outputs/_parity.json", orient="records")
    harness = ("const fs=require('fs');const src=fs.readFileSync('models/textmodel.js','utf8');"
               "global.window={};new Function(src)();" 
               "const rows=JSON.parse(fs.readFileSync('outputs/_parity.json'));let m=0;"
               "for(const r of rows){m=Math.max(m,Math.abs(window.IskTextModel.score(r.norm).p-r.p_text));}"
               "console.log(m);")
    r = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    os.remove("outputs/_parity.json")
    try:
        d = float(r.stdout.strip())
        print(f"Browser vs Python max difference: {d:.1e}", "OK" if d < 1e-9 else "<-- MISMATCH, check preprocess()")
    except ValueError:
        print("Parity check could not run:", r.stderr.strip()[:200])


if __name__ == "__main__":
    main()
