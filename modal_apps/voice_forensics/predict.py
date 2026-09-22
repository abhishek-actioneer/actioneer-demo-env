from __future__ import annotations

import base64
import os
import sys
import wave
from pathlib import Path
from typing import Any


class BasePredictor:
    pass


def Input(default: Any = None, description: str = "") -> Any:
    return default


THRESHOLD = 0.5
INVENTORY = {
    "gender": [
        ("titanet-gender-dec-pooling", "TitaNet gender head (dec_pooling)"),
        ("titanet-age-gender-independent-fusion", "TitaNet age+gender independent heads (fusion)"),
        ("titanet-age-gender-mmoe", "TitaNet age+gender MMoE head"),
    ],
    "la": [
        ("aasist-la-base", "AASIST LA base"),
        ("aasist-la-phone-vendor", "AASIST LA phone+vendor fine-tuned"),
        ("titanet-la-dec-pooling", "TitaNet LA head (dec_pooling)"),
        ("titanet-la-enc-block4-stats", "TitaNet LA head (enc_block4_stats)"),
        ("titanet-la-fusion", "TitaNet LA head (fusion)"),
    ],
    "pa": [
        ("titanet-pa-dec-pooling", "TitaNet PA head (dec_pooling)"),
        ("titanet-pa-enc-block4-stats", "TitaNet PA head (enc_block4_stats)"),
        ("titanet-pa-fusion", "TitaNet PA head (fusion)"),
        ("rawnet2-pa-base", "RawNet2 PA base"),
        ("rawnet2-pa-finetuned", "RawNet2 PA fine-tuned"),
    ],
}


class Predictor(BasePredictor):
    def setup(self) -> None:
        self.root = Path(os.environ.get("VOICE_CM_ROOT", Path(__file__).parent / "weights" / "voice-cm")).expanduser()
        # Weight profile: "phone" (default, mixed 8/16kHz training) or "plivo8k"
        # (retrained on 8kHz G.711 μ-law only, matching Plivo). Only the weight
        # PATHS differ; the scorer code + response schema are identical.
        self.plivo = os.environ.get("VOICE_FORENSICS_WEIGHT_PROFILE", "phone") == "plivo8k"
        self.scorers: dict[str, Any] = {}
        self.errors: dict[str, str] = {}
        self.titanet: SharedTitaNetFeatureExtractor | None = None
        self.biomarker_detail: str | None = None

        if not self.root.exists():
            detail = f"voice-cm bundle not found at {self.root}"
            for task in INVENTORY.values():
                for model_id, _ in task:
                    self.errors[model_id] = detail
            self.biomarker_detail = detail
            return

        sys.path.insert(0, str(self.root))
        self._load_non_titanet_models()
        self._load_titanet_backbone_and_heads()

    def predict(
        self,
        wav_base64: str = Input(description="Base64-encoded mono PCM WAV from the live-call bridge.", default=""),
        horizon_ms: int = Input(description="QA horizon in milliseconds: 500, 1000, 2000, or 5000.", default=5000),
        user_audio_ms: int = Input(description="Total user-side audio captured by the bridge.", default=5000),
        call_id: str = Input(description="Call id for audit/enrollment metadata.", default=""),
        phone: str = Input(description="Customer phone for biomarker lookup metadata.", default=""),
        name: str = Input(description="Customer/person name for biomarker lookup metadata.", default=""),
        user_id: str = Input(description="Business user/customer id for biomarker lookup metadata.", default=""),
        biomarker_id: str = Input(description="Stable id to save the TitaNet embedding under.", default=""),
        sample_rate: int = Input(description="Input WAV sample rate. The WAV header remains authoritative.", default=8000),
        dataset_id: str = Input(description="Dataset id for audit metadata.", default=""),
        campaign_id: str = Input(description="Campaign id for audit metadata.", default=""),
    ) -> dict[str, Any]:
        if not wav_base64:
            return self._unavailable_result(horizon_ms, user_audio_ms, "wav_base64 was empty")

        try:
            wav, sr = decode_wav_base64(wav_base64)
        except Exception as exc:
            return self._error_result(horizon_ms, user_audio_ms, f"audio decode failed: {exc}")
        if sr <= 0:
            sr = sample_rate

        gender = {"rows": self._score_task("gender", wav, sr)}
        la = {"rows": self._score_task("la", wav, sr)}
        pa = {"rows": self._score_task("pa", wav, sr)}
        biomarker = self._biomarker(
            wav,
            sr,
            call_id=call_id,
            phone=phone,
            name=name,
            user_id=user_id,
            biomarker_id=biomarker_id,
            dataset_id=dataset_id,
            campaign_id=campaign_id,
        )
        rows = [*gender["rows"], *la["rows"], *pa["rows"]]
        status = "ready" if any(row["status"] == "ready" for row in rows) or biomarker["embeddingSaved"] else (
            "error" if any(row["status"] == "error" for row in rows) else "unavailable"
        )
        return {
            "status": status,
            "horizonMs": int(horizon_ms),
            "userAudioMs": int(user_audio_ms),
            "analyzedAudioMs": int(round(1000 * len(wav) / max(sr, 1))),
            "gender": gender,
            "la": la,
            "pa": pa,
            "biomarker": biomarker,
        }

    def _load_non_titanet_models(self) -> None:
        self._register("aasist-la-base", lambda: AASISTScorer(self.root / "external" / "aasist" / "models" / "weights" / "AASIST.pth"))
        aasist_ft = (
            self.root / "runs" / "aasist_plivo_v1_plus_vendor_a10g_bs16_lr5e5" / "best.pt"
            if self.plivo else
            self.root / "runs" / "best_la_aasist_phone_plus_vendor_v1" /
            "aasist_phone_v1_plus_vendor_a10g_bs16_lr5e5" / "best.pt"
        )
        self._register("aasist-la-phone-vendor", lambda: AASISTScorer(aasist_ft))
        self._register("rawnet2-pa-base", lambda: RawNet2Scorer(None))
        rawnet2_ft = (
            self.root / "runs" / "rawnet2_pa_finetune_plivo_v1" / "best.pt"
            if self.plivo else
            self.root / "runs" / "rawnet2_pa_finetune_v1" / "best.pt"
        )
        self._register("rawnet2-pa-finetuned", lambda: RawNet2Scorer(rawnet2_ft))

    def _load_titanet_backbone_and_heads(self) -> None:
        titanet_ids = [model_id for task in ("gender", "la", "pa") for model_id, _ in INVENTORY[task] if model_id.startswith("titanet")]
        try:
            self.titanet = SharedTitaNetFeatureExtractor(self.root)
        except Exception as exc:
            detail = f"TitaNet backbone unavailable: {exc}"
            for model_id in titanet_ids:
                self.errors[model_id] = detail
            self.biomarker_detail = detail
            return

        gender_dec = (
            self.root / "runs" / "titanet_gender_dec_pooling_v1" /
            "titanet_gender_dec_pooling_plivo_v1" / "best.pt"
            if self.plivo else
            self.root / "runs" / "titanet_gender_dec_pooling_v1" /
            "titanet_gender_dec_pooling_phone_full_v1" / "best.pt"
        )
        self._register(
            "titanet-gender-dec-pooling",
            lambda: TitaNetGenderOnlyScorer(self.titanet, gender_dec),
        )
        age_gender_fusion = (
            self.root / "runs" / "titanet_age_gender_fusion_heads_v1" /
            "titanet_age_gender_independent_plivo_v1" / "best.pt"
            if self.plivo else
            self.root / "runs" / "titanet_age_gender_fusion_heads_v1" /
            "titanet_age_gender_fusion_heads_v1" / "best.pt"
        )
        self._register(
            "titanet-age-gender-independent-fusion",
            lambda: TitaNetAgeGenderScorer(self.titanet, age_gender_fusion),
        )
        # MMoE has no 8kHz retrain yet — keep the existing weights in both profiles.
        self._register(
            "titanet-age-gender-mmoe",
            lambda: TitaNetAgeGenderScorer(
                self.titanet,
                self.root / "runs" / "titanet_age_gender_mmoe_v1" /
                "titanet_age_gender_mmoe_probe_v1" / "best.pt",
            ),
        )
        for variant in ("dec_pooling", "enc_block4_stats", "fusion"):
            suffix = variant.replace("_", "-")
            la_path = (
                self.root / "runs" / "titanet_la_heads_v1" /
                "titanet_la_heads_plivo_plus_vendor_v1" / variant / "best.pt"
                if self.plivo else
                self.root / "runs" / "best_la_titanet_heads_v1" / variant / "best.pt"
            )
            self._register(
                f"titanet-la-{suffix}",
                lambda path=la_path: TitaNetBinaryHeadScorer(self.titanet, path, "la"),
            )
            pa_path = (
                self.root / "runs" / "titanet_pa_heads_v1" /
                "titanet_pa_heads_rirplay_plivo_v1" / variant / "best.pt"
                if self.plivo else
                self.root / "runs" / "titanet_pa_heads_v1" /
                "titanet_pa_heads_rirplay_phone_v1" / variant / "best.pt"
            )
            self._register(
                f"titanet-pa-{suffix}",
                lambda path=pa_path: TitaNetBinaryHeadScorer(self.titanet, path, "pa"),
            )

    def _register(self, model_id: str, factory: Any) -> None:
        try:
            self.scorers[model_id] = factory()
        except Exception as exc:
            self.errors[model_id] = str(exc)

    def _score_task(self, task: str, wav: Any, sr: int) -> list[dict[str, Any]]:
        rows = []
        for model_id, model_name in INVENTORY[task]:
            scorer = self.scorers.get(model_id)
            if scorer is None:
                rows.append(model_row(model_id, model_name, None, None, self.errors.get(model_id, "model unavailable"), "unavailable"))
                continue
            try:
                # Age+gender models expose both heads via score_full().
                if task == "gender" and hasattr(scorer, "score_full"):
                    full = scorer.score_full(wav, sr)
                    score = float(full["gender"])
                    p_adult = float(full["age"])
                    age_native = float(getattr(scorer, "age_native_threshold", THRESHOLD))
                    age = {
                        "score": p_adult,
                        "verdict": _age_verdict(p_adult, THRESHOLD),
                        "threshold": THRESHOLD,
                        "nativeThreshold": age_native,
                        "nativeVerdict": _age_verdict(p_adult, age_native),
                    }
                else:
                    score = float(scorer.score(wav, sr))
                    age = None

                native = float(getattr(scorer, "native_threshold", THRESHOLD))
                rows.append(model_row(
                    model_id, model_name, score, _task_verdict(task, score, THRESHOLD), None, "ready",
                    native_threshold=native,
                    native_verdict=_task_verdict(task, score, native),
                    age=age,
                ))
            except Exception as exc:
                rows.append(model_row(model_id, model_name, None, None, str(exc), "error"))
        return rows

    def _biomarker(self, wav: Any, sr: int, **meta: str) -> dict[str, Any]:
        if self.titanet is None:
            return {
                "embeddingSaved": False,
                "modelId": "titanet-large",
                "matches": [],
                "detail": self.biomarker_detail or "TitaNet backbone unavailable",
            }
        try:
            embedding = self.titanet.embedding(wav, sr)
            # Pure embedder: return the raw 192-d L2-normalized vector. Enrollment
            # and cosine matching are done downstream in the app's local DuckDB
            # gallery (bucketed per horizon, self excluded) — the model never
            # stores or compares embeddings on the Modal volume.
            return {
                "embeddingSaved": True,
                "modelId": "titanet-large",
                "embedding": [float(x) for x in embedding.tolist()],
                "matches": [],
            }
        except Exception as exc:
            return {
                "embeddingSaved": False,
                "modelId": "titanet-large",
                "matches": [],
                "detail": str(exc),
            }

    def _unavailable_result(self, horizon_ms: int, user_audio_ms: int, detail: str) -> dict[str, Any]:
        return task_result("unavailable", horizon_ms, user_audio_ms, detail)

    def _error_result(self, horizon_ms: int, user_audio_ms: int, detail: str) -> dict[str, Any]:
        return task_result("error", horizon_ms, user_audio_ms, detail)


class AASISTScorer:
    def __init__(self, weights_path: Path) -> None:
        from tracks.aasist_pretrained import AASISTPretrained

        self.model = AASISTPretrained(weights_path=weights_path)

    def score(self, wav: Any, sr: int) -> float:
        return float(self.model.score(torch_waveform(wav, sr, 16000)))


class RawNet2Scorer:
    def __init__(self, checkpoint: Path | None) -> None:
        from tracks.pa_rawnet2 import RawNet2PA

        self.model = RawNet2PA(checkpoint=checkpoint)

    def score(self, wav: Any, sr: int) -> float:
        return float(self.model.score(torch_waveform(wav, sr, sr), sr=sr))


class SharedTitaNetFeatureExtractor:
    """One frozen TitaNet-Large backbone shared by every local TitaNet head."""

    def __init__(self, root: Path) -> None:
        import torch
        import nemo.collections.asr as nemo_asr

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        nemo_path = first_existing([
            *sorted(root.rglob("speakerverification_en_titanet_large.nemo")),
            Path.home() / ".cache" / "huggingface" / "hub" / "models--nvidia--speakerverification_en_titanet_large" /
            "snapshots" / "0dc382f40121a5fbd34db10a2bb04d826c2be6a8" / "speakerverification_en_titanet_large.nemo",
        ])
        if nemo_path:
            self.model = nemo_asr.models.EncDecSpeakerLabelModel.restore_from(
                restore_path=str(nemo_path),
                map_location=torch.device(self.device),
            )
        else:
            self.model = nemo_asr.models.EncDecSpeakerLabelModel.from_pretrained(
                "nvidia/speakerverification_en_titanet_large"
            )
        self.model = self.model.to(self.device).eval()

    def features(self, wav: Any, sr: int) -> dict[str, Any]:
        torch = self.torch
        sig = torch_waveform(wav, sr, 16000).unsqueeze(0).to(self.device)
        length = torch.tensor([sig.shape[-1]], device=self.device)
        acts: dict[str, Any] = {}

        def pool_hook(_module: Any, _inputs: Any, output: Any) -> None:
            acts["dec_pooling"] = flatten_pooling(output)

        def enc4_hook(_module: Any, _inputs: Any, output: Any) -> None:
            acts["enc_block4_stats"] = stats_pooling(output)

        handles = [
            self.model.encoder.encoder[4].register_forward_hook(enc4_hook),
            self.model.decoder._pooling.register_forward_hook(pool_hook),
        ]
        try:
            with torch.no_grad():
                self.model.forward(input_signal=sig, input_signal_length=length)
        finally:
            for handle in handles:
                handle.remove()
        return acts

    def embedding(self, wav: Any, sr: int) -> Any:
        torch = self.torch
        sig = torch_waveform(wav, sr, 16000).unsqueeze(0).to(self.device)
        length = torch.tensor([sig.shape[-1]], device=self.device)
        with torch.no_grad():
            output = self.model.forward(input_signal=sig, input_signal_length=length)
        emb = output[1][0] if isinstance(output, (tuple, list)) and len(output) > 1 else output[0]
        emb = emb.detach().float().cpu().numpy()
        import numpy as np

        return (emb / (np.linalg.norm(emb) + 1e-9)).astype("float32")


class TitaNetGenderOnlyScorer:
    def __init__(self, extractor: SharedTitaNetFeatureExtractor, checkpoint: Path) -> None:
        import numpy as np
        import torch
        from models.titanet_gender import TitaNetGenderHead

        self.extractor = extractor
        self.device = extractor.device
        ckpt = torch.load(checkpoint, map_location=self.device, weights_only=False)
        self.mean = torch.from_numpy(np.asarray(ckpt["feature_mean"], dtype=np.float32)).to(self.device)
        self.std = torch.from_numpy(np.asarray(ckpt["feature_std"], dtype=np.float32)).to(self.device).clamp_min(1e-6)
        self.head = TitaNetGenderHead(
            input_dim=int(ckpt.get("input_dim", 6144)),
            hidden_dim=int(ckpt.get("hidden_dim", 0)),
            dropout=float(ckpt.get("dropout", 0.1)),
        ).to(self.device).eval()
        self.head.load_state_dict(ckpt["model_state_dict"])
        # Gender-only head ships no calibrated operating point → native == 0.5.
        self.native_threshold = float(ckpt.get("dev_threshold", THRESHOLD))

    def score(self, wav: Any, sr: int) -> float:
        import torch

        feat = self.extractor.features(wav, sr)["dec_pooling"].to(self.device)
        with torch.no_grad():
            logit = self.head((feat - self.mean) / self.std).reshape(())
        return float(torch.sigmoid(logit).detach().cpu())


class TitaNetAgeGenderScorer:
    def __init__(self, extractor: SharedTitaNetFeatureExtractor, checkpoint: Path) -> None:
        import numpy as np
        import torch
        from models.titanet_age_gender import TitaNetAgeGenderIndependentHeads, TitaNetAgeGenderMMoE

        self.extractor = extractor
        self.device = extractor.device
        ckpt = torch.load(checkpoint, map_location=self.device, weights_only=False)
        self.feature_keys = list(ckpt.get("feature_keys", ["dec_pooling"]))
        self.mean = torch.from_numpy(np.asarray(ckpt["feature_mean"], dtype=np.float32)).to(self.device)
        self.std = torch.from_numpy(np.asarray(ckpt["feature_std"], dtype=np.float32)).to(self.device).clamp_min(1e-6)
        if ckpt.get("architecture") == "independent_heads":
            self.model = TitaNetAgeGenderIndependentHeads(
                input_dim=int(ckpt["input_dim"]),
                head_hidden=int(ckpt.get("head_hidden", 512)),
                head_dim=int(ckpt.get("head_dim", 256)),
                dropout=float(ckpt.get("dropout", 0.35)),
            )
        else:
            self.model = TitaNetAgeGenderMMoE(
                input_dim=int(ckpt.get("input_dim", 6144)),
                num_experts=int(ckpt.get("num_experts", 4)),
                expert_hidden=int(ckpt.get("expert_hidden", 512)),
                expert_dim=int(ckpt.get("expert_dim", 256)),
                dropout=float(ckpt.get("dropout", 0.2)),
            )
        self.model = self.model.to(self.device).eval()
        self.model.load_state_dict(ckpt["model_state_dict"])
        # Calibrated operating points saved at train time. gender_label_map is
        # {female:0, male:1}; age_label_map is {child:0, adult:1}.
        self.native_threshold = float(ckpt.get("dev_gender_threshold", THRESHOLD))
        self.age_native_threshold = float(ckpt.get("dev_age_threshold", THRESHOLD))

    def score(self, wav: Any, sr: int) -> float:
        return self.score_full(wav, sr)["gender"]

    def score_full(self, wav: Any, sr: int) -> dict[str, float]:
        """Return P(male) and P(adult) from the two softmax heads."""
        import torch

        feat = select_titanet_feature(self.extractor.features(wav, sr), self.feature_keys).to(self.device)
        with torch.no_grad():
            out = self.model((feat - self.mean) / self.std)
            gender_probs = torch.softmax(out["gender_logits"], dim=-1)[0]
            age_probs = torch.softmax(out["age_logits"], dim=-1)[0]
        return {
            "gender": float(gender_probs[1].detach().cpu()),  # P(male)
            "age": float(age_probs[1].detach().cpu()),        # P(adult)
        }


class TitaNetBinaryHeadScorer:
    def __init__(self, extractor: SharedTitaNetFeatureExtractor, checkpoint: Path, task: str) -> None:
        import numpy as np
        import torch

        if task == "la":
            from models.titanet_la import TitaNetLAHead as Head
        else:
            from models.titanet_pa import TitaNetPAHead as Head
        self.extractor = extractor
        self.device = extractor.device
        ckpt = torch.load(checkpoint, map_location=self.device, weights_only=False)
        self.feature_keys = list(ckpt.get("feature_keys", [ckpt.get("variant", "fusion")]))
        self.mean = torch.from_numpy(np.asarray(ckpt["feature_mean"], dtype=np.float32)).to(self.device)
        self.std = torch.from_numpy(np.asarray(ckpt["feature_std"], dtype=np.float32)).to(self.device).clamp_min(1e-6)
        self.head = Head(
            input_dim=int(ckpt["input_dim"]),
            hidden_dim=int(ckpt.get("hidden_dim", 512)),
            dropout=float(ckpt.get("dropout", 0.2)),
        ).to(self.device).eval()
        self.head.load_state_dict(ckpt["model_state_dict"])
        # Calibrated (dev-EER) operating point saved with the checkpoint.
        self.native_threshold = float(ckpt.get("dev_threshold", THRESHOLD))

    def score(self, wav: Any, sr: int) -> float:
        import torch

        feat = select_titanet_feature(self.extractor.features(wav, sr), self.feature_keys).to(self.device)
        with torch.no_grad():
            logit = self.head((feat - self.mean) / self.std).reshape(())
        return float(torch.sigmoid(logit).detach().cpu())


def decode_wav_base64(value: str) -> tuple[Any, int]:
    if "," in value[:64]:
        value = value.split(",", 1)[1]
    payload = base64.b64decode(value)
    import io
    import numpy as np

    with wave.open(io.BytesIO(payload), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sr = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    if sample_width != 2:
        raise ValueError(f"expected 16-bit PCM WAV, got sample width {sample_width}")
    pcm = np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm.astype("float32"), int(sr)


def torch_waveform(wav: Any, sr: int, target_sr: int) -> Any:
    import torch

    x = torch.from_numpy(wav).float() if not torch.is_tensor(wav) else wav.detach().float().cpu()
    if sr != target_sr:
        import torchaudio

        x = torchaudio.functional.resample(x, sr, target_sr)
    return x.reshape(-1)


def tensor_from_hook_output(output: Any) -> Any:
    import torch

    out = output[0] if isinstance(output, (tuple, list)) else output
    if isinstance(out, (tuple, list)):
        out = out[-1]
    if not torch.is_tensor(out):
        raise TypeError(f"unsupported TitaNet hook output: {type(out)!r}")
    return out


def flatten_pooling(output: Any) -> Any:
    out = tensor_from_hook_output(output)
    if out.ndim == 3 and out.shape[-1] == 1:
        out = out[:, :, 0]
    elif out.ndim > 2:
        out = out.flatten(start_dim=1)
    return out.detach().float()


def stats_pooling(output: Any) -> Any:
    import torch

    out = tensor_from_hook_output(output)
    if out.ndim == 3:
        mean = out.mean(dim=-1)
        std = out.std(dim=-1, unbiased=False)
        out = torch.cat([mean, std], dim=-1)
    elif out.ndim != 2:
        out = out.reshape(out.shape[0], -1)
    return out.detach().float()


def select_titanet_feature(features: dict[str, Any], keys: list[str]) -> Any:
    import torch

    parts = []
    for key in keys:
        feat = features.get(key)
        if feat is None:
            raise RuntimeError(f"TitaNet hook did not produce feature {key!r}")
        parts.append(feat)
    return parts[0] if len(parts) == 1 else torch.cat(parts, dim=1)


def _task_verdict(task: str, score: float, threshold: float) -> str:
    if task == "gender":
        return "male" if score >= threshold else "female"
    if task == "pa":
        return "replay" if score >= threshold else "bonafide"
    return "spoof" if score >= threshold else "bonafide"  # la


def _age_verdict(p_adult: float, threshold: float) -> str:
    return "adult" if p_adult >= threshold else "child"


def model_row(
    model_id: str,
    model_name: str,
    score: float | None,
    verdict: str | None,
    detail: str | None,
    status: str,
    *,
    native_threshold: float | None = None,
    native_verdict: str | None = None,
    age: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "modelId": model_id,
        "modelName": model_name,
        "score": None if score is None else max(0.0, min(1.0, float(score))),
        "verdict": verdict,
        "threshold": THRESHOLD,
        "nativeThreshold": None if native_threshold is None else float(native_threshold),
        "nativeVerdict": native_verdict,
        "status": status,
    }
    if age is not None:
        row["age"] = age
    if detail:
        row["detail"] = detail
    return row


def task_result(status: str, horizon_ms: int, user_audio_ms: int, detail: str) -> dict[str, Any]:
    return {
        "status": status,
        "horizonMs": int(horizon_ms),
        "userAudioMs": int(user_audio_ms),
        "analyzedAudioMs": 0,
        "gender": {"rows": unavailable_rows("gender", detail, status)},
        "la": {"rows": unavailable_rows("la", detail, status)},
        "pa": {"rows": unavailable_rows("pa", detail, status)},
        "biomarker": {
            "embeddingSaved": False,
            "modelId": "titanet-large",
            "matches": [],
            "detail": detail,
        },
        **({"error": detail} if status == "error" else {}),
    }


def unavailable_rows(task: str, detail: str, status: str = "unavailable") -> list[dict[str, Any]]:
    return [
        model_row(model_id, model_name, None, None, detail, "error" if status == "error" else "unavailable")
        for model_id, model_name in INVENTORY[task]
    ]


def first_existing(paths: list[Path]) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None

