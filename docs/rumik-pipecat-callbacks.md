# Rumik Pipecat Callback Contract

This is the demo integration contract for Rumik/Pipecat campaign calls and browser live tests.

All callback URLs accept either the shared secret as a query param:

```text
?secret=<RUMIK_PIPECAT_CALLBACK_SECRET>
```

or as one of these headers:

```text
x-rumik-secret: <RUMIK_PIPECAT_CALLBACK_SECRET>
x-partner-secret: <RUMIK_PIPECAT_CALLBACK_SECRET>
```

If `RUMIK_PIPECAT_CALLBACK_SECRET` is not set, callbacks are accepted without a secret. Production should set it.

Callback URLs may also include `campaignId`, `callId`, or `sessionId` query params. Rumik should preserve the full callback URL,
including query params. The app uses those query params as an ID fallback when the JSON body has empty or missing IDs.

Every JSON status/transcript callback is dumped before validation under:

```text
$VOICE_STORAGE_DIR/voice-callback-dumps/<endpoint>/*.json
```

On Railway, `VOICE_STORAGE_DIR` should be `/app/data`.

## Campaign Calls

Use the `campaignId` and `callId` from the Rumik start payload.

Local/ngrok demo URLs:

```text
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/status
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/transcript
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/recording
```

Production URLs:

```text
https://demo.actioneer.com/api/partner/pipecat/status
https://demo.actioneer.com/api/partner/pipecat/transcript
https://demo.actioneer.com/api/partner/pipecat/recording
```

The app also sends these in the campaign start payload:

```json
{
  "callbacks": {
    "statusUrl": "https://.../api/partner/pipecat/status",
    "transcriptUrl": "https://.../api/partner/pipecat/transcript",
    "recordingUploadUrl": "https://.../api/partner/pipecat/recording"
  }
}
```

### Status URL

POST lifecycle updates to `statusUrl`.

```json
{
  "campaignId": "vc_123",
  "callId": "vc_123_launch_0_abcd12",
  "status": "calling"
}
```

Supported status values:

```text
queued
calling
ringing
connected
in_progress
answered
completed
no_answer
busy
failed
canceled
cancelled
rejected
```

Final status example:

```json
{
  "campaignId": "vc_123",
  "callId": "vc_123_launch_0_abcd12",
  "status": "completed",
  "durationSeconds": 90,
  "outcome": {
    "answered": true,
    "engaged": true,
    "followUpRequested": false
  }
}
```

### Recording Upload URL

POST the audio file to `recordingUploadUrl` when Rumik needs us to store the recording in the Railway volume.

Preferred multipart request:

```bash
curl -X POST "https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/recording?secret=$RUMIK_PIPECAT_CALLBACK_SECRET" \
  -F "campaignId=vc_123" \
  -F "callId=vc_123_launch_0_abcd12" \
  -F "durationSeconds=90" \
  -F "file=@recording.mp3;type=audio/mpeg"
```

Successful response:

```json
{
  "ok": true,
  "recordingUrl": "https://.../api/voice/recordings/vc_123_launch_0_abcd12/rumik-vc_123_launch_0_abcd12?datasetId=fundsindia",
  "recordingSid": "rumik-vc_123_launch_0_abcd12",
  "storageKey": "vc_123_launch_0_abcd12/rumik-vc_123_launch_0_abcd12.mp3",
  "contentType": "audio/mpeg",
  "sizeBytes": 1234567
}
```

The app stores the file under:

```text
$VOICE_STORAGE_DIR/voice-recordings/<callId>/<recordingSid>.<ext>
```

On Railway, `VOICE_STORAGE_DIR` should be `/app/data`.

The upload endpoint also accepts:

- raw audio bytes with `campaignId` and `callId` in query params or `x-campaign-id` / `x-call-id` headers
- JSON `{ "campaignId": "...", "callId": "...", "recordingUrl": "https://..." }`
- JSON `{ "campaignId": "...", "callId": "...", "audioBase64": "..." }`

### Transcript URL

POST transcript data to `transcriptUrl`. If you uploaded the recording first, use the returned `recordingUrl` here.
If Rumik sends its own public `recordingUrl` in this payload, the app downloads that audio and persists it under
`$VOICE_STORAGE_DIR/voice-recordings/<callId>/<recordingSid>.<ext>` before returning success.

```json
{
  "campaignId": "vc_123",
  "callId": "vc_123_launch_0_abcd12",
  "recordingSid": "rumik-vc_123_launch_0_abcd12",
  "status": "completed",
  "durationSeconds": 90,
  "recordingUrl": "https://.../api/voice/recordings/vc_123_launch_0_abcd12/rumik-vc_123_launch_0_abcd12?datasetId=fundsindia",
  "transcript": [
    { "speaker": "assistant", "text": "Hi, I am calling from FundsIndia.", "atMs": 0 },
    { "speaker": "user", "text": "Yes, tell me.", "atMs": 3500 }
  ],
  "outcome": {
    "answered": true,
    "engaged": true,
    "followUpRequested": false
  }
}
```

Simple rule:

- `statusUrl`: call lifecycle only.
- `recordingUploadUrl`: upload the audio file if Rumik does not have public blob storage.
- `transcriptUrl`: transcript, outcome, duration, and final recording URL.

## Browser Live Tests

Browser live tests are separate from campaign calls.

Use `sessionId` from the Rumik/Pipecat WebRTC start response. Do not use `campaignId` and `callId` for live-test callbacks.

Local/ngrok demo URLs:

```text
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/status
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/transcript
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/recording
```

Production URLs:

```text
https://demo.actioneer.com/api/partner/pipecat/live-test/status
https://demo.actioneer.com/api/partner/pipecat/live-test/transcript
https://demo.actioneer.com/api/partner/pipecat/live-test/recording
```

The app sends these in the browser live-test start payload:

```json
{
  "body": {
    "mode": "browser-webrtc-live-test",
    "callbacks": {
      "statusUrl": "https://.../api/partner/pipecat/live-test/status",
      "transcriptUrl": "https://.../api/partner/pipecat/live-test/transcript",
      "recordingUploadUrl": "https://.../api/partner/pipecat/live-test/recording"
    }
  }
}
```

For live tests launched from a saved campaign, the actual callback URLs include the local live-test `callId` in the query string.
That lets the app persist transcripts and recordings even if the callback body contains empty IDs:

```text
https://.../api/partner/pipecat/live-test/transcript?campaignId=vc_123&callId=live-test-vc_123-...
```

### Live-Test Status URL

```json
{
  "sessionId": "sess_123",
  "status": "connected"
}
```

Final status:

```json
{
  "sessionId": "sess_123",
  "status": "completed",
  "durationSeconds": 90
}
```

### Live-Test Recording Upload URL

Preferred multipart request:

```bash
curl -X POST "https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/recording?secret=$RUMIK_PIPECAT_CALLBACK_SECRET" \
  -F "sessionId=sess_123" \
  -F "durationSeconds=90" \
  -F "file=@live-test.mp3;type=audio/mpeg"
```

Successful response:

```json
{
  "ok": true,
  "recordingUrl": "https://.../api/voice/recordings/live-test-vc_123-.../rumik-sess_123?datasetId=fundsindia",
  "recordingSid": "rumik-sess_123",
  "storageKey": "live-test-vc_123-.../rumik-sess_123.mp3",
  "contentType": "audio/mpeg",
  "sizeBytes": 1234567
}
```

### Live-Test Transcript URL

Incremental transcript update:

```json
{
  "sessionId": "sess_123",
  "status": "in_progress",
  "transcript": [
    { "speaker": "assistant", "text": "Hi, how can I help?", "atMs": 0 }
  ]
}
```

Final live-test transcript callbacks can also include `recordingUrl` and optional `recordingSid`; external recording URLs
are downloaded into the same Railway volume before the callback returns success.

Final transcript:

```json
{
  "sessionId": "sess_123",
  "status": "completed",
  "durationSeconds": 90,
  "recordingUrl": "https://.../api/voice/recordings/live-test-vc_123-.../rumik-sess_123?datasetId=fundsindia",
  "transcript": [
    { "speaker": "assistant", "text": "Hi, how can I help?", "atMs": 0 },
    { "speaker": "user", "text": "I need help with KYC.", "atMs": 3500 }
  ]
}
```

## Expected Demo Flow

Campaign call:

1. App starts a Rumik campaign call and sends `statusUrl`, `transcriptUrl`, and `recordingUploadUrl`.
2. Rumik posts lifecycle updates to `statusUrl`.
3. Rumik uploads the recording file to `recordingUploadUrl`.
4. The app returns a `recordingUrl`.
5. Rumik posts the final transcript payload to `transcriptUrl`, including that `recordingUrl`.

Browser live test:

1. App starts the WebRTC live test and sends live-test callback URLs.
2. Rumik posts live-test lifecycle updates using `sessionId`.
3. Rumik uploads the live-test recording using `sessionId`.
4. Rumik posts transcript updates or final transcript using `sessionId`.
