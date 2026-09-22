---
title: "feat: Deck Processing Cinematic Overlay"
type: feat
date: 2026-03-16
brainstorm: docs/brainstorms/2026-03-16-deck-processing-wait-state-brainstorm.md
---

# feat: Deck Processing Cinematic Overlay

## Overview

Replace the bare `+ Processing...` button-label badge with an immersive full-screen cinematic overlay that appears on the board detail page while a deck's slides are being processed. The overlay shows a large SVG arc progress ring, a flip-animated slide counter, the deck name, and a live stage label — all driven by the real progress data already emitted by `deck-to-board-stream.ts`. A "Run in background" action lets users dismiss the overlay and return to the board-building view.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                                                                 │
│                    ┌─────────────────┐                         │
│                  ╭─╯                 ╰─╮                       │
│                ╭─╯                     ╰─╮                     │
│               ─╯                         ╰─                    │
│               │       4 / 12             │                     │
│               ─╮                         ╭─                    │
│                ╰─╮                     ╭─╯                     │
│                  ╰─╮                 ╭─╯                       │
│                    └─────────────────┘                         │
│                                                                 │
│                         DecW2Review                            │
│                   Generating queries...                        │
│                                                                 │
│                    Run in background ↗                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Problem Statement / Motivation

Processing a deck takes 10–30 seconds. The only current feedback is a small inline text change (`+ Processing...` → `New Board`) on the index page, which disappears immediately when navigation fires. On the board detail page, there's only a 2px progress bar at the top of `document-view.tsx`. Users have no satisfying, attention-worthy signal that real work is happening — and nothing to watch during the wait.

The `deck-to-board-stream.ts` singleton already tracks `completedSlides`, `totalSlides`, and per-slide stages (`extracting → sql → analyzing → complete`). We can surface this data in a cinematic overlay that makes the wait feel earned.

---

## Proposed Solution

### New component: `src/components/deck/deck-processing-overlay.tsx`

A full-screen overlay that:

1. **Mounts** when `ActivePdfStream.status === "uploading" || "processing"` for the current `boardId`
2. **Shows** an SVG arc progress ring (200px), a flip-animated counter, deck name, and stage copy
3. **Dismisses** automatically with a brief success state when `status === "done"`
4. **Minimizes** to the existing topbar badge when the user taps "Run in background ↗"

### Mounting: `src/components/board/canvas-page.tsx`

The component renders at the board detail level — after navigation from the index. `canvas-page.tsx` already subscribes to `deck-to-board-stream.ts` and passes `streamState` as a prop to `DocumentView`. We add `<DeckProcessingOverlay boardId={boardId} deckName={board.name} />` here.

---

## Technical Considerations

### SVG Progress Ring

```tsx
const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 565.5

const offset = CIRCUMFERENCE * (1 - completedSlides / totalSlides);

<svg width="200" height="200" viewBox="0 0 200 200">
  {/* Track */}
  <circle
    cx="100" cy="100" r={RADIUS}
    fill="none"
    stroke="var(--border)"
    strokeWidth="2"
  />
  {/* Arc fill — starts at 12 o'clock (-90deg rotate) */}
  <circle
    cx="100" cy="100" r={RADIUS}
    fill="none"
    stroke="var(--foreground)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeDasharray={CIRCUMFERENCE}
    strokeDashoffset={offset}
    style={{
      transform: "rotate(-90deg)",
      transformOrigin: "100px 100px",
      transition: "stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)",
    }}
  />
</svg>
```

- Indeterminate state (status = `"uploading"`, no slide counts): rotate the arc continuously with a CSS keyframe spin.
- Final state (all slides done): full circle → brief scale pulse (1 → 1.05 → 1 at 300ms).

### Counter Flip Animation

Each time `completedSlides` increments, the outgoing number slides up and out while the incoming slides up and in:

```css
@keyframes flip-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-24px); }
}
@keyframes flip-in {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Use a `key={completedSlides}` on the counter span so React remounts the element, restarting the animation cleanly.

### Overlay Entrance / Exit

Follow the Pattern B convention from `search-modal.tsx` (separated backdrop + content divs):

```tsx
{/* Backdrop */}
<div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm" />

{/* Content */}
<div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6">
  {/* SVG ring, counter, name, stage, dismiss button */}
</div>
```

- **Entrance:** `opacity 0 → 1` + `scale 0.97 → 1` over `300ms cubic-bezier(0.16, 1, 0.3, 1)`
- **Exit:** `opacity 1 → 0` + `scale 1 → 0.97` over `200ms ease-in`

### State Machine Coverage

| `ActivePdfStream.status` | Overlay behavior |
|--------------------------|-----------------|
| `null` (no stream) | Hidden |
| `"uploading"` | Visible — indeterminate ring spin, no counter, "Uploading..." stage text |
| `"processing"` | Visible — arc fills, counter flips, live stage text |
| `"done"` | Success state: ring completes → pulse → overlay fades out (after 800ms) |
| `"error"` | Overlay shows error copy, "Dismiss" button. No auto-dismiss. |

### Stage Label Copy

```ts
const STAGE_COPY: Record<string, string> = {
  extracting: "Extracting slide content...",
  sql:        "Generating queries...",
  analyzing:  "Running analysis...",
  complete:   "Slide ready",
};
```

The current stage comes from the most recent `slide_complete` event's `stage` field (already tracked in `use-deck-upload-to-board.ts`). Since `ActivePdfStream` doesn't carry per-slide stage detail, we track the most recently seen stage in local overlay state via the stream subscriber.

**Alternative:** Extend `ActivePdfStream` in `deck-to-board-stream.ts` to include `currentStage?: string` — cleaner, no local tracking needed. Preferred.

### Minimize / "Run in background"

A `minimized: boolean` local state flag. When `true`:
- The overlay is `display: none` (not unmounted — preserves stream subscription)
- The topbar badge continues to show the current `completedSlides / totalSlides` fraction
- When `status` transitions to `done`, the overlay shows the success state briefly even if minimized (un-minimizes for the completion moment), then auto-dismisses

### Pointer Events

The overlay sits on top of tldraw canvas. Use `pointer-events: all` on the content div and `stopPropagation()` on all buttons to prevent click-through. The backdrop `pointer-events: none` so tldraw receives no accidental events if the backdrop doesn't cover the full canvas (it will, but belt-and-suspenders).

### Monochrome Constraint

Strictly use CSS variable tokens:
- Ring track: `var(--border)`
- Ring fill: `var(--foreground)`
- Counter: `var(--foreground)` (large, bold)
- Deck name: `var(--foreground)` (medium weight)
- Stage text: `var(--muted-foreground)` (small)
- Backdrop: `bg-background/95 backdrop-blur-sm`
- Dismiss button: ghost variant, `text-muted-foreground`

No Tailwind arbitrary values with CSS variables — use `style={{}}` for all dynamic SVG colors.

---

## Acceptance Criteria

- [ ] A full-screen overlay appears automatically when a deck upload starts on the board detail page
- [ ] The SVG arc ring fills proportionally as `completedSlides / totalSlides` increases (smooth transition)
- [ ] Counter inside the ring shows `N / M` and flips (vertical slide animation) on each increment
- [ ] Stage label text updates on each slide completion with the correct copy
- [ ] Indeterminate spin state during `"uploading"` (before slide count is known)
- [ ] "Run in background ↗" button dismisses the overlay without cancelling processing
- [ ] After dismissal, the topbar badge (existing `+ Processing...`) continues to reflect progress
- [ ] When all slides complete, a success state appears briefly (✓ + pulse) then overlay auto-dismisses
- [ ] Error state shows the error message and a "Dismiss" button — no auto-dismiss
- [ ] Overlay is strictly monochrome (no color tokens, no hardcoded hex values)
- [ ] All interactive elements use `stopPropagation` to prevent canvas pointer bleed-through
- [ ] No TypeScript errors; no ESLint warnings
- [ ] Overlay does not break when navigating to a board that has already finished processing (stream is `null` or `done`)

---

## Dependencies & Risks

| Item | Notes |
|------|-------|
| `deck-to-board-stream.ts` | May need a `currentStage` field added to `"processing"` variant — minor type change |
| `canvas-page.tsx` | Mount point — need to confirm board name is available at render time |
| Existing 2px progress bar in `document-view.tsx` | Should be hidden/removed when the overlay is active to avoid redundancy |
| Stream survives navigation | Confirmed via `navigatedRef` guard in `use-deck-upload-to-board.ts` |
| Multiple decks processing simultaneously | Out of scope — singleton is single-board by design |

---

## Files to Create / Modify

| Action | File |
|--------|------|
| **Create** | `src/components/deck/deck-processing-overlay.tsx` |
| **Modify** | `src/lib/deck-to-board-stream.ts` — add `currentStage?: string` to `"processing"` variant |
| **Modify** | `src/hooks/use-deck-upload-to-board.ts` — set `currentStage` on each `progress` event |
| **Modify** | `src/components/board/canvas-page.tsx` — mount `<DeckProcessingOverlay />` |
| **Modify** | `src/components/board/document-view.tsx` — hide the 2px progress bar when overlay is active |

---

## References

- Brainstorm: `docs/brainstorms/2026-03-16-deck-processing-wait-state-brainstorm.md`
- Stream singleton: `src/lib/deck-to-board-stream.ts`
- Upload hook: `src/hooks/use-deck-upload-to-board.ts`
- Mount point: `src/components/board/canvas-page.tsx`
- Existing progress bar: `src/components/board/document-view.tsx:396–410`
- Overlay DOM pattern reference: `src/components/chat/search-modal.tsx:143–148`
- Animation easing guide: `docs/solutions/workflow-guides/ui-motion-skills-audit-and-animation-workflow.md`
- Canvas overlay pattern: `docs/solutions/design-patterns/smartstack-insight-inbox-canvas-overlay.md`
- Pointer events: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
