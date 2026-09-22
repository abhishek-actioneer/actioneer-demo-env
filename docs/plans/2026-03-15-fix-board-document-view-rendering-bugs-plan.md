---
title: "fix: Board document view only shows 1 section + chat broken"
type: fix
date: 2026-03-15
---

# fix: Board document view only shows 1 section + chat broken

## Problem Statement

Two bugs in the board's document view after creating a board from a PDF deck:

1. **Only 1 section renders** in Board view despite all slides being extracted correctly. Canvas view shows all sections (confirmed: "17 cards" in the store).
2. **Side-chat doesn't work** in Board (document) view, but works fine in Canvas view.

## Root Cause Analysis

### Bug 1 — Stale `sectionOrderRef` in `document-view.tsx`

`sectionOrder` (the list used to render sections) is derived from `sectionOrderRef.current`. The ref is updated in `useEffect`, which runs **after the render**. So in the render that follows a `setLiveSections(...)` call with new sections, `sectionOrder` still has the **previous** value — it's always one render cycle behind.

**The exact sequence:**

```
Render 1 (mount): liveSections=[], sectionOrderRef=[] → sectionOrder=[] → renders nothing
  → initial useEffect → setLiveSections([s1])

Render 2: liveSections=[s1], render-body sets sectionOrderRef=[s1.id] → sectionOrder=[s1.id] → renders s1 ✓
  → sectionOrder useEffect fires → sectionOrderRef=[s1.id] (no change)

Stream delivers s2, s3, ..., sN → setLiveSections([s1,...,sN])

Render 3: liveSections=[s1...sN], render-body SKIPS (ref already non-empty)
  → sectionOrder = sectionOrderRef.current = [s1.id] ← STALE (only s1!)
  → renders only s1 ✗
  → useEffect fires AFTER: sectionOrderRef=[s1.id,...,sN.id] but no re-render triggered
```

Only the NEXT unrelated state change would trigger a re-render with the updated ref. After the stream ends, `streamState` transitions to `null` — triggering the "done" detection effect only if `streamState` was previously "processing" in this component's lifecycle. If React batches stream events, the component may see `null` on first render (never saw "processing"), so the final re-read doesn't fire either.

**Stale ref code in `document-view.tsx` (lines 72–90):**

```typescript
// BUG: this only updates AFTER render — doesn't trigger re-render
const sectionOrderRef = useRef<string[]>([]);
if (liveSections.length > 0 && sectionOrderRef.current.length === 0) {
  sectionOrderRef.current = liveSections.map((s) => s.id); // fires once only
}
useEffect(() => {
  if (liveSections.length > 0) {
    sectionOrderRef.current = liveSections.map((s) => s.id); // after render, no re-render
  }
}, [liveSections]);

const sectionOrder = sectionOrderRef.current; // always stale on the first read after sections grow
```

### Bug 2 — Chat not working in Board (document) view

The chat sidebar is a layout-level component wired through `ChatPanelProvider`. In Canvas mode, the tldraw canvas and the right-side chat panel both render correctly. In Board (document) mode, `DocumentView` renders without setting any entity context via `useChatPanel()`, so the sidebar chat may be missing context or disconnected from the board's page context.

Needs targeted investigation: check whether `setEntity()` from `useChatPanel()` is called by the board page (equivalent to how segment/metric detail pages inject context) and whether the chat input submission works at all.

## Proposed Fix

### Fix 1 — Derive `sectionOrder` from state, not a stale ref

Replace `sectionOrderRef`-as-source-of-truth with a `useMemo` that derives the list directly from `liveSections` state. The ref is kept only for its original purpose: accumulating section IDs to render deleted-section ghost placeholders.

**`src/components/board/document-view.tsx`**

```typescript
// BEFORE (stale ref approach):
const sectionOrderRef = useRef<string[]>([]);
if (liveSections.length > 0 && sectionOrderRef.current.length === 0) {
  sectionOrderRef.current = liveSections.map((s) => s.id);
}
useEffect(() => {
  if (liveSections.length > 0) {
    sectionOrderRef.current = liveSections.map((s) => s.id);
  }
}, [liveSections]);
const sectionOrder = sectionOrderRef.current;

// AFTER (derive from state — always current, triggers re-render):
const sectionOrderRef = useRef<string[]>([]);
// Accumulate all ever-seen IDs (for deleted-section placeholder preservation)
useEffect(() => {
  const known = new Set(sectionOrderRef.current);
  const toAdd = liveSections.map((s) => s.id).filter((id) => !known.has(id));
  if (toAdd.length > 0) {
    sectionOrderRef.current = [...sectionOrderRef.current, ...toAdd];
  }
}, [liveSections]);

// Derived from state — always current. Appends any ref-only IDs for deleted placeholders.
const sectionOrder = useMemo(() => {
  const liveSet = new Set(liveSections.map((s) => s.id));
  const deletedPlaceholders = sectionOrderRef.current.filter((id) => !liveSet.has(id));
  return [...liveSections.map((s) => s.id), ...deletedPlaceholders];
}, [liveSections]);
```

**Key properties of this fix:**
- `sectionOrder` is now a `useMemo` derived from `liveSections` state → always current
- New sections appear immediately when `setLiveSections(...)` fires
- Deleted-section ghost placeholders still work: ref accumulates IDs, deleted ones stay in the ref but not `liveSections`, so they appear at the end as placeholders
- Removes the "render-body ref mutation" (side effect in render body is technically a React violation)

### Fix 2 — Chat panel context for Board view (investigate + wire)

1. Check `canvas-page.tsx` — does it call `setEntity()` from `useChatPanel()` when in document mode? Likely not.
2. Compare with `src/app/segments/[id]/page.tsx` (or similar detail page) to see how `setEntity()` is wired
3. In `canvas-page.tsx` or `DocumentView`, call `setEntity()` with the board as context so the chat sidebar chat knows what board it's on
4. Verify chat input submission and response streaming work once context is injected

## Acceptance Criteria

- [ ] Board view renders all sections from a PDF-generated board (same count as Canvas view)
- [ ] Switching from Canvas → Board view shows all sections immediately
- [ ] Loading a board page directly (no stream active) renders all sections on mount
- [ ] Deleted-section ghost placeholders still render after deleting a section
- [ ] Side-chat in Board view responds to questions (sends/receives messages)
- [ ] No regression in Canvas view behavior

## Files to Change

| File | Change |
|------|--------|
| `src/components/board/document-view.tsx` | Fix `sectionOrder`: derive from `liveSections` useMemo + accumulate ref for placeholders (Bug 1) |
| `src/app/canvas/[id]/page.tsx` or `src/components/canvas/canvas-page.tsx` | Wire `setEntity()` for board context in document mode (Bug 2, after investigation) |

## References

- Root cause in: `src/components/board/document-view.tsx:72–90`
- Stream state subscription: `src/components/canvas/canvas-page.tsx:45–60`
- Chat panel pattern: `src/hooks/use-chat-panel.ts`, `src/app/segments/[id]/page.tsx`
- Brainstorm: `docs/brainstorms/2026-03-15-board-from-pdf-deck-brainstorm.md`
