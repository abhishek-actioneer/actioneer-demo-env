"""
Gender classification using moorlee/gender-voice-classifier-ecapa.

Architecture:
  1. ECAPA-TDNN backbone (speechbrain/spkrec-ecapa-voxceleb, shared with embedder.py) → 192-dim embedding
  2. StandardScaler normalization
  3. LogisticRegression binary classifier (female / male, 193 parameters total)
  4. Female-optimized threshold (loaded from thresholds.json, default ~0.05)
     — maximises female recall, critical for gender-mismatch fraud detection

Advantages over the previous audeering wav2vec2 model:
  - 99.3% accuracy, 99.8% female recall (vs wav2vec2's 3-class "child" confusion)
  - Backbone is already loaded by embedder.py — no extra memory cost
  - Covers English, Hindi, Tamil (FLEURS-trained)
"""

import logging
import numpy as np

logger = logging.getLogger(__name__)

REPO = "moorlee/gender-voice-classifier-ecapa"
TARGET_SR = 16000
CONFIDENCE_THRESHOLD = 0.65  # below this → "uncertain"

_scaler = None
_clf = None
_female_threshold = None
_load_error = None


def _load():
    global _scaler, _clf, _female_threshold, _load_error

    if _clf is not None:
        return True
    if _load_error is not None:
        return False

    try:
        import json
        import joblib
        from huggingface_hub import hf_hub_download

        logger.info("Loading ECAPA gender classifier from %s", REPO)

        _scaler = joblib.load(hf_hub_download(REPO, "scaler.pkl"))
        _clf = joblib.load(hf_hub_download(REPO, "logreg.pkl"))
        thresholds = json.load(open(hf_hub_download(REPO, "thresholds.json")))
        _female_threshold = thresholds["female_optimized"]

        logger.info("ECAPA gender classifier loaded (female_threshold=%.3f)", _female_threshold)

    except Exception as e:
        _load_error = str(e)
        logger.warning("ECAPA gender classifier load failed (will return uncertain): %s", e)
        return False

    return True


def classify_gender(samples: np.ndarray, sr: int) -> dict:
    """
    Classify gender from audio samples.

    samples: float32 numpy array, mono, any sample rate
    sr:      sample rate of samples

    Returns dict: { detected_gender, gender_confidence, gender_signals }
    detected_gender is "uncertain" when confidence < CONFIDENCE_THRESHOLD or model unavailable.
    Never raises.
    """
    try:
        import torch
        import librosa
        from embedder import load_model

        if not _load():
            return _uncertain("model_unavailable")

        if sr != TARGET_SR:
            samples_16k = librosa.resample(samples, orig_sr=sr, target_sr=TARGET_SR)
        else:
            samples_16k = samples.copy()

        if len(samples_16k) < TARGET_SR * 0.5:
            return _uncertain("audio_too_short")

        encoder = load_model()
        with torch.no_grad():
            # Raw 192-dim embedding — no L2 normalisation, matching training setup
            emb = encoder.encode_batch(
                torch.tensor(samples_16k).float().unsqueeze(0)
            ).squeeze().numpy()  # (192,)

        p_female = float(_clf.predict_proba(_scaler.transform(emb.reshape(1, -1)))[0, 1])
        p_male = 1.0 - p_female

        is_female = p_female >= _female_threshold
        confidence = p_female if is_female else p_male
        detected_gender = ("female" if is_female else "male") if confidence >= CONFIDENCE_THRESHOLD else "uncertain"

        logger.info(
            "gender: %s confidence=%.3f (female_prob=%.3f male_prob=%.3f)",
            detected_gender, confidence, p_female, p_male,
        )

        return {
            "detected_gender": detected_gender,
            "gender_confidence": round(confidence, 3),
            "gender_signals": {
                "female_prob": round(p_female, 3),
                "male_prob": round(p_male, 3),
                "model": REPO,
                "audio_duration_s": round(len(samples_16k) / TARGET_SR, 1),
            },
        }

    except Exception as e:
        logger.warning("gender classify error: %s", e)
        return _uncertain(str(e)[:100])


def _uncertain(reason: str = "") -> dict:
    return {
        "detected_gender": "uncertain",
        "gender_confidence": None,
        "gender_signals": {"reason": reason} if reason else {},
    }


def warmup():
    """Pre-load classifier weights at startup — encoder is warmed up by embedder.py."""
    try:
        _load()
    except Exception:
        pass
