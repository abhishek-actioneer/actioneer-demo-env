---
title: "fix: Pie charts blank in deck slides — nameKey/valueKey never set"
type: fix
date: 2026-03-13
---

# fix: Pie charts blank in deck slides — nameKey/valueKey never set

## Problem Statement

Pie charts in deck slide cards render as blank — empty donut/pie, no visible segments, and the stats footer shows `Largest: undefined` / `Smallest: undefined`.

**Root cause:** `buildChartSpec()` in `src/app/api/decks/process/route.ts` always returns `xKey`/`yKeys` for every chart type including `"pie"`. But `ReportChart` for pie charts uses `spec.nameKey` and `spec.valueKey` — not `xKey`/`yKeys`. Since neither `nameKey` nor `valueKey` is ever set by `buildChartSpec`, the component defaults to looking for column names `"name"` and `"value"`, which don't exist in the SQL result data.

**Symptoms:**
- Blank pie area (no segments rendered — `dataKey="value"` finds nothing)
- `"Largest: undefined"` / `"Smallest: undefined"` in stats row (`d["name"]` → `String(undefined)`)
- Legend shows N× `"value"` labels instead of real category names
- Categories count is correct (data is present, just miskeyed)

## Context

**Reference for correct pie ChartSpec construction:** `src/app/api/canvas-query/route.ts:85–95` already handles this correctly by setting `nameKey` and `valueKey` explicitly when chart type is `"pie"`. The LLM prompt in `src/lib/prompts/analyze.ts` also instructs the model to use `nameKey`/`valueKey` for pie charts.

**ChartSpec type** (`src/lib/chart-types.ts:12–13`) already has optional `nameKey?: string` and `valueKey?: string` fields — no type changes needed.

**No transformation** occurs between `buildChartSpec` output and `ReportChart` — the spec is stored in `deck-store` and passed straight through `deck-canvas.tsx` → `chart-renderer.tsx` → `<ReportChart spec={spec} />`.

## Acceptance Criteria

- [x] Pie charts in deck slides render with visible segments
- [x] Stats footer shows real category names (e.g. `"premium"`) not `"undefined"`
- [x] Legend shows actual category names from the data
- [x] Bar / line / area charts are unaffected (only the pie branch changes)
- [x] No changes to `ChartSpec`, `ReportChart`, `chart-types.ts`, or any consumer

## Fix

**One file, one function:** `src/app/api/decks/process/route.ts` — `buildChartSpec()` (line ~149).

Change the returned object from always using `xKey`/`yKeys` to conditionally using `nameKey`/`valueKey` when `type === "pie"`:

```typescript
// Before (broken for pie):
return {
  type,
  xKey,
  yKeys: [yKey],
  data: data as Record<string, string | number>[],
  title: slideTitle,
  ...(chart.xAxisLabel && { xAxisLabel: chart.xAxisLabel }),
  ...(chart.yAxisLabel && { yAxisLabel: chart.yAxisLabel }),
};

// After:
return {
  type,
  ...(type === "pie"
    ? { nameKey: xKey, valueKey: yKey }
    : { xKey, yKeys: [yKey] }),
  data: data as Record<string, string | number>[],
  title: slideTitle,
  ...(chart.xAxisLabel && { xAxisLabel: chart.xAxisLabel }),
  ...(chart.yAxisLabel && { yAxisLabel: chart.yAxisLabel }),
};
```

**Key derivation logic** (`xKey` and `yKey`) is already correct — `xKey` is the first column (the dimension / category column, e.g. `service_tier`) and `yKey` is the first numeric column (the measure, e.g. `revenue_share`). These map directly to `nameKey` and `valueKey` respectively.

## References

- Bug location: `src/app/api/decks/process/route.ts:149` — `buildChartSpec()`
- Consumer: `src/components/chart/report-chart.tsx:247–248` — pie reads `nameKey`/`valueKey`
- Correct pattern: `src/app/api/canvas-query/route.ts:85–95` — sets `nameKey`/`valueKey` for pie
- ChartSpec type: `src/lib/chart-types.ts:12–13`
- Related brainstorm: `docs/brainstorms/2026-03-11-chart-visual-parity-brainstorm.md` (visual parity work — orthogonal to this fix)
