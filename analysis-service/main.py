"""
Fraud call audio analysis microservice.

Endpoints:
  GET  /health
  POST /analyze-call        — acoustic features + stress classification (parselmouth + librosa)
  POST /enroll              — extract x-vector from WAV and store as customer bioprint
  POST /verify              — compare WAV against enrolled bioprint (full call)
  POST /stream-verify       — fast x-vector check on a 2s audio chunk (realtime)
  DELETE /bioprint/{id}     — remove enrolled bioprint
  GET  /bioprint/{id}/status — check if a customer is enrolled
"""

import base64
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from audio import extract_customer_channel, has_background_voice
from features import extract_all_features
from model import classify_stress, weighted_fraud_score
from embedder import get_embedding, cosine_similarity
from speaker_store import save_bioprint, load_bioprint, has_bioprint, delete_bioprint, list_enrolled
from baseline_store import update_baseline, compute_z_scores, get_baseline_summary
from gender import classify_gender, warmup as gender_warmup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="fraud-audio-analysis", version="2.0.0")

# Warm up gender model in background on startup
@app.on_event("startup")
async def startup_event():
    import threading
    threading.Thread(target=gender_warmup, daemon=True).start()


# ── Shared types ──────────────────────────────────────────────────────────────

class TranscriptFeatures(BaseModel):
    voice_onset_ms: Optional[float] = None
    elaboration_ratio: Optional[float] = None
    echo_score: Optional[float] = None


# ── /health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "enrolled": list_enrolled()}


# ── /analyze-call ─────────────────────────────────────────────────────────────

class TransactionContext(BaseModel):
    deviation_factor: Optional[float] = None
    device_risk_score: Optional[float] = None
    geo_mismatch: Optional[bool] = None
    rule_fp_rate: Optional[float] = None


class AnalyzeCallRequest(BaseModel):
    wav_base64: str
    transcript_features: Optional[TranscriptFeatures] = None
    customer_id: Optional[str] = None
    transaction: Optional[TransactionContext] = None


@app.post("/analyze-call")
def analyze_call(req: AnalyzeCallRequest):
    try:
        wav_bytes = base64.b64decode(req.wav_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 WAV")

    if len(wav_bytes) < 44:
        raise HTTPException(status_code=400, detail="WAV too short")

    try:
        samples, sr = extract_customer_channel(wav_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Audio decode failed: {e}")

    bg_voice = has_background_voice(wav_bytes)
    acoustic = extract_all_features(samples, sr)
    acoustic["background_voice"] = bg_voice

    tf = req.transcript_features.model_dump() if req.transcript_features else None
    classification = classify_stress(acoustic, tf)

    # Optional speaker verification against enrolled bioprint
    speaker_result = None
    if req.customer_id and len(samples) > sr * 1.0:
        speaker_result = _run_speaker_verify(samples, sr, req.customer_id, enroll_if_missing=True)

    logger.info(
        "analyze-call: stress_class=%s score=%s bg=%s jitter=%s hnr=%s speaker=%s",
        classification["stress_class"], classification["rule_score"],
        bg_voice, acoustic.get("jitter"), acoustic.get("hnr"),
        speaker_result.get("similarity") if speaker_result else "n/a"
    )

    # Merge transcript features into flat feature dict for baseline
    all_features = {**acoustic, "background_voice": bg_voice}
    if tf:
        all_features.update(tf)

    # Longitudinal baseline: z-scores vs customer's own history
    longitudinal = {}
    if req.customer_id:
        longitudinal = compute_z_scores(req.customer_id, all_features)
        # Update baseline AFTER computing z-scores (so this call doesn't affect its own score)
        update_baseline(req.customer_id, all_features)

    # Weighted fraud score fusion
    txn_dict = req.transaction.model_dump() if req.transaction else {}
    fusion = weighted_fraud_score(
        stress={**classification, "transcript_features": tf or {}},
        speaker=speaker_result or {},
        transaction=txn_dict,
    )

    # Boost fraud score if longitudinal anomaly detected
    anomaly_score = longitudinal.get("anomaly_score")
    if anomaly_score is not None and anomaly_score > 0.5:
        fusion["combined_score"] = min(1.0, fusion["combined_score"] + anomaly_score * 0.2)
        if fusion["combined_score"] >= 0.70:
            fusion["recommendation"] = "block"
        elif fusion["combined_score"] >= 0.45:
            fusion["recommendation"] = "escalate"

    # Gender detection — runs on full call audio (more reliable than stream chunks)
    gender = classify_gender(samples, sr)

    return {
        # Acoustic (Praat)
        "jitter": acoustic.get("jitter"),
        "shimmer": acoustic.get("shimmer"),
        "hnr": acoustic.get("hnr"),
        "cpp": acoustic.get("cpp"),
        "mean_f0": acoustic.get("mean_f0"),
        "f0_variance": acoustic.get("f0_variance"),
        "f1_mean": acoustic.get("f1_mean"),
        "f2_mean": acoustic.get("f2_mean"),
        "f3_mean": acoustic.get("f3_mean"),
        "f4_mean": acoustic.get("f4_mean"),
        "f1_std": acoustic.get("f1_std"),
        "f2_std": acoustic.get("f2_std"),
        # Prosodic (librosa)
        "mfcc_1_13": acoustic.get("mfcc_1_13"),
        "mfcc_delta_1_13": acoustic.get("mfcc_delta_1_13"),
        "mfcc_delta2_1_13": acoustic.get("mfcc_delta2_1_13"),
        "speaking_rate": acoustic.get("speaking_rate"),
        "spectral_entropy": acoustic.get("spectral_entropy"),
        "spectral_flux": acoustic.get("spectral_flux"),
        # GFCC
        "gfcc_1_13": acoustic.get("gfcc_1_13"),
        # Pause analysis
        "pause_count": acoustic.get("pause_count"),
        "mean_pause_duration_ms": acoustic.get("mean_pause_duration_ms"),
        "pause_ratio": acoustic.get("pause_ratio"),
        "max_pause_ms": acoustic.get("max_pause_ms"),
        "background_voice": bg_voice,
        # Stress
        "stress_class": classification["stress_class"],
        "stress_score": classification["stress_score"],
        "rule_score": classification["rule_score"],
        "reasons": classification["reasons"],
        # Speaker identity
        "speaker": speaker_result,
        # Longitudinal: is this call unusual for THIS customer?
        "longitudinal": longitudinal,
        # Combined score
        "fraud_score": fusion["combined_score"],
        "recommendation": fusion["recommendation"],
        "score_breakdown": fusion["breakdown"],
        # Gender detection
        "detected_gender": gender["detected_gender"],
        "gender_confidence": gender["gender_confidence"],
        "gender_signals": gender["gender_signals"],
    }


# ── /classify-gender ─────────────────────────────────────────────────────────

class GenderRequest(BaseModel):
    wav_base64: str


@app.post("/classify-gender")
def classify_gender_endpoint(req: GenderRequest):
    """
    Fast gender classification only — no Praat/librosa/stress.
    Returns in ~1-2s vs 5-30s for /analyze-call.
    """
    try:
        wav_bytes = base64.b64decode(req.wav_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 WAV")

    try:
        samples, sr = extract_customer_channel(wav_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Audio decode failed: {e}")

    return classify_gender(samples, sr)


# ── /enroll ───────────────────────────────────────────────────────────────────

class EnrollRequest(BaseModel):
    wav_base64: str
    customer_id: str


@app.post("/enroll")
def enroll(req: EnrollRequest):
    """Extract x-vector from full call WAV and store as the customer's bioprint."""
    try:
        wav_bytes = base64.b64decode(req.wav_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 WAV")

    try:
        samples, sr = extract_customer_channel(wav_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Audio decode failed: {e}")

    if len(samples) < sr * 1.5:
        raise HTTPException(status_code=400, detail="Need at least 1.5s of audio to enroll")

    embedding = get_embedding(samples, sr)
    save_bioprint(req.customer_id, embedding)

    return {
        "customer_id": req.customer_id,
        "enrolled": True,
        "embedding_dim": len(embedding),
        "duration_s": round(len(samples) / sr, 1),
        "n_calls": 1,
    }


class EnrollMultiRequest(BaseModel):
    wav_base64_list: list   # list of base64 WAV strings
    customer_id: str
    weights: Optional[list] = None   # per-call weights (e.g. duration); uniform if None


@app.post("/enroll-multi")
def enroll_multi(req: EnrollMultiRequest):
    """
    Build a robust speaker bioprint by averaging x-vectors across multiple calls.
    More stable than single-call enrollment — averages out session noise.
    """
    if not req.wav_base64_list:
        raise HTTPException(status_code=400, detail="wav_base64_list is empty")

    embeddings = []
    durations = []
    failures = []

    for i, wav_b64 in enumerate(req.wav_base64_list):
        try:
            wav_bytes = base64.b64decode(wav_b64)
            samples, sr = extract_customer_channel(wav_bytes)
            if len(samples) < sr * 1.0:
                failures.append({"index": i, "reason": "too_short"})
                continue
            emb = get_embedding(samples, sr)
            embeddings.append(emb)
            durations.append(len(samples) / sr)
        except Exception as e:
            failures.append({"index": i, "reason": str(e)[:80]})

    if not embeddings:
        raise HTTPException(status_code=422, detail="No valid audio in any of the provided WAVs")

    import numpy as np

    # Weighted average (by duration if no weights given, else uniform)
    if req.weights and len(req.weights) == len(embeddings):
        w = np.array(req.weights, dtype=np.float32)
    else:
        w = np.array(durations, dtype=np.float32)

    w = w / w.sum()
    centroid = sum(emb * wi for emb, wi in zip(embeddings, w))

    # L2-renormalise
    norm = np.linalg.norm(centroid)
    if norm > 0:
        centroid = centroid / norm

    save_bioprint(req.customer_id, centroid.astype(np.float32))

    # Self-similarity stats across the N calls (shows within-speaker variance)
    sims = [float(np.dot(centroid, e)) for e in embeddings]

    logger.info(
        "enroll-multi: customer=%s n=%d avg_sim=%.3f min_sim=%.3f",
        req.customer_id, len(embeddings), sum(sims)/len(sims), min(sims)
    )

    return {
        "customer_id": req.customer_id,
        "enrolled": True,
        "n_calls": len(embeddings),
        "n_failed": len(failures),
        "failures": failures,
        "embedding_dim": len(centroid),
        "within_speaker_similarity": {
            "mean": round(float(sum(sims) / len(sims)), 4),
            "min": round(float(min(sims)), 4),
            "max": round(float(max(sims)), 4),
        },
        "per_call_similarity": [round(s, 4) for s in sims],
        "per_call_duration_s": [round(d, 1) for d in durations],
    }


# ── /verify ───────────────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    wav_base64: str
    customer_id: str
    enroll_if_missing: bool = False


@app.post("/verify")
def verify(req: VerifyRequest):
    """Compare a full call WAV against the enrolled bioprint for this customer."""
    try:
        wav_bytes = base64.b64decode(req.wav_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 WAV")

    try:
        samples, sr = extract_customer_channel(wav_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Audio decode failed: {e}")

    result = _run_speaker_verify(samples, sr, req.customer_id, req.enroll_if_missing)
    return {"customer_id": req.customer_id, **result}


# ── /stream-verify ────────────────────────────────────────────────────────────

class StreamVerifyRequest(BaseModel):
    wav_chunk_base64: str   # stereo 8kHz WAV, ~2s
    customer_id: str
    window_index: int = 0
    enroll_if_missing: bool = True


@app.post("/stream-verify")
def stream_verify(req: StreamVerifyRequest):
    """
    Fast speaker check on a 2-second audio chunk. Called every ~2s during a live call.
    Returns similarity score and whether the speaker matches the enrolled bioprint.
    If no bioprint yet, enrolls from this chunk (first 2s = enrollment window).
    """
    try:
        wav_bytes = base64.b64decode(req.wav_chunk_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 WAV chunk")

    try:
        samples, sr = extract_customer_channel(wav_bytes)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Audio decode failed: {e}")

    if len(samples) < sr * 0.5:
        return {"status": "chunk_too_short", "window_index": req.window_index}

    result = _run_speaker_verify(samples, sr, req.customer_id, req.enroll_if_missing)

    # Gender on stream chunk — only run every 5th window to avoid latency spike
    gender = {}
    if req.window_index % 5 == 0 and len(samples) >= sr * 1.5:
        gender = classify_gender(samples, sr)

    return {"window_index": req.window_index, **result, **gender}


# ── /bioprint/{customer_id} ───────────────────────────────────────────────────

@app.get("/bioprint/{customer_id}/status")
def bioprint_status(customer_id: str):
    return {"customer_id": customer_id, "enrolled": has_bioprint(customer_id)}


@app.delete("/bioprint/{customer_id}")
def bioprint_delete(customer_id: str):
    deleted = delete_bioprint(customer_id)
    return {"customer_id": customer_id, "deleted": deleted}


# ── Longitudinal baseline endpoints ──────────────────────────────────────────

@app.get("/baseline/{customer_id}")
def baseline_get(customer_id: str):
    """Return the customer's historical feature distribution."""
    return get_baseline_summary(customer_id)


@app.delete("/baseline/{customer_id}")
def baseline_delete(customer_id: str):
    from pathlib import Path
    p = Path("baselines") / f"{customer_id.replace('/', '_')}.json"
    deleted = p.exists()
    if deleted:
        p.unlink()
    return {"customer_id": customer_id, "deleted": deleted}


# ── Internal helper ───────────────────────────────────────────────────────────

def _run_speaker_verify(samples, sr, customer_id: str, enroll_if_missing: bool) -> dict:
    embedding = get_embedding(samples, sr)
    enrolled = load_bioprint(customer_id)

    if enrolled is None:
        if enroll_if_missing:
            save_bioprint(customer_id, embedding)
            return {
                "status": "enrolled",
                "similarity": None,
                "is_same_speaker": None,
                "confidence": None,
            }
        return {
            "status": "not_enrolled",
            "similarity": None,
            "is_same_speaker": None,
            "confidence": None,
        }

    sim = cosine_similarity(enrolled, embedding)

    # Thresholds calibrated for VoxCeleb x-vectors on phone-quality audio
    # Phone degrades similarity by ~0.05-0.10 vs clean audio
    is_same = sim > 0.75
    if sim > 0.85:
        confidence = "high"
    elif sim > 0.75:
        confidence = "medium"
    elif sim > 0.60:
        confidence = "uncertain"
    else:
        confidence = "high"   # high confidence it's DIFFERENT

    logger.info(
        "speaker-verify customer=%s sim=%.3f is_same=%s confidence=%s",
        customer_id, sim, is_same, confidence
    )

    return {
        "status": "verified",
        "similarity": round(sim, 4),
        "is_same_speaker": is_same,
        "confidence": confidence,
    }
