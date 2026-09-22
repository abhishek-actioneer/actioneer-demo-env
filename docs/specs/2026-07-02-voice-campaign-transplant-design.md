# Voice Campaign + Studio Transplant from actioneer-voice — Design

**Date:** 2026-07-02
**Status:** Approved direction (overwrite-and-reconcile), pending implementation plan
**Source repo:** `/Users/vimarsh/Documents/actioneer-voice` (treated as source of truth for the voice surface)
**Target repo:** baby-sentinel, branch off `feat/clerk-auth-merged`

## Goal

Replace baby-sentinel's voice-campaign implementation with the actioneer-voice version — the leaner, hardened evolution of the same code — so that:

1. Campaign creation is simpler: draft with nothing (`draftOnly`), launch with just `systemPrompt + voice + ≥1 phone number`. Segment and purpose/offer become optional enrichment, not hard 404 gates.
2. The creation UI is the actioneer-voice **studio** (decomposed `use-campaign-studio` hook family, single-screen progressive disclosure) instead of the 4,110-line 8-step wizard.
3. Omnichannel WhatsApp ↔ voice context sync comes along: shared phone-keyed `channel_events` memory read and written by both the voice agent and WhatsApp replies.
4. Pipecat is removed **platform-wide** (user decision 2026-07-02: "we do not need pipecat anywhere on the platform").

## Non-goals

- No storage migration of campaign state: campaigns stay in `voice-campaigns.json` via `voice-campaign-store.ts` (both repos use this).
- No changes to the analytics pipeline, chat, segments, metrics, or other feature areas beyond the export-contract patches listed below.
- No requirement to configure S3/Fivetran to run locally (both have local/disabled fallbacks).

## Approach: overwrite-and-reconcile

Considered and rejected: git-remote merge (repos diverged; actioneer-voice deleted boards/playbooks/funnels and a merge would try to delete them here) and shared-package extraction (correct long-term, out of scope for "plug it in").

### Phase 1 — Prep

- New branch off `feat/clerk-auth-merged`.
- Add npm deps: `@aws-sdk/client-s3`, `server-only`.
- Remove npm deps: `@pipecat-ai/client-js`, `@pipecat-ai/daily-transport`.
- Copy `src/features/` from actioneer-voice (integrations provider registry + `features/voice/server` + `features/prompts/voice`). baby-sentinel has no `src/features/`, so no collisions. **Exclude** `features/integrations` pipecat entries if any exist.

### Phase 2 — Shared-contract audit (tier B)

Diff exports of the ~15 shared platform files the incoming surface imports, and patch baby-sentinel's copies (small additions, never forks):

| File | Required exports |
|---|---|
| `src/lib/llm.ts` | `generateText`, `generateJson`, `parseJsonResponse`, type `ModelId` |
| `src/lib/sql-executor.ts` | `executeSQLInternal`, `executeSQLPrepared`, `validateSQL` |
| `src/lib/db.ts` | `isDBReady`, `withConnection` |
| `src/lib/meta-db.ts` | `getDb`, `stmts` + table DDL (see Phase 4) |
| `src/lib/server/segment-repo.ts` | `getSegment`, `listSegments`, `upsertSegment`, `deleteSegment`, `updatePushStatus` |
| `src/lib/server/segment-activity-repo.ts` | used by `voice-campaign-draft` |
| `src/lib/datasets/*` | registry (`index`, `types`, `constants`, `dynamic-registry`, `meta`) |
| `src/lib/dataset-context.tsx`, `breadcrumb-context.tsx`, `src/components/chat/chat-panel-provider.tsx` | React providers the studio mounts inside |
| `src/lib/api-client.ts` | `apiFetch` client helper |
| `src/components/chart/chart-core.tsx`, `src/lib/chart-types.ts` | cohort/insights viz |
| `src/components/ui/*` | button, dialog, input, select, sheet, switch, tabs, textarea, tooltip, alert-dialog |
| misc | `utils.ts`, `types.ts`, `seeded-random.ts`, `public-base-url.ts`, `active-connections.ts`, `user-scoped-storage.ts`, `page-context.ts`, `dataset-switch.ts` |

If baby-sentinel lacks `breadcrumb-context.tsx` or other actioneer-only shared files, copy them in as new files.

### Phase 3 — Swap the voice surface (tier A, ~160 files minus pipecat)

**Delete from baby-sentinel:**

- `src/app/voice-campaigns/**`, `src/app/api/voice-campaigns/**`, `src/app/api/voice/**`
- `src/lib/voice-*.ts`, `src/lib/plivo-*.ts`, `src/lib/*-voices.ts`, `src/lib/gupshup-whatsapp-client.ts`, `src/lib/call-log-store.ts`, `src/lib/fraud-call-registry.ts`, `src/lib/telephony-audio.ts` (replaced by incoming copy), `src/lib/openai-realtime-bridge.ts`
- All pipecat files platform-wide: `src/lib/partner-pipecat-*.ts`, `src/lib/pipecat-partner-client.ts`, `src/lib/rumik-pipecat-prompt.ts`, `src/app/api/partner/**`, `src/app/api/dev/pipecat/**`, `src/app/dev/pipecat/**`, `src/components/voice-campaigns/pipecat-live-test-panel.tsx`, pipecat handling in `src/proxy.ts`
- `src/components/voice-campaigns/**`, voice hooks (`use-campaign-*`, `use-live-test`, `use-voice-journey`, `use-script-history` equivalents)
- Baby-only extras being dropped (git history preserves them): `plivo-sarvam-bridge.ts`, `plivo-deepgram-tts-bridge.ts`, `plivo-gemini-tts-bridge.ts`, gemini-tts test bridge, KYC/PAN-KYC draft routes (`/api/voice-campaigns/**/kyc-draft`, `pan-kyc-draft`)

**Copy from actioneer-voice (excluding all pipecat files):**

- 9 pages `src/app/voice-campaigns/**` (studio, run, callbacks, call-logs, prompt-bench, voice-analysis-temp)
- 25 routes `src/app/api/voice-campaigns/**` (minus `live-test/pipecat/**`), 15 routes `src/app/api/voice/**`
- `src/app/api/webhooks/gupshup/whatsapp/route.ts` (inbound WhatsApp — new to baby-sentinel)
- 33 components `src/components/voice-campaigns/**` (minus pipecat panel), 9 hooks
- ~62 lib files: runner, dialer, bridges (`plivo-gemini-live-bridge`, probe, live-transcribe, test), stores (`voice-campaign-store`, `voice-storage`, transcript/recording storage), omnichannel (`customer-channel-memory`, `customer-channel-summarizer`, `whatsapp-inbound-replier`, `whatsapp-tool-reply`), `voice-runtime-config`, voices catalogs, shim re-exports (`plivo-client`, `gupshup-whatsapp-client`, `cartesia-tts-client`, `sarvam-tts-client`, `twilio-sms-client`)
- ~9 server repos: `call-event-outbox-repo`, `call-recording-repo`, `call-event-dispatcher`, `voice-campaign-draft`, experiment/success schemas, `voice-campaign-prompt-bench-runs`, `voice-customer-context-repo`, `fivetran-call-event-client`
- Supporting stores: `attribution-store`, `tenant-connections-store`, `purpose-store`/`purpose-types`, `fraud-call-registry`, `telephony-audio`, `fraud-verification` prompt

**Post-copy sweep:** grep the incoming files for pipecat imports/branches (`rumik-pipecat` in `voice-call-provider`, runner, launch/recall routes, campaign types union) and strip them so the provider union is `plivo-gemini` only (plus whatever actioneer-voice ships).

### Phase 4 — Infra reconcile

- **meta-db:** add missing tables to baby-sentinel's `meta-db.ts` with a schema-version bump: `channel_events`, `contacts`, `contact_phones`, `call_event_outbox`, `call_recordings` (plus `segment_activity` if absent). Match actioneer-voice's DDL (schema v14) so the repos stay copy-compatible.
- **server.ts:** reconcile WS upgrade routing to actioneer-voice's handler set — `/media-stream`, `/plivo-media-stream`, `/api/voice/plivo-ws`, `/plivo-probe-stream`, `/voice-live-transcribe`, `/voice-test-stream` — and add `startCallEventDispatcher()` on boot + transcript flush on shutdown. Remove upgrade paths for deleted bridges (sarvam/deepgram/gemini-tts/pipecat).
- **env:** extend `.env.example` — Gupshup app credentials + webhook secret, `VOICE_RECORDING_STORAGE_PROVIDER` (default local), optional S3 (`AWS_*`), optional Fivetran export, Plivo/Gemini/Sarvam/Cartesia as today.

### Phase 5 — Verification

1. `pnpm build` passes; no dangling imports of deleted files (`grep -r pipecat src/` returns nothing).
2. Create + launch a campaign with **only pasted phone numbers + generated script** (no segment, no offer) — call connects via Plivo + Gemini Live.
3. Create a segment-backed campaign on a dataset with warehouse context — per-recipient `VoiceCustomerContext` still resolves.
4. Send an inbound WhatsApp via the Gupshup webhook, then launch a call to the same number — the runtime system prompt contains the `OMNICHANNEL CUSTOMER MEMORY` block with the WhatsApp message.
5. After a call ends, post-call follow-up (SMS/WhatsApp) fires and is recorded as a `channel_events` row.
6. Insights/journey/capability pages render for a campaign created through the new studio.

## Risks

- **Export-contract drift** in tier-B files (e.g. `llm.ts` divergence — baby-sentinel memory says OpenAI-migrated; actioneer-voice's copy may differ). Phase 2 exists to catch this before the swap; expect a handful of small patches.
- **Entry points into the old wizard** (`/growth-opportunities/voice-campaign`, sidebar links, chat action handlers referencing old routes) may reference deleted route shapes — sweep for `voice-campaigns` references outside the surface and fix.
- **Voice-campaign data files:** existing `voice-campaigns.json` on disk was written by baby-sentinel's types (which include pipecat/provider fields). The incoming store tolerates extra fields; verify load doesn't crash on old campaigns. Dev data is disposable if not.
