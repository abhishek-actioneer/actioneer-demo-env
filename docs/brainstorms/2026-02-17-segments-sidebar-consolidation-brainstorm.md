---
date: 2026-02-17
topic: segments-sidebar-consolidation
---

# Segments: Merge List into Sidebar Panel

## What We're Building

Migrate the segments feature from a split-panel layout (list + detail side-by-side) to the Metrics/Playbooks pattern: compact segment list in the sidebar hover panel, a full-width table landing page at `/segments`, and a full-width detail page at `/segments/{id}`.

This eliminates the redundancy between the sidebar panel and the page's own left pane, and brings segments in line with every other sidebar feature.

## Why This Approach

The current split-panel layout duplicates the sidebar's purpose — the sidebar has a "Segments" panel AND the page has its own list pane. The Metrics/Playbooks pattern is already established and understood by users: sidebar for quick navigation, landing page for full browsing, detail page for deep interaction.

Approaches considered:
- **Metrics/Playbooks pattern** (chosen): 3-tier (sidebar panel → landing table → detail route). Consistent with rest of app.
- **Enriched sidebar + grid landing**: Would work but diverges from existing table pattern.
- **Sidebar-only, no landing page**: Too constrained for power users managing many segments.

## Key Decisions

- **Sidebar panel**: Compact density matching MetricsPanel — status dot + name + one-line subtitle, ~8 items, "View All →" footer
- **Landing page (`/segments`)**: Table layout matching `/metrics` — columns for Name, Status, User Count, Destinations, Created. Search bar + filters.
- **Detail page (`/segments/{id}`)**: Current detail panel content (SQL query, user count, user preview, push destinations, refresh/archive actions) rendered full-width instead of in a side panel. No chart for now.
- **`SegmentsPage` component**: Will be replaced. Its list logic moves to the sidebar panel + landing page. Its detail panel becomes the `{id}` route.

## Architecture Changes

### New files
- `src/app/segments/[id]/page.tsx` — Detail route wrapping `SegmentDetailPanel` full-width

### Modified files
- `src/components/sidebar.tsx` — Replace placeholder `SegmentsPanel` with real segment list (fetch from store/API)
- `src/app/segments/page.tsx` — Rewrite from SegmentsPage wrapper to full-width table (like MetricsPage)
- `src/components/segments/segment-detail-panel.tsx` — May need adjustments for full-width rendering (currently designed for side panel)

### Potentially removable
- `src/components/segments/segments-page.tsx` — Split-panel layout no longer needed
- `src/components/segments/segment-list-card.tsx` — If table rows replace cards (sidebar uses its own compact format)

## Open Questions
- Should the sidebar panel fetch segments from API or use a client-side store (like metric-store)?
- Should the "Create Segment" button live on the landing page header (like "New Metric") or also in the sidebar panel?

## Next Steps
→ `/workflows:plan` for implementation details
