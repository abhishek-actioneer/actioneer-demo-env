---
status: pending
priority: p3
issue_id: "022"
tags: [code-review, testing, quality]
dependencies: []
---

# Row-cap test is vacuous if events < 500 rows; toBeOK() style inconsistency

## Problem Statement

Two issues in `tests/api/query.spec.ts` introduced / partially addressed in PR #29:

### Issue 1: Vacuous assertion

The new test `query without LIMIT is capped at 500 rows`:

```typescript
test('query without LIMIT is capped at 500 rows', async ({ request }) => {
  const resp = await request.post('/api/query', {
    data: { sql: 'SELECT * FROM events' },
  });
  await expect(resp).toBeOK();
  const body = await resp.json();
  expect(Array.isArray(body.rows)).toBe(true);
  expect(body.rows.length).toBeLessThanOrEqual(500);  // ← always passes if events < 500 rows
});
```

`toBeLessThanOrEqual(500)` always passes if the test dataset's `events` table
has fewer than 500 rows. In that case, the test provides zero coverage of
`ensureLimit` — if `ensureLimit` is deleted, this test still passes. The test
name promises "capped at 500 rows" but does not prove the cap was applied.

A meaningful assertion when the table has ≥ 500 rows:

```typescript
expect(body.rows.length).toBe(500);
expect(body.rowCount).toBe(500);
```

If the test dataset's row count cannot be guaranteed, add a comment explaining
the limitation.

### Issue 2: `toBeOK()` style inconsistency

Line 42 uses `await expect(resp).toBeOK()`. All other five tests in the same
file use `expect(resp.status()).toBe(200)` or `toBe(400)`. One test uses a
different assertion style from the other five — inconsistent and harder to scan.

```typescript
// All other tests in this file:
expect(resp.status()).toBe(200);

// Only this test (line 42):
await expect(resp).toBeOK();
```

Note: `toBeOK()` is a Playwright-native assertion and is strictly equivalent
or better (gives more descriptive failure messages). The inconsistency itself
is the issue, not the choice of style. Either standardize all to `toBeOK()` or
all to `expect(resp.status()).toBe(200)`.

## Findings

- `tests/api/query.spec.ts:45` — `toBeLessThanOrEqual(500)` is vacuous for small datasets
- `tests/api/query.spec.ts:42` — `toBeOK()` vs rest of file's `expect(resp.status()).toBe(200)`

## Proposed Solutions

**For Issue 1:**
```typescript
// Stronger: confirms cap was applied (requires events table to have ≥ 500 rows)
expect(body.rows.length).toBe(500);
expect(body.rowCount).toBe(500);
```

If dataset row count can't be guaranteed:
```typescript
// At minimum, confirm rowCount equals rows.length (consistency check)
expect(body.rowCount).toBe(body.rows.length);
// And document:
// Note: toBeLessThanOrEqual(500) is vacuous if events has < 500 rows.
// The ecommerce parquet dataset has N rows, so this assertion is meaningful.
```

**For Issue 2:** Standardize on `toBeOK()` (Playwright recommended) across all
success-path assertions, or keep `expect(resp.status()).toBe(200)` everywhere.

## Technical Details

- `tests/api/query.spec.ts:37-46`

## Acceptance Criteria

- [ ] Row-cap test includes an assertion that is NOT vacuously true when events < 500 rows, or is commented with the dataset row count
- [ ] `toBeOK()` / `expect(resp.status()).toBe(200)` style is consistent across all tests in the file

## Work Log

- 2026-03-02: Found by pattern-recognition-specialist agent on PR #29
