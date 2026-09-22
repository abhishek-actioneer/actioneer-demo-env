---
status: complete
priority: p1
issue_id: "119"
tags: [code-review, security, chart-requery, pr-48]
dependencies: []
---

# newRange.start/end interpolated into regex replacement strings — injection risk

## Problem Statement

`src/app/api/chart-requery/route.ts` interpolates `newRange.start` and `newRange.end` directly into `String.replace()` replacement strings:

```ts
result = result.replace(
  /(>=\s*')(\d{4}-\d{2}-\d{2}...)/gi,
  `$1${newRange.start}$3`,  // ← newRange.start is unsanitized
);
```

JavaScript's `String.replace()` treats `$` as special in replacement strings (`$&`, `$1`, `$'`, `` $` ``). An attacker sending `newRange.start = "$2$3$1"` changes the substitution behavior, reconstructing SQL fragments in unexpected ways. Additionally, a value like `2024-01-01' OR '1'='1` passes through and is inserted into the SQL, creating a SQL injection payload.

Neither `start` nor `end` are validated against any expected date format.

## Findings

Source: Security Sentinel agent.

- `route.ts:43` — `$1${newRange.start}$3` in replacement string
- `route.ts:48` — `$1${newRange.end} 23:59:59$3` in replacement string
- `route.ts:55` — BETWEEN pattern also interpolates both values
- No format validation on `newRange.start` or `newRange.end` before use
- Combined with finding #118 (no SQL validation), this is a compound injection vector

## Proposed Solutions

**Option A (Recommended): Validate date format before use**
```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/;
if (!DATE_RE.test(newRange.start) || !DATE_RE.test(newRange.end)) {
  return NextResponse.json({ error: "Invalid date range format" }, { status: 400 });
}
```
Then escape `$` signs: replace `newRange.start` with `newRange.start.replace(/\$/g, "$$$$")` before interpolation.

**Option B: Parameterize rather than regex-replace**
- Instead of regexing the SQL string, pass date parameters to DuckDB via prepared statements
- Requires restructuring the SQL execution approach
- Effort: Large | Risk: Medium

## Recommended Action

Option A — 3-line fix: validate format, then escape `$` in both values before replacement.

## Technical Details

- **Affected files:** `src/app/api/chart-requery/route.ts:34–58` (`transformDateRange` function)
- **Must fix alongside:** #118 (SQL injection via executeSQLInternal)

## Acceptance Criteria

- [ ] `newRange.start` and `newRange.end` validated as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`
- [ ] `$` characters in date values escaped before use in `.replace()` replacement strings
- [ ] Invalid date format returns 400 with clear error message

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (security-sentinel) | JS .replace() replacement strings treat $ as special — always escape user input |
| 2026-03-23 | Fixed: added DATE_RE format validation in POST handler (returns 400 on invalid format); added $ escaping via safeStart/safeEnd in transformDateRange | Validation placed after !newGrain && !newDateRange guard; escaping uses /\$/g → "$$$$" double-dollar idiom |

## Resources

- PR #48: Unified Chart System + Server Persistence
- MDN: String.replace() replacement patterns
