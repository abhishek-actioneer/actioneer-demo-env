# Manus-Style Streaming Research Timeline

**Date:** 2026-02-27
**Status:** Design phase — awaiting approval
**Goal:** Replace the current block-based research timeline with an interleaved, streaming Manus/Perplexity-style UX where items appear one by one with LLM narration between agent groups.

---

## Problem

The current deep research UX dumps information in big blocks:
- All 7 checklist items appear at once
- All 5 agent rows appear simultaneously when SQL events arrive
- Per-agent checklists (5 items each) clutter the view
- A separate "Database Query Execution" section duplicates agent status
- No narration between phases — the user sees data but no context

The result: walls of information pop in abruptly rather than flowing naturally.

## Inspiration

Combination of **Manus** and **Perplexity**:
- **Manus**: Collapsible task groups with action pills streaming in one by one. LLM narration text between groups ("I found X... Now doing Y..."). Task progress as a collapsed card.
- **Perplexity**: Clean, compact progress. Focus on current activity. Minimal clutter.

---

## Design

### Visual Layout (during execution)

```
I will analyze your data across 5 dimensions: data quality,
daily metrics, revenue optimization, user segmentation, and
geographic patterns.

┌ Task progress ──────────────────────── 2 / 7 ┐
│  ✓ Read schema and understand data structure  │
│  ● Gather data from specialized agents        │
│  · Build and validate hypotheses              │
│  · Conduct statistical significance tests     │
│  · Synthesize findings                        │
│  · Get critique and refine report             │
│  · Send final report to client                │
└───────────────────────────────────────────────┘

✓ Data Quality Agent                          ^
     ⊞ NULL rates & field completeness     1 rows
     ⊞ Daily volume anomaly detection      7 rows

Data quality looks solid — NULL rates are minimal and daily
volumes show no anomalies.

✓ Daily Metrics Agent                         ^
     ⊞ Daily active users trend            12 rows
     ⊞ Session engagement metrics          30 rows
     ⊞ Revenue by day                      30 rows

Revenue is trending up 12% week-over-week, with DAU growth
tracking closely.

● Revenue Optimization Agent
     ⊞ Running conversion funnel query...
     · Category revenue breakdown
     · Price sensitivity
```

### Key Design Decisions

| Element | Current | New |
|---------|---------|-----|
| Main 7-item checklist | Open list, all items visible | **Collapsed card** with `2/7` counter, expandable |
| Agent rows | All 5 appear at once | Appear **one by one** as `sql` events arrive |
| Per-agent checklists | 5 items shown per agent | **Hidden** — only query pills shown |
| DB Query Execution block | Separate summary section | **Removed** — stats inline on each query pill |
| Narration | None | **LLM-generated text** between agent groups |
| Layout | Rigid sections | **Interleaved stream**: narration → agent group → narration |

### Task Progress Card

- Shows all 7 steps from the start (populated by `plan` event)
- Current step is bold with a filled dot indicator
- Counter in top right: `2 / 7`
- **Collapsed by default** during execution: single line `Task progress 2/7 ▸`
- Expandable to see all 7 steps
- On completion: `Task completed ✓ 7/7`

### Agent Groups

- Each agent is a collapsible block (like Manus)
- Shows: status icon + agent name + chevron
- Expanded: query pills with description + row count + time
- Auto-expand when active, auto-collapse when done
- No per-agent checklist, no per-agent narrative text

### Narration

- LLM-generated 1-sentence text after each agent completes
- Generated server-side as part of the summary prompt (zero extra latency)
- Appears between agent groups in the stream

---

## Hardcoded Elements Audit

Everything below is currently hardcoded and needs consideration for the redesign.

### research-timeline.tsx

**SUBAGENT_TASKS** (lines 24-95) — per-agent checklists + narrative text for 7 agents:
- `data-quality`: 5 checklist items + narrative
- `daily-metrics`: 5 checklist items + narrative
- `cohort-retention`: 5 checklist items + narrative
- `rev-opt`: 5 checklist items + narrative
- `user-segmentation`: 5 checklist items + narrative
- `geographic`: 5 checklist items + narrative
- `critique`: 5 checklist items + narrative

**deriveMainChecklist** (lines 99-143) — 7-item main checklist:
1. "Read schema and understand available data structure"
2. "Gather initial data from specialized agents in parallel (${agent names})"
3. "Build and validate hypotheses from initial findings"
4. "Conduct statistical significance tests on top insights"
5. "Synthesize findings and create comprehensive report with visualizations"
6. "Get critique and refine report"
7. "Send final report to client"

**Status strings scattered throughout:**
- "Working.." / "Task completed"
- "Thinking..."
- "Spawning specialized analysis agents to gather data across multiple dimensions:"
- "Database Query Execution"
- "Generating analysis summaries..."
- "All N agent summaries generated"
- "Running critique agent to validate analysis quality and cross-check findings:"
- "Synthesizing final report..."
- "Reading schema and planning analysis..."
- "Queries"

### use-analytics.ts

**AGENT_DISPLAY** (lines 25-33) — display names + icons for 7 agents:
```
data-quality → "Data Quality Agent" / shield
daily-metrics → "Daily Metrics Agent" / bar-chart
cohort-retention → "Cohort Retention Agent" / users
rev-opt → "Revenue Optimization Agent" / dollar
user-segmentation → "User Segmentation Agent" / clock
geographic → "Geographic Agent" / globe
critique → "Critique Agent" / check
```

**AGENT_FRIENDLY_NAMES** (lines 44-51) — for plan text generation:
```
data-quality → "data quality"
daily-metrics → "daily metrics"
cohort-retention → "cohort retention"
rev-opt → "revenue optimization"
user-segmentation → "user segmentation"
geographic → "geographic patterns"
```

**buildPlanText()** — template: "I will analyze your data across N dimensions: {list}"

**Phase status messages:**
- "Generating query..."
- "Running analysis..."
- "Preparing answer..."
- "Thinking..."

### analyze/route.ts

- Critique agent hardcoded at line 213: `subagentId: "critique"`
- Critique SQL description: "Reviewing and validating analysis outputs"
- LLM ack prompt with hardcoded example text
- Phase strings: "generating_sql", "executing", "synthesizing"

### sql-generator.ts

- Quick-mode fallback uses hardcoded `subagentId: "rev-opt"`

### chat-data.ts + conversation-data.ts

- SUBAGENT_DEFS hardcodes all 6 analysis agents + critique
- All preloaded conversations use this exact 6+1 agent set
- `makeCompleteSubs()` and `makeCritiqueSub()` return fixed agent sets

### What breaks with different agent sets

1. **SUBAGENT_TASKS**: Unknown agent IDs get no checklist → `deriveAgentChecklist` returns empty (graceful but no content). With new design this is fine since per-agent checklists are hidden.
2. **AGENT_DISPLAY**: Unknown IDs get fallback display name via `getAgentDisplay()` (line 36-39) — this works.
3. **AGENT_FRIENDLY_NAMES**: Unknown IDs fall through to `id.replace(/-/g, " ")` — works.
4. **Quick-mode fallback**: Hardcoded "rev-opt" — would look wrong for non-ecommerce datasets.
5. **Critique agent**: Hardcoded as `"critique"` throughout — the concept is universal but the ID is assumed.

### What to keep hardcoded vs make dynamic

**Keep hardcoded (universal concepts):**
- The 7-step main checklist (it describes the analysis *process*, not dataset-specific agents)
- Critique agent concept (always ID "critique")
- Phase strings ("generating_sql", "executing", "synthesizing")
- Status values ("pending", "active", "complete", "error")

**Make dynamic (dataset-specific):**
- Agent display names → already dynamic via `getAgentDisplay()` fallback
- Per-agent checklists → removing from UI (hidden in new design)
- Per-agent narrative text → replacing with LLM narration
- Plan text → already built from actual agent IDs

**Fix:**
- Quick-mode fallback `"rev-opt"` → use first available agent ID from dataset

---

## Server Changes (route.ts)

### 1. Reorder: plan before sql

Currently sql events fire BEFORE the plan event (lines 85-108). Swap so plan comes first — this lets the frontend know the agent structure before SQL arrives.

### 2. Stream summaries as they resolve

Currently: `await Promise.all(summaryPromises)` then batch-send all summaries.
Change: Use a race/resolve pattern to send each summary event as it completes.

### 3. New `narration` event

After each agent's summary resolves, send `{ type: "narration", subagentId, text }`.

To avoid extra LLM latency: modify the summary prompt to also output a `narration` field — a 1-sentence user-facing summary of findings. Parse it from the output. Single LLM call produces both summary + narration.

### 4. Phase narration

Add narration events at key transitions:
- Before critique: "All agents have completed their analysis. Validating findings..."
- Before synthesis: "Findings validated. Writing comprehensive report..."

---

## Client Changes

### research-timeline.tsx — Rewrite

Replace rigid sections with a **stream items** renderer:

```tsx
type StreamItem =
  | { type: "ack"; text: string }
  | { type: "task-progress"; checklist: ChecklistItem[]; completedCount: number }
  | { type: "agent-group"; subagent: SubagentInfo }
  | { type: "narration"; text: string }
  | { type: "status"; text: string; isLoading: boolean };
```

Render items as a flat list with `animate-fade-in-up` on each.

### use-analytics.ts — Event handling

- Handle new `narration` event type
- Store narration items in agent info (new field: `streamItems: StreamItem[]`)
- Or: derive stream items from existing agent state in the component

### types.ts

- Add `narration?: string` to SubagentInfo (per-agent narration after completion)
- Add `streamItems?: StreamItem[]` to AgentInfo if storing in state
- Or keep state minimal and derive stream items in the component from existing fields

---

## Open Questions

1. **Summary prompt modification**: Need to check if the existing summary prompts in `src/lib/prompts/analyze.ts` can cleanly accommodate a "brief_narration" output field without breaking existing parsing.
2. **Backwards compatibility**: Saved conversations with old agent structure need to render without narration (graceful degradation).
3. **Animation timing**: How long should the fade-in stagger be between items? Manus uses ~100-200ms.
4. **Collapse behavior on completion**: Auto-collapse all agents + task card, or keep last state?
