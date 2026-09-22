# Voice biometric demo: local test

The operator page is `/voice-biometric-demo`. It uses the `hdfc-creditfraud` dataset scope, synthetic banking profiles, and the Python ECAPA service in `analysis-service/`.

## Start locally

Install the repository dependencies if this checkout does not have them:

```bash
pnpm install
```

Prepare the Python service once:

```bash
python3 -m venv analysis-service/.venv
analysis-service/.venv/bin/pip install -r analysis-service/requirements.txt
```

Start the biometric service in one terminal:

```bash
cd analysis-service
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Start Actioneer in another terminal:

```bash
pnpm dev
```

Open `http://localhost:3000/voice-biometric-demo`, sign in, and:

1. Enter a synthetic subject ID and display name.
2. Record two separate enrollment samples of at least 5–8 seconds each, or upload two WAV files.
3. Enroll the speaker.
4. Record a fresh test sample and select **Identify speaker**.
5. Confirm that an unenrolled person returns `unknown` rather than another person's profile.

The first model load downloads the pinned SpeechBrain model if it is not already cached and can take several minutes. The page does not auto-enroll recognition samples.

## Enable the existing inbound number

Configure these variables on the existing Actioneer host:

```bash
VOICE_BIOMETRIC_DEMO_ENABLED=true
VOICE_BIOMETRIC_INBOUND_NUMBER=+91...
VOICE_BIOMETRIC_OWNER_USER_ID=user_...
VOICE_BIOMETRIC_DATASET_ID=hdfc-creditfraud
ANALYSIS_SERVICE_URL=http://<reachable-biometric-service>:8000
```

`VOICE_BIOMETRIC_OWNER_USER_ID` must be the same Clerk user that performed enrollment on the operator page. Restart the server after changing variables. The configured number will take the biometric route before ordinary inbound campaign routing.

The live sequence is consent → voiced sample → open-set match → randomized spoken challenge → second voice comparison → synthetic profile. Caller ID is retained as call metadata but is not used to select a gallery subject.

## Optional calibration controls

```bash
VOICE_BIOMETRIC_IDENTIFY_THRESHOLD=0.75
VOICE_BIOMETRIC_MARGIN_THRESHOLD=0.08
VOICE_BIOMETRIC_IDENTIFY_AUDIO_MS=6500
VOICE_BIOMETRIC_CHALLENGE_AUDIO_MS=3500
```

The defaults are initial demo values, not validated security thresholds. Calibrate them with separate development calls before presenting accuracy figures.
