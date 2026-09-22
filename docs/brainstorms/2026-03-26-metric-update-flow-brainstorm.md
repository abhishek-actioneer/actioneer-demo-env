# Metric Update Flow — Brainstorm

**Date:** 2026-03-26
**Status:** Ready for planning

## What We're Building

A richer metric update flow that supports both AI-driven and manual editing, works from any page via @ mentions, and keeps everything on a single surface (the confirm card in sidebar chat).

### Current Gaps

| Change | Works today? | Gap |
|--------|-------------|-----|
| Formula/SQL logic via natural language | Yes | Only from metric detail page |
| Change table | No | No table picker in update flow |
| Rename metric | No | No `newName` in LLM output or card UI |
| Direct SQL edit/paste | No | SQL is read-only display |
| Formula sync after manual SQL edit | No | Formula and SQL are decoupled |
| Update from any page | No | Classifier requires `pageEntity.type === "metric"` |

## Key Decisions

### 1. Single surface — everything on the confirm card

No split between sidebar and detail page for editing. The confirm card in sidebar chat is the sole editing surface. It handles:
- AI-driven edits (chips, natural language input)
- Manual SQL editing (tap to edit, paste, validate)
- Name editing (tap to edit inline)
- Table switching (pre-selected table card, change option)

### 2. @ mention enables metric updates from any page

User can say `"update @Revenue to exclude refunds"` from any page. The classifier no longer requires `pageEntity.type === "metric"`. The @ mention resolves to a metric ID, and the metric's current data is fetched from the client metric store (`getAllMetrics()`).

### 3. Table selection — show pre-selected, allow change

When updating an existing metric, show the table-select card with the current table pre-selected and confirmed. User can tap "Change" to pick a different table. This reuses the creation flow's table picker.

### 4. Manual SQL editing — escape hatch, not primary

Most users will use AI-driven edits. Manual SQL editing exists for when the AI gets it wrong. UX:
- Tap the SQL block → textarea appears with raw SQL
- Edit or paste → "Validate" button runs against DuckDB (no LLM)
- Instant validation result (computed value or error)
- Formula auto-updates via a background LLM call with a subtle note: "Updating formula..."

### 5. Name editing — tap to edit on card + chat

Metric name on the card header is tappable → becomes inline input → instant rename (no LLM). Also expressible via chat: "rename to X". Both paths update the same card state.

### 6. Formula sync after manual SQL edit

After manual SQL validation succeeds:
1. Show computed value immediately
2. Show subtle note: "Formula may not match — updating..."
3. Fire background LLM call to regenerate formula from the new SQL
4. Update formula on card when ready (~2s)

User sees validation result instantly; formula catches up.

### 7. Old data source for diffs

When updating via @ mention (not on detail page), the "old" values come from the client metric store (`getAllMetrics()` lookup by metric ID). No server fetch needed — metrics are already loaded.

## Implementation Scope

### New: `/api/metric-validate` endpoint
- Accepts `valueSql` + `timeSeriesSql` + `datasetId`
- Executes both against DuckDB
- Returns `{ computedValue, timeSeries, sqlValid, sqlErrors }`
- No Gemini, no generation — pure validation
- Used by manual SQL edit flow

### New: `/api/metric-formula` endpoint (or extend validate)
- Accepts `sql` + `metricName` + `description`
- Quick Gemini call to generate a formula from SQL
- Returns `{ formula }`
- Used after manual SQL edit to sync formula

### Changed: Classifier (`classify.ts`)
- Support `metric_update` mode without `pageEntity`
- Detect @ mentioned metric name/ID in the query
- Extract metric reference from @ mention context

### Changed: `use-analytics.ts`
- Route `metric_update` without requiring `pageEntity.type === "metric"`
- Resolve metric from @ mention → client store lookup
- Show pre-selected table card before generating card

### Changed: `metric-update-confirm-card.tsx`
- Metric name: tappable → inline input
- SQL section: tappable → textarea with Validate/Cancel bar
- Add `newName` to card data schema
- Handle manual validation state (local, no message status change)
- Show formula sync loading state

### Changed: `/api/metric-update` response schema
- Add `newName` field to LLM output when rename is requested
- LLM prompt update to support name changes

### Changed: `handleMetricEdit` in `chat-thread.tsx`
- Support manual SQL validation (no LLM, just validate endpoint)
- Support name changes (update card data in-place)
- Support formula sync after manual edit

### Changed: `handleMetricUpdatePublish` in `use-action-handlers.ts`
- Handle name changes (update metric name in store + server)
- Handle table changes (update metric table reference)

## Open Questions

_None — all resolved during brainstorm._

## Out of Scope

- Editing value format (currency/percent/number) from the card
- Editing metric type/category from the card
- Direct formula editing without SQL change (formula is derived from SQL)
- Metric duplication/cloning
