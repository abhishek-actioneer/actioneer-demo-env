---
status: resolved
priority: p3
issue_id: "027"
tags: [code-review, prompts, sentinel-filter, conventions]
dependencies: ["023"]
---

# Enforce lowercase convention for SENTINEL_SYSTEM_TABLES in code, not comments

## Problem Statement

`SENTINEL_SYSTEM_TABLES` in `src/lib/db.ts` documents via JSDoc that "Values are lowercase — always compare with `name.toLowerCase()`." This is a code convention enforced only by a comment. Any future caller that does `SENTINEL_SYSTEM_TABLES.has(name)` without lowercasing will silently fail on mixed-case table names. The fix is trivially small: wrap the Set in a helper function.

Additionally, `initConnection()` in `db.ts` creates `sentinel_segments` and `sentinel_integrations` tables but has no cross-reference to `SENTINEL_SYSTEM_TABLES`. If a new system table is ever added to `initConnection()` without updating the blocklist, the bug silently reappears.

## Findings

`src/lib/db.ts:82-87` — JSDoc says "always compare with name.toLowerCase()" but does not enforce it:
```typescript
export const SENTINEL_SYSTEM_TABLES = new Set([...]);
```

`src/app/api/datasets/upload/route.ts:420` — only call site correctly uses `.toLowerCase()`:
```typescript
if (SENTINEL_SYSTEM_TABLES.has(name.toLowerCase())) {
```

If a second call site is ever added without `.toLowerCase()`, it fails silently.

`initConnection()` at line 113-135 creates the tables but has no reference to `SENTINEL_SYSTEM_TABLES`.

Flagged by: kieran-typescript-reviewer, security-sentinel.

## Proposed Solutions

**Option A (Recommended): Add an `isSentinelSystemTable(name)` helper**
```typescript
/** Returns true if name is a sentinel system table (case-insensitive). */
export function isSentinelSystemTable(name: string): boolean {
  return SENTINEL_SYSTEM_TABLES.has(name.toLowerCase());
}
```
Then update the upload route to use `isSentinelSystemTable(name)` instead of `SENTINEL_SYSTEM_TABLES.has(name.toLowerCase())`. The convention is now enforced by code.

**Option B: Add a JSDoc comment inside initConnection() cross-referencing the Set**
Minimal change — just a comment. Does not fix the calling convention problem.

## Recommended Action

Option A — the helper is a two-minute addition that removes an entire class of silent bug.

## Technical Details

- File: `src/lib/db.ts` — add `isSentinelSystemTable` helper after `SENTINEL_SYSTEM_TABLES`
- File: `src/app/api/datasets/upload/route.ts:420` — use helper
- Update imports in upload route from `{ ..., SENTINEL_SYSTEM_TABLES }` to `{ ..., isSentinelSystemTable }`

## Acceptance Criteria

- [ ] `isSentinelSystemTable(name: string): boolean` exported from `src/lib/db.ts`
- [ ] `SENTINEL_SYSTEM_TABLES.has(name.toLowerCase())` replaced with `isSentinelSystemTable(name)` in upload route
- [ ] `initConnection()` has a comment cross-referencing `SENTINEL_SYSTEM_TABLES`
- [ ] `pnpm build` passes

## Work Log

- 2026-03-03: Found by kieran-typescript-reviewer, security-sentinel on PR #32 review
- 2026-03-03: Resolved as part of 023 fix in commit 2a3b248. isSentinelSystemTable() exported from db.ts.
