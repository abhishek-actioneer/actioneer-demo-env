---
status: pending
priority: p2
issue_id: "018"
tags: [code-review, security, schema-discovery]
dependencies: ["013"]
---

# schema-discovery.ts interpolates DB-sourced table names into SQL strings

## Problem Statement

`src/lib/datasets/schema-discovery.ts` builds SQL queries by interpolating
table names directly from `information_schema.tables`:

```typescript
// schema-discovery.ts:37-40 (approximate)
executeSQL(
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema = 'main' AND table_name = '${tableName}'
   ORDER BY ordinal_position`
),
executeSQL(`SELECT COUNT(*) AS cnt FROM "${tableName}"`),
```

`tableName` is sourced from a prior DuckDB query result — it comes from the
database, not directly from user input. In the current deployment this is safe:
tables are created by the app and have controlled names.

**However, second-order injection chain:**

1. An attacker exploits todo-013 (validateSQL regex bypass) to store a segment
   with malicious SQL that — when executed as a subquery — creates a DuckDB
   VIEW or TABLE with a crafted name.
2. `schema-discovery.ts` queries `information_schema.tables` and receives the
   crafted table name.
3. The crafted name is interpolated into the SQL template.

For the single-quoted context (`table_name = '${tableName}'`): a table named
`events' OR '1'='1` would produce:
```sql
WHERE table_name = 'events' OR '1'='1'
```
returning schema for all tables — information disclosure.

For the double-quoted context (`"${tableName}"`): DuckDB quoted identifiers
prevent SQL injection in that specific usage (you'd need a `"` character in
the table name), but the first context is still vulnerable.

## Findings

- `src/lib/datasets/schema-discovery.ts:37-40` — `'${tableName}'` (single-quote context, injectable)
- `src/lib/datasets/schema-discovery.ts:38` — `"${tableName}"` (double-quote context, partially protected)
- Second-order chain requires todo-013 bypass first; currently low exploitability

## Proposed Solutions

**Option A (Recommended): Validate table names against an allowlist pattern**

```typescript
function isValidTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// Before interpolation:
if (!isValidTableName(tableName)) {
  throw new Error(`Invalid table name: ${tableName}`);
}
```

Simple, zero-dependency, covers all realistic DuckDB table names.

- Effort: Small | Risk: None

**Option B: Parameterize the table name**

DuckDB's `information_schema` queries don't support parameterized identifiers
via `stmt.bindVarchar` (identifiers can't be bound as parameters). Only values
can be bound. This limits parameterization to the string-comparison context,
not the identifier context.

For the `WHERE table_name = $1` pattern, parameterization IS possible and
would prevent injection in the single-quote context:
```typescript
executeSQLInternal(
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema = 'main' AND table_name = $1
   ORDER BY ordinal_position`,
  [tableName]
)
```

But this requires changing `executeSQLInternal` to accept params, which it currently does not.

**Option C: Use DuckDB's identifier quoting**

For the `FROM "${tableName}"` case, DuckDB's double-quoted identifiers are
already injection-resistant. The only risk is the single-quoted `WHERE table_name = '${tableName}'`
context. The fix for that context is to use parameterized queries (Option B).

## Recommended Action

Option A — add a one-line table name validation before interpolation. Simple,
effective, handles both contexts, and documents the intent explicitly.

## Technical Details

- `src/lib/datasets/schema-discovery.ts:35-45` (approximate)

## Acceptance Criteria

- [ ] Table names containing SQL special characters (`'`, `"`, `;`, `--`) are rejected before interpolation
- [ ] Valid alphanumeric table names (e.g., `events`, `summary_daily`) continue to work
- [ ] `schema-discovery.ts` does not call `executeSQL` with unsanitized DB-sourced identifiers

## Work Log

- 2026-03-02: Found by security-sentinel and architecture-strategist agents on PR #29
