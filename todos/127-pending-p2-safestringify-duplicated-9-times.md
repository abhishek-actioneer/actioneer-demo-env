---
status: pending
priority: p2
issue_id: "127"
tags: [code-review, architecture, duplication, pr-48]
dependencies: []
---

# safeStringify/safeReplacer duplicated across 9+ API route files

## Problem Statement

`safeStringify` (BigInt → Number coercion for JSON serialization) is independently defined in at least 9 files:

- `src/app/api/explorer/route.ts:8`
- `src/app/api/explorer/funnel/route.ts:7`
- `src/app/api/explorer/retention/route.ts`
- `src/app/api/segments/[id]/composition/route.ts:5`
- `src/app/api/segments/[id]/overview/route.ts:5`
- `src/app/api/segments/[id]/overlap/route.ts`
- `src/app/api/segments/[id]/movement/route.ts`
- `src/lib/server/board-repo.ts:10` (as `safeReplacer`)
- `src/app/api/analyze/route.ts` (5 occurrences)

This is the same BigInt coercion utility (per `MEMORY.md` — it's a known requirement for DuckDB results). All 9+ copies need to be maintained if the logic changes.

## Findings

Source: Architecture Strategist.

- All new explorer and segment routes added in this PR each define their own copy
- `board-repo.ts` names it `safeReplacer` (variant name)
- The issue is already documented in MEMORY.md as a known pattern

## Proposed Solutions

**Option A (Recommended): Extract to shared utility**
Create `src/lib/server/json-utils.ts`:
```ts
/** JSON replacer that coerces BigInt to Number (required for DuckDB results) */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, bigIntReplacer);
}
```
Replace all 9+ duplicates with imports.

## Recommended Action

Option A — create once, import everywhere.

## Technical Details

- **New file:** `src/lib/server/json-utils.ts`
- **Affected files:** All 9 listed above

## Acceptance Criteria

- [ ] Single `bigIntReplacer` / `safeJsonStringify` in `src/lib/server/json-utils.ts`
- [ ] All 9 duplicate definitions removed
- [ ] No BigInt serialization errors in API responses

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (architecture-strategist) | This pattern was already noted in MEMORY.md — should have been extracted then |

## Resources

- PR #48: Unified Chart System + Server Persistence
- MEMORY.md: DuckDB BigInt coercion pattern
