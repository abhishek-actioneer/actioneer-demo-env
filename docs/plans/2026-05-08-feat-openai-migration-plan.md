# OpenAI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Task tracking:** Per `CLAUDE.md`, use `bd` (beads) for cross-session task state. Plan checkboxes are for in-document progress.

**Goal:** Migrate baby-sentinel from Google Gemini (`@google/genai`) to OpenAI (`openai` SDK, Responses API) end-to-end. Hard cutover. Single model: `gpt-5.4`.

**Architecture:** One client (OpenAI), one API surface (Responses API), one default model. New `llm.ts` exposes `generateText({ messages, ... })` and `generateTextStream({ messages, ... })`. Prompt builders return `{ system, user }` instead of single strings. PostHog observability wraps every call.

**Tech Stack:** Next.js 16 · TypeScript · `openai` SDK · OpenAI Responses API · PostHog LLM analytics

**Spec:** [`docs/specs/2026-05-08-openai-migration-design.md`](../specs/2026-05-08-openai-migration-design.md)

**Verification model (this codebase has no test runner):**
- `pnpm build` — TypeScript compile errors are the primary "test" (signature changes catch missed call sites).
- `pnpm lint` — ESLint clean.
- Manual smoke per route (commands + expected behavior listed in each task).

---

## Phase 0 — Setup

### Task 0.1: Branch — N/A

> **Decision (2026-05-08):** Work directly on `feat/clerk-auth-merged`. No separate migration branch. Migration commits will land alongside other in-progress work on this branch. Per user rule, **no commits at all** during execution — only the user creates commits.

- [x] N/A — working in `feat/clerk-auth-merged`

---

### Task 0.2: Verify `gpt-5.4` model availability — DEFERRED

> **Decision (2026-05-08):** `OPENAI_API_KEY` not yet set in `.env.local`. Verification deferred. Code phases (1, 2, 4) don't require a live API call. The first smoke test in Phase 2 will surface a model-not-found error if `gpt-5.4` is the wrong ID; cheap to update at that point.
>
> **Action item for user:** add `OPENAI_API_KEY=...` to `.env.local` before Phase 2 smoke test.

- [ ] **(deferred)** Run model availability check before first smoke test:
  ```bash
  curl -s https://api.openai.com/v1/models \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    | jq -r '.data[].id' | grep -i "gpt-5"
  ```

---

## Phase 1 — Foundation

### Task 1.1: Update dependencies ✅ DONE (2026-05-08, unstaged per user rule)

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto)

- [x] **Step 1: Add `openai`, remove `@google/genai`** — installed `openai@6.37.0`, removed `@google/genai@1.41.0`

```bash
pnpm add openai
pnpm remove @google/genai
```

- [ ] **Step 2: Verify**

```bash
pnpm list openai
pnpm list @google/genai
```
Expected: `openai` listed; `@google/genai` not found.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): swap @google/genai for openai"
```

---

### Task 1.2: Create `openai-client.ts` (lazy singleton) ✅ DONE (2026-05-08)

**Files:**
- Create: `src/lib/openai-client.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/openai-client.ts
import OpenAI from "openai";

let _client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required but missing from environment");
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}
```

- [ ] **Step 2: Verify file compiles in isolation**

```bash
pnpm exec tsc --noEmit src/lib/openai-client.ts
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/openai-client.ts
git commit -m "feat(llm): add lazy OpenAI client singleton"
```

---

### Task 1.3: Shrink `model-registry.ts` to OpenAI-only ✅ DONE (2026-05-08)

**Files:**
- Modify: `src/lib/model-registry.ts`

- [ ] **Step 1: Read current file**

```bash
cat src/lib/model-registry.ts
```
Note current Gemini + Cerebras entries.

- [ ] **Step 2: Replace with OpenAI-only registry**

```ts
// src/lib/model-registry.ts
export const MODELS = {
  "gpt-5.4": {
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "openai" as const,
  },
} as const;

export type ModelId = keyof typeof MODELS;
export type LLMModel = (typeof MODELS)[ModelId];

export const DEFAULT_MODEL: ModelId = "gpt-5.4";

export function isValidModelId(id: string): id is ModelId {
  return id in MODELS;
}
```

- [ ] **Step 3: Verify TS**

```bash
pnpm exec tsc --noEmit
```
Expected: errors only at sites that referenced removed Gemini/Cerebras model IDs (these are fixed in later tasks). The `model-registry.ts` file itself should compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/model-registry.ts
git commit -m "feat(llm): shrink model registry to gpt-5.4 only"
```

---

### Task 1.4: Rewrite `llm.ts` with messages-based Responses API ✅ DONE (2026-05-08)

> Implemented with proper SDK types (no `as any`). PostHog observability preserved on success + error paths in both `generateText` and `generateTextStream`. Side-effect: extended `posthog-server.ts` `provider` union to include `"openai"`.

**Files:**
- Modify: `src/lib/llm.ts` (full rewrite)

- [ ] **Step 1: Replace file contents**

```ts
// src/lib/llm.ts
import { getOpenAI } from "./openai-client";
import { DEFAULT_MODEL, type ModelId } from "./model-registry";

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateOptions = {
  messages: Message[];
  model?: ModelId;
  jsonMode?: boolean;
  jsonSchema?: { name: string; schema: object; strict?: boolean };
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

const DEFAULT_TIMEOUT_MS = 60_000;

function resolveModel(model?: ModelId): string {
  return model ?? (process.env.OPENAI_MODEL as ModelId | undefined) ?? DEFAULT_MODEL;
}

function buildResponseFormat(opts: GenerateOptions) {
  if (opts.jsonSchema) {
    return {
      type: "json_schema" as const,
      json_schema: { ...opts.jsonSchema, strict: opts.jsonSchema.strict ?? true },
    };
  }
  if (opts.jsonMode) {
    return { type: "json_object" as const };
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM ${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function generateText(opts: GenerateOptions): Promise<string> {
  const client = getOpenAI();
  const model = resolveModel(opts.model);
  const responseFormat = buildResponseFormat(opts);

  const response = await withTimeout(
    client.responses.create({
      model,
      input: opts.messages,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    }),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "generateText",
  );

  return response.output_text ?? "";
}

export async function* generateTextStream(opts: GenerateOptions): AsyncIterable<string> {
  const client = getOpenAI();
  const model = resolveModel(opts.model);
  const responseFormat = buildResponseFormat(opts);

  const stream = await client.responses.stream({
    model,
    input: opts.messages,
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      yield event.delta;
    }
  }
}

export { DEFAULT_MODEL, MODELS, type ModelId, type LLMModel } from "./model-registry";
```

- [ ] **Step 2: Compile**

```bash
pnpm exec tsc --noEmit src/lib/llm.ts
```
Expected: clean compile of `llm.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm.ts
git commit -m "feat(llm): rewrite llm.ts on OpenAI Responses API with messages-based shape"
```

---

### Task 1.5: Wire PostHog observability into new `llm.ts` ✅ DONE (2026-05-08, inline with Task 1.4)

**Files:**
- Modify: `src/lib/llm.ts`

- [ ] **Step 1: Locate existing PostHog wrapper**

```bash
git show 7d521c9 --stat
git log --all --oneline -- '*posthog*' '*observability*'
grep -rn "ai_generation\|posthog" src/lib | head
```
Identify the existing PostHog event-emission helper (likely in `src/lib/observability.ts` or inline in `gemini.ts`).

- [ ] **Step 2: Extract or reuse the helper**

If the helper already lives in a shared module, import it. If it's inline in `gemini.ts`, extract to `src/lib/llm-observability.ts` first:

```ts
// src/lib/llm-observability.ts
// (extract the existing $ai_generation event emission used by gemini.ts here)
```

- [ ] **Step 3: Wrap `generateText` and `generateTextStream`**

In `src/lib/llm.ts`, around each call: emit `$ai_generation` start/end events with model, input message count, output token estimate, latency, and `metadata`. Properties: `$ai_metadata_subagent`, `$ai_metadata_route`, etc., flow from `opts.metadata`.

- [ ] **Step 4: Compile**

```bash
pnpm exec tsc --noEmit src/lib/llm.ts src/lib/llm-observability.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm.ts src/lib/llm-observability.ts
git commit -m "feat(llm): wire PostHog $ai_generation events with metadata threading"
```

---

### Task 1.6: Update env vars in `.env.example`, `CLAUDE.md`, `README.md` ✅ DONE (2026-05-08)

**Files:**
- Modify: `.env.example` (or `.env.local.example` if present)
- Modify: `CLAUDE.md` (Required Environment section)
- Modify: `README.md`

- [ ] **Step 1: Find env templates**

```bash
ls -la .env* 2>/dev/null
grep -n "GEMINI_API_KEY\|GEMINI_MODEL\|CEREBRAS" .env* CLAUDE.md README.md 2>/dev/null
```

- [ ] **Step 2: In `.env.example` (or equivalent)**

Remove:
```
GEMINI_API_KEY=
GEMINI_MODEL=
CEREBRAS_API_KEY=
```

Add:
```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
```

- [ ] **Step 3: In `CLAUDE.md` "Required Environment" section**

Replace the Gemini/Cerebras lines with:
```
- `OPENAI_API_KEY` — OpenAI API key (used by all API routes)
- `OPENAI_MODEL` — Optional model override (defaults to `gpt-5.4`)
```

- [ ] **Step 4: In `README.md`**

Same swap.

- [ ] **Step 5: Commit**

```bash
git add .env* CLAUDE.md README.md
git commit -m "docs(env): swap GEMINI/CEREBRAS env vars for OPENAI"
```

---

### Task 1.7: Verify foundation builds (with expected errors elsewhere) ✅ DONE (2026-05-08)

> Baseline: **65 TS errors**, all in consumer files. Categories: signature-change errors (`Expected 1 arguments, but got 2`), missing-module errors for the 4 direct `@google/genai` importers, and a few `unknown` result type errors. Each subsequent phase reduces this count.

**Files:** none

- [ ] **Step 1: Run full build**

```bash
pnpm build 2>&1 | head -60
```
Expected: build FAILS at consumer call sites (every Gemini call site has a stale signature). Foundation files (`openai-client.ts`, `llm.ts`, `model-registry.ts`) compile cleanly. Capture the error count for reference.

- [ ] **Step 2: Note expected baseline**

The error list is the migration to-do for Phases 2–7. Each subsequent commit should reduce this number to zero.

---

## Phase 2 — Migrate `/api/classify` (smallest flow, validates approach)

### Task 2.1: Refactor `prompts/classify.ts` to return `{ system, user }`

**Files:**
- Modify: `src/lib/prompts/classify.ts`

- [ ] **Step 1: Read current builder**

```bash
cat src/lib/prompts/classify.ts | head -200
```
Identify the rules/schema/metric-list block (becomes `system`) and the user-query interpolation (becomes `user`).

- [ ] **Step 2: Update return type and structure**

Change `buildClassifyPrompt(...): string` to:

```ts
import type { Message } from "@/lib/llm";

export function buildClassifyPrompt(args: { /* unchanged inputs */ }): { system: string; user: string } {
  const system = `<rules + metric list + classification spec>`;
  const user = `<the raw user query>`;
  return { system, user };
}
```

- [ ] **Step 3: Compile builder file**

```bash
pnpm exec tsc --noEmit src/lib/prompts/classify.ts
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/classify.ts
git commit -m "refactor(prompts): split classify builder into {system, user}"
```

---

### Task 2.2: Migrate `/api/classify/route.ts`

**Files:**
- Modify: `src/app/api/classify/route.ts`

- [ ] **Step 1: Replace Gemini call with `generateText` + JSON mode**

Locate the existing call (line ~39). Replace with:

```ts
import { generateText } from "@/lib/llm";
import { buildClassifyPrompt } from "@/lib/prompts/classify";

const { system, user } = buildClassifyPrompt({ /* existing args */ });

const text = await generateText({
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  jsonMode: true,
  metadata: { route: "classify" },
});

const parsed = JSON.parse(text);
```

- [ ] **Step 2: Delete fence-strip regex**

Remove the line that does `text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "")`. Not needed with `jsonMode: true`.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/classify/route.ts
```
Expected: clean.

- [ ] **Step 4: Smoke test**

```bash
pnpm dev &
sleep 3
curl -s -X POST http://localhost:3000/api/classify \
  -H "Content-Type: application/json" \
  -H "x-dataset-id: quickhelp" \
  -d '{"query":"what was DAU last week"}' | jq
```
Expected: JSON response with `mode: "analytics"` (or appropriate mode). No fence-stripping errors. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/classify/route.ts
git commit -m "feat(classify): migrate to OpenAI llm.ts; drop fence-strip"
```

---

## Phase 3 — Migrate `/api/chat` (streaming text)

### Task 3.1: Migrate `/api/chat/route.ts` streaming

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Locate the streaming block**

```bash
grep -n "generateContentStream\|generateTextStream" src/app/api/chat/route.ts
```

- [ ] **Step 2: Replace Gemini stream consumer**

```ts
import { generateTextStream } from "@/lib/llm";

const systemContext = getSystemContext(datasetId);
const stream = generateTextStream({
  messages: [
    { role: "system", content: systemContext },
    { role: "user", content: userQuery },
  ],
  metadata: { route: "chat" },
});

const responseStream = new ReadableStream({
  async start(controller) {
    try {
      for await (const text of stream) {
        controller.enqueue(new TextEncoder().encode(text));
      }
      controller.close();
    } catch (err) {
      controller.error(err);
    }
  },
});

return new Response(responseStream, {
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});
```

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/chat/route.ts
```
Expected: clean.

- [ ] **Step 4: Smoke test**

```bash
pnpm dev &
sleep 3
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-dataset-id: quickhelp" \
  -d '{"query":"what is the schema?"}'
```
Expected: streaming text response (visible incremental output). Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): migrate streaming to OpenAI Responses API"
```

---

## Phase 4 — Migrate `/api/analyze` (subagents, deep mode, streaming)

### Task 4.1: Refactor `prompts/sql.ts`

**Files:**
- Modify: `src/lib/prompts/sql.ts`

- [ ] **Step 1: Convert `buildTextToSqlPrompt(...)` to `{ system, user }`**

Schema + rules + memory constraints → `system`. Intent + user query → `user`.

```ts
export function buildTextToSqlPrompt(args: { /* unchanged */ }): { system: string; user: string } {
  const system = `<schema + rules + memory constraints + intent mapping rules>`;
  const user = `<the natural language question + any agent context>`;
  return { system, user };
}
```

- [ ] **Step 2: Compile**

```bash
pnpm exec tsc --noEmit src/lib/prompts/sql.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/sql.ts
git commit -m "refactor(prompts): split sql builder into {system, user}"
```

---

### Task 4.2: Refactor `prompts/analyze.ts` (4 templates)

**Files:**
- Modify: `src/lib/prompts/analyze.ts`

- [ ] **Step 1: Convert each template**

The 4 templates: `getAgentSummaryTemplate`, `getCritiqueSummaryTemplate`, `getReportGenerationTemplate`, `getQuickResponseTemplate`. Each returns `{ system, user }` instead of a single string.

For each: persona/rules/chart instructions → `system`; the per-call data (query results, summaries, user question) → `user`.

- [ ] **Step 2: Keep `CHART_BLOCK_INSTRUCTIONS` constant in `system`**

The chart fence-block schema lives in the system prompt for synthesis templates.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/lib/prompts/analyze.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/analyze.ts
git commit -m "refactor(prompts): split analyze.ts 4 templates into {system, user}"
```

---

### Task 4.3: Refactor `subagent-config.ts` per-agent prompt builders

**Files:**
- Modify: `src/lib/subagent-config.ts`

- [ ] **Step 1: Locate `SUBAGENT_TASK_PROMPTS`**

```bash
grep -n "SUBAGENT_TASK_PROMPTS\|SUBAGENT_TASKS" src/lib/subagent-config.ts
```

- [ ] **Step 2: Convert per-agent prompt outputs**

If `SUBAGENT_TASK_PROMPTS` returns strings, convert to `{ system, user }` per agent:
- `system`: agent role + agent's domain expertise + schema reminder.
- `user`: task hint + query specs.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/lib/subagent-config.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/subagent-config.ts
git commit -m "refactor(subagents): split per-agent prompts into {system, user}"
```

---

### Task 4.4: Migrate `sql-generator.ts`

**Files:**
- Modify: `src/lib/sql-generator.ts`

- [ ] **Step 1: Replace Gemini calls in `generateSingleQuery` and `generateAgentQueries`**

Each call site:
```ts
import { generateText } from "@/lib/llm";
import { buildTextToSqlPrompt } from "@/lib/prompts/sql";

const { system, user } = buildTextToSqlPrompt({ /* args */ });
const text = await generateText({
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  jsonMode: true,
  metadata: { route: "analyze", subagent: agentId, phase: "sql_generation" },
});
const queries: string[] = JSON.parse(text);
```

- [ ] **Step 2: Update `retryWithError` (OOM-aware retry)**

Same shape — append the error message into a follow-up `user` message. The retry function takes the original messages array, appends an `assistant` echo + a new `user` correction, and re-calls `generateText`.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/lib/sql-generator.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/sql-generator.ts
git commit -m "feat(sql-gen): migrate text-to-SQL pipeline to OpenAI"
```

---

### Task 4.5: Migrate `/api/analyze/route.ts` (streaming + metadata threading)

**Files:**
- Modify: `src/app/api/analyze/route.ts`

- [ ] **Step 1: Replace per-agent summary calls**

For each agent summary in deep mode:

```ts
import { generateText } from "@/lib/llm";
import { getAgentSummaryTemplate } from "@/lib/prompts/analyze";

const { system, user } = getAgentSummaryTemplate({ agent, results });
const summary = await generateText({
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  metadata: { route: "analyze", subagent: agent.id, phase: "summary" },
});
```

- [ ] **Step 2: Replace critique call**

```ts
const { system, user } = getCritiqueSummaryTemplate({ agentSummaries, rawResults });
const critique = await generateText({
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  metadata: { route: "analyze", subagent: "critique", phase: "critique" },
});
```

- [ ] **Step 3: Replace synthesis stream**

```ts
import { generateTextStream } from "@/lib/llm";

const { system, user } = getReportGenerationTemplate({ /* args */ }); // or quick template
const stream = generateTextStream({
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  metadata: { route: "analyze", phase: "synthesis", mode: deep ? "deep" : "quick" },
});

for await (const delta of stream) {
  send({ type: "text", delta });
  fullText += delta;
}
```

- [ ] **Step 4: Drop fence-strip on report markdown**

Remove the regex strip at lines ~300–302 (was: `.replace(/^```(?:markdown)?\n?/i, "").replace(/\n?```$/i, "").trim()`).

- [ ] **Step 5: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/analyze/route.ts
```
Expected: clean.

- [ ] **Step 6: Smoke test — quick mode**

```bash
pnpm dev &
sleep 3
curl -N -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -H "x-dataset-id: quickhelp" \
  -d '{"query":"what was DAU last 7 days","mode":"quick"}'
```
Expected: SSE stream with `phase`, `sql`, `query_result`, `text`, `done` events. Final text streams visibly.

- [ ] **Step 7: Smoke test — deep mode**

```bash
curl -N -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -H "x-dataset-id: quickhelp" \
  -d '{"query":"give me a deep dive on user retention","mode":"deep"}' \
  | head -200
```
Expected: SSE stream shows ~9 subagents firing in parallel (multiple `sql` events), `summary` events per agent, critique, then streaming `text`, then `report`, then `done`. Kill dev server.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/analyze/route.ts
git commit -m "feat(analyze): migrate quick + deep modes to OpenAI; metadata per subagent"
```

---

## Phase 5 — Generators and remaining LLM callers

### Task 5.1: Migrate dataset enrichment generators

**Files:**
- Modify: `src/lib/datasets/schema-enricher.ts`
- Modify: `src/lib/datasets/event-generator.ts`
- Modify: `src/lib/datasets/metric-generator.ts`
- Modify: `src/lib/knowledge-generator.ts`
- Modify: `src/lib/prompts/dataset-enrichment.ts`
- Modify: `src/lib/prompts/metrics.ts`
- Modify: `src/lib/prompts/knowledge.ts`

- [ ] **Step 1: Refactor each prompt builder**

Each prompt file in `src/lib/prompts/` returns `{ system, user }` (mechanical split: schema/rules/persona → system; per-call data → user).

- [ ] **Step 2: Update each generator's call site**

Pattern:
```ts
import { generateText } from "@/lib/llm";

const { system, user } = buildXPrompt({...});
const text = await generateText({
  messages: [{ role: "system", content: system }, { role: "user", content: user }],
  jsonMode: true,
  metadata: { route: "dataset-enrichment", step: "<column-analysis|prompts|metrics|events>" },
});
```

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/lib/datasets/*.ts src/lib/knowledge-generator.ts src/lib/prompts/*.ts
```

- [ ] **Step 4: Smoke test enrichment**

Pick an existing dataset (e.g. `rides-data` or `zomato-raw` per `data/datasets/`). Back up its `schema-map.json`, delete it, then trigger re-enrichment:

```bash
DATASET_ID=zomato-raw
cp "data/datasets/$DATASET_ID/schema-map.json" "data/datasets/$DATASET_ID/schema-map.json.bak"
rm "data/datasets/$DATASET_ID/schema-map.json"
pnpm dev &
sleep 3
# Hit any route that resolves the dataset (forces re-enrichment via dynamic-registry):
curl -s http://localhost:3000/api/datasets/$DATASET_ID/prompts | jq '.suggestedPrompts | length'
```
Expected: positive integer (suggested prompts regenerated). Verify `schema-map.json` was rewritten and contains agent specs + metric definitions. Restore backup if anything broke. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add src/lib/datasets/ src/lib/knowledge-generator.ts src/lib/prompts/dataset-enrichment.ts src/lib/prompts/metrics.ts src/lib/prompts/knowledge.ts
git commit -m "feat(datasets): migrate enrichment + metric + knowledge generators to OpenAI"
```

---

### Task 5.2: Migrate server-side generators

**Files:**
- Modify: `src/lib/server/retention-generator.ts`
- Modify: `src/lib/server/funnel-generator.ts`
- Modify: `src/lib/server/segment-generator.ts`
- Modify: `src/lib/server/competitor-report-assembler.ts`
- Modify: `src/lib/prompts/segments.ts`

- [ ] **Step 1: Refactor `prompts/segments.ts` to `{ system, user }`**

- [ ] **Step 2: Update each generator call site**

Same pattern as 5.1.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/lib/server/*.ts src/lib/prompts/segments.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/ src/lib/prompts/segments.ts
git commit -m "feat(server-gen): migrate retention + funnel + segment + competitor generators"
```

---

### Task 5.3: Migrate playbook routes

**Files:**
- Modify: `src/app/api/playbook/edit/route.ts`
- Modify: `src/app/api/playbook/intent/route.ts`
- Modify: `src/app/api/playbook/create/route.ts` (if exists)
- Modify: `src/app/api/playbook/autofix/route.ts` (if exists)
- Modify: `src/app/api/playbook/clarify/route.ts` (if exists)
- Modify any related prompt files in `src/lib/prompts/` (e.g. `actions.ts`, `follow-up.ts`)

- [ ] **Step 1: Refactor `prompts/actions.ts` and `prompts/follow-up.ts` to `{ system, user }`**

- [ ] **Step 2: Update each playbook route**

Same pattern.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/playbook/*/route.ts
```

- [ ] **Step 4: Smoke test**

```bash
pnpm dev &
sleep 3
curl -X POST http://localhost:3000/api/playbook/intent \
  -H "Content-Type: application/json" \
  -H "x-dataset-id: quickhelp" \
  -d '{"prompt":"reactivate dormant users"}' | jq
```
Expected: structured intent JSON. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/playbook/ src/lib/prompts/actions.ts src/lib/prompts/follow-up.ts
git commit -m "feat(playbook): migrate all playbook routes to OpenAI"
```

---

### Task 5.4: Migrate `board-generate` and other remaining `gemini.ts` consumers

**Files:**
- Modify: `src/app/api/board-generate/route.ts`
- Modify: `src/app/api/board-from-research/route.ts` (if it imports `gemini.ts`)
- Modify: any consumers of `prompts/connectors.ts` and `prompts/metric-relationships.ts`
- Modify: `src/lib/prompts/connectors.ts` (refactor to `{ system, user }`)
- Modify: `src/lib/prompts/metric-relationships.ts` (refactor to `{ system, user }`)
- Modify: any remaining files imported from `gemini.ts`

- [ ] **Step 1: List remaining `gemini.ts` importers**

```bash
grep -rn "from \"@/lib/gemini\"\|from '@/lib/gemini'" src/
grep -rn "buildConnectorPrompt\|buildMetricRelationshipPrompt" src/
```

- [ ] **Step 2: Refactor remaining prompt builders to `{ system, user }`**

`prompts/connectors.ts` and `prompts/metric-relationships.ts` (mechanical split).

- [ ] **Step 3: Migrate each consumer**

Same pattern. Each prompt builder gets `{ system, user }`; each call site uses `generateText` / `generateTextStream`.

- [ ] **Step 4: Compile**

```bash
pnpm build 2>&1 | tail -20
```
Expected: error count significantly reduced. Remaining errors should now be in the 4 direct-importer routes (handled in Phase 6).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ src/lib/
git commit -m "feat(llm): migrate remaining gemini.ts consumers (board-generate, connectors, metric-relationships)"
```

---

## Phase 6 — Direct `@google/genai` importers (non-multimodal)

### Task 6.1: Migrate `/api/retentions/generate-config`

**Files:**
- Modify: `src/app/api/retentions/generate-config/route.ts`

- [ ] **Step 1: Replace direct GoogleGenAI client + generateContent**

```ts
import { generateText } from "@/lib/llm";
// Drop: import { GoogleGenAI } from "@google/genai";

const { system, user } = buildRetentionConfigPrompt({...});
const text = await generateText({
  messages: [{ role: "system", content: system }, { role: "user", content: user }],
  jsonMode: true,
  metadata: { route: "retentions/generate-config" },
});
const config = JSON.parse(text);
```

- [ ] **Step 2: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/retentions/generate-config/route.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/retentions/generate-config/route.ts
git commit -m "feat(retentions): migrate generate-config to OpenAI llm.ts"
```

---

### Task 6.2: Migrate `/api/funnels/generate-config`

**Files:**
- Modify: `src/app/api/funnels/generate-config/route.ts`

- [ ] **Step 1: Same pattern as 6.1**

- [ ] **Step 2: Compile + commit**

```bash
pnpm exec tsc --noEmit src/app/api/funnels/generate-config/route.ts
git add src/app/api/funnels/generate-config/route.ts
git commit -m "feat(funnels): migrate generate-config to OpenAI llm.ts"
```

---

### Task 6.3: Migrate `/api/segments/generate-config` and `generate-sql`

**Files:**
- Modify: `src/app/api/segments/generate-config/route.ts`
- Modify: `src/app/api/segments/generate-sql/route.ts` (if it also imports `@google/genai`)

- [ ] **Step 1: Same pattern**

- [ ] **Step 2: Compile + commit**

```bash
pnpm exec tsc --noEmit src/app/api/segments/
git add src/app/api/segments/generate-config src/app/api/segments/generate-sql
git commit -m "feat(segments): migrate generate-config + generate-sql to OpenAI llm.ts"
```

---

## Phase 7 — `decks/process` (multimodal PDF + structured output)

### Task 7.1: Type `SLIDE_SCHEMA` properly

**Files:**
- Modify: `src/app/api/decks/process/route.ts`

- [ ] **Step 1: Find current schema**

```bash
grep -n "SLIDE_SCHEMA" src/app/api/decks/process/route.ts
```

- [ ] **Step 2: Type the schema as a JSON Schema object**

Replace `SLIDE_SCHEMA as any` with a properly-typed `JsonSchemaObject` (use `z.infer` if Zod is present, or hand-type the JSON Schema).

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/decks/process/route.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/decks/process/route.ts
git commit -m "refactor(decks): type SLIDE_SCHEMA properly (drop `as any`)"
```

---

### Task 7.2: Rewrite `decks/process` on Files API + Responses API

**Files:**
- Modify: `src/app/api/decks/process/route.ts`

- [ ] **Step 1: Replace upload + analyze flow**

```ts
import { getOpenAI } from "@/lib/openai-client";
import { DEFAULT_MODEL } from "@/lib/model-registry";

const client = getOpenAI();

// 1. Upload PDF
const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
const file = await client.files.create({
  file: new File([pdfBuffer], filename, { type: "application/pdf" }),
  purpose: "user_data",
});

try {
  // 2. Extract via Responses API with structured output
  const response = await client.responses.create({
    model: DEFAULT_MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_file", file_id: file.id },
        { type: "input_text", text: "<the existing extraction prompt text>" },
      ],
    }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "slide_extraction",
        schema: SLIDE_SCHEMA,
        strict: true,
      },
    },
  });

  const slides = JSON.parse(response.output_text);
  // ... existing post-processing
} finally {
  // 3. Cleanup uploaded file
  await client.files.delete(file.id).catch(() => {});
}
```

- [ ] **Step 2: Drop `@google/genai` imports**

```bash
grep -n "@google/genai" src/app/api/decks/process/route.ts
```
Should return nothing.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit src/app/api/decks/process/route.ts
```

- [ ] **Step 4: Smoke test with a real PDF**

```bash
pnpm dev &
sleep 3
# Use a sample deck from the project (or any small PDF)
curl -X POST http://localhost:3000/api/decks/process \
  -F "file=@/path/to/sample.pdf" \
  -H "x-dataset-id: quickhelp" | jq '.slides | length'
```
Expected: positive integer (slide count). JSON conforms to SLIDE_SCHEMA. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/decks/process/route.ts
git commit -m "feat(decks): migrate PDF processing to OpenAI Files + Responses API"
```

---

## Phase 8 — Cleanup & finalization

### Task 8.1: Delete `src/lib/gemini.ts`

**Files:**
- Delete: `src/lib/gemini.ts`

- [ ] **Step 1: Verify no remaining importers**

```bash
grep -rn "from \"@/lib/gemini\"\|from '@/lib/gemini'" src/
```
Expected: no matches.

- [ ] **Step 2: Delete file**

```bash
git rm src/lib/gemini.ts
```

- [ ] **Step 3: Compile**

```bash
pnpm build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(llm): delete legacy gemini.ts"
```

---

### Task 8.2: Audit scripts/ for direct Gemini usage

**Files:**
- Possibly modify: `scripts/test-competitor-research.ts`
- Possibly modify: any other tsx script under `scripts/`

- [ ] **Step 1: Grep**

```bash
grep -rn "@google/genai\|GoogleGenAI" scripts/
```

- [ ] **Step 2: Migrate any matches**

Same `generateText({ messages })` pattern.

- [ ] **Step 3: Compile**

```bash
pnpm exec tsc --noEmit scripts/*.ts scripts/*.mjs 2>&1 | head
```

- [ ] **Step 4: Commit**

```bash
git add scripts/
git commit -m "chore(scripts): migrate one-shot scripts to OpenAI llm.ts"
```

---

### Task 8.3: Final lint + build

**Files:** none

- [ ] **Step 1: Lint**

```bash
pnpm lint
```
Expected: clean.

- [ ] **Step 2: Build**

```bash
pnpm build
```
Expected: clean.

- [ ] **Step 3: Verify no Gemini residue**

```bash
grep -rn "@google/genai\|GoogleGenAI\|GEMINI_API_KEY\|GEMINI_MODEL\|gemini-3-flash\|CEREBRAS" src/ scripts/ 2>/dev/null
```
Expected: no matches.

- [ ] **Step 4: If any residue found, fix it and commit**

```bash
git add -A
git commit -m "chore(llm): remove last Gemini/Cerebras residue"
```

---

### Task 8.4: Update `CLAUDE.md` Architecture > LLM Layer section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find LLM Layer / Architecture section**

```bash
grep -n "Architecture\|LLM Layer\|Stack:" CLAUDE.md
```

- [ ] **Step 2: Update**

Replace any "Google Gemini (`@google/genai`)" with "OpenAI (`openai` SDK, Responses API)". Replace any reference to dual-provider Gemini+Cerebras with the single OpenAI provider. Update the model name references from `gemini-3-flash-preview` to `gpt-5.4`.

- [ ] **Step 3: Add a one-liner about the new `Message`-based shape and `metadata` threading**

In the Key Modules section, update the `llm.ts` description.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document OpenAI Responses API migration"
```

---

### Task 8.5: End-to-end smoke walkthrough

**Files:** none (manual verification)

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Walk through each route in the browser or via curl**

Tick each as it works:
- [ ] `/api/classify` — analytics + direct + competitor_research routing
- [ ] `/api/chat` — streaming text response
- [ ] `/api/analyze` — quick mode (single SQL → response)
- [ ] `/api/analyze` — deep mode (~9 subagents fire, summaries render, critique runs, report streams)
- [ ] `/api/segments/generate-sql` — segment SQL gen
- [ ] `/api/segments/generate-config` — segment config gen
- [ ] `/api/playbook/intent` — playbook intent
- [ ] `/api/playbook/create` (or `/edit`) — playbook generation
- [ ] `/api/board-generate` — board synthesis
- [ ] `/api/decks/process` — PDF upload + slide extraction
- [ ] `/api/funnels/generate-config` — funnel gen
- [ ] `/api/retentions/generate-config` — retention gen

- [ ] **Step 3: Verify PostHog events**

If PostHog dev mode is enabled, confirm `$ai_generation` events fire with `$ai_metadata_subagent` populated for at least one analyze deep run.

- [ ] **Step 4: Stop dev server**

---

### Task 8.6: Push and open PR

**Files:** none (git only)

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/openai-migration
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Migrate LLM layer from Gemini to OpenAI Responses API" \
  --body "$(cat <<'EOF'
## Summary
- Hard cutover from Google Gemini (`@google/genai`) to OpenAI Responses API (`openai` SDK)
- Single default model: `gpt-5.4`. Cerebras dropped.
- `llm.ts` rewritten with messages-based API; 12 prompt builders return `{ system, user }`
- Fence-stripping deleted (proper `response_format: json_object` everywhere)
- Per-subagent observability metadata threaded into PostHog `$ai_generation` events
- `decks/process` migrated to Files API + structured `json_schema` output

## Test plan
- [ ] `pnpm build` clean
- [ ] `pnpm lint` clean
- [ ] `/api/classify` smoke
- [ ] `/api/chat` streaming smoke
- [ ] `/api/analyze` quick + deep mode smoke
- [ ] `/api/decks/process` PDF smoke
- [ ] `/api/playbook/intent` smoke
- [ ] `/api/board-generate` smoke
- [ ] PostHog `$ai_generation` events visible with subagent metadata

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before handoff)

- [ ] Every spec section maps to at least one task
- [ ] No "TBD" / "implement later" / vague placeholders
- [ ] Type signatures consistent across tasks (`Message`, `GenerateOptions`)
- [ ] Each task has exact files, exact commands, exact expected output
- [ ] Phase order respects dependencies (foundation → prompts+consumers → cleanup)
- [ ] Streaming (`generateTextStream`) and non-streaming (`generateText`) both used correctly per route
- [ ] PDF route uses Files API + Responses API + json_schema as specified
- [ ] PostHog observability re-wired in Phase 1, used by metadata threading from Phase 4 onward
- [ ] Final cleanup deletes `gemini.ts` only after all consumers are migrated
