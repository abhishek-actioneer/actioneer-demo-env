---
module: Forecasting
date: 2026-02-20
problem_type: best_practice
component: frontend_stimulus
symptoms:
  - "Chart tooltip showing 14+ decimal places (e.g. 63.89384474137636)"
  - "Chart styling inconsistent with existing report-chart.tsx (different grid, tooltip, colors)"
  - "No custom tooltip — using default Recharts contentStyle instead of CustomTooltip pattern"
root_cause: config_error
resolution_type: code_fix
severity: medium
tags: [recharts, chart, tooltip, consistency, design-system]
---

# Troubleshooting: New Recharts Charts Must Match report-chart.tsx Conventions

## Problem
When creating a new Recharts chart (forecast-chart.tsx), the chart used its own ad-hoc styling (custom fc-* CSS variables, inline contentStyle tooltip, oklch gray shades) instead of matching the existing `report-chart.tsx` conventions. This produced visual inconsistency and unrounded tooltip values showing 14+ decimal places.

## Environment
- Module: Forecasting
- Stack: Next.js 16 / React 19 / Recharts 3.7
- Affected Component: `src/components/forecast/forecast-chart.tsx`
- Reference Component: `src/components/chart/report-chart.tsx`
- Date: 2026-02-20

## Symptoms
- Tooltip values like `63.89384474137636` instead of `63.89`
- Chart used `var(--fc-surface)` background instead of `bg-card` wrapper
- Grid used solid lines instead of `strokeDasharray="3 3"` with `opacity-30`
- Tooltip used inline `contentStyle` object instead of `CustomTooltip` React component
- Color palette used oklch grays instead of `var(--color-muted-foreground)` neutrals

## What Didn't Work

**Attempted Solution 1:** Using page-specific `--fc-*` CSS variables for chart colors
- **Why it failed:** Created visual inconsistency — the chart looked different from every other chart in the product. The `--fc-*` tokens are for the table/page chrome, not for Recharts charts which have their own established pattern.

## Solution

Rewrite the chart to match `report-chart.tsx` exactly:

**Code changes:**

```tsx
// Before (inconsistent):
<div style={{ border: "1px solid var(--fc-border)", background: "var(--fc-surface-sunken)" }}>
  <CartesianGrid stroke="var(--fc-border)" horizontal={true} vertical={false} />
  <Tooltip contentStyle={{ background: "var(--fc-surface)", ... }} />
  // oklch gray palette
  const GRAY_SHADES = ["oklch(0.55 0 0)", "oklch(0.40 0 0)"];

// After (consistent):
<div className="my-4 border border-border rounded-lg p-4 bg-card mb-6">
  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} className="opacity-30" />
  <Tooltip content={<CustomTooltip formatMap={formatMap} />} cursor={{ fill: "var(--color-muted)", opacity: 0.5 }} />
  // Neutral palette from report-chart
  const NEUTRALS = [
    "var(--color-muted-foreground)",
    "color-mix(in srgb, var(--color-muted-foreground) 70%, transparent)",
  ];
```

**CustomTooltip with rounding:**

```tsx
function formatTooltipValue(val: number, fmt: CellFormat): string {
  const rounded = Math.round(val * 100) / 100;
  if (fmt === "currency")
    return "$" + rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (fmt === "percent") return rounded.toFixed(2) + "%";
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function CustomTooltip({ active, payload, label, formatMap }) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter((e) => e.value != null);
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-sm">
      <p className="text-[11px] font-medium text-foreground mb-1">{label}</p>
      {entries.map((entry, i) => (
        <p key={i} className="text-[11px] text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5"
            style={{ backgroundColor: entry.color }} />
          {entry.name}: {formatTooltipValue(entry.value, formatMap[baseKey])}
        </p>
      ))}
    </div>
  );
}
```

## Why This Works

1. **Root cause:** The chart was built from scratch with its own design tokens instead of following the established `report-chart.tsx` pattern. Every Recharts chart in the product should share the same visual language.
2. **CustomTooltip pattern:** The `contentStyle` prop on Recharts `<Tooltip>` only styles the container — it doesn't control value formatting. A custom `content` prop with a React component gives full control over both layout and value formatting.
3. **Color consistency:** Using `var(--color-muted-foreground)` and `var(--color-border)` (shadcn/Tailwind bridge tokens) ensures charts adapt to theme changes, while page-specific `--fc-*` tokens are only appropriate for non-chart UI elements.

## Prevention

- **Before creating any new Recharts chart**, read `src/components/chart/report-chart.tsx` and copy its patterns:
  - Wrapper: `border border-border rounded-lg p-4 bg-card`
  - Grid: `strokeDasharray="3 3"` + `vertical={false}` + `className="opacity-30"`
  - Tooltip: `content={<CustomTooltip />}` (never `contentStyle`)
  - Colors: `#10b981` accent, `var(--color-muted-foreground)` neutrals
  - Axes: fontSize 11, `tickLine={false}`, YAxis `width={60}`
- **Always round tooltip values** — raw computed values will have floating point artifacts. Use `Math.round(val * 100) / 100` before formatting.
- **Page-specific CSS tokens** (`--fc-*`, `--canvas-*`) are for page chrome (tables, panels, backgrounds), NOT for Recharts charts.

## Related Issues

- See also: [canvas-dark-mode-centralized-theming-bypass-20260219.md](canvas-dark-mode-centralized-theming-bypass-20260219.md) — similar pattern of using centralized design tokens instead of ad-hoc values
