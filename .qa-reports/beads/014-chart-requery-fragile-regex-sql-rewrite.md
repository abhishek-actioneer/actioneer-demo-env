# BEAD-014: chart-requery regex SQL rewrite is fragile for multi-predicate queries

**Severity:** MEDIUM
**Category:** Correctness / Edge Case
**Page:** Board chart controls (grain/date picker)
**Ship-Readiness Impact:** WARN
**PR:** #48

---

## Summary

`transformDateRange()` in `/api/chart-requery/route.ts` replaces date literals by matching the *first* `>=` and `<=` patterns it finds. If SQL contains multiple date predicates (e.g., `WHERE order_date >= '...' AND refund_date >= '...'`), the wrong predicate gets replaced, producing incorrect query results silently.

## Root Cause

**File:** `src/app/api/chart-requery/route.ts` (lines 41–65)

```typescript
function transformDateRange(sql: string, newRange: { start: string; end: string }): string {
  let result = sql;
  // Pattern 1: replaces FIRST >= date literal found
  result = result.replace(
    /(>=\s*')(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?)((?:::(?:TIMESTAMP|DATE))?')/gi,
    `$1${safeStart}$3`,
  );
  // ...
}
```

The regex uses `String.replace()` which only replaces the first match by default — but the `g` flag is set, so it actually replaces *all* date predicates. Both behaviors are problematic:
- Without `g`: only the first date predicate is rewritten (wrong if it's not the target column)
- With `g`: all date predicates are rewritten (wrong if different columns have different date ranges)

## Example

Input SQL:
```sql
SELECT * FROM orders
WHERE order_date >= '2024-01-01' AND order_date <= '2024-12-31'
  AND refund_date >= '2024-06-01' AND refund_date <= '2024-06-30'
```

With `g` flag, both date ranges get overwritten to the new range, destroying the refund_date filter.

## Recommended Fix

1. **Short-term**: Document the limitation clearly. The LLM-generated SQL for chart cards typically has a single date predicate, so this works for the common case.
2. **Medium-term**: Parse the SQL to identify which column is the x-axis date column (available from `ChartSpec.xKey`), then only replace predicates on that column.
3. **Long-term**: Use a proper SQL AST parser (e.g., `node-sql-parser`) for deterministic rewrites.
