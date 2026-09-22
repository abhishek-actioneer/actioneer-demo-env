---
title: "Card disappears when dragged to another section on the board"
description: "SortableSection missing sectionId in useSortable data caused moveCardToSection to be called with undefined, losing the card"
category: ui-bugs
tags:
  - dnd-kit
  - drag-and-drop
  - board
  - sortable
  - data-payload
component: src/components/board/sortable-section.tsx
date: 2026-03-16
severity: high
symptoms:
  - "Card vanishes after being dragged from one section to another"
  - "Dropping near the section header (not on a card) causes the card to disappear"
  - "Card is not in any section after the drop — technically moved to 'Unsectioned' but not visible"
---

## Problem

`SortableSection` registered itself with dnd-kit without including `sectionId` in the data payload:

```ts
// sortable-section.tsx — before fix
useSortable({ id, data: { type: "section" } });
//                        ↑ no sectionId!
```

When a card was dropped onto the section container (header area or gap between sections), `handleDragEnd` in `document-view.tsx` read `over.data.current?.sectionId` — which was `undefined` — and called:

```ts
moveCardToSection(boardId, cardId, undefined, 0);
```

This assigned `sectionId: undefined` to the card. In `cardsBySection` (document-view.tsx line 209), cards with falsy `sectionId` are skipped via `if (!card.sectionId) continue`. The card vanished from all sections.

## Why it felt like a "small hit area"

`DndContext` uses `closestCenter` collision detection. It resolves drop targets by comparing the **center of the ghost card** against the **center of every registered droppable**. The section container (`SortableSection`) and the card grid (`SectionCardGrid`) both have centers in different positions. Near the header area, `closestCenter` often resolved to the `SortableSection` droppable — which had no `sectionId` — rather than to a card or the grid.

Drop zones that resolved to `SortableSection` (no sectionId) → card disappeared.
Drop zones that resolved to a card in section B (correct sectionId) → cross-section move worked.

This made it seem like only a small area was "safe" to drop into.

## Solution

Add `sectionId: id` to the `useSortable` data in `SortableSection`:

```diff
- useSortable({ id, data: { type: "section" } });
+ useSortable({ id, data: { type: "section", sectionId: id } });
```

`handleDragEnd`'s section branch now correctly reads the target section ID:

```ts
// document-view.tsx — overType === "section" branch
const targetSectionId = over.data.current?.sectionId as string; // now "section-xyz" ✓
moveCardToSection(boardId, cardId, targetSectionId, 0);
```

## dnd-kit Data Payload Rule

**Every `useSortable` and `useDroppable` call must include all IDs needed to resolve the drop in `handleDragEnd`.** The `id` parameter is the sortable's own identifier — it is not automatically available as `over.data.current.sectionId` in the handler. Always pass the parent context explicitly in `data`.

| Component | Required data fields |
|-----------|---------------------|
| `SortableCard` | `{ type: "card", sectionId }` |
| `SortableSection` | `{ type: "section", sectionId: id }` |
| `SectionCardGrid` (useDroppable) | `{ type: "section", sectionId }` |

## Known Remaining Limitation

`closestCenter` is still in use. For empty sections (no cards), the `SectionCardGrid` droppable has a very small physical area (just the AddCardButton height). Cards can be dropped into empty sections by targeting that small zone. A future improvement would be switching to `pointerWithin` + `closestCenter` fallback for more natural cross-section UX.

## Related Files

- `src/components/board/sortable-section.tsx` — fix applied here
- `src/components/board/document-view.tsx` — `handleDragEnd` (lines 295–355)
- `src/components/board/section-card-grid.tsx` — `useDroppable` (correctly had `sectionId` in data)
- `src/components/board/sortable-card.tsx` — reference for correct data payload pattern
