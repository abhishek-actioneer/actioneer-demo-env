---
status: pending
priority: p3
issue_id: "065"
tags: [code-review, organization, use-classify]
dependencies: []
---

# createId() pure utility lives in use-classify.ts — misleading module home

## Problem Statement

`src/hooks/use-classify.ts` exports `createId()`, a pure utility function that generates a random alphanumeric ID. It has no relation to query classification. It is imported by `use-analytics.ts` from `use-classify.ts`, which makes the dependency chain misleading — analytics importing from classify for an ID generator.

## Findings

- `src/hooks/use-classify.ts` line ~110: `export function createId() { return Math.random().toString(36).slice(2, 10); }`
- Imported at `src/hooks/use-analytics.ts` from `../hooks/use-classify` (or relative equivalent).
- The function is pure, stateless, and has no dependency on anything in the classify module.

## Proposed Solutions

### Option A: Move to src/lib/utils.ts

Add `createId` to `src/lib/utils.ts` alongside other general-purpose utilities. Update the import in `use-analytics.ts`. This is a one-line move plus one import change.

### Option B: Create src/lib/id.ts

Create a dedicated `src/lib/id.ts` if more ID utilities are anticipated in the future (e.g., UUID generation, prefixed IDs). Export `createId` from there. Update imports accordingly.

## Recommended Action

Option A for now — `src/lib/utils.ts` is the natural home for a one-liner utility in this codebase. If ID utilities proliferate, promote to Option B.

## Technical Details

- `Math.random().toString(36).slice(2, 10)` produces an 8-character lowercase alphanumeric string. It is not cryptographically secure but is adequate for message/conversation IDs in a demo context.
- The misleading import path (`use-classify`) could confuse contributors scanning `use-analytics.ts` for its dependencies — they would not expect a classify hook to be the source of a generic ID utility.

## Acceptance Criteria

- [ ] `createId` moved out of `use-classify.ts`.
- [ ] `createId` placed in `src/lib/utils.ts` (or `src/lib/id.ts` if preferred).
- [ ] Import in `use-analytics.ts` updated to new location.
- [ ] Any other importers of `createId` from `use-classify.ts` updated (check with grep).
- [ ] No TypeScript errors. No lint errors.

## Work Log

## Resources

- `src/hooks/use-classify.ts` line ~110
- `src/hooks/use-analytics.ts` (import site)
- `src/lib/utils.ts` (target location)
