---
status: pending
priority: p2
issue_id: "062"
tags: [code-review, dead-code, performance, entity-context]
dependencies: []
---

# fullContext in buildPageEntityContext never used at any call site — contains O(n²) filter+includes

## Problem Statement

`src/lib/entity-context.ts:buildPageEntityContext()` computes a `fullContext` string in its return value, but no call site ever destructures or uses it. All three call sites in `use-analytics.ts` destructure only `{ sqlContext, synthesisContext }`. The computation of `fullContext` includes an `Array.filter + Array.includes` inner loop — an O(n²) operation — that runs on every LLM invocation, allocating intermediate arrays for a value that is immediately discarded.

## Findings

- `src/lib/entity-context.ts` line ~240 — `fullContext` is computed and included in the return object.
- `src/hooks/use-analytics.ts` lines 343 and 355 — both call sites destructure `{ sqlContext, synthesisContext }` only; `fullContext` is never referenced.
- The O(n²) pattern in the `fullContext` computation:
  ```typescript
  const sqlLines = sqlContext.split("\n");
  const synthLines = synthesisContext.split("\n");
  // O(n²): Array.includes inside Array.filter
  const extra = synthLines.filter((l) => !sqlLines.includes(l));
  fullContext = sqlContext + "\n" + extra.join("\n");
  ```
  `Array.includes` on `sqlLines` is O(n) per element, making the `filter` O(n×m) overall.
- The computation runs on every call to `buildPageEntityContext()`, which is called on every analytics query.

## Proposed Solutions

### Option A: Remove fullContext from the return value and its computation

Delete the `fullContext` computation block and remove it from the return object. This eliminates the O(n²) work entirely.

If `fullContext` is ever needed in the future, it can be reintroduced — at that point, fix the O(n²) by using a Set:

```typescript
const sqlSet = new Set(sqlContext.split("\n"));
const extra = synthesisContext.split("\n").filter((l) => !sqlSet.has(l));
const fullContext = sqlContext + "\n" + extra.join("\n");
```

### Option B: Keep fullContext but add a TODO and fix the O(n²) now

If there is a near-term plan to use `fullContext`, add a `// TODO: wire up to consumer` comment and convert the `includes` to a `Set.has` lookup. This avoids the performance issue while preserving the intent.

## Recommended Action

Option A. Dead code should be removed, not annotated. The O(n²) fix is included as a note for when the feature is reintroduced.

## Technical Details

- Affected files: `src/lib/entity-context.ts`, `src/hooks/use-analytics.ts`.
- The O(n²) only becomes significant at scale (many context lines), but `buildPageEntityContext` is called on the hot path of every analytics query.
- Confirm there are no other call sites outside `use-analytics.ts` before removing.

## Acceptance Criteria

- [ ] `fullContext` is removed from `buildPageEntityContext`'s return value and computation (or has a live consumer).
- [ ] The O(n²) `Array.includes` inside `Array.filter` is either deleted or replaced with a `Set.has` lookup.
- [ ] `pnpm build` passes after the change.
- [ ] No TypeScript errors from call sites that previously received the `fullContext` property.

## Work Log

## Resources

- `src/lib/entity-context.ts`
- `src/hooks/use-analytics.ts`
