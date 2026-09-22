# Observability

Checked-in observability assets for Baby Sentinel — queries and dashboard
definitions that live in the repo (not in app code, per KTD6/R13).

## Contents

- [`voice-hogql.md`](./voice-hogql.md) — Voice E2E Observability (Layer 3). HogQL
  roll-ups for the Plivo ⇄ Gemini Live voice pipeline: p50/p95/p99 voice-to-voice
  latency, trigger→transcript latency, the flagship latency×sentiment cross-cut,
  sentiment/question-type/adherence distributions, sample-weighted enrichment
  roll-up, and the judge-reliability + compliance-error-rate panel.

## How the voice events get emitted

The queries above run against events emitted by the additive observability spine:

| Layer | Where | What |
|---|---|---|
| Emitter | `src/lib/voice-events.ts` | Hot-path-safe batched PostHog client + frozen taxonomy + `deriveTurnLatencies`. |
| L1 trigger | `src/app/api/voice-campaigns/[id]/call-user/route.ts` | `voice_call_triggered` + persists `triggeredAtMs`. |
| L1 spine (Gemini) | `src/lib/plivo-gemini-live-bridge.ts` | lifecycle + per-turn `voice_turn` + `gemini_inline` finalize. |
| L1 parity | `src/lib/openai-realtime-bridge.ts` (live), `src/lib/plivo-sarvam-bridge.ts` (dormant) | same schema, `openai_realtime` / `sarvam_cascaded`. |
| L1 finalize (fallback) | `src/lib/voice-transcription.ts` | `openai_postcall` finalize on the post-call transcribe path. |
| L2 enrichment | `src/lib/voice-enrichment.ts` | post-call, sample-gated `voice_call_enrichment`. |
| Reliability | `src/lib/judge-consistency.ts` | offline `passAtK` (used against fixtures, not live calls). |

## Environment flags

- `VOICE_LATENCY_METRICS=1` — master switch for all voice emits (off ⇒ no-op).
- `VOICE_ENRICHMENT_SAMPLE_RATE` — Layer 2 sample rate (default `1.0`). Spine is
  never sampled.
- `POSTHOG_API_KEY` / `POSTHOG_HOST` — PostHog sink. When unset, the always-on
  `console.log("[voice/latency] …")` local sink still fires (fail-open).
