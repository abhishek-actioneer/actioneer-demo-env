---
name: skeleton-count-always-zero-blank-sections
description: skeletonCount in document-view.tsx is always 0 after extraction because all sections are created upfront; per-section labeled skeletons never show
type: bug
status: pending
priority: p3
issue_id: "112"
tags: [code-review, deck, ux, skeleton]
---

## Problem Statement

`document-view.tsx` computes:
```typescript
const skeletonCount =
  isProcessing
    ? Math.max(0, streamState.totalSlides - streamState.completedSlides - sectionOrder.length)
    : 0;
```

With the new flow, `extraction_complete` creates **all** sections upfront, so `sectionOrder.length === totalSlides` immediately. This makes `skeletonCount = max(0, totalSlides - completedSlides - totalSlides) = max(0, -completedSlides) = 0` always.

The "skeleton rows" at the bottom of the section list never render. Individual sections that exist but have 0 cards (while waiting for `slide_complete`) show blank card areas — not the "Generating line chart for Daily Revenue..." labeled placeholders described in the plan.

**Why it matters for demo:** The Phase 1 UX story (labeled skeleton teaching users what will go where) is partially lost. Users see section titles with blank space below them while slides process, rather than informative placeholders.

## Findings

- `src/components/board/document-view.tsx:391-394` — `skeletonCount` formula subtracts `sectionOrder.length` which equals `totalSlides` after extraction
- `src/components/board/document-view.tsx:551-575` — skeleton rows at bottom of list never render (count = 0)
- `src/components/board/section-renderer.tsx` — receives `cards=[]` for sections with no cards yet; no streaming-aware skeleton inside it
- The full-page skeleton (line 468: `isProcessing && sectionOrder.length === 0`) does show labeled placeholders briefly, but transitions away once sections are created

## Proposed Solutions

### Option A — Pass `extractedSlides` to `SectionRenderer` and render per-section skeleton (Most complete)

In `document-view.tsx`, pass slide preview metadata to each section:
```typescript
const extractedSlides = isProcessing ? streamState.extractedSlides : undefined;

<SectionRenderer
  ...
  cards={cardsBySection.get(sectionId) ?? []}
  extractedSlidePreview={
    extractedSlides?.find(s => `${boardId}-section-${s.index}` === sectionId)
  }
/>
```

In `section-renderer.tsx`, when `cards.length === 0 && extractedSlidePreview`:
```tsx
<div className="rounded-lg border border-border/50 bg-muted/10 h-56 flex items-center justify-center animate-pulse">
  <div className="text-center">
    <p className="text-xs text-muted-foreground/70">
      Generating {preview.charts[0]?.chartType} chart
    </p>
    <p className="text-xs text-muted-foreground/50 mt-0.5">
      for "{preview.charts[0]?.metric}"
    </p>
  </div>
</div>
```

Pros: Matches plan exactly. Cons: Requires changes to `SectionRenderer` interface.

### Option B — Fix `skeletonCount` to not subtract `sectionOrder.length`

Change the formula to only use completed vs total:
```typescript
const skeletonCount = isProcessing
  ? Math.max(0, streamState.totalSlides - streamState.completedSlides)
  : 0;
```

But then skeleton rows would duplicate the sections already shown. This doesn't work cleanly.

### Option C — Accept current behavior (P3 deferral)

The full-page skeleton (briefly shown before sections are created) already shows labeled placeholders. After sections appear, blank card areas fill in progressively. Acceptable for demo — just less polished.

## Recommended Action

Option A if polish is needed for a specific demo. Option C if current behavior is acceptable — blank sections filling in is still functional and the brief full-page skeleton shows the structure. Defer unless a demo recording needs to capture Phase 1 specifically.

## Technical Details

- **Affected files:** `src/components/board/document-view.tsx:391`, `src/components/board/section-renderer.tsx`
- **Root cause:** `extraction_complete` creates all sections upfront, so `sectionOrder.length` immediately equals `totalSlides`, making the bottom-skeleton formula yield 0

## Acceptance Criteria (if implementing Option A)

- [ ] Sections with 0 cards show labeled skeleton with chart type + metric from extraction metadata
- [ ] Skeleton disappears when `slide_complete` populates the section with real cards
- [ ] `SectionRenderer` accepts optional `extractedSlidePreview` prop

## Work Log

- 2026-03-16: Identified in PR #44 code review
