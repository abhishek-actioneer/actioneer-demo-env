---
name: reanalyze-challenge-raw-fetch-missing-model-header
description: handleReanalyze and handleChallenge in canvas-top-bar.tsx use raw fetch, missing x-model-id header — model switcher has no effect on re-analyze/challenge calls
type: bug
status: complete
priority: p2
issue_id: "110"
tags: [code-review, apifetch, deck, demo]
---

## Problem Statement

`handleReanalyze` and `handleChallenge` in `src/components/board/canvas-top-bar.tsx` use raw `fetch` instead of `apiFetch`. They manually add `x-dataset-id` but omit `x-model-id`. This means the model switcher (Gemini model selector in the top bar) has **no effect** on re-analyze or challenge calls — they always use the server default. In a demo where you switch models and re-analyze to show the difference, this silently breaks the model-switching story.

**Why it matters for demo:** The model selector is a demo feature. If a user/prospect switches to a different model and clicks Re-analyze, the analysis still runs with the default model, not the selected one — visibly inconsistent with what the UI suggests.

## Findings

- `src/components/board/canvas-top-bar.tsx:91` — `handleReanalyze` uses raw `fetch`:
  ```typescript
  const res = await fetch(`/api/decks/${deckId}/reanalyze`, {
    method: "POST",
    credentials: "include",
    headers: { "x-dataset-id": getActiveDatasetId() ?? "" },
    // ❌ missing x-model-id
  });
  ```
- `src/components/board/canvas-top-bar.tsx:135` — `handleChallenge` same issue:
  ```typescript
  headers: {
    "Content-Type": "application/json",
    "x-dataset-id": getActiveDatasetId() ?? "",
    // ❌ missing x-model-id
  },
  ```
- CLAUDE.md: "All frontend→backend calls MUST use `apiFetch`... Never use raw `fetch('/api/...')`. `apiFetch` auto-injects `x-dataset-id`, `x-model-id`, and `Content-Type`."

## Proposed Solutions

### Option A — Use `apiFetch` with `stream: true` for reanalyze, `apiFetch` for challenge (Recommended)

**For handleReanalyze (streaming):**
```typescript
const res = await apiFetch(`/api/decks/${deckId}/reanalyze`, {
  method: "POST",
  stream: true,
});
```

**For handleChallenge (JSON response):**
```typescript
const data = await apiFetch<{ findings: Array<{ slideIndex: number; summary: string }> }>(
  `/api/decks/${deckId}/challenge`,
  {
    method: "POST",
    body: { slides: currentDeck.slides },
  }
);
if (Array.isArray(data.findings)) { ... }
```

Pros: Full convention compliance, model header auto-injected. Cons: None.

### Option B — Manually add `x-model-id` to raw fetch headers

```typescript
import { getActiveDatasetId, getActiveModelId } from "@/lib/api-client";

headers: {
  "x-dataset-id": getActiveDatasetId() ?? "",
  "x-model-id": getActiveModelId() ?? "",
}
```

Pros: Minimal change. Cons: Still violates `apiFetch` convention; future headers won't be auto-added.

## Recommended Action

Option A — switch to `apiFetch`. The `stream: true` option returns a raw `Response` for SSE handling, so the streaming loop stays unchanged.

## Technical Details

- **Affected files:** `src/components/board/canvas-top-bar.tsx` (handleReanalyze:91, handleChallenge:135)
- **Convention:** CLAUDE.md "API Calls — apiFetch" section
- **Note:** `apiFetch` with `stream: true` returns `Response` directly — the `reader = res.body!.getReader()` pattern still works

## Acceptance Criteria

- [ ] `handleReanalyze` uses `apiFetch` with `stream: true`
- [ ] `handleChallenge` uses `apiFetch` (JSON response)
- [ ] Re-analyze respects the active model selection
- [ ] No raw `fetch` calls to `/api/decks/*` in canvas-top-bar.tsx

## Work Log

- 2026-03-16: Identified in PR #44 code review
