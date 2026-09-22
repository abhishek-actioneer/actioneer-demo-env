---
status: complete
priority: p1
issue_id: "009"
tags: [code-review, security, sql-executor]
dependencies: []
---

# executeSQLPrepared DML branch abandons prepared statements and is documented as injection-safe

## Problem Statement

`executeSQLPrepared` is documented as "Parameterized SQL executor — safe against injection."
The DML branch (`UPDATE`, `DELETE`, `INSERT`) abandons DuckDB's prepared-statement mechanism
entirely and falls back to manual string interpolation:

```typescript
// src/lib/sql-executor.ts:91-104
const isDML = trimmed.startsWith("UPDATE") || trimmed.startsWith("DELETE") || trimmed.startsWith("INSERT");

if (isDML) {
  let interpolated = sql;
  for (let i = params.length; i >= 1; i--) {
    const val = params[i - 1];
    const escaped = ...`'${String(val).replace(/'/g, "''")}'`;
    interpolated = interpolated.replace(`$${i}`, escaped);  // ← only replaces FIRST occurrence
  }
  const result = await conn.run(interpolated);
```

Two concrete bugs:
1. `String.replace(pattern, replacement)` (non-regex form) replaces only the **first** occurrence of each
   placeholder. If `$1` appears twice in the template, the second occurrence is passed to DuckDB literally as `$1`,
   which DuckDB will reject or misinterpret.
2. Only `'` → `''` escaping is applied. DuckDB also supports dollar-quoting (`$$...$$`) which completely
   sidesteps single-quote escaping.

**Current exploitability:** All callers that pass DML SQL use hardcoded template strings — the user controls
only parameter *values*, not the SQL template. So no injection is possible today. However, the JSDoc comment
`"safe against injection"` is a false guarantee that the next developer to call `executeSQLPrepared` with a
user-supplied DML template will rely on incorrectly.

## Findings

- `src/lib/sql-executor.ts:80` — JSDoc says "safe against injection"
- `src/lib/sql-executor.ts:94-103` — DML branch: manual `String.replace` + `replace(/'/g, "''")` only
- DML callers: `segments/route.ts`, `segments/[id]/route.ts`, `segments/[id]/push/route.ts` — all use
  hardcoded SQL templates; safe today only due to that fact

## Proposed Solutions

**Option A (Recommended): Use native prepared statements for DML**
```typescript
// DuckDB node-api supports prepare() + bind*() for INSERT/UPDATE/DELETE
const stmt = await conn.prepare(sql);
// bind params same as SELECT branch
const result = await stmt.run();
```
This removes the DML branch entirely and keeps the "safe against injection" guarantee honest.
- Effort: Small | Risk: Low

**Option B: Remove the DML branch, throw on DML input**
```typescript
if (isDML) throw new Error("executeSQLPrepared does not support DML; use executeSQLInternal with hardcoded templates");
```
Forces callers to make the safety tradeoff explicit.
- Effort: Small | Risk: Low

**Option C: Fix the JSDoc comment to document the limitation**
```typescript
/** Parameterized SQL executor for SELECT queries. DML uses manual interpolation (safe only with hardcoded templates). */
```
Acknowledges the gap without changing behavior.
- Effort: Trivial | Risk: None

## Recommended Action

Option A — use DuckDB's native prepared statements for DML to keep the "safe against injection" contract
true. If the DuckDB node-api version doesn't support `prepare()` for DML, fall back to Option B.

## Technical Details

- Affected files: `src/lib/sql-executor.ts` (lines 80-121)
- Branch: `fix/railway-oom-duckdb-memory`

## Acceptance Criteria

- [ ] `executeSQLPrepared` DML path does not use manual string interpolation
- [ ] OR JSDoc is updated to accurately describe the injection-safety limitation
- [ ] All existing segment tests still pass

## Work Log

- 2026-03-02: Found by security-sentinel review agent on PR #29
