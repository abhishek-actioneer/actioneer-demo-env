---
title: "fix: tldraw canvas buttons not clickable — capture phase pointer events"
type: fix
date: 2026-03-12
deepened: 2026-03-12
---

# fix: tldraw canvas buttons not clickable — capture phase pointer events

## Enhancement Summary

**Deepened on:** 2026-03-12
**Research agents used:** Architecture Strategist, Pattern Recognition Specialist, Julik Frontend Races Reviewer, TypeScript Reviewer, Code Simplicity Reviewer, Best Practices Researcher

### Key Improvements
1. **The pointer fix alone is not sufficient** — 5 gaps remain between click-registration and the full interactive insight card vision
2. **`sql-renderer.tsx` Run button** (line 73) still uses the broken `onPointerDown` pattern — confirmed highest-priority remaining code fix
3. **"Ask about this" toolbar** navigates away from canvas (`router.push`) instead of injecting into sidebar — breaks canvas context and is inconsistent with the `injectText` pattern used by follow-up chips
4. **`ChallengeRenderer`** exists as a passive display-only card — has no affordance for users to respond to or continue a challenge conversation

### New Considerations Discovered
- CSS `pointer-events: all` on the chips container overrides ancestor `pointer-events: none` per spec — follow-up chips ARE first-click interactive without requiring card selection
- `e.stopPropagation()` in capture phase stops propagation *down* (to children), not up — our buttons are leaf elements so this is safe
- `handleAskAboutThis` in `use-canvas-actions.ts` calls `router.push("/?conv=...")` — navigates user out of canvas context
- A `useInteractiveTldrawButton()` hook would eliminate the 3-line boilerplate that must now be repeated across every interactive button

---

## Overview

Toolbar buttons and follow-up question chips on tldraw canvas insight cards were non-interactive despite three iterations of fixes. The final root cause was **event phase ordering**: React's `onPointerDown` (bubble phase) fires after tldraw's canvas handler has already called `setPointerCapture`, which steals all subsequent pointer events from the button. The fix — using `onPointerDownCapture` (capture phase) instead — was applied to `FollowUpChip` and `ToolbarBtn`. A third component (`sql-renderer.tsx` Run button) still uses the broken pattern and needs the same fix.

---

## Problem Statement

### Iteration 3 — True Root Cause

```
1. NATIVE CAPTURE phase (top → bottom):
   window → document → body → #root  ← React fires onPointerDownCapture HERE
   → tldraw wrappers → tl-canvas → ... → <button>

2. NATIVE BUBBLE phase (bottom → top):
   <button> → ... → tl-canvas  ← tldraw's handler fires HERE
   → ... → #root               ← React fires onPointerDown HERE (too late)
```

tldraw's `useCanvasEvents.onPointerDown` runs at `tl-canvas` during step 2 — **before** React's bubble-phase handler at `#root`. By the time our `onPointerDown` handler could call `markEventAsHandled(e)`, tldraw has already:

1. Passed `wasEventAlreadyHandled(e)` (returns false — not yet marked)
2. Called `setPointerCapture(e.currentTarget, e)` — routes **all** subsequent pointer events (including `pointerup`) to the tldraw canvas element

With pointer capture set on the canvas, the button never receives `pointerup`, the browser never fires `click`, and our `onClick` handler never runs.

**The fix:** `onPointerDownCapture` fires at `#root` during native **capture** phase (step 1) — always before any bubble handler. `markEventAsHandled(e)` is set before tldraw checks `wasEventAlreadyHandled`, causing tldraw to skip `dispatch()` and `setPointerCapture()` entirely.

### Research Insight: CSS pointer-events and Ancestor Gates

A parent with `pointer-events: none` does **not** block children with `pointer-events: all` from receiving events. Per CSS spec:
> "An element with pointer-events: none is never the target of pointer events; however, pointer events may target its descendant elements if those descendants have pointer-events set to some other value."

This means `FollowUpChip` buttons (inside a container with `pointer-events: all`) **do** receive pointer events even when the `HTMLContainer` ancestor has `pointer-events: none` (unselected card). CSS gating at the parent level does not prevent child interaction. The tldraw capture-phase fix is the only required mechanism.

---

## Proposed Solution

### Already Implemented ✅

**`src/components/canvas/card-renderers/insight-renderer.tsx` — `FollowUpChip` (line 150)**

```diff
- onPointerDown={(e) => {
+ onPointerDownCapture={(e) => {
    e.stopPropagation();
    editor.markEventAsHandled(e);
  }}
```

**`src/components/canvas/card-renderers/shared.tsx` — `ToolbarBtn` (line 496)**

```diff
- onPointerDown={(e) => {
+ onPointerDownCapture={(e) => {
    e.stopPropagation();
    editor.markEventAsHandled(e);
  }}
```

### Still Needed ❌

**`src/components/canvas/card-renderers/sql-renderer.tsx` — Run button (line 73)**

```diff
+ import { useEditor } from "tldraw";

  // Inside the component that renders the Run button:
+ const editor = useEditor();

  <button
    className="nodrag"
    onClick={() => { emitCanvasEvent("run-sql", item.id); }}
-   onPointerDown={(e) => e.stopPropagation()}
+   onPointerDownCapture={(e) => {
+     e.stopPropagation();
+     editor.markEventAsHandled(e);
+   }}
```

**Important:** `useEditor()` requires the component to call the hook at the component function level — `sql-renderer.tsx` may need to extract the Run button into a sub-component if the hook is called conditionally or inside a loop.

---

## Technical Considerations

### tldraw's Guard System

```js
// useCanvasEvents.js (tldraw internals)
function onPointerDown(e) {
  if (editor.wasEventAlreadyHandled(e)) return;  // ← checked first
  setPointerCapture(e.currentTarget, e);          // ← breaks click if reached
  editor.dispatch({ ... });
}

// Editor.js — WeakSet keyed on native event identity
markEventAsHandled(e) {
  const nativeEvent = "nativeEvent" in e ? e.nativeEvent : e;
  this.handledEvents.add(nativeEvent);  // works with synthetic or native
}
```

`markEventAsHandled` accepts React synthetic events — it extracts `e.nativeEvent` internally. So calling it in an `onPointerDownCapture` handler (which receives a synthetic event) works correctly.

### Three-Part Requirement

All three are required for interactive HTML inside tldraw shapes:

| Requirement | Purpose |
|-------------|---------|
| `onPointerDownCapture` (not `onPointerDown`) | Fires before tldraw's bubble handler |
| `editor.markEventAsHandled(e)` | Prevents tldraw from calling `setPointerCapture` |
| `e.stopPropagation()` | Prevents React event tree propagation (down to children in capture) |

> **Note on stopPropagation in capture phase:** `stopPropagation()` in a capture handler stops the event from propagating *down the capture path* (to children) AND *up the bubble path*. Our buttons are leaf elements with no children that need the event, so this is safe. The implication is that tldraw's event wrappers above `#root` won't see the event, but those don't affect shape selection behavior.

Plus the containing zone needs `pointerEvents: "all"` (unconditionally or gated on `isSelected || isEditing`), and `className="nodrag"` to suppress tldraw drag initiation on the element.

### `FollowUpChip` — Unconditionally Interactive (by Design)

Unlike toolbar buttons, `FollowUpChip` sets `pointerEvents: "all"` **unconditionally** (not gated on `isSelected`). This is intentional: follow-up chips should be clickable without first selecting the card.

CSS `pointer-events: all` on the chips container overrides the ancestor `HTMLContainer`'s `pointer-events: none`, so chips receive events even on unselected cards. Combined with `onPointerDownCapture`, this makes chips first-click interactive — **no select-first required**.

### Recommended Abstraction: `useInteractiveTldrawButton()`

The three-line pattern is now repeated in at least 3 places (`FollowUpChip`, `ToolbarBtn`, and `sql-renderer.tsx`). A shared hook prevents drift:

```typescript
// src/components/canvas/use-interactive-tldraw-button.ts
import { useEditor } from "tldraw";
import { useCallback } from "react";

export function useInteractiveTldrawButton() {
  const editor = useEditor();
  return useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    editor.markEventAsHandled(e);
  }, [editor]);
}

// Usage:
const handlePointerDown = useInteractiveTldrawButton();
<button onPointerDownCapture={handlePointerDown} onClick={...}>
```

### `FollowUpChip` Exception

Unlike toolbar buttons, `FollowUpChip` sets `pointerEvents: "all"` **unconditionally** (not gated on `isSelected`). This is intentional: follow-up chips should be clickable without first selecting the card. No change needed here.

### Table Renderer

`table-renderer.tsx` sort headers and pagination buttons use `onClick` only (no `onPointerDown*` handler). The parent zone already has `pointerEvents: "all"` + `nodrag nowheel`. CSS pointer-events inheritance means these buttons CAN receive events. The missing `onPointerDownCapture` means tldraw could theoretically steal the event, but in practice table interactions only happen when the card is selected (the zone is gated). **Low priority, but can be hardened later** with `useInteractiveTldrawButton()`.

---

## Does This Fix Fully Achieve the Interactive Insight Card Vision?

**Short answer: The pointer fix is a prerequisite, but not sufficient.** Here is the full gap analysis:

| Capability | Status After Pointer Fix |
|---|---|
| Follow-up chip click registers | ✅ Fixed |
| Follow-up chip → sidebar chat input (first click, no select required) | ✅ Works — `injectText` path complete |
| Toolbar buttons click registers (when selected) | ✅ Fixed |
| "Ask about this" toolbar → sidebar chat context | ⚠️ Wired but navigates away — `handleAskAboutThis` calls `router.push("/?conv=...")` which leaves canvas |
| "Refresh card" toolbar → data refresh | ✅ Wired — `handleRefreshCard` in `use-canvas-actions.ts` |
| SQL Run button clickable | ❌ Still uses broken `onPointerDown` pattern |
| Regular insight card body: challenge/question affordance | ❌ Body has `pointerEvents: none` permanently — no chips, no clickable text |
| `ChallengeRenderer` response affordance | ❌ Purely passive display card — no chips to continue the challenge conversation |
| `table-renderer.tsx` pagination defense-in-depth | ⚠️ Works in practice (gated zone) but lacks capture-phase handler |

### Gap 1 (Blocking): SQL Run Button

`src/components/canvas/card-renderers/sql-renderer.tsx:73` — needs `onPointerDownCapture` + `useEditor()`. See fix above.

### Gap 2 (UX): "Ask about this" Navigates Away from Canvas

`handleAskAboutThis` in `use-canvas-actions.ts` (line 350–412) creates a new conversation and calls `router.push("/?conv=${convId}")`. This navigates the user off the canvas page entirely.

The `injectText` path (used by FollowUpChip) is better UX: it opens the sidebar panel and prefills the input without navigating. The "Ask about this" toolbar action should do the same:

```typescript
// In use-canvas-actions.ts handleAskAboutThis — current:
router.push(`/?conv=${convId}`);

// Better: inject card context into sidebar chat, stay on canvas
const contextMessage = `Tell me more about: ${card.title}`;
injectText(contextMessage);  // from useChatPanel()
```

However, this is an **architectural decision** (create-and-navigate vs. inject-and-stay) that affects how card conversations are persisted. The current approach saves the conversation to the store; the `injectText` approach doesn't pre-create it. **Document the trade-off before changing.**

### Gap 3 (Vision): No Challenge Affordance on Regular Insight Card Bodies

Regular insight cards (`isFollowUp = false`) render the insight text in a body div with `pointerEvents: "none"`. There's no interactive element for the user to click to challenge or question the insight directly. The only interaction path is: select card → use "Ask about this" toolbar button (which navigates away).

To close this gap, insight card bodies would need a challenge chip pattern similar to follow-up cards — e.g., a small "Challenge this →" chip at the bottom of the insight text, unconditionally interactive like `FollowUpChip`. This would require:

1. Adding a challenge chip to `InsightRenderer` (not `isFollowUp` branch)
2. Wiring it to `injectText("Challenge this insight: " + insightText)` or similar
3. Using `onPointerDownCapture` + `markEventAsHandled` (same pattern as `FollowUpChip`)

### Gap 4 (Vision): `ChallengeRenderer` is Passive

`src/components/canvas/card-renderers/challenge-renderer.tsx` renders a `CHALLENGE`-labeled card with title and `markdownContent`. The body has `pointerEvents: "none"` — it is purely a display card. To make challenges actionable:

- The challenge card should show the challenge text **and** response chips (e.g., "I agree", "Explain further", "Show the data")
- These chips would use the same `FollowUpChip` pattern and `injectText` to continue the conversation

---

## Acceptance Criteria

### Immediate (this fix)
- [ ] `FollowUpChip` follow-up question chips are clickable **without selecting the card first** → chat panel opens, input prefilled with question
- [ ] `ToolbarBtn` refresh/action buttons are clickable on **selected** cards → action fires
- [ ] `sql-renderer.tsx` Run button is clickable on selected SQL cards → `emitCanvasEvent("run-sql", id)` fires → `handleRefreshCard` executes
- [ ] First click on an unselected card → selects only (no accidental toolbar action, chips still work)
- [ ] Clicking outside a selected card → deselects normally
- [ ] Other card types (text, chart, metric) still select and drag normally — no regression
- [ ] No console errors on pointer interactions

### Follow-up (vision completeness)
- [ ] "Ask about this" toolbar action opens sidebar chat with card context **without navigating away** from canvas
- [ ] Regular insight card bodies have a challenge chip or question affordance that is first-click interactive
- [ ] `ChallengeRenderer` has response chips to continue the challenge conversation
- [ ] `table-renderer.tsx` pagination hardened with `onPointerDownCapture`

---

## Success Metrics

- Zero "button click lost" reports on canvas insight/SQL cards after this fix
- Solution doc captures the capture-phase insight and `useInteractiveTldrawButton` pattern
- Follow-up chips work on first click (no select-first friction)

---

## Dependencies & Risks

**Risk: `useEditor()` hook in `sql-renderer.tsx`**
The Run button fix requires adding `useEditor()` to `sql-renderer.tsx`. This hook requires the component to be rendered within tldraw's React context — which is guaranteed since `sql-renderer.tsx` is only rendered inside `card-shape-util.tsx`'s `component()` method. No risk.

**Risk: `stopPropagation()` in capture phase**
`e.stopPropagation()` in a capture handler stops propagation down (to children) and up (to ancestors). Our buttons are leaf elements with no children that need the event, so stopping propagation down is safe. The implication is that tldraw's higher-level event wrappers above `tl-canvas` won't see the event, but those don't affect shape selection behavior. No regression risk.

**Risk: `useInteractiveTldrawButton` hook — Rules of Hooks**
The hook calls `useEditor()` unconditionally. It must be called at the component function top level, not inside conditionals or loops. This is standard React hooks discipline. If the Run button renders inside a `map()`, extract it to a named component first.

**Risk: Fast double-click / touch race on FollowUpChip**
`FollowUpChip` is unconditionally interactive. If the user double-clicks rapidly, both the `onPointerDownCapture` (which marks event as handled) and the `onClick` fire normally — no race condition, since `markEventAsHandled` is synchronous. On touch devices, pointer events fire before touch events, so the capture-phase approach is equally effective on mobile.

---

## Files Changed

| File | Component | Change |
|------|-----------|--------|
| `src/components/canvas/card-renderers/insight-renderer.tsx` | `FollowUpChip` (line 150) | ✅ `onPointerDown` → `onPointerDownCapture` |
| `src/components/canvas/card-renderers/shared.tsx` | `ToolbarBtn` (line 496) | ✅ `onPointerDown` → `onPointerDownCapture` |
| `src/components/canvas/card-renderers/sql-renderer.tsx` | Run button (line 73) | ❌ Needs same fix + `useEditor()` |
| `docs/solutions/ui-bugs/tldraw-interactive-html-buttons-not-clickable.md` | — | ✅ Updated with capture phase explanation |

### Optional (recommended follow-up)

| File | Change |
|------|--------|
| New: `src/components/canvas/use-interactive-tldraw-button.ts` | Extract the 3-line boilerplate into a reusable hook |
| `src/components/canvas/use-canvas-actions.ts` | `handleAskAboutThis`: inject into sidebar instead of `router.push` |
| `src/components/canvas/card-renderers/insight-renderer.tsx` | Add challenge chip to insight card body (not follow-up branch) |
| `src/components/canvas/card-renderers/challenge-renderer.tsx` | Add response chips (`FollowUpChip`-style) to challenge card bodies |
| `src/components/canvas/card-renderers/table-renderer.tsx` | Harden pagination buttons with `onPointerDownCapture` |

---

## References & Research

### Internal References

- Solution doc: `docs/solutions/ui-bugs/tldraw-interactive-html-buttons-not-clickable.md`
- Three-zone pointer events: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
- Canvas shape setup: `docs/solutions/design-patterns/tldraw-custom-shapes-canvas-rendering.md`
- Follow-up chip flow: `src/components/chat/chat-panel-provider.tsx` (`injectText`, line 123)
- Event bridge: `src/components/canvas/canvas-events.ts`
- Ask-about handler: `src/components/canvas/use-canvas-actions.ts` (line 377–412, `handleAskAboutThis`)
- Shape util pointer gate: `src/components/canvas/shapes/card-shape-util.tsx:158`
- Canvas setup: `src/components/canvas/tldraw-canvas.tsx`
- CLAUDE.md memory: tldraw v4 three-zone pointer events pattern

### Iteration History

- **Iteration 1:** Added `pointer-events: all` + `nodrag` to interactive zones — partial fix, `setPointerCapture` still fired
- **Iteration 2:** Added `onPointerDown` + `markEventAsHandled` — failed because bubble phase fires after tldraw already set pointer capture
- **Iteration 3 (this fix):** Changed to `onPointerDownCapture` — fires during native capture phase before tldraw's bubble handler

### CSS pointer-events Reference

Per CSS Pointer Events Level 1 spec:
> "An element with pointer-events: none is never the target of pointer events; however, pointer events may target its descendant elements if those descendants have pointer-events set to some other value."

This means `FollowUpChip` containers with `pointer-events: all` inside an `HTMLContainer` with `pointer-events: none` **do** receive events. The tldraw capture-phase fix is the only required mechanism for chips to be first-click interactive.
