---
status: pending
priority: p3
issue_id: "069"
tags: [code-review, api, agent-native, consistency]
dependencies: []
---

# /api/chat missing pageContext field — inconsistent with /api/analyze for agent callers

## Problem Statement

`/api/analyze` accepts a `pageContext?: string` field to inject page entity context into the LLM prompt. `/api/chat` has no equivalent field. An agent or user invoking the direct-response path (non-analytics mode) cannot inject entity context. This also means a user on a metric detail page asking a direct question gets no metric context injected via the direct path, only via the analytics path — creating an inconsistent experience depending on how the query is classified.

## Findings

- `src/app/api/chat/route.ts` — `ChatSchema` has `query`, `datasetId`, `knowledgeContext` but no `pageContext` field.
- `src/app/api/analyze/route.ts` line ~47 — `AnalyzeRequestSchema` includes `pageContext: z.string().optional()`. It is passed to `streamDirectResponse` (and likely `generateText`) as part of the system prompt.
- The `/api/chat` route is the landing path for queries classified as `"direct"` by `/api/classify`. Direct questions asked from an entity detail page (e.g., "What caused the drop on March 5th?") receive no page context because `pageContext` is never forwarded.

## Proposed Solutions

### Option A: Add pageContext to ChatSchema and thread it into the system prompt

```typescript
// In ChatSchema (chat/route.ts):
pageContext: z.string().optional(),
```

Retrieve it alongside other fields and prepend to the system prompt in the same pattern used by the analyze route's `streamDirectResponse`:

```typescript
const systemPrompt = pageContext
  ? `${baseSystemPrompt}\n\nPage context:\n${pageContext}`
  : baseSystemPrompt;
```

Pass `systemPrompt` to `generateText` (or the streaming equivalent). This mirrors the analyze route pattern exactly.

## Recommended Action

Option A. This is a small, targeted change (one Zod field + one conditional string prepend) that restores consistency between the two API routes. The client-side code already passes `pageContext` in the request payload for analyze — it should pass it for chat as well once the schema accepts it.

## Technical Details

- The inconsistency matters most for agent callers: an agent building on top of the API that wants to scope LLM responses to a specific entity must route through `/api/analyze` even for simple direct questions, just to get `pageContext` support. This constrains agent design unnecessarily.
- The `pageContext` field is already defined in the frontend request construction for the analyze path. Extending it to the chat path requires updating the client fetch call in addition to the route schema.
- Max length validation on `pageContext` (matching the analyze route, if any) should be applied consistently.

## Acceptance Criteria

- [ ] `pageContext: z.string().optional()` added to `ChatSchema` in `src/app/api/chat/route.ts`.
- [ ] `pageContext` value prepended to the system prompt when present, using the same pattern as the analyze route.
- [ ] Client-side code updated to pass `pageContext` in the chat request payload when available.
- [ ] No TypeScript errors. No lint errors.
- [ ] Behavior for requests without `pageContext` is identical to current behavior (field is optional, no regression).

## Work Log

## Resources

- `src/app/api/chat/route.ts` (ChatSchema — missing pageContext)
- `src/app/api/analyze/route.ts` line ~47 (AnalyzeRequestSchema — reference implementation)
