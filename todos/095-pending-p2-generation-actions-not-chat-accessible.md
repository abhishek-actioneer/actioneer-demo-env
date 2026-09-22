---
status: pending
priority: p2
issue_id: "095"
tags: [code-review, agent-native, chat, pr-41]
dependencies: [090]
---

# Three new generation actions (segments, knowledge, metrics) are not accessible through the chat interface

## Problem Statement

PR #41 adds three powerful bulk-generation buttons to the UI:
- "Generate Starter Segments" on `/segments`
- "Generate Starter Knowledge" on `/knowledge`
- "Generate Metrics & Tree" on `/metrics`

None of these are wired into the chat interface. A user typing "generate starter segments" into the chat will be routed to `direct` LLM mode and receive a conversational response — but no actual generation will occur. An agent cannot trigger any of them.

The existing chat already handles `create-segment` as a classifier action type (the manual single-segment flow). The bulk generation flows are a natural extension.

## Findings

Source: Agent-Native reviewer.

- `src/lib/prompts/classify.ts` — no `generate-segments`, `generate-knowledge`, `generate-metrics` action types
- `src/hooks/use-action-handlers.ts` — only `create-segment` and `save-playbook` handled
- `src/app/segments/page.tsx:92-110` — context injected into chat but does not mention generation capability
- `src/app/knowledge/page.tsx:63-81` — same gap
- The API routes are well-structured and return machine-parseable JSON — the gap is only in the classifier and action handler layers

## Proposed Solutions

**Option A (Recommended): Add classifier action types + action handler cases**
1. Add `generate-segments`, `generate-knowledge`, `generate-metrics` to the classifier prompt in `src/lib/prompts/classify.ts`
2. Add handler cases in `src/hooks/use-action-handlers.ts`:
   - `generate-segments` → `apiFetch("/api/segments/generate-all", { method: "POST", body: { datasetId } })` → call `refreshSegments()`
   - `generate-knowledge` → `apiFetch("/api/knowledge/generate", { method: "POST", body: { datasetId } })` → persist entries → bump `refreshKey`
   - `generate-metrics` → `apiFetch("/api/metrics/generate", { method: "POST", body: { datasetId } })` → navigate to `/metric-tree`
3. Add a system message to the conversation thread after generation summarizing what was created
- Effort: Medium | Risk: Low

**Option B: Add a `capabilities` field to context payload only (minimal)**
- Update `setEntity()` context on each page to include `capabilities: ["generate-starter-segments", ...]`
- LLM can mention the capability in chat, but cannot execute it
- Effort: Small | Risk: None (partial solution)

## Recommended Action

Option A — full chat integration for all three generation actions. Prerequisite: resolve todo 090 (knowledge persistence) first so the knowledge generation action can complete server-side.

## Technical Details

- **Affected files:**
  - `src/lib/prompts/classify.ts` — add new action types
  - `src/hooks/use-action-handlers.ts` — add handler cases
  - `src/app/segments/page.tsx`, `src/app/knowledge/page.tsx` — optionally add capabilities to context payload

## Acceptance Criteria

- [ ] User can type "generate starter segments" in chat and the generation runs
- [ ] User can type "generate starter knowledge" and entries are created
- [ ] Generation result is reported back in the conversation thread
- [ ] A direct API call with no browser client produces the same state change

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (agent-native reviewer) | Routes are agent-ready; only the classifier and handler layers need wiring |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
- Dependency: todo 090 (knowledge persistence must be server-side first)
