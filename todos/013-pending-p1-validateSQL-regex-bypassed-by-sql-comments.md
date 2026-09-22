---
status: pending
priority: p1
issue_id: "013"
tags: [code-review, security, sql-executor]
dependencies: []
---

# validateSQL BLOCKED_KEYWORDS regex bypassed by SQL comments adjacent to keywords

## Problem Statement

`validateSQL` scans for blocked keywords using:

```typescript
const regex = new RegExp(`\\b${kw}\\s`, "i");
```

The `\s` after the keyword requires a whitespace character immediately
following the keyword. This fails to match when a SQL comment or opening
parenthesis immediately follows the keyword — both of which are legal
DuckDB SQL:

- `DELETE/*comment*/FROM` → regex looks for `DELETE\s`, finds nothing, passes
- `DROP--comment\nTABLE` → regex looks for `DROP\s`, the `--` is not `\s`

  Actually `DROP--comment\n` — the `\n` at the end of the comment IS matched by `\s` in multi-line mode, but the `\n` comes after the comment text, not immediately after `DROP`. In practice `DROP--\n` would NOT be matched because the regex sees `DROP-` which has no `\b` boundary after `DROP` before `-`.

**Concrete bypass:**

```
POST /api/query
{ "sql": "SELECT 1; DELETE/**/FROM segments WHERE 1=1" }
```

1. `validateSQL` checks `trimmed.startsWith("SELECT")` → passes.
2. The blocked-keywords loop: `new RegExp("\\bDELETE\\s", "i")` tests against the full SQL. `DELETE/**/FROM` does not match because `/*` is not `\s`.
3. `executeSQL` calls `ensureLimit` then `conn.run()` — DuckDB executes the SELECT and the DELETE.

**Impact:** Any authenticated user can delete or modify rows in the `segments` and `integrations` tables by submitting a crafted multi-statement SQL through `/api/query`. Parquet-backed views (events) are read-only, but DuckDB tables created in `db.ts` (`segments`, `integrations`) are writable.

Note: exploitability requires the auth cookie (`APP_PASSWORD`), so this is not
an anonymous attack surface. For a demo app shared with invited users, the risk
may be acceptable, but the code asserts a security guarantee that it does not provide.

## Findings

- `src/lib/sql-executor.ts:57-62` — BLOCKED_KEYWORDS regex `\bKW\s`
- `SELECT 1; DELETE/**/FROM segments WHERE 1=1` — bypasses all guards
- `COPY events TO '/tmp/data.csv'` — COPY is not in the blocklist; DuckDB executes this, writing a file to the container

## Proposed Solutions

**Option A: Use read-only connection access mode (Recommended)**

Set `access_mode: 'READ_ONLY'` when creating the DuckDB instance (or connection)
for the analytics query path. Any DML attempt raises a native DuckDB error.
This is the only approach that is bypass-proof.

```typescript
instance = await instanceCache.getOrCreateInstance(dbPath, {
  memory_limit: process.env.DUCKDB_MEMORY_LIMIT ?? "256MB",
  threads: process.env.DUCKDB_THREADS ?? "1",
  access_mode: "READ_ONLY",  // DML is rejected at the native level
});
```

Note: read-only mode would prevent `executeSQLPrepared` from writing to
`segments` and `integrations`. Those tables would need a separate writable
instance on a different db file, or the architecture would need to separate
analytics queries from CRUD operations.

- Effort: Medium (architectural separation needed) | Risk: Low once done

**Option B: Terminate the regex at EOF-or-non-word, not at `\s`**

```typescript
const regex = new RegExp(`\\b${kw}\\b`, "i");
```

`\b` word boundary after the keyword catches `DELETE/*`, `DROP(`, `DELETE\n`
— anything that ends the keyword token. This is a minimal fix.

- Effort: Trivial | Risk: Low (may have false positives for column names like
  `created_at` containing `ate`... no, `\b` boundaries prevent that)

**Option C: Add comment-stripping before the keyword scan**

```typescript
const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
```

Strip inline and block comments before scanning. Less robust than Option B
but preserves the current regex structure.

- Effort: Small | Risk: Medium (comment-stripping is hard to get right)

## Recommended Action

Short-term: Option B — change `\s` to `\b` in the regex. This is a one-character
fix that closes the most obvious comment-adjacent bypass. Long-term: evaluate
whether the analytics path should open a read-only DuckDB connection.

## Technical Details

- `src/lib/sql-executor.ts:58` — `new RegExp(\`\\\\b${kw}\\\\s\`, "i")`
- All API routes that call `executeSQL` are affected

## Acceptance Criteria

- [ ] `SELECT 1; DELETE/**/FROM segments WHERE 1=1` returns a 400 / validation error
- [ ] `DROP--comment\nTABLE events` returns a 400 / validation error
- [ ] `SELECT * FROM events WHERE name = 'DELETE me'` still passes (keyword inside string — note: full fix requires SQL parser, this is best-effort)
- [ ] Existing tests pass

## Work Log

- 2026-03-02: Found by security-sentinel agent on PR #29
