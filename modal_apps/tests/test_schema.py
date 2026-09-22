import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_PATH = ROOT / "modal_apps" / "voice_forensics_app.py"


def load_app_module():
    spec = importlib.util.spec_from_file_location("voice_forensics_app_test", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ModalVoiceForensicsSchemaTest(unittest.TestCase):
    def test_payload_maps_to_predictor_kwargs(self):
        module = load_app_module()

        kwargs = module.predict_kwargs_from_payload({
            "wav_base64": "abc",
            "sample_rate": "8000",
            "horizon_ms": "500",
            "user_audio_ms": "740",
            "call_id": "call-1",
            "phone": "+15551234567",
            "name": "Asha",
            "user_id": "user-1",
            "biomarker_id": "bio-1",
            "dataset_id": "hdfc-creditfraud",
            "campaign_id": "campaign-1",
        })

        self.assertEqual(kwargs["wav_base64"], "abc")
        self.assertEqual(kwargs["sample_rate"], 8000)
        self.assertEqual(kwargs["horizon_ms"], 500)
        self.assertEqual(kwargs["user_audio_ms"], 740)
        self.assertEqual(kwargs["call_id"], "call-1")
        self.assertEqual(kwargs["biomarker_id"], "bio-1")

    def test_modal_constants_match_volume_layout(self):
        module = load_app_module()

        self.assertEqual(module.APP_NAME, "baby-sentinel-voice-forensics")
        self.assertEqual(module.VOLUME_NAME, "baby-sentinel-voice-forensics-weights")
        self.assertEqual(str(module.VOICE_CM_ROOT), "/mnt/voice-forensics/voice-cm")
        self.assertEqual(str(module.BIOMARKER_ROOT), "/mnt/voice-forensics/biomarkers")

    def test_auth_is_only_enforced_when_token_is_set(self):
        module = load_app_module()

        module.os.environ.pop("VOICE_FORENSICS_MODAL_TOKEN", None)
        module.enforce_auth(None)

        module.os.environ["VOICE_FORENSICS_MODAL_TOKEN"] = "secret"
        module.enforce_auth("Bearer secret")
        module.enforce_auth(None, "secret")
        with self.assertRaises(Exception):
            module.enforce_auth("Bearer wrong")
        module.os.environ.pop("VOICE_FORENSICS_MODAL_TOKEN", None)


if __name__ == "__main__":
    unittest.main()
