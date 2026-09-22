---
problem_type: llm_prompt_context_bias
component: deck_sql_generation
symptoms:
  - SQL WHERE clauses contain wrong year (2026 instead of 2025) for date-bounded queries
  - Extraction prompt returns human-readable dates that downstream LLM misinterprets
  - Date constraint present in system prompt only, absent from user message sent to SQL LLM
  - Schema context string biases SQL LLM toward current year
severity: high
affected_files:
  - src/app/api/decks/process/route.ts
  - src/lib/prompts/sql.ts
  - src/lib/datasets/quickhelp.ts
date_resolved: 2026-03-16
related_docs:
  - docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md
  - docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md
  - docs/solutions/database-issues/duckdb-node-api-v1-usage-patterns.md
  - docs/plans/2026-03-16-fix-board-follow-up-time-period-context-plan.md
  - docs/plans/2026-03-11-feat-living-deck-plan.md
---

# Deck Review Date Year Parsed Incorrectly in SQL Generation

## Problem

A PDF deck with review period "W4 · Jan 20–26, 2025" produced SQL with `WHERE booking_date BETWEEN '2025-02-01' AND '2026-01-26'` — the upper bound year was wrong (2026 instead of 2025). Charts rendered data far beyond the intended review period.

## Root Cause Chain (3 Compounding Issues)

### Issue 1 — Ambiguous date format in extraction

**File:** `src/app/api/decks/process/route.ts:93`

The extraction prompt asked Gemini to extract dates in human-readable format ("Jan 26, 2025"). Human-readable dates are ambiguous for downstream LLM consumption, making them susceptible to misinterpretation.

### Issue 2 — Conflicting schema context

**File:** `src/lib/datasets/quickhelp.ts:50`

The `schemaContext` contains `"TABLE: bookings (~206K rows, Feb 2025 – Feb 2026)"`. This biases the SQL-generating LLM toward 2026 dates, overriding the correct year from the `dateRangeOverride`.

### Issue 3 — Date constraint missing from user message

**Files:** `src/lib/prompts/sql.ts:38` and `route.ts:177`

The date override was only placed in Rule 4 of the system prompt (`buildTextToSqlPrompt`). The actual user message sent to the SQL LLM in `generateSQL()` had zero mention of dates. LLMs weight user messages more heavily than system prompt rules, so the constraint was effectively ignored.

### Collateral: DuckDB WAL corruption (red herring)

Killing the dev server with `kill -9` (SIGKILL) while DuckDB had an open WAL caused corruption. All subsequent queries failed with "Failure while replaying WAL file". This was unrelated to the date bug but obscured debugging. Fix: `rm data/*.wal`.

## Investigation Steps

1. Initial symptom: SQL showed `2026-01-26` instead of `2025-01-26`
2. First fix attempt (ISO format in extraction prompt) did not resolve it alone
3. Traced the full prompt chain: extraction → `processSlide` wrapping → `buildTextToSqlPrompt` → `generateSQL` user message
4. Discovered the user message in `generateSQL()` had no date mention at all
5. Discovered the `schemaContext` contained "Feb 2025 – Feb 2026" which biased the LLM toward 2026
6. After adding date to user message, charts disappeared — traced to data mismatch (deck review date Jan 2025 predates dataset starting Feb 2025)
7. Demo data updated to align dates

## Fixes Applied

### Fix 1 — ISO date extraction (`route.ts:93`)

```diff
-Also extract deckReviewDate: ... (e.g., "Jan 26, 2025")
+Also extract deckReviewDate: ... in ISO 8601 format (YYYY-MM-DD) (e.g., "2025-01-26")
```

### Fix 2 — Date filter injected into user message (`route.ts:164-180`)

Added `dateRangeText` parameter to `generateSQL()`. The user message now includes:

```
Date filter: data up to 2025-01-26. You MUST add a WHERE clause to restrict data to this date range.
```

### Fix 3 — WAL cleanup

```bash
rm data/*.wal
```

## Prevention Rules

### Multi-LLM pipeline data integrity

- **Treat inter-LLM boundaries as serialization boundaries.** Every piece of data crossing an LLM boundary must be explicitly serialized. Never rely on LLM B to "know" something only told to LLM A.
- **Define strict output schemas for intermediate LLMs.** Validate envelopes programmatically before passing downstream. Fail fast on missing/malformed fields.
- **Log the exact inter-LLM payload.** Place a debug log line between the two LLM calls showing the full string/object passed.

### Placing critical constraints in LLM prompts

- **System prompt = role/rules; user message = task + all constraints.** Critical constraints belong in the user message, not only the system prompt.
- **Repeat constraints at the point of use.** A date range mentioned 500 tokens ago has less influence than one stated in the immediate instruction block.
- **Isolate constraint blocks from descriptive context.** Schema-level date ranges in context strings silently compete with explicit constraints. When a `dateRangeOverride` is active, either suppress the schema date range or add an explicit override instruction.

### Date format standardization

- **Always use ISO 8601 (YYYY-MM-DD) at LLM boundaries.** Never pass human-readable dates between LLMs.
- **Validate programmatically** (`/^\d{4}-\d{2}-\d{2}$/`) before injection into downstream prompts.
- **Include the format in the constraint statement.** E.g.: `"Use start_date = '2024-07-01' (ISO 8601, YYYY-MM-DD format)"`.

### DuckDB dev server safety

- **Never `kill -9` the dev server.** Use `kill <pid>` (SIGTERM) or Ctrl+C. SIGKILL leaves the WAL in a corrupted state.
- **WAL recovery:** Delete only the `.wal` file, not the `.duckdb` file. The main file is the last clean checkpoint.
- **Standalone scripts:** Use `:memory:` + `read_parquet()` instead of opening the `.duckdb` file to avoid lock contention.

## Key Lesson

When passing override constraints (date ranges, filters) to an LLM for SQL generation, the constraint must appear in the **user message**, not only in system prompt rules. System prompt rules are lower-weight guidance; user message content drives LLM behavior more strongly. Schema context strings containing date ranges can silently override explicit constraints if they conflict.
