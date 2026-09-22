# Voice Campaign + Studio Transplant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace baby-sentinel's voice-campaign surface with the actioneer-voice version (studio UX, soft-dependency launch contract, omnichannel WhatsApp↔voice memory) and remove pipecat platform-wide.

**Architecture:** Overwrite-and-reconcile. actioneer-voice (`/Users/vimarsh/Documents/actioneer-voice`, referred to as `$SRC`) is source of truth for the ~160-file voice surface. baby-sentinel keeps its own copies of shared platform files (llm, sql-executor, db, meta-db, datasets, api-client, ui) with two surgical patches. Spec: `docs/specs/2026-07-02-voice-campaign-transplant-design.md`.

**Tech Stack:** Next.js 16, custom `tsx server.ts` + `ws`, Plivo + Gemini Live, better-sqlite3 (meta-db), DuckDB (customer context), Gupshup WhatsApp, Clerk.

## Global Constraints

- `SRC=/Users/vimarsh/Documents/actioneer-voice` — never modify files in `$SRC`; copy only.
- Branch off `feat/clerk-auth-merged`. Working tree is dirty (gupshup client, voice-followup-sms, deleted twilio clients, suvidha dataset files) — these are superseded by the transplant and ride along onto the new branch; do NOT discard them.
- **Commits require the user's explicit go-ahead.** Ask once at execution start whether the plan's commit steps are pre-authorized; if not, skip every commit step and tell the user at the end.
- Package manager: pnpm. Path alias `@/*` → `./src/*` in both repos, so copied files need no import rewrites.
- Zero pipecat anywhere at the end: `grep -ri pipecat src server.ts package.json` must return nothing.
- Strictly monochrome UI (incoming studio already complies).

---

### Task 1: Branch + npm dependency changes

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: branch `feat/voice-transplant`; `@aws-sdk/client-s3` and `server-only` installed; pipecat packages gone from `package.json` (source files that import them are deleted in Task 4 — the app will not build between Task 1 and Task 5's fix loop completing; that is expected for this transplant).

- [ ] **Step 1: Create branch**

```bash
cd /Users/vimarsh/Documents/baby-sentinel
git checkout -b feat/voice-transplant
```

- [ ] **Step 2: Swap packages**

```bash
pnpm remove @pipecat-ai/client-js @pipecat-ai/daily-transport
pnpm add @aws-sdk/client-s3 server-only
```

- [ ] **Step 3: Verify lockfile updated**

Run: `grep -c "pipecat" pnpm-lock.yaml || echo CLEAN`
Expected: `CLEAN` (or 0)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(voice): swap pipecat deps for aws s3 + server-only"
```

---

### Task 2: Patch shared contracts — llm.ts tool-calling + meta-db tables

**Files:**
- Modify: `src/lib/llm.ts` (insert before `export async function generateTextStream` at line ~414)
- Modify: `src/lib/meta-db.ts` (insert DDL; bump `CURRENT_SCHEMA_VERSION` at line 16)
- Test: `src/lib/__tests__/meta-db-voice-tables.test.ts` (new)

**Interfaces:**
- Produces: `llm.ts` exports `ToolDefinition`, `ResponsesInputItem`, `ResponsesOutput`, `OpenAIRawResponse`, `callOpenAIResponses(...)` — consumed by incoming `whatsapp-tool-reply.ts`. `meta-db.ts` creates tables `call_event_outbox`, `call_recordings`, `contacts`, `contact_phones`, `channel_events` — consumed by incoming server repos and `customer-channel-memory.ts` (they import only `getDb`).
- Consumes: nothing from other tasks. Audited facts: baby's `llm.ts` already has `generateText`/`generateJson`/`parseJsonResponse`/`ModelId`; `sql-executor.ts`, `segment-repo.ts`, `segment-activity-repo.ts`, `api-client.ts`, `chart-types.ts`, `seeded-random.ts` are byte-identical between repos; `db.ts` needs no patch (voice surface only uses `isDBReady`/`withConnection`, both present); all 10 ui/* components the studio imports exist in baby.

- [ ] **Step 1: Port the tool-calling block into llm.ts**

Copy `$SRC/src/lib/llm.ts` lines 414–475 (from `export interface ToolDefinition {` through the closing `}` of `callOpenAIResponses`, i.e. everything between `generateImage`'s end and `generateTextStream`). Extract with:

```bash
sed -n '414,475p' $SRC/src/lib/llm.ts
```

Insert verbatim into `src/lib/llm.ts` immediately before `export async function generateTextStream` (line ~414). The block is self-contained (uses `fetch`, `OPENAI_*` env already referenced elsewhere in the file).

- [ ] **Step 2: Port the 5 voice tables into meta-db.ts**

Copy `$SRC/src/lib/meta-db.ts` lines 253–351 (from `CREATE TABLE IF NOT EXISTS call_event_outbox (` through `ON channel_events(user_id, contact_id, occurred_at DESC);`). Extract with:

```bash
sed -n '253,351p' $SRC/src/lib/meta-db.ts
```

Insert into baby's `src/lib/meta-db.ts` inside the same `exec` template literal, immediately after the `contact_identities` index block (after line ~285, `ON contact_identities(user_id, dataset_id, entity_id);`). Then bump line 16:

```typescript
const CURRENT_SCHEMA_VERSION = 13;
```

(All statements are `IF NOT EXISTS`, so the bump just forces the ensure-block to rerun once per process.)

- [ ] **Step 3: Write the failing test**

Create `src/lib/__tests__/meta-db-voice-tables.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/meta-db";

describe("meta-db voice/omnichannel tables", () => {
  it("creates all five transplanted tables", () => {
    const db = getDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: { name: string }) => r.name);
    for (const t of [
      "call_event_outbox",
      "call_recordings",
      "contacts",
      "contact_phones",
      "channel_events",
    ]) {
      expect(names).toContain(t);
    }
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/lib/__tests__/meta-db-voice-tables.test.ts`
Expected: PASS (5 tables exist). If it fails with "no such table", the DDL block landed outside the `exec` literal — fix placement.

- [ ] **Step 5: Typecheck the llm patch**

Run: `pnpm tsc --noEmit -p tsconfig.json 2>&1 | grep "src/lib/llm" || echo LLM-CLEAN`
Expected: `LLM-CLEAN`

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm.ts src/lib/meta-db.ts src/lib/__tests__/meta-db-voice-tables.test.ts
git commit -m "feat(voice): add OpenAI Responses tool-calling to llm.ts + voice/omnichannel meta-db tables (schema v13)"
```

---

### Task 3: Copy `src/features/` + shared lib files baby lacks

**Files:**
- Create: `src/features/**` (integrations catalog/server/providers, voice/server, prompts/voice — from `$SRC`)
- Create: `src/lib/purpose-store.ts`, `src/lib/purpose-types.ts`, `src/lib/attribution-store.ts`, `src/lib/tenant-connections-store.ts` (from `$SRC`)

**Interfaces:**
- Produces: `@/features/integrations/server/provider-registry` (`ensureCampaignCallConfig`, `ensurePlivoConfig`, `ensureGeminiLiveConfig`), `@/features/voice/server/*` (dialer, call-provider), `@/features/prompts/voice/*` (campaign-script, campaign-bench), provider clients (gupshup/plivo/cartesia/sarvam/twilio), purpose + attribution + tenant-connections stores — all consumed by Task 5's surface.
- Consumes: Task 2's llm/meta-db patches.

- [ ] **Step 1: Copy features tree**

baby-sentinel has no `src/features/`, so this is collision-free. Audited: `$SRC/src/features/integrations/server/providers/` contains only gupshup, plivo, cartesia, sarvam, twilio — no pipecat.

```bash
SRC=/Users/vimarsh/Documents/actioneer-voice
rsync -a --exclude "*.test.ts" $SRC/src/features/ src/features/
```

- [ ] **Step 2: Copy the four missing shared lib files**

```bash
for f in purpose-store purpose-types attribution-store tenant-connections-store; do
  cp $SRC/src/lib/$f.ts src/lib/$f.ts
done
```

- [ ] **Step 3: Verify no pipecat came along and imports resolve**

Run: `grep -ri pipecat src/features/ && echo FAIL || echo CLEAN`
Expected: `CLEAN`

Run: `pnpm tsc --noEmit 2>&1 | grep "src/features\|purpose-store\|attribution-store\|tenant-connections" | head -20`
Expected: empty, or only errors referencing voice files that arrive in Task 5 (note them; they must clear by Task 5 Step 4). If a features file imports a shared module baby lacks, copy that module from `$SRC` the same way and note it in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/features src/lib/purpose-store.ts src/lib/purpose-types.ts src/lib/attribution-store.ts src/lib/tenant-connections-store.ts
git commit -m "feat(voice): bring in actioneer-voice features layer (integrations providers, voice server, voice prompts) + missing shared stores"
```

---

### Task 4: Purge old voice surface + pipecat platform-wide

**Files:**
- Delete: old voice pages/api/components/hooks/lib (list below)
- Modify: `src/proxy.ts` (remove pipecat handling)

**Interfaces:**
- Produces: a clean hole for Task 5. The build is broken after this task (dangling imports from non-voice entry points) — Task 5 fixes it.
- Consumes: nothing.

- [ ] **Step 1: Delete old surface + pipecat directories**

```bash
git rm -r --ignore-unmatch \
  src/app/voice-campaigns src/app/api/voice-campaigns src/app/api/voice \
  src/app/api/partner src/app/api/dev/pipecat src/app/dev/pipecat \
  src/components/voice-campaigns
```

- [ ] **Step 2: Delete old voice/pipecat lib files**

```bash
git rm --ignore-unmatch \
  src/lib/voice-*.ts src/lib/plivo-*.ts \
  src/lib/gemini-voices.ts src/lib/sarvam-voices.ts src/lib/cartesia-voices.ts \
  src/lib/gupshup-whatsapp-client.ts src/lib/call-log-store.ts \
  src/lib/fraud-call-registry.ts src/lib/telephony-audio.ts \
  src/lib/openai-realtime-bridge.ts src/lib/gemini-tts-test-bridge.ts \
  src/lib/partner-pipecat-*.ts src/lib/pipecat-partner-client.ts src/lib/rumik-pipecat-prompt.ts
```

- [ ] **Step 3: Delete old voice hooks (only those that exist)**

```bash
ls src/hooks | grep -E "^use-(campaign|voice|live-test|script-history)" || echo none
git rm --ignore-unmatch src/hooks/use-campaign-*.ts src/hooks/use-voice-*.ts src/hooks/use-live-test.ts src/hooks/use-script-history.ts
```

- [ ] **Step 4: Strip pipecat from proxy.ts**

Open `src/proxy.ts`, find the pipecat block (`grep -n pipecat src/proxy.ts`, ~41 diff lines vs `$SRC`). Compare with `$SRC/src/proxy.ts` (which has no pipecat) and make baby's match it for the pipecat-related sections only — leave baby-specific non-pipecat routes untouched.

- [ ] **Step 5: Verify only expected pipecat refs remain**

Run: `grep -rli pipecat src/ server.ts | sort`
Expected: empty, or only files that Task 5 replaces (`server.ts` does not reference pipecat; if anything else appears, delete/patch it now and record it).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(voice)!: remove legacy voice surface and all pipecat code platform-wide"
```

---

### Task 5: Copy the actioneer-voice surface (tier A) + server.ts

**Files:**
- Create: pages, API routes, components, hooks, lib, server repos, prompts (lists below — all from `$SRC`)
- Replace: `server.ts`

**Interfaces:**
- Consumes: Task 2 contracts (`callOpenAIResponses`, meta-db tables), Task 3 features layer.
- Produces: working `/voice-campaigns` studio, `/api/voice-campaigns/*`, `/api/voice/*`, Gupshup inbound webhook, omnichannel memory, campaign runner + Plivo/Gemini bridge.

- [ ] **Step 1: Copy pages + API routes (with pipecat exclusions)**

```bash
SRC=/Users/vimarsh/Documents/actioneer-voice
rsync -a $SRC/src/app/voice-campaigns/ src/app/voice-campaigns/
rsync -a --exclude "live-test/pipecat" $SRC/src/app/api/voice-campaigns/ src/app/api/voice-campaigns/
rsync -a $SRC/src/app/api/voice/ src/app/api/voice/
mkdir -p src/app/api/webhooks
rsync -a $SRC/src/app/api/webhooks/gupshup/ src/app/api/webhooks/gupshup/
```

- [ ] **Step 2: Copy components + hooks (exclude pipecat panel)**

```bash
rsync -a --exclude "pipecat-live-test-panel.tsx" $SRC/src/components/voice-campaigns/ src/components/voice-campaigns/
for h in $(ls $SRC/src/hooks | grep -E "^use-(campaign|voice|live-test|script-history)"); do
  cp $SRC/src/hooks/$h src/hooks/$h
done
```

- [ ] **Step 3: Copy lib + server repos + prompts (exclude pipecat + tests)**

```bash
rsync -a --exclude "*pipecat*" --exclude "*.test.ts" \
  --include "voice-*.ts" --include "plivo-*.ts" --include "whatsapp-*.ts" \
  --include "customer-channel-*.ts" --include "*-voices.ts" \
  --include "gupshup-whatsapp-client.ts" --include "openai-realtime-bridge.ts" \
  --include "telephony-audio.ts" --include "fraud-call-registry.ts" \
  --include "fundsindia-whatsapp-tools.ts" --include "cartesia-tts-client.ts" \
  --include "sarvam-tts-client.ts" --include "twilio-sms-client.ts" \
  --include "call-log-store.ts" --include "plivo-client.ts" \
  --exclude "*" $SRC/src/lib/ src/lib/
rsync -a --exclude "*.test.ts" \
  --include "call-event-*.ts" --include "call-recording-repo.ts" \
  --include "voice-*.ts" --include "fivetran-call-event-client.ts" \
  --exclude "*" $SRC/src/lib/server/ src/lib/server/
cp $SRC/src/lib/prompts/voice-campaign.ts src/lib/prompts/voice-campaign.ts
cp $SRC/src/lib/prompts/voice-campaign-bench.ts src/lib/prompts/voice-campaign-bench.ts
cp $SRC/src/lib/prompts/fraud-verification.ts src/lib/prompts/fraud-verification.ts
```

- [ ] **Step 4: Replace server.ts wholesale**

```bash
cp $SRC/server.ts server.ts
```

Audited: `$SRC/server.ts` imports only bridges copied in Step 3 (`openai-realtime-bridge`, `plivo-gemini-live-bridge`, `plivo-gemini-probe-bridge`, `voice-live-transcribe-bridge`, `voice-test-bridge`) plus `call-event-dispatcher`, `voice-transcript-storage`, `voice-runtime-config`, and adds `startCallEventDispatcher()` + transcript flush on shutdown. It has no pipecat and none of the dropped sarvam/deepgram/gemini-tts bridges.

- [ ] **Step 5: Pipecat + provider sweep on incoming files**

```bash
grep -rn "pipecat\|rumik" src/ server.ts | grep -v node_modules
```

Expected: empty. If any incoming file (e.g. `voice-call-provider.ts`, `voice-campaign-runner.ts`, `voice-campaign-types.ts`, launch/recall routes, `voice-campaign-studio.tsx`) still carries a `rumik-pipecat` union member or branch, remove that member and its branch — the provider union must reduce to what `$SRC` actively supports (`plivo-gemini`).

- [ ] **Step 6: Build-fix loop (dangling references outside the surface)**

Run: `pnpm build 2>&1 | head -40`

Fix iteratively; expected classes of failure, in order:
1. **Missing module from `$SRC`** (long-tail import the file lists above missed): copy the same-named file from `$SRC` (`cp $SRC/<path> <path>`), re-run. Record every extra file copied.
2. **Baby entry points referencing deleted routes/exports** — check specifically: `src/app/api/growth-opportunities/voice-campaign/route.ts` (compare with `$SRC`'s copy and take theirs if it differs), sidebar links to `/voice-campaigns`, chat `use-action-handlers.ts` references to old voice route shapes, `src/lib/voice-campaign-insights-loader.ts` consumers (metrics/insights pages). Point them at the incoming equivalents; if a baby-only page consumed a deleted baby-only module (e.g. gemini-tts test page), delete that page and note it.
3. **Offer-store vs purpose-store**: incoming routes use `purpose-store` (copied in Task 3). Baby's `offer-store` remains for other features; do not merge them.

Repeat until: `pnpm build` exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(voice): transplant actioneer-voice campaign studio, runner, bridges, omnichannel memory (pipecat-free)"
```

---

### Task 6: Environment + config reconcile

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (voice vars only; do not touch existing secrets)

**Interfaces:**
- Consumes: Task 5's surface (reads the vars at boot via `assertVoiceRuntimeConfigForStartup`).
- Produces: documented env contract for the transplanted surface.

- [ ] **Step 1: Diff env examples and merge voice vars**

```bash
diff $SRC/.env.example .env.example
```

Add to baby's `.env.example` every voice-related var present in `$SRC`'s and absent in baby's — expected set (verify against the diff, copy `$SRC`'s comments): Gupshup (`GUPSHUP_API_KEY`, `GUPSHUP_APP_NAME`, `GUPSHUP_SOURCE_NUMBER`, webhook secret var), recording storage (`VOICE_RECORDING_STORAGE_PROVIDER=local`, `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET` as optional), Fivetran export (optional, disabled by default), `VOICE_POST_CALL_FOLLOWUP_DELAY_MS`, and any `VOICE_*`/`PLIVO_*`/`SARVAM_*`/`CARTESIA_*` keys new to baby. Keep baby-only vars (Clerk, Gemini, DuckDB) untouched.

- [ ] **Step 2: Boot check**

Run: `pnpm dev` (which runs `tsx server.ts`), watch first 30 lines.
Expected: server boots; `assertVoiceRuntimeConfigForStartup` passes or prints actionable missing-var messages (fill `.env.local` accordingly — Plivo/Gemini values exist from the previous voice setup). `startCallEventDispatcher` logs once. Kill the server.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(voice): document transplanted voice/omnichannel env vars"
```

---

### Task 7: End-to-end verification (spec Phase 5)

**Files:** none created; this is the acceptance gate. Needs the dev server running (`pnpm dev`) and, for live-call checks, a cloudflared tunnel on port 3000 (baby-sentinel voice uses its OWN tunnel — do not reuse the Actioneer ngrok on 3001).

- [ ] **Step 1: Static gates**

```bash
pnpm build && pnpm lint
grep -ri pipecat src server.ts package.json && echo FAIL || echo PIPECAT-CLEAN
pnpm vitest run src/lib/__tests__/meta-db-voice-tables.test.ts
```

Expected: build + lint pass, `PIPECAT-CLEAN`, test green.

- [ ] **Step 2: Draft with nothing (soft-dependency contract)**

With the dev server up and a Clerk session cookie (or the agent-login recipe), POST `/api/voice-campaigns` with `{"name":"smoke draft","draftOnly":true}` via the studio UI or curl.
Expected: 200 with a campaign id — no segment, no purpose, no script required.

- [ ] **Step 3: Phone-list-only launch**

In the studio (`/voice-campaigns/new`): name + brief → Generate script → pick voice → paste one test phone number → Launch.
Expected: campaign goes `in_progress`; Plivo dials; Gemini Live answers; call row + transcript appear on the campaign page. This exercises runner → dialer → `plivo-answer` webhook → WS bridge end-to-end.

- [ ] **Step 4: Segment-backed campaign (context enrichment intact)**

Create a campaign from a segment on a dataset with warehouse context (fundsindia if present). Launch (or `simulate-launch`).
Expected: planned calls carry per-recipient `VoiceCustomerContext`; no 503 for datasets without context (raw-number fallback per `$SRC` behavior).

- [ ] **Step 5: Omnichannel loop**

1. POST a Gupshup-shaped inbound payload to `/api/webhooks/gupshup/whatsapp` for the test phone number (copy a sample payload from `$SRC`'s webhook route tests/fixtures or memory docs).
2. Confirm a `channel_events` row: `sqlite3 data/*meta*.sqlite "SELECT channel, event_type FROM channel_events ORDER BY rowid DESC LIMIT 3;"`
3. Launch a call to that number; in the campaign's call config/debug view, confirm the runtime system prompt contains `OMNICHANNEL CUSTOMER MEMORY` with the WhatsApp text.
4. After the call ends with a follow-up-triggering transcript, confirm a `VoiceFollowUp` on the call and a matching outbound `channel_events` row.

- [ ] **Step 6: Insights surfaces**

Open `/voice-campaigns/[id]` insights, `/voice-campaigns/call-logs`, and the run console for the smoke campaign.
Expected: pages render without errors for campaigns created via the new studio.

Also open the `/voice-campaigns` list with the PRE-transplant `voice-campaigns.json` still on disk (spec risk 3): old campaigns written by baby's types (pipecat/provider fields) must load without crashing — extra fields are tolerated. If load throws, either patch the store's parse to ignore unknown provider values or (dev data being disposable) move the old file aside and note it in the report.

- [ ] **Step 7: Final commit + report**

```bash
git add -A && git commit -m "test(voice): transplant verification artifacts"
```

Report to the user: what passed, what needs live credentials still unverified, extra files copied during Task 5 Step 6, and any baby-only pages deleted.
