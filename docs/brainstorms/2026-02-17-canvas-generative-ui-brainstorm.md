# Canvas + Generative UI Brainstorm

**Date:** 2026-02-17
**Status:** Draft
**Scope:** Full vision, frontend-only (mock backend where needed)

---

## What We're Building

A **living intelligence surface** for Sentinel that transforms the product from "chat with your data" into a persistent, freeform canvas where insights compound over time.

### Core Concept

The canvas is a new top-level surface (accessible via sidebar) where users:

1. **Pin live charts from chat** — each chart in a chat response gets a "Pin to Canvas" button. Pinned charts store their underlying SQL and re-execute on a schedule (live, not snapshot).
2. **See AI-initiated insights** — the system proactively surfaces new findings ("revenue dropped 15% yesterday") alongside user-pinned content.
3. **Interact with charts as mini-apps** — click to expand, change chart type, adjust date range, modify filters.
4. **Drill back into chat** — any chart on the canvas is a conversation starter. Click to open a new thread pre-loaded with that chart's context.
5. **View scheduled agent reports** — reports from recurring analysis runs appear on the canvas automatically.

The canvas and chat are deeply connected but separate UIs. Chat generates artifacts; the canvas persists them.

### Insight Inbox (SmartStack)

A dedicated widget on the canvas — inspired by Apple's SmartStack — where AI agents proactively drop insights. It works as a stacked card queue:

- **Stacked cards**: New insights stack on top (like iOS widget SmartStack). User swipes/scrolls through them.
- **Agent-generated**: Analysis agents run on schedule and push findings here — "Revenue dropped 15% in APAC yesterday", "Retention cohort 3 is churning faster than baseline."
- **Actionable**: Each card has quick actions: "Pin to canvas" (promotes it to a full chart shape), "Ask more" (opens a chat thread with context), or "Dismiss."
- **Ephemeral by default**: Unpinned insights rotate out after a configurable period (e.g., 7 days). Pinned insights become permanent canvas items.
- **Single fixed position**: The inbox lives in a consistent spot on the canvas (e.g., top-right corner or a collapsible panel edge). It doesn't float freely like pinned charts.

### Inspiration

- **Databricks Genie**: Chat companion to every dashboard. Genie generates charts, user pins them. Bidirectional context between chat and dashboard.
- **Observable Canvases**: Freeform infinite whiteboard (tldraw-based) where AI places output in labeled frames. Canvas is the analyst workspace.
- **Metabase Metabot**: Chat generates charts, "Save" button pins them to a dashboard as standard cards.

---

## Why This Approach

### The Structured Block Protocol

Current state: Chat responses are flat markdown strings with embedded ` ```chart``` ` JSON blocks parsed by a custom line-by-line renderer. Charts are ephemeral — they live only in conversation history.

New state: Responses become a mix of **typed blocks** streamed over the existing NDJSON protocol. Each block has a stable ID and is independently addressable (renderable, interactive, pinnable).

**Why blocks over raw markdown:**
- Each block is a discrete, pinnable artifact with metadata (SQL query, chart config, creation time)
- Blocks enable richer rendering: metric cards, interactive tables, insight callouts — not just text and charts
- Block IDs allow the canvas to reference and refresh specific artifacts
- Aligns with emerging industry protocols (Google A2UI, CopilotKit AG-UI) for future compatibility

### tldraw for the Canvas

Choosing tldraw over a grid system (react-grid-layout) or custom primitives because:
- **Freeform placement** matches the vision of a curated-but-flexible workspace
- **Built-in capabilities for free**: pan, zoom, minimap, selection, multi-select, undo/redo, grid snapping, freehand annotations, sticky notes
- **Custom shapes**: charts render as tldraw shapes with full React component embedding
- **Future upside**: connectors between charts, multiplayer editing (CRDT built-in), annotations — this is what makes Observable Canvases feel magical
- Observable already validates this choice in production

### ECharts over Recharts (Recommended for Implementation)

Research strongly recommends migrating from Recharts to Apache ECharts (`echarts-for-react`):
- Canvas/WebGL rendering (vs SVG) — handles larger datasets
- JSON-native option API — Gemini can generate ECharts option objects directly, eliminating the prop-mapping layer
- Far more chart types: scatter, heatmap, treemap, geo, candlestick, gauge, graph
- Built-in interactivity: zoom, brush selection, drill-down

**Note:** The block protocol is chart-library-agnostic. We can start with existing Recharts and migrate to ECharts, or switch directly.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Canvas model | Databricks-style (canvas IS the dashboard, chat is separate) | Single surface for pinned charts + proactive insights. Chat stays as existing UI |
| Canvas location | New sidebar item | Non-destructive to existing UX. Canvas is a feature, not a replacement |
| Canvas library | tldraw | Freeform infinite canvas with rich built-in capabilities. Observable validates this in production |
| Pin interaction | Pin button on chart + toast notification with link | Lowest friction. No split-screen complexity for POC |
| Chart liveness | Live / refreshable | Pinned charts store SQL + config, re-execute on schedule or on-demand |
| Agent reports | User-scheduled + AI-initiated via Inbox (SmartStack) | Proactive insights land in a stacked card queue. User promotes to canvas or dismisses |
| Chart interaction | Configure inline + drill to chat | Charts are both mini-apps and conversation starters |
| Response rendering | Structured block protocol over existing NDJSON | Each block is typed, addressable, and pinnable. Progressive migration from markdown |
| Initial block types | Charts + scheduled agent reports | Start here, expand to metric cards and data tables as needed |
| Charting library | ECharts (recommended) or Recharts (acceptable for POC) | ECharts is JSON-native, better performance, more chart types |

---

## Architecture

### Block Protocol

```typescript
// New NDJSON event types (extend existing protocol)
type BlockEvent =
  | { type: "block"; blockType: "chart"; id: string; payload: ChartBlockPayload }
  | { type: "block"; blockType: "scheduled_report"; id: string; payload: ReportPayload }

// Each block carries pinning metadata
interface ChartBlockPayload {
  chartSpec: ChartSpec;        // existing chart spec (or ECharts option)
  sql: string;                 // the query that generated this data
  title: string;
  pinnable: boolean;
}
```

### Canvas Data Model

```typescript
interface CanvasItem {
  id: string;
  blockType: "chart" | "scheduled_report";
  payload: ChartBlockPayload | ReportPayload;
  position: { x: number; y: number };  // tldraw coordinates
  size: { width: number; height: number };
  pinnedAt: string;            // ISO timestamp
  refreshSchedule?: string;    // cron expression or interval
  lastRefreshed?: string;
  sourceConversationId?: string;
}
```

### Data Flow

```
Chat Response (NDJSON stream)
  → Block events with stable IDs
  → Chat UI renders blocks with "Pin" button
  → User clicks Pin
  → Toast: "Chart pinned to canvas" [View →]
  → CanvasItem created in store (zustand / localStorage)
  → Canvas reads from store, renders as tldraw custom shapes
  → Each shape: re-runs SQL on schedule (mocked for frontend-only build)
```

### Navigation

```
Sidebar
  ├── [existing items: History, Knowledge, Metrics, etc.]
  └── Canvas (new)
        → /canvas route
        → tldraw infinite canvas
        → Custom shapes: ChartShape, ReportShape, NoteShape
```

---

## Open Questions

1. **Mocking scheduled reports**: Since there's no backend scheduling, how do we demonstrate scheduled agent reports? Options: pre-seed the canvas with hardcoded report cards, or simulate a "report arrived" event on a timer.
2. **Mocking live refresh**: Without scheduling infra, do we show a manual "Refresh" button per chart that re-runs the SQL on demand? Or simulate periodic refresh with mock data updates?
3. **tldraw licensing**: tldraw's license changed in 2024 (source-available, not MIT). Verify compatibility with commercial use before building on it.
4. **Chart config editing on canvas**: When a user changes chart type or filters on a pinned chart, does the config panel live inside the tldraw shape or as a slide-out side panel?
5. ~~**AI-initiated insights UX**~~ **Resolved:** Proactive insights land in an **Inbox** — a SmartStack-style widget on the canvas (see below).

---

## Constraints (Frontend-Only Build)

- **No new backend infra** — scheduling, persistence, and refresh are mocked or use localStorage. Existing API routes are reused where possible.
- **Additive to chat** — the existing markdown renderer stays; block rendering layers alongside it. No rewrite of current chat flow.
- **Single-user** — no collaboration, sharing, or permissions for now.
- **Canvas is additive** — new sidebar item, does not replace the home page or existing navigation.

---

## Next Steps

Run `/workflows:plan` to create an implementation plan for the POC.
