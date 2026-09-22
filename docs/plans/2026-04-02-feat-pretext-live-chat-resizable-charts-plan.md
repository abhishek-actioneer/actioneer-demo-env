---
title: "Pretext Live Chat with Resizable Charts"
type: feat
status: active
date: 2026-04-02
---

# Pretext Live Chat with Resizable Charts

## Overview

Turn `/pretext` from a static markdown demo into a live chat experience with magazine-style report rendering and resizable charts. User asks a question, the analytics pipeline streams back a report, and it renders through `PretextReport` with CSS float layout. Charts/tables have drag handles to resize — text reflows automatically.

**Self-contained** — no changes to any other page, provider, or component.

## Problem Statement

The `/pretext` page currently shows a hardcoded markdown sample. It proves the layout works but doesn't connect to the real analytics pipeline. The goal is to make it a live playground where:

1. You ask a question and get a streamed deep research report in magazine layout
2. You can grab a chart/table edge and resize it — the surrounding text reflows instantly
3. Everything stays isolated to `/pretext` — zero impact on the main chat, sidebar, or other pages

## Proposed Solution

### Architecture: Standalone Chat with Local State

Use `useAnalytics` directly with local state — no `ChatStateProvider`, no `SidebarProvider`, no `useConversation`. The provider tree in `layout-shell.tsx` already provides `DatasetProvider` (required for `apiFetch` headers), so no provider changes needed.

```
/pretext page
├── Local state: messages[], activeConvId, isProcessing, deepResearch
├── useAnalytics({ ...localState, ...noOpCallbacks })
├── ChatInput (onSend → handleSend from useAnalytics)
└── PretextReport (content = latest assistant message content)
    ├── CSS float layout (magazine mode)
    └── Resizable chart/table containers (drag handles)
```

### File Changes

#### 1. `src/app/pretext/page.tsx` — Add chat input + wire streaming

Replace the static sample report with a live chat flow:

```tsx
// Local state (no providers needed)
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [activeConvId, setActiveConvId] = useState<string | null>(null);
const [isProcessing, setIsProcessing] = useState(false);
const [deepResearch, setDeepResearch] = useState(true); // default deep for reports
const agentMsgIdRef = useRef("");
const messagesRef = useRef(messages);
const abortRef = useRef<AbortController | null>(null);

// useAnalytics with no-op callbacks for sidebar/panel
const analytics = useAnalytics({
  messages, setMessages,
  activeConvId, setActiveConvId,
  isProcessing, setIsProcessing,
  agentMsgIdRef, messagesRef,
  refreshChats: () => {},
  notifyCreditChanged: () => {},
  setPanel: () => {},
  datasetId,  // from useDataset()
  handlePlaybookCreate: async () => {},
  setProcessingPhase: () => {},
});

// Latest assistant message content → PretextReport
const latestContent = messages.findLast(m => m.role === "assistant")?.content ?? "";
```

**Layout:**
- Top: header bar with title + layout mode toggle
- Middle: `PretextReport` rendering the streamed content (grows as tokens arrive)
- Bottom: `ChatInput` pinned at bottom

When no messages exist, show the sample report as a demo. Once the user sends a query, switch to live streamed content.

#### 2. `src/components/pretext/pretext-report.tsx` — Add resizable chart/table containers

Add drag handles to float containers. On resize, update width state per block key. CSS float handles reflow.

**Resize mechanism:**

```tsx
// Per-chart width overrides (keyed by block.key)
const [chartWidths, setChartWidths] = useState<Record<number, number>>({});

function RenderChartBlock({ block, float }: { block: ChartBlock; float: boolean }) {
  const customWidth = chartWidths[block.key];
  const widthPercent = customWidth ?? 42; // default 42%

  return (
    <div
      className={float ? "float-right ml-6 mb-4 clear-right relative group" : "mb-6"}
      style={float ? { width: `${widthPercent}%` } : undefined}
    >
      <UnifiedChart spec={block.spec} variant="compact" />
      {float && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize
                     opacity-0 group-hover:opacity-100 hover:bg-foreground/10
                     active:bg-foreground/20 transition-opacity"
          onMouseDown={(e) => startResize(e, block.key, widthPercent)}
        />
      )}
    </div>
  );
}
```

**Resize logic** (same pattern as `resizable-panel.tsx`):

```tsx
const startResize = (e: React.MouseEvent, key: number, currentPercent: number) => {
  e.preventDefault();
  const startX = e.clientX;
  const containerW = containerRef.current?.clientWidth ?? 1;
  const startPx = (currentPercent / 100) * containerW;

  const onMove = (ev: MouseEvent) => {
    // Dragging left = wider (float is on right side)
    const delta = startX - ev.clientX;
    const newPx = Math.min(containerW * 0.7, Math.max(containerW * 0.25, startPx + delta));
    setChartWidths(prev => ({ ...prev, [key]: (newPx / containerW) * 100 }));
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};
```

Same resize handles on `RenderTableBlock`.

**Width constraints:** min 25%, max 70% of container width.

#### 3. No other files changed

- No changes to `layout-shell.tsx`, `chat-state-provider.tsx`, or any provider
- No changes to `use-analytics.ts` — used as-is with local state
- No changes to the main chat page or any API routes
- `PretextReport` component changes are additive (resize handles)

## Acceptance Criteria

- [x] `/pretext` has a chat input at the bottom that accepts queries
- [x] Queries stream through the real analytics pipeline (`/api/analyze`)
- [x] Streamed responses render in magazine layout via `PretextReport`
- [x] Charts in the response have drag handles on the left edge (visible on hover)
- [x] Dragging the handle resizes the chart (25%-70% width range)
- [x] Surrounding text reflows automatically when chart is resized
- [x] Tables also have resize handles with the same behavior
- [x] Sample report shows by default when no messages exist
- [x] Deep research mode is on by default (produces richer reports with charts)
- [x] No changes to any page other than `/pretext`
- [x] No changes to any provider or hook file
- [x] Main chat at `/` continues working identically

## Context

### Key Files

| File | Role |
|------|------|
| `src/app/pretext/page.tsx` | Page component — add chat input + local state |
| `src/components/pretext/pretext-report.tsx` | Report renderer — add resize handles |
| `src/hooks/use-analytics.ts:161` | `handleSend` entry point — used as-is |
| `src/lib/api-client.ts:69` | `apiFetch` streaming — used as-is |
| `src/lib/sse-types.ts` | SSE event types — charts arrive in `text` deltas as fenced blocks |
| `src/components/chat/chat-input.tsx` | Chat input component — reused as-is |

### Gotchas from Past Solutions

1. **Provider isolation** — Don't add providers to `layout-shell.tsx`. Keep all state local to the page.
2. **Capture `datasetId` at invocation time** — Pass explicit `datasetId` to `apiFetch` in long-running streaming to prevent cross-dataset contamination if user switches datasets mid-stream.
3. **`setActiveDatasetId()` must be called before `apiFetch`** — Already handled by `DatasetProvider` in `layout-shell.tsx`.
4. **In-memory stores don't sync across API/client boundary** — Not relevant here since we're only reading streamed responses, not writing to stores.

### How Charts Arrive in the Stream

Charts are NOT separate SSE events. They're embedded as ` ```chart ` fenced code blocks inside `text` delta tokens. As tokens accumulate, the growing markdown string contains partial chart blocks. `PretextReport`'s parser handles this — incomplete fences are skipped until closed.

### CSS Float Resize = Free Reflow

Since `PretextReport` uses CSS `float: right` for charts/tables, changing the width percentage triggers instant browser reflow. No layout engine recalculation needed. This is the key advantage of the CSS float approach over the previous Pretext absolute-positioning engine.
