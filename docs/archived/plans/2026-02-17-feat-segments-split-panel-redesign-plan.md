---
title: "feat: Segments Split Panel Redesign with NL Creation"
type: feat
date: 2026-02-17
---

# feat: Segments Split Panel Redesign with NL Creation

## Overview

Redesign the Segments page from a card grid to a **split panel layout** (Maze-style): segment list on the left (~1/3) with rich cards, enhanced detail panel on the right (~2/3). Add functional search/filters, archived segments, hardcoded mock data for visual fidelity, and a new Create Segment modal with natural language + raw SQL tabs.

## Problem Statement

The current segments page uses a grid of simple cards that doesn't scale beyond ~10 segments. There's no search, filtering, or way to quickly scan and compare segments. The detail view is a full-page replacement, requiring back-navigation to return to the list. Segment creation is only possible from chat — there's no way to create segments directly from the segments page.

## Proposed Solution

A split panel with the list always visible alongside the detail view, inspired by Maze's segment UI. Rich cards with descriptions and sync indicators replace the simple grid. A two-tab Create modal enables segment creation via natural language or raw SQL without leaving the page.

## Technical Approach

### Architecture

**Layout:** Split panel rendered inside the existing `activeView === "segments"` conditional in `page.tsx`. Uses the existing `ResizablePanel` component for the left panel (draggable divider). Right panel is `flex-1`.

**Data:** ~12-15 hardcoded `SegmentDisplay` objects merged with real segments from `/api/segments`. Real segments get default display values. All filtering/search is client-side against this merged array.

**NL Creation:** New API route `POST /api/segments/generate-sql` that calls the existing `sql-generator.ts` pipeline with a segment-focused prompt. Returns generated SQL for preview before creation.

### Component Tree

```
SegmentsPage (full redesign)
├── Header (title + Create button)
├── SplitPanel
│   ├── LeftPanel (ResizablePanel wrapper)
│   │   ├── SearchBar + FilterButton
│   │   ├── SegmentCardList (scrollable)
│   │   │   └── SegmentListCard[] (rich cards)
│   │   └── ArchivedLink
│   └── RightPanel (flex-1)
│       ├── EmptyState (no selection)
│       └── SegmentDetailPanel (selected)
│           ├── SummaryStatsBar
│           ├── SQLPreview
│           ├── PushToIntegrations
│           └── UserPreviewTable
└── CreateSegmentModal (two tabs: Describe + SQL)
```

### Implementation Phases

#### Phase 1: Split Panel Layout + Mock Data
**Goal:** Replace card grid with split panel. Populate with hardcoded mock segments. Left panel shows rich cards, right panel shows empty state or detail.

**Files to create/modify:**
- `src/components/segments/segments-page.tsx` — Full rewrite
- `src/components/segments/segment-list-card.tsx` — New: rich card for left panel
- `src/components/segments/segment-detail-panel.tsx` — New: enhanced detail for right panel
- `src/components/segments/mock-segments.ts` — New: hardcoded mock data
- `src/lib/types.ts` — Add `SegmentDisplay` interface

**Tasks:**
- [ ] Define `SegmentDisplay` interface extending `Segment` with display-only fields (`src/lib/types.ts`)
- [ ] Create `mock-segments.ts` with ~12-15 realistic segments covering all states (active, stale, failed, archived, various destinations)
- [ ] Rewrite `segments-page.tsx` with split panel layout using `ResizablePanel` for left panel (default 380px, min 300, max 500)
- [ ] Create `segment-list-card.tsx` — name (bold), one-line description (truncated), small brand icons row for synced destinations, active state highlight
- [ ] Create `segment-detail-panel.tsx` with empty state ("Select a segment to view details") and selected state
- [ ] Wire card click → set `selectedSegmentId` → right panel populates
- [ ] Merge mock segments with real segments from API (real segments get default display values)
- [ ] Style the header bar: "Segments" title left, "Create segment" button right, spanning full width above the split

**Acceptance criteria:**
- [ ] Split panel renders with ~1/3 left, ~2/3 right
- [ ] Left panel is resizable via drag handle
- [ ] Mock segments appear as rich cards with names, descriptions, brand icons
- [ ] Clicking a card highlights it and shows detail in right panel
- [ ] Empty state shows when no segment is selected
- [ ] Real segments from chat appear in list alongside mocks

<details>
<summary>Mock data shape example</summary>

```typescript
// src/components/segments/mock-segments.ts
export const MOCK_SEGMENTS: SegmentDisplay[] = [
  {
    id: "mock-hv-mobile",
    name: "HV Mobile Users",
    description: "High-value mobile users with 3+ purchases in last 90 days",
    sql: "SELECT DISTINCT user_id FROM events WHERE device_type = 'mobile' AND event_type = 'purchase' GROUP BY user_id HAVING COUNT(*) >= 3",
    userCount: 12448,
    createdAt: "2026-02-10T14:30:00Z",
    sourceConversationId: undefined,
    pushStatus: { salesforce: "synced", clevertap: "synced" },
    type: "dynamic",
    destinations: ["salesforce", "clevertap"],
    trend: -3,
    refreshStatus: "active",
    refreshLabel: "4 hours ago",
    creator: "M. Park",
    statusColor: "green",
    archived: false,
  },
  // ... 11-14 more segments covering:
  // - static/snapshot type
  // - stale refresh status
  // - failed refresh status
  // - various destinations (klaviyo, meta-ads, bigquery, internal)
  // - null trends
  // - archived: true segments
  // - 0 user count
];
```

</details>

#### Phase 2: Search, Filters & Archived

**Goal:** Add functional client-side search, filter popover, and archived segments link.

**Files to create/modify:**
- `src/components/segments/segments-page.tsx` — Add filter state and logic
- `src/components/segments/segment-filter-popover.tsx` — New: filter popover component
- Add shadcn `popover` component: `npx shadcn add popover`

**Tasks:**
- [ ] Add search state and filter segments by name/description match (case-insensitive)
- [ ] Install shadcn popover: `npx shadcn add popover`
- [ ] Create `segment-filter-popover.tsx` with filter groups: Type (All/Dynamic/Static), Destination (All + each unique destination), Status (All/Active/Stale/Failed)
- [ ] Filters apply instantly on selection (no "Apply" button)
- [ ] Show active filter count on the filter icon button (e.g., badge "2")
- [ ] Add "Clear all" link inside popover when any filter is active
- [ ] Render "Archived segments (N)" grayed-out link at bottom of left panel
- [ ] Clicking archived link replaces list content with archived segments + "← Back to active" link
- [ ] When search/filter hides the currently selected segment, clear the detail panel (show empty state)

**Empty states:**
- [ ] No results from search: "No segments match '[query]'" with "Clear search" link
- [ ] No results from filters: "No segments match these filters" with "Clear filters" link
- [ ] No segments at all (first-time user): illustration + "Create your first segment" + "Create segment" button in left panel

**Acceptance criteria:**
- [ ] Search filters list in real-time as user types
- [ ] Filter popover opens from icon button, shows 3 filter groups
- [ ] Filters apply instantly, badge shows active filter count
- [ ] "Clear all" resets filters
- [ ] Archived segments accessible via link, navigable back to active
- [ ] All empty states render appropriately

#### Phase 3: Enhanced Detail Panel

**Goal:** Build out the right panel with summary stats, SQL preview, push actions, and user preview table. Port and enhance existing `segment-detail.tsx` content.

**Files to modify:**
- `src/components/segments/segment-detail-panel.tsx` — Full implementation

**Tasks:**
- [ ] **Summary stats bar** at top of detail: segment name (large), metadata line (created date · creator · type badge), stats row (user count with trend arrow, refresh status with label, destination badges)
- [ ] **SQL preview block**: read-only code block with the segment's SQL query. Copy button. Monospace font.
- [ ] **Push to integrations section**: show connected integrations with push buttons. Reuse pattern from existing `segment-detail.tsx` (lines 96-114). Use `Set<string>` for tracking concurrent pushes (per race conditions review).
- [ ] **User preview table**: fetch first 50 rows via `GET /api/segments/[id]` (existing endpoint returns preview). Dynamic columns from first row's keys. Truncated cells.
- [ ] **Loading states**: skeleton for summary stats, spinner for user table, "Loading..." for SQL
- [ ] **AbortController cleanup**: all fetches (detail, preview) must use AbortController with cleanup on unmount or segment change (per race conditions review)
- [ ] **Archive action**: three-dot menu in detail panel header with "Archive" option. Updates local state (moves to archived list). Mock only — no API call needed.
- [ ] **Delete action**: three-dot menu with "Delete" option. Confirmation dialog. Calls existing `DELETE /api/segments/[id]` for real segments, removes from mock array for mocks.

**Acceptance criteria:**
- [ ] Summary stats bar shows all metadata fields
- [ ] SQL is displayed in a copyable code block
- [ ] Push buttons work for real segments (call existing API)
- [ ] User preview table loads and displays with dynamic columns
- [ ] All fetches clean up on unmount (no setState-after-unmount)
- [ ] Archive/delete actions work from three-dot menu

#### Phase 4: Create Segment Modal (NL + SQL)

**Goal:** Two-tab modal for creating segments. "Describe" tab uses Gemini to generate SQL from natural language. "SQL" tab allows direct SQL input. Both show live user count preview.

**Files to create/modify:**
- `src/components/segments/create-segment-modal.tsx` — Full rewrite
- `src/app/api/segments/generate-sql/route.ts` — New: NL-to-SQL API route
- Add shadcn `tabs` component (already exists in project)

**Tasks:**
- [ ] Rewrite `create-segment-modal.tsx` with shadcn Dialog + Tabs
- [ ] **Shared fields** (above tabs): segment name input (required), shown on both tabs
- [ ] **Describe tab**: textarea for natural language description, "Generate SQL" button, generated SQL preview (read-only code block), user count preview (skeleton while loading)
- [ ] **SQL tab**: textarea for raw SQL input (monospace), user count preview (updates on blur or after 1s debounce)
- [ ] **Generate SQL flow**: POST to `/api/segments/generate-sql` with description → returns SQL string → display in preview → auto-fetch user count
- [ ] **Create `/api/segments/generate-sql/route.ts`**: uses `generateSingleQuery()` from `sql-generator.ts` with a segment-focused system prompt (must return SQL selecting `user_id`). Returns `{ sql: string }` or `{ error: string }`.
- [ ] **Count preview**: POST to existing `/api/segments` dry-run or execute SQL and count. Show skeleton while loading, number when ready, error if SQL fails.
- [ ] **Tab switching**: generated SQL is preserved when switching Describe→SQL. User edits in SQL tab are preserved when switching back.
- [ ] **Validation**: name required, SQL required (generated or manual), SQL must be SELECT-only
- [ ] **Error handling**: NL generation failure shows inline error + "Try again" button. SQL syntax error shows error message below SQL input. Count failure shows "Could not estimate count" with retry.
- [ ] **On create**: POST to existing `/api/segments` endpoint. On success: close modal, add segment to list, auto-select it in left panel.
- [ ] **AbortController**: cancel in-flight SQL generation and count queries on modal close

**Acceptance criteria:**
- [ ] Name field is required on both tabs
- [ ] Describe tab generates SQL from natural language via Gemini
- [ ] SQL tab allows direct SQL entry
- [ ] Count preview shows for both tabs
- [ ] Tab switching preserves state
- [ ] Created segment appears in list and auto-selects
- [ ] Modal close cancels in-flight requests

<details>
<summary>NL-to-SQL API route sketch</summary>

```typescript
// src/app/api/segments/generate-sql/route.ts
import { SCHEMA_CONTEXT } from "@/lib/schema";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request) {
  const { description } = await req.json();

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    contents: `You are a SQL expert. Given a natural language description of a user segment, generate a DuckDB SQL query that returns user_id values matching the description.

${SCHEMA_CONTEXT}

RULES:
- Query MUST select user_id (can include other columns)
- Use DuckDB SQL syntax
- Data date range: 2019-11-01 to 2019-11-16
- LIMIT 500 max
- Return ONLY the SQL query, no explanation

Description: ${description}`,
  });

  const sql = response.text?.trim();
  if (!sql || sql === "UNSUPPORTED_QUERY") {
    return Response.json({ error: "Could not generate SQL for this description" }, { status: 422 });
  }

  return Response.json({ sql });
}
```

</details>

#### Phase 5: Brand Icons + Polish

**Goal:** Add real brand SVG icons for destination indicators. Polish transitions, loading states, and responsive behavior.

**Files to create/modify:**
- `src/components/segments/brand-icons.tsx` — New: brand icon registry
- `src/components/segments/segment-list-card.tsx` — Use brand icons
- `src/components/segments/segment-detail-panel.tsx` — Use brand icons in push section

**Tasks:**
- [ ] Create `brand-icons.tsx` with inline SVG components for: Salesforce (blue), CleverTap (red/orange), Klaviyo (green), Meta/Facebook (blue), BigQuery (Google colors). Render at 14x14 (`w-3.5 h-3.5`).
- [ ] Replace lucide icons in segment cards with brand SVGs from registry
- [ ] Replace lucide icons in push-to-integration buttons with brand SVGs
- [ ] Add `animate-slide-in` transition when detail panel content changes (matching existing panel animation pattern from `page.tsx` line 1010)
- [ ] Add keyboard navigation: arrow keys to move between cards in left panel, Enter to select
- [ ] Ensure left and right panels scroll independently (`overflow-y-auto` on each)
- [ ] Add tooltip on brand icons showing destination name + sync status

**Acceptance criteria:**
- [ ] Brand SVGs render correctly at small size in cards
- [ ] Push buttons use brand SVGs
- [ ] Panel transitions are smooth
- [ ] Keyboard navigation works in left panel
- [ ] Independent scrolling on both panels

## Alternative Approaches Considered

| Approach | Why Rejected |
|----------|-------------|
| Full-width data table (original wireframe) | Doesn't allow inline detail inspection. Requires page navigation to view segment details. Split panel is more efficient for scan+inspect workflow. |
| Side panel overlay (like chat sources panel) | Too narrow for the detail content (SQL, user table, push actions). The 2/3 dedicated space is necessary. |
| Card grid with expandable rows | Gets messy with many segments. Expanding one card pushes others around. Split panel is more stable. |
| Server-side pagination | Overkill for prototype with local DuckDB data. Client-side filtering is simpler and instant. |

## Acceptance Criteria

### Functional Requirements
- [ ] Split panel layout with resizable divider
- [ ] ~12-15 mock segments displayed with rich cards
- [ ] Real segments from chat coexist with mocks
- [ ] Functional search by name/description
- [ ] Functional filters by type, destination, status
- [ ] Enhanced detail panel with stats, SQL, push actions, user table
- [ ] Create Segment modal with NL describe + SQL tabs
- [ ] NL description generates SQL via Gemini
- [ ] Archived segments accessible via link
- [ ] AbortController cleanup on all async operations

### Non-Functional Requirements
- [ ] No setState-after-unmount warnings in console
- [ ] Smooth panel resize (no jank)
- [ ] Independent scrolling on both panels
- [ ] All empty/loading/error states handled

## Dependencies & Prerequisites

- Existing `ResizablePanel` component (`src/components/chat/resizable-panel.tsx`)
- Existing segments API routes (CRUD)
- Existing `sql-generator.ts` for NL-to-SQL
- shadcn `popover` component (needs installing)
- shadcn `tabs` component (already in project)

## Risk Analysis & Mitigation

| Risk | Mitigation |
|------|-----------|
| Race conditions on detail panel fetches | AbortController cleanup per race conditions review (issue #3). All useEffect fetches return cleanup. |
| DuckDB lock contention (NL generation + count query) | Serialize write operations. Handle "database locked" with retry. |
| Gemini NL-to-SQL generates bad SQL | Show error inline, allow user to edit in SQL tab. Validation before creation. |
| ResizablePanel doesn't fit the split layout | Existing component accepts defaultWidth/min/max props. May need minor adjustments for right-side rendering vs current left-side usage. |
| Mock data feels disconnected from real data | Give real segments sensible display defaults. Sort mocks and real together by createdAt. |

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-17-segments-list-redesign-brainstorm.md`
- Race conditions review: `docs/reviews/race-conditions-review-segments-plan.md` — Critical patterns for AbortController cleanup
- Follow-up actions redesign: `docs/solutions/design-patterns/follow-up-actions-card-redesign.md` — Brand icon registry pattern
- Existing segments components: `src/components/segments/` (segments-page, segment-card, segment-detail, create-segment-modal)
- ResizablePanel: `src/components/chat/resizable-panel.tsx` (lines 1-75)
- SQL generator: `src/lib/sql-generator.ts` (text-to-SQL pipeline)
- View switching: `src/app/page.tsx` (lines 281, 962-1035)

### Reference Screenshots
- Customer.io — Rich rows with descriptions + tags (left panel card density inspiration)
- Shopify — Clean minimal table (detail panel stats layout inspiration)
- Maze — Split panel layout (primary layout inspiration)
