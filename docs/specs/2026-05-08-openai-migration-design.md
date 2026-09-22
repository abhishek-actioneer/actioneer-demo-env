# OpenAI Migration — Design Spec

**Date:** 2026-05-08
**Branch:** `feat/openai-migration` (to be created off `feat/clerk-auth-merged`)
**Author:** Vimarsh + Claude
**Status:** Design — pending user review before plan generation

---

## 1. Goal

Move every LLM call in baby-sentinel from Google Gemini (`@google/genai`) to OpenAI (`openai` SDK), using the **Responses API** end-to-end. The migration is a **hard cutover**: no dual-provider fallback, no shim, no Cerebras.

After this work:
- One LLM provider (OpenAI), one API surface (Responses API), one default model (`gpt-5.4`).
- One abstraction file (`src/lib/llm.ts`); legacy `src/lib/gemini.ts` deleted.
- Prompt builders return `{ system, user }` (or `Message[]`) instead of single concatenated strings.
- All 37 LLM-using API routes flow through the abstraction; no direct SDK imports.

## 2. Non-goals

- **Per-workload model tiering** (e.g. nano for classify, full for synthesis). Single default is intentional; tiering is a follow-up knob.
- **Reasoning-effort tuning per call site.** Free knob from the Responses API; not in scope.
- **Cost/latency benchmarking before cutover.** Monitoring is a post-cutover task, not a gate.
- **Refactoring the agent system architecture** (subagent registry, parallel orchestration, SSE protocol). Untouched.
- **Adding `json_schema` to all 22 JSON-mode sites.** Only the one site that already uses `responseSchema` (decks/process) gets a strict schema; the rest stay at `json_object` (loose JSON guarantee). Schema-tightening is a future hardening pass.
- **Anthropic / multi-provider abstraction.** OpenAI only.

## 3. Final-state architecture

```
src/lib/
  openai-client.ts   ← NEW. Lazy-init OpenAI singleton.
  llm.ts             ← REWRITTEN. Messages-based; Responses API; ~150 lines.
  model-registry.ts  ← SHRUNK. One entry: gpt-5.4.
  gemini.ts          ← DELETED.

src/lib/prompts/*.ts (12 files)
                     ← REFACTORED. Each builder returns { system, user } or Message[].

src/app/api/**/route.ts (37 routes)
                     ← MIGRATED. All call llm.ts (no direct @google/genai).
```

### Public API of `llm.ts`

```ts
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateOptions = {
  messages: Message[];
  model?: ModelId;            // defaults to env OPENAI_MODEL or "gpt-5.4"
  jsonMode?: boolean;          // → response_format: { type: "json_object" }
  jsonSchema?: object;         // → response_format: { type: "json_schema", ... }
  timeoutMs?: number;          // default 60s
  metadata?: Record<string, string>;  // for PostHog: { subagent, route }
};

export function generateText(opts: GenerateOptions): Promise<string>;
export function generateTextStream(opts: GenerateOptions): AsyncIterable<string>;
```

Internally both call `client.responses.create({...})` or `client.responses.stream({...})` and extract text content / `output_text.delta` chunks respectively.

### `openai-client.ts`

```ts
import OpenAI from "openai";

let _client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}
```

Mirrors today's lazy Gemini init (commit `20a9ca0`) so the build doesn't crash without the key.

### `model-registry.ts`

```ts
export const MODELS = {
  "gpt-5.4": { id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
} as const;

export const DEFAULT_MODEL: ModelId = "gpt-5.4";
export type ModelId = keyof typeof MODELS;
```

Reduced from current Gemini + 2 Cerebras entries. Kept only because PostHog observability events tag with a `model` field.

## 4. Components & files

### 4.1 Core (3 files)
| File | Action | Notes |
|------|--------|-------|
| `src/lib/openai-client.ts` | **NEW** (~30 LOC) | Lazy singleton. |
| `src/lib/llm.ts` | **REWRITE** (~150 LOC) | Messages-based; Responses API; PostHog wrapper. |
| `src/lib/model-registry.ts` | **SHRINK** | One entry. |
| `src/lib/gemini.ts` | **DELETE** | Legacy direct wrapper. |

### 4.2 Prompt builders (12 files in `src/lib/prompts/`)

Each builder converts from `function build…(): string` to `function build…(): { system: string; user: string }` (or `Message[]` if interleaved). Heavy lifting is in:
- `sql.ts` — schema + rules + memory constraints → `system`; user query + intent → `user`.
- `analyze.ts` — 4 templates: agent summary, critique, report generation, quick response.
- `classify.ts` — system has metric list + classification rules; user has the raw query.
- `subagent-config.ts` and per-agent prompt builders — agent role + schema → `system`; task hint → `user`.

Mechanical split for: `schema-generic.ts`, `dataset-enrichment.ts`, `metrics.ts`, `metric-relationships.ts`, `follow-up.ts`, `knowledge.ts`, `connectors.ts`, `actions.ts`, `segments.ts`.

### 4.3 Consumers (~30 files)

| Group | Count | Migration |
|-------|-------|-----------|
| Already use `llm.ts` (`generateText` / `generateTextStream`) | ~16 | Update call sites to pass `messages` instead of single prompt. |
| Use legacy `gemini.ts` (`ai.models.generateContent` etc.) | ~10 | Switch import to `llm.ts`; pass messages. |
| Direct `@google/genai` import — non-multimodal | 3 (`retentions/`, `funnels/`, `segments/generate-config`) | Rewrite to use `llm.ts`. |
| Direct `@google/genai` import — multimodal PDF | 1 (`decks/process`) | Special — see §4.4. |

### 4.4 `decks/process` (PDF + structured output)

Currently the only multimodal route. Migrated to Responses API + Files API:

```ts
const file = await client.files.create({
  file: pdfBlob,
  purpose: "user_data",
});

const response = await client.responses.create({
  model: "gpt-5.4",
  input: [{
    role: "user",
    content: [
      { type: "input_file", file_id: file.id },
      { type: "input_text", text: "<extraction prompt>" },
    ],
  }],
  response_format: {
    type: "json_schema",
    json_schema: { name: "slide_extraction", schema: SLIDE_SCHEMA, strict: true },
  },
});

await client.files.delete(file.id);  // cleanup
```

`SLIDE_SCHEMA` (currently typed `as any`) gets a proper TypeScript type.

### 4.5 Streaming routes (2 files)

- `src/app/api/chat/route.ts` — replace Gemini stream consumer with `generateTextStream({ messages })`. Same `text/plain` ReadableStream output to client. **No client-side change.**
- `src/app/api/analyze/route.ts` — same swap. Plus:
  - Drop the markdown-fence stripping at lines ~300–302 (clean JSON from `response_format`).
  - Thread `metadata: { subagent: agentId, route: "analyze" }` through every per-agent call (SQL gen, summary, critique).

### 4.6 Fence-stripping cleanup
- `classify/route.ts:40` — drop regex strip.
- `analyze/route.ts:300–302` — drop regex strip.

### 4.7 Env vars

`.env.example`, `CLAUDE.md`, and `README.md` updated:

| Var | Action |
|-----|--------|
| `GEMINI_API_KEY` | Removed |
| `GEMINI_MODEL` | Removed |
| `CEREBRAS_API_KEY` | Removed |
| `OPENAI_API_KEY` | **Added** (required) |
| `OPENAI_MODEL` | **Added** (optional, defaults to `gpt-5.4`) |

### 4.8 Dependencies

`package.json`:
- Remove: `@google/genai`
- Add: `openai` (latest)

### 4.9 PostHog observability

The recent integration (commit `7d521c9`) wraps Gemini calls. The wrapper logic moves into the new `llm.ts` so all OpenAI calls emit `$ai_generation` events automatically. `metadata` field on `GenerateOptions` flows into PostHog properties (`$ai_metadata_subagent`, `$ai_metadata_route`) for filtering.

### 4.10 Test scripts

`scripts/test-competitor-research.ts` and other one-shot tsx scripts under `scripts/` — quick audit for direct Gemini imports; update to use `llm.ts`.

## 5. Subagent system — what changes & what doesn't

### Unchanged
- 6 dataset agents + 3 universal agents + 1 critique agent.
- Agent registry / `AgentSpec` / `AgentQuerySpec` types.
- Parallel orchestration (`runConcurrent`, `Promise.allSettled`).
- Per-agent SQL gen → DuckDB exec → summary pipeline.
- SSE protocol (`sql`, `query_result`, `summary`, `text`, `report`, `done`).
- OOM-aware `retryWithError()` heuristic (provider-agnostic).

### Changed
1. **LLM provider swap per call.** A typical deep-mode query makes ~20 LLM calls (9 parallel SQL gen + 9 parallel summaries + 1 critique + 1 streaming synthesis). All move to OpenAI.
2. **Prompt structure.** Per-agent prompts split: agent role + schema → `system`; task spec → `user`.
3. **JSON parsing.** Drop fence-strip; rely on `response_format: { type: "json_object" }` for SQL gen output.
4. **Streaming chunk extraction.** Synthesis stream uses `output_text.delta` events; the SSE wrapper that converts deltas → `text` events is updated.
5. **Per-subagent metadata.** Each subagent call passes `metadata: { subagent: <id> }` for PostHog filtering.

### Risks (post-cutover monitoring, not pre-cutover gates)
- **Cost.** ~20 calls × `gpt-5.4` per deep query is materially pricier than `gemini-3-flash-preview`. Worth a back-of-envelope estimate after first real-world deep run.
- **Latency.** Deep mode is gated by the slowest call in each parallel batch. If `gpt-5.4` p95 > Gemini Flash p95, deep mode gets slower. Mitigation knob (out of scope): per-subagent `reasoning: { effort: "low" }` for SQL gen.

## 6. Phasing (single branch, multiple commits)

Branch: `feat/openai-migration` off current `feat/clerk-auth-merged`.

**Phase 1 — Foundation**
- Add `openai` dep, drop `@google/genai`.
- Write `src/lib/openai-client.ts` and new `src/lib/llm.ts`.
- Shrink `src/lib/model-registry.ts`.
- Update env vars + `.env.example` + `CLAUDE.md`.
- Build will be broken at this point (call-site signatures changed); this is intentional.

**Phase 2 — Prompt refactor**
- 12 prompt builders return `{ system, user }`.
- Includes subagent prompts (`subagent-config.ts`, `getAgentSummaryTemplate`, `getCritiqueSummaryTemplate`).

**Phase 3 — Consumer migration**
- 16 `llm.ts` callers updated.
- 10 legacy `gemini.ts` callers re-pointed and updated.
- 3 direct routes (`retentions/`, `funnels/`, `segments/generate-config`) rewritten.
- Compile-time errors guide the work; no consumer left behind.

**Phase 4 — Special routes**
- `decks/process`: Files API + Responses API for PDF; `json_schema` strict output.
- `analyze` + `chat`: streaming chunk-extraction swap.
- PostHog observability wired to `metadata`.

**Phase 5 — Cleanup**
- Delete `src/lib/gemini.ts`.
- Drop `GEMINI_*` / `CEREBRAS_*` from `.env.example` / `README` / `CLAUDE.md`.
- Smoke-test all routes manually (chat, analyze quick + deep, classify, segment-create, playbook-edit, board-generate, decks/process, retentions/funnels/segments generate-config).
- Update CLAUDE.md "Required Environment" + "Architecture > LLM Layer" sections.

## 7. Testing & validation

- **Compile-time**: `pnpm build` passes — TypeScript catches missed call-site migrations.
- **Lint**: `pnpm lint` clean.
- **Smoke tests** (manual, in dev):
  - `/api/classify` — analytics + direct + competitor_research routing.
  - `/api/chat` — streaming text response.
  - `/api/analyze` — quick mode + deep mode (verify all 9+ subagents fire, summaries render, critique fires, report streams).
  - `/api/segments/generate-config` and `generate-sql` — segment creation.
  - `/api/playbook/{intent,create}` — playbook generation.
  - `/api/board-generate` — board synthesis.
  - `/api/decks/process` — PDF upload (use a sample deck).
  - `/api/funnels/generate-config` and `/api/retentions/generate-config`.
- **Observability**: confirm PostHog `$ai_generation` events fire for OpenAI calls, with `$ai_metadata_subagent` populated on analyze deep mode.

## 8. Open follow-ups (not in scope for this migration)

- Per-workload model tiering (gpt-5.4-mini for classify, full for synthesis).
- Reasoning-effort tuning per call site.
- Tighten 22 `json_object` sites with proper `json_schema` schemas.
- Cost dashboard / budget alerts.
- Cerebras / multi-provider story if/when it becomes a real need again.

## 9. Decisions log (from brainstorming)

| Question | Decision |
|----------|----------|
| Cutover scope | Hard cutover, rip Gemini out. |
| Cerebras fate | Drop Cerebras too — OpenAI only. |
| Model strategy | `gpt-5.4` for everything (single default). |
| API surface | Move to messages array (`{ role, content }`). |
| PDF handling | OpenAI Responses API + Files. |
| Chat Completions vs Responses | Responses API everywhere. |

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `gpt-5.4` model ID wrong / unavailable | Verify against OpenAI model list at start of Phase 1; fall back to closest available if needed (with user confirmation). |
| OpenAI cost spike on deep mode | Flag in CLAUDE.md / monitor PostHog after first deep query in dev. |
| Latency regression on deep mode | Same — monitor p95; reasoning-effort knob available as fast follow-up. |
| Missed call-site during migration | TS compile errors will catch all signature-changed sites; build-passes is the gate. |
| Streaming chunk-shape regression | Smoke test chat + analyze streaming end-to-end before merge. |
| PDF (`decks/process`) regression | Test with a real sample deck; verify `SLIDE_SCHEMA` strict mode produces valid output. |
| PostHog observability regression | Verify `$ai_generation` events fire in dev with new wrapper; check at least one run shows `metadata.subagent`. |
