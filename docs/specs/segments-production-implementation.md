# Segments production implementation

## Context
For the segments/cohorts walkthrough around `/segments` and `/segments/[id]`.

PostHog is the reference mainly for the model: persons/users, events, properties, cohorts, and HogQL. We should reuse that thinking, not copy every screen.

## What the demo already has
`/segments`:
- saved segment list, search, active/archive split
- visual rule builder
- did / did not event rules
- frequency rules
- event property filters
- time window
- live SQL, count, trend chart
- compare draft with saved segments
- starter segment generation

`/segments/[id]`:
- overview trend
- composition breakdowns
- users table
- overlap with other segments
- SQL viewer
- CleverTap sync + campaigns
- segment context injected into chat

Production work is not starting from zero. It is making this durable, safe, multi-tenant, and backed by a real cohort DSL.

## Product expectation
Segments should be living audiences, not saved SQL.

User should be able to define an audience from events/properties, trust the count, inspect actual users, see trend over time, compare with other segments, use it in chat/funnels/retention/metrics/playbooks, and push it to destinations.

Default should be dynamic segments. Static snapshot can come later, but schema should allow it.

## Production model
Store:
- `definition_json`: our cohort DSL
- `compiled_query`: generated HogQL / SQL

Raw SQL should not be the source of truth.

Tables:
- `segments`
- `segment_memberships`
- `segment_runs`
- `segment_exports`

Key fields:
- workspace_id, dataset_id, created_by
- type: dynamic/static
- status: active/stale/failed/snapshot
- refresh_cadence, member_count, last_run_at

All writes should be idempotent upserts.

## DSL MVP
Support:
- event did / did not
- occurrence count
- event property filters
- person property filters
- AND / OR
- time window

Example:

```json
{
  "combinator": "AND",
  "dateRange": { "preset": "30d" },
  "rules": [
    {
      "kind": "event",
      "event": "checkout_completed",
      "action": "did",
      "occurrence": { "op": "gte", "value": 1 },
      "filters": [{ "property": "country", "operator": "eq", "value": "India" }]
    },
    { "kind": "event", "event": "purchase", "action": "did_not" }
  ]
}
```

Later: nested groups, segment-inside-segment, sequence rules, static snapshot UI.

## Query layer
Compiler should be adapter based:
- DSL -> HogQL for PostHog
- DSL -> SQL for warehouse/customer DB

Validation:
- SELECT only
- no DDL/DML
- stable user id required
- no LIMIT in saved definition
- count before save
- warn on zero/tiny/everyone counts

## Refresh
Dynamic segment flow:
1. compile definition
2. run query
3. materialize membership
4. write run history
5. update count/status

Cadence: manual, daily, weekly. Do not overbuild custom schedules now.

## Route behavior
`/segments` should keep current shape, but read production segment metadata, show last successful count, status, destination sync state, and scope by workspace/dataset/RBAC.

`/segments/[id]` should use materialized membership and run history. Tabs: Overview, Composition, Users, Overlap, Activity.

Chat should auto-scope to the segment. User should ask follow-ups without re-explaining the cohort.

## Activation
MVP destinations: CleverTap and CSV/warehouse export.

Rules:
- export latest materialized membership
- record export run
- retry safely
- campaigns should take `segment_id`, not arbitrary client SQL

## Walkthrough decisions
Decide only:
- MVP rule set
- is PostHog/HogQL the first backend
- dynamic-only MVP or static too
- refresh/materialization contract
- destination push contract
- where segments appear outside `/segments`

## Build order
1. Lock DSL + schema.
2. Save DSL from current builder.
3. Add HogQL/SQL compiler adapter.
4. Add membership runs.
5. Move `/segments` to production metadata.
6. Move `/segments/[id]` to materialized users + run history.
7. Wire activation to `segment_id`.
8. Reuse segments in chat, funnels, retention, metrics, playbooks.

## Non-goals
Full PostHog clone, nested builder, custom cron, approval workflow, all destinations.

MVP goal: define audience, trust count, inspect users, activate audience.
