# Deck Processing Wait State — Cinematic Full-Screen Overlay

**Date:** 2026-03-16
**Status:** Brainstorm complete, ready for planning
**Related:** `src/app/canvas/page.tsx`, `src/lib/deck-to-board-stream.ts`, `src/hooks/use-deck-upload-to-board.ts`

---

## What We're Building

A full-screen cinematic overlay that appears while a deck is being processed (10–30 seconds). Currently the only signal is a plain `+ Processing...` badge in the topbar. We want an immersive, satisfying wait experience that uses the **real progress data already available** (`completedSlides / totalSlides`, stage labels) to show honest progress rather than fake animation.

---

## Context: What Exists Today

The processing pipeline emits rich real-time data via `deck-to-board-stream.ts`:
- `status: "uploading" | "processing" | "done" | "error"`
- `completedSlides: number` / `totalSlides: number`
- Stage per slide: `extracting → sql → analyzing → complete`

This data is already consumed by `use-deck-upload-to-board.ts` and `document-view.tsx` (which shows a progress bar and incremental skeletons). But the topbar badge ignores all of it.

---

## What We're Building

### Core Component: `<DeckProcessingOverlay />`

A full-screen modal/overlay that opens automatically when processing begins and dismisses when done.

**Layout:**
- Dark backdrop (matches the existing black canvas background)
- Centered content column:
  1. Large circular SVG progress ring (200px) — arc fills proportionally as slides complete
  2. Counter inside ring: `4 / 12` in a large monospace numeral
  3. Deck name below in a clean display typeface
  4. Stage label: `"Analyzing slide 4 · writing analysis..."` — updates per slide
  5. Thin horizontal divider
  6. Minimize button: `"Run in background ↗"` — collapses back to the topbar badge without cancelling

**Animations:**
- **Ring fill:** SVG `stroke-dashoffset` animates as `completedSlides` increments. Uses `transition: stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1)`.
- **Counter:** Each new number does a vertical flip/roll using `@keyframes` — old number slides up and out, new slides up and in.
- **Stage text:** Fades out/in on stage change (`opacity 200ms ease`).
- **Entrance:** Overlay fades in with `opacity 0 → 1` + light scale `0.97 → 1` over 300ms.
- **Completion:** When all slides done, ring pulses once (scale 1.05 → 1), counter shows `✓`, then overlay fades out and navigates/stays on board.

---

## Why This Approach

**Real progress, not fake animation.** The `deck-to-board-stream.ts` singleton already has `completedSlides / totalSlides` — we're wiring it to a visual that makes users feel like the wait is earned and transparent.

**Cinematic but grounded.** A centered arc is premium and minimal without being cold. The counter and stage copy ground the abstraction in real work happening.

**Non-blocking escape.** The "Run in background" affordance lets power users dismiss and keep working. The topbar badge then serves as the persistent indicator.

**Monochrome.** Stays within the existing design language — no color, uses `--foreground`, `--muted-foreground`, `--border` tokens.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Overlay vs. inline badge | Full-screen overlay | 10–30s is too long for just a badge; users need something to watch |
| Progress: fake vs. real | Real (`completedSlides / totalSlides`) | Data exists; real progress is more trustworthy |
| Ring vs. linear bar | SVG arc ring | More spatial, works better as a focal point in a centered layout |
| Blocking vs. dismissible | Dismissible ("Run in background") | Don't force users to watch; let them choose |
| Monospace vs. display counter | Monospace + flip animation | The number changing is the key moment; make it satisfying |
| Auto-dismiss on completion | Yes, with brief success state | Short `✓` moment before navigating feels complete |

---

## Implementation Sketch

### New component
`src/components/deck/deck-processing-overlay.tsx`

```tsx
// Subscribes to deck-to-board-stream singleton
// Shows when status === "uploading" || "processing"
// Dismisses when status === "done"
// "Run in background" sets a local `minimized` flag
```

### Mount point
`src/app/canvas/page.tsx` — render `<DeckProcessingOverlay />` alongside the existing board list. The overlay manages its own visibility via the stream singleton.

### SVG ring math
```
circumference = 2π × r  (r ≈ 90)
strokeDashoffset = circumference × (1 - completedSlides / totalSlides)
```

### Stage label copy
| Stage | Display copy |
|-------|-------------|
| `extracting` | `Extracting slide content...` |
| `sql` | `Generating queries...` |
| `analyzing` | `Running analysis...` |
| `complete` | `Slide ready` |

---

## Open Questions

1. **What happens if the user navigates away?** The stream singleton survives navigation — should the overlay re-appear on the canvas page, or only show on the page where upload started?
2. **Multiple decks processing simultaneously?** Current stream singleton is single-board. Overlay assumes one at a time — fine for now.
3. **Error state in overlay?** Show error inline (red ring + error message) or dismiss and surface error in the board list?
4. **Mobile/narrow viewport?** Ring might not fit well below ~400px — could fall back to a linear bar layout.

---

## Out of Scope

- Slide preview thumbnails inside the overlay (would require server changes)
- Cancel/abort from the overlay (upload can't be cancelled mid-stream currently)
- Sound / haptic feedback
