# Canvas Redesign — Product Requirements Document

**Date:** 2026-03-10
**Status:** Design approved, pending implementation plan
**Author:** Vimarsh + Claude
**Branch:** `unified-chat`

---

## Problem Statement

The canvas today is a pinboard. You find a chart in chat, click "Pin to Canvas," and it sits on an infinite tldraw surface as a frozen snapshot. That's the entire interaction model.

This is too limited in three fundamental ways:

1. **Canvas is an output bucket, not a thinking surface.** The only way to get content onto the canvas is pinning from chat. You can't query, compose, or build anything on the canvas itself.

2. **Everything is dead.** Pinned charts are frozen at pin time. The SQL that generated them exists in the store but the "Refresh" button doesn't actually re-execute it. There's no way to know if the data changed.

3. **No composition.** Cards sit next to each other with no expressed relationship. You can't wire a SQL result into a chart, compare two cards, or build a workflow. The canvas has no understanding of how its contents relate.

**Goal:** Transform the canvas from a static pinboard into a **living analytical workspace** — a multi-board surface where you can monitor metrics (morning dashboard), investigate problems (detective board), build and share narratives (presentation), and compose visual dataflow workflows.

---

## Target Users and Moments

The canvas serves three distinct moments for the same user:

| Moment | Behavior | What they need |
|--------|----------|----------------|
| **Morning check-in** | Open canvas, glance at numbers, spot anomalies | Auto-refreshed data, delta badges, compact layout |
| **Investigation** | Pull in charts, tables, SQL, notes — build a case | Rapid addition, prompt-to-card, wiring, annotations |
| **Presentation** | Arrange findings into a story, share with team | Frames, clean layout, narrative structure |

---

## Core Concepts

### Boards

Multiple boards accessible from the sidebar. Each board is an independent infinite canvas.

- Sidebar shows a "Boards" section listing all boards by name
- "+" to create a new board — choose from templates or start blank
- Each board has: name, optional description, created timestamp
- Boards are scoped to a dataset (like conversations)
- Default board auto-created on first visit via smart inference

**Board templates:**

| Template | What it creates |
|----------|----------------|
| **Dashboard** | Pulls in existing metrics as live cards, adds a date-range parameter card, arranges in a grid. Parameter wired to all metric cards. |
| **Investigation** | Structured investigation scaffold (see Investigation Boards below) |
| **Presentation** | Narrative-ready layout (see Presentation Boards below) |
| **Blank** | Empty canvas |

**Smart first-board inference:**

On first visit, the system checks existing data — metrics, segments, recent conversations — and auto-populates a Dashboard board with real metric cards, wired to a date-range parameter. The user refines from there: delete irrelevant cards, add new ones, rearrange.

### Cards

Everything on the canvas is a card. Every card has: title, comment icon, drag handle, connection ports (hover-reveal on top/bottom edges), resize handles, type badge.

| Card Type | What It Shows | Typical Source |
|-----------|---------------|----------------|
| **Chart** | Bar, line, area, pie via Recharts | Pin from chat, prompt-to-card, workflow output |
| **Table** | Compact data grid with sortable columns | Pin from chat, SQL card output, prompt-to-card |
| **Metric** | Big number + delta badge + optional sparkline | Drag from sidebar, pin from metric page, workflow |
| **SQL** | Editable SQL block with run button, row count + timing | Manual add, prompt-to-card, workflow node |
| **Text** | Markdown block — summaries, analysis, narrative | LLM output, pin from chat, manual add |
| **Sticky note** | Small freeform text, colored background. Subtle "AI" badge when LLM-generated. | Manual add, LLM-generated (footnotes, caveats, observations) |
| **Follow-up** | Action chip — "Create segment", "Run as playbook" | Pin from chat response actions |
| **Research report** | Full markdown report with collapsible sections | Pin from deep research |
| **Parameter** | Input control — date range, dropdown, text, number | Manual add for workflow parameterization |
| **Segment** | Segment name + user count + SQL preview | Drag from sidebar, pin from segment page |

### Frames

Frames group cards within a board. A frame is a labeled bounding rectangle.

- Select multiple cards → "Group into frame" → LLM reads card contents and pre-fills a suggested title + one-line description. Both editable.
- Example: group 3 revenue cards → title auto-fills "Revenue Decline Analysis — Mar 3-10", description: "Week-over-week revenue drop across US and APAC regions"
- Frame has: title, description, collapse/expand toggle
- Moving a frame moves all cards inside it
- Frames are visual organizers — they don't affect data flow or execution
- Use cases: dashboard sections ("Revenue", "Users"), investigation grouping ("Evidence", "Hypotheses"), presentation slides

### LLM-Generated Annotations

The LLM is an active participant on the board, not just a responder. When interacting with a board — responding to card comments, running prompt-to-card queries, participating in investigations — the LLM can create sticky notes on its own initiative.

**What the LLM annotates:**
- Data caveats: "Note: this data only covers US regions, APAC excluded from this query"
- Statistical warnings: "Sample size is 47 users — too small for statistical significance"
- Cross-card observations: "This contradicts the revenue chart in the top-left — worth investigating"
- Methodology notes: "Revenue calculated as gross, not net of refunds"
- Temporal context: "This period includes Black Friday — may not be representative"

**Visual distinction:** LLM-generated sticky notes have a subtle "AI" badge (small icon or label) so the user always knows what's human vs machine-generated. Same card type, different authorship indicator.

**Behavior:** LLM annotations are suggestions, not interruptions. They appear near the card they relate to, can be dismissed, moved, or edited by the user. The LLM doesn't flood the board — it annotates when there's something genuinely worth flagging.

---

## Investigation Boards

An investigation board is for figuring out *why* something happened. It's a detective's wall — pull in evidence, form hypotheses, test them, reach a conclusion. The template provides structure without rigidity.

### Scaffold

When you create an Investigation board (from template, or via prompt-to-card like "investigate why churn spiked"), the system generates:

1. **Trigger card** — The anomaly or observation that kicked this off. A metric card or chart showing the problem. Example: "Churn rate: 18.4% (+6.2% WoW)" with a trend chart showing the spike.

2. **Hypotheses frame** — A frame where possible explanations live as sticky notes. The LLM pre-generates 2-3 initial hypotheses based on the trigger and available data. Example stickies: "Payment gateway issues?", "Bad deploy on Mar 5?", "Seasonal pattern — post-holiday dropoff?"

3. **Evidence frame** — Empty frame where charts, tables, SQL results land as you test each hypothesis. Cards in this frame can be tagged with which hypothesis they support or refute.

4. **Conclusion card** — An empty text card where findings get synthesized. The LLM can auto-draft this based on evidence collected.

### LLM as Research Assistant

The LLM actively participates in investigations, not just responds:

- **Hypothesis management.** When you add evidence cards, the LLM evaluates them against hypotheses. "Payment gateway data shows 99.9% uptime → marking 'gateway issues' as unlikely." Updates hypothesis sticky notes with status: testing, supported, refuted, inconclusive.

- **Evidence suggestions.** After you test one hypothesis, the LLM suggests what to look at next. "You've ruled out payment issues. Want to check if the deploy on Mar 5 correlates? Here's a query." Appears as a prompt-to-card suggestion near the evidence frame.

- **Gap detection.** The LLM notices what hasn't been investigated. "3 hypotheses, but you've only tested 1. The seasonal pattern hypothesis has no evidence yet."

- **Auto-annotations.** LLM drops sticky notes as footnotes — caveats about data quality, sample sizes, confounding variables. These appear near relevant evidence cards with the AI badge.

### Investigation Lifecycle

```
Trigger (anomaly detected)
  → Hypotheses generated (LLM + human)
  → Evidence gathered (prompt-to-card, SQL, chat pins)
  → Hypotheses updated (LLM evaluates evidence)
  → Conclusion drafted (LLM synthesizes, human edits)
  → Optionally: convert to Presentation board
```

The board evolves over time. It might start as a 10-minute check ("is this real?") or become a multi-day investigation that you return to.

---

## Presentation Boards

A presentation board arranges findings into a narrative for sharing. It takes the *good parts* of an investigation (or any analysis) and structures them into a story.

### Two Creation Paths

**Manual curation.** Create a new Presentation board. Drag or copy cards from other boards. Arrange them in narrative order. Add text cards for connecting narrative. Use frames as sections/slides.

**LLM-assisted conversion.** On any board (especially Investigation boards), click "Create presentation from this board." The LLM:

1. **Reads all cards** on the source board — their types, content, connections, comments, annotations
2. **Filters out noise** — dead-end hypotheses, abandoned SQL attempts, scratch notes, refuted evidence
3. **Selects key artifacts** — the cards that tell the story (trigger, key evidence, conclusion)
4. **Orders them narratively** — not chronologically (how you found them) but logically (what the audience needs to understand)
5. **Generates connecting text** — text cards between evidence cards that explain the narrative flow: "After ruling out payment issues, we examined the Mar 5 deploy..."
6. **Creates section frames** — groups cards into titled frames: "The Problem", "What We Found", "Root Cause", "Recommended Actions"
7. **Produces the board** — new Presentation board with everything laid out. User refines from there.

### Presentation Structure

A typical presentation board has:

| Section (Frame) | Contents |
|-----------------|----------|
| **Context** | Trigger metric card, one-line text explaining what happened |
| **Analysis** | 2-3 key evidence cards (charts, tables) with connecting text |
| **Root Cause** | Text card with LLM-synthesized explanation, supporting data card |
| **Impact** | Metric cards showing scope — users affected, revenue at risk |
| **Recommendations** | Follow-up action cards, or text card with next steps |

### Presentation Features

- **Frame ordering.** Frames on a presentation board have an explicit order (top-to-bottom or left-to-right). This order defines the narrative sequence.
- **Export as image.** Per-frame or whole-board export to PNG. Low-cost first step toward sharing.
- **Clean mode.** Toggle that hides connection arrows, port dots, comment icons, AI badges — just the cards and frames. For screenshot-ready layouts.

---

## Five Entry Points

Content gets onto a board in five ways:

### 1. Pin from chat (enhanced)

Today: only charts can be pinned. After: **every structured output** in chat gets a pin icon.

- Charts → Chart card
- Query result tables → Table card
- Metric context cards → Metric card
- SQL blocks → SQL card
- Text analysis / summaries → Text card
- Follow-up action chips → Follow-up card
- Research report sections → Report card

Pin flow: click pin icon → pick target board (default: last active board) → card appears with auto-packed position → toast with "View on board" link.

### 2. Prompt-to-card

Double-click empty space on a board → inline text input appears at that position → type a natural language question → system runs the analytics pipeline (same backend as chat: classify → analyze/chat) → result materializes as one or more cards right where you clicked.

Example: double-click → "revenue by region last month" → SQL card + chart card appear, wired together, with the SQL's output feeding the chart.

Execution is eager/live — results appear as they stream.

### 3. Drag from sidebar and pages

Entities in the sidebar (metrics, segments, playbooks) are draggable onto the board. Drop → card created with live data.

Entity detail pages get a "Send to board" button that creates a card on the active board with the entity's full context (metric formula + value + trend, segment SQL + count, etc.).

### 4. Manual add

"+" button on the board toolbar opens a card type picker:

- Sticky note
- SQL block (empty, you write the query)
- Text block (empty markdown)
- Parameter (configure input type: date range, dropdown, text, number)
- Empty chart (configure after adding data source)

Place the card, then fill it in. SQL cards have a run button. Parameter cards have configuration UI.

### 5. System suggestions

When a card is added, the system can suggest related items:

- Pin a revenue chart → toast: "Add the Revenue metric and High-Value Users segment?" → accept → cards appear nearby
- Add a segment card → suggestion: "Want to see this segment's top metrics?"
- Wire a SQL → Chart → suggestion: "Add an LLM summary card?"

Suggestions are non-intrusive — a small toast or inline prompt, never auto-added.

---

## Liveness

### Data Freshness

Every SQL-backed card stores its query. Cards auto-refresh on a configurable cadence.

- Per-card cadence: hourly, daily, or manual-only (default: manual)
- Board-level cadence override: set all cards on a board to refresh daily
- Refresh actually re-executes the SQL against DuckDB and updates card data
- Stale indicator: subtle visual treatment (faded border, timestamp) when data is older than the cadence
- Delta badge on refresh: "Was $119k → now $124k (+4.2%)"
- Manual refresh button on each card for on-demand

### Reactive Sync

When upstream definitions change, cards reflect the change on next refresh:

- Metric definition changes on metrics page → metric cards update
- Segment SQL modified → segment cards show new user count
- Uses existing catalog invalidation pub/sub (`invalidateCatalog` / `subscribeCatalog`)

### Board-Level Awareness

The system periodically scans board contents and surfaces contextual observations:

- Badge annotations on individual cards: "↓12% since last visit"
- Cross-card inferences: "Revenue dropped the same week this segment shrank — might be related"
- These appear as lightweight badges or callout ribbons on cards, not as full new cards
- User can pin an insight badge as its own card if they want to preserve it

### Compare To

A single date picker at the board level. Pick a comparison date → every SQL-backed card shows dual state:

- Current value prominently displayed
- Comparison value in smaller text
- Delta badge (absolute + percentage change)
- One control, whole board responds
- Cards without SQL or without historical data are unaffected

---

## Card Conversations

Every card has a message/comment icon, following the same pattern as playbook cell annotations.

### Interaction Model

Click the comment icon on any card → a comment thread opens, anchored to that card.

**What a user can type:**
- Questions: "Why did this drop?" → system runs analysis
- Instructions: "Re-run for last 30 days" → system modifies SQL, re-executes
- Notes: "Check with marketing team" → stored as human annotation
- Requests: "Compare this with APAC" → may produce new artifacts

### Where Responses Go (Hybrid)

Default behavior, subject to iteration based on usage:

- **Text responses** (explanations, notes, corrections) → reply in the card's comment thread. Thread is expandable, stays attached to the card.
- **New artifacts** (chart, table, SQL result, new analysis) → spawn as a new card connected with an arrow to the source card. The comment thread shows "→ Created [new card title]" as a link.

### Sidebar Chat Integration

The sidebar chat (Cmd+J) shows a unified chronological log of all card conversations on the active board. Each message shows which card it's attached to (clickable — zooms to that card on the board).

Board-level questions are also possible: type in the sidebar chat without clicking a card first → the system sees the full board context → can answer questions like "summarize everything on this board" or "what changed since last week?"

---

## Workflow Builder

Cards can be wired together to create live dataflow pipelines.

### Connection Mechanics

- Each card has connection ports: small dots on top (input) and bottom (output) edges
- Ports are hidden by default, revealed on hover (clean cards, spatial when needed)
- Drag from output port → drop on another card's input port → arrow appears
- Arrows are visible, labeled optionally, and can be deleted by selecting + backspace
- Uses ReactFlow edges (same library as playbook canvas)

### Connection Semantics

| From → To | What Happens |
|-----------|-------------|
| **SQL → Chart** | Chart renders the SQL's result set |
| **SQL → Table** | Table displays the SQL's result set |
| **SQL → SQL** | Second SQL can reference first's output (CTE chaining) |
| **SQL → Text (LLM)** | LLM receives result set as context, generates analysis |
| **Chart → Text (LLM)** | LLM receives chart data + title, generates summary |
| **Multiple → Text (LLM)** | Fan-in: LLM synthesizes across all connected inputs |
| **Parameter → SQL** | Parameter value substituted into `{{placeholder}}` in SQL |
| **Parameter → Multiple** | One parameter feeds many downstream cards (e.g., date range for whole board) |
| **Metric → Text (LLM)** | LLM receives metric value, trend, formula as context |
| **Segment → SQL** | Segment's SQL injected as a subquery / filter |

### Execution Model (Hybrid)

**While building (eager/live):**
- Connect SQL → Chart → chart renders immediately
- Change a parameter value → all downstream cards re-execute
- Edit SQL in a SQL card → dependents re-run on execute
- The canvas is reactive like a spreadsheet during active work

**Scheduling (deliberate):**
- "Schedule this workflow" is a separate, intentional action
- Pick a cadence: hourly, daily, weekly
- System converts the wired card subgraph into a scheduled job
- Results update the cards on the board at each run

**Human-in-the-loop:**
- A workflow can have intentional gaps where a human inspects intermediate output
- SQL runs → chart renders → user reviews → leaves a comment → that comment + data feeds into the next LLM card
- The user is a node in the DAG — the workflow doesn't have to be fully automated
- This is what distinguishes canvas workflows from playbooks: playbooks run start-to-finish, canvas workflows are collaborative with the human

### Collective Operations

Select multiple cards → right-click or toolbar action:

| Action | Result |
|--------|--------|
| **Summarize these** | New LLM text card spawns, wired to all selected cards as inputs |
| **Compare these** | Comparison card spawns with delta analysis between selected |
| **Create playbook** | Exports wired cards as a PlaybookV2 (reusable, schedulable) |
| **Group into frame** | Wraps selection in a named frame |
| **Collectively edit** | Batch operations — change refresh cadence, move to another board, delete |

---

## Relationship to Existing Systems

### Canvas → Playbooks

Canvas workflows and playbooks are related but serve different purposes:

| | Playbooks | Canvas Workflows |
|-|-----------|-----------------|
| **Purpose** | Reusable, automated analytics jobs | Interactive, exploratory composition |
| **Execution** | Run start-to-finish | Human-in-the-loop, iterative |
| **Creation** | LLM generates from prompt | User builds visually on canvas |
| **Storage** | PlaybookV2 in playbook store | Board state in canvas store |

**Bridge:** A canvas workflow can be exported as a playbook ("Create playbook from these"). A playbook's results can be pinned to a board. They complement each other — canvas for building, playbooks for automating.

### Canvas → Chat

Chat and canvas are complementary surfaces:

- **Chat** is temporal — a conversation that unfolds in sequence
- **Canvas** is spatial — artifacts arranged in 2D for comparison and composition

**Chat → Canvas:** Pin any chat output to a board. Every structured element gets a pin icon.

**Canvas → Chat:** Card conversations flow into the sidebar chat log. Board context is available to the LLM for board-level questions.

**Prompt-to-card** bridges both: it's a chat-like interaction (type a question, get an answer) but the result is spatial (card on the board) rather than temporal (message in a thread).

### Canvas → Pages

Entity detail pages (metrics, segments, playbooks) get "Send to board" actions. The canvas doesn't replace these pages — it aggregates their content into a unified workspace.

---

## Non-Goals (Explicit)

- **Real-time collaboration / multiplayer** — Single-user only for now. No cursors, no sharing permissions.
- **Dashboard templating marketplace** — Templates are built-in, not user-contributed.
- **Embedding / iframe export** — Boards are not embeddable in external tools.
- **Full spreadsheet features** — Table cards are read-only displays, not editable grids.
- **Version control for boards** — No undo history, branching, or board snapshots beyond the Compare To feature.

---

## Data Model (High Level)

```
Board
  id: string
  name: string
  description?: string
  datasetId: string
  template?: "dashboard" | "investigation" | "presentation" | "blank"
  sourceInvestigationBoardId?: string  # if created via "Create presentation from this board"
  createdAt: string (ISO)
  updatedAt: string (ISO)

BoardCard (extends CanvasItem)
  id: string
  boardId: string
  type: "chart" | "table" | "metric" | "sql" | "text" | "sticky"
       | "follow-up" | "report" | "parameter" | "segment"
  title: string
  position: { x, y }
  size: { width, height }
  author: "user" | "system"  # distinguishes human vs LLM-created cards

  # Investigation-specific
  hypothesisStatus?: "testing" | "supported" | "refuted" | "inconclusive"
  linkedHypothesisId?: string  # evidence card → hypothesis it tests

  # Type-specific data
  sql?: string
  chartSpec?: ChartSpec
  data?: Record<string, unknown>[]
  markdownContent?: string
  parameterConfig?: { inputType, defaultValue, options? }
  metricId?: string
  segmentId?: string

  # Liveness
  refreshCadence: "manual" | "hourly" | "daily"
  lastRefreshed?: string (ISO)
  lastData?: Record<string, unknown>[]  # previous refresh result for delta

  # Provenance
  sourceConversationId?: string
  sourceMessageIndex?: number

  # Comments
  comments: CardComment[]

CardComment
  id: string
  cardId: string
  author: "user" | "system"
  content: string
  timestamp: string (ISO)
  spawnedCardId?: string  # if this comment created a new card

CardConnection
  id: string
  boardId: string
  fromCardId: string
  toCardId: string
  label?: string

Frame
  id: string
  boardId: string
  title: string                # LLM-suggested on creation, editable
  description?: string         # LLM-suggested on creation, editable
  position: { x, y }
  size: { width, height }
  collapsed: boolean
  order?: number               # explicit ordering for presentation boards
```

---

## Storage

Boards and their contents persist in localStorage (same pattern as current canvas store):

- `baby-sentinel-boards` → `Map<boardId, Board>`
- `baby-sentinel-board-cards-{boardId}` → `Map<cardId, BoardCard>`
- `baby-sentinel-board-connections-{boardId}` → `CardConnection[]`
- `baby-sentinel-board-frames-{boardId}` → `Frame[]`
- Version-controlled with `STORAGE_VERSION` pattern (existing convention)
- Debounced persistence (300ms, existing pattern)

tldraw document state (shapes, camera) stored separately per board.

---

## Success Criteria

1. A user can create a "Dashboard" board and have it populated with their real metrics, auto-refreshing daily, within 30 seconds of first visit.
2. A user can double-click the canvas, type a question, and see a chart materialize in under 5 seconds.
3. A user can wire SQL → Chart → LLM Summary and see the whole pipeline execute live.
4. A user can select 3 cards and get a synthesized comparison with one click.
5. A user can comment on a card, get an LLM response, and see a new connected card spawn — without ever leaving the board.
6. A user can start an investigation with "investigate why churn spiked" and get a scaffolded board with hypotheses in under 10 seconds.
7. The LLM updates hypothesis status as evidence is added — the user sees "refuted" / "supported" badges evolve without manual tagging.
8. A user can convert an investigation board to a presentation board with one click and get a clean narrative layout with connecting text.
9. Grouping cards into a frame auto-suggests a relevant title and description — the user edits or accepts.
10. LLM-generated sticky notes (caveats, observations) appear near relevant cards with a visible AI badge, distinguishable from human notes.
11. The canvas feels like it's thinking with you, not just storing things for you.

---

## Open Questions

1. **Workflow scheduling backend.** Canvas workflows need a scheduler for "run every morning." The current system has no cron/scheduler. Options: client-side (unreliable), server-side job queue, or convert to Scout (existing scheduled entity).
2. **Board sharing.** Not in scope now, but the frame/board structure sets up for it. Export-as-image is a low-cost first step.
3. **Card conversation UX.** The hybrid model (text → thread, artifacts → new card) needs real usage to validate. May need iteration.
4. **Performance at scale.** A board with 50+ cards, each with SQL and refresh cadence, could stress DuckDB. May need query batching or priority queuing.
5. **tldraw document sync.** Current canvas uses tldraw shapes synced to canvas store items. Multi-board means multiple tldraw documents. Need to verify tldraw supports document switching or requires editor re-mount.
