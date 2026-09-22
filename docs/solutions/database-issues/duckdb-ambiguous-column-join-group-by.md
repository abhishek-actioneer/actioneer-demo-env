---
title: "DuckDB 'Ambiguous reference to column name' in JOIN with Positional GROUP BY"
date: 2026-03-16
category: database-issues
subcategory: sql-query-errors
severity: medium
status: solved
symptoms:
  - "Binder Error: Ambiguous reference to column name 'install_month'"
  - "DuckDB error during CREATE TABLE AS SELECT with LEFT JOIN"
  - "Error mentions '(use: \"i.install_month\" or \"s.install_month\")'"
  - "Query uses GROUP BY 1,2,3,4 with JOIN"
technologies:
  - "DuckDB @duckdb/node-api v1.4.4-r.1"
components:
  - "scripts/setup-gameramp.ts"
  - "src/lib/datasets/gameramp.ts (summaryTableSQL)"
---

# DuckDB 'Ambiguous reference to column name' in JOIN with Positional GROUP BY

## Problem

When creating a summary table with `CREATE OR REPLACE TABLE ... AS SELECT` that joined
two tables sharing a column name, DuckDB threw:

```
Binder Error: Ambiguous reference to column name "install_month"
(use: "i.install_month" or "s.install_month")
```

The query used positional `GROUP BY 1,2,3,4` and an unqualified `ORDER BY install_month`.

## Root Cause

DuckDB's binder resolves column names in `ORDER BY` independently of the `SELECT` list.
When two joined tables share a column name (`install_month` in both `installs i` and
`sessions s`), DuckDB cannot infer which table's column the `ORDER BY` refers to,
even if positional `GROUP BY` is used.

```sql
-- ❌ Fails: ORDER BY uses unqualified column present in both tables
SELECT i.install_month, i.channel, i.country, i.platform, ...
FROM installs i
LEFT JOIN sessions s ON s.user_id = i.user_id
GROUP BY 1, 2, 3, 4
ORDER BY install_month, channel  -- ambiguous!
```

## Fix

Qualify the `GROUP BY` and `ORDER BY` columns explicitly with table aliases:

```sql
-- ✅ Fixed: fully qualified GROUP BY and ORDER BY
SELECT i.install_month AS install_month,
       i.channel       AS channel,
       i.country       AS country,
       i.platform      AS platform, ...
FROM installs i
LEFT JOIN sessions s ON s.user_id = i.user_id
GROUP BY i.install_month, i.channel, i.country, i.platform
ORDER BY i.install_month, i.channel, i.country
```

## Rule

**In any DuckDB query that JOINs tables sharing column names:**
- Qualify every column in `SELECT`, `GROUP BY`, and `ORDER BY` with the table alias
- Avoid positional `GROUP BY 1,2,3` when the SELECT uses JOIN — it can mask ambiguity
- Use `col AS alias` in SELECT so the output columns are unambiguous

## When This Bites You

This pattern is common in:
- Summary table generation with `installs LEFT JOIN sessions` (both have `install_month`, `channel`, `country`, `platform`)
- Any multi-table join where both tables come from the same source schema
