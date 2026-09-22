---
date: 2026-02-16
topic: segments-and-actions
---

# Segments, Follow-up Actions & Integration Manager

## What We're Building

Four interconnected features that transform Baby Sentinel from a read-only analytics tool into an insight-to-action platform:

1. **Generic Follow-up Action Bar** — After any analysis completes, contextual action chips appear below the response. Segment queries get "Create Segment" / "Refine Filters". Metric queries get placeholder actions: "Schedule Report", "Share via Slack", "Set Alert". Extensible, data-driven system.

2. **Segment Creation via Chat** — Clicking "Create Segment" opens a modal with auto-generated name, underlying SQL, live user count preview, and a Create button. Segments are saved SQL queries stored in DuckDB. User lists conceptually auto-refresh (~1 min).

3. **Segments Page** — New sidebar nav item "Segments" opening a full-page management view. Segment cards show name, user count, creation date, source conversation, and push status per integration. Detail view with user list preview and push actions.

4. **Integration Manager (inside Data Connectors)** — "Destinations" section within the existing Data Connectors page. Mock cards for Firebase, CleverTap, BigQuery with connect/disconnect toggle and status. Prototype UI only — no real API calls.

## Why This Approach

- **Saved SQL query model** — Segments are living queries, not frozen snapshots. This keeps the architecture simple (no separate user-ID storage) and aligns with how analysts think about cohorts.
- **DuckDB for persistence** — Avoids adding new infrastructure. The database is already the core of the app. Adding write tables for segments/integrations is natural.
- **Generic action system** — Building the follow-up bar as extensible from day one avoids rework when alerts/reports/sharing are added later. The LLM already classifies queries — it can also tag relevant action types.
- **Mock integrations** — Keeps scope manageable. The full UI flow is prototyped without the complexity of real API auth flows.

## Key Decisions

- **Segment = saved SQL query** in DuckDB, re-executed to get fresh user lists. Frontend shows auto-refreshing count.
- **Follow-up actions are generic** — not segment-specific. Placeholder UX for alerts, reports, sharing included.
- **Segments page** is a full-page view accessed from sidebar (same level as Data Connectors, Schema, Knowledge).
- **Integration management** lives inside the existing Data Connectors page as a "Destinations" section.
- **Segment creation** uses a modal dialog with name, SQL preview, user count, and confirm button.
- **Persistence** in DuckDB tables (`segments`, `integrations`, `segment_pushes`).
- **All integration pushes are mocked** — UI shows the full flow but no real external API calls.

## Open Questions

- Should the LLM determine which actions to suggest, or should we use heuristics (e.g., if query returns `user_id` column → suggest "Create Segment")?
- What's the exact refresh mechanism for segment user counts? True polling vs. refresh-on-view?
- Should segment detail view show the actual user rows, or just aggregate stats (count, top categories, etc.)?

## Next Steps

-> `/workflows:plan` for implementation details across all four features.
