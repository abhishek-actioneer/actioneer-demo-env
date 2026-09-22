# Canvas Smart Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add masonry packing for initial card placement, collision nudging on drop, and preset size snapping to the tldraw canvas.

**Architecture:** Pure layout functions in `canvas-layout.ts` (no tldraw dependency), integrated via `onTranslateEnd`/`onResizeEnd` overrides in `CanvasChartShapeUtil`. Pin flows updated to use packing instead of grid slots.

**Tech Stack:** tldraw v4.3.x (BaseBoxShapeUtil, animateShape, EASINGS), TypeScript, Next.js

**Design doc:** `docs/plans/2026-02-18-canvas-smart-layout-design.md`

---

### Task 1: Create `canvas-layout.ts` with types and constants

**Files:**
- Create: `src/lib/canvas-layout.ts`

**Step 1: Create the file with types, constants, and `snapToPreset`**

```typescript
/* ── Canvas layout utilities (pure functions, no tldraw dependency) ── */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/* ── Preset sizes ── */
export const PRESETS: Size[] = [
  { width: 360, height: 200 },  // Small
  { width: 450, height: 340 },  // Medium
  { width: 640, height: 460 },  // Large
];

export const DEFAULT_SIZE: Record<string, Size> = {
  chart:   { width: 450, height: 340 },
  report:  { width: 450, height: 340 },
  insight: { width: 360, height: 200 },
};

export const GAP = 30;

/** Snap a size to the nearest preset by Euclidean distance. */
export function snapToPreset(current: Size): Size {
  let best = PRESETS[0];
  let bestDist = Infinity;
  for (const p of PRESETS) {
    const d = Math.hypot(current.width - p.width, current.height - p.height);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/sashank/Documents/glitchcraft/repositories/baby-sentinel && npx tsc --noEmit src/lib/canvas-layout.ts`

If tsc standalone doesn't work (module resolution), just run: `pnpm build` and check for errors in that file. Alternatively, open dev server and confirm no compile errors.

**Step 3: Commit**

```bash
git add src/lib/canvas-layout.ts
git commit -m "feat(canvas): add layout utilities with preset sizes and snapToPreset"
```

---

### Task 2: Add `findPackedPosition` to `canvas-layout.ts`

**Files:**
- Modify: `src/lib/canvas-layout.ts`

**Step 1: Add AABB overlap helper and `findPackedPosition`**

Append to `canvas-layout.ts`:

```typescript
/** Check if two rects overlap (with optional gap padding). */
function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/** Check if a candidate rect overlaps ANY existing rect. */
function overlapsAny(candidate: Rect, existing: Rect[], gap: number): boolean {
  return existing.some((r) => rectsOverlap(candidate, r, gap));
}

/**
 * Find a packed position for a new card near existing cards.
 * Tries right/bottom edges of each existing shape, then below/right of cluster.
 */
export function findPackedPosition(
  existingBounds: Rect[],
  newSize: Size,
  gap: number = GAP
): Point {
  // Empty canvas — place at top-left with padding
  if (existingBounds.length === 0) {
    return { x: gap, y: gap };
  }

  // Compute cluster bounding box
  let clusterLeft = Infinity, clusterTop = Infinity;
  let clusterRight = -Infinity, clusterBottom = -Infinity;
  for (const r of existingBounds) {
    clusterLeft = Math.min(clusterLeft, r.x);
    clusterTop = Math.min(clusterTop, r.y);
    clusterRight = Math.max(clusterRight, r.x + r.width);
    clusterBottom = Math.max(clusterBottom, r.y + r.height);
  }
  const clusterCenterX = (clusterLeft + clusterRight) / 2;
  const clusterCenterY = (clusterTop + clusterBottom) / 2;

  // Generate candidate positions
  const candidates: Point[] = [];

  for (const r of existingBounds) {
    // Right of this shape (aligned to its top)
    candidates.push({ x: r.x + r.width + gap, y: r.y });
    // Below this shape (aligned to its left)
    candidates.push({ x: r.x, y: r.y + r.height + gap });
  }

  // Below the entire cluster (left-aligned)
  candidates.push({ x: clusterLeft, y: clusterBottom + gap });
  // Right of the entire cluster (top-aligned)
  candidates.push({ x: clusterRight + gap, y: clusterTop });

  // Filter valid candidates (no overlap) and pick closest to cluster center
  let bestPoint: Point | null = null;
  let bestDist = Infinity;

  for (const pt of candidates) {
    const candidateRect: Rect = { ...pt, ...newSize };
    if (!overlapsAny(candidateRect, existingBounds, gap)) {
      const dist = Math.hypot(
        pt.x + newSize.width / 2 - clusterCenterX,
        pt.y + newSize.height / 2 - clusterCenterY
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = pt;
      }
    }
  }

  // Fallback: below the cluster, left-aligned
  return bestPoint ?? { x: clusterLeft, y: clusterBottom + gap };
}
```

**Step 2: Verify build**

Run: `pnpm build` — confirm no TypeScript errors.

**Step 3: Commit**

```bash
git add src/lib/canvas-layout.ts
git commit -m "feat(canvas): add findPackedPosition masonry packing algorithm"
```

---

### Task 3: Add `resolveCollision` to `canvas-layout.ts`

**Files:**
- Modify: `src/lib/canvas-layout.ts`

**Step 1: Add collision resolution function**

Append to `canvas-layout.ts`:

```typescript
/**
 * Resolve overlap for a dropped shape by computing minimum translation.
 * Returns new position, or null if no overlap exists.
 * Uses 1 retry with fallback to findPackedPosition.
 */
export function resolveCollision(
  shapeBounds: Rect,
  allBounds: Rect[],
  gap: number = GAP
): Point | null {
  // Filter out the shape itself (by position identity)
  const others = allBounds.filter(
    (r) =>
      !(r.x === shapeBounds.x && r.y === shapeBounds.y &&
        r.width === shapeBounds.width && r.height === shapeBounds.height)
  );

  const resolve = (bounds: Rect): Point | null => {
    const overlapping = others.filter((r) => rectsOverlap(bounds, r, 0));
    if (overlapping.length === 0) return null;

    // Compute combined minimum translation vector
    let dx = 0;
    let dy = 0;
    for (const other of overlapping) {
      // Four possible escape directions
      const pushLeft = other.x - (bounds.x + bounds.width) - gap;
      const pushRight = other.x + other.width + gap - bounds.x;
      const pushUp = other.y - (bounds.y + bounds.height) - gap;
      const pushDown = other.y + other.height + gap - bounds.y;

      // Pick the smallest absolute push in each axis
      const horizontal = Math.abs(pushLeft) < Math.abs(pushRight) ? pushLeft : pushRight;
      const vertical = Math.abs(pushUp) < Math.abs(pushDown) ? pushUp : pushDown;

      // Use the axis with the smaller displacement
      if (Math.abs(horizontal) < Math.abs(vertical)) {
        dx += horizontal;
      } else {
        dy += vertical;
      }
    }

    return { x: bounds.x + dx, y: bounds.y + dy };
  };

  // First attempt
  const firstResult = resolve(shapeBounds);
  if (!firstResult) return null;

  // Check if resolved position is also clear
  const resolvedBounds: Rect = {
    x: firstResult.x,
    y: firstResult.y,
    width: shapeBounds.width,
    height: shapeBounds.height,
  };

  const secondResult = resolve(resolvedBounds);
  if (!secondResult) return firstResult; // First resolution worked

  // Still overlapping after retry — use packing as fallback
  const packed = findPackedPosition(others, {
    width: shapeBounds.width,
    height: shapeBounds.height,
  }, gap);
  return packed;
}
```

**Step 2: Verify build**

Run: `pnpm build` — confirm no TypeScript errors.

**Step 3: Commit**

```bash
git add src/lib/canvas-layout.ts
git commit -m "feat(canvas): add resolveCollision with MTV nudging and packing fallback"
```

---

### Task 4: Add `onResizeEnd` preset snap to `CanvasChartShapeUtil`

**Files:**
- Modify: `src/components/canvas/chart-shape.tsx:199-218`

**Step 1: Import layout utilities and EASINGS**

At the top of `chart-shape.tsx`, add to the tldraw import:

```typescript
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  EASINGS,
} from "tldraw";
```

Add new import:

```typescript
import { snapToPreset } from "@/lib/canvas-layout";
```

**Step 2: Add `getInterpolatedProps` and `onResizeEnd` to `CanvasChartShapeUtil`**

Inside the class (after `canResize()`), add:

```typescript
  override getInterpolatedProps(
    startShape: ICanvasChartShape,
    endShape: ICanvasChartShape,
    t: number
  ): ICanvasChartShape["props"] {
    return {
      ...endShape.props,
      w: startShape.props.w + (endShape.props.w - startShape.props.w) * t,
      h: startShape.props.h + (endShape.props.h - startShape.props.h) * t,
    };
  }

  override onResizeEnd(_initial: ICanvasChartShape, current: ICanvasChartShape) {
    const snapped = snapToPreset({ width: current.props.w, height: current.props.h });
    if (snapped.width === current.props.w && snapped.height === current.props.h) return;

    this.editor.animateShape(
      {
        id: current.id,
        type: current.type,
        props: { ...current.props, w: snapped.width, h: snapped.height },
      },
      { animation: { duration: 200, easing: EASINGS.easeOutCubic } }
    );
  }
```

**Step 3: Verify — start dev server, go to canvas, resize a card**

Run: `pnpm dev`

Manual test:
1. Navigate to `/canvas`
2. Select a chart card, drag its resize handle
3. Release — card should animate to nearest preset size (Small/Medium/Large)
4. Try resizing to various sizes and confirm it always snaps

**Step 4: Commit**

```bash
git add src/components/canvas/chart-shape.tsx src/lib/canvas-layout.ts
git commit -m "feat(canvas): add preset size snap on resize release"
```

---

### Task 5: Add `onTranslateEnd` collision nudge to `CanvasChartShapeUtil`

**Files:**
- Modify: `src/components/canvas/chart-shape.tsx`

**Step 1: Import `resolveCollision` and add `Rect` type import**

Add to the canvas-layout import:

```typescript
import { snapToPreset, resolveCollision, type Rect } from "@/lib/canvas-layout";
```

**Step 2: Add `onTranslateEnd` to `CanvasChartShapeUtil`**

Inside the class (after `onResizeEnd`), add:

```typescript
  override onTranslateEnd(_initial: ICanvasChartShape, current: ICanvasChartShape) {
    // Collect all other shape bounds
    const allShapes = this.editor
      .getCurrentPageShapes()
      .filter((s) => s.type === CHART_SHAPE_TYPE && s.id !== current.id) as unknown as ICanvasChartShape[];

    const allBounds: Rect[] = allShapes.map((s) => ({
      x: s.x,
      y: s.y,
      width: s.props.w,
      height: s.props.h,
    }));

    const shapeBounds: Rect = {
      x: current.x,
      y: current.y,
      width: current.props.w,
      height: current.props.h,
    };

    const resolved = resolveCollision(shapeBounds, allBounds);
    if (!resolved) return; // No overlap

    this.editor.animateShape(
      { id: current.id, type: current.type, x: resolved.x, y: resolved.y },
      { animation: { duration: 200, easing: EASINGS.easeOutCubic } }
    );
  }
```

**Step 3: Verify — drag a card on top of another**

Manual test:
1. Navigate to `/canvas`
2. Drag a card directly on top of another card
3. Release — the dropped card should slide to a non-overlapping position
4. Try dragging to a crowded area — should still resolve without overlap

**Step 4: Commit**

```bash
git add src/components/canvas/chart-shape.tsx
git commit -m "feat(canvas): add collision nudging on card drop"
```

---

### Task 6: Replace `findOpenSlot` with `findPackedPosition` in canvas-page.tsx

**Files:**
- Modify: `src/components/canvas/canvas-page.tsx:27-53` (remove `findOpenSlot` and grid constants)
- Modify: `src/components/canvas/canvas-page.tsx:444-479` (update `handlePinInsight`)

**Step 1: Add import for `findPackedPosition` and `DEFAULT_SIZE`**

Add near top of `canvas-page.tsx`:

```typescript
import { findPackedPosition, DEFAULT_SIZE, type Rect } from "@/lib/canvas-layout";
```

**Step 2: Remove `findOpenSlot` and grid constants**

Delete lines 27-53 (the `GRID_COL_W`, `GRID_ROW_H`, `GRID_PAD` constants and the entire `findOpenSlot` function).

**Step 3: Update `handlePinInsight` to use `findPackedPosition`**

Replace the slot-finding logic in `handlePinInsight` (around line 444-479 after the deletion shift). The new version:

```typescript
  const handlePinInsight = useCallback(
    (itemId: string) => {
      const editor = editorRef.current;
      const item = getCanvasItem(itemId);
      if (!editor || !item) return;

      const insightSize = DEFAULT_SIZE.insight;

      // Collect existing shape bounds for packing
      const existingShapes = editor.getCurrentPageShapes()
        .filter((s) => s.type === CHART_SHAPE_TYPE) as unknown as ICanvasChartShape[];
      const existingBounds: Rect[] = existingShapes.map((s) => ({
        x: s.x, y: s.y, width: s.props.w, height: s.props.h,
      }));

      const position = findPackedPosition(existingBounds, insightSize);

      // Update item position in store
      const updatedItem = {
        ...item,
        position,
        size: insightSize,
      };
      saveCanvasItem(updatedItem);

      // Create tldraw shape
      editor.createShape({
        type: CHART_SHAPE_TYPE,
        x: position.x,
        y: position.y,
        props: {
          w: insightSize.width,
          h: insightSize.height,
          canvasItemId: itemId,
        },
      });

      setSmartStackVersion((v) => v + 1);
      notifyCanvasChanged();
    },
    [notifyCanvasChanged]
  );
```

**Step 4: Verify — pin an insight from SmartStack**

Manual test:
1. Navigate to `/canvas`
2. In SmartStack (top-right), click "Pin" on an insight
3. The insight card should appear near the existing cards (packed tightly), not in a grid slot
4. Pin another — should pack next to the first, no overlap

**Step 5: Commit**

```bash
git add src/components/canvas/canvas-page.tsx
git commit -m "feat(canvas): replace findOpenSlot with masonry packing in handlePinInsight"
```

---

### Task 7: Update `pin-button.tsx` to use `findPackedPosition`

**Files:**
- Modify: `src/components/canvas/pin-button.tsx:36-48`

**Step 1: Add imports**

Add to `pin-button.tsx`:

```typescript
import { findPackedPosition, DEFAULT_SIZE, type Rect } from "@/lib/canvas-layout";
import { getAllCanvasItems } from "@/lib/canvas-store";
```

**Step 2: Replace hardcoded `{x: 0, y: 0}` with packed position**

In the `handlePin` function, replace the `CanvasItem` creation (around line 36-48):

```typescript
    // Compute packed position from existing canvas items
    const existingItems = getAllCanvasItems().filter(
      (i) => !(i.type === "insight" && !i.dismissed)
    );
    const existingBounds: Rect[] = existingItems.map((i) => ({
      x: i.position.x,
      y: i.position.y,
      width: i.size.width,
      height: i.size.height,
    }));
    const chartSize = DEFAULT_SIZE.chart;
    const position = findPackedPosition(existingBounds, chartSize);

    const item: CanvasItem = {
      id: crypto.randomUUID(),
      type: "chart",
      title: chartSpec.title || "Untitled Chart",
      pinnedAt: new Date().toISOString(),
      chartSpec,
      sql,
      data: chartSpec.data as Record<string, unknown>[],
      position,
      size: chartSize,
      sourceConversationId,
      lastRefreshed: new Date().toISOString(),
    };
```

**Step 3: Verify — pin a chart from chat**

Manual test:
1. Go to the main chat page, find a chart in a conversation
2. Click "Pin to Canvas"
3. Navigate to `/canvas`
4. The chart should appear packed near existing cards, NOT at position `{0, 0}`

**Step 4: Commit**

```bash
git add src/components/canvas/pin-button.tsx
git commit -m "feat(canvas): use packed position for pinned charts instead of {0,0}"
```

---

### Task 8: Remove exported `findOpenSlot` references and verify full build

**Files:**
- Modify: `src/components/canvas/canvas-page.tsx` (verify `findOpenSlot` export is gone)

**Step 1: Search for any remaining references to `findOpenSlot`**

Run: `grep -r "findOpenSlot" src/`

If any references remain, update them to use `findPackedPosition`.

**Step 2: Full build verification**

Run: `pnpm build`

Expected: Clean build with no errors.

**Step 3: Run lint**

Run: `pnpm lint`

Expected: No new lint errors.

**Step 4: Manual integration test**

Start dev server: `pnpm dev`

Test checklist:
- [ ] Canvas loads with existing cards (no regression)
- [ ] Resize a card → snaps to nearest preset (Small/Medium/Large)
- [ ] Drag a card onto another → dropped card nudges away
- [ ] Pin a chart from chat → appears packed near existing cards
- [ ] Pin an insight from SmartStack → appears packed, no overlap
- [ ] Camera zoom/pan still works
- [ ] SmartStack dismiss/ask still works

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(canvas): complete smart layout — packing, collision nudge, preset snap"
```
