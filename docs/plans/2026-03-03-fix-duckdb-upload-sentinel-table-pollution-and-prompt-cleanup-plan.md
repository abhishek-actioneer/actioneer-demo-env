---
title: "fix: DuckDB Upload Treats sentinel_ Tables as User Data + Hardcoded Prompt Cleanup"
type: fix
date: 2026-03-03
deepened: 2026-03-03
---

# fix: DuckDB Upload Treats sentinel_ Tables as User Data + Hardcoded Prompt Cleanup

## Enhancement Summary

**Deepened on:** 2026-03-03
**Research agents used:** security-sentinel, kieran-typescript-reviewer, architecture-strategist, code-simplicity-reviewer, performance-oracle, pattern-recognition-specialist, best-practices-researcher, framework-docs-researcher (DuckDB), data-integrity-guardian, learnings-researcher (×3)

### Key Improvements Discovered

1. **Filter MUST be placed before the UNION ALL COUNT query** (not after) — this is a correctness issue (sentinel table wins the `primaryTable` row-count race), not just a code style choice. Saves 1.5–5s of enrichment time as a bonus.
2. **Case-insensitive match required** — `Set.has(name)` is bypassed by `SENTINEL_SEGMENTS` or `Integrations`. Must use `Set.has(name.toLowerCase())`.
3. **`SENTINEL_SYSTEM_TABLES` belongs in `src/lib/db.ts`** as a named export — the only source of truth for sentinel table names is `initConnection()` DDL. The upload route should import it, not redeclare it.
4. **Remove bare `"integrations"` and `"segments"` from the blocklist** — `db.ts` only creates `sentinel_integrations` and `sentinel_segments` (the prefixed names). The bare names would false-positive on legitimate user tables named "segments" (common in marketing data). Keep only the four names that `db.ts` actually creates, or use the `sentinel_` prefix pattern.
5. **Part 2 scope reduced** — code simplicity review found Phase 3 (API route prompt extractions) is over-engineered for a demo app. The real wins are in Phase 1 + 2 only. Also: the plan's 12-file structure should be 11 files (merge `segments.ts` into `sql.ts`).
6. **Add explicit guard after UNION ALL** — `countRows[0]` can be `undefined` if all post-filter tables have zero rows. Add null guard before `primaryTable` assignment.
7. **Classifier learning applies** — when migrating `CLASSIFY_SYSTEM`, the expanded keyword list and bias rules must be preserved character-for-character. See `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`.

### New Constraints Discovered

- DuckDB `information_schema.tables WHERE table_type = 'BASE TABLE'` is already correct — it never surfaces internal engine objects. The SQL query does not need to change. Only the TypeScript-layer filter needs updating.
- `duckdb_` prefix objects never appear as `BASE TABLE` in `information_schema` — no additional prefix filter needed for DuckDB internals.
- Extension autoload should also be disabled on the production `getOrCreateInstance` call for uploaded DuckDB files (currently only disabled on the inspection instance).

---

## Overview

Two related issues addressed together:

1. **Bug (P0):** When a `.duckdb` file is uploaded that contains a table named `sentinel_integrations` or `sentinel_segments` (the baby-sentinel system table names), the upload flow treats those tables as user data. The result: the LLM enrichment analyzes the sentinel system tables instead of the actual user data, and the primary table is selected as `sentinel_integrations` (or the old pre-rename `integrations`), producing a nonsensical analysis report.

   **Confirmed with `lending-club.duckdb`** — this file was produced by a baby-sentinel instance before the `sentinel_` rename, so it contains a table named `integrations`. The upload detects `integrations` (3 rows) as the primary table and the entire report becomes "Lending Club Integration Analysis: A Deep Dive into Data Quality and Connectivity."

2. **Cleanup (P2):** 25 hardcoded LLM prompts across 11 files with no central registry. Phases 1 and 2 only (Phase 3 is deferred).

---

## Part 1: Bug — sentinel_ Table Pollution in DuckDB Upload

### Root Cause (confirmed from `lending-club.duckdb`)

The uploaded file contains a table named `integrations` (the old baby-sentinel system table name, before the `sentinel_` rename). The `handleDuckDBUpload` function at `src/app/api/datasets/upload/route.ts` enumerates ALL base tables and passes them directly to the enrichment pipeline with no filter for known sentinel system table names.

When `integrations` has more rows than the actual data tables, it wins the row-count heuristic for `primaryTable` selection (line 426), and the entire analysis pivots to it.

### Impact

- `primaryTable` is detected as `integrations` (3 rows) instead of loan data tables
- LLM enrichment generates schema context about integration sync status
- All SQL generation targets the `integrations` table
- `dateField` / `userIdField` detect nothing useful (integrations has no temporal or user columns)

### The Fix

**Single source of truth — export from `src/lib/db.ts`:**

```typescript
// src/lib/db.ts — add near the CREATE TABLE IF NOT EXISTS statements (line ~99)
// These are the sentinel system table names that initConnection() creates.
// Export so the upload route can filter them out of user-uploaded DuckDB files.
export const SENTINEL_SYSTEM_TABLES = new Set([
  "sentinel_segments",
  "sentinel_integrations",
]);
```

> **Why NOT include bare `"integrations"` and `"segments"`?** The `db.ts` only creates the prefixed names. The unqualified names are common user table words — a marketing analytics DB with a `segments` table is a valid upload and should not be silently dropped. If the user uploaded a pre-rename baby-sentinel DB (which has `integrations` without the prefix), we should include both for backward compatibility. Decision: include all four for safety, but document why:

```typescript
export const SENTINEL_SYSTEM_TABLES = new Set([
  "sentinel_segments",    // current system table name (post-rename)
  "sentinel_integrations", // current system table name (post-rename)
  "segments",             // legacy: pre-rename baby-sentinel databases
  "integrations",         // legacy: pre-rename baby-sentinel databases
]);
```

**In `src/app/api/datasets/upload/route.ts`, add the filter before the UNION ALL COUNT query:**

```typescript
import { getOrCreateInstance, enqueue, SENTINEL_SYSTEM_TABLES } from "@/lib/db";

// In handleDuckDBUpload(), immediately after the SAFE_TABLE_NAME filter (~line 406):

// IMPORTANT: this filter must run BEFORE the UNION ALL COUNT query below.
// countRows, primaryTable, tablesToDescribe, and tableColumns are all derived from
// allTableNames — sentinel tables contaminate all four if not removed here.
const beforeCount = allTableNames.length;
allTableNames = allTableNames.filter((name) => {
  if (SENTINEL_SYSTEM_TABLES.has(name.toLowerCase())) {  // case-insensitive
    console.warn(`[upload] skipping sentinel system table "${name}"`);
    return false;
  }
  return true;
});
if (beforeCount !== allTableNames.length) {
  const dropped = beforeCount - allTableNames.length;
  console.log(`[upload] filtered ${dropped} sentinel system table(s)`);
}

if (allTableNames.length === 0) {
  throw Object.assign(
    new Error("No user data tables found in the DuckDB file (only sentinel system tables were present)"),
    { status: 400 },
  );
}
```

**Add null guard after UNION ALL result (line ~426):**

```typescript
// After countRows.sort():
if (countRows.length === 0) {
  throw Object.assign(
    new Error("No row-count results returned for user data tables — the file may be empty"),
    { status: 400 },
  );
}
primaryTable = countRows[0].tbl;
```

### Why Placement Before UNION ALL Matters

The UNION ALL query is built from `allTableNames` at line 416:

```typescript
const unionSQL = allTableNames
  .map((t) => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM "${t}"`)
  .join(" UNION ALL ");
```

If sentinel tables remain in `allTableNames` here, they:
1. Participate in `countRows.sort()` — could win `primaryTable` selection
2. Appear in `tablesToDescribe` (line 429) — their schema gets DESCRIBE'd
3. Appear in `tableColumns` — their columns feed `detectSpecialColumns`
4. Appear in `enrichDataset()` table list — 1.5–5s of extra Gemini enrichment wasted

Filtering at line 407 (before UNION ALL) cleanly prevents all four effects.

### Security: Case-Insensitive Match

The `Set.has()` check is case-sensitive. A crafted DuckDB with `SENTINEL_SEGMENTS` or `Sentinel_Integrations` would bypass an exact-match filter. Always normalize before lookup:

```typescript
SENTINEL_SYSTEM_TABLES.has(name.toLowerCase())
```

The Set values must be lowercase for this to work.

### Secondary: Disable Extension Autoload on Production Instance for Uploaded DBs

The inspection instance correctly disables extension autoload:
```typescript
access_mode: "READ_ONLY",
autoinstall_known_extensions: "false",
autoload_known_extensions: "false",
```

But `getOrCreateInstance()` in `db.ts` only sets `memory_limit` and `threads`. A user-supplied DuckDB file could contain extension references that activate on the writable production connection. Consider adding extension disable flags to `getOrCreateInstance` when it's called for uploaded (dynamic) datasets specifically.

### Acceptance Criteria

- [x] Uploading `lending-club.duckdb` produces analysis about lending club loan data, not integrations
- [x] `sentinel_integrations`, `sentinel_segments`, `integrations`, `segments` tables excluded from schema context
- [x] Filter is case-insensitive — `SENTINEL_INTEGRATIONS`, `Integrations` etc. are also blocked
- [x] If a DuckDB contains ONLY sentinel system tables, upload returns 400 with a clear message
- [x] Normal DuckDB uploads (no system table collisions) continue to work unchanged
- [x] `SENTINEL_SYSTEM_TABLES` is exported from `db.ts` — single source of truth
- [x] The UNION ALL COUNT query runs on the post-filter table list

---

## Part 2: Hardcoded Prompt Inventory and Cleanup Plan

> **Scope decision (from simplicity review):** Only Phases 1 and 2 are in scope. Phase 3 (extracting prompts from API route handlers) adds churn with near-zero benefit for a demo app — prompts co-located with their single consumer is a valid pattern. The real gain is making prompts in `src/lib/` discoverable and deduplication of boilerplate.

### Current State

25 prompt locations across 11 files. The codebase uses three competing naming conventions:

| Convention | Examples |
|---|---|
| `SCREAMING_SNAKE_CASE` constants | `CLASSIFY_SYSTEM`, `RECOMMENDATION_PROMPT`, `CONNECTOR_MAPPING_PROMPT` |
| `build*Prompt` functions | `buildTextToSqlPrompt()`, `buildColumnAnalysisPrompt()` |
| `get*Template` functions | `getAgentSummaryTemplate()`, `getReportGenerationTemplate()` |

Additionally, significant boilerplate duplication exists across prompts:
- **"No markdown / output only JSON" instruction**: 14 files, 19 occurrences, each slightly different
- **RULES numbered-list format**: 6 files with nearly identical blocks (`sql-generator.ts` and `segments/generate-sql/route.ts` share 4 of 5 rules verbatim)
- **"Cite real numbers" instruction**: 5 files
- **Chart block spec**: duplicated within `analyze.ts` across `getReportGenerationTemplate` and `getQuickResponseTemplate`

### Full Prompt Inventory

| File | Prompt / Constant | Category | Proposed Target |
|------|-------------------|----------|-----------------|
| `src/lib/sql-generator.ts` | `buildTextToSqlPrompt()` | builder fn | `src/lib/prompts/sql.ts` |
| `src/lib/sql-generator.ts` | Agent prompt fragment (inline in `generateAgentQueries`) | inline | `src/lib/prompts/sql.ts` |
| `src/lib/sql-generator.ts` | `retryWithError()` inline template | inline | `src/lib/prompts/sql.ts` |
| `src/lib/prompts/analyze.ts` | `getAgentSummaryTemplate()` | template fn | already correct |
| `src/lib/prompts/analyze.ts` | `getCritiqueSummaryTemplate()` | template fn | already correct |
| `src/lib/prompts/analyze.ts` | `getReportGenerationTemplate()` | template fn | already correct |
| `src/lib/prompts/analyze.ts` | `getQuickResponseTemplate()` | template fn | already correct |
| `src/lib/datasets/schema-enricher.ts` | `buildColumnAnalysisPrompt()` | builder fn | `src/lib/prompts/dataset-enrichment.ts` |
| `src/lib/datasets/schema-enricher.ts` | `buildPromptGenerationInput()` | builder fn | `src/lib/prompts/dataset-enrichment.ts` |
| `src/lib/datasets/generic-prompts.ts` | `buildGenericSystemContext()` | builder fn | `src/lib/prompts/schema-generic.ts` |
| `src/lib/datasets/generic-prompts.ts` | `buildEnrichedSystemContext()` | builder fn | `src/lib/prompts/schema-generic.ts` |
| `src/lib/datasets/generic-prompts.ts` | `buildGenericMultiAgentPrompt()` | builder fn | `src/lib/prompts/schema-generic.ts` |
| `src/lib/datasets/generic-prompts.ts` | `buildGenericSchemaContext()` | builder fn | `src/lib/prompts/schema-generic.ts` |
| `src/lib/datasets/metric-generator.ts` | `buildMetricGenerationPrompt()` | builder fn | `src/lib/prompts/metrics.ts` |
| `src/app/api/classify/route.ts` | `CLASSIFY_SYSTEM` constant | constant | `src/lib/prompts/classify.ts` |
| `src/app/api/chat/route.ts` | Inline `systemPrompt` (line 26) | inline | *(skip — demo app, single use)* |
| `src/app/api/segments/generate-sql/route.ts` | `buildSegmentSqlPrompt()` | builder fn | merge into `src/lib/prompts/sql.ts` |
| `src/app/api/playbook/create/route.ts` | `getOutlinePrompt()` | builder fn | *(skip — Phase 3)* |
| `src/app/api/playbook/create/route.ts` | `getDetailFillPrompt()` | builder fn | *(skip — Phase 3)* |
| `src/app/api/playbook/create/route.ts` | `getPlaybookGenerationPrompt()` | builder fn | *(skip — Phase 3)* |
| `src/lib/connector-categories.ts` | `CONNECTOR_MAPPING_PROMPT` | constant | `src/lib/prompts/connectors.ts` |
| `src/lib/action-recommender.ts` | `RECOMMENDATION_PROMPT` | constant | `src/lib/prompts/actions.ts` |
| `src/app/api/knowledge/parse/route.ts` | `PARSE_PROMPT` | constant | `src/lib/prompts/knowledge.ts` |
| `src/app/api/datasets/[id]/prompts/route.ts` | Inline Gemini call (lines 37–47) | inline | *(skip — Phase 3)* |

### Revised Proposed Structure (11 files)

```
src/lib/prompts/
  analyze.ts            ← already exists; no changes needed
  classify.ts           ← CLASSIFY_SYSTEM from api/classify/route.ts
  sql.ts                ← buildTextToSqlPrompt + buildSegmentSqlPrompt (merged) + retry
  dataset-enrichment.ts ← buildColumnAnalysisPrompt + buildPromptGenerationInput
                          (note: named "dataset-enrichment" NOT "schema-enricher" to avoid
                          confusion with src/lib/datasets/schema-enricher.ts)
  schema-generic.ts     ← all 4 functions from generic-prompts.ts (rename the file)
  metrics.ts            ← buildMetricGenerationPrompt from metric-generator.ts
  connectors.ts         ← CONNECTOR_MAPPING_PROMPT from connector-categories.ts
  actions.ts            ← RECOMMENDATION_PROMPT from action-recommender.ts
  knowledge.ts          ← PARSE_PROMPT from knowledge/parse/route.ts
```

**Key decisions:**
- `segments.ts` does NOT exist separately — `buildSegmentSqlPrompt` merges into `sql.ts` because it shares 4 of 5 RULES verbatim with `buildTextToSqlPrompt`. Co-location makes the shared rules visible and deduplication easy.
- No `index.ts` barrel — use direct file imports. Barrel files obscure the dependency graph and can hide circular import risks.
- `dataset-enrichment.ts` NOT `schema-enricher.ts` — avoids naming collision with `src/lib/datasets/schema-enricher.ts`.

### High-Value Deduplication to Do During the Move

When moving prompts, fix these duplications in the same pass:

**Shared SQL output instruction** (currently 19 copy-pasted variants):
```typescript
// src/lib/prompts/sql.ts
export const OUTPUT_SQL_ONLY =
  "Output ONLY a valid DuckDB SQL query. No markdown, no explanation, no backticks, no code fences.";

export const OUTPUT_JSON_ONLY =
  "Respond with ONLY valid JSON. No markdown, no explanation, no code fences.";
```

Both `buildTextToSqlPrompt` and `buildSegmentSqlPrompt` can use `OUTPUT_SQL_ONLY`. Several enrichment prompts can use `OUTPUT_JSON_ONLY`.

**Chart block spec** (duplicated in `analyze.ts` between report and quick templates):
```typescript
// src/lib/prompts/analyze.ts
const CHART_BLOCK_INSTRUCTIONS = `...`; // extracted constant, used in both templates
```

### Implementation Order (Phases 1 + 2)

Implement in this sequence to avoid compile errors:

**Phase 1 — Pure constants (zero behavioral risk):**
1. Create `src/lib/prompts/classify.ts` — extract `CLASSIFY_SYSTEM` (**WARNING: preserve expanded keywords and bias rule verbatim** per `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`. The `{METRICS}` placeholder and `.replace()` call must be preserved at the call site in `classify/route.ts`)
2. Create `src/lib/prompts/actions.ts` — extract `RECOMMENDATION_PROMPT`
3. Create `src/lib/prompts/connectors.ts` — extract `CONNECTOR_MAPPING_PROMPT`
4. Create `src/lib/prompts/knowledge.ts` — extract `PARSE_PROMPT`
5. Update imports in the 4 source files; verify `pnpm build` passes

**Phase 2 — Builder functions in lib (rename + dedup):**
1. Create `src/lib/prompts/sql.ts` — move `buildTextToSqlPrompt`, agent fragment, retry prompt from `sql-generator.ts`; merge `buildSegmentSqlPrompt` from `segments/generate-sql/route.ts`; extract `OUTPUT_SQL_ONLY` constant
2. Create `src/lib/prompts/dataset-enrichment.ts` — move `buildColumnAnalysisPrompt` and `buildPromptGenerationInput` from `schema-enricher.ts`; extract `OUTPUT_JSON_ONLY`
3. Rename `src/lib/datasets/generic-prompts.ts` → `src/lib/prompts/schema-generic.ts` and update all imports
4. Create `src/lib/prompts/metrics.ts` — move `buildMetricGenerationPrompt` from `metric-generator.ts`
5. Fix `analyze.ts` internal chart block duplication (extract `CHART_BLOCK_INSTRUCTIONS`)
6. Verify `pnpm build` passes after each step

### Classifier Migration Warning

The `CLASSIFY_SYSTEM` constant has been hardened against misrouting (see `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`). When extracting it:

- **Do not simplify the keyword list** — the expanded analytics signals (`segments`, `cohorts`, `SQL`, `queries`, `user counts`, `filtering`, `creating segments`, `pushing to integrations`) are there because Gemini misclassified composite queries without them.
- **Do not remove the bias rule** — "If query mentions data/SQL/users/segments/customers/revenue/database concepts OR action that implies data work → ALWAYS analytics" is not redundant; it's the explicit tie-breaker.
- **The `{METRICS}` replace pattern stays at the call site** — `CLASSIFY_SYSTEM` is not a pure constant; it has a runtime parameter. Consider renaming it `buildClassifyPrompt(metricList: string): string` during the migration to make the dependency explicit.

### Acceptance Criteria

- [x] `SENTINEL_SYSTEM_TABLES` exported from `src/lib/db.ts`; imported in upload route (not redeclared)
- [x] All Phase 1 constants extracted to `src/lib/prompts/`; `pnpm build` passes
- [x] All Phase 2 builder functions moved; `pnpm build` passes
- [x] `buildTextToSqlPrompt` and `buildSegmentSqlPrompt` share the SQL RULES block (no duplication)
- [x] `OUTPUT_SQL_ONLY` and `OUTPUT_JSON_ONLY` constants defined in `sql.ts` and `dataset-enrichment.ts` respectively
- [x] `CLASSIFY_SYSTEM` keyword inventory and bias rule preserved verbatim
- [x] No `index.ts` barrel created
- [x] `schema-enricher.ts` in `datasets/` still exists; only the prompt builder functions moved out

---

## Files to Change

### Part 1 (Bug fix)

- **`src/lib/db.ts`** — export `SENTINEL_SYSTEM_TABLES` Set (lines ~99-120, near the DDL)
- **`src/app/api/datasets/upload/route.ts`** — import `SENTINEL_SYSTEM_TABLES`; add filter before UNION ALL (~line 406); add `countRows.length === 0` guard (~line 426); update empty-table error messages

### Part 2 (Cleanup — Phases 1+2)

**Phase 1:**
- Create `src/lib/prompts/classify.ts`
- Create `src/lib/prompts/actions.ts`
- Create `src/lib/prompts/connectors.ts`
- Create `src/lib/prompts/knowledge.ts`
- Update `src/app/api/classify/route.ts` — import from prompts; change to `buildClassifyPrompt(metricList)`
- Update `src/lib/action-recommender.ts` — import from prompts
- Update `src/lib/connector-categories.ts` — import from prompts
- Update `src/app/api/knowledge/parse/route.ts` — import from prompts

**Phase 2:**
- Create `src/lib/prompts/sql.ts`
- Create `src/lib/prompts/dataset-enrichment.ts`
- Rename `src/lib/datasets/generic-prompts.ts` → `src/lib/prompts/schema-generic.ts`; update all imports
- Create `src/lib/prompts/metrics.ts`
- Update `src/lib/sql-generator.ts` — import from `prompts/sql.ts`
- Update `src/lib/datasets/schema-enricher.ts` — import from `prompts/dataset-enrichment.ts`
- Update `src/lib/datasets/metric-generator.ts` — import from `prompts/metrics.ts`
- Update `src/app/api/segments/generate-sql/route.ts` — import `buildSegmentSqlPrompt` from `prompts/sql.ts`
- Fix `src/lib/prompts/analyze.ts` — extract `CHART_BLOCK_INSTRUCTIONS` constant

---

## References

- Upload route: `src/app/api/datasets/upload/route.ts:396-430` (table filter + UNION ALL)
- DuckDB initConnection sentinel DDL: `src/lib/db.ts:99-132`
- Integrations API route: `src/app/api/integrations/route.ts`
- Existing prompts: `src/lib/prompts/analyze.ts`
- Classifier misrouting fix (applies to CLASSIFY_SYSTEM migration): `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`
- The sentinel_ rename was done in `feat/upload-duckdb-multi-table` (merged commit `1cae518`)
- Original upload plan: `docs/plans/2026-03-02-feat-upload-duckdb-multi-table-plan.md`

### External Research Sources

- DuckDB `information_schema` vs `duckdb_tables()`: `information_schema` already excludes internal objects — SQL query is correct as-is
- Prompt management best practices: Git-native + typed input interfaces + Zod for JSON-output prompts (Promptfoo for CI testing when ready)
- Prompt variant A/B: environment variable toggle + `Record<variant, PromptBuilder>` typed map — zero runtime overhead
