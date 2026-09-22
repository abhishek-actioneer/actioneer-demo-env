# BEAD-012: Module-level mutable palette state in chart-colors.ts

**Severity:** MEDIUM
**Category:** Architecture / SSR Safety
**Page:** All pages rendering charts
**Ship-Readiness Impact:** WARN
**PR:** #48

---

## Summary

`src/lib/chart-colors.ts` uses a module-level `let _activePalette` variable mutated by `setChartPalette()`. In SSR and concurrent rendering, all requests share the same module scope. If two users (or two tabs in dev) set different palettes, they bleed into each other's renders.

## Root Cause

**File:** `src/lib/chart-colors.ts` (line 88)

```typescript
let _activePalette: ChartPaletteName = "default";

export function setChartPalette(name: ChartPaletteName) {
  _activePalette = name;
}

export function getSeriesColor(index: number): string {
  const colors = PALETTES[_activePalette];
  return colors[index % colors.length];
}
```

`getSeriesColor()` is called from `chart-core.tsx` and `chart-legend.tsx` during render. If the module state changes between renders, colors become inconsistent.

## Current Impact

Currently only consumed in the `/dev/charts` harness via `setChartPalette()`. No production code path calls `setChartPalette()`. But the exported API invites production use (e.g., a user preference for CVD palette).

## Recommended Fix

Replace module-level state with React context:
- Create a `ChartPaletteProvider` that holds the active palette
- `getSeriesColor(index)` becomes a hook `useSeriesColor(index)` or takes palette as a parameter
- Alternatively, pass palette name through `ChartSpec` and thread it to `ChartCore`

Lower-effort: make `getSeriesColor(index, palette?)` accept an optional palette override, with the default remaining `"default"`. This keeps the API simple and avoids module state.
