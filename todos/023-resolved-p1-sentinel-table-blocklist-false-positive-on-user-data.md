---
status: resolved
priority: p1
issue_id: "023"
tags: [code-review, data-integrity, upload, sentinel-filter]
dependencies: []
---

# SENTINEL_SYSTEM_TABLES includes "segments"/"integrations" — silently drops legitimate user data

## Problem Statement

`SENTINEL_SYSTEM_TABLES` in `src/lib/db.ts` includes two bare legacy names (`"segments"` and `"integrations"`) intended for backward compat with pre-rename baby-sentinel exports. However, the filter applies to **all uploaded DuckDB files**, not just those created by baby-sentinel. A user who uploads a real-world dataset (e.g., a Segment.io warehouse export with a `segments` table, or a CRM with an `integrations` table) will have those tables **silently dropped** with only a server-side `console.warn`. The user sees nothing — just an analyzed dataset missing their data. If these are the only tables, they get a misleading 400: "only sentinel system tables were present."

## Findings

From `src/lib/db.ts` lines 82-87:
```typescript
export const SENTINEL_SYSTEM_TABLES = new Set([
  "sentinel_segments",    // safe — unique sentinel_ prefix
  "sentinel_integrations", // safe — unique sentinel_ prefix
  "segments",             // ⚠ common marketing/analytics table name
  "integrations",         // ⚠ common SaaS connector table name
]);
```

The filter is applied case-insensitively at `upload/route.ts:420`:
```typescript
if (SENTINEL_SYSTEM_TABLES.has(name.toLowerCase())) {
  console.warn(`[upload] skipping sentinel system table "${name}"`);
  return false;
}
```

No client-facing warning is returned in the success response. The user has no indication their table was dropped.

Flagged by: data-integrity-guardian, architecture-strategist, security-sentinel, pattern-recognition-specialist.

## Proposed Solutions

**Option A (Recommended): Remove bare names; prefix-check only**
- Remove `"segments"` and `"integrations"` from the Set
- Keep only `"sentinel_segments"` and `"sentinel_integrations"`
- Legacy pre-rename files will expose those tables as user data (minor prompt pollution), but that is far preferable to silently hiding real user data
- Effort: Small | Risk: Very Low

**Option B: Schema fingerprint check before filtering**
- For `segments` and `integrations`, verify the column signature matches baby-sentinel's DDL before filtering (e.g., check for `id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, sql VARCHAR NOT NULL` for segments)
- Correct but adds query overhead and fragility if the DDL ever changes
- Effort: Medium | Risk: Medium

**Option C: Keep bare names but return dropped table names in 400 error and success response**
- Add `droppedTables: string[]` to the success JSON response body
- Update the 400 error message to list which tables were filtered and why
- Effort: Small | Risk: Low (but doesn't fix the core false-positive problem)

## Recommended Action

Option A — remove the bare names. The `sentinel_` prefix is a reliable discriminator. Legacy pre-rename exports are internal baby-sentinel files; any contamination from their `segments`/`integrations` tables is minor (they appear in prompts as empty system tables) and affects a very small number of files. Silently dropping a real user's `segments` table is a much worse outcome.

## Technical Details

- File: `src/lib/db.ts` lines 85-86
- File: `src/app/api/datasets/upload/route.ts` lines 419-429 (filter logic)
- No test coverage for the false-positive case

## Acceptance Criteria

- [ ] Uploading a DuckDB file with a `segments` user table does NOT filter it
- [ ] Uploading a DuckDB file with an `integrations` user table does NOT filter it
- [ ] Uploading a DuckDB file with `sentinel_segments` / `sentinel_integrations` still filters them
- [ ] Case-insensitive filter still works for `SENTINEL_SEGMENTS` etc.
- [ ] `pnpm build` passes with 0 type errors

## Work Log

- 2026-03-03: Found by data-integrity-guardian, architecture-strategist, security-sentinel on PR #32 review
- 2026-03-03: Resolved in commit 2a3b248. Removed "segments" and "integrations" from SENTINEL_SYSTEM_TABLES. Added isSentinelSystemTable() helper for contract-enforced case-insensitive checks. Upload route now uses helper instead of raw Set.has().
