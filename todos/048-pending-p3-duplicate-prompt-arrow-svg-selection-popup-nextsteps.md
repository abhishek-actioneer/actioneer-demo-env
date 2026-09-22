---
status: pending
priority: p3
issue_id: "048"
tags: [code-review, quality, duplication, pr-28]
dependencies: []
---

# Duplicate "follow-up arrow" SVG in selection-popup.tsx and next-steps.tsx

## Problem Statement

The same conceptual "send/follow-up" arrow SVG appears independently in two files with slightly different sizes (14px vs 16px). `selection-popup.tsx` inlines it as an anonymous SVG; `next-steps.tsx` defines it as `PromptArrowIcon`. These should share a single source of truth.

## Findings

**File 1:** `src/components/chat/selection-popup.tsx` lines 110-124 (14px, anonymous inline SVG)
```tsx
<svg width="14" height="14" viewBox="0 0 24 24" ...>
  <polyline points="15 14 20 9 15 4" ... />
  <path d="M4 20v-7a4 4 0 0 1 4-4h12" ... />
</svg>
```

**File 2:** `src/components/chat/next-steps.tsx` lines 22-37 (16px, `PromptArrowIcon` component)
```tsx
function PromptArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" ...>
      <polyline points="15 14 20 9 15 4" ... />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" ... />
    </svg>
  );
}
```

## Proposed Solutions

### Option A: Export PromptArrowIcon from next-steps.tsx and import in selection-popup.tsx
Simplest — no new files, just import. Size difference would need resolution (14 vs 16px).

### Option B: Move to src/components/ui/icons.tsx
Create a shared icon file and import from both. Pass `size` as a prop.

**Recommended: Option A** for a demo/prototype app

## Acceptance Criteria

- [ ] Single definition of the follow-up arrow SVG
- [ ] Both components render correctly at their intended sizes
- [ ] No visual regression

## Work Log

- 2026-03-03: Identified during PR #28 code review (code-simplicity + pattern-recognition agents)
