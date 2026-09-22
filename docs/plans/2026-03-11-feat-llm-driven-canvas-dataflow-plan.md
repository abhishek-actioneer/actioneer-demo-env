---
title: "feat: LLM-Driven Canvas Dataflow"
type: feat
status: active
date: 2026-03-11
origin: docs/brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md
---

# feat: LLM-Driven Canvas Dataflow

## Overview

Replace all hardcoded card creation and edge wiring in the canvas with an LLM-driven approach. Today, every canvas query produces the same fixed topology: SQL -> Table + Chart -> Summary. The LLM has no say in the output structure. This makes the canvas useless for anything beyond basic L2 queries.

The new system lets the LLM decide:
- **What cards to create** (and which types)
- **How they connect** (the dependency graph)
- **What data flows between them**

The client becomes a dumb renderer: it receives a graph spec from the server, creates nodes and edges, and computes layout from topology. No hardcoded assumptions about card types, counts, or wiring.

## Problem Statement

### What's broken

1. **Hardcoded topology**: `canvas-page.tsx` lines 1072-1241 wire SQL->Table, SQL->Chart (now Table->Chart), Table+Chart->Summary. This is wrong for:
   - L1 queries ("how many users?") — should produce SQL + Metric, not SQL + Table + Chart + Summary
   - L3 queries ("deep analysis of retention vs revenue") — should produce multiple SQLs, multiple tables, comparison charts, sub-summaries, final synthesis
   - Any non-standard flow — two tables feeding one chart, a chart without a table, etc.

2. **Single-SQL limitation**: `/api/canvas-query` calls `generateQueries(query, "quick")` which always produces exactly 1 SQL query. L3 is impossible.

3. **Hardcoded pixel layout**: Card sizes and positions are `const sqlSize = { width: 420, height: 240 }` etc. with fixed `V_GAP = 40`, `H_GAP = 30` offsets. No graph awareness.

4. **Duplicated stream handlers**: `handlePromptSubmit` (line 917) and the chat-to-canvas handler (line 1262) are ~200 lines of near-identical code. Every change must be applied twice.

5. **No typed SSE contract**: Canvas events are parsed as raw `Record<string, unknown>` with `event.type as string`. The main chat has a typed `AnalyzeSSEEvent` union; the canvas has nothing.

6. **tldraw remnants**: `canvas-types.ts`, `canvas-store.ts` (marked DEPRECATED), tldraw comments throughout, `tldraw` still in `package.json`, camera migration code in `canvas-flow.tsx`.

### What we want

A user types "show me retention vs revenue by cohort with a comparison" and gets a DAG like:

```
[SQL: retention] ──data──> [Table: retention] ──┐
                                                ├──comparison──> [Chart: retention vs revenue]
[SQL: revenue]   ──data──> [Table: revenue]   ──┘                         │
                                                                    analysis
                                                                          │
                                                                          v
                                                                  [Summary: synthesis]
```

The shape, depth, and connectivity of this graph are entirely determined by the LLM based on the query complexity. The canvas client just renders whatever graph the server sends.

## Proposed Solution

### Core Architecture

```
User query
    │
    v
/api/canvas-query (server)
    │
    ├─ Step 1: LLM plans the card graph (new "plan" phase)
    │    Returns: { cards: [{ cardId, type, derivedFrom }], mode: "quick"|"deep" }
    │
    ├─ Step 2: Execute plan
    │    For each planned card in topological order:
    │      - SQL cards: generate + execute SQL
    │      - Table cards: format query results
    │      - Chart cards: detect chart spec from upstream data
    │      - Text cards: synthesize from upstream data
    │      - Metric cards: extract single value
    │
    ├─ Step 3: Stream events with cardId + derivedFrom
    │    Each event carries its place in the graph
    │
    v
Client (canvas-page.tsx)
    │
    ├─ On "plan" event: compute layout from graph topology
    ├─ On card events: create node at pre-computed position
    ├─ On card events: create edges from derivedFrom
    ├─ On "done": fitView, auto-frame
    v
React Flow renders the DAG
```

### The Graph Plan

The key insight: **add a planning phase** before execution. The LLM sees the query and schema, then outputs a graph plan — a JSON array of card descriptors with their dependencies. The server validates the plan (acyclicity, valid types, valid references), then executes it.

This is analogous to how `/api/analyze` already has a `plan` SSE event that describes the agent structure before execution begins.

**Why server-assigned cardIds (not LLM-assigned)**:
- LLMs hallucinate IDs. The server assigns monotonic IDs (`card-0`, `card-1`, ...) and maps the LLM's plan to stable references.
- The server guarantees topological emission order — sources always emitted before their dependents.
- The client never sees invalid `derivedFrom` references.

## Technical Approach

### Phase 1: SSE Contract + Graph Plan (Foundation)

Define the typed event schema and the planning LLM call. This is the foundation everything else builds on.

#### 1a. Canvas SSE Types (`src/lib/canvas-sse-types.ts` — new file)

```typescript
// Typed discriminated union for canvas NDJSON events

export type CanvasCardPlan = {
  cardId: string;          // server-assigned, e.g. "card-0"
  type: CardType;          // "sql" | "table" | "chart" | "text" | "metric" | ...
  title: string;           // LLM-generated title
  derivedFrom: string[];   // cardIds this card depends on
};

export type CanvasSSEEvent =
  | { type: "plan"; cards: CanvasCardPlan[]; queryGroupId: string }
  | { type: "card-data"; cardId: string; cardType: "sql"; sql: string; description: string }
  | { type: "card-data"; cardId: string; cardType: "query_result"; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; timeMs: number; error?: string }
  | { type: "card-data"; cardId: string; cardType: "chart"; chartSpec: ChartSpec }
  | { type: "card-data"; cardId: string; cardType: "metric"; value: string | number; label: string; delta?: string }
  | { type: "card-data"; cardId: string; cardType: "text"; delta: string }
  | { type: "card-data"; cardId: string; cardType: "annotation"; text: string; severity: string }
  | { type: "card-complete"; cardId: string }
  | { type: "progress"; cardId: string; phase: string }
  | { type: "done"; queryGroupId: string }
  | { type: "error"; message: string; cardId?: string };
```

**Key design decisions:**
- `plan` is the FIRST event — client receives the full graph topology upfront, computes layout, then fills in data as card events arrive
- `card-data` events are keyed by `cardId` so the client knows which pre-positioned placeholder to fill
- `card-complete` signals a single card is fully loaded (client can remove its loading state)
- `queryGroupId` ties all cards from one query together for undo/refresh/framing
- `derivedFrom` only appears in `plan`, not on every event — edges are computed once from the plan

**Files:**
- `src/lib/canvas-sse-types.ts` (new) — type definitions + `parseCanvasEvent(line: string): CanvasSSEEvent | null` parser

#### 1b. Graph Plan Prompt (`/api/canvas-query/route.ts`)

Add a new LLM call at the start of the pipeline that produces the graph plan.

```
System: You are an analytics planner. Given a user's question and a database schema,
decide what visual cards to create on an analytics canvas.

Output a JSON array of card descriptors. Each card has:
- id: short identifier (e.g. "sql-1", "table-1", "chart-1", "summary")
- type: one of "sql", "table", "chart", "metric", "text"
- title: descriptive title for the card
- derivedFrom: array of ids this card depends on (empty for root cards)
- intent: brief description of what this card should contain

Rules:
- For simple factual questions (counts, totals), use: sql -> metric
- For data exploration with rows, use: sql -> table
- For data that benefits from visualization, use: sql -> table -> chart
- Charts are ALWAYS derived from tables, never directly from SQL
- Add a "text" summary card that synthesizes all leaf cards
- For complex questions requiring multiple data cuts, use multiple sql cards
- Maximum 8 cards total. Keep it minimal.
- No cycles allowed.

Schema: {systemContext}
Question: "{query}"
```

The server then:
1. Parses the LLM plan JSON
2. Validates: no cycles (DFS), all `derivedFrom` refs exist, valid types
3. Assigns stable `cardId` values (`card-0`, `card-1`, ...) replacing LLM ids
4. Emits `{ type: "plan", cards: [...], queryGroupId }` as the first SSE event
5. Executes cards in topological order, emitting `card-data` events

**Files:**
- `src/app/api/canvas-query/route.ts` — add `buildGraphPlanPrompt()`, plan validation, topological execution loop

#### 1c. Plan Validation (`src/lib/canvas-graph-utils.ts` — new file)

```typescript
export function validateGraphPlan(cards: CanvasCardPlan[]): { valid: boolean; error?: string };
export function topologicalOrder(cards: CanvasCardPlan[]): CanvasCardPlan[];
export function hasCycle(cards: CanvasCardPlan[]): boolean;
```

Reuse the topological sort logic from `canvas-executor.ts` but operating on the plan structure (not `CardConnection[]`).

**Deliverables:**
- [x] `src/lib/canvas-sse-types.ts` — typed event union + parser
- [x] `src/lib/canvas-graph-utils.ts` — plan validation, cycle detection, topological sort
- [x] `src/app/api/canvas-query/route.ts` — graph plan prompt + validation + topological execution
- [x] Plan event emitted as first SSE event with full graph structure

**Success criteria:**
- Server emits `plan` event with valid, acyclic graph for any query
- All subsequent `card-data` events reference cardIds from the plan
- Events arrive in topological order (sources before dependents)

---

### Phase 2: Graph-Aware Layout (`canvas-layout.ts`)

Replace the packing algorithm with a layered DAG layout.

#### 2a. Layered Layout Algorithm

Input: `CanvasCardPlan[]` (the graph plan from Phase 1)
Output: `Map<string, { x: number; y: number; width: number; height: number }>`

Algorithm (simplified Sugiyama):
1. **Layer assignment**: each card's layer = longest path from any root to it
2. **Layer ordering**: within each layer, order nodes to minimize edge crossings (barycenter heuristic)
3. **Position assignment**: center each layer horizontally, space vertically with `V_GAP`
4. **Size lookup**: use `DEFAULT_SIZE[cardType]` for initial sizes (auto-resize later via ResizeObserver)

```
Layer 0:  [SQL-1]              [SQL-2]
Layer 1:  [Table-1]            [Table-2]
Layer 2:  [Chart-1]   [Chart-comparison]
Layer 3:           [Summary]
```

**Anchor point**: the layout is computed relative to `(0, 0)` and then translated to the user's click position or viewport center.

#### 2b. Placeholder Nodes

When the `plan` event arrives, immediately create placeholder nodes at the computed positions. Each placeholder shows:
- Card type icon + title (from the plan)
- Loading shimmer
- Correct size for its type

As `card-data` events arrive, the placeholder transitions to the real card content. This gives the user immediate visual feedback of the graph structure while data loads.

**Files:**
- `src/lib/canvas-layout.ts` — add `computeDAGLayout(plan: CanvasCardPlan[], anchor: {x,y}): Map<string, Rect>`
- `src/components/canvas/nodes/canvas-card-node.tsx` — placeholder/loading state when card has no data yet
- `src/components/canvas/card-renderers/shared.tsx` — `CardPlaceholder` component

**Deliverables:**
- [x] `computeDAGLayout()` function with layered algorithm
- [x] Placeholder nodes rendered on `plan` event
- [x] Placeholders transition to real content on `card-data` events
- [ ] `fitView()` called after all placeholders are placed

**Success criteria:**
- L1 query: 2 nodes in a vertical line
- L2 query: 4 nodes in a 3-layer DAG
- L3 query: 6-8 nodes in a multi-column DAG with fan-in
- No overlapping nodes
- Edges visually clear (no long diagonal crossings)

---

### Phase 3: Dynamic Client-Side Rendering

Rewrite the canvas-page card creation to be fully driven by the graph plan.

#### 3a. Unified Stream Processor (`src/components/canvas/use-canvas-stream.ts` — new hook)

Extract all NDJSON parsing, card creation, and edge wiring from both `handlePromptSubmit` AND the chat-to-canvas handler into a single reusable hook.

```typescript
export function useCanvasStream(boardId: string) {
  return {
    processStream: (reader: ReadableStreamDefaultReader, anchor: { x: number; y: number }) => Promise<void>,
    isStreaming: boolean,
    cancel: () => void,         // AbortController-backed
    currentQueryGroupId: string | null,
  };
}
```

The stream processor:
1. On `plan` event: compute layout via `computeDAGLayout()`, create placeholder nodes, create all edges from `derivedFrom`
2. On `card-data` events: update the corresponding placeholder with real data
3. On `card-complete`: mark card as loaded (remove shimmer)
4. On `done`: `fitView()`, create `BoardFrame` around the query group, cleanup
5. On `error`: surface error on the relevant card (or globally if no cardId)

**All edges are created in step 1 from the plan.** No more hardcoded `createEdge(sqlCardId, tableCardId, "data")` calls scattered through the stream handler.

#### 3b. Edge Creation from Plan

```typescript
// In the stream processor, on "plan" event:
for (const card of plan.cards) {
  for (const sourceId of card.derivedFrom) {
    const conn: CardConnection = {
      id: crypto.randomUUID(),
      boardId,
      fromCardId: serverIdToNodeId.get(sourceId)!,
      toCardId: serverIdToNodeId.get(card.cardId)!,
      label: inferEdgeLabel(plan, sourceId, card.cardId), // "data" | "visualization" | "analysis"
    };
    addConnection(conn);
    setEdges((prev) => [...prev, connectionToEdge(conn)]);
  }
}
```

Edge labels are inferred from the source/target types:
- sql -> table/chart/metric: `"data"`
- table -> chart: `"visualization"`
- anything -> text: `"analysis"`
- anything -> anything (default): `"flow"`

#### 3c. Handle Configuration Simplification

Every card type gets both source and target handles. Remove the `SOURCE_TYPES` / `TARGET_TYPES` / `BIDIRECTIONAL_TYPES` distinction entirely. The LLM decides the graph; the handle system should not constrain it.

```typescript
// canvas-adapter.ts — simplified
export function hasSourceHandle(_cardType: string): boolean {
  return true; // every card can be a source
}
export function hasTargetHandle(_cardType: string): boolean {
  return true; // every card can be a target
}
```

Exception: keep `sticky` and `follow-up` as target-only (they're annotation cards, not data producers).

#### 3d. Cycle Prevention on Manual Edge Drawing

Add acyclicity check to `onConnect` in `canvas-flow.tsx`:

```typescript
const onConnect = useCallback((connection) => {
  // Check if adding this edge would create a cycle
  const allConnections = getBoardConnections(boardId);
  const proposed = { fromCardId: connection.source, toCardId: connection.target };
  if (wouldCreateCycle([...allConnections, proposed])) {
    toast.error("Cannot create a cycle in the dataflow");
    return;
  }
  // ... existing connection logic
}, [boardId]);
```

#### 3e. Query Queueing

Disable the prompt input while a stream is active. Show a subtle "Query in progress..." indicator. This prevents concurrent streams from stomping each other's layout calculations.

**Files:**
- `src/components/canvas/use-canvas-stream.ts` (new) — unified stream processor hook
- `src/components/canvas/canvas-page.tsx` — rewrite `handlePromptSubmit` and chat handler to use `useCanvasStream`
- `src/components/canvas/canvas-adapter.ts` — simplify handle configuration
- `src/components/canvas/canvas-flow.tsx` — add cycle prevention on `onConnect`
- `src/components/canvas/prompt-to-card-input.tsx` — disabled state during streaming

**Deliverables:**
- [x] `useCanvasStream` hook replaces both duplicated handlers
- [x] All edges created from plan (zero hardcoded edges)
- [x] All card types have both source + target handles
- [ ] Cycle prevention on manual edge drawing
- [x] Query queueing (one at a time)
- [x] AbortController for stream cancellation

**Success criteria:**
- `canvas-page.tsx` has zero `createEdge()` calls — all edges come from the plan
- A query produces the exact graph the LLM planned
- Manual edge drawing rejects cycles with a toast
- Second query waits for first to complete

---

### Phase 4: L3 Deep Research on Canvas

Extend `/api/canvas-query` to support multi-SQL deep research mode.

#### 4a. Query Complexity Classification

Add an LLM call (or heuristic) to classify query complexity before planning:

```
L1 (simple): factual questions, single aggregation → quick mode (1 SQL)
L2 (moderate): data exploration, single data cut → quick mode (1 SQL + chart)
L3 (complex): multi-dimensional analysis, comparison, deep research → deep mode (N SQLs)
```

The graph plan prompt already handles this — if the LLM plans multiple SQL cards, the server knows it's L3. No separate classification call needed.

#### 4b. Multi-SQL Execution

When the plan contains multiple SQL cards, the server:
1. Generates SQL for each SQL card (parallel LLM calls)
2. Executes each SQL (parallel DuckDB queries)
3. For each table card: formats its upstream SQL's results
4. For each chart card: runs chart detection on its upstream table's data
5. For each text card: synthesizes from all upstream card data
6. Emits events in topological order

This mirrors the existing `/api/analyze` multi-agent pipeline but with graph-aware event emission.

#### 4c. Progress Events

For L3 queries that take longer, emit `progress` events per card:

```json
{ "type": "progress", "cardId": "card-2", "phase": "executing_sql" }
{ "type": "progress", "cardId": "card-2", "phase": "complete" }
```

The client updates the placeholder's loading state to show which phase each card is in.

#### 4d. Partial Failure Handling

If one SQL card in an L3 query fails:
- That card gets an error state (red border, error message)
- Downstream cards from that branch are skipped (not created)
- Other branches continue normally
- The synthesis/summary card notes the missing data: "Note: retention data was unavailable due to a query error"

**Files:**
- `src/app/api/canvas-query/route.ts` — multi-SQL execution loop, parallel generation, progress events
- `src/lib/sql-generator.ts` — may need a canvas-specific mode for parallel SQL generation
- `src/components/canvas/card-renderers/shared.tsx` — error state rendering for failed cards
- `src/components/canvas/nodes/canvas-card-node.tsx` — progress phase indicator in placeholder

**Deliverables:**
- [ ] Multi-SQL execution in topological order
- [ ] Parallel SQL generation for independent cards
- [ ] Progress events per card
- [ ] Partial failure: error cards, skipped downstream, summary notes missing data
- [ ] L3 queries produce correct multi-branch DAGs

**Success criteria:**
- "Revenue by day and hub" produces a 4-card DAG (L2)
- "Compare retention vs revenue by cohort" produces a 6-8 card DAG (L3) with fan-in
- A failed SQL branch shows error state and doesn't block other branches

---

### Phase 5: Cleanup + Query Groups

#### 5a. tldraw Removal

- [x] Remove `tldraw` from `package.json`
- [ ] Delete `src/lib/canvas-types.ts` (old tldraw-era types) — still used by SmartStack + intersection-cards
- [ ] Delete `src/lib/canvas-store.ts` (marked DEPRECATED) — still used by SmartStack + intersection-cards + page.tsx
- [x] Remove tldraw camera migration code from `canvas-flow.tsx` `loadCamera()`
- [x] Remove tldraw comments from `canvas-events.ts`, `canvas-layout.ts`, `text-renderer.tsx`
- [x] Remove `ConnectStartPayload` / `ConnectEndPayload` from `canvas-events.ts` (tldraw-era relics)
- [ ] Delete `docs/archived/` tldraw references (leave as historical)
- [ ] Remove tldraw CSS severity tokens from `globals.css` if unused

#### 5b. Query Group Support

Add `queryGroupId: string` to `BoardCard`. When a query completes:

1. All cards from that query share the same `queryGroupId`
2. Auto-create a `BoardFrame` around the card group (title from the query text)
3. Enable "Re-run query" action on the frame (refreshes all root SQL cards in the group)
4. Enable "Remove query" action on the frame (deletes all cards + connections in the group)

**Files:**
- `src/lib/board-types.ts` — add `queryGroupId?: string` to `BoardCard`
- `src/lib/board-store.ts` — add `getCardsByQueryGroup(boardId, queryGroupId)`
- `src/components/canvas/canvas-page.tsx` — auto-frame creation after query
- `package.json` — remove `tldraw` dependency
- Various files — comment cleanup

**Deliverables:**
- [x] tldraw dependency removed + comments cleaned (types/store kept — still have consumers)
- [x] `queryGroupId` on `BoardCard`
- [x] `getCardsByQueryGroup()` in board-store
- [ ] Auto-framing of query results
- [ ] Re-run and remove actions on query frames
- [x] Dead code removed: `connection-layer.tsx`

---

## System-Wide Impact

### Interaction Graph

```
User submits query
  → canvas-page.tsx: handlePromptSubmit()
    → useCanvasStream.processStream()
      → apiFetch("/api/canvas-query", { stream: true })
        → canvas-query/route.ts: LLM plan → validate → execute → stream
      ← SSE "plan" event
        → computeDAGLayout() → placeholder nodes + edges created
        → setNodes(), setEdges(), addConnection()
      ← SSE "card-data" events (topological order)
        → saveBoardCard() for each card
        → placeholder transitions to real content
      ← SSE "done" event
        → fitView()
        → auto-create BoardFrame
        → update CanvasQueryStatus for chat bridge
```

### Error & Failure Propagation

- **LLM plan generation fails**: Server emits `{ type: "error", message: "Failed to plan query" }`. Client shows toast.
- **Plan validation fails (cycle detected)**: Server emits error. This should be extremely rare since the plan prompt explicitly says no cycles.
- **Individual SQL execution fails**: Server emits `card-data` with `error` field. Client renders error state on that card. Downstream cards skipped.
- **Chart detection fails**: Best-effort. Card renders as table-only (no chart card created). This is a plan deviation — server emits a `card-complete` for the planned chart card with empty data.
- **Stream interruption (network)**: AbortController fires. Partially created cards remain on board. User can delete or re-run.
- **Summary LLM call fails**: Server emits error on the text card. Card shows "Unable to generate summary."

### State Lifecycle Risks

- **Partial query**: Cards created before stream interruption have no `queryGroupId` if `done` event never fires. Mitigation: assign `queryGroupId` during `plan` event processing, not `done`.
- **Board switch during stream**: AbortController cancels the stream. Cards already created stay on the original board. No cross-board contamination.
- **localStorage quota**: L3 queries with large data tables could push localStorage limits. Existing risk, not new — but more cards per query increases it.

### API Surface Parity

- `/api/canvas-query` — changes (graph plan + multi-SQL + new SSE format)
- `/api/canvas-refresh` — unchanged (still batch SQL re-execution)
- `canvas-executor.ts` — unchanged (already has topological sort, works with `CardConnection`)
- `/api/canvas-comment` — unchanged
- All other canvas API routes — unchanged

## Acceptance Criteria

### Functional Requirements

- [ ] L1 query ("how many users?") produces SQL + Metric card, 1 edge
- [ ] L2 query ("revenue by day") produces SQL + Table + Chart + Summary, correct edges
- [ ] L3 query ("compare retention vs revenue by cohort") produces multi-SQL DAG with fan-in
- [ ] All edges are LLM-decided (zero hardcoded edge wiring in client code)
- [ ] Card layout is computed from graph topology (layered DAG)
- [ ] Placeholder nodes appear immediately on plan event with loading state
- [ ] Cards fill in progressively as data streams
- [ ] `fitView()` after query completes
- [ ] Query results auto-framed with query text as title
- [ ] Manual edge drawing rejects cycles
- [ ] Stream cancellation via AbortController
- [ ] Partial failure shows error state on failed cards, other branches continue
- [ ] Sidebar chat-to-canvas uses the same unified stream processor
- [ ] tldraw fully removed from codebase

### Non-Functional Requirements

- [ ] L1 queries: < 3 seconds end-to-end
- [ ] L2 queries: < 8 seconds end-to-end
- [ ] L3 queries: < 20 seconds end-to-end (parallel SQL execution)
- [ ] Canvas remains responsive during streaming (no layout thrash)
- [ ] Zero TypeScript errors from canvas modules
- [ ] Monochrome UI maintained (no colored elements unless explicitly requested)

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM produces invalid graph plans (cycles, bad refs) | Medium | Low | Server-side validation + fallback to simple linear plan |
| Graph plan adds latency (extra LLM call) | High | Medium | Plan prompt is fast (~500 tokens output). Can overlap with SQL generation for first card. |
| Layered layout produces ugly graphs for some topologies | Medium | Medium | Start simple (Sugiyama-lite), iterate on spacing/ordering. User can always drag cards. |
| L3 deep research is slow (multiple sequential LLM calls) | High | Medium | Parallelize independent SQL generation. Stream progress events so user sees activity. |
| `canvas-store.ts` / `canvas-types.ts` deletion breaks something | Low | Low | Grep for all imports before deleting. Both are marked DEPRECATED. |

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md](docs/brainstorms/2026-02-17-canvas-generative-ui-brainstorm.md) — established the "structured block protocol" concept and the vision of a living intelligence surface. Key decisions: canvas as separate surface from chat, typed blocks over raw markdown, freeform placement. tldraw choice has since been replaced with React Flow.

### Internal References

- `src/app/api/canvas-query/route.ts` — current single-SQL pipeline, target for graph plan + multi-SQL
- `src/components/canvas/canvas-page.tsx:917-1259` — handlePromptSubmit with hardcoded edges
- `src/components/canvas/canvas-page.tsx:1262-1490` — chat-to-canvas handler (duplicate)
- `src/lib/canvas-executor.ts:91` — existing topological sort (Kahn's algorithm) to reuse
- `src/lib/canvas-layout.ts:75` — `findPackedPosition()` to replace with DAG layout
- `src/components/canvas/canvas-adapter.ts:10-13` — handle type sets to simplify
- `src/lib/board-types.ts:83-89` — `CardConnection` type
- `src/lib/sse-types.ts` — typed SSE pattern to follow for canvas events
- `src/lib/canvas-store.ts` — DEPRECATED, to delete
- `src/lib/canvas-types.ts` — tldraw-era types, to delete

### Learnings

- Shapes/cards cannot access React context — use canvas-events pub/sub or module-level stores (see memory: canvas-redesign.md)
- Three-zone pointer events model for card interactivity (see `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`)
- Always use CSS variable tokens, never hardcoded hex (see `docs/solutions/best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md`)
- BigInt from DuckDB must be sanitized before JSON.stringify (existing `safeStringify` in canvas-query route)
- NDJSON: Gemini may wrap output in markdown fences — always strip them
