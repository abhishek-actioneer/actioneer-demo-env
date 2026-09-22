# Canvas: Tabbed Query Result Card

**Date:** 2026-03-15
**Status:** Ready for planning

## Problem

When a user asks a question on the canvas (or sends a follow-up), the stream emits 3–4 separate cards — a chart, a SQL card, a data table, and sometimes a summary — scattered across the canvas. This clutters the workspace quickly, especially across multiple follow-up queries.

## What We're Building

Replace the current multi-card output (chart + sql + table) with a **single tabbed card** per query. The card shows three tabs: **Chart**, **SQL**, and **Table**. Summary/text/sticky cards remain separate — only the query data artifacts are collapsed.

## Why This Approach

### Chosen: Approach A — Tab UI on the existing `chart` card

The `chart` card type in `board-types.ts` already stores all three data artifacts:
- `chartSpec` + `data` → Chart tab
- `sql` → SQL tab
- `data` → Table tab (same data array, rendered as a table)

This means zero data model changes. We add a tab switcher to `ChartCardRenderer` and stop emitting sibling `sql` and `table` cards from `use-canvas-stream.ts`.

**Why not Approach B (new card type):** Adds a new `CardType` variant + renderer + migration of existing boards. More work for the same outcome.

**Why not Approach C (visual grouping overlay):** Complex tldraw layout math, cards still exist as separate entities in the store — doesn't actually reduce clutter.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Default tab | Chart | Most users want to see the visualization first |
| Tab persistence | Per-card (local state, not persisted) | Tab selection is ephemeral UI state |
| Table-only queries (no chartSpec) | Show Table + SQL tabs, hide Chart | Graceful degradation, no broken tab |
| Summary / text / sticky cards | Still emitted separately | User wants only the data artifacts grouped |
| Stream order | Chart card created first, SQL/Table tabs populated as data arrives | Chart card is the canonical artifact |
| Existing boards with old card types | No migration — legacy `sql` and `table` cards still render as-is | YAGNI, old boards are not broken |

## Scope

**In scope:**
- Tab bar on `ChartCardRenderer`: Chart | SQL | Table
- Stop creating sibling `sql` + `table` cards in `use-canvas-stream.ts` when a chart card is emitted
- Handle table-only case (no `chartSpec`): show Table | SQL tabs only

**Out of scope:**
- Deck view (`/decks`) — separate rendering system, separate concern
- Summary/text/sticky/follow-up cards — stay as individual cards
- Persisting the selected tab to board-store
- Migration of existing boards

## Implementation Touch Points

1. **`src/components/canvas/card-renderers/chart-card.tsx`** — add tab switcher UI (Chart | SQL | Table). Use `useState` for active tab. Reuse existing chart renderer and table renderer components.
2. **`src/lib/board-types.ts`** — no changes needed (fields already exist)
3. **`use-canvas-stream.ts`** (or the stream API route) — suppress creating sibling `sql` and `table` cards when a `chart` card is emitted in the same query group

## Open Questions

- Should the SQL tab have a "Copy" or "Run" button, or is read-only sufficient for V1?
- What's the minimum card height with tabs (currently chart min-height is 440px)?
- Does the deck view need the same treatment eventually, or is it intentionally different?
