---
title: feat: Selective merge of metric changes from indresh-to-main
type: feat
date: 2026-03-24
---

# Selective Merge: Metric Changes from `indresh-to-main` → `feat-metrics-merge`

## Overview

Cherry-pick **only the metric-related changes** from `indresh-to-main` into `feat-metrics-merge`.
The source branch contains a large merge commit (`5c6b09b merge: metric-audit-flows-merged`) — so
this is a **file-level selective port**, not a commit cherry-pick. We port files individually,
applying full replacements where the new version supersedes the old, and manual patches where only
specific additions are needed.

### Scope from PDF

| # | Feature Area | Status |
|---|---|---|
| 1a | Metrics list — clean UI, no indicator/owner columns, pending-review badge | Phase 1 |
| 1b-h | Metric detail — collapsed/expanded states, changelog, data freshness, approval flow | Phase 1 |
| 2a-g | Chat creates metric (table picker → confirm card → publish → red dot) | Phase 2 |
| Side panel | Properties tab redesign (SQL diff, related metrics, data freshness, changelog) | Phase 3 |

### Explicit Exclusions

| File | Why excluded |
|---|---|
| `src/components/sidebar.tsx` | User explicitly excluded; large unrelated changes |
| `src/components/layout-shell.tsx` | Structural layout simplification not in PDF scope |
| `src/app/page.tsx` | Onboarding flow unrelated to metric changes |
| `src/proxy.ts` | `/onboarding` route bypass, unrelated |
| `README.md` | Docs only |

> **Red-dot exception**: `sidebar.tsx` in `indresh-to-main` adds `subscribePendingUpdates` / `hasPendingMetrics` + a `dot` prop on the Metrics `NavItem`. This IS needed (PDF item 2d — red dot shows up when a metric is published for review). Apply **only these three additions** as a manual patch in Phase 2 rather than pulling the full file.

---

## Phase 1 — Metrics Page UX

### 1.1 New files to bring in wholesale

These files don't exist on `feat-metrics-merge` yet. Port them verbatim:

```bash
git show indresh-to-main:src/components/metric/approval-modal.tsx       > src/components/metric/approval-modal.tsx
git show indresh-to-main:src/components/metric/metric-update-approval-modal.tsx > src/components/metric/metric-update-approval-modal.tsx
git show indresh-to-main:src/components/metric/sql-diff.tsx              > src/components/metric/sql-diff.tsx
git show indresh-to-main:src/app/api/metric-update/route.ts              > src/app/api/metric-update/route.ts
git show indresh-to-main:src/lib/metric-data.ts                          > src/lib/metric-data.ts
```

**What they do:**
- `approval-modal.tsx` — dialog asking "Approve only GMV" vs "Approve All" when a metric has related metrics that would be recalculated (PDF 1g)
- `metric-update-approval-modal.tsx` — modal for approving/rejecting pending updates in the Properties tab (PDF 1f–g). Shows old SQL vs new SQL side-by-side with `SqlDiff`, lists affected related metrics.
- `sql-diff.tsx` — side-by-side diff renderer for old SQL → new SQL (used in the approval modal and in the Properties tab pending state)
- `api/metric-update/route.ts` — POST endpoint that calls Gemini to analyze a metric update request and return `newSql`, `newFormula`, `explanation`, `affectedMetrics`
- `metric-data.ts` — 579-line file with `PRESEEDED_METRICS` seed data for the ecommerce dataset (all 12 metrics: GMV, Total Bookings, BCR, Net Revenue, etc. with mock time-series)

### 1.2 Files to replace entirely

The `indresh-to-main` version is a clean rewrite. Replace wholesale:

```bash
git show indresh-to-main:src/app/metrics/page.tsx         > src/app/metrics/page.tsx
git show indresh-to-main:src/app/metrics/\[id\]/page.tsx  > "src/app/metrics/[id]/page.tsx"
git show indresh-to-main:src/components/metric/metric-detail-panel.tsx > src/components/metric/metric-detail-panel.tsx
git show indresh-to-main:src/components/metric/metric-chart.tsx        > src/components/metric/metric-chart.tsx
git show indresh-to-main:src/lib/metric-update-store.ts                > src/lib/metric-update-store.ts
git show indresh-to-main:src/lib/approval-store.ts                     > src/lib/approval-store.ts
git show indresh-to-main:src/hooks/use-metric-update.ts                > src/hooks/use-metric-update.ts
```

**Key changes per file:**

**`src/app/metrics/page.tsx`** — Clean list UI (PDF 1a):
- Removes indicator column and owner column from the table
- Only two columns: `METRIC NAME` and `LAST 7D AVERAGE`
- Adds `"Pending review"` amber badge inline next to metric name (uses `hasPendingUpdate` from `metric-update-store`)
- Amber row tint (`bg-amber-500/10`) for pending metrics
- Subscribes to `subscribePendingUpdates` to reactively refresh the list
- `Sparkles` generate button and `CreateMetricModal` wiring unchanged

**`src/app/metrics/[id]/page.tsx`** — Detail page wiring (PDF 1b–h):
- 252 lines (up from ~180)
- Adds `isCreating` query param support for newly-created metrics (navigated with `?creating=true`)
- Subscribes to `subscribePendingUpdates` to track `isPending` state per metric
- Passes `isPending` into `MetricDetailPanel`
- Wires `setDetailContent` for the right-panel Properties tab

**`src/components/metric/metric-detail-panel.tsx`** — Major redesign (1040 lines → PDF 1b–h):
- **Collapsed default state**: shows SQL Query block, Table badge, Related Metrics, then collapsed accordions for Data freshness / Description / Changelog
- **Expanded "Data freshness"**: max date in data, last refresh timestamp, "Refresh data" button
- **Expanded "Description"**: read-only fields for Value Format, Time, Formula (editable inline), Dimensions pill list, Time Grain, Granularity, Owner, Source
- **Expanded "Changelog"**: versioned entries (v1 Created, v2 SQL definition updated) with timestamps and author emails
- **Pending update state**: when `hasPendingUpdate(metric.id)` is true, shows "Changelog Pending" badge, v2 entry with "Approve / Reject" buttons, SQL diff below, "Will be recalculated" related metric chips
- **`MetricUpdateApprovalModal`** launched when Approve is clicked (shows confirmation with related metrics list)
- **Delete metric** button at the bottom with `AlertDialog` confirmation

**`src/lib/metric-update-store.ts`** (72 lines):
- Stores pending metric updates keyed by `metricId`
- Shape: `{ metricId, status: "pending"|"approved"|"rejected", newSql, newFormula, explanation, affectedMetrics, userRequest, createdAt }`
- Exports: `setPendingUpdate`, `getPendingUpdate`, `hasPendingUpdate`, `approvePendingUpdate`, `rejectPendingUpdate`, `getAllPendingUpdates`, `subscribe`

**`src/lib/approval-store.ts`** (121 lines):
- Tracks which metrics are "critical" (dependent on by others)
- `addPendingApproval(metricId, change)` — queues a change for review
- `getDownstreamMetrics(metricId)` — returns related metric names for the "Approve All" dialog

**`src/hooks/use-metric-update.ts`**:
- `requestMetricUpdate(metric, userRequest, signal)` — calls `/api/metric-update`, streams back result
- `publishUpdate(metric, result, userRequest)` — writes to `metric-update-store`, bumps `approval-store`

### 1.3 Partial patches

These files need only specific additions from indresh-to-main:

**`src/lib/metric-store.ts`** — Add PRESEEDED_METRICS seeding:
```typescript
// Add at top of file:
import { PRESEEDED_METRICS } from "./metric-data";

// In ensureInitialized(), replace the empty Map initialization:
const map = new Map<string, Metric>();
if (datasetId === "ecommerce") {
  for (const m of PRESEEDED_METRICS) {
    map.set(m.id, m);
  }
}
stores.set(datasetId, map);
```

**`src/lib/types.ts`** — Add new message variant types (needed for Phase 2 cards):
```typescript
// Extend variant union:
variant?: "... | "metric-update-confirm" | "metric-create-confirm" | "metric-table-select";

// Add three new message data shapes:
metricUpdateConfirm?: { metricId, metricName, oldDescription, newDescription, oldSql, newSql,
  oldFormula, newFormula, explanation, affectedMetrics, userRequest,
  status: "ready"|"published"|"dismissed", suggestedRelatedMetrics?, table? };

metricTableSelect?: { metricId, metricName, description, tables, selectedTable?,
  status: "pending"|"confirmed", suggestedRelatedMetrics };

metricCreateConfirm?: { metricId, metricName, description,
  status: "ready"|"approved"|"dismissed" };
```

**`src/lib/datasets/index.ts`** — Add fallback (safe/unrelated fix, include it):
```typescript
// After getDynamicDataset(id) fails, fall back to DEFAULT_DATASET instead of throwing
const fallback = STATIC_DATASETS[DEFAULT_DATASET];
if (fallback) return fallback;
```

**`src/lib/dataset-context.tsx`** — Add auto-correct for stale dataset ID (safe fix):
```typescript
// Add useEffect that resets datasetId to DEFAULT_DATASET if current ID no longer exists in allDatasets
```

**`src/lib/llm.ts`** — Fix default model ID (trivial, include):
```typescript
// "gemini-3-flash-preview" → "gemini-2.0-flash"
```

### 1.4 Phase 1 Acceptance Criteria

- [ ] Metrics list page shows clean two-column table (Name + Last 7d Average), no indicator/owner
- [ ] Metrics with pending updates show amber "Pending review" badge and amber row tint
- [ ] Metric detail page loads in collapsed default state (SQL, Table, Related Metrics visible; Data freshness / Description / Changelog collapsed)
- [ ] Expanding "Data freshness" shows max data date and last refresh with "Refresh data" button
- [ ] Expanding "Description" shows formula, dimensions, time grain, granularity, owner, source
- [ ] Expanding "Changelog" shows version history entries
- [ ] When a metric has a pending update: Changelog shows "Pending" badge, v2 entry with Approve/Reject, SQL diff renders correctly
- [ ] Clicking "Approve" opens `MetricUpdateApprovalModal` with related-metrics list (Approve only X vs Approve All)
- [ ] After approval: Changelog shows v2 as current version, metric SQL updates in view
- [ ] Delete metric shows AlertDialog, removes metric on confirm
- [ ] Preseeded ecommerce metrics (GMV, Total Bookings, etc.) appear on first load without needing to generate

---

## Phase 2 — Chat UX for Metrics

### 2.1 New files

```bash
git show indresh-to-main:src/components/chat/metric-update-confirm-card.tsx > src/components/chat/metric-update-confirm-card.tsx
git show indresh-to-main:src/components/chat/metric-create-confirm-card.tsx > src/components/chat/metric-create-confirm-card.tsx
git show indresh-to-main:src/components/chat/metric-table-select-card.tsx   > src/components/chat/metric-table-select-card.tsx
```

**What they do:**
- `metric-update-confirm-card.tsx` (233 lines) — The card rendered in chat after Gemini proposes a metric update (PDF 1e). Shows: NAME diff, DESCRIPTION diff (strikethrough old / green new), FORMULA diff, SQL QUERY accordion, AFFECTED METRICS chips. Actions: "Publish for review" / "Suggest edits" / "Dismiss".
- `metric-create-confirm-card.tsx` (100 lines) — Confirmation card after a new metric is proposed (PDF 2c). Compact: shows metric name, description, formula, table, SQL, sentinel-suggested linking. Actions: "Publish for review" / "Suggest edits" / "Dismiss".
- `metric-table-select-card.tsx` (232 lines) — Interactive card asking which table to use for a new metric (PDF 2b). Shows radio buttons for matched tables; if "Different table or multiple tables..." is selected, expands a JOIN builder. Action: "Use this table" / "Use this join".

### 2.2 Files to replace entirely

```bash
git show indresh-to-main:src/hooks/use-classify.ts        > src/hooks/use-classify.ts
git show indresh-to-main:src/lib/prompts/classify.ts      > src/lib/prompts/classify.ts
git show indresh-to-main:src/app/api/classify/route.ts    > src/app/api/classify/route.ts
git show indresh-to-main:src/components/chat/chat-welcome.tsx > src/components/chat/chat-welcome.tsx
```

**Key changes:**
- `use-classify.ts`: adds `metric_update` to `ClassifyResult.mode` union; passes optional `metricEntityContext` to the classify endpoint
- `prompts/classify.ts`: adds `metric_update` mode description to the system prompt; adds `{METRIC_ENTITY_CONTEXT}` slot; adds 4 new examples showing metric update classification (only fires when on a metric page)
- `api/classify/route.ts`: accepts `metricEntityContext` in body; adds `metric_update` to the mode extraction logic
- `chat-welcome.tsx`: adds `overridePrompts?: string[]` prop (used by metric detail page to show metric-specific suggested prompts)

### 2.3 Partial patches

**`src/lib/types.ts`** — already patched in Phase 1.

**`src/hooks/use-action-handlers.ts`** — add publish/dismiss handlers:
```typescript
// Add import:
import { useMetricUpdate } from "@/hooks/use-metric-update";
import type { MetricUpdateResult } from "@/hooks/use-metric-update";
import { getMetric, getAllMetrics, updateMetric } from "@/lib/metric-store";

// Add handleMetricUpdatePublish and handleMetricUpdateDismiss callbacks (see diff)
// Add both to the return object
```

**`src/components/chat/chat-state-provider.tsx`** — expose new handlers:
```typescript
// Add to interface:
handleMetricUpdatePublish: (msgId: string) => void;
handleMetricUpdateDismiss: (msgId: string) => void;
// Wire through from useActionHandlers and include in context value + deps array
```

**`src/components/chat/chat-thread.tsx`** — render new card types:
```typescript
// Add imports for MetricUpdateConfirmCard, MetricCreateConfirmCard, MetricTableSelectCard
// Add extractTodos() helper function
// Destructure handleMetricUpdatePublish/Dismiss from chat
// Add useChatPanel() for injectText
// Add handleMetricCreateApprove/Dismiss/SuggestEdits callbacks
// Add handleMetricTableSelect callback
// In message render switch: add cases for "metric-update-confirm", "metric-create-confirm", "metric-table-select"
```

**`src/hooks/use-analytics.ts`** — add metric creation flow + metric_update routing:
```typescript
// Add imports: useMetricUpdate, saveMetric, getAllMetrics
// Add handleMetricCreate() callback: creates stub metric in store, pushes metric-table-select card
// In handleSend: add regex match for "create a metric called X which calculates Y" pattern → handleMetricCreate()
// In handleSend: pass metricEntityContext to classifyQuery when on a metric detail page
// Add case for queryMode === "metric_update": calls requestMetricUpdate(), pushes metric-update-confirm card
```

**`src/components/sidebar.tsx`** — **manual patch only** (red dot for pending metrics):
```typescript
// Add import:
import { getAllPendingUpdates, subscribe as subscribePendingUpdates } from "@/lib/metric-update-store";

// Add state + effect:
const [hasPendingMetrics, setHasPendingMetrics] = useState(() => getAllPendingUpdates().length > 0);
useEffect(() => {
  return subscribePendingUpdates(() => setHasPendingMetrics(getAllPendingUpdates().length > 0));
}, []);

// Pass dot={hasPendingMetrics} to the Metrics NavItem only
```

> **Do NOT apply any other sidebar.tsx changes** — the Decks nav item, onboarding workspace logic, PanelLeftClose imports, FolderSection, etc. are all out of scope.

### 2.4 ⚠️ Conflicts with Existing Chat Features

#### Conflict 1: `handleSend` signature change in `use-analytics.ts`

`indresh-to-main` removes the `options?: { forceMode?: "quick" | "deep" }` parameter from `handleSend`.

**What was removed:**
```typescript
// Old signature (feat-metrics-merge):
async (text, entityContext?, contextRefs?, silentContext?, options?: { forceMode?: "quick" | "deep" }) => {
  const effectiveDeepResearch = options?.forceMode === "deep" ? true : options?.forceMode === "quick" ? false : deepResearch;
```

**Impact:** Check if any caller on `feat-metrics-merge` passes `forceMode`. If `page.tsx` or a chat input component passes `{ forceMode: "deep" }`, it must be updated to use the `deepResearch` toggle state directly instead.

**Resolution:** Grep for `forceMode` callers before applying the new `use-analytics.ts`. If found, either preserve the `options` param or migrate callers to use `setDeepResearch(true)` before calling `handleSend`.

```bash
grep -r "forceMode" src/
```

#### Conflict 2: `use-analytics.ts` classify call wrapping

The new code has a conditional classify call:
```typescript
const classified = deepResearch
  ? await classifyQuery(text, datasetId, metricEntityCtx).then((r) => ...  // deep mode wrapper
  : await classifyQuery(text, datasetId, metricEntityCtx);
```
This is a structural change to how classification chains into deep research. Carefully diff the full `handleSend` body when applying — don't just copy the new file if the current branch has local fixes to the deep research flow.

#### Conflict 3: `chat-thread.tsx` — `setMessages` not currently exposed

`indresh-to-main` adds `setMessages` to the `useChatState()` destructure in `ChatThread`. Verify that `ChatStateContext` on `feat-metrics-merge` already exposes `setMessages`. If not, it needs to be added to the context value in `chat-state-provider.tsx`.

#### Conflict 4: `chat-thread.tsx` — `extractTodos` helper

The `extractTodos` function is added to `chat-thread.tsx` in `indresh-to-main`. This is a pure addition; no conflict expected, but check if it's actually used in the render tree (it parses markdown for `- [ ]` patterns and action items). If it's unused in the final render, it can be omitted.

### 2.5 Phase 2 Acceptance Criteria

- [ ] Main chat on `/` recognizes "create a metric called X calculated as Y" → shows `MetricTableSelectCard` (table picker)
- [ ] Table picker shows correct tables from dataset; "Different table or multiple tables..." expands JOIN builder
- [ ] Selecting a table and clicking "Use this table" triggers Gemini to compute SQL and shows `MetricCreateConfirmCard`
- [ ] `MetricCreateConfirmCard` shows name, description, formula, SQL, and suggested related metric links
- [ ] "Publish for review" marks the metric with a pending update and adds it to the pending list
- [ ] After publishing, toast confirms and the Metrics nav item shows a red dot indicator
- [ ] Metrics list shows the new metric with "Pending review" amber badge at top
- [ ] On a metric detail page, typing "change the formula to exclude X" triggers `metric_update` classify mode
- [ ] Gemini analyzes the metric and renders `MetricUpdateConfirmCard` with diffs
- [ ] "Publish for review" on the update card writes to `metric-update-store`; Properties tab shows pending state
- [ ] "Suggest edits" on either card injects editing context into the chat input (via `injectText`)
- [ ] "Dismiss" on any card collapses the card gracefully without removing the message

---

## Phase 3 — Side Panel

The Properties panel is entirely within `MetricDetailPanel` (already ported in Phase 1). No additional files needed. Phase 3 work is validation and polish:

- [ ] Verify collapsed ↔ expanded accordion animations are smooth (no layout jumps)
- [ ] Verify "Refresh data" button calls `/api/metrics?datasetId=...` and updates the "Last refresh" timestamp
- [ ] Verify SQL Query block has working copy (`Copy` button) and edit (`SquarePen` button that opens inline edit)
- [ ] Verify Related Metrics chips are clickable and navigate to the correct metric detail page
- [ ] Verify Changelog v2 entry renders with correct date format and author email
- [ ] Verify `SqlDiff` renders the old (red strikethrough) vs new (green) SQL cleanly in dark mode

---

## Implementation Order

```
Phase 1:
  Step 1a  Port new metric component files (wholesale)
  Step 1b  Replace metric page files (wholesale)
  Step 1c  Apply partial patches to types.ts, metric-store.ts, datasets/index.ts, dataset-context.tsx, llm.ts
  Step 1d  Smoke test: load /metrics and /metrics/[id], verify layout, verify approval flow

Phase 2:
  Step 2a  Port new chat card files (wholesale)
  Step 2b  Replace classify-related files (wholesale)
  Step 2c  Grep for forceMode conflict → resolve before patching use-analytics.ts
  Step 2d  Apply partial patches to use-analytics, use-action-handlers, chat-state-provider, chat-thread
  Step 2e  Manual sidebar.tsx red-dot patch (3 additions only)
  Step 2f  Smoke test: create metric from main chat, update metric from detail page

Phase 3:
  Step 3a  Visual QA of Properties panel (accordion states, SQL diff, Related Metrics)
  Step 3b  Dark/light mode check
```

## References

- Source branch: `indresh-to-main` (tip: `5c6b09b`)
- Target branch: `feat-metrics-merge` (current)
- PDF spec: `/Users/sashank/Downloads/Metric changes.pdf`
- Existing cherry-pick rule: `memory/feedback_sidebar_cherry_pick.md`
- Related memory: `MEMORY.md` → "Sidebar Cherry-Pick Rule (metric-audit-flows-merged)"
