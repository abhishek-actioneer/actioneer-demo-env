# Actioneer AI BDR

The home page and `/bdr` are the outbound sales workspace. The banking demo remains available at its existing route.

## Workflow

1. Load Monaco audiences, select one and a script template, and import it. This creates a **draft** and never places calls.
2. Review contacts, edit the opening, conversation script and voicemail, select a Cartesia voice ID, and listen to the opening. Existing campaigns keep their saved scripts: under **Script & Voice**, choose **Apply template**, review, and save to use a new template.
3. Save changes, then manually choose **Launch calls**. The server calls pending contacts sequentially, including after the browser is closed.
4. Pause stops new dispatches; an already dispatched call finishes normally. Resume continues only with uncalled contacts. Call details show Twilio IDs, playback-aware transcripts, answer mode, follow-up requests, and post-call sentiment.

## Script templates and call outcomes

- **Credit unions & financial services:** B2B discovery around stalled mortgages and zero-to-five-days-past-due outreach. Branches by the leader's actual bottleneck, describes approved reminders and exception handoffs, and focuses on reducing work for lean teams. It is not a borrower collections script.
- **HVAC, electrical, plumbing & field services:** discovers the trade and service mix first, then focuses on after-hours intake or technician productivity. Answers workflow questions with trade-specific examples, approved knowledge, integration requirements, and clear escalation boundaries.
- Daniel introduces himself as **Daniel from Actioneer**. He answers honestly if asked whether he is AI. An accepted follow-up ends with **“Someone from my team shall reach out shortly.”** The request is visible in call details; an operator must actually arrange the follow-up. The app does not send a notification or book a meeting.
- Conversational delivery is applied at runtime to existing campaigns too: warm, attentive, matter-of-fact wording, varied and relevant acknowledgements, contractions, and sparse optional fillers. Acknowledgements wait for a caller turn; there is no automatic background chatter, breathing, laughter, or ambient sound. Saved scripts are not overwritten.
- Recognized Apple/Google screening pauses the pitch, identifies Daniel once, and waits up to 90 seconds for a person. A human response resumes discovery. Screening-only calls are not classified as negative leads.
- Recognized voicemail waits for the greeting to end, then plays the editable, template-specific voicemail and hangs up after Twilio acknowledges playback. Each template ends **“Thank you for your time, and have a wonderful day.”** Asynchronous Twilio answering-machine detection supplies beep/end results; recognized greeting plus quiet is a fallback. Detection can make mistakes, so test your actual phone/screening setup before a campaign. AMD may incur Twilio usage charges.
- After a call, a separate background job attaches **positive** or **negative** sentiment with a short evidence-based reason. Voicemail, screening, greetings-only, and ambiguous conversations show no sentiment rather than invented interest. Classification uses the prospect's words and confirmed played speech, runs off the live audio path, and retries transient failures at most three times. Late transcript updates can trigger a new analysis.

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

Keep the existing Clerk variables. Optional: `CARTESIA_VOICE_ID` sets the initial voice; `BDR_CARTESIA_MODEL` defaults to `sonic-3.6`; `BDR_REALTIME_MODEL` defaults to `gpt-realtime-mini`; `BDR_SENTIMENT_MODEL` defaults to `gpt-4o-mini` and uses the same OpenAI key with a small additional post-call API request. Phone TTS uses WebSocket continuations by default; set `BDR_CARTESIA_TRANSPORT=bytes` and redeploy to roll back only the transport to the previous HTTP streaming path.

Deploy the staged variable changes. Use `pnpm start` as the service start command; it runs the custom WebSocket server, durable queue dispatcher, and post-call sentiment worker. Use one Railway replica with the persistent volume. No analytics dataset download or biometric matcher is required by BDR. Twilio answer/status/AMD webhook URLs are supplied automatically per call; `/api/bdr/twilio/amd` skips browser login but verifies the Twilio signature, account and call SID. Incoming calls to the Twilio number are not configured by this feature.

When the keys are ready, preview a voice first. Create a small Monaco test audience containing a number you control, import it, and launch that campaign before using prospect audiences. Twilio account permissions and trial restrictions determine which destinations it can reach.

## Implementation and limits

- Monaco REST: `POST /v1/audiences/list`, `GET /v1/audiences/{id}`, paginated `GET /v1/audiences/{id}/contacts`, `GET /v1/contacts/{id}`. Imports are snapshots, not live synchronization.
- Twilio Programmable Voice + bidirectional Media Streams carry 8 kHz μ-law audio. HTTP and WebSocket callbacks are authenticated, with a per-call signed stream token.
- OpenAI Realtime listens and produces text; Cartesia generates speech. The bridge supports interruption, transcript persistence, opt-out, and hangup tools.
- Cartesia phone audio is forwarded incrementally as raw 8 kHz mu-law over a per-call WebSocket. Complete phrases within a response share a Sonic context; explicit flush boundaries retain per-phrase Twilio playback marks. `max_buffer_delay_ms=0` avoids buffering already-aggregated phrases twice. Short acknowledgements stay attached to the next point instead of being synthesized alone, and text is no longer cut arbitrarily at 120 characters. A context idle for more than 700 ms is renewed conservatively because Cartesia expires contexts after one second without output. Preview audio still uses HTTP.
- If the WebSocket fails before any audio for a phrase is forwarded, that call falls back to HTTP streaming. Failures after partial speech never replay the phrase. Canceled contexts and late audio are discarded. Speed and volume remain at 1; the transcript guides emotion, without imposing experimental emotion tags across languages.
- OpenAI connects during the opening; responses are requested after a completed caller turn. Brief listening acknowledgements do not clear the pitch, while meaningful or sustained speech can interrupt. A normal hangup drains queued speech and the farewell; opt-out stops the pitch immediately once recognized.
- New assistant transcript entries are marked played only after Twilio acknowledges their audio. Cleared/unconfirmed sentences are labeled interrupted, and unheard text is removed from the model's conversation history. Earlier transcripts predate playback tracking. Runtime logs report first-audio synthesis/response timing without logging transcript contents.
- SQLite on the volume persists campaigns, reservations, transcripts, and phone suppressions. Draft/paused campaigns cannot be claimed. Transactional claims prevent two workers from dialing the same pending contact. Call status callbacks cannot regress completed calls.
- Calls run one at a time and are capped at five minutes; ringing times out after 30 seconds. An uncertain dispatch pauses the campaign and marks the contact for review instead of retrying. Review it in Twilio; resuming never redials that contact.
- Qualification is guided by the script. Meeting booking, CRM outcome writeback, scheduled callbacks, automatic call retries, and recording downloads are not implemented. A completed call or positive sentiment is not automatically a qualified lead.
- Without configured provider keys, unit tests and the build can validate the integration code, but live calling, latency, and voice quality still require a real test call.

## Listening check after deployment

Use a manually launched campaign to your own test number; deployment never places a test call. Try: "We do plumbing, mainly emergency leaks," "Those calls go to whoever is on call," a brief overlapping "mm-hmm," a substantive interruption, and "Yes, have someone reach out." Check that Daniel remembers the trade, acknowledges the actual answer without repeating a stock opener, continues across sentence boundaries, honors interruptions, and finishes the team-follow-up closing. Check screening and voicemail separately. Automated tests validate transport and turn control, not perceived naturalness or live carrier latency.

References: [Monaco audiences](https://docs.monaco.com/api-reference/audiences/list-audiences), [audience contacts](https://docs.monaco.com/api-reference/audiences/list-audience-contacts), [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages), [Cartesia contexts](https://docs.cartesia.ai/use-the-api/tts-websocket/contexts), [Cartesia buffering](https://docs.cartesia.ai/use-the-api/tts-websocket/buffering), [Cartesia prompting](https://docs.cartesia.ai/build-with-cartesia/capability-guides/prompting-tips), [OpenAI Realtime prompting](https://developers.openai.com/api/docs/guides/voice-prompting).
