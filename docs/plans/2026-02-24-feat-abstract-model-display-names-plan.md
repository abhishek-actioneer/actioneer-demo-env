---
title: "feat: Abstract model display names to Lightning/Quick aliases"
type: feat
date: 2026-02-24
---

# feat: Abstract model display names to Lightning/Quick aliases

Replace all user-facing references to "Cerebras", "Gemini", "Google", and "GLM" with neutral speed-tier aliases ("Lightning", "Quick") so no provider or model name is ever visible in the UI.

## Context

The model selector lives in the `UserPanel` component (`src/components/sidebar/panels.tsx:638-678`). All display strings flow from a single source: `src/lib/model-registry.ts`.

**Current state** — two fields are rendered directly to the user:
- `label`: `"Gemini 2.0 Flash"` / `"GLM · Cerebras"` — primary text
- `badge`: `"Google"` / `"Cerebras"` — secondary label shown in both the collapsed row and each dropdown option

**Backend strings** (`"gemini-2.0-flash"`, `"zai-glm-4.7"`, API keys, base URLs) live exclusively in `src/lib/llm.ts` — server-only, never sent to the client. The internal `ModelId` type (`"gemini"` | `"cerebras-glm"`) is used in `localStorage` and the `x-model-id` request header; it is not rendered as visible UI text.

**Model alias mapping (assumption — confirm before implementing):**
| Alias | Internal ID | Rationale |
|---|---|---|
| ⚡ Lightning | `cerebras-glm` | Cerebras is known for extreme inference speed |
| 🚀 Quick | `gemini` | Gemini 2.0 Flash — Google's fast general-purpose model |

## Acceptance Criteria

- [x] The model selector collapsed row shows only the alias label ("Lightning" / "Quick") — no provider or model name visible
- [x] The model dropdown options show the alias labels — no "Gemini", "Google", "Cerebras", "GLM" anywhere
- [x] The `badge` field either shows a neutral descriptor (e.g., "Ultra-fast" / "Fast") or is removed entirely
- [x] `src/lib/forecast-data.ts` — `forecastMethod: "Gemini AI forecast"` replaced with a neutral string (e.g., `"AI forecast"`) so the Forecast inspect panel doesn't leak the provider name
- [x] `src/lib/playbook-data.ts` — ~10 occurrences of `# Gemini LLM ...` in code cell strings replaced with `# AI model ...`
- [x] Error messages shown in chat (SSE `error` events) do not contain provider names — either server sanitizes, or client falls back to a generic string

## Implementation

### 1. `src/lib/model-registry.ts` — primary change (one file, ~5 lines)

```ts
// model-registry.ts (after)
export const MODELS: LLMModel[] = [
  { id: "gemini",        label: "Quick",     badge: "Fast"       },
  { id: "cerebras-glm", label: "Lightning",  badge: "Ultra-fast" },
];
```

No changes needed to `ModelId`, `DEFAULT_MODEL`, or any other export. The cascade to `panels.tsx` is automatic.

### 2. `src/lib/forecast-data.ts`

Replace `"Gemini AI forecast"` (rendered at `src/components/forecast/inspect-panel.tsx:477`) with `"AI forecast"`.

### 3. `src/lib/playbook-data.ts`

Find-replace all `# Gemini LLM` occurrences (~10 across 4 playbook templates) with `# AI model`. These are rendered verbatim when a user expands a playbook cell's code block.

### 4. `src/hooks/use-analytics.ts` (line ~717)

The SSE error handler renders: `Something went wrong: ${event.message}. Please try again.`

If a provider-specific error (e.g., `"Cerebras API error 429"`) propagates from `llm.ts` into the SSE stream, it becomes visible in chat. Two options:
- **Client-side fallback** (simpler): strip the `event.message` passthrough and always show a generic string
- **Server-side sanitization** (thorough): catch and sanitize in `src/app/api/analyze/route.ts` before writing to the stream

Prefer the client-side fallback for minimal scope.

## Out of Scope (Decisions)

- **`ModelId` internal IDs** (`"gemini"`, `"cerebras-glm"`) are stored in `localStorage` and sent in the `x-model-id` header. They are not rendered in the UI. Renaming them would require coordinated changes across 6 API routes, `llm.ts`, and `model-context.tsx`. Treat as out of scope unless white-labeling for external technical audit.
- **Emoji in labels** — optionally add ⚡/🚀 prefixes; up to the implementer's discretion.

## References

- `src/lib/model-registry.ts` — single source of truth
- `src/components/sidebar/panels.tsx:638-678` — UserPanel model dropdown rendering
- `src/lib/forecast-data.ts` — `forecastMethod` field
- `src/lib/playbook-data.ts` — playbook code cell strings
- `src/hooks/use-analytics.ts:717` — SSE error handler
- `src/lib/llm.ts` — backend model routing (no changes needed)
