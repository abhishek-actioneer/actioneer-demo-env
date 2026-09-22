---
title: "feat: Metric Update Flow Enhancement"
type: feat
status: completed
date: 2026-03-26
origin: docs/brainstorms/2026-03-26-metric-update-flow-brainstorm.md
---

# feat: Metric Update Flow Enhancement

## Overview

Enhance the metric update flow to support: (1) AI-driven updates from any page via @ mentions, (2) manual SQL editing/pasting on the confirm card, (3) inline name editing, and (4) table switching on existing metrics. All editing happens on a single surface — the confirm card in sidebar chat.

## Problem Statement

Currently, metric updates only work from the metric detail page (classifier requires `pageEntity.type === "metric"`). The confirm card is read-only for SQL/name. Users can't directly edit SQL, change the table, or rename a metric — they must describe every change in natural language and wait for the LLM. Simple fixes (typo in SQL, rename) take 5+ seconds through an unnecessary LLM round-trip.

## Proposed Solution

Keep the confirm card as the single editing surface, but make it smarter:

- **@ mention routing**: Extract metric context from `contextRefs` (not just `pageEntity`) and pass to classifier. Update routing guard to check both sources.
- **Manual SQL editing**: Tap SQL block → textarea → Validate button (DuckDB execution, no LLM) → background formula sync via LLM.
- **Inline name editing**: Tap metric name → inline input → instant update.
- **Table switching**: Show pre-confirmed table-select card on updates with "Change" affordance.

## Technical Approach

### Architecture

The key structural change is decoupling `metric_update` classification from `pageEntity`. Today's flow:

```
pageEntity (detail page only) → metricEntityCtx → classifier → metric_update guard
```

New flow:

```
pageEntity OR contextRef (@ mention) → resolvedMetric → metricEntityCtx → classifier → metric_update guard
```

A `resolvedMetric` variable is computed before classification by checking `pageEntity` first, then falling back to the first metric-type `contextRef`. This single variable feeds both the classifier and the update routing.

### Implementation Phases

#### Phase 1: @ Mention Routing (Foundation)

Enable `metric_update` from any page via @ mentions. This unblocks all other phases.

**Files changed:**

**`src/hooks/use-analytics.ts`** (~lines 270-483)
- Before classification (line 270), compute `resolvedMetric`:
  ```typescript
  // Resolve metric from pageEntity OR first metric-type contextRef
  let resolvedMetric: Metric | null = null;
  if (pageEntity?.type === "metric" && pageEntity.contextPayload) {
    resolvedMetric = pageEntity.contextPayload as unknown as Metric;
  } else if (contextRefs?.length) {
    const metricRef = contextRefs.find(r => r.type === "metric");
    if (metricRef?.contextPayload) {
      resolvedMetric = metricRef.contextPayload as unknown as Metric;
    }
  }
  ```
- Build `metricEntityCtx` from `resolvedMetric` instead of `pageEntity` (line 271-273)
- Update the `metric_update` guard (line 413) from:
  ```typescript
  if (queryMode === "metric_update" && pageEntity?.type === "metric" && pageEntity.contextPayload)
  ```
  to:
  ```typescript
  if (queryMode === "metric_update" && resolvedMetric)
  ```
- Use `resolvedMetric` instead of `metricPayload` throughout the metric_update block (lines 414-483)

**`src/lib/prompts/classify.ts`** (~line 16, 91-93)
- Change `metric_update` mode description from "This ONLY applies when a metricEntityContext is provided (meaning the user is on a metric detail page)" to "This ONLY applies when a metricEntityContext is provided (from the metric detail page OR an @ mentioned metric)"
- Update the dynamic block (lines 91-93) to say "metric entity context (from page or @ mention)" instead of "the user is on a metric detail page"

**`src/lib/entity-registry.ts`** (~lines 52-77)
- Verify that the metric `contextPayload` built by `buildEntityCatalog` includes all fields needed by the update flow: `id`, `name`, `description`, `formula`, `sql`, `table`, `column`, `timeColumn`, `aggregation`, `relationships`, `version`. Cross-reference with `pageEntity` payload set at `metrics/[id]/page.tsx:322-346`. Fill any missing fields.

**Acceptance criteria:**
- [ ] User can type `update @MetricName to exclude refunds` from the home page and get a confirm card
- [ ] User can type the same from any page (segments, playbooks, etc.)
- [ ] Classifier correctly distinguishes `metric_update` vs `analytics` when a metric is @ mentioned (e.g., "what's the trend of @Revenue" → analytics, not update)
- [ ] If multiple metrics are @ mentioned, the first one is used for the update flow
- [ ] Works identically to the existing detail-page flow when on a metric detail page

---

#### Phase 2: Table Selection for Updates

Show a pre-confirmed table-select card when updating existing metrics, with a "Change" affordance.

**Files changed:**

**`src/hooks/use-analytics.ts`** (metric_update block, ~lines 413-483)
- After the `metric_update` guard, instead of jumping straight to the "Analyzing metric change..." streaming placeholder, insert a `metric-table-select` card message with:
  ```typescript
  metricTableSelect: {
    metricId: resolvedMetric.id,
    metricName: resolvedMetric.name,
    description: resolvedMetric.description,
    tables: [], // load async, same as creation
    selectedTable: resolvedMetric.table,
    status: "confirmed", // pre-confirmed
    suggestedRelatedMetrics: [],
  }
  ```
- Fetch tables async and update the card (same pattern as creation flow at lines 143-153)
- The table-select card auto-proceeds to the generating card since it's pre-confirmed

**`src/components/chat/metric-table-select-card.tsx`**
- When `status === "confirmed"`, add a "Change" button/link next to the selected table display
- Clicking "Change" resets `status` to `"pending"` and shows the full table picker
- When user re-selects, it calls `onSelect` as normal (re-triggering the generation pipeline)

**`src/components/chat/chat-thread.tsx`** (`handleMetricTableSelect`)
- Update to handle the case where this is an update (not creation). When the metric already exists in the store (`version > 0`), pass the existing metric's data (current SQL, formula, table) to the generation API so the LLM can produce a proper diff, not a fresh creation.
- The `userRequest` for table change should be: `"Switch metric '{name}' to use the '{newTable}' table. Preserve the original intent: {description}"`

**Acceptance criteria:**
- [ ] Update flow shows table card with current table pre-confirmed
- [ ] "Change" button resets to table picker
- [ ] Selecting a new table triggers full re-generation with the new table's schema
- [ ] The resulting confirm card shows a diff (old SQL from original table vs new SQL from new table)
- [ ] If user doesn't change table, flow proceeds without re-generation

---

#### Phase 3: Manual SQL Editing + Validation

Add a `POST /api/metric-validate` endpoint and make the SQL block on the confirm card editable.

**New file: `src/app/api/metric-validate/route.ts`**

Lightweight validation endpoint — executes SQL against DuckDB, no LLM:

```typescript
// Request: { valueSql?: string, timeSeriesSql: string, datasetId (from header) }
// Response: { computedValue, timeSeries, sqlValid, sqlErrors }
```

- Uses `executeSQLInternal` (same as metric-update route)
- If only `timeSeriesSql` is provided, auto-derive `valueSql` by wrapping: `SELECT (last row value approach)` or simply extract from the time series result (last point as value)
- Applies `validateSQL()` from `sql-executor.ts` first (SELECT-only guard)
- Uses `friendlyError()` for OOM and other DuckDB errors

**New file: `src/app/api/metric-formula/route.ts`**

Quick formula generation from SQL — lightweight LLM call:

```typescript
// Request: { sql: string, metricName: string, description: string }
// Response: { formula: string }
```

- Short Gemini call with a focused prompt: "Given this SQL and metric name, write a concise formula expression (e.g., `SUM(revenue) / COUNT(DISTINCT users)`)."
- `maxOutputTokens: 256` — formula is always short
- No retry loop needed (formula is non-critical)

**Changed file: `src/components/chat/metric-update-confirm-card.tsx`**

Add SQL editing capability to the `SqlSection` component:

- SQL block becomes tappable. On tap → swap `<pre>` for `<textarea>` with the raw SQL text
- Textarea: monospace `text-[11px]`, `whitespace-pre-wrap`, auto-resize height (min 3 rows, max ~200px with scroll), `break-words` for narrow sidebar
- Small action bar below textarea: "Validate" button (left) + "Cancel" (right, text-only)
- When editing: "Publish for review" button is disabled (must validate first)
- On Validate click:
  1. Show inline spinner on the Validate button
  2. Call `POST /api/metric-validate` with the textarea content
  3. If valid: update card's `newSql`, `computedValue`, `sqlValid`, `sqlErrors` in local state. Close textarea, show diff view with updated SQL. Show subtle note below formula: "Updating formula..." then call `POST /api/metric-formula` in background
  4. If error: show error inline below textarea (red text, same style as existing error banner). Keep textarea open so user can fix.
- On Cancel: revert textarea to previous `newSql` value, close textarea
- On formula response: update `newFormula` on card. If formula call fails, leave existing formula with subtle muted note "Could not update formula"

**Props change**: Add `onManualSqlUpdate: (msgId: string, newSql: string) => void` callback. This lets chat-thread update the message state when SQL is validated.

Alternatively, keep the validate/formula calls **inside the card component** using local state + `apiFetch` directly, and only call `onManualSqlUpdate` to persist the final validated result to the message. This keeps the card self-contained (matching the existing pattern where `onEdit` triggers the API call, but here the card owns the validate call since it's not LLM-driven).

**Decision: Card owns the validate call.** The manual SQL edit is a local interaction (textarea → validate → show result). The card calls `apiFetch("/api/metric-validate")` directly, updates its own local display state, and calls `onManualSqlUpdate(msgId, validatedSql)` to persist to the message when validation succeeds. This matches the self-contained edit principle. The formula background call also happens inside the card.

**Changed file: `src/components/chat/chat-thread.tsx`**

Add `handleManualSqlUpdate` callback:

```typescript
const handleManualSqlUpdate = useCallback((msgId: string, data: {
  newSql: string;
  valueSql?: string;
  computedValue?: number | null;
  sqlValid: boolean;
  sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null };
  newFormula?: string;
}) => {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === msgId && m.metricUpdateConfirm
        ? {
            ...m,
            metricUpdateConfirm: {
              ...m.metricUpdateConfirm,
              oldSql: m.metricUpdateConfirm!.newSql, // shift diff
              newSql: data.newSql,
              valueSql: data.valueSql,
              timeSeriesSql: data.newSql,
              computedValue: data.computedValue,
              sqlValid: data.sqlValid,
              sqlErrors: data.sqlErrors,
              ...(data.newFormula ? {
                oldFormula: m.metricUpdateConfirm!.newFormula,
                newFormula: data.newFormula,
              } : {}),
            },
          }
        : m
    )
  );
}, [setMessages]);
```

**Acceptance criteria:**
- [ ] User can tap SQL block → textarea appears with raw SQL
- [ ] User can edit or paste SQL in the textarea
- [ ] "Validate" runs SQL against DuckDB and shows computed value or error
- [ ] Publish is disabled while SQL has unvalidated changes
- [ ] After validation, formula auto-updates via background LLM call
- [ ] If formula call fails, card shows existing formula with note
- [ ] Cancel reverts to previous SQL
- [ ] Error states show inline below textarea (not a toast)
- [ ] Works in ~350px sidebar width (wrapping, reasonable textarea height)

---

#### Phase 4: Inline Name Editing

Make the metric name on the confirm card header tappable and editable.

**Changed file: `src/components/chat/metric-update-confirm-card.tsx`**

- Wrap the metric name `<p>` in a click handler
- On click → swap to `<input>` with current name, auto-focus, select all
- On Enter or blur → update local name state, call `onNameChange(msgId, newName)`
- On Escape → revert to original name
- Validation: non-empty, trimmed, max 100 chars. If empty on blur, revert.
- No LLM call — instant update

**Changed file: `src/lib/types.ts`** (ChatMessage type)

Add `newName?: string` to `metricUpdateConfirm` data shape. `metricName` stays as the original name (for diffing if desired). `newName` is the user's edited name. If `newName` is not set, the name hasn't been changed.

**Changed file: `src/components/chat/chat-thread.tsx`**

Add `handleMetricNameChange` callback:

```typescript
const handleMetricNameChange = useCallback((msgId: string, newName: string) => {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === msgId && m.metricUpdateConfirm
        ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, newName } }
        : m
    )
  );
}, [setMessages]);
```

**Changed file: `src/hooks/use-action-handlers.ts`** (`handleMetricUpdatePublish`)

When publishing, if `confirm.newName` is set:
- Update metric name in client store: `updateMetric(datasetId, confirm.metricId, { name: confirm.newName })`
- Use `confirm.newName` as the metric name in the pending update
- If persisting to server (new metric), use `confirm.newName` in the definition

**Also support via chat**: The LLM prompt in `/api/metric-update` should support a rename request. Add `"newName"` to the JSON output schema. When the user says "rename to X" via the edit input, the LLM returns `newName` and the card updates accordingly (same as inline edit but LLM-driven).

**Acceptance criteria:**
- [ ] User can click metric name → inline input → type new name → Enter to confirm
- [ ] Escape reverts to original name
- [ ] Empty name on blur reverts (no empty names)
- [ ] Published update carries the new name
- [ ] Name change also works via chat edit input ("rename to X")
- [ ] Card header shows the current (possibly edited) name

---

### Bug Fix (Pre-requisite)

**Fix CSS class typo in `metric-update-confirm-card.tsx`**

Lines 65 and 72 have `text-emerald-500whitespace-pre-wrap` — missing space. Should be `text-emerald-500 whitespace-pre-wrap`. Fix before building more UI on this component.

## System-Wide Impact

- **Classifier prompt**: Minor change to `metric_update` description and dynamic context block. No impact on other classification modes.
- **Entity catalog**: No schema change — metric entities already carry full `contextPayload`. Just verify completeness.
- **Chat message type**: Adding `newName` optional field to `metricUpdateConfirm`. Non-breaking — existing cards without `newName` work as before.
- **API surface**: Two new endpoints (`/api/metric-validate`, `/api/metric-formula`). No changes to existing endpoints except adding `newName` to `/api/metric-update` output.
- **Store mutations**: Name changes go through existing `updateMetric()` path. No new store functions needed.

## Acceptance Criteria

### Functional

- [x] Metric updates work from any page via @ mention
- [ ] Metric updates still work from the detail page (existing flow preserved)
- [x] Manual SQL editing with validation works on the confirm card
- [x] Inline name editing works on the confirm card
- [x] Table switching works on existing metrics
- [ ] All edits (AI, manual SQL, name, table) converge to the same publish flow
- [x] Formula auto-syncs after manual SQL changes

### Non-Functional

- [ ] Manual SQL validation completes in <1s (no LLM, just DuckDB execution)
- [ ] Formula sync completes in <3s (lightweight LLM call)
- [ ] All UI fits within ~350px sidebar width
- [ ] Monochrome styling maintained throughout
- [ ] All API calls use `apiFetch` (never raw `fetch`)

## Dependencies & Risks

**Risk: Classifier accuracy with @ mentions.** The classifier may struggle to distinguish "update @Revenue to exclude refunds" (metric_update) from "what happened to @Revenue last week" (analytics) when the only context is an @ mention. Mitigated by: strong examples in the classifier prompt, explicit bias rules.

**Risk: Manual SQL validation endpoint could be abused.** Users could execute arbitrary SQL. Mitigated by: `validateSQL()` SELECT-only guard, `executeSQLInternal` applies the same restrictions as analytics queries.

**Risk: Background formula generation race condition.** User validates SQL, formula LLM fires, user validates again before formula returns. Mitigated by: abort previous formula request when new validation starts (use AbortController inside the card).

**Dependency: Entity catalog must include all Metric fields.** If `buildEntityCatalog` doesn't include `table`, `column`, `timeColumn`, the update flow will fail. Verify during Phase 1.

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-26-metric-update-flow-brainstorm.md](docs/brainstorms/2026-03-26-metric-update-flow-brainstorm.md) — Key decisions: single editing surface, @ mention support, manual SQL as escape hatch, formula auto-sync via background LLM.

### Internal References

- Classifier prompt: `src/lib/prompts/classify.ts:12-98`
- Classifier API: `src/app/api/classify/route.ts:28-39`
- Metric update routing: `src/hooks/use-analytics.ts:270-483`
- Confirm card component: `src/components/chat/metric-update-confirm-card.tsx`
- Self-contained edit handler: `src/components/chat/chat-thread.tsx:132-215`
- Table select card: `src/components/chat/metric-table-select-card.tsx`
- Metric entity in catalog: `src/lib/entity-registry.ts:52-77`
- Page entity setup: `src/app/metrics/[id]/page.tsx:322-346`
- Pending update store: `src/lib/metric-update-store.ts`
- SQL validation: `src/lib/sql-executor.ts:72-84`
- Learnings — client/server store split: `docs/solutions/logic-errors/inmemory-store-api-generated-data-ui-rendering-split.md`
- Learnings — classifier drift: `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md`

### Institutional Learnings Applied

- **API response must include data** — `/api/metric-validate` and `/api/metric-formula` return full result objects; client saves to store from response, never reads server store directly
- **Error surfacing** — catch `ApiError` specifically, surface `err.message` (not bare catch)
- **Form state reset** — use "adjust state during render" pattern if switching between metric contexts
- **Classifier hardening** — explicit examples for metric_update vs analytics with @ mentions
