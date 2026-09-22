---
title: "feat: Canvas Dark Mode CSS Variable Migration"
type: feat
date: 2026-02-19
---

# Canvas Dark Mode CSS Variable Migration

## Overview

The dark mode **infrastructure already exists** — `next-themes` ThemeProvider, `UserPanel` toggle (Light/Dark/System), and complete `:root` / `.dark` CSS variable blocks in `globals.css`. However, canvas components use ~35 hardcoded hex colors in inline styles, so toggling dark mode has no visible effect on the canvas page. This plan migrates those hardcoded values to CSS variable references.

## Problem Statement

When a user toggles dark mode via the existing UserPanel switcher, the sidebar and page shells respond correctly (they use Tailwind semantic classes like `bg-background`). But the canvas — dot grid, floating toolbar, chart/report/insight cards, SmartStack overlay — stays white because colors are hardcoded as hex strings in inline `style={{}}` objects.

## Proposed Solution

Replace all hardcoded hex colors in canvas components with `var(--token)` references. Add missing dark-mode token overrides in `globals.css`. Fix Recharts axis colors and CanvasConfigPanel badge classes.

## Files In Scope

| File | Changes |
|------|---------|
| `src/app/globals.css` | Add `.dark` overrides for severity bg tints, canvas shadow token |
| `src/components/canvas/chart-shape.tsx` | Replace `CARD_STYLE` bg, all text color hex values, box shadow |
| `src/components/canvas/canvas-page.tsx` | Replace DotGridBackground colors, FloatingToolbar colors |
| `src/components/canvas/smart-stack.tsx` | Replace insight card bg, badge text colors |
| `src/components/canvas/canvas-config-panel.tsx` | Add `dark:` Tailwind classes for severity badges, Remove button |
| `src/components/chart/report-chart.tsx` | Add explicit `fill` to Recharts axis ticks (canvas variant only) |

## Technical Approach

### Phase 1: CSS Token Foundation (`globals.css`)

Add dark-mode overrides for tokens that only exist in `:root`:

```css
.dark {
  --severity-critical-bg: oklch(0.22 0.08 15);    /* deep dark red */
  --severity-warning-bg: oklch(0.22 0.07 50);     /* deep dark amber */
  --severity-info-bg: oklch(0.22 0.08 250);       /* deep dark blue */
  --severity-critical-text: oklch(0.75 0.15 15);   /* light red text */
  --severity-warning-text: oklch(0.75 0.12 50);    /* light amber text */
  --severity-info-text: oklch(0.75 0.10 250);      /* light blue text */
}
```

Also add a canvas-specific shadow token:
```css
:root {
  --canvas-card-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
}
.dark {
  --canvas-card-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
}
```

### Phase 2: Canvas Page (`canvas-page.tsx`)

**DotGridBackground:**
- `background: "#fafafa"` → `"var(--background)"`
- `fill="#d0d0d0"` → `fill="var(--border)"` (resolves to subtle dots in both modes)

**FloatingToolbar:**
- Pill `background: "#ffffff"` → `"var(--card)"`
- Pill box-shadow → `"var(--canvas-card-shadow)"`
- Active button `background: "#eef2ff"` → `"var(--accent)"` or a dedicated `--toolbar-active-bg` token
- Active button `color: "#5B5BD6"` → `"var(--accent-foreground)"` or keep as accent color (vivid enough for both)
- Inactive button `color: "#6b7280"` → `"var(--muted-foreground)"`

### Phase 3: Chart Shape (`chart-shape.tsx`)

**CARD_STYLE constant:**
```typescript
const CARD_STYLE = {
  background: "var(--card)",
  borderRadius: 10,
  boxShadow: "var(--canvas-card-shadow)",
};
```

**Text colors (all inline styles):**
- `color: "#111"` → `"var(--card-foreground)"` (title text)
- `color: "#6b7280"` → `"var(--muted-foreground)"` (body text)
- `color: "#9ca3af"` → `"var(--muted-foreground)"` (same token as body text — one muted shade is sufficient)

**Severity badge backgrounds:**
- Use `var(--severity-critical-bg)`, `var(--severity-warning-bg)`, `var(--severity-info-bg)` (already referenced, but now they'll have dark overrides)

**Severity badge text:**
- Replace hardcoded `#991b1b` / `#92400e` / `#1e40af` with `var(--severity-critical-text)`, `var(--severity-warning-text)`, `var(--severity-info-text)`

**Status badge colors (lines 420-423):**
- `#30A46C` (success green), `#E5484D` (error red), `#6b7280` (neutral gray) — these are action status indicators
- Map to `var(--severity-info-text)` / `var(--severity-critical-text)` / `var(--muted-foreground)` respectively, or keep as-is since they're vivid enough for both modes (same rationale as TYPE_ACCENT)

**Icon stroke colors:**
- `stroke="#9ca3af"` (line 487) → `stroke="var(--muted-foreground)"`

### Phase 4: SmartStack (`smart-stack.tsx`)

- Insight card `background: "#ffffff"` → `"var(--card)"`
- Badge text colors → same severity text tokens from Phase 1

### Phase 5: Config Panel (`canvas-config-panel.tsx`)

Add `dark:` Tailwind class variants:
- `bg-red-100 text-red-700` → add `dark:bg-red-950 dark:text-red-300`
- `bg-amber-100 text-amber-700` → add `dark:bg-amber-950 dark:text-amber-300`
- `bg-blue-100 text-blue-700` → add `dark:bg-blue-950 dark:text-blue-300`
- Remove button `hover:bg-red-50` → add `dark:hover:bg-red-950`

### Phase 6: Recharts Axis Theming (`report-chart.tsx`)

Recharts passes `fill` and `stroke` props as SVG attributes, **not** CSS properties — `var()` references do not resolve. Use `useTheme()` from `next-themes` to compute hex values:

```typescript
import { useTheme } from "next-themes";

// Inside component:
const { resolvedTheme } = useTheme();
const axisColor = resolvedTheme === "dark" ? "#a1a1aa" : "#6b7280";
const gridColor = resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : undefined;

<XAxis tick={{ fontSize: 11, fill: axisColor }} />
<YAxis tick={{ fontSize: 11, fill: axisColor }} width={60} />
<CartesianGrid strokeDasharray="3 3" stroke={gridColor} className="opacity-30" />
```

> **Why not `var()`?** SVG attributes are evaluated at XML parse time. CSS custom properties only resolve in CSS property values (stylesheets), not in XML/SVG attributes. This is a browser-level limitation, not a Recharts bug.

## Acceptance Criteria

- [x] Toggling Light/Dark/System in UserPanel correctly themes all canvas surfaces
- [x] DotGridBackground adapts (dark bg, subtle dots)
- [x] FloatingToolbar pill and buttons are legible in both modes
- [x] Chart/Report/Insight cards have correct bg, text contrast, and shadows in dark mode
- [x] SmartStack insight cards and severity badges are legible
- [x] CanvasConfigPanel severity badges and Remove button adapt
- [x] Recharts axis labels and grid lines are visible on dark card backgrounds
- [x] No hydration mismatches (test with `pnpm build && pnpm start`)
- [ ] No regressions in light mode

## Dependencies & Risks

- **Recharts SVG attributes**: Confirmed — `var()` does not work in Recharts `fill`/`stroke` props. Use computed hex values via `useTheme()` (see Phase 6)
- **OKLCH in box-shadow**: CSS `box-shadow` uses `rgba()` not OKLCH — keep shadow tokens as rgba values

## Out of Scope

- `TYPE_ACCENT` colors (chart blue, report indigo) — vivid enough for both modes
- Redesigning the UserPanel theme toggle UI
- Dark mode for non-canvas pages (chat, segments, playbooks — these already work via Tailwind semantic classes)
- tldraw's internal dark mode (native UI is suppressed; selection handles and cursor styling may need a separate follow-up if they look wrong)

## References

- Existing theme setup: `src/components/theme-provider.tsx`
- UserPanel toggle: `src/components/sidebar.tsx` (lines ~849-866)
- CSS tokens: `src/app/globals.css` (`:root` and `.dark` blocks)
- Institutional learning: Never use Tailwind arbitrary values with CSS variables — use inline `style={{}}` with `var()` references
- Institutional learning: Hydration-safe localStorage pattern (useEffect, not useState initializer)
