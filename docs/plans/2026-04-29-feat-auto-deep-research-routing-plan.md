# Auto-Routing Complex Queries to Deep Research

**Branch:** `feat/auto-deep-routing`
**Date:** 2026-04-29
**Status:** Proposed

## Problem

Today, `deepResearch` is a binary UI toggle (off by default). Users asking complex multi-dimensional questions get a single-SQL "quick" answer that's often shallow. Power users know to flip the toggle; new users don't. We want the system to detect complexity and auto-upgrade — but transparently, with an undo affordance, because deep is ~10× slower and ~10× more credits than quick.

## Goals

1. Classifier outputs a `complexity` signal alongside `mode`.
2. When `complexity === "complex"` AND user hasn't explicitly forced quick, the analytics flow auto-upgrades to deep research.
3. The UI **explicitly tells** the user the upgrade happened (one-line message + reason chip) and offers a "Switch to Quick" undo for the first ~3 seconds before any deep work commits.
4. No regression in quick-mode latency for simple queries.

## Non-Goals

- Tuning the deep pipeline itself (subagent count, critique, etc.).
- Cost gating / paywalls on deep research — separate concern.
- Auto-downgrade (deep → quick).

## Architecture

### Where the decision lives

Extend `/api/classify` (`src/app/api/classify/route.ts`) to return:

```ts
{
  mode: "analytics" | "direct" | "action" | ...,
  complexity: "simple" | "complex",   // NEW
  complexityReason: string | null,    // NEW — human-readable, used in UI
  metricId, actionType, extractedDescription, metricName
}
```

Single LLM call, no extra round-trip. If quality on existing fields degrades in eval, we split this into a parallel `/api/route-depth` call instead.

### Heuristics injected into classifier prompt

Mark a query as `complex` if any of:
- References ≥ 2 distinct metrics or quantities to compare
- Contains a "why / what's driving / what caused / explain" phrasing
- Asks for breakdowns across ≥ 2 dimensions (e.g. "by channel and by region")
- Open-ended exploration verbs: "analyze", "investigate", "deep dive", "diagnose"
- Asks for time-period comparison ("vs last month", "trend over the last quarter") combined with any segmentation
- Asks "what's the best / worst / most impactful" → ranking + reasoning

Otherwise `simple`. Default to `simple` when uncertain (conservative — false-positive deep upgrades are expensive).

### Routing change in `use-analytics.ts`

After `classifyQuery(...)` resolves (around line 609–614):

```ts
const userForcedQuick = options?.forceMode === "quick";
const userForcedDeep  = options?.forceMode === "deep";
const autoUpgraded =
  !userForcedQuick &&
  !userForcedDeep &&
  !deepResearch &&
  classified.complexity === "complex";

const effectiveDeepResearch = userForcedDeep || deepResearch || autoUpgraded;
```

If `autoUpgraded`, before kicking off `/api/analyze`:
1. Inject a new chat message variant `auto-deep-notice` containing the reason + a "Switch to Quick" button.
2. Start a 3-second "soft commit" window — the analyze request *is* fired (so no perceived latency penalty), but if the user clicks Switch to Quick within ~3s, we `abort.abort()` the in-flight deep stream and re-run as quick.

### New ChatMessage variant

In `src/lib/types.ts`:

```ts
variant: "auto-deep-notice"
autoDeepNotice?: {
  reason: string;        // from classified.complexityReason
  agentMsgId: string;    // so undo can target the right stream
  status: "active" | "committed" | "reverted";
}
```

Renderer in `src/components/chat/chat-thread.tsx` (or a new `auto-deep-notice-card.tsx`):
- Monochrome (per CLAUDE.md), small inline card
- "Switched to Deep Research — `{reason}`"
- "Switch to Quick" button, disabled after `status !== "active"`
- After ~3s OR after first `summary` event arrives, transitions to `committed` and the button greys out

### Undo path

`use-analytics.ts` gets a new helper:

```ts
const revertToQuick = async (agentMsgId: string, originalText: string, ...originalArgs) => {
  abortRef.current?.abort();
  // Remove the deep agent panel + auto-deep-notice
  setMessages(prev => prev.filter(m => m.id !== agentMsgId && m.variant !== "auto-deep-notice"));
  // Re-run with explicit quick override
  await handleSend(originalText, ..., { forceMode: "quick" });
};
```

The original `text`/`entityContext`/`contextRefs` are captured in the notice payload so the re-run is faithful.

### "Committed" trigger

Auto-deep notice transitions to `committed` (button disabled) at the earlier of:
- `summary` SSE event received (deep-only, fires after subagent execution starts)
- 3000ms elapsed since notice mounted

This keeps the undo surface short — past commit, the credit/latency is already spent and reverting would be wasteful.

## Implementation Steps

1. **Classifier prompt + schema** (`src/lib/prompts/classify.ts`, `src/app/api/classify/route.ts`)
   - Add `complexity` and `complexityReason` to the JSON schema in the system prompt
   - Add 6–8 examples covering the heuristics above
   - Update the route handler to parse + return new fields
   - Update `use-classify.ts` types

2. **Auto-upgrade routing** (`src/hooks/use-analytics.ts`)
   - Compute `autoUpgraded` after classify
   - Capture original `handleSend` args in a ref/closure for revert
   - Inject `auto-deep-notice` message before deep flow starts

3. **UI: notice card** (`src/components/chat/auto-deep-notice-card.tsx` + thread render switch)
   - Monochrome card with reason + revert button
   - 3s timer + summary-event listener for `committed` state
   - Wire revert to `revertToQuick`

4. **Telemetry** (PostHog)
   - `auto_deep_upgrade_triggered` (with reason)
   - `auto_deep_upgrade_reverted` (within Ns)
   - `auto_deep_upgrade_committed`
   - Use these to tune the heuristics post-launch

5. **Eval**
   - Hand-label ~50 historical queries from conversations as simple/complex
   - Run new classifier against them, target ≥ 85% precision on `complex` (false positives are costlier than false negatives)
   - If precision < 85%, tighten prompt or split into separate `/api/route-depth` call

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| False-positive upgrades blow credits | Conservative classifier bias to `simple`; 3s undo window; telemetry to tune |
| Classifier quality on existing modes degrades | Eval before merge; fallback to separate endpoint if needed |
| Undo race: user clicks revert just as `summary` arrives | `committed` state wins; button visibly disables; explain in copy ("can't undo once analysis starts") |
| User toggles deep manually then sees auto-deep notice on next query | `autoUpgraded` only fires when `deepResearch === false`; never shown when toggle is on |
| Reason text is bad / generic ("looks complex") | Require classifier to ground reason in the query ("compares 3 metrics across regions") |

## Out of Scope (for follow-ups)

- Per-user preferences ("always auto-upgrade", "never auto-upgrade")
- Showing estimated cost/time before commit
- Auto-upgrading mid-stream if quick result is detected as inadequate

## Files Touched

- `src/lib/prompts/classify.ts` — prompt + examples
- `src/app/api/classify/route.ts` — schema + parse
- `src/hooks/use-classify.ts` — return type
- `src/hooks/use-analytics.ts` — routing + revert helper
- `src/lib/types.ts` — `auto-deep-notice` variant
- `src/components/chat/chat-thread.tsx` — render switch
- `src/components/chat/auto-deep-notice-card.tsx` — new component
- (optional) `src/lib/posthog.ts` — telemetry events
