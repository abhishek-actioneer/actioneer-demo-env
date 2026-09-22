
```text
Use these URLs for actual campaign/phone calls:

statusUrl:
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/status

transcriptUrl:
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/transcript

recordingUploadUrl:
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/recording

No secret needed right now. Just POST to the URLs directly.


Flow:
1. POST call lifecycle updates to statusUrl.
2. Upload the audio file to recordingUploadUrl with campaignId + callId.
3. recordingUploadUrl returns recordingUrl.
4. POST final transcript payload to transcriptUrl with that recordingUrl.

Recording upload multipart example:

curl -X POST "https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/recording" \
  -F "campaignId=..." \
  -F "callId=..." \
  -F "durationSeconds=90" \
  -F "file=@recording.mp3;type=audio/mpeg"

Recording upload response:

{
  "ok": true,
  "recordingUrl": "https://ether-rebuilt-skewer.ngrok-free.dev/api/voice/recordings/...",
  "recordingSid": "...",
  "storageKey": "...",
  "contentType": "audio/mpeg",
  "sizeBytes": 123456
}

Then final transcriptUrl payload:

{
  "campaignId": "...",
  "callId": "...",
  "status": "completed",
  "durationSeconds": 90,
  "recordingUrl": "<recordingUrl from upload response>",
  "transcript": [
    { "speaker": "assistant", "text": "...", "atMs": 0 },
    { "speaker": "user", "text": "...", "atMs": 3500 }
  ],
  "outcome": {
    "answered": true,
    "engaged": true,
    "followUpRequested": false
  }
}

For browser live tests, use sessionId from the WebRTC start response.
Do not use campaignId/callId for live-test callbacks.

liveTestStatusUrl:
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/status

liveTestTranscriptUrl:
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/transcript

liveTestRecordingUploadUrl:
https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/recording

Live-test recording upload:

curl -X POST "https://ether-rebuilt-skewer.ngrok-free.dev/api/partner/pipecat/live-test/recording" \
  -F "sessionId=..." \
  -F "durationSeconds=90" \
  -F "file=@live-test.mp3;type=audio/mpeg"

Then final live-test transcript payload to liveTestTranscriptUrl:

{
  "sessionId": "...",
  "status": "completed",
  "durationSeconds": 90,
  "recordingUrl": "<recordingUrl from upload response>",
  "transcript": [
    { "speaker": "assistant", "text": "...", "atMs": 0 },
    { "speaker": "user", "text": "...", "atMs": 3500 }
  ]
}

If we enable callback auth later, I’ll share a secret. Then send it as either:
?secret=<value>
or header:
x-rumik-secret: <value>
```
