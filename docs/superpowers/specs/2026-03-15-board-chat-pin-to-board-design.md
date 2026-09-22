# Board Chat: Pin to Board

**Date:** 2026-03-15
**Status:** Approved

## Problem

When a user asks a follow-up question in the board's chat panel, the system auto-creates cards on the board and the chat shows only a status ticker ("Added 2 cards"). This bypasses user judgment — every query pollutes the board with cards the user may not want.

The core product pattern is: response appears in chat → user reads → user pins what's valuable. Board chat should follow this same pattern.

## Decision

Reuse the main chat flow for board queries. Remove the canvas-query interception from the chat panel. The existing `PinButton` component handles card creation when the user chooses to pin.

## Design

### Routing Change

Remove the canvas-query interception in `chat-panel.tsx`. Currently when `activeBoardId` is set and the tldraw editor is ready, `handleCanvasSend` routes queries to `/api/canvas-query` instead of the normal chat flow.

After this change, board chat always uses `chat.handleSend()` → `/api/classify` → `/api/analyze` or `/api/chat`. Full conversational responses (text, charts, follow-up actions) appear in the chat panel, identical to the main chat.

### Pin to Board

The existing `PinButton` component (`src/components/canvas/pin-button.tsx`) already:
- Creates a `BoardCard` with correct fields
- Computes placement via `findPackedPosition()` (grid packing with 24px gap)
- Handles board selection (last-used board or picker)
- Shows "Pinned" state with checkmark to prevent double-pins
- Shows toast with "View" link to the board

Pin behavior per response type:
- **Chart response** → Pin creates a chart card with `chartSpec` and data
- **Text response** → Pin creates a text card with markdown content
- One pin = one card. No DAG, no auto-arrows, no auto-annotations.

### Pinned Indicator on Chat Messages

After a user pins a response, the chat message shows a subtle indicator that it's been pinned to the board. The existing `PinButton` already transitions to a disabled "Pinned" checkmark state per-instance, which serves this purpose.

### Clarification: On-Canvas Flows Are Kept

`PromptToCardInput` (the inline canvas prompt for typing directly on the canvas) and the chart drilldown handler both call `processStream` to auto-create cards. These are **kept** — they are explicit on-canvas user actions ("I want cards here"), not chat-driven auto-creation. The "pin to board" change only affects the chat panel's routing.

## Files Changed

### Remove
| File / Code | What |
|-------------|------|
| `handleCanvasSend` in `chat-panel.tsx` | Canvas-query interception logic |
| `CanvasQueryProgress` + `PHASE_LABELS` in `chat-thread.tsx` | Status ticker component ("Generating SQL...", "Added 2 cards") |
| `canvas-query` from `ChatMessage.variant` union in `types.ts` | Dead union member |
| `canvasQueryStatus` field from `ChatMessage` in `types.ts` | Dead field |
| `sendCanvasQuery` / `setCanvasQueryHandler` / `CanvasQueryStatus` type in `canvas-events.ts` | Query handler bridge (keep deck pin handler and other event functions) |
| `isCanvasEditorReady` / `notifyCanvasEditorReady` in `canvas-events.ts` | Dead code — only consumer was `handleCanvasSend` |

### Keep (no changes)
| File | Why |
|------|-----|
| `/api/canvas-query/route.ts` | Don't delete — unused from chat but avoids risk |
| `use-canvas-stream.ts` | Still used by `PromptToCardInput` and chart drilldown |
| `processStream` in `use-canvas-actions.ts` | Still used by `canvas-page.tsx` for on-canvas flows |
| `canvas-sse-types.ts` | Still consumed by `use-canvas-stream.ts` |
| `PinButton` (`pin-button.tsx`) | Already works correctly |
| `board-store.ts` / `saveBoardCard()` | Already used by PinButton |
| Normal chat flow (`/api/analyze`, `/api/chat`) | No changes needed |
| `use-canvas-actions.ts` (non-query-bridge parts) | Card CRUD, refresh, annotations, drag-drop all stay |
| Chat/Comments tab toggle in board panel | No changes needed — Chat tab now shows richer content |

## Out of Scope

- Deleting `/api/canvas-query/route.ts`
- DAG layout, auto-arrows, auto-annotations
- Multi-element pin (pin chart and text separately from one response)
- Changes to the main chat flow
- Changes to board rendering or card shapes
- Modifying PromptToCardInput or chart drilldown flows
