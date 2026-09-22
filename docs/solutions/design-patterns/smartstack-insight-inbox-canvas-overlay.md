---
title: "SmartStack Insight Inbox & Canvas Overlay Pattern"
date: 2026-02-17
category: design-patterns
tags:
  - canvas
  - tldraw
  - smartstack
  - insights
  - event-bridge
  - overlay-ui
  - generative-ui
component:
  - src/components/canvas/smart-stack.tsx
  - src/components/canvas/canvas-page.tsx
  - src/components/canvas/chart-shape.tsx
  - src/components/canvas/canvas-config-panel.tsx
  - src/lib/canvas-store.ts
severity: low
status: resolved
problem_statement: |
  Implement Phase 6 (SmartStack Insight Inbox) and Phase 7 (Scheduled Reports enhancements)
  of the Canvas Generative UI feature. SmartStack surfaces proactive AI insights as a
  collapsible overlay on the tldraw canvas. Reports need double-click-to-view-markdown support.
key_files:
  - src/components/canvas/smart-stack.tsx
  - src/components/canvas/canvas-page.tsx
  - src/components/canvas/chart-shape.tsx
  - src/components/canvas/canvas-config-panel.tsx
  - src/lib/canvas-store.ts
  - src/components/canvas/canvas-events.ts
---

# SmartStack Insight Inbox & Canvas Overlay Pattern

## Overview

Phase 6 adds a SmartStack widget that overlays the tldraw canvas to show proactive AI-generated insights. Phase 7 extends report shapes with double-click-to-view-markdown in the config panel. Both phases maintain the existing event bridge and store patterns.

## Phase 6: SmartStack Implementation

### Architecture

SmartStack is a **fixed-position React component** overlaying tldraw (not a tldraw shape). This avoids the complexity of managing a non-chart tldraw shape while still appearing on the canvas surface.

```
Canvas Page Layout:
  <div className="flex-1 relative">
    <Tldraw ... />              ← infinite canvas (full area)
    <SmartStack ... />          ← absolute top-4 right-4 z-50 (overlay)
  </div>
  {configItemId && <CanvasConfigPanel />}  ← slide-out right panel
```

### Severity Config Pattern

A static `SEVERITY_CONFIG` object maps severity levels to Tailwind classes:

```typescript
const SEVERITY_CONFIG = {
  critical: { bg: "bg-red-50", border: "border-red-200", badge: "bg-red-100 text-red-700", dot: "bg-red-500" },
  warning:  { bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  info:     { bg: "bg-blue-50", border: "border-blue-200", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
};
```

The same color scheme is used in both SmartStack cards and pinned insight shapes (via inline styles in chart-shape.tsx since tldraw shapes can't use Tailwind).

### Insight Lifecycle

```
Store (DEMO_ITEMS)
  → getInsights() filters: type === "insight" && !dismissed
  → SmartStack reads on mount + version change

User actions:
  Dismiss → saveCanvasItem({ ...item, dismissed: true }) → removed from SmartStack
  Pin     → saveCanvasItem() with position → editor.createShape() → removed from SmartStack
  Ask     → saveConversation() + router.push("/?conv=<id>")
```

Insights start with `position: { x: 0, y: 0 }` in the store. They are filtered out of initial tldraw shape creation:

```typescript
const items = getAllCanvasItems().filter(
  (item) => !(item.type === "insight" && !item.dismissed)
);
```

When pinned, `findOpenSlot()` calculates the grid position and the insight gets a real canvas position.

### Version Counter for Reactivity

SmartStack re-reads from the store when `version` prop changes. The parent (`canvas-page.tsx`) manages `smartStackVersion` state and bumps it on pin/dismiss events:

```typescript
const [smartStackVersion, setSmartStackVersion] = useState(0);

// On pin:
setSmartStackVersion((v) => v + 1);

// On dismiss event:
const offDismiss = onCanvasEvent("dismiss-insight", () =>
  setSmartStackVersion((v) => v + 1)
);
```

### Event Bridge Events Added

- `dismiss-insight` — emitted by SmartStack when user dismisses an insight
- `pin-insight` and `ask-about-insight` are handled via callback props (not events) since SmartStack is a React component with direct access to parent handlers

## Phase 7: Report Markdown in Config Panel

### Double-Click Handler

Report shapes emit `open-config` on double-click when in edit mode:

```typescript
<div
  onDoubleClick={(e) => {
    e.stopPropagation();
    emitCanvasEvent("open-config", shape.props.canvasItemId);
  }}
>
```

### Config Panel Branching

The config panel now renders different content based on `item.type`:

- **report** — Shows full `reportMarkdown` in a scrollable container
- **insight** — Shows severity badge + insight text
- **chart** — Shows chart type selector, SQL preview, data table (existing)

Header label is dynamic: `"Report"` / `"Insight"` / `"Chart Settings"`.

## Insight Shape Rendering

The `component()` method in `CanvasChartShapeUtil` now has 3 branches (insight/report/chart). Insight shapes render as severity-colored cards with badge, title, text, and date — visually distinct from white chart/report cards.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SmartStack as overlay | `position: absolute`, not tldraw shape | Simpler lifecycle, uses React/Tailwind directly |
| Insights filtered from initial shapes | `.filter()` before `createShapes()` | Insights live in SmartStack until pinned |
| Version counter for SmartStack | `useState(0)` bumped on mutations | Lightweight reactivity without external state lib |
| Config panel branching by type | Conditional rendering in one component | Avoids 3 separate panel components for small differences |

## Prevention Strategies

### 1. localStorage Cache Invalidation

Demo data seeding won't apply when localStorage exists from a previous session. When adding new demo items, users must clear `localStorage.removeItem("baby-sentinel-canvas-items")`. Consider adding a `STORAGE_VERSION` key to auto-invalidate on schema changes.

### 2. Event Bridge Type Safety

Event names are plain strings — easy to typo silently. Future improvement: convert to a typed enum (`CANVAS_EVENTS.OPEN_CONFIG`) for compile-time safety.

### 3. Shape Type Branching

The `component()` method now has 3 branches. If more types are added, consider extracting to a registry pattern (`SHAPE_RENDERERS` map keyed by `CanvasItem["type"]`).

## Related Documentation

- [Canvas + Generative UI Plan](../../plans/2026-02-17-feat-canvas-generative-ui-plan.md) — Full 7-phase plan
- [Canvas + Generative UI Brainstorm](../../brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md) — Vision and constraints
- [tldraw Custom Shapes & Canvas Rendering](./tldraw-custom-shapes-canvas-rendering.md) — Phase 3 patterns
- [3-Tier Sidebar Pattern](./split-panel-to-sidebar-three-tier-consolidation.md) — Navigation model
- [Sidebar State Context](./lift-sidebar-state-to-layout-context.md) — `canvasVersion` counter pattern
