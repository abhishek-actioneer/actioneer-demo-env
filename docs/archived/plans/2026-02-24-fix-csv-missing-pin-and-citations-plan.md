---
title: "fix: CSV uploaded dataset queries missing pin-to-canvas button and citation selection"
type: fix
date: 2026-02-24
---

# fix: CSV uploaded dataset queries missing pin-to-canvas button and citation selection

## Overview

When running a query against an uploaded CSV dataset, the pin-to-canvas button and citation selection badges are absent from the response. Both features work correctly for the default ecommerce dataset. This plan identifies the root cause and describes the fix.

## Problem Statement

When a user uploads a CSV via the sidebar, switches to that dataset, and runs an analytics query:

- The **pin-to-canvas** button (below each chart block in the response) is not shown
- **Citation badges** (e.g. `[agent-id:Q1]`) are not rendered as interactive clickable elements — they either don't appear or appear as plain text

Both features worked previously on the default ecommerce dataset in the same session.

## Root Cause Analysis

### The gate: `hasAgentData` in `chat-thread.tsx`

Both features are gated behind a single boolean: `hasAgentData` (lines 259–262 in `src/components/chat/chat-thread.tsx`).

```tsx
// src/components/chat/chat-thread.tsx:259
const agentMsg = messages.find((m) => m.role === "agent" && m.agent);
const hasAgentData = !!agentMsg;

if (hasAgentData && !msg.variant && msg.content.length > 0) {
  return <DocumentView ... renderChartActions={renderChartActions} onCitationClick={onCitationClick} />
}
// else: SentinelMessage (no pin, no citations)
```

When `hasAgentData` is `false`, `SentinelMessage` is used instead of `DocumentView`. `SentinelMessage` calls `MarkdownContent` without `renderChartActions` or `onCitationClick`, so:

- **Pin button**: `renderChartActions` never called → button never rendered beneath chart blocks
- **Citations**: `onCitationClick` is `undefined` → `parseInline` in `src/lib/markdown.tsx` skips badge rendering for `[agent-id:Q#]` patterns

### When is `hasAgentData` false?

An agent message (`role: "agent"`, `.agent` field set) is only added to `messages` in **deep research mode**. See `src/hooks/use-analytics.ts:351–363`:

```ts
if (mode === "deep") {
  newMsgs.push({ id: agentMsgId, role: "agent", agent: { status: "gathering", subagents: [] } });
}
// In quick mode: only a streaming sentinel message is added — no agent message
```

`mode` is `"deep"` only when `deepResearch === true`. `deepResearch` is initialized to `true` in `useState(true)` and persists across dataset switches (it lives in `useAnalytics`, not in `useConversation`).

### Why CSV specifically causes this

**Cause 1 — Conversation cleared on dataset switch (primary trigger)**

`src/hooks/use-conversation.ts:38–46` clears messages whenever `datasetId` changes:

```ts
useEffect(() => {
  if (prevDatasetRef.current !== datasetId) {
    prevDatasetRef.current = datasetId;
    setMessages([]);      // ← cleared
    setActiveId("");
  }
}, [datasetId, setActiveId]);
```

After switching to the CSV dataset, `messages` is `[]`. The `hasAgentData` search on this empty array returns `false` for the very first query — but only if that query runs in **quick mode** (no agent message added) or if the analytics path errors out before the agent message state is set.

**Cause 2 — `enrichDataset` LLM failure falls back to generic agents, which may generate no valid SQL**

When LLM schema enrichment fails during upload (`src/app/api/datasets/upload/route.ts:207–225`), `agents` is left as `undefined` and `buildGenericMultiAgentPrompt` is used instead. If the generic prompt doesn't produce parseable `|` delimited agent lines, `parseMultiAgentPrompt` returns `[]`. With no agent specs, `generateMultipleQueries` in `src/lib/sql-generator.ts:210` falls back to a single query (`subagentId: "rev-opt"`).

The single query may fail to execute against the CSV schema (the generic SQL references column names that don't exist in the CSV), triggering the fallback branch at `src/app/api/analyze/route.ts:50–54`:

```ts
if (queries.length === 0) {
  await streamDirectResponse(query, controller, encoder, datasetId, modelId);
  // ← streams text events, no `sql` events → subagents never built on client
}
```

Even though an agent message IS in `messages` (it was optimistically added in deep mode before the fetch), the response has no query results to cite and the LLM receives no data → it generates no `[agent-id:Q#]` citations and likely skips `\`\`\`chart\`\`\`` blocks because there's no real data. The pin button and citations render structurally correctly (DocumentView IS used) but are absent from the content.

**Cause 3 — Citation template uses hardcoded ecommerce agent ID examples**

`src/lib/prompts/analyze.ts:218–220` in the report generation template:

```
CITATION RULES:
- Each query result is labeled with a citation ID like [agent-id:Q#] (e.g. [rev-opt:Q1], [daily-metrics:Q2]).
```

These hardcoded ecommerce examples (`rev-opt`, `daily-metrics`) may confuse the LLM when generating reports for CSV datasets that have custom agent IDs (e.g. `sales-trends`, `customer-analysis`). The LLM may use the example IDs literally rather than the actual CSV agent IDs, causing citation patterns to reference agents that don't exist in the query context — making them non-interactive (the `onCitationClick` handler looks for the agent in `subagents`, and a mismatched agent ID would produce a dead click).

## Acceptance Criteria

- [ ] Running a query on a freshly uploaded CSV dataset in deep research mode renders `DocumentView` (not `SentinelMessage`) for the analytics response
- [ ] The pin-to-canvas button appears below each `\`\`\`chart\`\`\`` block in CSV dataset responses
- [ ] Citation badges are interactive (clickable, opening the Sources panel) in CSV dataset responses
- [ ] `enrichDataset` failure or generic-prompt fallback does not produce an empty agent spec list that silently falls back to `streamDirectResponse`
- [ ] The report generation template uses dynamic agent ID examples drawn from the actual dataset's agent config, not hardcoded ecommerce IDs

## Technical Approach

### Fix 1 — Guard against empty agent spec fallback in upload route (high impact)

In `src/app/api/datasets/upload/route.ts`, in the LLM enrichment catch block, explicitly assign `agents` to the parsed generic agent specs so the `DatasetConfig` always has a non-undefined `agents` array:

```ts
// In the catch block after generic prompt fallback:
agents = parseMultiAgentPrompt(multiAgentPrompt, queryDescriptions);
// ← ensure agents is never undefined in the saved config
```

### Fix 2 — Dynamic citation examples in report generation template (medium impact)

In `src/lib/prompts/analyze.ts`, `getReportGenerationTemplate(ds)` already receives `ds: DatasetConfig`. Use `ds.agents` to generate dataset-specific citation examples:

```ts
// Generate examples like: "sales-trends:Q1", "customer-churn:Q2" from actual agent IDs
const citationExamples = ds.agents?.slice(0, 2)
  .map((a, i) => `[${a.id}:Q${i + 1}]`).join(', ')
  ?? '[rev-opt:Q1], [daily-metrics:Q2]';
```

### Fix 3 — Verify `hasAgentData` works for first query after dataset switch (low risk, confirm only)

Confirm that `deepResearch` is `true` when the user sends their first query after switching to the CSV dataset. Since `deepResearch = useState(true)` in `useAnalytics` and is not reset by `onSwitch`, this should already be correct. Add a debug log or test to confirm.

## References

### Internal Code Locations

- `src/components/chat/chat-thread.tsx:259–283` — `hasAgentData` gate and DocumentView vs SentinelMessage selection
- `src/lib/markdown.tsx:264–285` — Citation badge rendering (only when `onCitationClick` truthy)
- `src/hooks/use-analytics.ts:345–374` — Agent message only added in deep mode
- `src/hooks/use-conversation.ts:38–46` — Messages cleared on dataset switch
- `src/app/api/datasets/upload/route.ts:207–225` — `enrichDataset` LLM fallback (leaves `agents` undefined)
- `src/lib/sql-generator.ts:209–211` — Fallback to `generateSingleQuery` when agent specs empty
- `src/app/api/analyze/route.ts:50–54` — Fallback to `streamDirectResponse` when no queries
- `src/lib/prompts/analyze.ts:217–220` — Hardcoded ecommerce citation examples in report template
- `src/components/canvas/pin-button.tsx` — Pin button component (never renders if no `renderChartActions`)

### Related Patterns

- Memory: `STORAGE_VERSION` / `ensureInitialized` store pattern
- Memory: canvas item store-first design
- Docs: `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usememo-PlaybookPage-20260224.md` (same session — related state management patterns)
