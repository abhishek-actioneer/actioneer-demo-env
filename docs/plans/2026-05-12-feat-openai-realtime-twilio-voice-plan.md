---
title: "feat: Replace ElevenLabs with OpenAI Realtime API + Twilio for Voice Campaigns"
type: feat
status: active
date: 2026-05-12
---

# feat: Replace ElevenLabs with OpenAI Realtime API + Twilio

## Overview

Replace ElevenLabs ConvAI (which manages the full STT→LLM→TTS pipeline) with a direct
OpenAI Realtime API (`gpt-realtime-2`) integration over Twilio Media Streams. ElevenLabs
ConvAI produces robotic, laggy Hindi/Hinglish voice output. OpenAI Realtime's `gpt-realtime-2`
(GPT-5-class reasoning, released May 7 2026) achieves 12.5% lower Hindi WER than any tested
alternative and handles Hinglish code-switching natively.

## Problem Statement

- **Voice quality**: ElevenLabs `eleven_turbo_v2_5` is mediocre for Hindi. Users hear a
  robotic, heavily accented voice that kills engagement.
- **Latency**: ElevenLabs ConvAI pipeline takes 2–3s per response turn. `gpt-realtime-2`
  targets sub-second response with `audio/pcmu` passthrough (no transcoding).
- **Conversation quality**: ElevenLabs' built-in LLM is weaker than GPT-5. Complex
  Hinglish objection handling breaks down.
- **Lock-in**: ElevenLabs controls STT + LLM + TTS; no individual component is swappable.
  OpenAI Realtime uses our existing `OPENAI_API_KEY`.

## Proposed Solution

```
Campaign launch
    → Twilio REST API: initiate outbound call
    → Twilio calls recipient, connects to our TwiML endpoint
    → TwiML returns <Connect><Stream url="wss://host/media-stream" />
    → Twilio opens WebSocket to our custom server
    → Our server bridges Twilio WS ↔ OpenAI Realtime API WS
    → gpt-realtime-2 handles STT + reasoning + TTS natively
    → Audio streams back to Twilio with ~500ms latency
    → Twilio status callback updates call status on completion
```

No agent pre-creation step. No ElevenLabs. One API key (`OPENAI_API_KEY`, already in env).

## Technical Approach

### Audio Format — Zero Transcoding

Twilio sends mulaw 8kHz audio. OpenAI Realtime `gpt-realtime-2` accepts `audio/pcmu` as
input and can return `audio/pcmu` output. With both set to `audio/pcmu`, the base64 audio
payload from Twilio's `media` event passes **directly** to OpenAI's
`input_audio_buffer.append`, and OpenAI's `response.output_audio.delta` passes directly
back to Twilio. Zero transcoding. This is the primary latency optimization.

### WebSocket Architecture

Next.js App Router API routes are stateless request handlers — they cannot hold a
persistent WebSocket connection for the 30–120s duration of a call. A custom HTTP server
is required to intercept WebSocket upgrade requests before Next.js handles them.

```
                    ┌──────────────────────────────────┐
                    │         server.ts (project root) │
                    │                                  │
HTTP requests ──→   │  createServer → next handle()   │
WS upgrades  ──→   │  /media-stream → WebSocketServer │
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
       Twilio WS              Bridge logic         OpenAI WS
   (mulaw audio in)       (per-call state)    (gpt-realtime-2)
   (mulaw audio out)     interruption mgmt    audio/pcmu in/out
```

### Key Config Values

```typescript
// OpenAI Realtime WebSocket
const WS_URL = `wss://api.openai.com/v1/realtime?model=gpt-realtime-2`;
const HEADERS = {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  'OpenAI-Beta': 'realtime=v1',
};

// Session config (GA format — NOT the old beta "g711_ulaw" string)
const session = {
  type: 'realtime',
  model: 'gpt-realtime-2',
  output_modalities: ['audio'],
  instructions: systemPrompt,
  audio: {
    input: {
      format: { type: 'audio/pcmu' },
      turn_detection: { type: 'server_vad' },
    },
    output: {
      format: { type: 'audio/pcmu' },
      voice: 'coral', // or 'cedar' for male; both best for Hinglish
    },
  },
};
```

> ⚠️ Do NOT use the old `input_audio_format: "g711_ulaw"` string — this was beta syntax
> and is rejected with a type error in the GA API. Use the nested `audio.input.format`
> object above.

### First Message (Agent Speaks First)

Outbound calls require the agent to speak immediately. There is no `first_message` field
in the OpenAI Realtime session config. Trigger it via:

```typescript
// After session.update:
openAiWs.send(JSON.stringify({
  type: 'conversation.item.create',
  item: {
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `Begin. Your opening line is: "${firstMessage}"` }],
  },
}));
openAiWs.send(JSON.stringify({ type: 'response.create' }));
```

### Interruption Handling

When the user speaks mid-response, the agent must stop. Track Twilio's media timestamp
to compute how much audio was actually played, then truncate OpenAI's conversation history
to match:

```typescript
// On input_audio_buffer.speech_started from OpenAI:
openAiWs.send(JSON.stringify({
  type: 'conversation.item.truncate',
  item_id: lastAssistantItemId,
  content_index: 0,
  audio_end_ms: latestTwilioTimestamp - responseStartTimestamp,
}));
// Flush Twilio's playback buffer:
twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
```

## Implementation Phases

### Phase 1: Custom Server + WebSocket Infrastructure

**Goal:** Next.js app starts via `server.ts`, WebSocket connections on `/media-stream` work.

**Files:**
- `server.ts` (new, project root) — custom HTTP + WS server
- `src/lib/voice-call-state.ts` (new) — per-call lookup store (systemPrompt, firstMessage,
  language, voice, campaignId) keyed by Twilio `callSid`
- `package.json` — add `ws`, `@types/ws`; update `dev` and `start` scripts
- `scripts/startup.sh` — update start command to `tsx server.ts`
- `next.config.ts` — add `ws` and `twilio` to `serverExternalPackages`

**server.ts skeleton:**

```typescript
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { handleMediaStream } from './src/lib/openai-realtime-bridge';

const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev: process.env.NODE_ENV !== 'production', port });

app.prepare().then(() => {
  const handle = app.getRequestHandler();
  const wss = new WebSocketServer({ noServer: true });

  const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));

  server.on('upgrade', (req, socket, head) => {
    if (parse(req.url || '/').pathname === '/media-stream') {
      wss.handleUpgrade(req, socket as never, head, (ws) => wss.emit('connection', ws, req));
    }
  });

  wss.on('connection', handleMediaStream);
  server.listen(port, () => console.log(`> Ready on http://localhost:${port}`));
});
```

**Acceptance criteria:**
- [ ] `pnpm dev` starts via `tsx server.ts`, Next.js app loads normally at localhost:3000
- [ ] `pnpm build && pnpm start` works in production mode
- [ ] WebSocket connection to `ws://localhost:3000/media-stream` opens and closes cleanly

---

### Phase 2: OpenAI Realtime Bridge

**Goal:** A WebSocket connection on `/media-stream` proxies audio between Twilio and OpenAI.

**Files:**
- `src/lib/openai-realtime-bridge.ts` (new) — full bridge logic
- `src/lib/voice-call-state.ts` (new) — call state store

**`openai-realtime-bridge.ts` responsibilities:**
1. On Twilio WS connect: look up `callSid` from query params → get systemPrompt, firstMessage,
   voice, language from `voice-call-state`
2. Open OpenAI Realtime WS with `gpt-realtime-2`
3. On OpenAI `open`: send `session.update` then trigger first message
4. On Twilio `media` event: forward `payload` to OpenAI `input_audio_buffer.append`
5. On OpenAI `response.output_audio.delta`: forward `delta` to Twilio `media` event
6. On OpenAI `input_audio_buffer.speech_started`: send truncate + Twilio clear
7. On Twilio `stop` or OpenAI close: clean up both connections

**Per-call state flow:**
```
Campaign creation (POST /api/voice-campaigns)
  → For each phone number: generate a local callId
  → Store { systemPrompt, firstMessage, voice, language, campaignId } in voice-call-state
  → Initiate Twilio call with TwiML URL containing callId
  → Twilio connects to /media-stream?callId=xxx
  → Bridge looks up state by callId
```

**Acceptance criteria:**
- [ ] Bridge connects to OpenAI Realtime WS successfully
- [ ] Audio flows Twilio → OpenAI → Twilio in mulaw without transcoding
- [ ] Agent speaks first message within 1s of call connecting
- [ ] Interruptions are handled: agent stops, buffer cleared, conversation continues

---

### Phase 3: Twilio Integration + Campaign Route Updates

**Goal:** Campaigns use Twilio REST API for outbound calls; status updates via Twilio webhooks.

**Files:**
- `src/lib/twilio-client.ts` (new) — Twilio REST client
- `src/app/api/voice/twiml/route.ts` (new) — TwiML endpoint
- `src/app/api/voice/status/route.ts` (new) — Twilio call status callback
- `src/app/api/voice-campaigns/route.ts` (modify) — replace `createAgent` + `initiateOutboundCall`
- `src/app/api/voice-campaigns/[id]/recall/route.ts` (modify) — same replacement
- `src/app/api/voice-campaigns/[id]/webhook/route.ts` (delete or stub) — no longer needed
- `src/app/api/voice-campaigns/[id]/launch/route.ts` (delete) — batch API path removed
- `src/lib/elevenlabs-client.ts` (delete `createAgent` + `initiateOutboundCall`; keep
  `submitBatchCall` stub for reference or delete entirely)

**`src/lib/twilio-client.ts`:**

```typescript
import twilio from 'twilio';

function getClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
}

export async function initiateCall(to: string, callId: string): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const call = await getClient().calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: `${baseUrl}/api/voice/twiml?callId=${callId}`,
    statusCallback: `${baseUrl}/api/voice/status`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed', 'failed', 'no-answer', 'busy'],
  });
  return call.sid; // this becomes the callId we track
}
```

**`src/app/api/voice/twiml/route.ts`:**

```typescript
export async function GET(req: Request) {
  const callId = new URL(req.url).searchParams.get('callId') ?? '';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${new URL(baseUrl).host}/media-stream?callId=${callId}" />
  </Connect>
</Response>`;
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
}
```

**`src/app/api/voice/status/route.ts`:**

```typescript
// Receives Twilio status callbacks, updates campaign call record
export async function POST(req: Request) {
  const body = await req.formData();
  const callSid = body.get('CallSid') as string;
  const status = body.get('CallStatus') as string; // completed, failed, no-answer, busy
  const duration = parseInt((body.get('CallDuration') as string) ?? '0', 10);
  // look up campaignId from voice-call-state, upsertCall(...)
  return new Response('', { status: 204 });
}
```

**New env vars required:**
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
NEXT_PUBLIC_BASE_URL=https://your-app.railway.app  # or https://your-ngrok.ngrok.io for dev
```

**Acceptance criteria:**
- [ ] `POST /api/voice-campaigns` creates a campaign and initiates Twilio outbound calls
- [ ] TwiML endpoint returns valid `<Connect><Stream>` XML
- [ ] Twilio status callback correctly transitions call status (calling → completed/failed/no_answer)
- [ ] Campaign auto-completes when all calls reach terminal status
- [ ] Recall route works the same way with new Twilio client

---

### Phase 4: UI Updates (Voice Selector)

**Goal:** Voice dropdown shows OpenAI voices (not ElevenLabs IDs).

**Files:**
- `src/app/voice-campaigns/new/page.tsx` (modify) — replace voice options

**New voice options:**

```typescript
const VOICES = [
  { id: 'coral',   label: 'Coral (Female · Warm)' },
  { id: 'cedar',   label: 'Cedar (Male · Warm)' },
  { id: 'sage',    label: 'Sage (Female · Calm)' },
  { id: 'alloy',   label: 'Alloy (Neutral)' },
  { id: 'shimmer', label: 'Shimmer (Female · Energetic)' },
];
// Default: 'coral' for Hindi/Hinglish (best prosody per community eval)
```

The `voice` field stays a `string` on `VoiceCampaign` — only valid values change.

**Acceptance criteria:**
- [ ] Voice picker shows OpenAI voices with helpful labels
- [ ] Default is `coral`
- [ ] Selected voice is passed through to the Realtime session config

---

### Phase 5: Middleware + Cleanup

**Files:**
- `src/middleware.ts` — add `/api/voice/twiml` and `/api/voice/status` to public routes
  (Twilio has no Clerk session)
- `scripts/startup.sh` — add `TWILIO_*` to env whitelist for Railway
- `.env.example` — document new vars
- `src/lib/elevenlabs-client.ts` — delete file if no longer used, or keep as empty stub

**Add to public routes in middleware:**

```typescript
publicRoutes: [
  '/auth(.*)',
  '/api/health',
  '/api/voice/twiml',   // Twilio fetches this — no session
  '/api/voice/status',  // Twilio posts here — no session
],
```

---

## System-Wide Impact

### Interaction Graph

```
POST /api/voice-campaigns
  → voice-call-state.storeCallConfig(callId, { systemPrompt, firstMessage, ... })
  → twilio-client.initiateCall(number, callId)
    → Twilio dials recipient
    → Twilio GET /api/voice/twiml?callId=xxx   (no Clerk auth)
    → Twilio WS → /media-stream?callId=xxx
      → openai-realtime-bridge.handleMediaStream(ws, req)
        → voice-call-state.getCallConfig(callId)
        → OpenAI WS open: session.update + first message
        → audio proxy loop
    → Twilio POST /api/voice/status              (no Clerk auth)
      → voice-campaign-store.upsertCall(...)
      → voice-campaign-store.persist(...)        (writes data/voice-campaigns.json)
```

### State Lifecycle Risks

- **voice-call-state** is in-memory. If the server restarts mid-call, the bridge WS loses
  its config lookup and the call continues with no instruction context. Mitigation: store
  call configs in `data/voice-call-state.json` alongside campaigns (same persist pattern).
- **Call initiated but TwiML endpoint unreachable** (dev/ngrok tunnel down): Twilio fails
  the call silently. Always verify `NEXT_PUBLIC_BASE_URL` is reachable before testing.
- **OpenAI WS closes before Twilio WS**: the bridge must catch this and hang up the Twilio
  call gracefully rather than leaving the caller in silence.

### Error Propagation

- Twilio `initiateCall` failure → surfaced synchronously in `POST /api/voice-campaigns`
  → call logged as `failed` in store
- OpenAI WS auth failure (wrong API key) → bridge closes → Twilio call stays connected in
  silence → mitigate with 5s timeout: if OpenAI WS doesn't open, hang up Twilio call
- Twilio status callback failure (network, wrong URL) → call stays `calling` forever in UI
  → mitigate: detail page's 5s polling auto-resolves after `calling` timeout at 10min

### API Surface Parity

- `/api/voice-campaigns/[id]/recall/route.ts` must mirror the same Twilio call initiation
  logic as the main creation route — do not leave it calling ElevenLabs
- `/api/voice-campaigns/[id]/launch/route.ts` (batch path) should be deleted — it references
  ElevenLabs batch API which is being removed

---

## New Files Summary

| File | Purpose |
|---|---|
| `server.ts` | Custom HTTP + WebSocket server |
| `src/lib/openai-realtime-bridge.ts` | Twilio ↔ OpenAI Realtime audio proxy |
| `src/lib/voice-call-state.ts` | Per-call config store (systemPrompt, firstMessage) |
| `src/lib/twilio-client.ts` | Twilio REST client (initiate outbound call) |
| `src/app/api/voice/twiml/route.ts` | TwiML endpoint returning `<Connect><Stream>` |
| `src/app/api/voice/status/route.ts` | Twilio status callback receiver |

## Modified Files Summary

| File | Change |
|---|---|
| `package.json` | Add `twilio`, `ws`, `@types/ws`; update `dev`/`start` scripts |
| `next.config.ts` | Add `ws`, `twilio` to `serverExternalPackages` |
| `scripts/startup.sh` | Start via `tsx server.ts`, add TWILIO_* to env whitelist |
| `src/app/api/voice-campaigns/route.ts` | Replace `createAgent` + ElevenLabs dial with Twilio |
| `src/app/api/voice-campaigns/[id]/recall/route.ts` | Same replacement |
| `src/app/voice-campaigns/new/page.tsx` | Replace voice picker options |
| `src/middleware.ts` | Add Twilio webhook routes to public routes |

## Deleted Files

| File | Reason |
|---|---|
| `src/app/api/voice-campaigns/[id]/webhook/route.ts` | Replaced by `/api/voice/status` |
| `src/app/api/voice-campaigns/[id]/launch/route.ts` | ElevenLabs batch API path removed |
| `src/lib/elevenlabs-client.ts` | ElevenLabs fully replaced (or keep as empty module) |

---

## Acceptance Criteria

### Functional

- [ ] Launching a campaign places outbound Twilio calls directly (no ElevenLabs dependency)
- [ ] Called recipient hears the agent's first message within 1s of picking up
- [ ] Agent converses in Hinglish naturally using the system prompt
- [ ] Agent stops speaking when user interrupts; resumes coherently
- [ ] Call status (calling → completed/no_answer/failed) updates in the campaign detail page
- [ ] Duration and engagement flag (≥20s) are populated after call ends
- [ ] Recall (re-call) route works identically
- [ ] Server restarts do not lose existing campaign data (file-backed store)

### Non-Functional

- [ ] Response latency ≤ 1.5s (vs 2-3s with ElevenLabs) — verify with stopwatch during test call
- [ ] No audio transcoding in the bridge path (confirmed by code review: both sides `audio/pcmu`)
- [ ] Custom server does not break any existing Next.js routes, middleware, or HMR in dev
- [ ] `/api/voice/twiml` and `/api/voice/status` are reachable without auth (public routes)
- [ ] No ElevenLabs API calls made at any point in the campaign flow

### Dev Experience

- [ ] `pnpm dev` starts cleanly via `tsx server.ts`
- [ ] ngrok (or similar) can tunnel `localhost:3000` for Twilio callbacks in local dev
- [ ] `NEXT_PUBLIC_BASE_URL` is the only config needed to switch between dev/prod

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `audio/pcmu` GA format differs from docs | Low | Test with a simple echo bot first before full bridge |
| `server_vad` false-triggers on background noise | Medium | Tune `threshold: 0.6` and `silence_duration_ms: 700` |
| OpenAI WS closes mid-call (rate limit, timeout) | Low | Detect `close` event, hang up Twilio call gracefully |
| ngrok tunnel unreachable for local dev | High (dev only) | Document clearly; use stable ngrok domain if on paid plan |
| `tsx server.ts` slow startup in prod | Low | Use `tsc` precompile or `ts-node` alternative |
| Twilio `statusCallback` not fired | Low | Add 10-min `calling` timeout as fallback in the store |

---

## Dependencies to Install

```bash
pnpm add twilio ws
pnpm add -D @types/ws
```

The `openai` package (v6.37.0) is already installed and supports `gpt-realtime-2` via the
raw WebSocket approach. No upgrade needed.

---

## Sources

- [OpenAI: Advancing voice intelligence (gpt-realtime-2 launch)](https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/)
- [OpenAI Realtime WebSocket Guide](https://platform.openai.com/docs/guides/realtime-websocket)
- [Twilio: Outbound Calls with Node.js + OpenAI Realtime](https://www.twilio.com/en-us/blog/outbound-calls-node-openai-realtime-api-voice)
- [GitHub: twilio-samples/speech-assistant-openai-realtime-api-node](https://github.com/twilio-samples/speech-assistant-openai-realtime-api-node)
- [OpenAI Agents SDK: Realtime on Twilio](https://openai.github.io/openai-agents-js/extensions/twilio/)
- [Next.js Custom Server docs](https://nextjs.org/docs/pages/guides/custom-server)
