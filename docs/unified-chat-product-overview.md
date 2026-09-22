# Baby Sentinel — Unified Chat: Product Overview

## What Is It

Baby Sentinel is a **chat-first analytics tool** where users ask natural-language questions about their data and get SQL-generated insights via Gemini LLM + DuckDB. The `unified-chat` branch transforms it from a single-page chatbot into a **multi-page AI workspace** where chat persists everywhere, understands what you're looking at, and lets you take action directly from conversation.

---

## Core Capabilities

### 1. Persistent Chat Across Every Page

Chat isn't confined to the home page anymore. A **right-side panel chat** follows you as you navigate — segments, metrics, playbooks, knowledge, data catalog, scouts. The conversation persists as you move between pages.

- **Home page**: Full-width chat experience with suggested prompts
- **All other pages**: Compact panel chat (Cmd+J to toggle) with the same conversation thread
- Panel auto-opens when you navigate away from home with an active conversation

### 2. Page-Aware Context Injection

The LLM knows what you're looking at. When you're on the **Segments list**, it sees all your segments. When you're on a **specific metric detail page**, it sees that metric's formula, current value, trend, and related metrics.

This happens automatically — no manual context selection needed:

| Page | What the LLM Sees |
|------|-------------------|
| `/metrics` | All metrics with values, change%, formulas, SQL |
| `/segments/[id]` | That segment's SQL, user count, behavioral traits |
| `/playbooks/[id]` | Playbook structure, cell labels, SQL steps |
| `/data-catalog` | All tables with columns, types, row counts |
| Any list page | Full catalog of that entity type |

Context is injected **twice** in prompts:
1. **SQL Generation**: Compact SQL-focused context (table names, column names, formulas)
2. **Response Synthesis**: Business context with current state, trends, relationships

### 3. @ Context Picker

Type `@` in the chat input to open a **two-level hierarchical picker**:

**Level 1 — Categories**: Metrics, Segments, Playbooks, Scouts, Knowledge, Tables, Chats

**Level 2 — Entities**: Individual items within a category (e.g., "High-Value Users" segment with "12.4k users")

Selected entities appear as **chips** on the message and their full data (SQL, description, values) is injected into the LLM prompt. Keyboard navigable (arrows, Enter/Tab, Escape).

### 4. Chat-Native Segment Creation

Users can create segments directly from conversation:

1. Say **"Create a segment for high-revenue users"**
2. Classifier detects this as an action (not a query)
3. SQL is auto-generated from the description
4. An **inline confirm card** appears in chat with:
   - Editable name
   - Collapsible SQL preview
   - User count (with warnings for 0 or <10)
   - Confirm / Refine / Cancel buttons
5. "Refine" lets you retype the description to regenerate SQL
6. "Confirm" creates the segment, refreshes sidebar, shows toast

### 5. Intersection Cards

Above the chat input on every page, contextual cards surface **connections between your conversations and the current page**:

- **Pending Actions**: Unacted follow-up suggestions relevant to this page (e.g., "Create segment" action on the segments page)
- **Provenance**: Entities you created from conversations — "This playbook was built from your research on churn"
- **Thematic Relevance**: Past conversations related to what you're viewing — tagged automatically from agent IDs and actions

Max 5 cards, prioritized: pending > provenance > thematic.

### 6. Two Analysis Modes

- **Deep Research** (default): 6 specialized subagents run in parallel, each generating 2-3 SQL queries. Includes per-agent summaries, a Critique Agent for validation, and a full research report
- **Quick Answer**: Single SQL query, concise response

Toggle via the switch in the chat input. Detail pages auto-force Quick mode since context is already focused.

### 7. Intelligent Query Classification

Every message is classified into one of three modes:

| Mode | Trigger | Result |
|------|---------|--------|
| **Analytics** | "How many users churned last week?" | SQL generation + deep/quick research |
| **Direct** | "What does AOV mean?" | Plain LLM response, no SQL |
| **Action** | "Create a segment for power users" | Segment creation flow |

If a specific metric is detected (e.g., "tell me about revenue"), a **Metric Context Card** is inserted showing current value, trend chart, and change% before the analysis begins.

### 8. Follow-Up Actions

After every analytics response, the system generates contextual next steps:

- **Follow-up question** → Pre-fills chat input
- **Create segment** → Opens creation modal with pre-filled SQL
- **Save as playbook** → Generates a reusable multi-step analysis
- **Save to knowledge** → Stores insight for future context
- **View in store** → Navigates with context

Actions are tracked as "pending" and surface in intersection cards until acted on or dismissed.

### 9. Dynamic Suggested Prompts

Suggested prompts are **never hardcoded**. They're derived from:
1. Past conversation queries tagged with the current page's domain
2. Dataset-provided prompt templates as fallback

Click a suggestion to populate the input (not auto-send), so you can edit before sending.

### 10. Multi-Dataset Support

Switch between datasets (ecommerce, Quick Help, etc.) from the sidebar. Everything scopes correctly:
- Conversations filtered by dataset
- Segments isolated per dataset
- Mock/demo segments only appear for the ecommerce dataset
- Schema context, agent configurations, and metrics all dataset-specific

---

## User Flows

**Exploring data from home**: Type a question → get deep research with 6 parallel agents → view research report → save as playbook or create segment from follow-up actions.

**Investigating a specific metric**: Navigate to `/metrics` → click a metric → panel chat opens with that metric's full context → ask "why did this drop last week?" → LLM answers with the metric's formula, trend data, and related metrics already in context.

**Creating segments conversationally**: From any page, type "create a segment for users who purchased 3+ times" → confirm card appears inline → review SQL and user count → confirm or refine → segment created and visible in sidebar.

**Cross-referencing past work**: Navigate to `/segments` → see intersection card: "Your churn analysis conversation identified 3 segments" → click to revisit that conversation → act on remaining suggestions.

**Context-rich questions with @ mentions**: Type "Compare @Revenue Growth with @Cart Abandoners" → both entities' full data injected → LLM analyzes the relationship between the metric and segment.

---

## Technical Architecture

### Provider Stack

```
DatasetProvider
  → SidebarProvider
    → EntityCatalogProvider
      → ChatStateProvider
        → ChatPanelProvider
```

### Key Patterns

- **API convention**: All calls through `apiFetch()` from `src/lib/api-client.ts` (auto-injects dataset ID, model, headers)
- **SSE events**: Typed discriminated union (`AnalyzeSSEEvent`) with `parseAnalyzeEvent()` for safe NDJSON parsing
- **Conversation storage**: localStorage with debounced saves, auto-tagging at save time via `deriveConversationTags()`
- **Entity catalog**: Rebuilt on store mutations via pub/sub catalog invalidation (`subscribeCatalog`/`invalidateCatalog`)
- **Context injection**: Dual-injection into SQL generation prompts (compact) and synthesis prompts (rich business context)

### Entity Types

Metrics, Segments, Playbooks, Knowledge Entries, Tables, Scouts — all registered in the entity catalog, available in the @ picker, and injectable as LLM context.

### ChatMessage Variants

```
gathering | streaming | report-cta | connector-required |
playbook-preview | save-as-playbook | save-to-knowledge |
metric-context | segment-confirm
```

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/classify` | Query classification (action/analytics/direct) |
| `POST /api/analyze` | Analytics query (SSE stream) |
| `POST /api/chat` | Direct LLM response |
| `POST /api/segments/generate-sql` | Generate segment SQL from description |
| `POST /api/segments` | CRUD for segments |
| `GET /api/metrics` | Metrics with computed values (5-min cache) |
| `POST /api/playbook/create` | Generate playbook (NDJSON stream) |
| `POST /api/playbook/run` | Execute playbook (SSE stream) |
| `POST /api/recommend` | Generate follow-up actions |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+J / Ctrl+J | Toggle chat panel |
| @ | Open context picker |
| Arrow keys | Navigate picker |
| Enter/Tab | Select picker item |
| Escape | Close picker |

---

## File Reference

| Feature | Location |
|---------|----------|
| Chat Orchestrator | `src/components/chat/chat-state-provider.tsx` |
| @ Picker | `src/components/chat/context-picker.tsx` |
| Right Panel | `src/components/chat/chat-panel.tsx` |
| Panel Provider | `src/components/chat/chat-panel-provider.tsx` |
| Entity Catalog | `src/components/chat/entity-catalog-provider.tsx` |
| Intersection Cards | `src/lib/intersection-cards.ts` |
| Suggested Actions | `src/lib/suggested-actions.ts` |
| Conversation Tagger | `src/lib/conversation-tagger.ts` |
| Page Context | `src/lib/page-context.ts` |
| Entity Context Builder | `src/lib/entity-context.ts` |
| Segment Creation Hook | `src/hooks/use-segment-creation.ts` |
| Query Classification | `src/hooks/use-classify.ts` |
| Analytics Hook | `src/hooks/use-analytics.ts` |
| Action Handlers | `src/hooks/use-action-handlers.ts` |
| SSE Types | `src/lib/sse-types.ts` |
| API Client | `src/lib/api-client.ts` |
| Entity Registry | `src/lib/entity-registry.ts` |
| Classify Prompt | `src/lib/prompts/classify.ts` |
| Layout Shell | `src/components/layout-shell.tsx` |
| Conversation Store | `src/lib/conversation-store.ts` |
