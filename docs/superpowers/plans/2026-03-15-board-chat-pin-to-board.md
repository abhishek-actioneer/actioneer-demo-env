# Board Chat: Pin to Board — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the canvas-query interception from board chat so queries use the normal chat flow, and users pin responses to the board selectively.

**Architecture:** Remove the chat→canvas-query bridge (handleCanvasSend, sendCanvasQuery, setCanvasQueryHandler, notifyCanvasEditorReady). Clean up dead types and components. On-canvas flows (PromptToCardInput, drilldown) are untouched — they still use processStream directly.

**Tech Stack:** Next.js, React, TypeScript

---

## Chunk 1: Remove canvas-query interception and dead code

### Task 1: Remove handleCanvasSend from chat-panel.tsx

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`

- [ ] **Step 1: Remove the canvas-query import**

Remove line 16:
```typescript
import { sendCanvasQuery, isCanvasEditorReady, type CanvasQueryStatus } from "@/components/canvas/canvas-events";
```

- [ ] **Step 2: Remove the handleCanvasSend callback**

Remove the entire `handleCanvasSend` callback (lines 213–269) and the `onSend` conditional (line 271).

- [ ] **Step 3: Replace onSend usage with chat.handleSend**

In the `ChatInput` component (line 277), change:
```typescript
onSend={onSend}
```
to:
```typescript
onSend={chat.handleSend}
```

- [ ] **Step 4: Remove unused activeBoardId prop from ChatContent**

The `activeBoardId` prop on `ChatContent` was only used to decide `onSend`. Remove it:

In `ChatContent` component definition (line 194), remove `activeBoardId` from props and its type (`activeBoardId?: string | null`).

In the `ChatPanel` render (line 181), remove:
```typescript
activeBoardId={hasBoardMode ? activeBoardId : null}
```

- [ ] **Step 5: Remove ChatMessage import if now unused**

Check if `ChatMessage` type import (line 17) is still used in chat-panel.tsx. If only used by handleCanvasSend, remove it.

- [ ] **Step 6: Verify the build compiles**

Run: `pnpm build 2>&1 | head -40`
Expected: No errors in `chat-panel.tsx`

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/chat-panel.tsx
git commit -m "refactor: remove canvas-query interception from board chat panel"
```

---

### Task 2: Remove CanvasQueryProgress from chat-thread.tsx

**Files:**
- Modify: `src/components/chat/chat-thread.tsx`

- [ ] **Step 1: Remove the canvas-query rendering branch**

In the message rendering loop (around line 304–311), remove:
```typescript
// Canvas query progress
if (msg.variant === "canvas-query" && msg.canvasQueryStatus) {
  return (
    <div key={msg.id} className="animate-fade-in-up">
      <CanvasQueryProgress status={msg.canvasQueryStatus} />
    </div>
  );
}
```

- [ ] **Step 2: Remove PHASE_LABELS and CanvasQueryProgress component**

Remove the `PHASE_LABELS` constant (line 549–554) and the entire `CanvasQueryProgress` function (lines 556–620+).

- [ ] **Step 3: Remove CanvasQueryStatus import if present**

Check if `CanvasQueryStatus` is imported in chat-thread.tsx. If so, remove the import.

- [ ] **Step 4: Verify the build compiles**

Run: `pnpm build 2>&1 | head -40`
Expected: No errors in `chat-thread.tsx`

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chat-thread.tsx
git commit -m "refactor: remove CanvasQueryProgress component and PHASE_LABELS"
```

---

### Task 3: Clean up canvas-query bridge in canvas-events.ts

**Files:**
- Modify: `src/components/canvas/canvas-events.ts`

- [ ] **Step 1: Remove the chat-to-canvas query bridge section**

Remove lines 8–44 (the entire `/* ── Chat-to-canvas query bridge ── */` section):
- `CanvasQueryStatus` type
- `CanvasQueryHandler` type
- `_canvasQueryHandler` variable
- `_canvasEditorReady` variable
- `setCanvasQueryHandler()` function
- `notifyCanvasEditorReady()` function
- `isCanvasEditorReady()` function
- `sendCanvasQuery()` function

Keep everything else: the deck pin bridge (lines 46–68) and the general canvas event system (lines 70–84).

- [ ] **Step 2: Verify the build compiles**

Run: `pnpm build 2>&1 | head -40`
Expected: Errors in `use-canvas-actions.ts` and `canvas-page.tsx` (we'll fix those next)

- [ ] **Step 3: Commit (will be squashed with Task 4)**

Hold commit until Task 4 fixes the downstream references.

---

### Task 4: Remove query handler from use-canvas-actions.ts and canvas-page.tsx

**Files:**
- Modify: `src/components/canvas/use-canvas-actions.ts`
- Modify: `src/components/canvas/canvas-page.tsx`

- [ ] **Step 1: Remove setCanvasQueryHandler import from use-canvas-actions.ts**

On line 21, change:
```typescript
import { onCanvasEvent, setCanvasQueryHandler, type CanvasQueryStatus } from "./canvas-events";
```
to:
```typescript
import { onCanvasEvent } from "./canvas-events";
```

- [ ] **Step 2: Remove the chat-to-canvas query handler useEffect**

Remove the entire `// ── Chat-to-canvas query handler ──` useEffect block (lines 444–484).

- [ ] **Step 3: Remove notifyCanvasEditorReady from canvas-page.tsx**

On line 15, change:
```typescript
import { onCanvasEvent, notifyCanvasEditorReady } from "./canvas-events";
```
to:
```typescript
import { onCanvasEvent } from "./canvas-events";
```

Remove the `notifyCanvasEditorReady(true)` call from `handleEditorReady` (line 265).

Remove the cleanup useEffect that calls `notifyCanvasEditorReady(false)` (lines 269–271).

- [ ] **Step 4: Verify the build compiles**

Run: `pnpm build 2>&1 | head -40`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/canvas-events.ts src/components/canvas/use-canvas-actions.ts src/components/canvas/canvas-page.tsx
git commit -m "refactor: remove chat-to-canvas query bridge and editor-ready flag"
```

---

### Task 5: Clean up dead types in types.ts

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Remove "canvas-query" from the variant union**

On line 180, change:
```typescript
variant?: "gathering" | "streaming" | "report-cta" | "connector-required" | "playbook-preview" | "save-as-playbook" | "save-to-knowledge" | "metric-context" | "segment-confirm" | "canvas-query";
```
to:
```typescript
variant?: "gathering" | "streaming" | "report-cta" | "connector-required" | "playbook-preview" | "save-as-playbook" | "save-to-knowledge" | "metric-context" | "segment-confirm";
```

- [ ] **Step 2: Remove canvasQueryStatus field**

Remove line 203:
```typescript
canvasQueryStatus?: import("@/components/canvas/canvas-events").CanvasQueryStatus;
```

And remove the comment on line 202:
```typescript
/** Canvas query progress status */
```

- [ ] **Step 3: Verify the build compiles**

Run: `pnpm build 2>&1 | head -40`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "refactor: remove canvas-query variant and canvasQueryStatus from ChatMessage type"
```

---

### Task 6: Verify the app works end-to-end

- [ ] **Step 1: Run lint**

Run: `pnpm lint 2>&1 | tail -20`
Expected: No new errors

- [ ] **Step 2: Run build**

Run: `pnpm build 2>&1 | tail -20`
Expected: Clean build

- [ ] **Step 3: Manual smoke test (if dev server available)**

1. Navigate to a board/canvas page
2. Open the chat panel
3. Type a question — response should appear in chat (not auto-create cards)
4. PinButton should be available on analytics responses
5. PromptToCardInput on the canvas itself should still work (creates cards directly)

---

## Summary

This is a 6-task plan, primarily subtractive:
- **Tasks 1–2**: Remove chat-panel interception and chat-thread status component
- **Tasks 3–4**: Remove the event bridge and its callers (canvas-events, use-canvas-actions, canvas-page)
- **Task 5**: Clean up dead types
- **Task 6**: Verify everything works
