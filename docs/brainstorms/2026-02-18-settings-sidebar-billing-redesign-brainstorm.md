# Settings Sidebar + Billing Redesign

**Date:** 2026-02-18
**Status:** Ready for planning

## What We're Building

Replace the dedicated "Billing" rail icon in the sidebar with a "Settings" gear icon. The Settings panel shows a clean link list (Billing + placeholder items). The `/billing` page is redesigned to show cost breakdowns by **team** and by **analysis mode** instead of per-query transaction history.

## Why This Approach

- The current Billing rail icon adds a single-purpose item to an already crowded sidebar
- A Settings entry point is more extensible — future items (Notifications, API Keys, Team Management) slot in naturally
- Per-query transaction history isn't useful for decision-makers; team and mode breakdowns are actionable
- Panel-as-link-list keeps the sidebar fast and simple (no charts in 220px)

## Key Decisions

1. **Settings replaces Billing on the rail** — gear/dial icon, same position (bottom of rail)
2. **Panel is a link list**, not a data display:
   - Billing (active, navigates to `/billing`) — shows balance preview "552 credits"
   - Notifications (grayed, "Coming soon")
   - API Keys (grayed, "Coming soon")
3. **Billing page redesign** — remove per-query transaction table, replace with:
   - **Balance overview** (keep existing large number + progress bar)
   - **Cost by team** — horizontal bars for 3-4 hardcoded demo teams (Growth, Product, Engineering)
   - **Cost by mode** — Deep Research vs Quick Answer breakdown only (no Direct Chat)
4. **Teams are hardcoded demo data** — this is a prototype, no real team management
5. **Credit packs section** — keep or remove from billing page (TBD in planning)

## Scope

### In Scope
- Replace Billing rail icon → Settings gear icon
- New Settings panel with link list
- Update `HoverPanel` type union, `getActivePage`, `pageToPanel` mappings
- Redesign `/billing` page with team + mode breakdowns
- Add mock team data to credit store or billing page
- Aggregate transactions by `queryMode` for mode breakdown

### Out of Scope
- Real team management / assignment
- Notifications or API Keys functionality
- Changes to credit deduction flow or per-message badges
- Canvas or chat changes

## Open Questions

- Should the credit packs (purchase options) remain on the billing page or be removed?
- Exact visual treatment for the team/mode breakdown charts (bars, donuts, simple numbers?)
