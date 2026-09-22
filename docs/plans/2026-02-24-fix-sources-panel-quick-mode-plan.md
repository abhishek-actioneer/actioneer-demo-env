---
title: "fix: Show SQL query in Sources panel for quick-mode responses"
type: fix
date: 2026-02-24
---

# fix: Show SQL query in Sources panel for quick-mode responses

## Overview

When a user clicks a citation badge (`rev-opt:Q1`) in a quick-mode analytics response, the Sources panel shows "No query data available yet." even though a real SQL query was executed. This fix makes the Sources panel functional for quick mode by storing the query data in a data-only agent message that is invisible in the chat thread but picked up by the existing `sourcesAgents` pipeline.

## Problem Statement

Three layers of gaps exist simultaneously:

**Layer 1 — SSE events discarded.** The `sql` and `query_result` events from the analyze API are explicitly thrown away in quick mode by `if (mode === "quick") break` guards at lines 452 and 497 of `use-analytics.ts`. The API does emit them; the client discards them.

**Layer 2 — No agent message created.** `sourcesAgents` in `use-panel.ts` finds the agent message by `agentMsgIdRef.current`. In quick mode, no `role: "agent"` message is ever added to state, so `sourcesAgents` always resolves to `[]`.

**Layer 3 — Branch order bug (latent).** After this fix, quick-mode conversations will have a `role: "agent"` message. The `hasAgentData` check in `chat-thread.tsx` (line 260) is a broad scan of all messages — it would incorrectly promote all sentinel messages in that conversation (including loading states and error messages) to the `DocumentView` path, which expects deep-mode structure. This must be addressed as part of the same change.

## Proposed Solution

**Create a data-only `role: "agent"` message in quick mode**, tagged with `isDataOnly: true`, that is never rendered in the chat thread but is found by `sourcesAgents`. This reuses the entire existing `SubagentInfo` → `SourcesPanel` → `AgentQueryGroup` stack with no structural changes to those components.

### Why this approach over alternatives

| Approach | Verdict |
|---|---|
| Store queries on sentinel message's `agent` field | ❌ Timing issue: `sql` event fires before sentinel message is created |
| Buffer in ref, attach at text event | ❌ `query_result` arrives after text starts streaming — requires patching via setMessages on a field that doesn't exist yet |
| New `quickSources` field on `ChatMessage` | ❌ Duplicates `SubagentInfo` machinery; `SourcesPanel` needs changes or adapter |
| Data-only agent message with `isDataOnly: true` | ✅ Zero changes to `SourcesPanel`/`AgentQueryGroup`; type-safe; handles reload via fallback scan; reuses all existing `updateAgentMsg` logic |

## Technical Approach

### Architecture

```
quick mode SSE stream:
  sql event → push data-only role:"agent" msg (isDataOnly:true) into messages
  query_result event → updateAgentMsg() patches rowCount/executionTimeMs (same as deep mode)
  text event → push role:"sentinel" msg (isAnalyticsResponse:true)

chat-thread.tsx rendering:
  role:"agent" + isDataOnly → return null (invisible)
  role:"agent" + !isDataOnly → AgentCard (deep mode, unchanged)
  role:"sentinel" + isAnalyticsResponse → new quick-analytics branch (avatar + MarkdownContent)
  role:"sentinel" + hasAgentData (deep mode only, non-isDataOnly agents) → DocumentView
  role:"sentinel" fallback → SentinelMessage

sourcesAgents (use-panel.ts):
  live session → agentMsgIdRef.current lookup (works for both modes)
  reload fallback → find most recent isDataOnly agent message in messages[]
```

### Implementation Phases

#### Phase 1: Add `isDataOnly` flag to `ChatMessage` type

**File:** `src/lib/types.ts`

After the existing `isAnalyticsResponse` field, add:

```typescript
/** Marks a role:"agent" message as a data-only vessel for quick-mode query storage.
 *  These messages are never rendered in the chat thread. */
isDataOnly?: boolean;
```

No other type changes needed — `SubagentInfo`, `AgentInfo`, `QueryInfo` are already the correct shape.

---

#### Phase 2: Wire `sql` and `query_result` events in quick mode

**File:** `src/hooks/use-analytics.ts`

**`sql` handler — remove quick-mode guard and add quick-mode branch:**

The existing deep-mode branch creates the agent message on the `phase: "generating_sql"` event (before `sql` fires). In quick mode, we create it directly in the `sql` handler, so the message is created the moment we have data.

```typescript
case "sql": {
  // REMOVED: if (mode === "quick") break;

  const subId = event.subagentId as string;
  const def = getAgentDisplay(subId);
  const eventQueries = event.queries as { sql: string; description: string; queryIndex: number }[];

  if (mode === "quick") {
    // Create a data-only agent message (invisible in thread, used by sourcesAgents)
    setMessages((prev) => {
      // Idempotent: if the message already exists (e.g. second sql event), update in place
      const existing = prev.find((m) => m.id === agentMsgId);
      if (existing) {
        return updateAgentMsg(prev, agentMsgId, (agent) => {
          if (agent.subagents.find((s) => s.id === subId)) return agent;
          return {
            ...agent,
            subagents: [
              ...agent.subagents,
              {
                id: def.id,
                name: def.name,
                icon: def.icon,
                status: "complete" as const,
                action: "Analysis complete",
                progress: { current: 1, total: 1 },
                queries: eventQueries.map((q) => ({
                  sql: q.sql,
                  description: q.description,
                })),
              },
            ],
          };
        });
      }
      // First sql event in quick mode: create the data-only agent message
      return prev.concat([{
        id: agentMsgId,
        role: "agent",
        content: "",
        timestamp: Date.now(),
        isDataOnly: true,
        agent: {
          status: "complete",
          taskCount: 1,
          subagents: [{
            id: def.id,
            name: def.name,
            icon: def.icon,
            status: "complete",
            action: "Analysis complete",
            progress: { current: 1, total: 1 },
            queries: eventQueries.map((q) => ({
              sql: q.sql,
              description: q.description,
            })),
          }],
        },
      }]);
    });
    break;
  }

  // deep mode branch (unchanged below this point)
  // ...
}
```

**`query_result` handler — remove quick-mode guard:**

The existing `updateAgentMsg` logic at line 502 already works correctly for any agent message regardless of mode. Simply remove the guard:

```typescript
case "query_result": {
  // REMOVED: if (mode === "quick") break;
  // ... rest unchanged
}
```

The `result` and `summary` handlers keep their `if (mode === "quick") break` guards — these affect the streaming indicator and per-agent summaries, which are not relevant to quick mode.

**Abort handler — clean up data-only agent message:**

In the `catch` block (around line 778), the current filter removes `"gathering-" + agentMsgId` and `streamingId`. Add the data-only agent message to cleanup for quick mode:

```typescript
setMessages((prev) =>
  prev.filter((m) =>
    m.id !== `gathering-${agentMsgId}` &&
    m.id !== streamingId &&
    // Clean up data-only agent message created in quick mode
    !(m.id === agentMsgId && m.isDataOnly)
  )
);
```

---

#### Phase 3: Fix chat-thread.tsx rendering

**File:** `src/components/chat/chat-thread.tsx`

**3a. Skip rendering data-only agent messages:**

In the `role === "agent"` render block (before the AgentCard render), add:

```tsx
if (msg.role === "agent") {
  if (msg.isDataOnly) return null; // data-only quick-mode vessel — never rendered
  // ... existing AgentCard rendering
}
```

**3b. Fix `hasAgentData` to exclude data-only messages, and move branch order:**

The `hasAgentData` check must exclude data-only messages so that quick-mode conversations don't accidentally promote all sentinel messages to `DocumentView`:

```tsx
if (msg.role === "sentinel") {
  // Quick mode analytics: check isAnalyticsResponse FIRST (takes precedence over hasAgentData)
  if (msg.isAnalyticsResponse && !msg.variant && msg.content.length > 0) {
    return (
      // ... existing quick-analytics branch (already implemented)
    );
  }

  // Deep mode: DocumentView — only when a non-data-only agent message exists
  const agentMsg = messages.find((m) => m.role === "agent" && m.agent && !m.isDataOnly);
  const hasAgentData = !!agentMsg;

  if (hasAgentData && !msg.variant && msg.content.length > 0) {
    // ... DocumentView branch (unchanged)
  }

  // Fallback: plain SentinelMessage
  return (
    // ... unchanged
  );
}
```

The key change: `isAnalyticsResponse` check comes first with an early return, AND `hasAgentData` is guarded with `!m.isDataOnly` so deep-mode and quick-mode agent messages are never confused.

---

#### Phase 4: Make `sourcesAgents` reload-safe

**File:** `src/hooks/use-panel.ts`

The current implementation loses Sources panel functionality after page reload because `agentMsgIdRef` is an in-memory ref that resets to `""` on mount. Add a fallback scan:

```typescript
const sourcesAgents = useMemo(() => {
  // Live session: use ref to find the exact agent message for the current query
  const agentMsg = messages.find((m) => m.id === agentMsgIdRef.current);
  if (agentMsg?.agent?.subagents?.length) return agentMsg.agent.subagents;

  // Reload fallback: find the most recently added data-only quick-mode agent message
  // (covers conversations loaded from localStorage where agentMsgIdRef is "")
  const quickAgentMsg = [...messages]
    .reverse()
    .find((m) => m.role === "agent" && m.isDataOnly && m.agent?.subagents?.length);
  return quickAgentMsg?.agent?.subagents ?? [];
}, [messages, agentMsgIdRef]);
```

This is safe because:
- Deep mode: `agentMsgIdRef.current` points to the non-isDataOnly agent message → the ref path is taken, fallback never runs
- Quick mode live: ref path is taken
- Quick mode after reload: ref is `""`, no match → fallback scans for most recent `isDataOnly` message
- Multiple quick-mode queries in session: ref points to the latest one → correct
- Multiple quick-mode queries after reload: fallback finds the last one by message order → shows most recent, same behavior as live session

**Note:** Deep-mode reload still has the same limitation as before (Sources panel empty after reload). That is out of scope — it pre-exists and requires a separate `agentMsgIdRef` re-hydration pass.

## Acceptance Criteria

### Functional

- [x] In quick mode, clicking a `[agent-id:Q#]` citation badge opens the Sources panel showing the executed SQL with syntax highlighting
- [x] The Sources panel shows row count and execution time after the query completes (live-updates while panel is open if it was opened before `query_result` arrived)
- [x] The Sources panel correctly scrolls to and highlights the specific citation that was clicked
- [x] When a `query_result` carries an error, the QueryCard shows the error (existing behavior via `q.error` field)
- [x] Aborting a quick-mode query removes the data-only agent message from state (Sources panel shows empty for the aborted query)
- [x] After page reload, clicking a citation in a historical quick-mode response shows the correct SQL in the Sources panel
- [x] Deep mode behavior is completely unchanged

### Non-regression

- [x] Plain sentinel messages in a quick-mode conversation (loading states, errors, direct-path responses) still render as `SentinelMessage`, not `DocumentView`
- [x] The avatar + "Sentinel" label rendering for `isAnalyticsResponse` responses is unchanged
- [x] The `hasAgentData` → `DocumentView` path only fires for deep-mode responses
- [x] The data-only agent message is not visible in the chat thread
- [x] `allSql` memo in `chat-thread.tsx` is not affected (it already collects from all role:"agent" messages; quick-mode SQL will now appear there too, enabling the pin button to reference the SQL — this is intentional)

### TypeScript

- [x] No new `any` casts introduced
- [x] `isDataOnly` field is optional and non-breaking for existing code paths
- [x] All `SubagentInfo` fields satisfy their type constraints (`progress`, `action`, `status` have concrete values)

## Edge Cases

| Scenario | Handling |
|---|---|
| `sql` event never fires (error before SQL generation) | No data-only agent message created; Sources shows "No query data available yet." — acceptable |
| Multiple `sql` events, same `subagentId` | Idempotent: `if (existing) return agent` guard prevents duplicate subagents |
| Multiple `sql` events, different `subagentId` | Both subagents added; SourcesPanel shows two groups — correct behavior |
| `query_result` arrives after Sources panel is open | `sourcesAgents` is a `useMemo` on `messages` — re-renders live with row count |
| Citation click during streaming (before `query_result`) | Panel opens with SQL but blank row count; updates live when `query_result` arrives |
| Abort after `sql` event but before `query_result` | Data-only agent message removed by abort cleanup filter; citation badges don't exist (partial response discarded) |
| Mode switch: deep → quick in same session | `agentMsgIdRef` is re-assigned per query; no cross-contamination |
| Mode switch: quick → deep in same session | Deep mode creates its own non-`isDataOnly` agent message; `hasAgentData` check correctly excludes data-only messages |
| `queryIndex` from quick-mode `query_result` event | The existing `updateAgentMsg` logic uses `queryIndex` from the event — no special handling needed; quick mode uses `queryIndex: 0` matching the single query at `queries[0]` |

## Files Changed

| File | Change type | Notes |
|---|---|---|
| `src/lib/types.ts` | Add field | `isDataOnly?: boolean` on `ChatMessage` |
| `src/hooks/use-analytics.ts` | Modify | Remove quick-mode guards from `sql`/`query_result` handlers; add quick-mode branch in `sql` handler; update abort cleanup |
| `src/components/chat/chat-thread.tsx` | Modify | Skip rendering `isDataOnly` messages; fix `hasAgentData` guard; fix branch order |
| `src/hooks/use-panel.ts` | Modify | Add reload fallback to `sourcesAgents` |

**No changes to:** `SourcesPanel`, `AgentQueryGroup`, `QueryCard`, `DocumentView`, `MarkdownContent`, any API routes, or prompt files.

## References

- `src/lib/types.ts` — `ChatMessage`, `SubagentInfo`, `QueryInfo`, `AgentInfo` types
- `src/hooks/use-analytics.ts:452` — `sql` event guard (to remove)
- `src/hooks/use-analytics.ts:497` — `query_result` event guard (to remove)
- `src/hooks/use-analytics.ts:351` — deep-mode agent message creation (reference pattern)
- `src/hooks/use-panel.ts:51` — `sourcesAgents` memo (to extend)
- `src/components/chat/chat-thread.tsx:258` — sentinel render block (branch order fix)
- `src/components/chat/sources-panel.tsx:97` — filter requiring `queries?.length` (no change needed)
- `docs/solutions/logic-errors/classifier-misrouting-composite-queries.md` — feature parity across code paths pattern
