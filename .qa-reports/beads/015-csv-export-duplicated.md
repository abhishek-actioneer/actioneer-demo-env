# BEAD-015: CSV export logic duplicated between chart-drawer and unified-chart

**Severity:** LOW
**Category:** Code Quality / DRY
**Page:** Any chart with export
**Ship-Readiness Impact:** INFO
**PR:** #48

---

## Summary

The CSV export logic (building header + body rows, creating a Blob, triggering download via anchor element) is duplicated in two places:

1. `src/components/chart/chart-drawer.tsx` — standalone `exportCSV()` function (lines 9–25)
2. `src/components/chart/unified-chart.tsx` — inline `onClick` handler in the export overlay (lines ~240–260)

Both implementations are identical. If the CSV format needs to change (e.g., BOM for Excel, quoting rules, date formatting), both must be updated.

## Files

- `src/components/chart/chart-drawer.tsx` — `exportCSV(spec, fullData)` function
- `src/components/chart/unified-chart.tsx` — inline anonymous function in export button onClick

## Fix

Extract to a shared utility, e.g., `src/lib/csv-export.ts`:

```typescript
export function downloadCSV(rows: Record<string, unknown>[], filename: string): void { ... }
```

Import in both `chart-drawer.tsx` and `unified-chart.tsx`.
