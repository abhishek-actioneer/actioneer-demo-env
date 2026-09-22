from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from typing import Any

try:
    from fastapi import Header, HTTPException
except Exception:
    def Header(default: Any = None, **_kwargs: Any) -> Any:
        return default

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str) -> None:
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

try:
    import modal
except Exception:
    modal = None  # type: ignore[assignment]


def _modal_stub() -> Any:
    class _Chain:
        def __getattr__(self, _name: str) -> Any:
            return self

        def __call__(self, *args: Any, **kwargs: Any) -> Any:
            return self

        def __enter__(self) -> "_Chain":
            return self

        def __exit__(self, *args: Any) -> bool:
            return False

    class _Volume:
        @staticmethod
        def from_name(*args: Any, **kwargs: Any) -> "_Volume":
            return _Volume()

        def reload(self) -> None:
            return None

        def commit(self) -> None:
            return None

    class _Secret:
        @staticmethod
        def from_local_environ(*args: Any, **kwargs: Any) -> object:
            return object()

    class _App:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def cls(self, *args: Any, **kwargs: Any) -> Any:
            def decorator(cls: type[Any]) -> type[Any]:
                return cls

            return decorator

    class _Modal:
        App = _App
        Image = type("Image", (), {"debian_slim": staticmethod(lambda *args, **kwargs: _Chain())})
        Secret = _Secret
        Volume = _Volume

        @staticmethod
        def enter(*args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                return fn

            return decorator

        @staticmethod
        def fastapi_endpoint(*args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                return fn

            return decorator

    return _Modal()


# App name + weight profile are env-driven so the SAME file deploys either the
# default 16kHz endpoint or a separate 8kHz-retrained one, sharing the volume:
#   default:  modal deploy modal_apps/voice_forensics_app.py
#   8k:       VOICE_FORENSICS_APP_NAME=baby-sentinel-voice-forensics-8k \
#             VOICE_FORENSICS_WEIGHT_PROFILE=plivo8k modal deploy modal_apps/voice_forensics_app.py
APP_NAME = os.environ.get("VOICE_FORENSICS_APP_NAME", "baby-sentinel-voice-forensics")
WEIGHT_PROFILE = os.environ.get("VOICE_FORENSICS_WEIGHT_PROFILE", "phone")
VOLUME_NAME = "baby-sentinel-voice-forensics-weights"
VOLUME_MOUNT_PATH = Path("/mnt/voice-forensics")
VOICE_CM_ROOT = VOLUME_MOUNT_PATH / "voice-cm"
BIOMARKER_ROOT = VOLUME_MOUNT_PATH / "biomarkers"
PREDICTOR_ROOT = Path("/app/voice-forensics")
PREDICTOR_FILE = PREDICTOR_ROOT / "predict.py"


if modal is None:
    modal = _modal_stub()  # type: ignore[assignment]


voice_forensics_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1", "sox")
    .uv_pip_install(
        "fastapi[standard]",
        "torch==2.5.1",
        "torchaudio==2.5.1",
        "numpy==1.26.4",
        "soundfile==0.12.1",
        "PyYAML==6.0.2",
        "transformers==4.48.3",
        "huggingface-hub==0.27.1",
        "nemo_toolkit[asr]==2.1.0",
    )
    .env({
        "VOICE_CM_ROOT": str(VOICE_CM_ROOT),
        "VOICE_FORENSICS_BIOMARKER_DIR": str(BIOMARKER_ROOT),
        "VOICE_FORENSICS_WEIGHT_PROFILE": WEIGHT_PROFILE,
    })
    .add_local_dir(
        "modal_apps/voice_forensics",
        remote_path=str(PREDICTOR_ROOT),
        ignore=[
            "tests/**",
            "weights/**",
            "__pycache__/**",
            "*.pyc",
        ],
    )
)

app = modal.App(APP_NAME, image=image)


def modal_auth_secrets() -> list[Any]:
    token = local_env_value("VOICE_FORENSICS_MODAL_TOKEN")
    if not token:
        return []
    os.environ["VOICE_FORENSICS_MODAL_TOKEN"] = token
    return [modal.Secret.from_local_environ(["VOICE_FORENSICS_MODAL_TOKEN"])]


def local_env_value(key: str) -> str | None:
    value = os.environ.get(key)
    if value:
        return value
    for env_file in (Path(".env.local"), Path(".env")):
        parsed = dotenv_value(env_file, key)
        if parsed:
            return parsed
    return None


def dotenv_value(path: Path, key: str) -> str | None:
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return None
    prefix = f"{key}="
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or not stripped.startswith(prefix):
            continue
        value = stripped[len(prefix):].strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        return value or None
    return None


@app.cls(
    gpu="T4",
    timeout=180,
    scaledown_window=300,
    max_containers=1,
    volumes={str(VOLUME_MOUNT_PATH): voice_forensics_volume},
    secrets=modal_auth_secrets(),
)
class VoiceForensics:
    @modal.enter()
    def load(self) -> None:
        try:
            voice_forensics_volume.reload()
        except Exception as exc:
            print(f"[voice-forensics] volume reload skipped: {exc}")

        predictor_cls = load_predictor_class()
        self.predictor = predictor_cls()
        self.predictor.setup()

    @modal.fastapi_endpoint(method="POST", docs=True)
    def infer(
        self,
        payload: dict[str, Any],
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        enforce_auth(authorization, payload.get("_auth_token"))
        result = self.predictor.predict(**predict_kwargs_from_payload(payload))
        if embedding_was_saved(result):
            commit_biomarker_write(result)
        return result


def load_predictor_class() -> type[Any]:
    predictor_path = Path(os.environ.get("VOICE_FORENSICS_PREDICTOR_FILE", str(PREDICTOR_FILE)))
    if not predictor_path.exists():
        raise FileNotFoundError(f"voice-forensics predictor not found at {predictor_path}")

    module_name = "baby_sentinel_voice_forensics_predictor"
    spec = importlib.util.spec_from_file_location(module_name, predictor_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not import voice-forensics predictor from {predictor_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module.Predictor


def predict_kwargs_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "wav_base64": string_value(payload.get("wav_base64")),
        "horizon_ms": int_value(payload.get("horizon_ms"), 5000),
        "user_audio_ms": int_value(payload.get("user_audio_ms"), 5000),
        "call_id": string_value(payload.get("call_id")),
        "phone": string_value(payload.get("phone")),
        "name": string_value(payload.get("name")),
        "user_id": string_value(payload.get("user_id")),
        "biomarker_id": string_value(payload.get("biomarker_id")),
        "sample_rate": int_value(payload.get("sample_rate"), 8000),
        "dataset_id": string_value(payload.get("dataset_id")),
        "campaign_id": string_value(payload.get("campaign_id")),
    }


def enforce_auth(authorization: str | None, body_token: Any = None) -> None:
    expected = os.environ.get("VOICE_FORENSICS_MODAL_TOKEN", "").strip()
    if not expected:
        return
    scheme, _, token = (authorization or "").partition(" ")
    if (scheme.lower() == "bearer" and token == expected) or string_value(body_token) == expected:
        return
    else:
        raise HTTPException(status_code=401, detail="unauthorized")


def embedding_was_saved(result: dict[str, Any]) -> bool:
    biomarker = result.get("biomarker")
    return isinstance(biomarker, dict) and bool(biomarker.get("embeddingSaved") or biomarker.get("embedding_saved"))


def commit_biomarker_write(result: dict[str, Any]) -> None:
    try:
        voice_forensics_volume.commit()
    except Exception as exc:
        biomarker = result.setdefault("biomarker", {})
        if isinstance(biomarker, dict):
            detail = biomarker.get("detail")
            suffix = f"Modal Volume commit failed: {exc}"
            biomarker["detail"] = f"{detail}; {suffix}" if detail else suffix


def int_value(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def string_value(value: Any) -> str:
    return "" if value is None else str(value)
