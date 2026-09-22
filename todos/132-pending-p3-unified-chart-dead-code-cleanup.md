---
status: pending
priority: p3
issue_id: "132"
tags: [code-review, quality, cleanup, pr-48]
dependencies: []
---

# unified-chart.tsx: dead expandedOpen state, commented DataActionsTabs, dead import

## Problem Statement

`src/components/chart/unified-chart.tsx` has three dead code issues:

1. **`expandedOpen` state** (line 76) — initialised to `false`, `setExpandedOpen(true)` is never called anywhere in the file. The `ExpandedModal` at lines 421–428 can never open.

2. **Commented-out `DataActionsTabs` block** (lines 277–287) — alternative implementation with a "uncomment to try" comment. Decision has been made (dropdown wins). Dead code.

3. **`DataActionsTabs` import** (line 13) — only referenced inside the commented-out block. Dead import flagged by tree-shakers.

Total dead code: ~20 lines.

## Findings

Source: Code Simplicity reviewer + TypeScript reviewer + Pattern Reviewer.

- `unified-chart.tsx:76` — `const [expandedOpen, setExpandedOpen] = useState(false)`
- `unified-chart.tsx:421–428` — `<ExpandedModal open={expandedOpen} ...>` (unreachable)
- `unified-chart.tsx:277–287` — commented-out DataActionsTabs alternative
- `unified-chart.tsx:13` — `import { DataActionsTabs, DataActionsDropdown, ... }`

## Proposed Solutions

Delete:
1. `expandedOpen` state declaration
2. `ExpandedModal` render block (lines 421–428)
3. Commented-out `dataActions` block (lines 277–287)
4. `DataActionsTabs` from the import statement

If "expand to modal" is a desired future feature, implement it with the trigger button at the same time, not as dead infrastructure.

## Technical Details

- **Affected files:** `src/components/chart/unified-chart.tsx`
- LOC reduction: ~20 lines

## Acceptance Criteria

- [ ] No unreachable modal infrastructure in unified-chart.tsx
- [ ] No commented-out code blocks
- [ ] No dead imports
- [ ] Component still renders correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (code-simplicity-reviewer) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
