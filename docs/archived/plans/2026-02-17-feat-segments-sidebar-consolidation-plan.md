---
title: "feat: Segments Sidebar Consolidation — 3-Tier Pattern Migration"
type: feat
date: 2026-02-17
---

# Segments Sidebar Consolidation

## Overview

Migrate segments from the current split-panel layout to the Metrics/Playbooks 3-tier pattern: **sidebar hover panel** (compact list) → **landing table** (`/segments`) → **detail route** (`/segments/{id}`). This eliminates the redundancy between the sidebar panel and the page's own left pane, and aligns segments with every other sidebar feature.

## Problem Statement / Motivation

The current segments page renders its own list pane alongside a detail panel. This duplicates the sidebar's role and breaks the pattern established by Metrics, Playbooks, Knowledge, and Connectors — all of which use the sidebar for navigation and dedicated routes for content.

The screenshot shows the redundancy clearly: the sidebar opens a "Segments" panel with placeholder text, while the page has its own full segment list. Users see two overlapping navigation surfaces for the same feature.

## Proposed Solution

Follow the exact Metrics pattern:

| Tier | Component | Data Source |
|------|-----------|-------------|
| **Sidebar panel** | `SegmentsPanel` in `sidebar.tsx` | `MOCK_SEGMENTS` (sync, matching all other panels) |
| **Landing page** `/segments` | Table with search + active/archived tabs | `fetch("/api/segments")` merged with `MOCK_SEGMENTS` |
| **Detail route** `/segments/{id}` | Full-width `SegmentDetailPanel` | Mock lookup first → API fallback |

## Technical Considerations

### Data Source Mismatch

All sidebar panels use synchronous in-memory stores. Segments use DuckDB-backed async API. Resolution:

- **Sidebar panel**: Use `MOCK_SEGMENTS` synchronously for the hover preview (consistent with prototype nature). Real segments from API would require `useEffect` which no other panel uses.
- **Landing page**: Async fetch from `/api/segments` + merge with `MOCK_SEGMENTS` (same strategy as current `SegmentsPage`).
- **Detail route**: Check `MOCK_SEGMENTS.find(s => s.id === id)` first (sync), fall back to `GET /api/segments/${id}` (async). This mirrors how playbooks handle mock vs. saved data.

### Mock Segment IDs

Mock segments have IDs like `mock-hv-mobile`. The API will 404 for these. The detail route must check mock data first before calling the API. This is the same pattern playbooks use (`playbookId === MOCK_PLAYBOOK.id ? MOCK_PLAYBOOK : getPlaybook(playbookId)`).

### Archive Handling

The current split-panel has an archived/active toggle. The DuckDB `segments` table has no `archived` column — archiving is only implemented for mock data. The landing table should preserve the archived toggle for mock segments, with real segments always appearing in the "Active" tab.

## Acceptance Criteria

- [x] Sidebar `SegmentsPanel` shows compact segment list (status dot + name + subtitle)
- [x] Clicking a segment in sidebar navigates to `/segments/{id}`
- [x] "View All →" in sidebar navigates to `/segments` landing table
- [x] `/segments` shows a full-width table with search, active/archived tabs
- [x] Table columns: Name/Description, Type, Users, Destinations, Creator
- [x] Clicking a table row navigates to `/segments/{id}`
- [x] `/segments/{id}` renders `SegmentDetailPanel` full-width with all actions (SQL, push, preview, archive, delete)
- [x] `/segments/{id}` handles mock IDs (loads from `MOCK_SEGMENTS`) and real IDs (loads from API)
- [x] `/segments/{id}` shows "Segment not found" for invalid IDs with "Back to Segments" link
- [x] "New Segment" button on landing page opens `CreateSegmentModal`
- [x] After chat-based segment creation, navigates to `/segments/{id}` (not just `/segments`)
- [x] `pnpm build` passes
- [x] Old split-panel `SegmentsPage` component removed

## Implementation Phases

### Phase 1: Create `/segments/[id]` Detail Route

**Why first:** This is the navigation target for both the sidebar panel and the landing table. Everything depends on it.

**Files:**

`src/app/segments/[id]/page.tsx` (new)

```tsx
// Pattern: src/app/metrics/[id]/page.tsx
// 1. useParams() to get segment ID
// 2. Check MOCK_SEGMENTS.find(s => s.id === id) first (sync)
// 3. If not found, fetch GET /api/segments/${id} (async, with loading state)
// 4. Render Sidebar + full-width SegmentDetailPanel
// 5. Not-found state with "Back to Segments" link
// 6. Breadcrumb: "Segments / {name}" with click-back to /segments
```

`src/components/segments/segment-detail-panel.tsx` (likely no changes needed)

```tsx
// Current: designed for ~380px side panel, but uses flex layout
// The detail route wraps it in a max-w-4xl container — panel should adapt
// If any elements look cramped or stretched, adjust with max-width or grid tweaks
// Keep all existing functionality: refresh, push, archive, delete, copy SQL
```

**Callback handlers in the route page:**

```tsx
// SegmentDetailPanel expects: onArchive, onDelete, onUpdate callbacks
// The route page must implement these:
// - onDelete: DELETE /api/segments/${id} → router.push("/segments")
// - onArchive: local state toggle (no API — DuckDB has no archived column)
// - onUpdate: PATCH /api/segments/${id} → refresh local state
```

**Edge cases to handle:**
- Mock segment ID → load from `MOCK_SEGMENTS` array, skip API call
- Real segment ID → show loading skeleton, fetch from API
- Invalid ID → "Segment not found" with back link
- API error → error state with retry option

---

### Phase 2: Rewrite `/segments` Landing as Table

**Why second:** With the detail route ready, the landing table can link to it.

`src/app/segments/page.tsx` (rewrite)

```tsx
// Pattern: src/app/metrics/page.tsx
// Layout: Sidebar + full-width main area
// Header: "Segments" title + "New Segment" button (opens CreateSegmentModal)
// Search: text input filtering by name/description
// Tabs: "Active" / "Archived" (like the current split-panel toggle)
// Table columns: Name (with status dot + description), Type, Users, Destinations, Creator
// Data: fetch("/api/segments") merged with MOCK_SEGMENTS (same as current SegmentsPage)
// Row click: router.push(`/segments/${segment.id}`)
// Empty state: "No segments found" centered text
```

**Table column spec:**

| Column | Source Field | Display |
|--------|-------------|---------|
| Name | `name` + `description` + `statusColor` | Status dot + name (bold) + description (muted) |
| Type | `type` | Badge: "Dynamic" or "Static" |
| Users | `userCount` | Formatted number (e.g. "12.4K") |
| Destinations | `destinations` | Icon chips (CleverTap, Firebase, etc.) |
| Creator | `creator` | Avatar circle + name |

---

### Phase 3: Populate Sidebar `SegmentsPanel`

**Why third:** Sidebar is the quick-access layer. Now that both landing and detail routes exist, wire up the panel.

`src/components/sidebar.tsx` (modify `SegmentsPanel`)

```tsx
// Pattern: MetricsPanel (lines 377-405)
// Data: import MOCK_SEGMENTS, toSegmentDisplay from mock-segments
//   - Show .filter(s => !s.archived).slice(0, 8)
// Each item: status dot (colored) + name (PRIMARY) + description (SECONDARY)
// Click: router.push(`/segments/${segment.id}`)
// Footer: "View All →" → router.push("/segments")
```

---

### Phase 4: Wire Up Post-Creation Navigation

`src/app/page.tsx` (modify `handleCreateSegment`)

```tsx
// Current: checks res.ok then router.push("/segments") — does NOT parse response body
// Change: parse response to extract ID, then navigate to detail
//   const data = await res.json();
//   router.push(`/segments/${data.id}`);
// The POST /api/segments response returns { id, name, sql, ... }
```

`src/app/segments/page.tsx` (if CreateSegmentModal is also on the landing page)

```tsx
// After creation on the landing page: router.push(`/segments/${newId}`)
```

---

### Phase 5: Clean Up Old Split-Panel

**Files to remove:**

- `src/components/segments/segments-page.tsx` — replaced by landing table in `src/app/segments/page.tsx`
- `src/components/segments/segment-list-card.tsx` — replaced by table rows on landing + compact items in sidebar

**Files to keep:**

- `src/components/segments/segment-detail-panel.tsx` — reused in `/segments/[id]` route
- `src/components/segments/mock-segments.ts` — still needed for seed data
- `src/components/segments/create-segment-modal.tsx` — still needed for creation flow

**Verify no other imports reference removed files:**

```bash
grep -r "segments-page\|segment-list-card" src/ --include="*.tsx" --include="*.ts"
```

---

### Phase 6: Verify

- [x] `pnpm build` passes
- [ ] Sidebar: hovering "Segments" shows compact list with mock segments
- [ ] Sidebar: clicking a segment navigates to `/segments/{id}` with full detail
- [ ] Sidebar: "View All →" navigates to `/segments` table
- [ ] Landing: table shows mock + real segments with search and active/archived tabs
- [ ] Landing: clicking a row navigates to `/segments/{id}`
- [ ] Landing: "New Segment" button opens CreateSegmentModal, creation navigates to detail
- [ ] Detail: mock segment IDs load correctly (e.g. `/segments/mock-hv-mobile`)
- [ ] Detail: real segment IDs load from API
- [ ] Detail: invalid IDs show "not found" with back link
- [ ] Detail: all actions work (SQL copy, push, refresh, archive, delete)
- [ ] Chat: "Create Segment" follow-up action → modal → success → lands on `/segments/{id}`
- [ ] No references to removed `segments-page.tsx` or `segment-list-card.tsx`

## Dependencies & Risks

**Low risk:** This is a layout/routing restructure. No new APIs needed. All data flows already exist.

**Risk: SegmentDetailPanel width adaptation.** Currently designed for ~380px panel. May need CSS adjustments for full-width. Mitigation: use `max-w-4xl` container or a ResizablePanel like `/metrics/[id]`.

**Risk: Real segment descriptions are generic.** `toSegmentDisplay()` hardcodes "Segment created from chat analysis". The table will show identical descriptions for all real segments. Mitigation: acceptable for prototype; can add `description` column to DuckDB later.

## References & Research

### Internal References
- Metrics 3-tier pattern: `src/app/metrics/page.tsx`, `src/app/metrics/[id]/page.tsx`, `sidebar.tsx:MetricsPanel`
- Playbooks mock fallback: `src/app/playbooks/[id]/page.tsx`
- Brainstorm: `docs/brainstorms/2026-02-17-segments-sidebar-consolidation-brainstorm.md`
- Post-merge solution: `docs/solutions/integration-issues/post-merge-missing-navigation-entry-point.md`
- Detail panel UX patterns: `docs/solutions/design-patterns/segment-detail-panel-ux-patterns.md`

### Documented Learnings Applied
- **State reset pattern**: Use "adjust state during render" in detail panel (track prev segment ID) — from `segment-detail-panel-ux-patterns.md`
- **Query optimization**: Split count + preview queries with `Promise.all` — from same doc
- **Route-first architecture**: Features should be Next.js routes, not in-page state — from `post-merge-missing-navigation-entry-point.md`
