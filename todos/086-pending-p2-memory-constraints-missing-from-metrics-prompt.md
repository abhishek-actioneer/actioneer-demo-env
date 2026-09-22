---
status: pending
priority: p2
issue_id: "086"
tags: [code-review, consistency, prompts, pr-41]
dependencies: []
---

# Memory constraints missing from metrics generation prompt

## Problem Statement

`src/lib/prompts/segments.ts` includes a `MEMORY CONSTRAINTS` section reading `process.env.DUCKDB_MEMORY_LIMIT`, but `src/lib/prompts/metrics.ts` does not — even though metric SQL (`valueSql`, `timeSeriesSql`) is also executed against DuckDB with the same memory limit.

The established pattern (also in `src/lib/prompts/sql.ts`) is to include memory-aware guidance in any prompt that generates DuckDB SQL.

## Findings

Source: Architecture strategist + Pattern recognition agents.

- `segments.ts` line 21: `const memoryLimit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";`
- `metrics.ts`: No memory constraints section
- `sql.ts` line 28: Same memory constraints pattern

## Proposed Solutions

**Option A (Recommended): Add MEMORY CONSTRAINTS to metrics prompt**
- Copy the same block from segments.ts
- Effort: Trivial | Risk: None

## Technical Details

- **Affected files:** `src/lib/prompts/metrics.ts`

## Acceptance Criteria

- [ ] Metrics prompt includes MEMORY CONSTRAINTS section
- [ ] Generated metric SQL is memory-aware

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Prompt consistency across SQL-generating prompt builders |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
