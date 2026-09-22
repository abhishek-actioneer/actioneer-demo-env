---
date: 2026-02-24
topic: llm-model-switcher
---

# LLM Model Switcher

## What We're Building

A runtime model switcher in the Account panel (below the workspace selector) that lets users toggle between LLM providers — starting with Gemini 2.0 Flash and GLM on Cerebras. The selection persists in localStorage and applies to all LLM calls across the app.

The backend introduces a unified `src/lib/llm.ts` abstraction layer that normalizes the two provider SDKs behind a common interface. All 18 existing call sites are refactored to use this interface. Adding a new model in the future means adding one adapter and one registry entry — no other changes required.

## Why This Approach

**Approach A (unified abstraction layer)** was chosen over:
- Approach B (branch inside gemini.ts) — provider logic would bleed into every route, not extendable
- Approach C (server-side config endpoint) — global server state breaks per-user isolation and resets on restart

The 18-site refactor is the right investment: it creates a real extension point rather than a maintenance trap.

## Key Decisions

- **Persistence:** localStorage only — survives refresh, no server state needed
- **Transport:** Client sends `x-llm-provider` header on every fetch to API routes; server reads it in `llm.ts`
- **Scope:** All LLM calls — SQL generation, classify, chat, summaries, critiques, playbooks, forecasts
- **Normalization:** `llm.ts` adapters convert the common interface (`prompt` + `systemPrompt`) into provider-specific formats (Gemini: `contents + config.systemInstruction`; Cerebras: `messages[]` OpenAI-compatible)
- **Streaming:** Both `generateText` (non-streaming) and `generateTextStream` (async iterator of string chunks) in the interface
- **Registry:** A static `MODELS` array in `llm.ts` — `{ id, label, provider }` — consumed by the UI picker and server router
- **UI placement:** Account panel, new "MODEL" section between WORKSPACE and APPEARANCE, same visual pattern as workspace selector

## Open Questions

- What is the exact Cerebras GLM model ID? (needs `CEREBRAS_API_KEY` env var + base URL confirmed)
- Does Cerebras GLM support streaming via OpenAI-compatible SSE?
- Should the model label shown in the UI include provider name (e.g., "GLM · Cerebras") or just model name?

## Next Steps

→ `/workflows:plan` for implementation details
