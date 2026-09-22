"""Audio conversion and channel extraction."""

import io
import struct
import wave
import numpy as np

SAMPLE_RATE = 8000


def wav_bytes_to_numpy(wav_bytes: bytes, channel: int = 0) -> tuple[np.ndarray, int]:
    """Read WAV bytes and return (samples_float32, sample_rate) for a single channel."""
    with wave.open(io.BytesIO(wav_bytes)) as wf:
        n_channels = wf.getnchannels()
        sr = wf.getframerate()
        sampwidth = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    dtype = np.int16 if sampwidth == 2 else np.int32
    samples = np.frombuffer(raw, dtype=dtype)

    if n_channels > 1:
        samples = samples.reshape(-1, n_channels)[:, min(channel, n_channels - 1)]

    return samples.astype(np.float32) / 32768.0, sr


def extract_customer_channel(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    """Extract channel 0 (customer/inbound) from the stereo bridge recording."""
    return wav_bytes_to_numpy(wav_bytes, channel=0)


def extract_agent_channel(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    """Extract channel 1 (agent/outbound) from the stereo bridge recording."""
    return wav_bytes_to_numpy(wav_bytes, channel=1)


def has_background_voice(wav_bytes: bytes, threshold_ratio: float = 0.15) -> bool:
    """
    Simple energy-based background voice detection.
    Checks if the agent channel has significant energy during customer speaking segments.
    A second human speaker in the background would show up as energy on both channels simultaneously.
    """
    try:
        customer, sr = wav_bytes_to_numpy(wav_bytes, channel=0)
        agent, _ = wav_bytes_to_numpy(wav_bytes, channel=1)

        if len(customer) == 0 or len(agent) == 0:
            return False

        frame_size = sr // 10  # 100ms frames
        n_frames = min(len(customer), len(agent)) // frame_size

        simultaneous_count = 0
        agent_speaking_count = 0

        for i in range(n_frames):
            c_frame = customer[i * frame_size:(i + 1) * frame_size]
            a_frame = agent[i * frame_size:(i + 1) * frame_size]
            c_energy = float(np.sqrt(np.mean(c_frame ** 2)))
            a_energy = float(np.sqrt(np.mean(a_frame ** 2)))

            # Agent is actively speaking (outbound audio present)
            if a_energy > 0.01:
                agent_speaking_count += 1
                # Customer channel also has significant energy while agent speaks → background voice
                if c_energy > 0.005:
                    simultaneous_count += 1

        if agent_speaking_count == 0:
            return False

        return (simultaneous_count / agent_speaking_count) > threshold_ratio

    except Exception:
        return False
