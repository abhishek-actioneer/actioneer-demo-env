---
date: 2026-02-17
topic: segments-list-redesign
---

# Segments List Redesign: Split Panel with Rich Cards & NL Creation

## What We're Building

A redesigned Segments page using a **split panel layout** (Maze-style): a segment list panel on the left (~1/3 width) with rich cards, and an enhanced detail panel on the right (~2/3 width). Replaces the current card grid. Includes functional search/filter, archived segments support, and a new segment creation flow with natural language input.

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Segments                                              [+ Create segment]   │
├──────────────────────────┬──────────────────────────────────────────────────┤
│  [🔍 Search...]  [⚙ ▼]  │  Segment Name                                   │
│                          │  Created Feb 16 · by M. Park · Dynamic          │
│  ┌────────────────────┐  │                                                  │
│  │ HV Mobile Users    │  │  ┌─ Summary ─────────────────────────────────┐  │
│  │ High-value mobile  │  │  │ 12,448 users · ↓3% trend · Refreshed 4h  │  │
│  │ users with 3+ pur… │  │  │ Synced to: Salesforce ✓  CleverTap ✓     │  │
│  │ 🔵SF  🟠CT         │  │  └───────────────────────────────────────────┘  │
│  └────────────────────┘  │                                                  │
│                          │  ┌─ SQL Query ───────────────────────────────┐  │
│  ┌────────────────────┐  │  │ SELECT user_id FROM events WHERE ...      │  │
│  │ Summer Churn Risk  │  │  └───────────────────────────────────────────┘  │
│  │ Users at risk of   │  │                                                  │
│  │ churning during…   │  │  ┌─ Push to Integration ────────────────────┐  │
│  │ (no syncs)         │  │  │ [Salesforce ✓] [CleverTap ▶] [BQ ▶]     │  │
│  └────────────────────┘  │  └───────────────────────────────────────────┘  │
│                          │                                                  │
│  ┌────────────────────┐  │  ┌─ User Preview ───────────────────────────┐  │
│  │ Abandoned Cart     │  │  │ user_id  | email      | last_purchase   │  │
│  │ Users with abandon │  │  │ u_1234   | alice@...  | 2026-02-10      │  │
│  │ carts in last 7d…  │  │  │ u_5678   | bob@...    | 2026-02-08      │  │
│  │ 🟣KL               │  │  │ ...showing 50 of 8,102                   │  │
│  └────────────────────┘  │  └───────────────────────────────────────────┘  │
│                          │                                                  │
│  Archived segments (3)   │                                                  │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

### Components

1. **Left panel — Segment list** (~1/3 width)
   - Search bar at top with filter icon button (opens popover for type/destination/status filters)
   - Rich segment cards: name (bold), one-line description, small brand icons showing sync destinations
   - Active state highlight on selected card
   - "Archived segments (N)" grayed-out link at bottom
   - Scrollable independently from right panel

2. **Right panel — Enhanced detail** (~2/3 width)
   - **Empty state** (no selection): centered illustration + "Select a segment to view details"
   - **Selected state**: summary stats bar (size, trend, refresh, creator, type), SQL preview block, push-to-integration actions, user preview table
   - All the metadata that was in the original wireframe columns now lives here

3. **Header bar** — "Segments" title + "Create segment" button spanning full width

4. **Create Segment modal** — Two-tab modal: "Describe" tab (natural language input -> Gemini generates SQL -> preview user count) and "SQL" tab (paste/write SQL directly). Both tabs show live count preview before confirmation.

5. **Mock seed data** — ~12-15 hardcoded realistic segments with rich fields. Displayed alongside real segments from chat.

## Why This Approach

- **Split panel over full table** — Lets users scan the list and inspect details without navigating away. Quick comparison between segments. The left list stays compact (name + description + sync icons), while all the dense metadata (SQL, user table, push actions, trend, creator) lives in the right panel where there's room.
- **Rich cards over table rows** — In a narrow panel, table columns don't fit. Cards with name + description + sync icons are more scannable than trying to squeeze columns into 1/3 width.
- **Brand icons as sync indicators** — Small destination brand logos (Salesforce, CleverTap, Klaviyo) on each card instantly communicate where segments are synced. Full push status details are in the right panel.
- **Archived via link, not tabs** — Keeps the main list clean. A small grayed-out "Archived segments (N)" link at the bottom avoids cluttering the header with tabs. Archives are a secondary concern.
- **Search + filter icon** — Search bar is primary (always visible). Filter dropdowns collapse behind a funnel/settings icon to keep the narrow panel uncluttered. Opens a popover with type/destination/status filters.
- **NL creation** — Reuses existing text-to-SQL pipeline (`sql-generator.ts`). Two tabs (describe + SQL) serve both personas.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Split panel layout (1/3 + 2/3) | Maze-style. List + detail on same screen. No page navigation to inspect a segment. |
| Rich cards in left panel (not table rows) | Name + description + sync icons. Narrow panel can't fit table columns. |
| Small brand icons for sync status | Instantly shows where segment is pushed. Tiny Salesforce/CleverTap/Klaviyo logos. |
| Enhanced detail in right panel | Summary stats + SQL + push actions + user table. All metadata lives here. |
| Empty state on first load | "Select a segment to view details". Guides the user. |
| Search in left panel header | Always visible. Primary interaction for finding segments. |
| Filters behind icon button | Popover with type/destination/status dropdowns. Keeps panel compact. |
| Archived link at bottom (not tabs) | "Archived segments (3)" grayed-out link. Uncluttered main view. |
| Hardcoded mock data in component | Fastest path. No schema changes. Real segments coexist with mocks. |
| Two-tab Create modal (NL + SQL) | NL tab uses Gemini text-to-SQL. SQL tab for power users. |

## Data Model (Visual Prototype)

Mock segments extend the real `Segment` type with display-only fields:

```typescript
interface SegmentDisplay extends Segment {
  description: string;            // One-liner for left panel card
  type: "dynamic" | "static";
  destinations: string[];         // ["salesforce", "clevertap"] — for brand icons
  trend: number | null;           // percentage change, null = no data
  refreshStatus: "active" | "stale" | "failed" | "snapshot";
  refreshLabel: string;           // "4 hours ago", "2 days ago", "Feb 16", "Failed"
  creator: string;                // "M. Park", "T. Chen", etc.
  statusColor: "green" | "blue" | "yellow" | "red";
  archived: boolean;
}
```

Real segments from chat get default values: type: "dynamic", destinations: [], trend: null, refreshStatus: "active", creator: "You", archived: false, description derived from segment name.

## Reference Screenshots

- **Customer.io** — Rich rows with name + description + tags + metadata. Inspired our left panel card density.
- **Shopify** — Clean minimal table. Informed the detail panel column layout for summary stats.
- **Maze** — Split panel layout (list left, detail right). Primary layout inspiration.

## Open Questions

- How should the Create modal handle NL generation errors (bad descriptions, ambiguous input)?
- Should the left panel support drag-to-reorder segments?
- Should archived segments show in a separate view or expand inline below the active list?

## Next Steps

-> `/workflows:plan` for implementation details.
