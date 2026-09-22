# Canvas Smart Layout Design

**Date:** 2026-02-18
**Status:** Approved
**Goal:** Improve canvas experience — prevent overlapping cards, smart initial placement, preset resize sizes. Keep tldraw's freeform infinite canvas.

## Problem

- New cards sometimes overlap (pinned charts hardcode `{0,0}`)
- No collision prevention when dragging cards
- Free resize allows cards to shrink to unreadable sizes
- Cards don't cluster together naturally — large gaps between items

## Design

### 1. Preset Sizes

Cards snap to one of 3 preset sizes on resize release.

| Preset | Width | Height | Best for |
|--------|-------|--------|----------|
| Small | 360 | 200 | Insights, compact metrics |
| Medium | 450 | 340 | Charts, reports |
| Large | 640 | 460 | Expanded charts, detailed reports |

**Default sizes by type:**
- `chart` → Medium (450×340)
- `report` → Medium (450×340)
- `insight` → Small (360×200)

**Behavior:**
- Override `onResizeEnd` in `CanvasChartShapeUtil`
- Compute nearest preset by Euclidean distance from current dimensions
- Animate to target preset via `editor.animateShape()` (200ms)

### 2. Smart Initial Placement (Masonry Packing)

New cards pack tightly near existing cards using a bottom-left packing algorithm.

**Algorithm:**
1. Get bounding boxes of all existing shapes
2. Compute cluster bounds (bbox of all shapes + padding)
3. Generate candidate positions: right/bottom edges of each shape, below/right of cluster
4. Filter candidates that don't overlap any existing shape (with 30px gap)
5. Pick the valid candidate closest to cluster center
6. Fallback: place below the entire cluster, left-aligned

**Constants:**
- `GAP = 30` — minimum spacing between cards
- Padding per side during collision check: 15px (half of GAP)

**Replaces:** `findOpenSlot()` and its grid constants.

**Called from:**
- `pin-button.tsx` — when pinning a chart from chat
- `canvas-page.tsx handlePinInsight()` — when promoting an insight from SmartStack

### 3. Collision Nudging on Drop

When a user drops a card overlapping another, it auto-slides to the nearest non-overlapping position.

**Algorithm:**
1. On `onTranslateEnd`, get dropped shape's bounding box
2. Find all overlapping shapes (AABB intersection)
3. If no overlaps → done
4. Compute minimum translation vector (MTV) for each overlap
5. Sum MTVs + add GAP padding in displacement direction
6. Animate to resolved position (200ms)
7. Re-check once for new overlaps at resolved position
8. If still overlapping after 1 retry → use packing algorithm as fallback

**Rules:**
- Only the dropped card moves (no chain reactions)
- Multi-select: nudge each selected shape independently
- Max 1 retry before fallback

## Architecture

### New file: `src/lib/canvas-layout.ts`

Pure functions, no tldraw dependency:
- `findPackedPosition(existingBounds, newSize, gap)` → `{x, y}`
- `resolveCollision(shapeBounds, allBounds, gap)` → `{x, y}` or `null` if no overlap
- `snapToPreset(currentSize)` → `{width, height}`
- `PRESETS` — the 3 size tiers
- `GAP` — spacing constant

### Modified files

| File | Changes |
|------|---------|
| `canvas-page.tsx` | Replace `findOpenSlot()` with `findPackedPosition()`. Remove grid constants. |
| `chart-shape.tsx` | Add `onTranslateEnd` (collision nudging). Add `onResizeEnd` (preset snap). |
| `pin-button.tsx` | Use `findPackedPosition()` instead of `{x: 0, y: 0}`. |

### Unchanged

- Card rendering / visual design
- Canvas store (localStorage persistence)
- Event bridge (canvas-events.ts)
- SmartStack behavior
- Camera persistence
- Dot grid background

### Removed

- `findOpenSlot()` function
- `GRID_COL_W`, `GRID_ROW_H`, `GRID_PAD` constants
