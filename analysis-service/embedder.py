"""
ECAPA-TDNN speaker embeddings via SpeechBrain spkrec-ecapa-voxceleb.

Upgrade from x-vector (EER 3.2%) → ECAPA-TDNN (EER 0.80%) — 4x better discrimination.

Model: speechbrain/spkrec-ecapa-voxceleb (ECAPA-TDNN, 192-dim embeddings)
Input: 16kHz mono float32
Output: 192-dim L2-normalised numpy vector
"""

import logging
import numpy as np
import torch
import torchaudio

logger = logging.getLogger(__name__)

MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_DIR = "pretrained_models/spkrec-ecapa-voxceleb"
TARGET_SR = 16000

_classifier = None


def load_model():
    global _classifier
    if _classifier is not None:
        return _classifier
    logger.info("Loading ECAPA-TDNN model from %s", MODEL_SOURCE)
    from speechbrain.inference.speaker import EncoderClassifier
    _classifier = EncoderClassifier.from_hparams(
        source=MODEL_SOURCE,
        savedir=MODEL_DIR,
        run_opts={"device": "cpu"},
    )
    logger.info("ECAPA-TDNN model loaded")
    return _classifier


def get_embedding(samples: np.ndarray, sr: int) -> np.ndarray:
    """
    Extract a 192-dim ECAPA-TDNN embedding from audio samples.
    samples: float32 numpy array, any sample rate, mono
    Returns: L2-normalised 192-dim numpy float32 vector
    """
    classifier = load_model()

    waveform = torch.from_numpy(samples).float().unsqueeze(0)  # [1, time]
    if sr != TARGET_SR:
        resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=TARGET_SR)
        waveform = resampler(waveform)

    with torch.no_grad():
        embeddings = classifier.encode_batch(waveform)  # [1, 1, 192]

    vec = embeddings.squeeze().numpy()  # [192]

    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalised x-vectors."""
    return float(np.dot(a, b))
