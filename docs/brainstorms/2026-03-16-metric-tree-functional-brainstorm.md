# Metric Tree — Make It Functional

**Date:** 2026-03-16
**Status:** Ready for planning

## What We're Building

The metric tree is currently broken — hardcoded ecommerce metrics with fake values and hand-crafted relationships that don't apply to any other dataset. We're making it fully functional:

1. **Kill PRESEEDED_METRICS** — no more hardcoded mock data. Every dataset (including ecommerce) uses `metrics.json` with real SQL-computed values from DuckDB.

2. **LLM-inferred relationships** — a separate LLM call takes the existing generated metrics (names, formulas, SQL) and produces the causal/compositional relationship graph. This is a dedicated inference step, not part of the original metric generation.

3. **Dynamic categories** — the LLM assigns domain-appropriate categories during relationship inference (e.g., "Operations", "Quality" for support datasets). The toolbar filters adapt dynamically instead of being hardcoded to 4 ecommerce categories.

4. **Dual trigger** — relationship inference runs both:
   - As a second pass after `POST /api/metrics/generate` (new datasets get relationships immediately)
   - Lazily on metric tree page load if metrics exist but lack relationships (backfills existing datasets)

## Why This Approach

- **Separate relationship inference** is more reliable than single-pass generation. The LLM can see all metrics at once and reason about the full graph, rather than trying to wire up relationships while also generating SQL.
- **Killing preseeded data** eliminates the two-code-path problem where ecommerce works differently from every other dataset.
- **Dynamic categories** make the tree genuinely useful for any domain — a lending dataset shouldn't show "Acquisition/Engagement/Revenue/Monetization".
- **Lazy backfill** means existing datasets get relationships without manual regeneration.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Relationship source | LLM inference from existing metrics | Can see the full metric list and reason about graph structure |
| Categories | LLM-assigned, dynamic | Domain-appropriate, no ecommerce assumptions |
| When to infer | Generate-time + lazy backfill | Covers new and existing datasets |
| Preseeded data | Remove entirely | One code path for all datasets |
| Persistence | Write relationships back to `metrics.json` | Cache result, don't re-infer every page load |

## Scope

### In scope
- New API endpoint or extension for relationship inference
- LLM prompt for relationship + category inference
- Update metric generation pipeline with second pass
- Lazy backfill on tree page load
- Dynamic category filter in toolbar
- Remove `PRESEEDED_METRICS` and hardcoded `MetricCategory` type
- Update `metric-store.ts`, `metric-data.ts`, API routes

### Out of scope
- Changing how metrics are generated (SQL, values, time series) — that already works
- Metric detail pages (`/metrics/[id]`) — separate concern
- Tree layout algorithm changes — it already handles relationships correctly when they exist
- New visualization modes (e.g., force-directed graph)

## Open Questions

None — all key decisions resolved.
