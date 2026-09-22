---
title: "fix: Segment and Knowledge Generation 422 Errors in Production"
type: fix
date: 2026-03-16
---

# fix: Segment and Knowledge Generation 422 Errors in Production

## Overview

Two "Generate" features fail silently in production with 422 (segments) and 404 (knowledge) responses. The root cause is a combination of: empty schema context reaching the LLM, broken transaction logic in the generation route, in-memory-only knowledge persistence, and bare `catch {}` blocks that swallow all diagnostic information. This plan fixes all layers — server error logic, transaction correctness, and client error surfacing.

## Problem Statement

### `/api/segments/generate-all` → 422

The route calls `executeSQL(candidate.sql, datasetId)` to validate each of 12 LLM-generated segment queries. If ALL fail, it returns 422 with `"All generated segments failed SQL validation"`. In production this happens because:

1. **Empty schema context**: If `schema-map.json` is missing AND `config.json` has no `schemaContext`, `loadSchemaMap()` returns a synthetic SchemaMap with `columns: {}` and empty `annotatedSchemaContext`. The LLM prompt receives a blank schema → it hallucinates table names → all 12 SQLs fail with "table not found".

2. **Broken transaction**: `executeSQLInternal("BEGIN")`, `executeSQLPrepared(DELETE/INSERT)`, and `executeSQLInternal("COMMIT")` each open and close their own DuckDB connection via `withConnection`. DuckDB transactions are connection-scoped, so `BEGIN` on conn1 does not wrap the `INSERT` on conn2. The ROLLBACK on error is also a no-op. A mid-flight crash leaves the `sentinel_segments` table partially deleted.

3. **Errors are invisible**: The 422 response body omits which SQL failed and why. The client-side `catch {}` further discards the `ApiError.message`, showing only "Generation failed. Please try again."

### `/api/knowledge/generate` → 404

`loadSchemaMap(datasetId)` returns `null` when `schema-map.json` is absent and `ds.schemaContext` is empty. The route returns 404 with `"No schema data available. Enrich the dataset first."` — but the client swallows the message and shows a generic error.

Additionally, `saveKnowledgeEntry()` writes only to an in-memory Map. Any generated knowledge is wiped on container restart, making the feature unreliable.

## Proposed Solution

Fix in four targeted changes, each independently deployable:

1. **Surface errors to the client** — fix `catch {}` in both UI pages to read `ApiError.message` and show it
2. **Include first-failure error in 422 response** — make the server tell us exactly which SQL failed and why
3. **Fix the broken transaction** — wrap DELETE + all INSERTs in one `withConnection` call
4. **Guard empty schema context** — return 422 early (with a clear user-facing message) when `annotatedSchemaContext` is blank, instead of silently generating bad SQL

Knowledge persistence is tracked separately (see Dependencies).

## Technical Considerations

### Transaction fix

The current pattern:
```typescript
// generate-all/route.ts — BROKEN: 3 separate connections, no real transaction
await executeSQLInternal("BEGIN", datasetId);
await executeSQLPrepared(DELETE ..., datasetId);
await executeSQLPrepared(INSERT ..., datasetId);
await executeSQLInternal("COMMIT", datasetId);
```

The fix wraps all mutations in one `withConnection` call so they share a single DuckDB connection and a real transaction:
```typescript
// generate-all/route.ts — FIXED: single connection, real transaction
await withConnection(datasetId, async (conn) => {
  await conn.run("BEGIN");
  try {
    await conn.run(`DELETE FROM sentinel_segments WHERE source_conversation_id IS NULL`);
    for (const seg of validated) {
      const stmt = await conn.prepare(`INSERT INTO sentinel_segments (...) VALUES ($1, $2, $3, $4, $5, $6)`);
      // bind params...
      await stmt.run();
    }
    await conn.run("COMMIT");
  } catch (err) {
    await conn.run("ROLLBACK").catch(() => {});
    throw err;
  }
});
```

### ApiError surfacing

`apiFetch` already throws `ApiError` with `.status` and `.message`. The fix catches specifically:
```typescript
// segments/page.tsx and knowledge/page.tsx
} catch (err) {
  const msg = err instanceof ApiError ? err.message : "Generation failed. Please try again.";
  setGenError(msg);
}
```

`ApiError` is importable from `@/lib/api-client`.

### Empty schema guard

In `generate-all/route.ts`, after `loadSchemaMap`:
```typescript
if (!schemaMap.annotatedSchemaContext && Object.keys(schemaMap.columns).length === 0) {
  return Response.json(
    { error: "Dataset schema is not available. Run dataset enrichment first." },
    { status: 422 }
  );
}
```

Same guard in `knowledge/generate/route.ts`.

### First-failure error in 422 response

Collect the first SQL error string during the validation loop and include it in the 422 body:
```typescript
let firstError: string | undefined;
for (const candidate of candidates.slice(0, 12)) {
  const result = await executeSQL(candidate.sql, datasetId);
  if (result.error) {
    firstError ??= `"${candidate.name}": ${result.error}`;
    failed++;
    continue;
  }
  // ...
}
if (validated.length === 0) {
  return Response.json(
    { error: "All generated segments failed SQL validation", detail: firstError },
    { status: 422 }
  );
}
```

## Acceptance Criteria

- [ ] Triggering "Generate All Segments" on a dataset with no schema context returns a clear error: "Dataset schema is not available. Run dataset enrichment first." — visible in the UI, not just the network tab
- [ ] Triggering "Generate All Segments" on a dataset with a valid schema successfully creates segments; a mid-generation crash leaves segments intact (no partial delete)
- [ ] When segment SQL validation fails in production, the 422 response body includes `detail` with the first failing SQL name and DuckDB error
- [ ] Triggering "Generate Knowledge" on a dataset with no schema context returns a clear error in the UI — not "Generation failed. Please try again."
- [ ] The `catch` blocks in `segments/page.tsx` and `knowledge/page.tsx` display the server error message rather than a generic string
- [ ] `executeSQLInternal("BEGIN/COMMIT/ROLLBACK", ...)` calls are removed from `generate-all/route.ts`; all mutations use a single `withConnection` callback

## Files to Change

| File | Change |
|---|---|
| `src/app/api/segments/generate-all/route.ts` | Fix broken transaction, add empty-schema guard, include `detail` in 422 body |
| `src/app/api/knowledge/generate/route.ts` | Add empty-schema guard with matching 422 message |
| `src/app/segments/page.tsx` | Fix `catch {}` to display `ApiError.message` |
| `src/app/knowledge/page.tsx` | Fix `catch {}` to display `ApiError.message` |

## Dependencies & Risks

- **`withConnection` import in route**: `generate-all/route.ts` currently calls `executeSQL` / `executeSQLInternal` / `executeSQLPrepared` (which internally use `withConnection`). After the transaction fix, `withConnection` must be imported directly from `@/lib/db`. Verify it's not marked `serverExternalPackages`-only.
- **Knowledge persistence** is not addressed here — that's a follow-on. Generated knowledge is still in-memory. Tracked separately.
- **DuckDB serialization queue**: `withConnection` uses `enqueue(dsId, fn)` to serialize operations per-dataset. Wrapping DELETE + N INSERTs in one `withConnection` call means they all run within a single enqueue slot — no risk of interleaving with concurrent requests.
- **Prepared statement API in `withConnection` callback**: `conn.prepare(sql)` → `stmt.bindVarchar/bindInteger/bindNull` → `stmt.run()` — same pattern already used in `executeSQLPrepared`. Replicate it inline.

## References

- `src/app/api/segments/generate-all/route.ts:99-146` — both 422 paths + broken transaction block
- `src/app/api/knowledge/generate/route.ts:23-29` — 404 on null schemaMap
- `src/lib/db.ts:177-195` — `withConnection` creates fresh connection per call (why BEGIN/COMMIT is broken)
- `src/lib/sql-executor.ts:96-116` — `executeSQLInternal` (bypasses validateSQL)
- `src/lib/datasets/schema-loader.ts:13-36` — `loadSchemaMap` fallback logic (when columns is `{}`)
- `src/lib/prompts/segments.ts:31` — `schemaMap.annotatedSchemaContext || colSummary` — empty when schema missing
- `src/lib/api-client.ts` — `ApiError` class with `.status` and `.message`
- `src/app/segments/page.tsx:112-128` — bare `catch {}` discarding error
- `src/app/knowledge/page.tsx:161-175` — bare `catch {}` discarding error
