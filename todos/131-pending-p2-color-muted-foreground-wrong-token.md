---
status: pending
priority: p2
issue_id: "131"
tags: [code-review, css, pattern, pr-48]
dependencies: []
---

# unified-chart.tsx uses --color-muted-foreground instead of --muted-foreground

## Problem Statement

CLAUDE.md states: "Use `--muted-foreground` (canonical shadcn token), NOT `--color-muted-foreground` (Tailwind bridge layer)."

`src/components/chart/unified-chart.tsx` uses the wrong token in two places for the axis-break SVG lines:

```tsx
// unified-chart.tsx:322–323
stroke="var(--color-muted-foreground)"
stroke="var(--color-muted-foreground)"
```

While `globals.css` creates a bridge alias (`--color-muted-foreground: var(--muted-foreground)`) that makes this work, it violates the established convention and will cause inconsistency if the bridge alias is ever removed.

## Findings

Source: Pattern Recognition Specialist.

- `unified-chart.tsx:322–323` — two occurrences of `--color-muted-foreground`
- `globals.css` — bridge alias exists, so this works but is non-canonical
- Pre-existing violations in `chart-core.tsx` (not introduced by this PR) — same pattern

## Proposed Solutions

**Option A (Trivial fix):**
Replace both occurrences:
```tsx
stroke="var(--muted-foreground)"
```

## Recommended Action

Option A — 2 string replacements.

## Technical Details

- **Affected files:** `src/components/chart/unified-chart.tsx:322–323`

## Acceptance Criteria

- [ ] Both occurrences replaced with `--muted-foreground`
- [ ] Axis break lines still render correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (pattern-recognition-specialist) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
