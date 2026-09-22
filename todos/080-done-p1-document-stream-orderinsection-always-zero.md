---
status: done
priority: p1
issue_id: "080"
tags: [code-review, data-integrity, board, pr-41]
dependencies: []
---

# useDocumentStream always starts orderInSection at 0, ignoring existing cards

## Problem Statement

In `src/hooks/use-document-stream.ts:91`, `nextOrder` is initialized to `0` with a comment `// Get existing cards in section for ordering`, but the code never queries existing cards. When `runQuery` is called on a section that already has cards, all new cards get `orderInSection` values starting from 0, colliding with existing cards' ordering. This corrupts the card display order in the section.

Compare with `src/components/board/document-view.tsx:224` which correctly computes `const nextOrder = sectionCards.length;`.

## Findings

```typescript
// src/hooks/use-document-stream.ts:89-91
// Get existing cards in section for ordering
let nextOrder = 0;
```

The comment indicates the intent was to read existing card count, but the implementation doesn't.

## Proposed Solutions

**Option A (Recommended): Query existing cards count before assigning order**
- Get existing cards in the section from `getBoardCards(boardId)` filtered by `sectionId`
- Set `nextOrder = existingCardsInSection.length`
- Effort: Small | Risk: Low

## Technical Details

- **Affected files:** `src/hooks/use-document-stream.ts`
- **Reference:** `src/components/board/document-view.tsx:224` for correct pattern

## Acceptance Criteria

- [ ] New cards appended to sections with existing cards get non-colliding orderInSection values
- [ ] Existing card ordering is preserved

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Comment-code mismatch indicates incomplete implementation |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
