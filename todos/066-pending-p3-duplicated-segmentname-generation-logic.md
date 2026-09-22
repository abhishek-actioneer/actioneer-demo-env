---
status: pending
priority: p3
issue_id: "066"
tags: [code-review, duplication, use-analytics, use-action-handlers]
dependencies: []
---

# suggestedName generation logic duplicated verbatim in two hooks

## Problem Statement

The pattern for generating a display name from a segment description appears identically in two separate files. Two copies mean two places to update if the naming logic changes, and the duplication obscures the fact that this is a shared business rule.

## Findings

The following 3-line transformation appears verbatim in both locations:

```typescript
const suggestedName = description
  .replace(/^(users?\s+who\s+|customers?\s+who\s+)/i, "")
  .replace(/\b\w/g, (c: string) => c.toUpperCase())
  .slice(0, 50);
```

- `src/hooks/use-analytics.ts` lines 297-300
- `src/hooks/use-action-handlers.ts` lines 258-261

Both hooks apply this transformation before passing `suggestedName` to downstream segment creation logic.

## Proposed Solutions

### Option A: Extract to src/lib/format-utils.ts

Create `src/lib/format-utils.ts` with:

```typescript
export function formatSegmentName(description: string): string {
  return description
    .replace(/^(users?\s+who\s+|customers?\s+who\s+)/i, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 50);
}
```

Replace both occurrences with an import from `format-utils`. If `format-utils.ts` already exists, add the function there.

### Option B: Place in src/lib/utils.ts

If no `format-utils.ts` exists and the team prefers a single utils file, add `formatSegmentName` to `src/lib/utils.ts` instead.

## Recommended Action

Option A — a named `format-utils.ts` makes the intent clear and is a natural home for string transformation helpers alongside any future formatting utilities (e.g., `formatMetricName`, `formatEventLabel`).

## Technical Details

- The regex `^(users?\s+who\s+|customers?\s+who\s+)` strips common LLM-generated prefixes from segment descriptions before title-casing.
- The `.slice(0, 50)` enforces a display name length cap.
- Both sites currently duplicate the `(c: string)` type annotation in the `.replace` callback — the extracted version can drop it since TypeScript infers from `String.prototype.replace`.

## Acceptance Criteria

- [ ] `formatSegmentName` utility extracted to a shared module (`src/lib/format-utils.ts` or `src/lib/utils.ts`).
- [ ] Both occurrences in `use-analytics.ts` and `use-action-handlers.ts` replaced with the import.
- [ ] Behavior is identical to the original (same regex, same slice length).
- [ ] No TypeScript errors. No lint errors.

## Work Log

## Resources

- `src/hooks/use-analytics.ts` lines 297-300
- `src/hooks/use-action-handlers.ts` lines 258-261
- `src/lib/utils.ts` (potential target)
