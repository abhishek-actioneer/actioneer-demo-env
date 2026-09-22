---
status: complete
priority: p1
issue_id: "120"
tags: [code-review, bug, chart, pr-48]
dependencies: []
---

# Module-level mutable Y-axis context in ChartCore corrupts multi-chart pages

## Problem Statement

`src/components/chart/chart-core.tsx` uses module-level mutable variables for Y-axis formatting:

```ts
let _yFmt: "number" | "currency" | "percent" | undefined;
let _ySym = "$";

export function setYAxisContext(fmt, currency) {
  _yFmt = fmt;
  _ySym = currency ?? "$";
}
```

`setYAxisContext()` is called during the render body (line 513) of every `ChartCore` instance. When multiple charts exist on the same page (e.g., a board with 4 chart cards), each render call overwrites the module-level singleton. The last chart to render wins — all other charts on that page will have `formatAxisTick()` use the wrong format type and currency symbol.

This causes silent Y-axis formatting corruption on any board with more than one chart.

## Findings

Source: TypeScript reviewer + Performance oracle.

- `chart-core.tsx:33–38` — module-level `_yFmt` and `_ySym` declarations
- `chart-core.tsx:513` — `setYAxisContext()` called inside render function
- `chart-core.tsx:128` — comment notes "no module-level mutation" was the goal for X-axis, but Y-axis violates it
- Affects any board view with multiple chart cards
- The author was aware of this concern (comment at line 128) but didn't apply it consistently

## Proposed Solutions

**Option A (Recommended): Pass fmt/currency as closure parameters**
- Remove `_yFmt`, `_ySym`, `setYAxisContext` entirely
- Inside the component, create `formatAxisTick` as a `useCallback` that closes over the pre-computed `primaryFmt` and `currency`:
```ts
const formatAxisTick = useCallback((val: number) => {
  // primaryFmt and currency computed above, closed over here
  return formatValue(val, primaryFmt, currency);
}, [primaryFmt, currency]);
```
- Effort: Small | Risk: Low

**Option B: Move state into component scope via ref**
- Use a `useRef` to hold the format context, updated at render time
- Still a side-effect in render but component-scoped
- Effort: Small | Risk: Low

## Recommended Action

Option A — remove the module-level globals entirely and pass format context as closed-over values.

## Technical Details

- **Affected files:** `src/components/chart/chart-core.tsx:33–38, 513`
- Symptoms: Y-axis on chart A shows currency format when chart B (rendered after A) uses percent format
- Only manifests when multiple charts are on the same page simultaneously

## Acceptance Criteria

- [x] No module-level mutable variables remain in chart-core.tsx
- [x] Multiple charts on the same board page all show correct Y-axis formatting
- [x] `setYAxisContext` removed from the module exports

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (typescript-reviewer + performance-oracle) | Module-level state in render is always wrong in React concurrent mode |
| 2026-03-23 | Fixed: removed `_yFmt`, `_ySym`, `setYAxisContext` entirely. `formatAxisTick` now takes explicit `fmt` and `sym` params. Inside `ChartCore`, a `useCallback`-memoised `formatYAxisTick` closes over `primaryFmt` and `ySym` and is passed to the Recharts YAxis tick renderer. No module-level mutation remains. | Option A from the proposed solutions. Zero external callers of the old API so no other files needed updating. |

## Resources

- PR #48: Unified Chart System + Server Persistence
