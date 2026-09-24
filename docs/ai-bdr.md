# Actioneer AI BDR

The home page and `/bdr` are the outbound sales workspace. The banking demo remains available at its existing route.

## Workflow

1. Load Monaco audiences, select one, and import it. This creates a **draft** and never places calls.
2. Review contacts, edit the opening and conversation script, select a Cartesia voice ID, and listen to the opening.
3. Save changes, then manually choose **Launch calls**. The server calls pending contacts sequentially, including after the browser is closed.
4. Pause stops new dispatches; an already dispatched call finishes normally. Resume continues only with uncalled contacts. Call details show Twilio IDs and transcripts.

Phone numbers must include a country code. Opted-out contacts and duplicate or invalid numbers are excluded. Monaco opt-out and phone data are rechecked just before dispatch. A spoken opt-out, when recognized by the conversation model's `opt_out` tool, is recorded as an application-wide phone suppression. This does not change the Monaco record. Uncertain dispatches are never automatically redialed.

## Railway setup

Open the existing project → **actioneer-web** → **Variables** → **New Variable** (or **Raw Editor**). Add server-side values for:

| Variable | Where it comes from |
| --- | --- |
| `MONACO_API_KEY` | Monaco workspace API key. A Codex Monaco connection is separate from the website's server configuration. |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info |
| `TWILIO_PHONE_NUMBER` | A voice-enabled Twilio number in international format, such as `+1…` |
| `CARTESIA_API_KEY` | Cartesia dashboard → API keys |
| `OPENAI_API_KEY` | OpenAI Platform → API keys; the project needs access to the configured Realtime model |
| `BDR_OPERATOR_EMAILS` | Comma-separated verified sign-in emails authorized to access the shared Monaco workspace |
| `VOICE_PUBLIC_BASE_URL` | `https://actioneer-web-production.up.railway.app` |
| `VOICE_STORAGE_DIR` | `/app/data` on the existing persistent volume |

Keep the existing Clerk variables. Optional: `CARTESIA_VOICE_ID` sets the initial voice; `BDR_CARTESIA_MODEL` defaults to `sonic-3.6`; `BDR_REALTIME_MODEL` defaults to `gpt-realtime-mini`.

Deploy the staged variable changes. Use `pnpm start` as the service start command; it runs the custom WebSocket server and the durable queue dispatcher. Use one Railway replica with the persistent volume. No analytics dataset download or biometric matcher is required by BDR. Twilio answer/status webhook URLs are supplied automatically per call. Incoming calls to the Twilio number are not configured by this feature.

When the keys are ready, preview a voice first. Create a small Monaco test audience containing a number you control, import it, and launch that campaign before using prospect audiences. Twilio account permissions and trial restrictions determine which destinations it can reach.

## Implementation and limits

- Monaco REST: `POST /v1/audiences/list`, `GET /v1/audiences/{id}`, paginated `GET /v1/audiences/{id}/contacts`, `GET /v1/contacts/{id}`. Imports are snapshots, not live synchronization.
- Twilio Programmable Voice + bidirectional Media Streams carry 8 kHz μ-law audio. HTTP and WebSocket callbacks are authenticated, with a per-call signed stream token.
- OpenAI Realtime listens and produces text; Cartesia generates speech. The bridge supports interruption, transcript persistence, opt-out, and hangup tools.
- SQLite on the volume persists campaigns, reservations, transcripts, and phone suppressions. Draft/paused campaigns cannot be claimed. Transactional claims prevent two workers from dialing the same pending contact. Call status callbacks cannot regress completed calls.
- Calls run one at a time and are capped at five minutes; ringing times out after 30 seconds. An uncertain dispatch pauses the campaign and marks the contact for review instead of retrying. Review it in Twilio; resuming never redials that contact.
- Qualification is guided by the script. Meeting booking, CRM outcome writeback, scheduled callbacks, automatic retries, voicemail detection, and recording downloads are not implemented. A completed call is not automatically a qualified lead.
- Without configured provider keys, unit tests and the build can validate the integration code, but live calling, latency, and voice quality still require a real test call.

References: [Monaco audiences](https://docs.monaco.com/api-reference/audiences/list-audiences), [audience contacts](https://docs.monaco.com/api-reference/audiences/list-audience-contacts), [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages), [Cartesia TTS](https://docs.cartesia.ai/api-reference/tts/bytes), [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations).
