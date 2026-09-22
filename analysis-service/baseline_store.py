"""
Per-customer longitudinal feature baseline.

Stores the historical distribution (mean, std, n) of every acoustic feature
for each customer. After each call, updates the running stats.
On a new call, computes z-scores: how unusual is this call for THIS person.

Key insight: the strongest fraud signal is deviation from the customer's own
historical norm — not comparison to a population average.

Example:
  Customer historical: speaking_rate=4.2, pause_ratio=0.12
  Today's call:        speaking_rate=2.1, pause_ratio=0.35
  → z_speaking_rate = -3.2, z_pause_ratio = +4.1 → SUSPICIOUS

Storage: baselines/{customer_id}.json (one file per customer)
"""

import json
import math
import os
from pathlib import Path

BASELINES_DIR = Path(os.environ.get("BASELINES_DIR", "baselines"))

TRACKED_FEATURES = [
    "jitter", "shimmer", "hnr", "mean_f0", "f0_variance",
    "f1_mean", "f2_mean", "f3_mean", "cpp",
    "speaking_rate", "spectral_entropy", "spectral_flux",
    "pause_count", "mean_pause_duration_ms", "pause_ratio", "max_pause_ms",
    "voice_onset_ms", "elaboration_ratio", "echo_score",
]


def _path(customer_id: str) -> Path:
    BASELINES_DIR.mkdir(exist_ok=True)
    safe = customer_id.replace("/", "_").replace("..", "_")
    return BASELINES_DIR / f"{safe}.json"


def load_baseline(customer_id: str) -> dict:
    p = _path(customer_id)
    if not p.exists():
        return {"n_calls": 0, "features": {}}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {"n_calls": 0, "features": {}}


def save_baseline(customer_id: str, baseline: dict) -> None:
    _path(customer_id).write_text(json.dumps(baseline, indent=2))


def update_baseline(customer_id: str, features: dict) -> dict:
    """
    Online update of per-customer feature baseline using Welford's algorithm.
    Returns the updated baseline.
    """
    baseline = load_baseline(customer_id)
    n = baseline["n_calls"]
    feat_store = baseline.get("features", {})

    for key in TRACKED_FEATURES:
        val = features.get(key)
        if val is None or not isinstance(val, (int, float)):
            continue
        if math.isnan(val) or math.isinf(val):
            continue

        if key not in feat_store:
            feat_store[key] = {"mean": val, "M2": 0.0, "n": 1}
        else:
            # Welford's online algorithm for numerically stable mean + variance
            fs = feat_store[key]
            fs_n = fs["n"] + 1
            delta = val - fs["mean"]
            fs["mean"] += delta / fs_n
            delta2 = val - fs["mean"]
            fs["M2"] += delta * delta2
            fs["n"] = fs_n

    baseline["n_calls"] = n + 1
    baseline["features"] = feat_store
    save_baseline(customer_id, baseline)
    return baseline


def compute_z_scores(customer_id: str, features: dict, min_calls: int = 3) -> dict:
    """
    Compare current call features against customer's historical distribution.
    Returns z-scores for each feature and an overall anomaly score.

    z > 2.5 or z < -2.5 → unusual for this customer
    Composite anomaly = count of features beyond ±2.5σ
    """
    baseline = load_baseline(customer_id)
    feat_store = baseline.get("features", {})
    n_calls = baseline.get("n_calls", 0)

    if n_calls < min_calls:
        return {
            "status": "insufficient_history",
            "n_calls": n_calls,
            "min_calls_needed": min_calls,
            "z_scores": {},
            "anomaly_score": None,
            "anomalous_features": [],
        }

    z_scores = {}
    for key in TRACKED_FEATURES:
        val = features.get(key)
        if val is None or not isinstance(val, (int, float)):
            continue
        if math.isnan(val) or math.isinf(val):
            continue
        if key not in feat_store:
            continue

        fs = feat_store[key]
        n = fs["n"]
        mean = fs["mean"]
        # Welford variance
        std = math.sqrt(fs["M2"] / max(n - 1, 1)) if n > 1 else 0.0

        if std < 1e-8:
            continue

        z = (val - mean) / std
        z_scores[key] = round(z, 3)

    anomalous = {k: v for k, v in z_scores.items() if abs(v) > 2.5}

    # Composite anomaly score: weighted sum of normalized z-scores
    # High-value features weighted more (from our comparison analysis)
    weights = {
        "pause_ratio": 2.0,
        "mean_pause_duration_ms": 2.0,
        "speaking_rate": 1.8,
        "elaboration_ratio": 1.8,
        "echo_score": 1.5,
        "voice_onset_ms": 1.5,
        "cpp": 1.3,
        "f2_mean": 1.3,
        "f1_mean": 1.2,
        "mean_f0": 1.0,
        "hnr": 0.8,
        "jitter": 0.6,
        "shimmer": 0.6,
    }

    weighted_sum = 0.0
    weight_total = 0.0
    for k, z in z_scores.items():
        w = weights.get(k, 1.0)
        weighted_sum += abs(z) * w
        weight_total += w

    anomaly_score = (weighted_sum / weight_total) if weight_total > 0 else 0.0
    # Normalize: score of 2.5 = average feature is 2.5σ away = very suspicious
    normalized = min(1.0, anomaly_score / 3.0)

    return {
        "status": "ok",
        "n_calls": n_calls,
        "z_scores": z_scores,
        "anomaly_score": round(normalized, 4),
        "anomalous_features": [
            {"feature": k, "z": v, "direction": "high" if v > 0 else "low"}
            for k, v in sorted(anomalous.items(), key=lambda x: abs(x[1]), reverse=True)
        ],
    }


def get_baseline_summary(customer_id: str) -> dict:
    """Return readable summary of customer's historical feature ranges."""
    baseline = load_baseline(customer_id)
    feat_store = baseline.get("features", {})
    summary = {}
    for key, fs in feat_store.items():
        n = fs["n"]
        mean = fs["mean"]
        std = math.sqrt(fs["M2"] / max(n - 1, 1)) if n > 1 else 0.0
        summary[key] = {
            "mean": round(mean, 4),
            "std": round(std, 4),
            "n": n,
        }
    return {
        "customer_id": customer_id,
        "n_calls": baseline.get("n_calls", 0),
        "features": summary,
    }
