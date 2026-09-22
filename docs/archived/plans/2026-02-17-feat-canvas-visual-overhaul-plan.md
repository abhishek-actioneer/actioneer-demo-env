---
title: "Canvas Visual Overhaul — Linear-Inspired Aesthetic"
type: feat
date: 2026-02-17
audience: investor-demo
---

# Canvas Visual Overhaul — Linear-Inspired Aesthetic

## Overview

Transform the canvas from a functional prototype into a polished, Linear-inspired analytical workspace optimized for investor demos. This is a purely visual overhaul — no architectural changes to data flow, store patterns, or tldraw shape lifecycle.

The changes span: dot grid background, hiding all tldraw chrome, a custom floating toolbar, redesigned cards (charts, reports, insights), an upgraded chart color palette, hidden selection indicators, and SmartStack alignment.

## Problem Statement / Motivation

**Audience:** Investor demos. The canvas is shown to potential investors to demonstrate the product's vision. Credibility at a glance matters more than utility. Every visual element should feel purposeful and polished.

**Current state:** The canvas has a prototype aesthetic:
- Flat white cards with thin gray borders — no depth or hierarchy
- Duplicate titles on chart shapes (header + ReportChart both render `spec.title`)
- Raw markdown preview on report cards — no metric-forward summary
- Stock Recharts colors (emerald, amber, red) — generic, not branded
- Visible tldraw developer tooling (undo/redo bar, tool switcher, minimap)
- Blue dotted selection indicator clashes with card styling
- Toolbar only appears on double-click (edit mode) — hard to discover

**After:** A cohesive, Linear-inspired workspace where cards have depth (shadow), visual taxonomy (type-based accent strips), metric-forward report displays, and a clean canvas with a subtle dot grid. No tldraw chrome visible. A minimal floating toolbar provides discoverability for select/hand/zoom.

## Proposed Solution

A single cohesive visual pass across 7 files, organized into 5 phases:

1. **Foundation** — Dot grid background, hide tldraw chrome, custom floating toolbar, CSS keyframes, CSS custom properties for severity colors
2. **Chart cards** — Remove duplicate titles, new card styling (shadow, accent strip, no border), selection-based toolbar
3. **Report cards** — Hero metric display (large number + delta badge), seeded in demo data
4. **Insight cards** — White body with severity-colored accent strip, critical pulse animation
5. **Polish** — SmartStack alignment, ReportChart canvas variant, localStorage version bump

## Technical Approach

### Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dot grid implementation | tldraw `Background` component slot | Renders inside the canvas viewport, automatically tracks camera pan/zoom. No manual camera event wiring needed. |
| Dot grid scaling | Fixed size, scales with zoom | Simple SVG pattern. Dots scale like everything else on canvas. Acceptable at demo zoom ranges (50%–200%). |
| Hide tldraw chrome | Null out `Toolbar`, `ActionsMenu`, `NavigationPanel`, `Minimap` in `tldrawComponents` | Investor-facing — all tldraw UI must be hidden. |
| Custom floating toolbar | CSS overlay portal, bottom-center, Linear-style pill | Replaces hidden tldraw toolbar. Provides select/hand/zoom affordance for demo presenters. Simple fixed-position div — doesn't need to track zoom (it's UI chrome, not canvas content). |
| Toolbar trigger on cards | Show on shape **selection** (single click) | tldraw sets `pointerEvents: 'none'` when not editing. Hover detection requires fighting tldraw's event model. Selection-based is the safest approach. |
| Pointer events model | Three-zone: outer container `"all"` when selected, chart content area `"none"` always, toolbar `"all"` | Allows toolbar clicks while preserving tldraw drag-through on chart content. See "Pointer Events Architecture" below. |
| Selection indicator | `indicator()` returns `null` | Clean look — no blue dotted rectangle. The card toolbar appearing is the primary selection affordance. Tradeoff: no visual feedback for multi-select (acceptable for demo). |
| Accent strip colors | Type-based fixed | Charts = `#3E63DD` (blue), Reports = `#5B5BD6` (indigo), Insights = severity-based. Clear visual taxonomy — you can identify card type by accent color. |
| Hero metric display | Static (no animation) | The visual redesign is enough impact for the demo. Count-up animations add complexity for marginal benefit. |
| Hero metric source | Seeded in `DEMO_ITEMS` only, no regex fallback | Demo-only for now. All report data is controlled. Regex fallback deferred until real user-pinned reports arrive. Fallback for missing fields: truncated markdown preview (current behavior). |
| Severity color system | CSS custom properties in `globals.css` | Single source of truth. Canvas shapes reference via `var(--severity-critical)` in inline styles. SmartStack references via inline `style={}` (not Tailwind arbitrary values — avoids JIT scanner issue). |
| Box shadow clipping | Remove `overflow: hidden` from HTMLContainer, use inner container for clipping | Shadows render outside element bounds. tldraw's HTMLContainer clips them if overflow is hidden. |
| Accent strip DOM nesting | Sibling to inner clipping container, not child | The accent strip `div` and the inner `overflow: hidden` container are siblings inside the outer HTMLContainer. Prevents rounded-corner clipping artifacts on the strip. |
| ReportChart context | `variant?: "default" \| "canvas"` prop | Cleaner than multiple boolean props. Canvas variant removes outer border, padding, title, margin. Must handle all three code paths: bar/line/area, pie, and empty state. |
| localStorage migration | Bump `STORAGE_VERSION` to force full re-seed | Demo data schema changes (new fields). Full wipe — nobody has layouts worth preserving. Reset `initialized` flag on version mismatch. |
| Custom CSS keyframes | Define in `globals.css` | Already the pattern for `slide-in`, `fade-in-up`, `spin`. Available inside tldraw shapes since they share the document stylesheet. |

### Pointer Events Architecture

This is the most critical implementation detail. Getting it wrong breaks either the toolbar or canvas drag.

**Current state:** `HTMLContainer` gets `pointerEvents: isEditing ? "all" : "none"`. Toolbar only works in edit mode (double-click).

**New model:** Three zones within each card shape:

```
HTMLContainer (no overflow: hidden, allows shadow)
├── Accent Strip (3px, position: absolute, left: 0, pointerEvents: "none")
└── Inner Container (overflow: hidden, borderRadius: 10)
    ├── Header Row (pointerEvents: isSelected ? "all" : "none")
    │   ├── Title
    │   └── Toolbar (pointerEvents: "all", stopPropagation on all buttons)
    └── Content Area (pointerEvents: "none" ALWAYS — allows tldraw drag-through)
        └── ReportChart / Hero Metric / Insight Body
```

**Key rule:** The `HTMLContainer` itself gets `pointerEvents: "none"` always (tldraw default). The header row overrides to `"all"` only when selected. The content area stays `"none"` so tldraw can drag/select through it. Toolbar buttons use `stopPropagation` to prevent clicks from reaching tldraw.

### Design Tokens

**New chart color palette (Linear-inspired):**
```typescript
const COLORS = [
  "#5B5BD6", // Indigo
  "#3E63DD", // Blue
  "#12A594", // Teal
  "#30A46C", // Green
  "#E5484D", // Red
  "#E54666", // Pink
  "#F76B15", // Orange
  "#FFC53D", // Yellow
];
```

**Type-based accent colors:**
```typescript
const TYPE_ACCENT = {
  chart: "#3E63DD",    // Blue
  report: "#5B5BD6",   // Indigo
  insight: "dynamic",  // Uses SEVERITY_ACCENT based on severity
};

const SEVERITY_ACCENT = {
  critical: "#E5484D",
  warning: "#F76B15",
  info: "#3E63DD",
};
```

**Card styling constants (inline styles for tldraw shapes):**
```typescript
const CARD_STYLE = {
  background: "#ffffff",
  borderRadius: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
};

const ACCENT_STRIP = {
  width: 3,
  borderRadius: "10px 0 0 10px",
};
```

**Dot grid:**
```typescript
// tldraw Background component
// SVG pattern: 1.2px circles, #d0d0d0, 20px spacing, #fafafa base
// Fixed size — scales with camera zoom (no adaptive sizing)
```

**CSS custom properties (globals.css):**
```css
:root {
  --severity-critical: #E5484D;
  --severity-warning: #F76B15;
  --severity-info: #3E63DD;
  --severity-critical-bg: #fee2e2;
  --severity-warning-bg: #fef3c7;
  --severity-info-bg: #dbeafe;
}
```

**Delta badge sign detection:**
- `string.startsWith("+")` or `string.startsWith("↑")` → green (`#30A46C` bg, white text)
- `string.startsWith("-")` or `string.startsWith("↓")` → red (`#E5484D` bg, white text)
- Otherwise → gray/neutral (`#6b7280` bg, white text)

### File Structure

No new files. All changes are modifications to existing files.

### Modified Files

| File | Changes |
|------|---------|
| `src/app/globals.css` | Add `@keyframes accent-pulse`, add CSS custom properties for severity colors |
| `src/components/canvas/canvas-page.tsx` | Add `Background` to `tldrawComponents`, null out `Toolbar`/`NavigationPanel`/`Minimap`/`ActionsMenu`, add custom floating toolbar overlay |
| `src/components/canvas/chart-shape.tsx` | Full card redesign for all 3 types: shadow, accent strip (sibling nesting), selection-based toolbar, pointer events three-zone model, hero metric display for reports, pulse for critical insights, `indicator()` returns `null` |
| `src/components/chart/report-chart.tsx` | New color palette, `variant` prop (handle all 3 code paths: bar/line/area, pie, empty), canvas variant removes border/padding/title/margin |
| `src/lib/canvas-store.ts` | Add `heroMetric`/`heroDelta` to demo report items, add `STORAGE_VERSION` with initialized flag reset on mismatch |
| `src/lib/canvas-types.ts` | Add optional `heroMetric?: string` and `heroDelta?: string` fields to `CanvasItem` |
| `src/components/canvas/smart-stack.tsx` | Align card styling: white body, left accent strip via inline `style={}` (not Tailwind arbitrary values), soft shadow, match canvas card system |

## Implementation Phases

### Phase 1: Foundation — Background, Chrome, Floating Toolbar, Keyframes

**Goal:** Set the canvas atmosphere, remove tldraw developer UI, and provide a minimal custom toolbar for discoverability.

**Tasks:**

- [x] Add `@keyframes accent-pulse` to `globals.css`:
  ```css
  @keyframes accent-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  ```
- [x] Add CSS custom properties for severity colors to `globals.css` `:root` block:
  ```css
  --severity-critical: #E5484D;
  --severity-warning: #F76B15;
  --severity-info: #3E63DD;
  --severity-critical-bg: #fee2e2;
  --severity-warning-bg: #fef3c7;
  --severity-info-bg: #dbeafe;
  ```
- [x] In `canvas-page.tsx`, add a `Background` component to `tldrawComponents` that renders an SVG dot grid pattern:
  - Use `useEditor()` hook to get camera state
  - Render `<svg>` with a `<pattern>` element: 1.2px radius circles, `#d0d0d0` fill, 20px spacing
  - Apply pattern as `<rect>` fill covering the full viewport
  - Base background color: `#fafafa`
  - Fixed size — dots scale naturally with zoom
- [x] Null out remaining tldraw chrome in `tldrawComponents`:
  ```typescript
  Toolbar: null,
  ActionsMenu: null,
  NavigationPanel: null,
  Minimap: null,
  ```
- [x] Add custom floating toolbar overlay in `canvas-page.tsx`:
  - Bottom-center of the canvas container, CSS `position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%)`
  - Linear-style pill: white bg, soft shadow, rounded-full, 3 icon buttons (select/hand/zoom)
  - `z-[60]` to render above SmartStack (`z-50`)
  - Active tool gets a subtle highlight (e.g., light indigo background)
  - Clicking a tool calls `editor.setCurrentTool("select" | "hand" | "zoom")`
  - This is a React component rendered as a child of `<Tldraw>` (needs useEditor context) — uses absolute CSS positioning as overlay
- [x] Verify keyboard shortcuts still work after hiding toolbar (V for select, H for hand, Z for zoom, Ctrl+Z for undo) — keyboard shortcuts are tldraw core, not toolbar-dependent

**Acceptance Criteria:**

- [ ] Canvas shows faint dot grid that moves with pan and scales with zoom
- [ ] No tldraw UI elements visible (no toolbar, no minimap, no action bar)
- [ ] Custom floating toolbar pill visible at bottom-center with select/hand/zoom
- [ ] Clicking toolbar icons switches the active tldraw tool
- [ ] Active tool is visually highlighted in the pill
- [ ] Keyboard shortcuts (V, H, Z, Ctrl+Z) still functional
- [ ] Floating toolbar renders above SmartStack overlay

---

### Phase 2: Chart Card Redesign

**Goal:** Transform chart cards from bordered boxes to elevated, accent-stripped cards with selection-based toolbar.

**Tasks:**

- [x] Update `COLORS` array in `report-chart.tsx` to the new Linear-inspired palette (8 colors)
- [x] Add `variant?: "default" | "canvas"` prop to `ReportChart`:
  - `"default"` (or undefined): Current behavior (border, padding, title, margin)
  - `"canvas"`: No outer `div` wrapper — render chart directly with no border, no padding, no title, no `my-4`
  - **Must handle all 3 code paths:** bar/line/area (line 187), pie (line 99), and empty state (line 70)
- [x] In `chart-shape.tsx`, implement three-zone pointer events model for chart type:
  - `HTMLContainer`: no `overflow: hidden`, no border, apply `CARD_STYLE` (white bg, shadow, 10px radius)
  - Accent strip: 3px wide `div`, `position: absolute`, `left: 0`, `top: 0`, full height, `background: "#3E63DD"` (blue for charts), `borderRadius: "10px 0 0 10px"`, `pointerEvents: "none"` — rendered as sibling to inner container
  - Inner container: `overflow: hidden`, `borderRadius: 10`, clips chart content
  - Header row: `pointerEvents: isSelected || isEditing ? "all" : "none"` — contains title (13px/600) and toolbar
  - Content area: `pointerEvents: "none"` always — contains `<ReportChart variant="canvas" />`
- [x] Change toolbar visibility condition from `isEditing` to `isSelected || isEditing`:
  - `const isSelected = this.editor.getSelectedShapeIds().includes(shape.id)`
  - `const isEditing = this.editor.getEditingShapeId() === shape.id`
  - Toolbar renders when `isSelected || isEditing`
- [x] Override `indicator()` to return `null` — no blue selection rectangle

**Acceptance Criteria:**

- [ ] Chart cards have no visible border, soft shadow, white background
- [ ] 3px blue accent strip on left edge, corners match card radius
- [ ] No duplicate title (chart header shows title, ReportChart does not)
- [ ] Toolbar appears on single click (selection), not just edit mode
- [ ] Toolbar buttons are clickable when shape is selected (pointer events work)
- [ ] Canvas drag-through works on chart content area (tldraw pan/select not blocked)
- [ ] Charts render correctly when resized
- [ ] New color palette visible in both bar and line chart demos
- [ ] No blue selection indicator on any shape

---

### Phase 3: Report Card Redesign — Hero Metrics

**Goal:** Transform report cards from raw markdown previews into metric-forward summary cards.

**Tasks:**

- [x] Add `heroMetric?: string` and `heroDelta?: string` fields to `CanvasItem` type in `canvas-types.ts`
- [x] Update `DEMO_ITEMS` in `canvas-store.ts`:
  - Weekly Revenue Report: `heroMetric: "$119,600"`, `heroDelta: "+8.2% WoW"`
  - User Engagement Summary: `heroMetric: "24,500"`, `heroDelta: "+12% DAU"`
- [x] Add `STORAGE_VERSION = 2` constant and version check in `ensureInitialized()`:
  - **Placement:** Version check runs at the TOP of `ensureInitialized()`, BEFORE the `if (initialized) return` guard
  - Check: `localStorage.getItem(STORAGE_KEY + "-version")` — if absent or doesn't match `STORAGE_VERSION`:
    1. Clear: `localStorage.removeItem(STORAGE_KEY)` and `localStorage.removeItem(STORAGE_KEY + "-version")`
    2. Reset: `canvasMap.clear()` and `initialized = false`
    3. Set new version: `localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION))`
    4. Fall through to normal initialization (which will seed DEMO_ITEMS)
  - This ensures returning demo machines always get fresh data with hero metrics
- [x] In `chart-shape.tsx`, report type rendering — new layout with three-zone pointer events:
  - Same card base as charts: `CARD_STYLE` (white, shadow, 10px radius, no border)
  - Left accent strip: `#5B5BD6` (indigo) — sibling to inner container
  - Header row: small document icon (inline SVG, not emoji) + title (13px, semibold, truncated) + toolbar
  - Center: hero metric large (28px, bold, `fontVariantNumeric: "tabular-nums"`)
  - Below metric: delta badge — sign detection per "Design Tokens" section
  - Bottom: 1-line summary (first non-empty, non-header line from markdown, 11px, `color: "#9ca3af"`) + pinned date
  - If `heroMetric` is undefined: fall back to truncated markdown preview (current behavior) — no regex extraction
- [x] Remove the existing `onDoubleClick` handler on report cards (line 312 of chart-shape.tsx) — config panel is now accessible via the toolbar Settings button on single-click selection. Double-click will enter tldraw edit mode (harmless, no visible change in new design).

**Acceptance Criteria:**

- [ ] Demo report cards show large hero metric + colored delta badge
- [ ] Reports without `heroMetric` field fall back to markdown preview gracefully
- [ ] localStorage is fully re-seeded on version mismatch (wipes all items, seeds fresh demo)
- [ ] Version check resets `initialized` flag correctly (no stale in-memory data within same tab)
- [ ] Report cards match chart cards in visual weight (shadow, radius, accent strip)
- [ ] Delta badge is green for positive, red for negative, gray for ambiguous

---

### Phase 4: Insight Card Redesign

**Goal:** Align insight cards with the new card system — white body, severity accent strip, critical pulse.

**Tasks:**

- [x] In `chart-shape.tsx`, insight type rendering — redesign with three-zone pointer events:
  - Same card base: `CARD_STYLE` (white background, shadow, 10px radius, no border)
  - Left accent strip: 3px wide, colored by severity using `SEVERITY_ACCENT` constants — sibling nesting
  - Critical cards: accent strip gets `animation: "accent-pulse 2s ease-in-out infinite"`
  - Remove full-background severity coloring — card body is always white
  - Body: severity badge (smaller), title, insight text, date
  - Severity badge colors reference CSS custom properties: `var(--severity-critical)`, etc.
- [x] Toolbar visibility: same `isSelected || isEditing` pattern as charts
- [x] Update severity color constants to use `SEVERITY_ACCENT` object:
  ```typescript
  const SEVERITY_ACCENT = {
    critical: "#E5484D",
    warning: "#F76B15",
    info: "#3E63DD",
  };
  ```

**Acceptance Criteria:**

- [ ] Insight cards on canvas have white body with colored left accent strip
- [ ] Critical insights have a subtle pulse animation on the accent strip
- [ ] Visual weight matches chart and report cards (same shadow, radius, accent strip width)
- [ ] Severity badge still visible and readable
- [ ] Toolbar works on single-click selection (same as charts/reports)

---

### Phase 5: SmartStack Alignment & Polish

**Goal:** Align SmartStack overlay cards with the new visual system.

**Tasks:**

- [x] In `smart-stack.tsx`, update `SEVERITY_CONFIG` to use inline style objects instead of Tailwind class strings:
  - Replace `bg: "bg-red-50"` with `bg: "var(--severity-critical-bg)"` (used in `style={{ backgroundColor: ... }}`)
  - Replace `border: "border-red-200"` with inline `borderLeft: "3px solid var(--severity-critical)"`
  - **Do NOT use Tailwind arbitrary values like `bg-[var(--severity-critical)]`** — Tailwind's JIT scanner cannot evaluate CSS variables at build time, so dynamic arbitrary value classes will not emit CSS in production builds
  - Switch the card `className` from `${sev.bg} ${sev.border}` to `style={{ ... }}` for severity-dependent properties
  - Keep non-severity Tailwind classes (layout, spacing, typography)
- [x] Update SmartStack card styling:
  - White background instead of severity-colored background
  - Left border in severity color (3px, via inline `borderLeft` style)
  - Add `boxShadow: "0 1px 2px rgba(0,0,0,0.05)"` for soft shadow
  - Keep severity badge, title, text, actions
  - Update badge colors to match new palette
- [x] Update SmartStack header/container styling:
  - Subtle shadow instead of border-based containment
  - Match the refined aesthetic
- [x] Final visual QA pass:
  - Verify chart, report, and insight cards all have consistent shadow/radius/accent treatment
  - Verify dot grid renders correctly at 50%, 100%, 200% zoom
  - Verify no visual regressions in the config panel
  - Verify SmartStack pin action creates shapes with new styling
  - Verify floating toolbar active state syncs with keyboard shortcuts (pressing V highlights select icon)
  - Verify custom floating toolbar z-order above SmartStack

**Acceptance Criteria:**

- [ ] SmartStack insight cards match canvas insight card styling (white body, accent strip, shadow)
- [ ] All card types (chart, report, insight) share consistent visual language
- [ ] No visual regressions in config panel or pin flow
- [ ] Canvas looks cohesive at all zoom levels
- [ ] Floating toolbar and SmartStack don't overlap or conflict visually

## Alternative Approaches Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| CSS background for dot grid | Simple CSS, no React code | Doesn't track camera pan/zoom | Rejected — tldraw Background component is the right pattern |
| Hover-based toolbar | More discoverable | Fights tldraw's pointer event model, requires `pointerEvents: 'all'` always which breaks drag | Rejected — selection-based is safer |
| Shape-at-point hover detection | True hover via tldraw API (`getShapeAtPoint` in pointermove listener) | Significant code, cursor constantly querying tldraw's spatial index | Rejected — over-engineered for demo |
| framer-motion for animations | Richer animation API | New dependency, CSS-only is the codebase convention, tldraw shapes use inline styles | Rejected — CSS keyframes in globals.css |
| Separate shape types per card | Cleaner separation of concerns | Major refactor, breaks existing store pattern, single shape type is simpler | Rejected — keep branching in `component()` |
| ECharts migration bundled with visual overhaul | Better charts | Scope creep, separate concern | Deferred — visual polish first, chart library later |
| Tailwind arbitrary values for SmartStack severity | Single source of truth via CSS vars | Tailwind JIT scanner cannot evaluate CSS variables — dynamic classes won't emit CSS in production | Rejected — use inline styles instead |
| tldraw Toolbar component override for floating toolbar | More integrated with tldraw | Couples to tldraw's internal layout, more complex | Rejected — CSS overlay is simpler and correct (toolbar is UI chrome, not canvas content) |
| Count-up animation on hero metrics | Strong "wow" moment for demos | Adds complexity, CSS-only convention in codebase | Deferred — ship static first |
| Zoom-adaptive dot sizing | Dots maintain constant screen-space size | Requires camera subscription and math, more code | Rejected — fixed size is simpler, acceptable for demo zoom ranges |
| Dynamic accent colors (first series color) | Accent visually matches chart data | Harder to identify card type at a glance, inconsistent when series change | Rejected — type-based fixed colors provide clearer visual taxonomy |
| Always-visible card toolbar | Most discoverable | 30+ interactive buttons rendered simultaneously, pointer event conflicts with tldraw's marquee selection | Rejected — selection-based is safer |

## Acceptance Criteria

### Functional Requirements

- [ ] Canvas loads with dot grid background that tracks pan/zoom
- [ ] No tldraw toolbars, menus, or navigation panels visible
- [ ] Custom floating toolbar pill at bottom-center with select/hand/zoom
- [ ] Chart cards: shadow, blue accent strip, no border, no duplicate title, selection toolbar
- [ ] Report cards: hero metric (28px bold), delta badge (green/red/gray pill), 1-line summary
- [ ] Insight cards: white body, severity accent strip, critical pulse animation
- [ ] SmartStack cards match canvas card styling (white body, accent strip, shadow)
- [ ] All keyboard shortcuts still work (V, H, Z, Ctrl+Z, Delete)
- [ ] Pinning from SmartStack creates correctly styled shapes
- [ ] Config panel opens correctly for all card types (via toolbar Settings button)
- [ ] Resize works correctly for all card types
- [ ] No blue selection indicator visible on any shape

### Non-Functional Requirements

- [ ] No new dependencies added
- [ ] All animations are CSS-only (keyframes in globals.css, referenced via inline styles)
- [ ] No performance regression on canvas with 10+ shapes
- [ ] Dark mode: not in scope (current inline styles use CSS var fallbacks; no regression)

### Quality Gates

- [ ] Visual comparison: before/after screenshots of all 3 card types
- [ ] Zoom levels tested: 50%, 100%, 200%
- [ ] localStorage cleared and re-tested (fresh demo data with hero metrics)
- [ ] Existing localStorage tested (version migration triggers full re-seed)
- [ ] Toolbar pointer events tested: buttons clickable when selected, drag-through works on content area
- [ ] Floating toolbar syncs with keyboard shortcut tool changes

## Dependencies & Prerequisites

| Dependency | Status | Notes |
|------------|--------|-------|
| tldraw v4.3.x `Background` component slot | Available | Part of `TLComponents` interface |
| tldraw `getSelectedShapeIds()` API | Available | Used for selection-based toolbar |
| tldraw `setCurrentTool()` API | Available | Used by floating toolbar |
| CSS `@keyframes` in globals.css | Pattern established | `slide-in`, `fade-in-up`, `spin` already defined |
| `CanvasItem` type in canvas-types.ts | Exists | Adding 2 optional fields |

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Box shadow clipped by HTMLContainer overflow | High | Cards look borderless with no depth | Remove `overflow: hidden` from HTMLContainer, add inner clipping container. Accent strip as sibling. |
| Pointer events block toolbar clicks | High | Toolbar appears but buttons don't work — demo killer | Three-zone model: header row interactive when selected, content area always pass-through, toolbar buttons stopPropagation. |
| Multi-select has no visual feedback (indicator hidden) | Medium | Investor tries to select multiple cards, no affordance | Acceptable for demo — presenter controls the interaction. Document keyboard shortcut (Shift+click). |
| Double-click enters tldraw edit mode unexpectedly | Medium | Blue cursor / text selection behavior on report cards | Remove onDoubleClick handler from report cards. Keep `canEdit() => true` (required for tldraw). Edit mode has no visible effect in new design since toolbar already shows on selection. |
| Tailwind JIT scanner misses dynamic CSS var classes | High | SmartStack severity colors don't render in production | Use inline `style={}` for severity-dependent properties in SmartStack, not Tailwind arbitrary values. |
| localStorage version bump loses user-arranged layouts | Medium | Returning demo machine gets reset canvas | Acceptable — demo-only, no real user data. Document: clear localStorage on demo machine before demos. |
| Dot grid becomes dense at low zoom / sparse at high zoom | Low | Visual oddity at extreme zoom levels | Fixed-size approach — acceptable for demo zoom range (50%–200%). Dots are subtle enough that density changes aren't jarring. |
| Floating toolbar z-order under SmartStack | Low | Toolbar obscured | Set `z-[60]`, SmartStack is `z-50`. |
| Floating toolbar conflicts with card near bottom of viewport | Low | Card toolbar and floating toolbar visually overlap | Floating toolbar has higher z-index, card toolbar is small (24px icons). Unlikely overlap at demo positions. |
| Version check doesn't reset `initialized` flag | High | Stale in-memory data persists after version migration within same tab | Version check placed before `if (initialized) return` guard. On mismatch: clear map, set `initialized = false`, clear localStorage, fall through to re-seed. |

## Future Considerations

- **Dark mode**: Card styles use hardcoded hex values (tldraw constraint). Future dark mode would need a theme-aware constant map. CSS custom properties for severity colors are a step toward this.
- **Hero metric regex fallback**: When real user-pinned reports arrive, add extraction logic: first `**...**` containing a digit → heroMetric, first parenthetical percentage → heroDelta. Handle edge cases: `**Period:** Feb 10-16` (contains digit but not a metric), `↑` vs `+` signs.
- **ECharts migration**: The `variant="canvas"` prop on ReportChart will carry over to an ECharts-based chart component.
- **Card type registry**: If more card types are added, extract the branching in `chart-shape.tsx` `component()` into a `SHAPE_RENDERERS` map.
- **Connection lines**: tldraw supports arrow shapes. Future feature: draw relationships between cards.
- **Snap-to-grid**: tldraw has built-in grid snapping. Can be enabled later without visual changes.
- **Typed canvas event bridge**: Current event names are plain strings (easy to typo silently). Convert to a typed enum for compile-time safety.
- **Custom selection indicator**: If multi-select feedback becomes important, re-implement `indicator()` with a subtle brand-colored stroke (#5B5BD6) instead of tldraw's default blue dotted rectangle.

## References & Research

### Internal References

- Canvas page (tldraw wrapper): `src/components/canvas/canvas-page.tsx:83-103` (tldraw config), `:393-399` (Tldraw render)
- Chart shape (all card rendering): `src/components/canvas/chart-shape.tsx:176-451` (ShapeUtil), `:197-438` (component method)
- Chart shape pointer events: `src/components/canvas/chart-shape.tsx:214` (insight), `:303` (report), `:374` (chart) — currently `isEditing` gated
- Chart shape toolbar: `src/components/canvas/chart-shape.tsx:32-131` (ShapeToolbar + ToolbarBtn)
- ReportChart: `src/components/chart/report-chart.tsx:22-31` (COLORS array), `:67-208` (component), `:99` (pie wrapper), `:187` (bar/line/area wrapper), `:70` (empty state)
- Canvas store (demo data): `src/lib/canvas-store.ts:11-130` (DEMO_ITEMS), `:134-154` (ensureInitialized), `:7` (STORAGE_KEY)
- Canvas types: `src/lib/canvas-types.ts:1-41`
- SmartStack: `src/components/canvas/smart-stack.tsx:16-38` (SEVERITY_CONFIG), `:146` (card className)
- Global CSS (theme + animations): `src/app/globals.css:14-55` (theme vars), `:57-90` (:root), `:135-170` (keyframes)
- Existing canvas plan: `docs/plans/2026-02-17-feat-canvas-generative-ui-plan.md`

### Institutional Learnings

- tldraw custom shapes pattern: `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md` — stable config outside components, `source: "user"` in store.listen, camera restore with `{ immediate: true }`
- SmartStack overlay pattern: `docs/solutions/design-patterns/smartstack-insight-inbox-canvas-overlay.md` — severity config as inline CSS (not Tailwind) for tldraw shapes, version counter reactivity, event bridge naming
- Version counter reactivity: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md` — `useState(0)` bumped to trigger re-renders

### External References

- tldraw v4 custom shapes: https://tldraw.dev/docs/shapes
- tldraw TLComponents interface: https://tldraw.dev/reference/editor/TLComponents
