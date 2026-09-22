"""
Fraud call stress classifier + weighted score fusion.

Stress class:
  0 = calm / genuine
  1 = mild stress / uncertain
  2 = high stress / coached / duress

Weighted fusion combines:
  - Acoustic stress signals (Layer 2c)
  - Speaker identity match (Layer 2a)
  - Transcript behavioral signals (Layer 4)
  - Transaction risk signals (Layer 1)
"""


def classify_stress(features: dict, transcript_features=None) -> dict:
    score = 0
    reasons = []

    jitter        = features.get("jitter")
    shimmer       = features.get("shimmer")
    hnr           = features.get("hnr")
    f0_variance   = features.get("f0_variance")
    speaking_rate = features.get("speaking_rate")
    background    = features.get("background_voice", False)
    spec_entropy  = features.get("spectral_entropy")
    spec_flux     = features.get("spectral_flux")

    tf = transcript_features or {}
    voice_onset_ms     = tf.get("voice_onset_ms")
    elaboration_ratio  = tf.get("elaboration_ratio")
    echo_score         = tf.get("echo_score")

    # Acoustic signals
    if jitter is not None and jitter > 0.04:
        score += 1; reasons.append(f"jitter_elevated ({jitter:.3f})")

    if shimmer is not None and shimmer > 0.20:
        score += 1; reasons.append(f"shimmer_elevated ({shimmer:.3f})")

    if hnr is not None and hnr < 8:
        score += 1; reasons.append(f"hnr_degraded ({hnr:.1f})")

    if f0_variance is not None and f0_variance < 15:
        score += 1; reasons.append(f"pitch_flat (var={f0_variance:.1f})")

    if speaking_rate is not None and speaking_rate < 1.5:
        score += 1; reasons.append(f"speaking_rate_slow ({speaking_rate:.2f})")

    if background:
        score += 2; reasons.append("background_voice_detected")

    if spec_entropy is not None and spec_entropy > 4.5:
        score += 1; reasons.append(f"spectral_entropy_high ({spec_entropy:.2f})")

    if spec_flux is not None and spec_flux > 15.0:
        score += 1; reasons.append(f"spectral_flux_elevated ({spec_flux:.2f})")

    # Transcript behavioral signals
    if voice_onset_ms is not None and voice_onset_ms > 800:
        score += 1; reasons.append(f"voice_onset_slow ({voice_onset_ms:.0f}ms)")

    if elaboration_ratio is not None and elaboration_ratio < 0.25:
        score += 1; reasons.append(f"elaboration_low ({elaboration_ratio:.2f})")

    if echo_score is not None and echo_score > 0.75:
        score += 1; reasons.append(f"echo_high ({echo_score:.2f})")

    # Max score is now 11 (added 3 new signals)
    stress_class = 2 if score >= 5 else (1 if score >= 2 else 0)

    return {
        "stress_class": stress_class,
        "stress_score": min(score / 11.0, 1.0),
        "rule_score": score,
        "reasons": reasons,
    }


def weighted_fraud_score(
    stress: dict,
    speaker: dict,
    transaction: dict,
) -> dict:
    """
    Combine all layers into a single fraud probability score (0-1).

    Weights calibrated from Palla 2025 (behavioral biometrics = 57% of advantage):
      Layer 2a — Speaker identity:   0.35
      Layer 2c — Acoustic stress:    0.25
      Layer 4  — Transcript signals: 0.25
      Layer 1  — Transaction risk:   0.15

    Returns:
      combined_score: float 0-1
      recommendation: "clear" | "escalate" | "block"
      breakdown: per-layer scores
    """
    # Layer 2a: speaker identity (0 = certain same, 1 = certain different)
    sim = speaker.get("similarity")
    if sim is not None:
        # Convert similarity to risk: high sim = low risk
        speaker_risk = max(0.0, 1.0 - sim)
        # Z-score adjustment if within_sim stats available
        # ECAPA-TDNN on 8kHz phone audio: within-speaker sim ≈ 0.87 mean, 0.04 std
        within_mean = speaker.get("within_sim_mean", 0.874)
        within_std  = speaker.get("within_sim_std", 0.040)
        if within_std and within_std > 0:
            z = (sim - within_mean) / within_std
            # z < -3 = 3 sigma below own mean = almost certainly different speaker
            speaker_risk = max(0.0, min(1.0, -z / 10.0))
    else:
        speaker_risk = 0.0  # no enrollment yet, neutral

    # Layer 2c: acoustic stress (already 0-1)
    stress_risk = stress.get("stress_score", 0.0)

    # Layer 4: transcript signals
    tf = stress.get("transcript_features", {}) if isinstance(stress.get("transcript_features"), dict) else {}
    voice_onset  = tf.get("voice_onset_ms", 0) or 0
    elaboration  = tf.get("elaboration_ratio", 1.0) or 1.0
    echo         = tf.get("echo_score", 0.0) or 0.0

    onset_risk    = min(1.0, max(0.0, (voice_onset - 400) / 2000))
    elab_risk     = min(1.0, max(0.0, (0.5 - elaboration) / 0.5))
    echo_risk     = min(1.0, echo)
    transcript_risk = (onset_risk + elab_risk + echo_risk) / 3.0

    # Layer 1: transaction signals
    deviation  = float(transaction.get("deviation_factor", 1.0) or 1.0)
    device_risk_score = float(transaction.get("device_risk_score", 0.0) or 0.0)
    geo_mismatch = float(bool(transaction.get("geo_mismatch", False)))
    rule_fp_rate = float(transaction.get("rule_fp_rate", 50.0) or 50.0)

    # deviation_factor: 1x = no risk, 20x = max risk
    dev_risk    = min(1.0, max(0.0, (deviation - 1.0) / 19.0))
    device_risk = min(1.0, device_risk_score / 1000.0)
    fp_risk     = 1.0 - (rule_fp_rate / 100.0)  # high FP rate = lower transaction risk
    txn_risk    = (dev_risk * 0.5 + device_risk * 0.3 + geo_mismatch * 0.1 + fp_risk * 0.1)

    # Weighted fusion
    combined = (
        0.35 * speaker_risk +
        0.25 * stress_risk +
        0.25 * transcript_risk +
        0.15 * txn_risk
    )

    # Hard overrides
    if sim is not None and sim < 0.60:
        combined = max(combined, 0.85)  # almost certain different speaker → block
    if stress.get("stress_class", 0) == 2 and (echo > 0.75 or voice_onset > 1200):
        combined = max(combined, 0.75)  # dual duress signal → escalate

    if combined >= 0.70:
        recommendation = "block"
    elif combined >= 0.45:
        recommendation = "escalate"
    else:
        recommendation = "clear"

    return {
        "combined_score": round(combined, 4),
        "recommendation": recommendation,
        "breakdown": {
            "speaker_identity": round(speaker_risk, 4),
            "acoustic_stress":  round(stress_risk, 4),
            "transcript":       round(transcript_risk, 4),
            "transaction":      round(txn_risk, 4),
        },
    }
