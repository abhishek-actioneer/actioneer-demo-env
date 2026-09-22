---
title: "Split-Panel to 3-Tier Sidebar Pattern Consolidation"
date: 2026-02-17
category: design-patterns
tags: [navigation, sidebar, routing, ui-consistency, refactoring, layout, 3-tier-pattern, segments]
severity: medium
component: [src/app/segments/page.tsx, src/app/segments/[id]/page.tsx, src/components/sidebar.tsx, src/app/page.tsx]
related_features: [SegmentsPage, SegmentDetailPanel, CreateSegmentModal, Sidebar, MetricsPage]
---

# Split-Panel to 3-Tier Sidebar Pattern Consolidation

## Problem

The Segments feature used a split-panel layout (`SegmentsPage` component with list left + detail right) while all other features (Metrics, Playbooks, Knowledge, Connectors) used a 3-tier sidebar pattern:

1. **Sidebar hover panel** — compact item list in the sidebar's expandable panel
2. **Landing page** (`/feature`) — full-width table/grid with search and filters
3. **Detail route** (`/feature/{id}`) — full-width detail page

This created two overlapping navigation surfaces: the sidebar opened a "Segments" panel with placeholder text, while the page rendered its own full segment list. Users saw redundant UI for the same feature.

## Root Cause

The segments feature was built with a split-panel layout before the vimarsh merge introduced the sidebar hover panel pattern. After the merge resolved the navigation entry point issue (documented in `post-merge-missing-navigation-entry-point.md`), segments had the new sidebar icon but kept its old split-panel — creating the redundancy.

The architectural mismatch: vimarsh features used **route-based navigation** (`router.push("/metrics")`) while the original segments used **in-page state** (`activeView === "segments"`). The first fix added a `/segments` route but preserved the split-panel component. This consolidation completes the migration.

## Solution

Migrated segments to the exact Metrics/Playbooks 3-tier pattern in 6 phases:

### Phase 1: Created `/segments/[id]` detail route

`src/app/segments/[id]/page.tsx` — the navigation target everything else points to.

- Checks `MOCK_SEGMENTS.find(s => s.id === id)` first (sync), falls back to `GET /api/segments/${id}` (async)
- Renders `Sidebar` + full-width `SegmentDetailPanel` with breadcrumb ("Segments / {name}")
- Implements callback handlers: `onDelete` (API DELETE → navigate to `/segments`), `onArchive` (navigate back), `onUpdate` (refresh via state key)
- Loading skeleton, not-found state with "Back to Segments" link

### Phase 2: Rewrote `/segments` landing as table

`src/app/segments/page.tsx` — from `SegmentsPage` wrapper to full-width table.

- Fetches from `/api/segments` + merges with `MOCK_SEGMENTS` (same data strategy as before)
- Table columns: Name/Description (status dot), Type (badge), Users (formatted count), Destinations (brand SVG icons), Creator (avatar + name)
- Search bar, Active/Archived tab filter, "New Segment" button opening `CreateSegmentModal`
- Row click → `router.push(`/segments/${id}`)`

### Phase 3: Populated sidebar `SegmentsPanel`

`src/components/sidebar.tsx` — replaced placeholder with real segment list.

- Imports `MOCK_SEGMENTS`, shows `.filter(!archived).slice(0, 8)`
- Each item: colored status dot + name (PRIMARY) + description (SECONDARY)
- Click → `router.push(`/segments/${id}`)`, footer "View All →" → `/segments`

### Phase 4: Wired post-creation navigation

`src/app/page.tsx` — `handleCreateSegment` now parses the response body (`await res.json()`) and navigates to `/segments/${data.id}` instead of just `/segments`.

### Phase 5: Removed old components

- Deleted `src/components/segments/segments-page.tsx` (split-panel layout)
- Deleted `src/components/segments/segment-list-card.tsx` (list card component)
- Verified no dangling imports via grep

### Phase 6: Build verification

`pnpm build` passes. `/segments` (static) and `/segments/[id]` (dynamic) confirmed in route output.

## Key Technical Decisions

- **Mock-first data strategy for detail route**: `MOCK_SEGMENTS.find()` checked synchronously before API fetch. This matches how playbooks handle mock vs. saved data and avoids unnecessary API calls for demo content.
- **Sidebar uses sync data only**: All sidebar panels use synchronous in-memory stores or static data. No `useEffect` in panels. Segments follows this by importing `MOCK_SEGMENTS` directly.
- **Response parsing for navigation**: The chat page's `handleCreateSegment` previously checked `res.ok` but never parsed the body. Had to add `await res.json()` to extract the segment ID for navigation.
- **Breadcrumb pattern**: Matches Metrics detail page — "Segments / {name}" with clickable back link.

## Prevention Strategies

### New Sidebar Feature Checklist

Before adding any new feature to the sidebar, verify:

- [ ] Sidebar icon added to rail with `router.push("/feature")`
- [ ] `HoverPanel` type union includes the new feature name
- [ ] Sidebar panel component shows compact item list (sync data, max 8 items)
- [ ] Landing page at `/feature` uses full-width table/grid with Sidebar wrapper
- [ ] Detail page at `/feature/[id]` uses full-width layout with Sidebar wrapper and breadcrumb
- [ ] No split-panel layouts that duplicate the sidebar's navigation role
- [ ] `activePage` prop passed correctly to highlight the active sidebar icon

### Architecture Rule

**Features should be Next.js routes, not in-page state switches.** Routes survive merges because they're isolated files. State-based views (`activeView`) are fragile because their triggers live in shared files that get overwritten during conflict resolution.

### 3-Tier Pattern Reference

| Tier | Width | Data Source | Navigation |
|------|-------|-------------|------------|
| Sidebar panel | 220px hover | Sync (store/mock) | Click item → `/feature/{id}` |
| Landing page | Full width | Async (API + mock merge) | Row click → `/feature/{id}` |
| Detail route | Full width | Mock check → API fallback | Breadcrumb → `/feature` |

## Related Documentation

- `docs/solutions/integration-issues/post-merge-missing-navigation-entry-point.md` — The predecessor issue: segments navigation was completely broken after merge
- `docs/solutions/design-patterns/segment-detail-panel-ux-patterns.md` — React state patterns, query optimization, and keyboard nav for the detail panel
- `docs/solutions/design-patterns/follow-up-actions-card-redesign.md` — Component merging pattern and brand icon registry
- `docs/brainstorms/2026-02-17-segments-sidebar-consolidation-brainstorm.md` — Design decisions for this consolidation
- `docs/plans/2026-02-17-feat-segments-sidebar-consolidation-plan.md` — Full implementation plan with acceptance criteria
