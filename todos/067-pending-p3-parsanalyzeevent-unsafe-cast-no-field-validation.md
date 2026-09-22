---
status: pending
priority: p3
issue_id: "067"
tags: [code-review, type-safety, sse-types]
dependencies: []
---

# parseAnalyzeEvent validates event type but not field shapes — unsafe cast on high-traffic events

## Problem Statement

`src/lib/sse-types.ts:parseAnalyzeEvent()` checks that `parsed.type` is in `VALID_ANALYZE_TYPES`, then casts the result as `AnalyzeSSEEvent`. No field validation is performed beyond the type discriminant. A `query_result` event arriving without `rowCount` or `columns` will pass the cast silently and cause downstream crashes when `use-analytics.ts` destructures those fields.

## Findings

- `src/lib/sse-types.ts` line ~64: `return parsed as AnalyzeSSEEvent` — the cast follows only a `parsed.type` membership check.
- The type check validates that `parsed.type` is one of the known event type strings (e.g., `"query_result"`, `"text"`, `"done"`).
- No validation of required fields per union member: `query_result` needs `rowCount`, `columns`, `rows`; `text` needs `delta`; `sql` needs `query`, `agentId`; etc.
- A malformed event from the server (network truncation, API regression, or a bug in `analyze/route.ts`) will pass `parseAnalyzeEvent` and deliver a partially-shaped object to the consumer, which then crashes on field access.

## Proposed Solutions

### Option A: Add field validation for high-traffic discriminated union members

After the type check, add targeted field guards for the most-consumed event types:

```typescript
if (parsed.type === "query_result") {
  if (typeof parsed.rowCount !== "number" || !Array.isArray(parsed.columns)) {
    return null; // or throw
  }
}
if (parsed.type === "text") {
  if (typeof parsed.delta !== "string") return null;
}
```

Return `null` (or throw) for malformed events, and update callers to handle `null` gracefully. This is a targeted, low-dependency fix.

### Option B: Use Zod for full event shape validation

The project already uses Zod in API routes. Define a Zod discriminated union for `AnalyzeSSEEvent` and replace the manual cast with `AnalyzeSSEEventSchema.safeParse(parsed)`. Provides complete validation with minimal runtime overhead for small event objects.

## Recommended Action

Option B if Zod is already available in the module graph for `sse-types.ts` (a lib file, not a route). Option A as a quick patch if adding Zod to lib files is undesirable. Either is a meaningful improvement over the current bare cast.

## Technical Details

- SSE events are high-frequency during a deep-research run (17 subagents, multiple events each). A malformed event crashing the consumer drops the entire stream.
- The current `as AnalyzeSSEEvent` cast is a TypeScript-only assertion — it compiles to nothing at runtime. There is no runtime protection.
- `use-analytics.ts` destructures event fields directly (e.g., `event.rowCount`, `event.delta`) without optional chaining, so a missing field produces `undefined` which propagates silently or crashes later.

## Acceptance Criteria

- [ ] `parseAnalyzeEvent` validates required fields for at minimum `query_result` and `text` event types beyond the type discriminant check.
- [ ] Malformed events return `null` or throw with a descriptive message — they do not silently pass as a typed object.
- [ ] Callers of `parseAnalyzeEvent` handle the `null` return (or caught error) gracefully.
- [ ] No TypeScript errors. No lint errors.
- [ ] Existing behavior for well-formed events is unchanged.

## Work Log

## Resources

- `src/lib/sse-types.ts` line ~64 (parseAnalyzeEvent, the unsafe cast)
- `src/hooks/use-analytics.ts` (primary consumer that destructures event fields)
- `src/app/api/analyze/route.ts` (event producer — reference for expected shapes)
