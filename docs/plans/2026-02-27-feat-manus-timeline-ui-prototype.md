# Manus-Style Timeline UI Prototype — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the research-timeline component with Manus/Perplexity-style interleaved streaming UX — UI-only prototype using existing event data (no server changes).

**Architecture:** Replace the rigid section-based `ResearchTimeline` with a flat stream of items that appear one by one. Task progress becomes a collapsible card. Agent groups appear individually as their `sql` event arrives. Narration is faked with client-side templates for now (server LLM narration comes later). The existing `AgentInfo` / `SubagentInfo` types and `use-analytics.ts` event handlers remain unchanged — all changes are in the rendering layer.

**Tech Stack:** React 19, Tailwind CSS v4, lucide-react icons, existing `animate-fade-in-up` CSS animation

---

## Scope: UI-only prototype

- Rewrite `src/components/chat/research-timeline.tsx` (the only file that changes significantly)
- No server changes, no type changes, no `use-analytics.ts` changes
- Uses existing `AgentInfo` prop — derives the stream view from current state
- Narration text generated client-side from templates (placeholder for future LLM narration)
- Must render correctly for both live sessions and saved/reloaded conversations

---

### Task 1: Scaffold the new ResearchTimeline component shell

**Files:**
- Modify: `src/components/chat/research-timeline.tsx`

**Step 1: Replace the component body with the new stream-based structure**

Keep the same props interface (`ResearchTimelineProps`). Replace the entire component body. The new structure renders three zones in sequence:

1. **Ack text** (LLM acknowledgment — same as current)
2. **Task progress card** (collapsible, shows main 7-step checklist)
3. **Stream zone** (agents + narration + status indicators appear here one by one)

```tsx
export function ResearchTimeline({
  agent,
  onSubagentClick,
}: ResearchTimelineProps) {
  const [taskCardExpanded, setTaskCardExpanded] = useState(false);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const wasLiveRef = useRef(false);
  const prevActiveRef = useRef<string | null>(null);

  const isComplete = agent.status === "complete";
  const analysis = agent.subagents.filter((s) => s.id !== "critique");
  const critique = agent.subagents.find((s) => s.id === "critique");
  const hasContent = agent.planText || agent.subagents.length > 0;

  // Derive main checklist (reuse existing deriveMainChecklist)
  const mainChecklist = deriveMainChecklist(agent);
  const completedCount = mainChecklist.filter((c) => c.checked).length;

  // Track live session
  useEffect(() => {
    if (!isComplete && agent.subagents.length > 0) wasLiveRef.current = true;
  }, [isComplete, agent.subagents.length]);

  // Auto-expand active agents, collapse previous
  useEffect(() => {
    const active = agent.subagents.find((s) => s.status === "active");
    const id = active?.id ?? null;
    if (id && id !== prevActiveRef.current) {
      setExpandedAgents((prev) => {
        const next = new Set(prev);
        if (prevActiveRef.current) next.delete(prevActiveRef.current);
        next.add(id);
        return next;
      });
      prevActiveRef.current = id;
    }
  }, [agent.subagents]);

  // Auto-hide details when done (live only)
  useEffect(() => {
    if (isComplete && wasLiveRef.current) {
      const t = setTimeout(() => setDetailsHidden(true), 600);
      return () => clearTimeout(t);
    }
  }, [isComplete]);

  // Start hidden for saved conversations
  useEffect(() => {
    if (isComplete && !wasLiveRef.current && agent.subagents.length > 0)
      setDetailsHidden(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAgent = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Header: Working / Task completed */}
      <div className="flex items-center gap-2">
        {isComplete ? (
          <Check className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 text-foreground shrink-0 animate-spin" />
        )}
        <span className="text-base font-medium">
          {isComplete ? "Task completed" : "Working.."}
        </span>
        {hasContent && (
          <button
            onClick={() => setDetailsHidden(!detailsHidden)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground ml-auto transition-colors"
          >
            {detailsHidden ? "Show details" : "Hide details"}
            {detailsHidden
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronUp className="w-3 h-3" />}
          </button>
        )}
      </div>

      {!detailsHidden && (
        <div className="space-y-3">
          {/* 1. Ack text */}
          {agent.planText && <AckText text={agent.planText} />}

          {/* 2. Task progress card */}
          {agent.subagents.length > 0 && (
            <TaskProgressCard
              checklist={mainChecklist}
              completedCount={completedCount}
              total={mainChecklist.length}
              isExpanded={taskCardExpanded}
              onToggle={() => setTaskCardExpanded((v) => !v)}
              isComplete={isComplete}
            />
          )}

          {/* 3. Stream zone — agents, narration, status */}
          <StreamZone
            analysis={analysis}
            critique={critique}
            agent={agent}
            isComplete={isComplete}
            expandedAgents={expandedAgents}
            onToggleAgent={toggleAgent}
            onSubagentClick={onSubagentClick}
          />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `pnpm build 2>&1 | head -30`
Expected: Build errors for missing sub-components (AckText, TaskProgressCard, StreamZone) — that's fine, we'll add them in subsequent tasks.

**Step 3: Commit scaffold**

```bash
git add src/components/chat/research-timeline.tsx
git commit -m "refactor: scaffold new Manus-style research timeline shell"
```

---

### Task 2: Build the TaskProgressCard component

**Files:**
- Modify: `src/components/chat/research-timeline.tsx` (add `TaskProgressCard` function)

**Step 1: Implement TaskProgressCard**

This is a bordered card that shows the main 7-step checklist. Collapsed by default during execution — shows `Task progress 2/7 ▸`. Expanded shows all steps with the current one highlighted.

```tsx
function TaskProgressCard({
  checklist,
  completedCount,
  total,
  isExpanded,
  onToggle,
  isComplete,
}: {
  checklist: { label: string; checked: boolean }[];
  completedCount: number;
  total: number;
  isExpanded: boolean;
  onToggle: () => void;
  isComplete: boolean;
}) {
  // Find the current active step (first unchecked)
  const activeIdx = checklist.findIndex((c) => !c.checked);

  return (
    <div className="border border-border/50 rounded-lg animate-fade-in-up">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left px-3 py-2"
      >
        {isComplete ? (
          <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 text-foreground animate-spin shrink-0" />
        )}
        <span className="text-sm font-medium">
          {isComplete ? "Task completed" : "Task progress"}
        </span>
        <span className="text-sm text-muted-foreground ml-auto tabular-nums">
          {completedCount} / {total}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground transition-transform shrink-0 ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {checklist.map((item, idx) => {
            const isCurrent = idx === activeIdx && !isComplete;
            return (
              <div key={idx} className="flex items-start gap-2">
                {item.checked ? (
                  <Check className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                ) : isCurrent ? (
                  <div className="w-3.5 h-3.5 rounded-full bg-foreground shrink-0 mt-0.5 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-background" />
                  </div>
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0 mt-0.5" />
                )}
                <span
                  className={`text-sm leading-relaxed ${
                    item.checked
                      ? "text-muted-foreground"
                      : isCurrent
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `pnpm build 2>&1 | head -30`

**Step 3: Commit**

```bash
git add src/components/chat/research-timeline.tsx
git commit -m "feat: add TaskProgressCard component for research timeline"
```

---

### Task 3: Build the AckText and StreamZone components

**Files:**
- Modify: `src/components/chat/research-timeline.tsx` (add `AckText`, `StreamZone`, `AgentGroup`)

**Step 1: Implement AckText**

Simple component — green dot + LLM acknowledgment text. Same as current but extracted.

```tsx
function AckText({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 animate-fade-in-up">
      <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-emerald-500" />
      <p className="text-[15px] text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}
```

**Step 2: Implement StreamZone**

This is the heart of the new design. It renders agents one by one (only those that have SQL — status !== "pending"), interleaved with narration text, plus status indicators.

```tsx
// Client-side narration templates (placeholder for future LLM narration)
function getAgentNarration(sub: SubagentInfo): string | null {
  if (sub.status !== "complete" || !sub.summary) return null;
  // Take the first sentence of the summary as narration
  const firstSentence = sub.summary.split(/[.!?]\s/)[0];
  if (!firstSentence || firstSentence.length > 200) return null;
  return firstSentence + ".";
}

function StreamZone({
  analysis,
  critique,
  agent,
  isComplete,
  expandedAgents,
  onToggleAgent,
  onSubagentClick,
}: {
  analysis: SubagentInfo[];
  critique: SubagentInfo | undefined;
  agent: AgentInfo;
  isComplete: boolean;
  expandedAgents: Set<string>;
  onToggleAgent: (id: string) => void;
  onSubagentClick: (id: string) => void;
}) {
  const hasSql = agent.subagents.some((s) => s.queries.length > 0);
  const allSummaries =
    analysis.length > 0 && analysis.every((s) => s.summary);

  // Only show agents that have started (have SQL or are complete)
  const visibleAgents = analysis.filter(
    (s) => s.status !== "pending" || isComplete
  );

  return (
    <div className="space-y-3">
      {/* Pre-SQL thinking indicator */}
      {!isComplete && agent.subagents.length > 0 && !hasSql && (
        <div className="flex items-center gap-2 animate-fade-in-up">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">Thinking...</span>
        </div>
      )}

      {/* Agent groups with interleaved narration */}
      {visibleAgents.map((sub) => (
        <div key={sub.id} className="space-y-2">
          <AgentGroup
            subagent={sub}
            isExpanded={expandedAgents.has(sub.id)}
            onToggle={() => onToggleAgent(sub.id)}
            onNameClick={() => onSubagentClick(sub.id)}
          />
          {/* Narration after completed agent */}
          {sub.status === "complete" && sub.summary && (
            <NarrationText text={getAgentNarration(sub)} />
          )}
        </div>
      ))}

      {/* Summaries generating indicator */}
      {hasSql &&
        !allSummaries &&
        !isComplete &&
        analysis.every((s) => s.queries.every((q) => q.rowCount != null || q.error)) && (
          <StatusLine text="Generating analysis summaries..." isLoading />
        )}

      {/* All summaries done */}
      {allSummaries && !isComplete && !critique && (
        <StatusLine
          text={`All ${analysis.length} agent summaries generated`}
          isLoading={false}
        />
      )}

      {/* Critique agent */}
      {critique && (critique.status !== "pending" || isComplete) && (
        <div className="space-y-2">
          <NarrationText text="All agents have completed their analysis. Validating findings..." />
          <AgentGroup
            subagent={critique}
            isExpanded={expandedAgents.has("critique")}
            onToggle={() => onToggleAgent("critique")}
            onNameClick={() => onSubagentClick("critique")}
          />
          {critique.summary && (
            <NarrationText text={getAgentNarration(critique)} />
          )}
        </div>
      )}

      {/* Synthesizing indicator */}
      {(critique?.summary || allSummaries) && !isComplete && (
        <StatusLine text="Synthesizing final report..." isLoading />
      )}

      {/* Pre-content — nothing yet */}
      {!agent.planText && agent.subagents.length === 0 && !isComplete && (
        <div className="flex gap-2.5 animate-fade-in-up">
          <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-[15px] text-muted-foreground">
            Reading schema and planning analysis...
          </p>
        </div>
      )}

      {/* Collapsed query summary (when complete) */}
      {isComplete && <QuerySummary analysis={analysis} />}
    </div>
  );
}
```

**Step 3: Implement NarrationText and StatusLine**

```tsx
function NarrationText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="text-sm text-muted-foreground leading-relaxed pl-5 animate-fade-in-up">
      {text}
    </p>
  );
}

function StatusLine({ text, isLoading }: { text: string; isLoading: boolean }) {
  return (
    <div className="flex items-center gap-2 animate-fade-in-up">
      {isLoading ? (
        <Loader2 className="w-3 h-3 text-foreground animate-spin shrink-0" />
      ) : (
        <Check className="w-3 h-3 text-muted-foreground shrink-0" />
      )}
      <span className="text-sm text-muted-foreground">{text}</span>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add src/components/chat/research-timeline.tsx
git commit -m "feat: add StreamZone with interleaved agents and narration"
```

---

### Task 4: Build the AgentGroup component (Manus-style collapsible)

**Files:**
- Modify: `src/components/chat/research-timeline.tsx` (add `AgentGroup` and `QueryPill`)

**Step 1: Implement AgentGroup**

Replaces the old `AgentBlock`. Key differences from old version:
- No per-agent checklist (hidden)
- No per-agent narrative text
- Query pills show inline stats (row count, time)
- Cleaner collapsed state: just name + status + query count

```tsx
function AgentGroup({
  subagent,
  isExpanded,
  onToggle,
  onNameClick,
}: {
  subagent: SubagentInfo;
  isExpanded: boolean;
  onToggle: () => void;
  onNameClick: () => void;
}) {
  const completedQueries = subagent.queries.filter(
    (q) => q.rowCount != null || q.error
  ).length;
  const totalQueries = subagent.expectedQueryCount || subagent.queries.length;

  return (
    <div className="animate-fade-in-up">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left py-0.5"
      >
        <StatusDot status={subagent.status} />
        <span
          onClick={(e) => {
            e.stopPropagation();
            onNameClick();
          }}
          className="text-sm font-medium hover:underline underline-offset-2 cursor-pointer truncate"
        >
          {subagent.name}
        </span>
        {totalQueries > 0 && (
          <span className="text-sm text-muted-foreground ml-auto tabular-nums">
            {completedQueries}/{totalQueries} queries
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground transition-transform shrink-0 ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
      </button>

      {isExpanded && subagent.queries.length > 0 && (
        <div className="mt-1 ml-5 space-y-0.5 pb-1">
          {subagent.queries.map((q, i) => (
            <QueryPill key={i} query={q} subagent={subagent} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Implement QueryPill**

Styled as a compact pill/row — like the Manus action pills with an icon + description + stats.

```tsx
function QueryPill({
  query,
  subagent,
  index,
}: {
  query: QueryInfo;
  subagent: SubagentInfo;
  index: number;
}) {
  const isDone = query.rowCount != null;
  const isError = !!query.error;
  const doneCount = subagent.queries.filter(
    (q) => q.rowCount != null || q.error
  ).length;
  const isActive =
    !isDone && !isError && subagent.status === "active" && index === doneCount;

  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <div className="shrink-0">
        {isDone ? (
          <Check className="w-3 h-3 text-muted-foreground" />
        ) : isError ? (
          <X className="w-3 h-3 text-red-400" />
        ) : isActive ? (
          <Loader2 className="w-3 h-3 text-foreground animate-spin" />
        ) : (
          <div className="w-3 h-3 rounded-full border border-muted-foreground/20" />
        )}
      </div>
      <span className="text-muted-foreground truncate flex-1">
        {query.description}
      </span>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {isDone &&
          `${query.rowCount!.toLocaleString()} rows · ${formatTime(query.executionTimeMs!)}`}
        {isError && "failed"}
      </span>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/chat/research-timeline.tsx
git commit -m "feat: add Manus-style AgentGroup with QueryPill"
```

---

### Task 5: Build the QuerySummary component and clean up old code

**Files:**
- Modify: `src/components/chat/research-timeline.tsx`

**Step 1: Implement QuerySummary**

Collapsed-by-default total execution summary. Shows `Executed 14 queries in 4.2s ▸` which expands to per-agent breakdown.

```tsx
function QuerySummary({ analysis }: { analysis: SubagentInfo[] }) {
  const [expanded, setExpanded] = useState(false);

  const agentsWithQueries = analysis.filter((s) => s.queries.length > 0);
  if (agentsWithQueries.length === 0) return null;

  const totalQueries = agentsWithQueries.reduce(
    (sum, s) => sum + s.queries.filter((q) => q.rowCount != null).length,
    0
  );
  const totalTimeMs = agentsWithQueries.reduce(
    (sum, s) =>
      sum +
      s.queries
        .filter((q) => q.executionTimeMs != null)
        .reduce((a, q) => a + (q.executionTimeMs || 0), 0),
    0
  );

  return (
    <div className="animate-fade-in-up">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Check className="w-3 h-3 shrink-0" />
        <span>
          Executed {totalQueries} queries in {formatTime(totalTimeMs)}
        </span>
        <ChevronDown
          className={`w-3 h-3 transition-transform shrink-0 ${
            expanded ? "" : "-rotate-90"
          }`}
        />
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-0.5">
          {agentsWithQueries.map((sub) => {
            const done = sub.queries.filter((q) => q.rowCount != null).length;
            const total = sub.expectedQueryCount || sub.queries.length;
            const time = sub.queries
              .filter((q) => q.executionTimeMs != null)
              .reduce((a, q) => a + (q.executionTimeMs || 0), 0);
            return (
              <div key={sub.id} className="flex items-center gap-2 py-0.5">
                <Check className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground truncate">
                  {sub.name}
                </span>
                <span className="text-sm text-muted-foreground ml-auto tabular-nums">
                  {done}/{total} · {formatTime(time)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Remove old dead code**

Delete these from the file (they are no longer used):
- Old `SUBAGENT_TASKS` object (lines 24-95) — per-agent checklists are hidden now
- Old `deriveAgentChecklist` function (lines 147-163) — no longer rendered
- Old `AgentBlock` function (lines 436-549) — replaced by `AgentGroup`

Keep:
- `deriveMainChecklist` — still used by `TaskProgressCard`
- `StatusDot` — still used by `AgentGroup`
- `formatTime` — still used everywhere

**Step 3: Verify the full build compiles**

Run: `pnpm build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add src/components/chat/research-timeline.tsx
git commit -m "feat: add QuerySummary, remove old block-based timeline code"
```

---

### Task 6: Manual QA — verify with live and saved conversations

**Step 1: Start dev server and test**

Run: `pnpm dev`

Test these scenarios:
1. **Saved conversation**: Click a preloaded conversation in sidebar. The timeline should render in collapsed state with "Task completed" and "Show details" toggle.
2. **Expand details**: Click "Show details" → see ack text, task progress card (collapsed), completed agent groups, query summary.
3. **Live deep research**: Type a question (e.g. "give me overall business health"). Verify:
   - Ack text appears first
   - Task progress card appears with counter incrementing
   - Agent groups appear **one by one** as SQL events arrive (not all at once)
   - Query pills show inline stats as results come in
   - Narration text appears after each agent completes
   - Critique section appears after analysis agents
   - "Synthesizing final report..." status line appears
   - Timeline auto-collapses when done
4. **Expand task progress card**: Click it open, verify steps check off progressively. Current step should be bold with filled dot.
5. **Quick mode**: Toggle to quick mode, send a question. Timeline should NOT appear (quick mode uses streaming message, not agent timeline).

**Step 2: Check for visual regressions**

- No color violations (monochrome only — `muted`, `foreground`, `border` tokens)
- Green dot on ack text is the only non-monochrome element (matches current)
- Animations feel smooth, no layout shift

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: QA polish for Manus-style timeline prototype"
```

---

## Summary of changes

| File | Change |
|------|--------|
| `src/components/chat/research-timeline.tsx` | Full rewrite — new components: `TaskProgressCard`, `AckText`, `StreamZone`, `AgentGroup`, `QueryPill`, `NarrationText`, `StatusLine`, `QuerySummary`. Removed: `SUBAGENT_TASKS`, `deriveAgentChecklist`, `AgentBlock`. |

**No changes to:**
- `src/hooks/use-analytics.ts` (event handling unchanged)
- `src/lib/types.ts` (no type changes)
- `src/app/api/analyze/route.ts` (no server changes)
- `src/components/chat/chat-thread.tsx` (same `<ResearchTimeline>` usage)

---

## What this prototype does NOT include (future tasks)

1. **Server-side LLM narration** — currently faked with first-sentence-of-summary extraction
2. **Server `plan` before `sql` reorder** — currently both arrive in a burst; progressive reveal depends on this server change
3. **Staggered summary streaming** — server still batches all summaries via `Promise.all`
4. **`narration` SSE event type** — new server event not added yet
5. **Quick-mode fallback agent ID fix** — still hardcoded `"rev-opt"`
