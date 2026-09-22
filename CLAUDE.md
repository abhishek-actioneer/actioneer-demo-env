# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Baby Sentinel is the pre-sales demo for Actioneer (Sentinel's growth engine for apps). Potential clients sign up via Clerk, go through an onboarding wizard, upload their own CSV or pick a sample dataset, and explore analytics. Users ask natural-language questions about a dataset and the system generates SQL, executes it against DuckDB, and streams back analysis via Gemini LLM. Additionally, users can also trigger actions directly after understanding the data. This shortens the time from insight to action for apps.

## Task Tracking

**ALWAYS use `bd` (beads) for task tracking — never the TodoWrite/Task tools.**

- `bd list` — see all open beads
- `bd init` — initialize beads in a new repo (already done here)
- `bd close <id>` — close a resolved bead
- `bd create` — create a new bead
- Check `bd list` at the start of every session to understand open work.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start Next.js dev server (localhost:3000)
pnpm build                # Production build
pnpm lint                 # ESLint (next/core-web-vitals + typescript)
npx tsx scripts/setup-data.ts  # One-time: create DuckDB + summary tables from parquet files
```

## Required Environment

- `GEMINI_API_KEY` — Google Gemini API key (used by all API routes)
- `GEMINI_MODEL` — Optional model override (defaults to `gemini-3-flash-preview`)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk publishable key (frontend)
- `CLERK_SECRET_KEY` — Clerk secret key (backend)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth` — Custom sign-in route
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth` — Custom sign-up route
- Parquet data files must exist at `data/parquet/*.parquet` before running setup or the app

## Architecture

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · shadcn/ui (new-york style) · DuckDB (node-api) · Google Gemini (`@google/genai`) · Clerk Auth

**Multi-page app** with persistent sidebar chat. Main chat at `/`, plus `/segments`, `/segments/[id]`, `/metrics`, `/metrics/[id]`, `/playbooks/[id]`, `/forecasting`, `/catalog`. All pages share the same chat state via providers.

### Authentication (Clerk)

All routes are protected by `clerkMiddleware` in `src/middleware.ts`. Public routes: `/auth(.*)`, `/api/health`.

**API routes that handle user-scoped data** must extract `userId` from Clerk:
```typescript
import { auth } from "@clerk/nextjs/server";
const { userId } = await auth();
if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
```

**Repos** (`segment-repo`, `board-repo`, `playbook-repo`) take `userId` as their first parameter. Never hardcode user IDs.

**Datasets** have an `ownerId` field. Uploaded datasets are tagged with the uploader's Clerk userId. Static sample datasets have no `ownerId` (visible based on Clerk `publicMetadata.selectedSampleDatasets`). Use `getAllDatasetsForUser(userId, selectedSampleIds?)` to filter.

**Onboarding completion** writes to Clerk `publicMetadata` via `POST /api/onboarding/complete`: `{ onboardingComplete, selectedSampleDatasets, orgName }`.

### Data Flow (analytics query)

1. User sends message → client calls `POST /api/classify` (Gemini classifies as `analytics` or `direct`)
2. **Direct path:** streams plain LLM response via `POST /api/chat`
3. **Analytics path:** calls `POST /api/analyze` which returns a newline-delimited JSON event stream:
   - `phase` → UI phase changes (generating_sql, executing, synthesizing)
   - `sql` → per-subagent SQL queries generated
   - `query_result` → individual query execution results
   - `summary` → per-agent Gemini-generated analysis summaries (deep mode only)
   - `result` → agent completion status
   - `text` → streamed final response tokens
   - `report` → full research report markdown (deep mode only)
   - `done` / `error` → terminal events

### Two Analysis Modes

- **Quick Answer** (default): single SQL query → concise response
- **Deep Research**: 6 specialized subagents generate 2-3 SQL queries each (17 total), execute in parallel, produce per-agent summaries, run a Critique Agent, then synthesize a final response + research report

### Key Modules

- `src/lib/sql-generator.ts` — Text-to-SQL via Gemini. Generates single or multi-agent query sets. Has OOM-aware retry logic (detects "Out of Memory" errors and generates memory-efficient SQL rewrites).
- `src/lib/sql-executor.ts` — Executes SQL against DuckDB with validation (SELECT-only, blocked DDL/DML keywords). Caps results at 500 rows. Surfaces user-friendly OOM error messages via `friendlyError()`.
- `src/lib/schema.ts` — Schema context injected into Gemini prompts. `getSystemContext(datasetId)` returns the LLM persona (required parameter, no default). `ECOMMERCE_SYSTEM_CONTEXT` was removed — always call `getSystemContext(datasetId)` directly.
- `src/lib/db.ts` — DuckDB singleton. Creates a view over `data/parquet/*.parquet`. Default memory limit: 4GB, threads: 4 (local dev). Railway overrides via `DUCKDB_MEMORY_LIMIT` and `DUCKDB_THREADS` env vars.
- `src/lib/markdown.tsx` — Custom lightweight markdown renderer (tables, headers, bold, code, blockquotes, lists). No external markdown library.
- `src/lib/catalog-invalidation.ts` — Lightweight pub/sub for entity catalog updates. Any store mutation calls `invalidateCatalog()` here; `EntityCatalogProvider` subscribes and rebuilds the @ picker.
- `src/lib/dataset-switch.ts` — Lightweight pub/sub for dataset switch events. `notifyDatasetSwitch()` fires before dataset state changes; `ChatStateProvider` subscribes to abort streams, reset UI.
- `src/lib/entity-registry.ts` — `buildEntityCatalog(datasetId, segments, currency?)` constructs the dataset-scoped entity list for @ mentions.
- `src/lib/api-client.ts` — `apiFetch()` wrapper. Auto-injects dataset/model headers. Supports explicit `datasetId` override option for race-condition safety. Initializes `_datasetId=""` and warns if called before `setActiveDatasetId()`.
- `src/lib/sql-highlight.tsx` — Canonical source for `SQL_KEYWORDS`, `SqlHighlighted`, `highlightSqlInline()`, `AGENT_ICONS`, and `getAgentIcon()`. All SQL highlighting and agent icon lookups import from here.
- `src/lib/subagent-config.ts` — Single source of truth for `SUBAGENT_TASKS` (checklists, narratives) and `SUBAGENT_TASK_PROMPTS`. Imported by research-timeline and task-panel.
- `src/lib/datasets/constants.ts` — Client-safe `DEFAULT_DATASET` constant. Use this import in client components (not `@/lib/datasets` which pulls in Node.js `fs` via dynamic-registry).

### Frontend Components

**Chat & Analysis**
- `src/components/chat/` — Chat thread, input, task panel (split into 3 files: `task-panel.tsx` router + `main-agent-panel.tsx` + `subagent-detail-panel.tsx`), research report, sources panel. `ChatThread` consumes `useChatState()` directly (no prop drilling) and is wrapped in `React.memo`.
- `src/hooks/use-analytics.ts` — Drives the full analytics query flow: classify → SQL → execute → LLM stream. Captures `datasetId` at invocation time and passes it explicitly to all nested `apiFetch` calls to prevent cross-dataset contamination on dataset switch. Do not add logic directly — extract new concerns into separate hooks.

**Navigation**
- `src/components/sidebar.tsx` — Flat `w-[220px]` sidebar with `SidebarItem` (icon+text), `SectionLabel`, workspace header, Settings/Account as Popovers
- `src/components/sidebar/` — Panels, history, nav list inside the sidebar
- `src/components/topbar.tsx` — Page-level header bar

**Canvas**
- `src/components/canvas/` (34 files) — tldraw v4 integration. Custom shapes via `BaseBoxShapeUtil`, card renderers per type, canvas toolbar and actions
- `src/components/deck/` — Deck-specific canvas variant using React Flow (migration in progress from tldraw)

**Feature Areas** (each has components + lib + api route(s))
- `segments` — SQL-based user segments with integration push
- `metrics` — Metrics with SQL, dimensions, time-series
- `playbooks` — V1 (step-based) + V2 (canvas-based) playbook execution
- `forecast` — Time-series forecasting with model inspection
- `knowledge` — LLM-indexed knowledge base entries
- `scouts` — Automated monitoring rules
- `connectors` — Data source connection configs
- `store` — eCommerce catalog browser (mock data demo)
- `metric-tree` — Visual metric dependency tree

**Shared Primitives**
- `src/components/ui/` (23 files) — shadcn/ui primitives (button, input, badge, dialog, etc.)
- `src/components/chart/report-chart.tsx` — Chart renderer used across canvas and reports

### Subagent IDs

The 6 core analysis agents are: `data-quality`, `daily-metrics`, `cohort-retention`, `rev-opt`, `user-segmentation`, `geographic`. Plus 3 universal agents: `research`, `data-analysis`, `marketing-optimization`. Plus `critique` for validation in deep mode. Agent display metadata is in `use-classify.ts` (canonical), task configs in `src/lib/subagent-config.ts`.

## Conventions

- Path alias: `@/*` maps to `./src/*`
- Package manager: pnpm (workspace config present)
- UI components via shadcn CLI: `npx shadcn add <component>`
- Fonts: Inter (sans) + Geist Mono
- DuckDB is externalized from the Next.js bundle via `serverExternalPackages` in `next.config.ts`
- Preloaded demo conversations are hardcoded in `page.tsx` (PRELOADED constant) for the sidebar
- `.reference/` directory contains UI reference screenshots (numbered 01-18)
- **Strictly monochrome UI** — no colorful tags, labels, badges, or accents unless specifically requested. Use `muted`, `foreground`, `border` tokens only.
- **No hardcoded "ecommerce"** — use `DEFAULT_DATASET` from `@/lib/datasets/constants` (client) or `@/lib/datasets` (server). The string `"ecommerce"` must only appear in dataset definition files (`datasets/ecommerce.ts`, `datasets/constants.ts`).
- **Dataset-aware imports:** Client components must import `DEFAULT_DATASET` from `@/lib/datasets/constants` (not `@/lib/datasets`) to avoid pulling Node.js `fs` into the client bundle.

### API Calls — apiFetch

**All frontend→backend calls MUST use `apiFetch` from `src/lib/api-client.ts`**. Never use raw `fetch("/api/...")`.

`apiFetch` auto-injects `x-dataset-id`, `x-model-id`, and `Content-Type: application/json` headers. This prevents the class of bugs where individual fetch calls forget required headers.

```typescript
// JSON response (auto-parsed)
const data = await apiFetch<Segment[]>("/api/segments");

// POST with body (auto-stringified, Content-Type auto-set)
const result = await apiFetch<{ id: string }>("/api/segments", {
  method: "POST",
  body: { name, sql },
});

// SSE streaming (returns raw Response)
const res = await apiFetch("/api/analyze", { method: "POST", body: { query }, stream: true });

// Skip model header for non-LLM routes
const health = await apiFetch("/api/health", { skipModel: true });
```

**Only exception**: FormData uploads (multipart) can use raw `fetch` since `apiFetch` JSON-stringifies the body.

Module-level state (`_datasetId`, `_modelId`) is synced from React contexts via `setActiveDatasetId()` and `setActiveModelId()`, called by `DatasetProvider` and `ModelProvider` on mount/switch. `_datasetId` initializes to `""` and logs a warning if `apiFetch` is called before `setActiveDatasetId()`.

**Race condition safety:** When making multiple `apiFetch` calls inside a long-running function (like `handleSend` in `use-analytics.ts`), capture `datasetId` at the start and pass it explicitly via the `datasetId` option to prevent stale reads if the user switches datasets mid-stream:
```typescript
const capturedDatasetId = datasetId;
await apiFetch("/api/analyze", { method: "POST", body: { query }, datasetId: capturedDatasetId });
```

### SSE Events — Typed Contract

SSE events between `/api/analyze` and the client use a typed discriminated union from `src/lib/sse-types.ts`.

- **Server**: `send()` in `route.ts` is typed as `(event: AnalyzeSSEEvent) => void` — compile-time safety
- **Client**: `parseAnalyzeEvent(line)` parses NDJSON lines into typed events with automatic fence stripping
- **Adding a new event**: Add the variant to `AnalyzeSSEEvent` union in `sse-types.ts`, add the case to `switch (event.type)` in `use-analytics.ts`. TypeScript will catch missing cases.

### Store / Data Layer Pattern

Every entity uses a consistent two-file split:

- **`src/lib/<entity>-data.ts`** — Static seed data only. Exports `PRESEEDED_*` or `TEMPLATE_*` constants. Never mutated at runtime.
- **`src/lib/<entity>-store.ts`** — Runtime in-memory CRUD. Dataset-scoped stores use nested `Map<string, Map<string, T>>` (outer key = datasetId, inner key = entityId) + `ensureInitialized(datasetId)` guard. All public functions require `datasetId` as their first parameter. Exports named functions (`saveX(datasetId, ...)`, `getX(datasetId, id)`, `deleteX(datasetId, id)`, `getAllX(datasetId)`).

**Dataset-scoped stores** (require `datasetId`): `metric-store`, `knowledge-store`, `board-store`, `conversation-store`

**Non-scoped stores** (global): `credit`, `deck`, `folder`, `onboarding`

**Static data files** (read-only, renamed from `-store` to `-data`): `scout-data`, `connector-data`, `catalog-data`

Entities with a data file: `conversation`, `forecast`, `knowledge`, `metric`, `playbook`, `catalog`, `chat`, `store` (mock data)

### Store Mutations — Catalog Invalidation

When a store mutates data (segment created, playbook saved, knowledge added), it must call `invalidateCatalog()` from `src/lib/catalog-invalidation.ts`. This triggers the @ context picker and entity catalog to rebuild.

**Must call `invalidateCatalog()` on save/delete:** `playbook-store.ts`, `knowledge-store.ts`, `metric-store.ts`, `forecast-store.ts`, `scout-data.ts`

**Segment mutations** go through the API and trigger `refreshSegments()` from `sidebar-context.tsx` (not `invalidateCatalog()`).

**Note:** `folder-store.ts` does not currently call `invalidateCatalog()` — folders are not in the entity catalog.

### Provider Architecture

The provider tree (in `layout-shell.tsx`) is:

```
DatasetProvider → ModelProvider → SidebarProvider → EntityCatalogProvider → ChatStateProvider → ChatPanelProvider
```

Order matters — each provider depends on upstream context. Do not reorder.

- **DatasetProvider** — Active dataset id + switcher
- **ModelProvider** — Active Gemini model id + switcher
- **SidebarProvider** (`sidebar-context.tsx`) — Conversation list, active conversation, segment refresh
- **EntityCatalogProvider** (`chat/entity-catalog-provider.tsx`) — Entity catalog + run catalog for @ picker. Subscribes to `catalog-invalidation.ts`. Independent of conversation state.
- **ChatStateProvider** (`chat-state-provider.tsx`) — Thin orchestrator. Composes 8 hooks: `useConversation`, `usePanel`, `useSegmentCreation`, `usePlaybookCreation`, `useAnalytics`, `useActionHandlers`, `useDbHealth`, `useDirectStream`. Subscribes to `dataset-switch.ts` events to abort streams and reset UI on dataset switch. **Do not add logic directly here — extract into a hook.**
- **ChatPanelProvider** — Entity context injection for page-level chat (e.g. segment detail page injects the segment as context)

### Hooks Architecture

Hooks in `src/hooks/` each own a single concern:

| Hook | Owns |
|------|------|
| `use-analytics.ts` | Full analytics query flow (classify → SQL → execute → stream) |
| `use-action-handlers.ts` | Follow-up actions (segment create, playbook save, knowledge add) |
| `use-panel.ts` | Task/sources panel open/close + citation tracking |
| `use-conversation.ts` | Conversation init, switch, message state |
| `use-playbook-creation.ts` | Playbook modal generation + validation flow |
| `use-segment-creation.ts` | Segment modal SQL validation + user count + push |
| `use-direct-stream.ts` | Non-analytics LLM response streaming |
| `use-classify.ts` | Query classification helpers + agent display metadata (canonical AGENT_DISPLAY + AGENT_FRIENDLY_NAMES — single source of truth) |
| `use-autocomplete.ts` | @ mention autocomplete with debouncing + session cache |

When adding new interactive behavior to the chat: add a new hook and compose it into `ChatStateProvider`. Don't expand existing hooks.

### Recurring UI Patterns

These patterns appear across every feature area. No shared base component exists yet — but follow the established shape when adding new ones so they stay consistent.

**Detail side panel** (metric, segment, playbook, scout, forecast)
- Full-height panel alongside a list or canvas
- Header: entity name + type badge + action buttons (edit, delete, kebab menu)
- Body: scrollable content sections
- Delete: always use shadcn `AlertDialog` for confirmation — never `window.confirm`

**Card with hover actions** (knowledge, segment, store-insight, integration)
- `relative group` wrapper
- Content visible always; action buttons appear on `group-hover` (`opacity-0 group-hover:opacity-100`)
- Actions go in a `DropdownMenu` — not inline buttons — once there are more than 2

**Modal form** (segment, playbook, knowledge, metric)
- shadcn `Dialog` → `DialogContent` → `DialogHeader` + `DialogTitle`
- Form fields use shadcn `Input` / `Textarea` / `Select`
- Submit button disabled while loading; shows spinner
- Error displayed inline below the relevant field, not in a toast

**Empty state**
- Centered in the container: icon (muted, `size-10`) → heading → sub-text → CTA button
- Use `text-muted-foreground` for sub-text. No color.

**Page shell** (all `"use client"` feature pages)
```tsx
<div className="flex flex-col h-full min-w-0">
  {/* optional topbar */}
  <div className="max-w-5xl mx-auto px-6 py-8 w-full">
    {/* content */}
  </div>
</div>
```

### Dataset Consistency Rules

**Every piece of data the user sees must flow from dataset config or live queries — never from hardcoded constants that assume a specific domain.**

- `DEFAULT_DATASET` is defined in `src/lib/datasets/constants.ts` (client-safe) and re-exported from `src/lib/datasets/index.ts`
- `getDataset(id)` throws on unknown dataset ID — no silent fallback to ecommerce
- `validateDatasetId(raw)` validates format (`/^[a-z0-9-]+$/`, max 64 chars) and returns a safe ID
- `getSystemContext(datasetId)` requires `datasetId` (non-optional) — returns domain-appropriate LLM persona
- SQL prompts include MEMORY CONSTRAINTS section teaching LLM to generate memory-efficient SQL
- `DatasetConfig` includes `currency`, `entityName`, `dateRange`, `domainHints` for dynamic UI
- Playbooks carry `datasetId` field for cross-dataset isolation

### Dataset Switch Lifecycle

When the user switches datasets via `DatasetProvider.switchDataset()`:
1. `notifyDatasetSwitch()` fires (pub/sub from `dataset-switch.ts`)
2. `ChatStateProvider` listens and: aborts in-flight analytics (`handleStop`), resets `deepResearch` to false, closes panel, closes segment modal
3. `setActiveDatasetId()` updates the module-level `_datasetId` in `api-client.ts`
4. React state updates trigger re-renders with new dataset context

### Adding a New Entity Type

When adding a new entity (like segments, playbooks, metrics):

1. **(Optional)** Add `src/lib/<entity>-data.ts` — static seed data as `PRESEEDED_<ENTITY>` or `TEMPLATE_<ENTITY>` constants
2. Add `src/lib/<entity>-store.ts` — dataset-scoped CRUD using nested `Map<string, Map<string, T>>` + `ensureInitialized(datasetId)`. All public functions require `datasetId` as first param. Call `invalidateCatalog()` on every save/delete.
3. Add catalog entries in `src/lib/entity-registry.ts` — `buildEntityCatalog(datasetId, segments)` should include the new type
4. Add API route in `src/app/api/<entity>/route.ts` — reads `x-dataset-id` from headers via `validateDatasetId(req.headers.get("x-dataset-id"))`
5. Add page in `src/app/<entity>/page.tsx` — use the page shell pattern; call `setEntity()` from `useChatPanel()` to inject context into sidebar chat
6. Use `apiFetch` for all API calls (never raw `fetch`); pass explicit `datasetId` in long-running functions
7. Follow the recurring UI patterns above for detail panels, cards, modals, and empty states
8. Use `dataset.label`, `dataset.currency`, `dataset.entityName` for UI text — never hardcode domain-specific strings
