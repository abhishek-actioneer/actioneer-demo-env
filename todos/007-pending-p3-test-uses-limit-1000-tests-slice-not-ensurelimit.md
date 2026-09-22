---
status: complete
priority: p3
issue_id: "007"
tags: [code-review, tests]
dependencies: ["003"]
---

# Playwright row-cap test sends LIMIT 1000 — tests .slice(), not ensureLimit injection path

## Problem Statement

The new test in `tests/api/query.spec.ts`:
```ts
data: { sql: 'SELECT * FROM events LIMIT 1000' },
```

The SQL already has a `LIMIT 1000` keyword, so `ensureLimit` skips injection and returns the SQL unchanged. DuckDB fetches up to 1000 rows; the JS `.slice(0, 500)` trims it to 500. The test passes but exercises the old safety net, not the new code being introduced.

Also: the test uses `await expect(resp).toBeOK()` while all existing tests use `expect(resp.status()).toBe(200)` — inconsistent style in the same file.

## Proposed Solutions

**Option A: Change test SQL to have no LIMIT**
```ts
data: { sql: 'SELECT * FROM events' },
```
This actually exercises the `ensureLimit` injection path.
- Effort: Tiny

**Option B: Add a second test with no-LIMIT SQL, keep existing test**
- Documents both paths explicitly

## Recommended Action

Option A. Update test description too: "query without LIMIT is capped at 500 rows".

## Technical Details

- Affected file: `tests/api/query.spec.ts:37-47`

## Acceptance Criteria

- [ ] Test SQL has no LIMIT clause (exercises ensureLimit injection)
- [ ] Consistent use of `toBeOK()` or `toBe(200)` across the file

## Work Log

- 2026-03-02: Found by code-simplicity-reviewer, pattern-recognition-specialist, security-sentinel on PR #29
