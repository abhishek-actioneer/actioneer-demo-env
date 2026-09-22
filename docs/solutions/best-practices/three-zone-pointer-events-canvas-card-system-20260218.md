---
module: Canvas
date: 2026-02-18
problem_type: best_practice
component: frontend_stimulus
symptoms:
  - "Card toolbar only worked in tldraw edit mode (double-click), not on single click selection"
  - "Box shadow clipped by HTMLContainer overflow:hidden"
  - "Tailwind JIT scanner cannot evaluate CSS variables in arbitrary value classes"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [tldraw, pointer-events, canvas, card-design, accent-strip, selection-toolbar, css-custom-properties]
---

# tldraw Canvas Card System: Three-Zone Pointer Events & Visual Design Patterns

## Problem

The canvas visual overhaul needed to transform flat, bordered tldraw shape cards into elevated, accent-stripped cards with selection-based toolbars — while preserving tldraw's drag/pan/zoom behavior. Three interrelated issues blocked this:

1. **Toolbar discovery**: Toolbar only appeared on double-click (tldraw edit mode), making it undiscoverable for demo presenters.
2. **Shadow clipping**: `overflow: hidden` on `HTMLContainer` clipped box shadows, making cards look flat despite shadow styles.
3. **CSS variable limitations**: Tailwind's JIT scanner cannot evaluate CSS custom properties at build time — dynamic arbitrary value classes like `bg-[var(--severity-critical)]` silently fail in production builds.

## Environment
- Module: Canvas (tldraw v4.3.x shape system)
- Framework: Next.js 16, React 19, Tailwind CSS v4
- Affected Component: `chart-shape.tsx` (all card types), `smart-stack.tsx`, `report-chart.tsx`
- Date: 2026-02-18

## Symptoms
- Card toolbar only appeared after double-clicking a shape (entering tldraw edit mode)
- Cards had no depth — box shadows were invisible due to `overflow: hidden` on HTMLContainer
- SmartStack severity colors disappeared in production builds when using Tailwind arbitrary value classes with CSS variables
- Clicking toolbar buttons while shape was selected had no effect (pointer events blocked)

## What Didn't Work

**Attempted: Hover-based toolbar (considered, rejected in planning)**
- **Why it failed:** tldraw sets `pointerEvents: 'none'` on HTMLContainer when not editing. Detecting hover requires `pointerEvents: 'all'` always, which breaks tldraw's drag/marquee selection.

**Attempted: Tailwind arbitrary values for severity colors**
- **Why it failed:** `bg-[var(--severity-critical)]` works in dev mode (Tailwind scans the literal string) but Tailwind's JIT scanner cannot evaluate CSS custom properties at build time. Production CSS doesn't include the generated class.

## Solution

### 1. Three-Zone Pointer Events Model

Each card shape uses three pointer event zones:

```
HTMLContainer (pointerEvents: "none" always — tldraw default)
├── Accent Strip (3px, position: absolute, pointerEvents: "none")
└── Inner Container (overflow: hidden, borderRadius: 10)
    ├── Header Row (pointerEvents: isSelected || isEditing ? "all" : "none")
    │   ├── Title
    │   └── Toolbar (pointerEvents: "all", stopPropagation on all buttons)
    └── Content Area (pointerEvents: "none" ALWAYS — allows tldraw drag-through)
        └── ReportChart / Hero Metric / Insight Body
```

**Key code:**

```typescript
// In component() method:
const isEditing = this.editor.getEditingShapeId() === shape.id;
const isSelected = this.editor.getSelectedShapeIds().includes(shape.id);

// HTMLContainer — no overflow:hidden (allows shadow), no border
<HTMLContainer id={shape.id} style={{
  pointerEvents: "none",
  ...CARD_STYLE,  // white bg, shadow, 10px radius
  position: "relative",
  border: "none",
}}>

// Header row — interactive when selected
<div style={{
  pointerEvents: isSelected || isEditing ? "all" : "none",
}}>
  {(isSelected || isEditing) && <ShapeToolbar ... />}
</div>

// Content area — always pass-through
<div style={{ pointerEvents: "none" }}>
  <ReportChart spec={spec} variant="canvas" />
</div>
```

### 2. Accent Strip Sibling Nesting

The accent strip and inner content container are **siblings** inside HTMLContainer, not parent-child:

```typescript
<HTMLContainer style={{ ...CARD_STYLE, position: "relative", border: "none" }}>
  {/* Accent strip — sibling, not child of inner container */}
  <div style={{
    position: "absolute", left: 0, top: 0, bottom: 0,
    width: 3,
    background: TYPE_ACCENT.chart,  // "#3E63DD" for charts
    borderRadius: "10px 0 0 10px",
    pointerEvents: "none",
  }} />
  {/* Inner container — clips content, not the strip */}
  <div style={{ overflow: "hidden", borderRadius: 10 }}>
    {/* ... content ... */}
  </div>
</HTMLContainer>
```

**Why sibling nesting:** If the accent strip is a child of the `overflow: hidden` container, the strip's left rounded corners get clipped. As a sibling with `position: absolute`, it renders outside the clipping context.

### 3. Design Token Constants

```typescript
const CARD_STYLE = {
  background: "#ffffff",
  borderRadius: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
};

const TYPE_ACCENT = { chart: "#3E63DD", report: "#5B5BD6" };

const SEVERITY_ACCENT: Record<string, string> = {
  critical: "#E5484D", warning: "#F76B15", info: "#3E63DD",
};

const ACCENT_STRIP = { width: 3, borderRadius: "10px 0 0 10px" };
```

### 4. CSS Custom Properties for Severity (Not Tailwind Arbitrary Values)

```css
/* globals.css — single source of truth */
:root {
  --severity-critical: #E5484D;
  --severity-warning: #F76B15;
  --severity-info: #3E63DD;
  --severity-critical-bg: #fee2e2;
  --severity-warning-bg: #fef3c7;
  --severity-info-bg: #dbeafe;
}
```

**In SmartStack (inline styles, NOT Tailwind):**

```typescript
// ❌ WRONG — Tailwind JIT can't evaluate CSS vars at build time
<div className="bg-[var(--severity-critical-bg)]">

// ✅ CORRECT — inline style with CSS custom property
<div style={{ background: "var(--severity-critical-bg, #fee2e2)" }}>
```

### 5. Selection Indicator Override

```typescript
indicator() {
  return null;  // No blue dotted rectangle
}
```

The card toolbar appearing on selection is the primary selection affordance. Tradeoff: no visual feedback for multi-select (acceptable for demo).

### 6. ReportChart Canvas Variant

```typescript
// variant="canvas" strips wrapper, title, margin — chart fills container
<ReportChart spec={spec} variant="canvas" />

// Must handle all 3 code paths: bar/line/area, pie, and empty state
// Canvas variant uses height="100%" instead of fixed pixel heights
```

## Why This Works

1. **Three-zone model** separates interactive areas (header/toolbar) from pass-through areas (content). tldraw can still drag/pan through the chart content area while the toolbar remains clickable when selected.

2. **Selection-based visibility** (not edit-mode) means a single click shows the toolbar. This is the safest approach because `getSelectedShapeIds()` is a simple array check — no pointer event conflicts with tldraw's internal event model.

3. **Sibling nesting** prevents overflow clipping artifacts. The accent strip lives in the same container as the clipping div but isn't affected by it.

4. **Inline styles with CSS custom properties** work reliably in production because they bypass Tailwind's JIT scanner entirely. The CSS vars are defined in globals.css (always included) and referenced via `style={{}}` (always evaluated at runtime).

## Prevention

- **Always use inline `style={{}}` for severity/dynamic colors in tldraw shapes and SmartStack** — never Tailwind arbitrary values with CSS variables.
- **Never put `overflow: hidden` on HTMLContainer** — use an inner container for clipping. HTMLContainer needs to allow shadow/accent rendering outside its bounds.
- **Use `isSelected || isEditing` for toolbar visibility** — `isEditing` alone requires double-click, which is undiscoverable.
- **Content areas inside tldraw shapes should always have `pointerEvents: "none"`** — this preserves drag-through behavior. Only header/toolbar zones should be interactive.
- **Define CARD_STYLE, TYPE_ACCENT, SEVERITY_ACCENT as module-level constants** — consistent visual language across all card types.

## Related Issues

- See also: [tldraw-custom-shapes-canvas-rendering.md](../design-patterns/tldraw-custom-shapes-canvas-rendering.md) — Initial tldraw canvas setup (Phase 3 of Canvas feature). Documents module augmentation, store sync, camera persistence.
- See also: [smartstack-insight-inbox-canvas-overlay.md](../design-patterns/smartstack-insight-inbox-canvas-overlay.md) — SmartStack overlay pattern, severity config as inline CSS.
