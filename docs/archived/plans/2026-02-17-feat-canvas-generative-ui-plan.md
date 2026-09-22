---
title: "Canvas + Generative UI"
type: feat
date: 2026-02-17
---

# Canvas + Generative UI

## Overview

Transform Baby Sentinel from "chat with your data" into a persistent, freeform canvas where insights compound over time. Users pin live charts from chat to an infinite canvas (tldraw), interact with them as mini-apps, and receive proactive AI-generated insights via a SmartStack inbox widget.

This is a **frontend-only build** — scheduling, persistence, and backend changes are mocked or use in-memory stores + localStorage. The existing chat flow is preserved; the canvas is additive.

**Brainstorm:** `docs/brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md`

## Problem Statement / Motivation

Charts in Baby Sentinel are ephemeral — they live only in conversation history. Users cannot:
- Persist valuable charts for ongoing monitoring
- Compare charts from different conversations side by side
- Receive proactive insights without asking
- Drill back into a chart to ask follow-up questions

The canvas solves this by providing a persistent surface where chat-generated artifacts accumulate and stay live.

## Proposed Solution

A new `/canvas` route accessible via sidebar, powered by tldraw's infinite canvas. Charts from chat responses get a "Pin to Canvas" button. Pinned charts become interactive tldraw shapes that store their SQL and can refresh. A SmartStack widget surfaces proactive AI insights.

## Technical Approach

### Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pin mechanism | Extract from existing markdown `\`\`\`chart` blocks | No backend changes needed. Block protocol is future work |
| Chart IDs | Frontend-generated via `crypto.randomUUID()` per chart block render | Simple, unique, no backend dependency |
| Canvas library | tldraw (v4.x, 100-day trial) | Freeform infinite canvas, custom shapes, built-in pan/zoom/undo. Falls back to simpler approach if licensing blocks |
| Charting library | Keep Recharts for POC | Already working. ECharts migration is a separate follow-up |
| Persistence | In-memory Map store (like conversations) + localStorage backup | Matches existing codebase pattern. No IndexedDB complexity |
| Chart config UI | Side panel (slide-out) | Matches existing ResizablePanel pattern from chat's TaskPanel/SourcesPanel |
| Drill to chat | Navigate to `/?canvasContext=<itemId>` | Chat page reads param, creates pre-loaded conversation |
| SmartStack | Pre-seeded mock insights + collapsible right panel | No backend scheduling; demo-quality mocking |
| Sidebar pattern | 3-tier (icon rail + hover panel + full page) | Established project pattern per `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md` |

### Data Model

```typescript
// src/lib/canvas-types.ts

interface CanvasItem {
  id: string;                           // crypto.randomUUID()
  type: "chart" | "report" | "insight";
  title: string;
  pinnedAt: string;                     // ISO timestamp

  // Chart-specific
  chartSpec?: ChartSpec;                // existing chart-types.ts ChartSpec
  sql?: string;                        // query that generated the data
  data?: Record<string, unknown>[];    // cached query results

  // Canvas position (synced from tldraw)
  position: { x: number; y: number };
  size: { width: number; height: number };

  // Linkage
  sourceConversationId?: string;
  sourceMessageIndex?: number;

  // Refresh
  lastRefreshed?: string;              // ISO timestamp

  // Report-specific
  reportMarkdown?: string;

  // Insight-specific (SmartStack)
  insightText?: string;
  severity?: "info" | "warning" | "critical";
  dismissed?: boolean;
}
```

### Canvas Store

```typescript
// src/lib/canvas-store.ts — follows conversation-store.ts pattern

const canvasItems = new Map<string, CanvasItem>();

export function saveCanvasItem(item: CanvasItem): void;
export function getCanvasItem(id: string): CanvasItem | undefined;
export function getAllCanvasItems(): CanvasItem[];
export function removeCanvasItem(id: string): void;
export function getInsights(): CanvasItem[];  // type === "insight", not dismissed

// localStorage backup on save, restore on first access
// Pre-seeded with 2-3 demo reports and 3-4 demo insights
```

### Data Flow

```
Chat Response (existing NDJSON → markdown with ```chart blocks)
  → markdown.tsx parses chart blocks (existing)
  → Each chart gets a "Pin to Canvas" button (new)
  → User clicks Pin
  → Extract ChartSpec + SQL from message context
  → saveCanvasItem() → in-memory Map + localStorage
  → Toast: "Chart pinned to canvas" [View →]
  → User navigates to /canvas
  → tldraw renders CanvasItems as custom ChartShape shapes
  → Each shape: wraps existing ReportChart component
  → Refresh button re-displays cached data with loading spinner (mocked, no backend call)
```

### Navigation

```
Sidebar Icon Rail
  ├── [existing: History, Knowledge, Metrics, Segments, Playbooks, Scouts, Connectors]
  └── Canvas (new — LayoutDashboard icon, between Scouts and Connectors)
        → Hover panel: list of pinned items (title + type + date)
        → Click: router.push("/canvas")
        → /canvas route: full tldraw canvas
```

### File Structure (new files)

```
src/
  lib/
    canvas-types.ts          # CanvasItem type, InsightPayload, ReportPayload
    canvas-store.ts          # In-memory Map store + localStorage backup
  components/
    canvas/
      canvas-page.tsx        # Main canvas page component (tldraw wrapper)
      chart-shape.tsx        # tldraw custom shape for charts + reports (BaseBoxShapeUtil, renders by CanvasItem.type)
      canvas-panel.tsx       # Sidebar hover panel
      canvas-config-panel.tsx # Side panel for chart configuration
      smart-stack.tsx        # SmartStack insight inbox widget
      pin-button.tsx         # "Pin to Canvas" button for chat charts
  app/
    canvas/
      page.tsx               # /canvas route
```

### Modified Files

```
src/components/sidebar.tsx          # Add "canvas" to HoverPanel, add RailIcon, add CanvasPanel
src/components/sidebar-context.tsx  # Add canvas item count + refresh for sidebar badge
src/lib/markdown.tsx                # Add pin button to chart block rendering
src/app/page.tsx                    # Handle ?canvasContext= param for drill-to-chat
```

## Implementation Phases

### Phase 0: Spike — Recharts inside tldraw

**Goal:** Validate that Recharts renders correctly inside a tldraw custom shape before building on top of it.

**Tasks:**
- [ ] Install tldraw: `pnpm add tldraw`
- [ ] Create a throwaway test page (e.g., `src/app/canvas-spike/page.tsx`) with a minimal tldraw canvas
- [ ] Implement a bare-bones `BaseBoxShapeUtil` that renders `<HTMLContainer>` wrapping a hardcoded `<ReportChart>` with sample ChartSpec data
- [ ] Verify: chart renders, SVG tooltips work on hover, pointer events don't conflict with tldraw pan/zoom
- [ ] If it fails: document the failure mode and evaluate fallbacks (static image via `toDataURL`, React Flow, or CSS grid layout)
- [ ] Clean up: delete the spike page once validated (the shape util code can be carried forward)

**Acceptance Criteria:**
- [ ] A Recharts bar chart renders inside a tldraw shape and responds to hover/tooltip interactions
- [ ] tldraw pan/zoom still works outside the chart shape
- [ ] Decision documented: proceed with tldraw, or pivot to fallback

### Phase 1: Foundation — Canvas Store + Route + Sidebar

**Goal:** Empty canvas page accessible from sidebar, data model defined.

**Tasks:**
- [ ] Create `src/lib/canvas-types.ts` with `CanvasItem` type
- [ ] Create `src/lib/canvas-store.ts` (Map store + localStorage + pre-seeded demo data)
- [ ] Create `src/app/canvas/page.tsx` (placeholder with "Canvas" heading, standard page shell)
- [ ] Add `"canvas"` to `HoverPanel` type in `sidebar.tsx`
- [ ] Add Canvas `RailIcon` with `LayoutDashboard` icon from lucide-react
- [ ] Add `getActivePage()` case for `/canvas` pathname
- [ ] Create `CanvasPanel` component in sidebar (list pinned items from store, sync read)
- [ ] Add `canvasVersion` counter to `SidebarContext` (like `playbookVersion`)
- [ ] Verify: `pnpm build` passes, canvas route loads, sidebar icon navigates correctly

**Acceptance Criteria:**
- [ ] `/canvas` route renders with sidebar, empty state message ("Pin charts from chat to build your canvas")
- [ ] Sidebar shows Canvas icon, hover panel lists pre-seeded demo items
- [ ] Clicking a demo item in hover panel navigates to `/canvas`

### Phase 2: Pin from Chat — The Core Flow

**Goal:** User can pin a chart from a chat response to the canvas store.

**Tasks:**
- [ ] Create `src/components/canvas/pin-button.tsx` — small "Pin to Canvas" icon button
- [ ] Modify `src/lib/markdown.tsx`: after rendering `<ReportChart>`, render `<PinButton>` below each chart
- [ ] Pass SQL context to PinButton: each chart block is rendered from a specific subagent's result. Thread the subagent's `queries` array through to the chart renderer so PinButton receives the exact SQL that produced this chart's data (not a "nearest" heuristic)
- [ ] PinButton `onClick`: build `CanvasItem` from ChartSpec + SQL + conversation context, call `saveCanvasItem()`, show sonner toast with "View" link
- [ ] Toast "View" link: `router.push("/canvas")` (navigate to canvas)
- [ ] Duplicate detection: check if a chart with same SQL already exists in store, show "Already pinned" toast instead
- [ ] Update `SidebarContext` canvas count on pin (bump `canvasVersion`)
- [ ] Verify: pin a chart from a real analytics response, see it in sidebar panel

**Acceptance Criteria:**
- [ ] Every chart block in chat responses shows a small pin icon button
- [ ] Clicking pin shows "Chart pinned to canvas" toast with "View" link
- [ ] Pinning same chart twice shows "Already pinned" toast
- [ ] Sidebar canvas panel updates to show the newly pinned item

### Phase 3: tldraw Canvas — Rendering Pinned Charts

**Goal:** The `/canvas` page renders a tldraw infinite canvas with pinned charts as interactive shapes.

**Tasks:**
- [x] Install tldraw: `pnpm add tldraw`
- [x] Create `src/components/canvas/chart-shape.tsx`:
  - Extend `BaseBoxShapeUtil` for `"chart"` shape type
  - `component()`: render `<HTMLContainer>` wrapping `<ReportChart>` with the shape's stored ChartSpec
  - `indicator()`: simple rect outline
  - Default size: 450x340, resizable
  - `pointerEvents: 'all'` + `canEdit()` for chart interactivity
- [x] Create `src/components/canvas/canvas-page.tsx`:
  - `<Tldraw>` wrapper with `shapeUtils={canvasShapeUtils}`
  - `onMount`: read all `CanvasItem`s from store, create tldraw shapes via `editor.createShapes()`
  - tldraw built-in tools available (pan, zoom, select, minimap)
  - Handle tldraw CSS import (`tldraw/tldraw.css`)
  - Next.js: use dynamic import with `ssr: false` (tldraw is client-only)
- [x] Update `src/app/canvas/page.tsx` to render the canvas-page component
- [x] Auto-placement algorithm for new pins: grid layout (480px columns, 370px rows), scan for first open slot
- [x] Sync tldraw shape changes back to store: on move/resize, update `CanvasItem.position` and `.size`; on shape deletion (via tldraw's Delete key or toolbar), call `removeCanvasItem()` to keep store in sync
- [x] Save/restore tldraw viewport (camera position, zoom) to localStorage via editor.getCamera/setCamera
- [x] Empty state: tldraw renders empty canvas when no items exist

**Acceptance Criteria:**
- [x] `/canvas` renders tldraw with all pinned charts as moveable, resizable shapes
- [x] Charts display correctly inside tldraw shapes (ReportChart renders, tooltips work)
- [x] Pan, zoom, select work. Minimap visible.
- [x] Moving/resizing shapes persists across page navigation
- [ ] Empty state shown when no items are pinned
- [ ] Pre-seeded demo charts appear on first visit

### Phase 4: Chart Interaction — Config Panel + Refresh

**Goal:** Users can modify chart settings and refresh data.

**Tasks:**
- [x] Create `src/components/canvas/canvas-config-panel.tsx`:
  - Slide-out panel (right side, similar to ResizablePanel pattern)
  - Opens when user clicks settings icon on shape toolbar
  - Shows: chart title (editable), chart type selector (bar/line/area/pie), data preview table, SQL query
  - Chart type change: update `CanvasItem.chartSpec.type`, re-render shape
  - Close panel: X button
- [x] Add "Refresh" button to chart shape toolbar + config panel footer:
  - On click: show loading spinner (500ms setTimeout), then re-render chart with existing cached `CanvasItem.data`
  - Update `lastRefreshed` timestamp
  - No backend call — this is a mocked refresh for demo purposes. Real refresh via `/api/query` is future work.
- [x] Add "Remove" button in config panel footer:
  - Confirmation via existing `ConfirmDialog` component
  - Remove from store + delete tldraw shape
  - Bump `canvasVersion` in sidebar context
- [x] Created `canvas-events.ts` event bridge for shape-to-page communication

**Acceptance Criteria:**
- [x] Settings toolbar button opens config panel with chart settings
- [x] Changing chart type (bar → line) updates the chart in-place
- [x] Refresh button shows loading spinner then re-renders chart with cached data
- [x] Remove button deletes chart from canvas after confirmation

### Phase 5: Drill to Chat — Canvas ↔ Chat Integration

**Goal:** Users can start a new chat conversation from a canvas chart's context.

**Tasks:**
- [x] Add "Ask about this" button to chart shape toolbar (MessageSquare icon)
- [x] On click: create a new conversation via conversation store with a context message containing:
  - Chart title
  - SQL query used
  - Summary of data (first 5 rows)
  - "I'm looking at a pinned chart on my canvas and want to explore further."
- [x] Navigate to `/?conv=<newConvId>` (existing pattern)
- [x] In `src/app/page.tsx`: when loading a conversation with canvas context, display a banner: "Continuing from canvas chart: {title}"
- [x] Add `sourceCanvasItemId` to `Conversation` type + API route for back-linking
- [x] "View on Canvas" link in chat banner navigates back to `/canvas`

**Acceptance Criteria:**
- [x] "Ask about this" on a canvas chart creates a new conversation with chart context
- [x] Chat page loads with the context pre-injected
- [x] User can continue chatting with full awareness of the chart's data and SQL
- [x] Navigation works in both directions (canvas → chat, chat → canvas via link)

### Phase 6: SmartStack Insight Inbox

**Goal:** A stacked card widget on the canvas shows proactive AI insights.

**Tasks:**
- [x] Create `src/components/canvas/smart-stack.tsx`:
  - Fixed-position collapsible panel on right edge of canvas (overlays tldraw, not a tldraw shape)
  - 320px wide, expandable height
  - Shows insight cards stacked (top card fully visible, others peek by 8px)
  - Each card: title, description text, severity badge, timestamp, source agent
  - Actions per card: "Pin" (promote to canvas chart shape), "Ask more" (drill to chat), "Dismiss"
  - Badge on collapsed state: count of unread insights
  - Click to expand/collapse
- [x] Pre-seed 3-4 mock insights in canvas store:
  - "Revenue dropped 15% in APAC yesterday" (critical)
  - "Retention cohort 3 is churning faster than baseline" (warning)
  - "New user signups up 22% week-over-week" (info)
  - "Cart abandonment spiked on mobile after last deploy" (warning)
- [x] Dismiss: mark `dismissed: true` in store, remove from visible stack
- [x] "Pin": create a CanvasItem of type "insight" → renders as a styled text card on canvas (not a chart)
- [x] "Ask more": same drill-to-chat flow as Phase 5, but with insight text as context instead of SQL

**Acceptance Criteria:**
- [x] SmartStack widget visible on canvas right edge with pre-seeded insights
- [x] Cards show severity badge, text, and action buttons
- [x] Dismiss removes card from stack
- [x] "Pin" promotes insight to a canvas card shape
- [x] "Ask more" opens a chat thread with the insight as context
- [x] Collapsed state shows badge count

### Phase 7: Scheduled Reports (Mocked)

**Goal:** Pre-seeded demo reports appear on the canvas as report shapes.

**Tasks:**
- [x] Extend `chart-shape.tsx` to handle `type: "report"` items — when the CanvasItem type is `"report"`, render a styled card (document icon, muted colors, report title, date, and first 3 lines of `reportMarkdown` as preview) instead of a Recharts chart. No separate `report-shape.tsx` file needed.
- [x] Double-click a report shape: open the config panel showing full markdown content rendered with the existing markdown renderer
- [x] Pre-seed 2 demo reports in canvas store:
  - "[Demo] Weekly Revenue Report — Feb 10-16, 2026" with mock markdown
  - "[Demo] User Engagement Summary — Feb 2026" with mock markdown
- [x] Reports are removable (same flow as chart removal)

**Acceptance Criteria:**
- [x] Pre-seeded reports appear on canvas as visually distinct from charts
- [x] Double-clicking report shows full markdown content in config panel
- [x] Reports can be removed from canvas

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| **React Flow instead of tldraw** | Already installed (`@xyflow/react`), MIT licensed, but designed for node graphs, not freeform canvases. tldraw provides pan/zoom/minimap/annotations natively. Fallback option if tldraw licensing blocks. |
| **Grid layout (react-grid-layout)** | Simpler to implement, but doesn't match the freeform canvas vision. Feels like a dashboard, not a workspace. |
| **Full block protocol in NDJSON stream** | Requires backend changes to `/api/analyze`. Deferred to future iteration. For POC, extract directly from markdown chart blocks. |
| **ECharts migration** | Better long-term (JSON-native, more chart types, canvas rendering), but adds scope. Recharts works for POC. Migrate in a follow-up. |
| **Zustand for state** | Cleaner API for cross-component state, but the codebase uses zero external state libraries. Adding zustand for one feature is inconsistent. Use in-memory Map store pattern instead. |
| **IndexedDB for persistence** | Handles larger datasets than localStorage, but adds dependency and complexity. For a demo, localStorage + in-memory Map is sufficient (store SQL + config, not full datasets). |

## Acceptance Criteria

### Functional Requirements

- [ ] New `/canvas` route accessible from sidebar with 3-tier pattern (hover panel + full page)
- [ ] Charts in chat responses have a "Pin to Canvas" button
- [ ] Pinned charts render as interactive tldraw shapes on the canvas
- [ ] Charts can be resized, moved, and repositioned on the canvas
- [ ] Chart type can be changed (bar/line/area/pie) via config panel
- [ ] Charts have a refresh button (mocked — re-renders cached data with loading spinner)
- [ ] "Ask about this" opens a new chat thread with chart context
- [ ] SmartStack widget shows pre-seeded mock insights
- [ ] Pre-seeded demo reports appear as report shapes on canvas
- [ ] Canvas state persists across page navigation within a session

### Non-Functional Requirements

- [ ] tldraw loads without blocking initial page render (dynamic import)
- [ ] Canvas renders smoothly with up to 20 pinned shapes
- [ ] Pin action completes in < 200ms (no network call, store write only)

### Quality Gates

- [ ] `pnpm build` passes at each phase boundary
- [ ] No new ESLint errors introduced
- [ ] tldraw CSS does not conflict with existing Tailwind styles

## Dependencies & Prerequisites

| Dependency | Version | Purpose | License |
|------------|---------|---------|---------|
| `tldraw` | ^4.3.x | Infinite canvas SDK | Source-available, 100-day trial for commercial |
| Existing `recharts` | ^3.7.0 | Chart rendering inside tldraw shapes | MIT |
| Existing `lucide-react` | ^0.564.0 | `LayoutDashboard` icon for sidebar | ISC |
| Existing `sonner` | ^2.0.7 | Toast notifications for pin actions | MIT |

**No new backend routes required.** Chart refresh is mocked (re-renders cached data). Real refresh via a dedicated query endpoint is future work.

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tldraw license expires after 100 days | High | Canvas page stops working | Set calendar reminder. Evaluate: purchase license, switch to React Flow, or build minimal custom canvas |
| tldraw bundle size impacts load time | Medium | Slow `/canvas` page load | Dynamic import with `ssr: false`, code-split from main bundle |
| Recharts inside tldraw has rendering issues | Medium | Charts don't display properly in shapes | Test early in Phase 3. Fallback: render chart as static image (canvas `toDataURL`) |
| localStorage size limit hit with many pins | Low (demo) | Pin fails silently | Cap at 20 items, show toast error on limit. Store SQL + config only (not raw data) |
| tldraw undo/redo conflicts with chart config changes | Low | Confusing Cmd+Z behavior | Chart config changes bypass tldraw undo stack (direct store updates) |

## Future Considerations

These are explicitly **out of scope** for this POC but inform the architecture:

- **Block protocol**: Extend NDJSON stream with typed block events. Each block gets a stable ID from the backend. Eliminates the markdown extraction hack.
- **ECharts migration**: Replace Recharts with ECharts for JSON-native chart generation, more chart types, and canvas/WebGL rendering.
- **Backend scheduling**: Real cron-based agent runs that push insights and reports to the canvas via WebSocket or SSE.
- **Collaboration**: tldraw supports multiplayer via CRDT. Multi-user canvas editing becomes possible.
- **Persistent storage**: Move from localStorage to a backend API for canvas items, enabling cross-device access.
- **Canvas templates**: Pre-built canvas layouts (e.g., "Weekly Dashboard", "Retention Monitor") that auto-populate with relevant queries.

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md`
- Sidebar pattern: `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md`
- State persistence: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
- Route-first navigation: `docs/solutions/integration-issues/post-merge-missing-navigation-entry-point.md`
- Chart rendering: `src/components/chart/report-chart.tsx`, `src/lib/chart-types.ts`
- Markdown parser: `src/lib/markdown.tsx`
- NDJSON streaming: `src/app/api/analyze/route.ts`, `src/app/page.tsx` (lines 949-1251)
- Sidebar: `src/components/sidebar.tsx`, `src/components/sidebar-context.tsx`
- Conversation store: `src/lib/conversation-store.ts`
- Playbook store: `src/lib/playbook-store.ts` (same Map pattern)

### External References

- tldraw docs: https://tldraw.dev/
- tldraw custom shapes: https://tldraw.dev/examples/custom-shape
- tldraw licensing: https://tldraw.dev/community/license ($6k/year commercial, 100-day trial)
- tldraw persistence: https://tldraw.dev/sdk-features/persistence
- ECharts (future): https://echarts.apache.org/handbook/en/get-started/
- echarts-for-react (future): https://github.com/hustcc/echarts-for-react
- Observable Canvases (inspiration): https://observablehq.com/
- Databricks Genie (inspiration): https://www.databricks.com/product/genie
