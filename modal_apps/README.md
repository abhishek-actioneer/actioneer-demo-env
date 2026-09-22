# Baby Sentinel Voice Forensics on Modal

This Modal app serves the same voice-forensics contract used by the Next.js call
bridge. It loads one shared frozen TitaNet backbone plus separate downstream
heads for gender, LA, and PA. AASIST and RawNet2 remain separate scorers.

## Deploy

Run from the repository root:

```bash
modal volume create baby-sentinel-voice-forensics-weights
modal volume put baby-sentinel-voice-forensics-weights \
  /path/to/voice-cm \
  /voice-cm
modal deploy modal_apps/voice_forensics_app.py
```

Copy the deployed `infer` web URL into Railway/Next:

```bash
VOICE_FORENSICS_ENABLED=true
VOICE_FORENSICS_MODAL_URL=https://<workspace>--baby-sentinel-voice-forensics-voiceforensics-infer.modal.run
```

Optional bearer auth. Set the same token before `modal deploy` and in
Railway/Next:

```bash
export VOICE_FORENSICS_MODAL_TOKEN=<shared-token>
modal deploy modal_apps/voice_forensics_app.py

VOICE_FORENSICS_MODAL_TOKEN=<shared-token>
```

The deployed image packages `modal_apps/voice_forensics/predict.py`; model
weights stay outside git and are read from `/voice-cm` in the Modal Volume.
