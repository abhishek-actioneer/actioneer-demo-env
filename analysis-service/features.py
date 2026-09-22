"""Acoustic feature extraction using parselmouth, librosa, and gammatone."""

import math
import numpy as np
import parselmouth
from parselmouth.praat import call
import librosa


def safe_float(v):
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def pre_emphasis(samples: np.ndarray, coeff: float = 0.97) -> np.ndarray:
    """Boost high frequencies degraded by phone codec."""
    return np.append(samples[0], samples[1:] - coeff * samples[:-1])


# ── Praat / parselmouth ───────────────────────────────────────────────────────

def extract_praat_features(samples: np.ndarray, sr: int) -> dict:
    snd = parselmouth.Sound(samples, sampling_frequency=float(sr))

    results = {
        "jitter": None, "shimmer": None, "hnr": None,
        "mean_f0": None, "f0_variance": None,
        "f1_mean": None, "f2_mean": None, "f3_mean": None, "f4_mean": None,
        "f1_std": None, "f2_std": None,
        "cpp": None,
    }

    # F0
    try:
        pitch = snd.to_pitch(time_step=0.01, pitch_floor=75.0, pitch_ceiling=500.0)
        f0_values = pitch.selected_array["frequency"]
        voiced = f0_values[f0_values > 0]
        if len(voiced) > 5:
            results["mean_f0"] = safe_float(np.mean(voiced))
            results["f0_variance"] = safe_float(np.var(voiced))
    except Exception:
        pass

    # Jitter
    try:
        pp = call(snd, "To PointProcess (periodic, cc)", 75, 500)
        results["jitter"] = safe_float(call(pp, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3))
    except Exception:
        pass

    # Shimmer
    try:
        pp = call(snd, "To PointProcess (periodic, cc)", 75, 500)
        results["shimmer"] = safe_float(call([snd, pp], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6))
    except Exception:
        pass

    # HNR
    try:
        harm = call(snd, "To Harmonicity (cc)", 0.01, 75, 0.1, 1.0)
        results["hnr"] = safe_float(call(harm, "Get mean", 0, 0))
    except Exception:
        pass

    # CPP — Cepstral Peak Prominence
    # Correlates with vocal effort, tension, and stress. Drops under coached/forced speech.
    try:
        pc = call(snd, "To PowerCepstrogram", 60.0, 0.002, 5000.0, 50.0)
        cpp = call(pc, "Get CPPS", "yes", 0.001, 0.05, 60.0, 330.0,
                   0.05, "Parabolic", 0.001, 0.0, "Exponential decay", "Robust")
        results["cpp"] = safe_float(cpp)
    except Exception:
        pass

    # Formants F1-F4 (vocal tract geometry — unclonable)
    try:
        ceiling = min(5000.0, sr / 2.0 * 0.95)
        formant = call(snd, "To Formant (burg)", 0.0, 4, ceiling, 0.025, 50.0)
        duration = snd.duration
        for fi, (mk, sk) in enumerate([("f1_mean","f1_std"),("f2_mean","f2_std"),
                                        ("f3_mean",None),("f4_mean",None)], start=1):
            times = np.arange(0.025, duration - 0.025, 0.01)
            vals = [v for t in times
                    if (v := safe_float(call(formant, "Get value at time", fi, t, "Hertz", "Linear")))
                    and v > 0]
            if vals:
                results[mk] = safe_float(np.mean(vals))
                if sk:
                    results[sk] = safe_float(np.std(vals))
    except Exception:
        pass

    return results


# ── Librosa ───────────────────────────────────────────────────────────────────

def extract_librosa_features(samples: np.ndarray, sr: int) -> dict:
    results = {
        "mfcc_1_13": None, "mfcc_delta_1_13": None, "mfcc_delta2_1_13": None,
        "speaking_rate": None, "spectral_entropy": None, "spectral_flux": None,
    }

    if len(samples) < sr * 0.5:
        return results

    try:
        s16 = librosa.resample(samples, orig_sr=sr, target_sr=16000) if sr != 16000 else samples
        mfccs = librosa.feature.mfcc(y=s16, sr=16000, n_mfcc=13)
        results["mfcc_1_13"] = mfccs.mean(axis=1).tolist()
        results["mfcc_delta_1_13"] = librosa.feature.delta(mfccs, order=1).mean(axis=1).tolist()
        results["mfcc_delta2_1_13"] = librosa.feature.delta(mfccs, order=2).mean(axis=1).tolist()
    except Exception:
        pass

    try:
        zcr = librosa.feature.zero_crossing_rate(samples)[0]
        peaks = np.where((zcr[1:-1] > zcr[:-2]) & (zcr[1:-1] > zcr[2:]) & (zcr[1:-1] > 0.1))[0]
        d = len(samples) / sr
        if d > 0:
            results["speaking_rate"] = float(len(peaks) / d)
    except Exception:
        pass

    try:
        stft = np.abs(librosa.stft(samples))
        p = stft ** 2
        pn = p / (p.sum(axis=0, keepdims=True) + 1e-10)
        results["spectral_entropy"] = safe_float(float((-np.sum(pn * np.log(pn + 1e-10), axis=0)).mean()))
    except Exception:
        pass

    try:
        stft = np.abs(librosa.stft(samples))
        results["spectral_flux"] = safe_float(float(np.sqrt(np.sum(np.diff(stft, axis=1) ** 2, axis=0)).mean()))
    except Exception:
        pass

    return results


# ── GFCC — Gammatone Frequency Cepstral Coefficients ─────────────────────────
# More robust than MFCC on telephone audio (8kHz mulaw, compression, packet loss)
# Mimics human auditory ERB filterbank rather than linear mel scale.

def extract_gfcc(samples: np.ndarray, sr: int, n_filters: int = 24, n_ceps: int = 13) -> list:
    """
    Compute GFCCs via an ERB-spaced gammatone filterbank.
    Falls back to None if gammatone package unavailable.
    """
    try:
        from gammatone.gtgram import gtgram
        s16 = librosa.resample(samples, orig_sr=sr, target_sr=16000) if sr != 16000 else samples
        # Gammatone gram: (n_filters, n_frames)
        gram = gtgram(s16, 16000, 0.025, 0.01, n_filters, 50.0)
        # Log compression then DCT → cepstral coefficients
        log_gram = np.log(gram + 1e-10)
        from scipy.fft import dct
        gfccs = dct(log_gram, type=2, axis=0, norm='ortho')[:n_ceps]
        return gfccs.mean(axis=1).tolist()
    except Exception:
        return []


# ── Pause analysis ────────────────────────────────────────────────────────────
# Pause frequency and duration within the customer's speech channel.
# Fraudsters: hesitate, consult scripts, wait for coaching → more/longer pauses.
# This signal is orthogonal to ECAPA — same voice, different behavior.

def extract_pause_features(samples: np.ndarray, sr: int,
                           frame_ms: int = 20,
                           silence_threshold: float = 0.008,
                           min_pause_ms: int = 150) -> dict:
    """
    Detect silence segments in customer audio channel.
    Returns pause_count, mean_pause_duration_ms, pause_ratio, max_pause_ms.
    """
    results = {
        "pause_count": None,
        "mean_pause_duration_ms": None,
        "pause_ratio": None,
        "max_pause_ms": None,
    }

    if len(samples) < sr * 0.5:
        return results

    frame_size = int(sr * frame_ms / 1000)
    n_frames = len(samples) // frame_size
    if n_frames == 0:
        return results

    # RMS energy per frame
    frames = samples[:n_frames * frame_size].reshape(n_frames, frame_size)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))

    # Detect silence frames
    is_silence = rms < silence_threshold

    # Group into pause segments
    pauses = []
    in_pause = False
    pause_start = 0
    for i, sil in enumerate(is_silence):
        if sil and not in_pause:
            in_pause = True
            pause_start = i
        elif not sil and in_pause:
            in_pause = False
            pause_len_ms = (i - pause_start) * frame_ms
            if pause_len_ms >= min_pause_ms:
                pauses.append(pause_len_ms)
    if in_pause:
        pause_len_ms = (n_frames - pause_start) * frame_ms
        if pause_len_ms >= min_pause_ms:
            pauses.append(pause_len_ms)

    total_ms = n_frames * frame_ms
    silence_ms = int(is_silence.sum()) * frame_ms

    results["pause_count"] = len(pauses)
    results["mean_pause_duration_ms"] = safe_float(float(np.mean(pauses))) if pauses else 0.0
    results["pause_ratio"] = safe_float(silence_ms / total_ms) if total_ms > 0 else None
    results["max_pause_ms"] = safe_float(float(max(pauses))) if pauses else 0.0

    return results


# ── Combined extractor ────────────────────────────────────────────────────────

def extract_all_features(samples: np.ndarray, sr: int) -> dict:
    """Run all extractors. Pre-emphasis applied first (telephone compensation)."""
    samples = pre_emphasis(samples)
    praat = extract_praat_features(samples, sr)
    lib = extract_librosa_features(samples, sr)
    gfcc = extract_gfcc(samples, sr)
    pause = extract_pause_features(samples, sr)
    return {
        **praat,
        **lib,
        "gfcc_1_13": gfcc if gfcc else None,
        **pause,
    }
