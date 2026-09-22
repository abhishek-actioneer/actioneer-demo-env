import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "voice_forensics"))

from predict import INVENTORY, Predictor  # noqa: E402


class VoiceForensicsSchemaTest(unittest.TestCase):
    def test_unavailable_schema_without_weights(self) -> None:
        predictor = Predictor()
        predictor.setup()

        result = predictor.predict(wav_base64="", horizon_ms=500, user_audio_ms=320)

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["horizonMs"], 500)
        self.assertEqual(result["userAudioMs"], 320)
        for task in ("gender", "la", "pa"):
            rows = result[task]["rows"]
            self.assertEqual(len(rows), len(INVENTORY[task]))
            self.assertTrue(all(row["score"] is None for row in rows))
            self.assertTrue(all(row["status"] == "unavailable" for row in rows))
        self.assertEqual(result["biomarker"]["matches"], [])


if __name__ == "__main__":
    unittest.main()
