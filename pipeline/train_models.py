"""
EventPulse — Model Training & Validation
==========================================
Trains two genuinely-fitted, validated models on the historical event
export, and exports their *learned* coefficients in a form the dashboard
can score client-side (no backend, no Python at runtime).

IMPORTANT — a leakage check we ran first, and why it shaped these targets:
`priority` turns out to be almost perfectly determined by `corridor` alone
(every named corridor is ~100% "High", "Non-corridor" is ~99.8% "Low" — it's
an operational designation, not a judgment call). A model "predicting"
priority from corridor would report a meaningless 99.9% AUC. So this script
does NOT train on priority. Instead it trains on the two targets in this
dataset that carry genuine, non-trivial uncertainty:

  1. Closure Risk model — LogisticRegression predicting P(this event will
     require a road closure), from cause + corridor + time-of-day +
     planned/unplanned. Closure rates vary continuously across both cause
     (4.3% for breakdowns, 80% for VIP movement) and corridor, with no
     deterministic rule — a legitimate prediction problem. Benchmarked
     against a RandomForestClassifier.
  2. Duration model — Ridge regression (log-duration) predicting expected
     resolution time from the same features plus the closure flag itself.
     Benchmarked against a RandomForestRegressor AND a naive "always predict
     the global median" baseline, because duration is inherently noisy and
     the honest story is the lift over that baseline, not a vanity R².

Why Logistic/Ridge regression rather than the better-scoring Random Forest
in production? Their coefficients are inspectable and portable to ~40 lines
of JavaScript with no inference library required at runtime. The Random
Forest is kept purely as a published benchmark, to make the
accuracy-vs-explainability trade-off explicit rather than assumed — see
`model_data.json["ml"]["metrics"]`.

Run AFTER data_pipeline.py (this script loads and extends model_data.json):
    python3 train_models.py /path/to/Astram_event_data.csv
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (accuracy_score, f1_score, mean_absolute_error,
                              precision_score, recall_score, r2_score,
                              roc_auc_score)
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

DEFAULT_INPUT = "/mnt/user-data/uploads/Astram_event_data_anonymized_-_Astram_event_data_anonymizedb40ac87.csv"
MODEL_DATA_PATH = Path(__file__).resolve().parent.parent / "dashboard" / "model_data.json"
MAX_DURATION_HR = 48
MIN_CAUSE_N = 10

CAT_FEATURES = ["event_cause", "corridor", "hour_bin", "event_type"]

HOUR_BIN_EDGES = [
    (0, 4, "late_night"), (4, 8, "early_morning"), (8, 12, "morning"),
    (12, 16, "midday"), (16, 20, "evening_peak"), (20, 24, "night_peak"),
]


def hour_to_bin(h):
    for lo, hi, name in HOUR_BIN_EDGES:
        if lo <= h < hi:
            return name
    return "late_night"


def build_features(df):
    df = df.copy()
    df["event_cause"] = df["event_cause"].fillna("others").astype(str)
    df["corridor"] = df["corridor"].fillna("Non-corridor").replace("", "Non-corridor")
    df["start_datetime"] = pd.to_datetime(df["start_datetime"], errors="coerce", utc=True)
    df["hour_bin"] = df["start_datetime"].dt.hour.apply(lambda h: hour_to_bin(h) if pd.notna(h) else "late_night")
    df["requires_road_closure"] = df["requires_road_closure"].astype(bool).astype(int)
    df["event_type"] = df["event_type"].fillna("unplanned")

    cause_counts = df["event_cause"].value_counts()
    keep_causes = set(cause_counts[cause_counts >= MIN_CAUSE_N].index)
    df["event_cause"] = df["event_cause"].apply(lambda c: c if c in keep_causes else "others")
    return df


def make_pipeline(estimator, extra_passthrough=None):
    transformers = [("cat", OneHotEncoder(handle_unknown="ignore"), CAT_FEATURES)]
    if extra_passthrough:
        transformers.append(("bool", "passthrough", extra_passthrough))
    pre = ColumnTransformer(transformers)
    return Pipeline([("pre", pre), ("est", estimator)])


def extract_linear_coefs(pipeline, feature_groups, has_closure_passthrough=False):
    pre = pipeline.named_steps["pre"]
    est = pipeline.named_steps["est"]
    names = pre.get_feature_names_out()
    coefs = est.coef_.ravel()
    intercept = float(est.intercept_.ravel()[0])

    out = {g: {} for g in feature_groups}
    if has_closure_passthrough:
        out["closure"] = 0.0
    for name, w in zip(names, coefs):
        if name.startswith("cat__"):
            rest = name[len("cat__"):]
            for g in feature_groups:
                prefix = g + "_"
                if rest.startswith(prefix):
                    out[g][rest[len(prefix):]] = round(float(w), 5)
                    break
        elif name.startswith("bool__requires_road_closure"):
            out["closure"] = round(float(w), 5)
    return {"intercept": round(intercept, 5), "weights": out}


def rf_group_importance(pipeline, feature_groups, has_closure_passthrough=False):
    pre = pipeline.named_steps["pre"]
    est = pipeline.named_steps["est"]
    names = pre.get_feature_names_out()
    imps = est.feature_importances_
    totals = {g: 0.0 for g in feature_groups}
    if has_closure_passthrough:
        totals["closure"] = 0.0
    for name, imp in zip(names, imps):
        if name.startswith("cat__"):
            rest = name[len("cat__"):]
            for g in feature_groups:
                if rest.startswith(g + "_"):
                    totals[g] += float(imp)
                    break
        elif name.startswith("bool__"):
            totals["closure"] += float(imp)
    s = sum(totals.values()) or 1.0
    return {k: round(v / s, 4) for k, v in totals.items()}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INPUT
    print(f"Loading {src} ...")
    raw = pd.read_csv(src, low_memory=False)
    df = build_features(raw)
    feature_groups = CAT_FEATURES

    # ==================================================================
    # MODEL 1 — Closure Risk: P(requires_road_closure)
    # Features deliberately exclude `priority` (leaks corridor identity,
    # see module docstring) — cause, corridor, time-of-day, planned status
    # only.
    # ==================================================================
    y_clo = df["requires_road_closure"].astype(int)
    X = df[CAT_FEATURES]
    base_rate = float(y_clo.mean())

    Xtr, Xte, ytr, yte = train_test_split(X, y_clo, test_size=0.2, random_state=42, stratify=y_clo)

    logit = make_pipeline(LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced"))
    logit.fit(Xtr, ytr)
    p_te = logit.predict_proba(Xte)[:, 1]
    pred_te = (p_te >= 0.5).astype(int)
    clo_metrics = {
        "base_rate_positive": round(base_rate, 4),
        "holdout_auc": round(roc_auc_score(yte, p_te), 4),
        "holdout_accuracy": round(accuracy_score(yte, pred_te), 4),
        "holdout_precision": round(precision_score(yte, pred_te, zero_division=0), 4),
        "holdout_recall": round(recall_score(yte, pred_te, zero_division=0), 4),
        "holdout_f1": round(f1_score(yte, pred_te, zero_division=0), 4),
    }
    cv_auc = cross_val_score(make_pipeline(LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced")),
                              X, y_clo, cv=5, scoring="roc_auc")
    clo_metrics["cv5_auc_mean"] = round(float(cv_auc.mean()), 4)
    clo_metrics["cv5_auc_std"] = round(float(cv_auc.std()), 4)

    dummy = DummyClassifier(strategy="most_frequent").fit(Xtr, ytr)
    clo_metrics["naive_majority_accuracy"] = round(accuracy_score(yte, dummy.predict(Xte)), 4)
    clo_metrics["naive_auc"] = 0.5

    rf_clf = make_pipeline(RandomForestClassifier(n_estimators=300, max_depth=10, random_state=42, class_weight="balanced"))
    rf_clf.fit(Xtr, ytr)
    p_rf = rf_clf.predict_proba(Xte)[:, 1]
    clo_metrics["rf_benchmark_auc"] = round(roc_auc_score(yte, p_rf), 4)
    clo_importance = rf_group_importance(rf_clf, feature_groups)

    logit_full = make_pipeline(LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced"))
    logit_full.fit(X, y_clo)
    closure_model = extract_linear_coefs(logit_full, feature_groups)

    print("Closure Risk model:", json.dumps(clo_metrics, indent=2))
    print("Closure Risk RF feature importance:", json.dumps(clo_importance, indent=2))

    # ==================================================================
    # MODEL 2 — Duration (hours), fit in log-space.
    # Includes requires_road_closure as a feature — at forecast time this
    # is either an explicit user toggle (planned events) or an already-known
    # fact (live incidents), never something this model has to guess.
    # ==================================================================
    dur_df = df.copy()
    dur_df["closed_datetime"] = pd.to_datetime(dur_df["closed_datetime"], errors="coerce", utc=True)
    dur_df["resolved_datetime"] = pd.to_datetime(dur_df["resolved_datetime"], errors="coerce", utc=True)
    dur_df["modified_datetime"] = pd.to_datetime(dur_df["modified_datetime"], errors="coerce", utc=True)
    dur_df["end_best"] = dur_df["closed_datetime"].fillna(dur_df["resolved_datetime"]).fillna(dur_df["modified_datetime"])
    dur_df["duration_hr"] = (dur_df["end_best"] - dur_df["start_datetime"]).dt.total_seconds() / 3600.0
    dur_df = dur_df[dur_df["duration_hr"].between(0.02, MAX_DURATION_HR)]

    y_dur = np.log1p(dur_df["duration_hr"].values)
    Xd = dur_df[CAT_FEATURES + ["requires_road_closure"]]

    Xtr, Xte, ytr, yte = train_test_split(Xd, y_dur, test_size=0.2, random_state=42)

    ridge = make_pipeline(Ridge(alpha=2.0), extra_passthrough=["requires_road_closure"])
    ridge.fit(Xtr, ytr)
    pred_log = ridge.predict(Xte)
    dur_metrics = {
        "holdout_r2_logspace": round(r2_score(yte, pred_log), 4),
        "holdout_mae_hours": round(float(mean_absolute_error(np.expm1(yte), np.expm1(pred_log))), 2),
    }
    cv_r2 = cross_val_score(make_pipeline(Ridge(alpha=2.0), extra_passthrough=["requires_road_closure"]),
                             Xd, y_dur, cv=5, scoring="r2")
    dur_metrics["cv5_r2_mean"] = round(float(cv_r2.mean()), 4)

    dummy_r = DummyRegressor(strategy="median").fit(Xtr, ytr)
    pred_dummy = dummy_r.predict(Xte)
    dur_metrics["naive_median_mae_hours"] = round(float(mean_absolute_error(np.expm1(yte), np.expm1(pred_dummy))), 2)
    dur_metrics["mae_improvement_vs_naive_pct"] = round(
        100 * (dur_metrics["naive_median_mae_hours"] - dur_metrics["holdout_mae_hours"]) / dur_metrics["naive_median_mae_hours"], 1
    )

    rf_reg = make_pipeline(RandomForestRegressor(n_estimators=300, max_depth=10, random_state=42),
                            extra_passthrough=["requires_road_closure"])
    rf_reg.fit(Xtr, ytr)
    pred_rf = rf_reg.predict(Xte)
    dur_metrics["rf_benchmark_r2_logspace"] = round(r2_score(yte, pred_rf), 4)
    dur_metrics["rf_benchmark_mae_hours"] = round(float(mean_absolute_error(np.expm1(yte), np.expm1(pred_rf))), 2)
    dur_importance = rf_group_importance(rf_reg, feature_groups, has_closure_passthrough=True)

    ridge_full = make_pipeline(Ridge(alpha=2.0), extra_passthrough=["requires_road_closure"])
    ridge_full.fit(Xd, y_dur)
    duration_model = extract_linear_coefs(ridge_full, feature_groups, has_closure_passthrough=True)
    resid = y_dur - ridge_full.predict(Xd)
    duration_model["residual_std_logspace"] = round(float(resid.std()), 4)

    print("Duration model:", json.dumps(dur_metrics, indent=2))
    print("Duration RF feature importance:", json.dumps(dur_importance, indent=2))

    # ==================================================================
    # Write into model_data.json
    # ==================================================================
    with open(MODEL_DATA_PATH) as f:
        model_data = json.load(f)

    model_data["ml"] = {
        "trained_on_n": int(len(df)),
        "duration_trained_on_n": int(len(dur_df)),
        "hour_bins": [b[2] for b in HOUR_BIN_EDGES],
        "closure_model": {
            "type": "LogisticRegression(C=1.0, class_weight=balanced)",
            "target": "requires_road_closure",
            **closure_model,
        },
        "duration_model": {
            "type": "Ridge(alpha=2.0), target=log1p(hours)",
            **duration_model,
        },
        "metrics": {
            "closure_risk": clo_metrics,
            "closure_risk_rf_feature_importance": clo_importance,
            "duration": dur_metrics,
            "duration_rf_feature_importance": dur_importance,
        },
    }

    with open(MODEL_DATA_PATH, "w") as f:
        json.dump(model_data, f, separators=(",", ":"))
    print(f"\nWrote ML model + metrics into {MODEL_DATA_PATH}")


if __name__ == "__main__":
    main()
