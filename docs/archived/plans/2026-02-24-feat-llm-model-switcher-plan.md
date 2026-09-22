---
title: "feat: LLM Model Switcher (Gemini ↔ Cerebras GLM)"
type: feat
date: 2026-02-24
brainstorm: docs/brainstorms/2026-02-24-llm-model-switcher-brainstorm.md
---

# feat: LLM Model Switcher (Gemini ↔ Cerebras GLM)

## Overview

Add a runtime model picker to the Account panel (below the workspace selector) that lets users toggle between LLM providers. Selection persists in `localStorage` and is forwarded to all 25 LLM call sites across the app via a `x-model-id` request header. A new unified `src/lib/llm.ts` abstraction normalises the two SDK shapes so adding future models is a one-file change.

---

## Architecture

```
┌──────────────────────────────────────┐
│  ModelContext (React, localStorage)  │
│  STORAGE_KEY = "sentinel-model-id"   │
└────────────┬─────────────────────────┘
             │ x-model-id header on every fetch
             ▼
┌──────────────────────────────────────┐
│   API Route (reads req.headers)      │
│   const modelId = req.headers.get    │
│     ("x-model-id") ?? DEFAULT_MODEL  │
└────────────┬─────────────────────────┘
             │ modelId passed to llm.ts
             ▼
┌──────────────────────────────────────────────────────────┐
│  src/lib/llm.ts — unified interface                      │
│                                                          │
│  generateText(prompt, { systemPrompt?, modelId? })       │
│  generateTextStream(prompt, { systemPrompt?, modelId? }) │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │  Gemini Adapter  │  │  Cerebras Adapter             │  │
│  │  @google/genai   │  │  OpenAI-compatible fetch      │  │
│  └──────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 1 — `src/lib/llm.ts` abstraction (server-side)

### New file: `src/lib/llm.ts`

**Model registry** — single source of truth for the UI picker and server router:

```typescript
export type ModelId = "gemini" | "cerebras-glm";

export interface LLMModel {
  id: ModelId;
  label: string;        // shown in UI
  badge: string;        // short tag, e.g. "Google", "Cerebras"
}

export const MODELS: LLMModel[] = [
  { id: "gemini",       label: "Gemini 2.0 Flash", badge: "Google"   },
  { id: "cerebras-glm", label: "GLM · Cerebras",   badge: "Cerebras" },
];

export const DEFAULT_MODEL: ModelId = "gemini";
```

**Unified interface:**

```typescript
export async function generateText(
  prompt: string,
  opts?: {
    systemPrompt?: string;
    modelId?: ModelId;
    timeoutMs?: number;
    label?: string;
    jsonMode?: boolean;   // translates to responseMimeType (Gemini) or response_format (Cerebras)
  }
): Promise<string>

export async function generateTextStream(
  prompt: string,
  opts?: { systemPrompt?: string; modelId?: ModelId }
): Promise<AsyncIterable<string>>
```

**⚠️ JSON mode translation (SpecFlow gap):** Five call sites use Gemini's `responseMimeType: "application/json"` — this must be translated per-adapter:
- Gemini: `config.responseMimeType = "application/json"`
- Cerebras: `response_format: { type: "json_object" }` in the request body

Pass `jsonMode: true` from call sites that currently use `responseMimeType`. Affected files: `action-recommender.ts`, `knowledge/parse/route.ts`, `datasets/[id]/prompts/route.ts`, `schema-enricher.ts`.

**⚠️ System prompt translation:** Gemini uses `config.systemInstruction`. Cerebras uses `messages[{role:"system", content}]`. The adapter handles this — call sites just pass `systemPrompt`.

**`withTimeout` stays in `llm.ts`** — applied to both adapters.

**Gemini adapter** (matches current behaviour exactly — zero regression):
- Uses existing `@google/genai` `ai` singleton from `gemini.ts`
- `contents: prompt`, `config.systemInstruction: systemPrompt`
- Non-streaming → `result.text`
- Streaming → `for await (const chunk of stream) chunk.text`

**Cerebras adapter** (OpenAI-compatible, confirmed by live API test):
- `fetch("https://api.cerebras.ai/v1/chat/completions", { ... })`
- `Authorization: Bearer process.env.CEREBRAS_API_KEY`
- `messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }]`
- `max_completion_tokens: 16000` — required because `zai-glm-4.7` is a **reasoning model** that burns tokens on internal chain-of-thought before outputting. 65000 is the ceiling.
- Non-streaming: `response.choices[0].message.content` (ignore `message.reasoning`)
- Streaming: parse `data: {...}` SSE lines → emit only `chunk.choices[0].delta.content` — **skip `delta.reasoning` chunks** (they are internal thinking, not user-visible output)
- JSON mode: `response_format: { type: "json_object" }` (confirmed working ✅)
- Model hardcoded: `zai-glm-4.7` (no env override needed)

**⚠️ Reasoning model latency:** Because `zai-glm-4.7` reasons before outputting, there will be a **streaming delay** — the user sees a spinner for longer before text appears. This is expected behaviour and does not require special handling beyond what exists today.

**`withTimeout` stays in `llm.ts`** — applied to both adapters.

### Keep `src/lib/gemini.ts` as-is

Do not delete `gemini.ts` yet — the `ai` singleton and `withTimeout` are re-exported by `llm.ts`. Remove only after all call sites are migrated.

### New env vars to document in `.env.local`:

```bash
# Cerebras — model: zai-glm-4.7, base URL: https://api.cerebras.ai/v1
CEREBRAS_API_KEY=csk-...   # set from Cerebras dashboard
```

No `CEREBRAS_MODEL` or `CEREBRAS_BASE_URL` env vars needed — both are hardcoded in the adapter since there is only one Cerebras model in scope.

---

## Phase 2 — `src/lib/model-context.tsx` (client-side)

Follow `src/lib/dataset-context.tsx` exactly.

```typescript
// src/lib/model-context.tsx
const STORAGE_KEY = "sentinel-model-id";

export function ModelProvider({ children }: { children: React.ReactNode }) {
  const [modelId, setModelId] = useState<ModelId>(DEFAULT_MODEL); // SSR-safe default

  useEffect(() => {                                                 // hydrate after mount
    const stored = localStorage.getItem(STORAGE_KEY) as ModelId;
    if (stored && MODELS.find((m) => m.id === stored)) {
      setModelId(stored);
    }
  }, []);

  const switchModel = useCallback((id: ModelId) => {
    setModelId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  /** Convenience: returns { "x-model-id": modelId } to spread into fetch headers */
  const modelHeaders = useMemo(() => ({ "x-model-id": modelId }), [modelId]);

  return (
    <ModelContext.Provider value={{ modelId, model: MODELS.find(m => m.id === modelId)!, switchModel, modelHeaders }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  return useContext(ModelContext);
}
```

**⚠️ Hydration gotcha (from institutional learnings):** Never read localStorage in `useState` initializer. Use `useEffect` deferral — the pattern above is correct.

**Wire up `ModelProvider`:** Add to `src/app/layout.tsx` (or wherever `DatasetProvider` lives) so it wraps the entire app.

---

## Phase 3 — UI: Model section in `UserPanel`

**File:** `src/components/sidebar/panels.tsx`

**Placement:** Between the `<PanelDivider />` after Workspace and the Appearance section (around line 628).

```tsx
{/* --- MODEL --- */}
<div className="relative">
  <p className={SECTION_HEADER}>Model</p>
  <button
    className={`${ITEM} justify-between`}
    onClick={() => setModelDropdown((v) => !v)}
  >
    <div className="flex items-center gap-2 min-w-0">
      <Cpu className={ICON} />
      <p className={PRIMARY}>{model.label}</p>
    </div>
    <span className="text-[10px] text-muted-foreground font-medium">{model.badge}</span>
    <ChevronsUpDown className="w-3 h-3 text-muted-foreground shrink-0" />
  </button>
  {modelDropdown && (
    <div className="mt-0.5 mx-1 rounded-md border border-border bg-popover shadow-md z-50">
      {MODELS.map((m) => {
        const isActive = m.id === modelId;
        return (
          <button key={m.id} className={...isActive...} onClick={() => { switchModel(m.id); setModelDropdown(false); }}>
            <span className="truncate">{m.label}</span>
            <span className="text-[10px] text-muted-foreground">{m.badge}</span>
          </button>
        );
      })}
    </div>
  )}
</div>
<PanelDivider />
```

- Add `const [modelDropdown, setModelDropdown] = useState(false);` to `UserPanel` state
- Add `const { modelId, model, switchModel } = useModel();` at top of `UserPanel`
- Import `Cpu` from `lucide-react` (or `BrainCircuit` / `Zap` — whichever fits the icon set)
- Import `MODELS` from `@/lib/llm`

---

## Phase 4 — Client fetch call sites: add `x-model-id` header

`useModel().modelHeaders` returns `{ "x-model-id": modelId }` — spread into every fetch.

### `src/hooks/use-analytics.ts`

Three fetch calls to update (lines ~61, ~82, ~373 — spread `modelHeaders` alongside existing `x-dataset-id`):

```typescript
const { modelHeaders } = useModel();

// classify (line ~61)
headers: { "Content-Type": "application/json", ...modelHeaders, ...(datasetId ? { "x-dataset-id": datasetId } : {}) }

// chat (line ~82)
headers: { "Content-Type": "application/json", ...modelHeaders, ...(datasetId ? { "x-dataset-id": datasetId } : {}) }

// analyze (line ~373)
headers: { "Content-Type": "application/json", ...modelHeaders, "x-dataset-id": datasetId }
```

### `src/app/playbooks/[id]/page.tsx`

Lines 117 (`/api/playbook/create`), 416 (`/api/playbook/intent`), 635 (`/api/playbook/run`):
- Add `const { modelHeaders } = useModel();` at top of component
- Spread `...modelHeaders` into each fetch headers object

### `src/hooks/use-playbook-creation.ts`

Line 81 (`/api/playbook/create`):
- Accept `modelHeaders` prop or call `useModel()` inside the hook
- Spread into fetch headers

### `src/app/forecasting/page.tsx`

Lines 39 (`/api/forecast/seed`), 54 (`/api/forecast/predict`):
- Add `const { modelHeaders } = useModel();`
- Spread into headers

### `src/components/forecast/inspect-panel.tsx`

Line 143 (`/api/forecast/generate-sql`): same pattern.

### `src/components/segments/create-segment-modal.tsx`

Line 143 (`/api/segments/generate-sql`): same pattern.

### `src/components/knowledge/knowledge-add-form.tsx`

Line 34 (`/api/knowledge/add`): same pattern.

### `src/components/knowledge/knowledge-import.tsx`

Line 132 (`/api/knowledge/parse`): same pattern.

### `src/app/page.tsx`

Line 237 (`/api/knowledge/add`): same pattern.

---

## Phase 5 — API route migration: read header, use `llm.ts`

Each route follows this pattern:

```typescript
// Before (current)
import { ai, GEMINI_MODEL } from "@/lib/gemini";
const result = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { systemInstruction: sys } });
const text = result.text || "";

// After
import { generateText, type ModelId } from "@/lib/llm";
const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
const text = await generateText(prompt, { systemPrompt: sys, modelId });
```

For streaming:

```typescript
// Before
const stream = await ai.models.generateContentStream({ model, contents: prompt, config: { systemInstruction: sys } });
for await (const chunk of stream) { const text = chunk.text; ... }

// After
const stream = await generateTextStream(prompt, { systemPrompt: sys, modelId });
for await (const text of stream) { ... }
```

### Routes to migrate (15 files, 27 call sites):

| File | Call sites | Notes |
|---|---|---|
| `src/app/api/analyze/route.ts` | 5 | Mix of streaming and non-streaming; also passes `model` var to `streamDirectResponse` — update that fn too |
| `src/app/api/chat/route.ts` | 1 | Streaming only |
| `src/app/api/classify/route.ts` | 1 | Non-streaming; result is `result.text` → becomes return value of `generateText` |
| `src/app/api/playbook/create/route.ts` | 2 | 1 streaming + 1 non-streaming |
| `src/app/api/playbook/edit/route.ts` | 1 | Streaming |
| `src/app/api/playbook/intent/route.ts` | 1 | Non-streaming |
| `src/app/api/knowledge/add/route.ts` | 1 | Non-streaming |
| `src/app/api/knowledge/parse/route.ts` | 1 | Non-streaming |
| `src/app/api/segments/generate-sql/route.ts` | 1 | Non-streaming |
| `src/app/api/forecast/predict/route.ts` | 1 | Non-streaming; currently inlines `process.env.GEMINI_MODEL` — fix here |
| `src/app/api/forecast/generate-sql/route.ts` | 1 | Non-streaming; same inline issue |
| `src/app/api/forecast/seed/route.ts` | 2 | Non-streaming; same inline issue |
| `src/app/api/datasets/[id]/prompts/route.ts` | 1 | Non-streaming; uses `jsonMode` |
| `src/app/api/recommend/route.ts` | 0 (indirect) | No direct call — calls `generateRecommendations()` from `action-recommender.ts`; must read and pass `x-model-id` header |
| `src/app/api/playbook/run/route.ts` | 0 (indirect) | No direct call — calls `playbook-executor.ts`; must read and pass `x-model-id` header |
| `src/lib/playbook-executor.ts` | 1 | Streaming; add `modelId?: ModelId` param to exported `runPlaybook*` functions |

### Lib files that need `modelId` threaded in (called from routes, not routes themselves):

| File | Call sites | Change |
|---|---|---|
| `src/lib/sql-generator.ts` | **4** | Add `modelId?: ModelId` to `generateQueries()`, `generateSingleQuery()`, `generateAgentQueries()`, **and `retryWithError()`** (SpecFlow: this was an uncounted 4th call site) |
| `src/lib/action-recommender.ts` | 1 | Add `modelId?: ModelId` to `generateRecommendations()`; pass `jsonMode: true` (uses JSON output) |
| `src/lib/datasets/schema-enricher.ts` | 2 | **Excluded from runtime switching** — runs as CLI script (`npx tsx scripts/setup-data.ts`), no HTTP request context. Always uses Gemini default. Add a note in `schema-enricher.ts` to that effect. |

**⚠️ Forecast routes need full rewrite (SpecFlow gap):** `forecast/predict/route.ts`, `forecast/generate-sql/route.ts`, and `forecast/seed/route.ts` each instantiate their own `const ai = new GoogleGenAI(...)` locally — they do NOT import from `@/lib/gemini`. They must be fully rewritten to use `llm.ts` (not just have a param added). Treat as a self-contained sub-task.

Routes that call these libs must read `req.headers.get("x-model-id")` and pass it down:
- `analyze/route.ts` → `generateQueries()`, `retryWithError()`, `generateRecommendations()`
- `forecast/seed/route.ts` + `forecast/predict/route.ts` (or via `schema-enricher`)

---

## Phase 6 — Cleanup

1. Delete `src/lib/gemini.ts` import references from all migrated files
2. Keep `gemini.ts` as a private internal module imported only by `llm.ts`'s Gemini adapter
3. Verify `pnpm build` passes with zero TypeScript errors
4. Smoke-test both models in dev

---

## Acceptance Criteria

### Functional
- [ ] Account panel shows a MODEL section between WORKSPACE and APPEARANCE
- [ ] MODEL dropdown lists all entries in `MODELS` registry with label + badge
- [ ] Selecting a model closes the dropdown and updates the displayed label immediately
- [ ] Selection survives page refresh (localStorage)
- [ ] Switching model mid-session takes effect on the next query (no page reload needed)
- [ ] All existing Gemini behaviour is unchanged when Gemini is selected
- [ ] Cerebras GLM is called when selected — verify via network tab or server log

### Technical
- [ ] `llm.ts` exports `MODELS`, `DEFAULT_MODEL`, `generateText`, `generateTextStream`
- [ ] `model-context.tsx` uses `useEffect` for localStorage hydration (no SSR mismatch)
- [ ] All 25 call sites use `llm.ts` — zero remaining direct `ai.models.*` calls in route/lib files
- [ ] All client fetch calls include `x-model-id` header
- [ ] 3 forecast routes no longer inline `process.env.GEMINI_MODEL` directly
- [ ] Adding a 3rd model requires only: add entry to `MODELS` array + add adapter branch in `llm.ts`
- [ ] `pnpm build` passes

### Error handling
- [ ] If `CEREBRAS_API_KEY` is not set, Cerebras calls throw a clear error (not a silent fallback)
- [ ] If an unknown `x-model-id` is received, server falls back to `DEFAULT_MODEL`
- [ ] Cerebras streaming errors are caught and surfaced the same as Gemini stream errors

---

## Pre-Implementation Checks

All confirmed via live API testing on 2026-02-24:

- ✅ **Streaming:** `stream: true` works. SSE format is standard `data: {...}` lines.
- ✅ **Delta fields:** `delta.reasoning` (skip) and `delta.content` (emit to client). Adapter must filter reasoning chunks.
- ✅ **JSON mode:** `response_format: { type: "json_object" }` accepted and returns clean JSON in `message.content`.
- ✅ **Base URL:** `https://api.cerebras.ai/v1/chat/completions`
- ✅ **Model ID:** `zai-glm-4.7`
- ✅ **API key:** configured, provided by user
- ⚠️ **Reasoning model delay:** content only appears after reasoning phase — streaming will have a visible initial delay.

**Remaining:** find `/api/playbook/edit` client call site (grep missed it).

## Open Questions

1. **Icon choice** — `Cpu`, `BrainCircuit`, or `Zap` from lucide-react for the model picker?
2. **Model label in UI** — "GLM · Cerebras" or "zai-glm-4.7" or something else?
3. **Hydration flash** — show default during SSR flash or hide until hydrated? Workspace selector doesn't hide — follow same pattern.
4. **`/api/playbook/edit` client call site** — find where this is called to add `x-model-id` header.

---

## Files Touched Summary

| Layer | Files |
|---|---|
| New | `src/lib/llm.ts`, `src/lib/model-context.tsx` |
| Modified (UI) | `src/components/sidebar/panels.tsx` |
| Modified (client fetch) | `src/hooks/use-analytics.ts`, `src/app/playbooks/[id]/page.tsx`, `src/hooks/use-playbook-creation.ts`, `src/app/forecasting/page.tsx`, `src/components/forecast/inspect-panel.tsx`, `src/components/segments/create-segment-modal.tsx`, `src/components/knowledge/knowledge-add-form.tsx`, `src/components/knowledge/knowledge-import.tsx`, `src/app/page.tsx` |
| Modified (API routes) | `analyze/route.ts`, `chat/route.ts`, `classify/route.ts`, `playbook/create/route.ts`, `playbook/edit/route.ts`, `playbook/intent/route.ts`, `knowledge/add/route.ts`, `knowledge/parse/route.ts`, `segments/generate-sql/route.ts`, `forecast/predict/route.ts`, `forecast/generate-sql/route.ts`, `forecast/seed/route.ts`, `datasets/[id]/prompts/route.ts` |
| Modified (lib) | `sql-generator.ts`, `action-recommender.ts`, `playbook-executor.ts`, `schema-enricher.ts` |
| Modified (client fetch) | `src/app/playbooks/[id]/page.tsx`, `src/hooks/use-playbook-creation.ts`, `src/app/forecasting/page.tsx`, `src/components/forecast/inspect-panel.tsx`, `src/components/segments/create-segment-modal.tsx`, `src/components/knowledge/knowledge-add-form.tsx`, `src/components/knowledge/knowledge-import.tsx`, `src/app/page.tsx` |
| Layout | `src/app/layout.tsx` (add `ModelProvider`) |
| Env | `.env.local` (add `CEREBRAS_API_KEY`, `CEREBRAS_BASE_URL`, `CEREBRAS_MODEL`) |
| Excluded | `src/lib/datasets/schema-enricher.ts` — CLI-only, always uses default Gemini |
| No LLM | `src/app/api/query/route.ts` — no LLM calls, skip |

Total: **2 new files**, **~29 modified files**
