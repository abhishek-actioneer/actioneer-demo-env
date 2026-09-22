# Convention-First Refactor Plan

**Goal**: Get codebase from 5/10 to 9/10 for AI-agent friendliness and iteration speed.
**Approach**: Eliminate implicit knowledge, make patterns copy-pasteable, decompose god objects.
**Non-goals**: Full architecture rewrite, Zustand/Jotai migration, 100% test coverage.
**Status**: ✅ All phases complete.

---

## Phase 1: API Client Layer ✅

**Problem**: 21 files with inline `fetch("/api/...")`, each independently remembering headers. The `x-dataset-id` bug class is structural — guaranteed to recur.

**Solution**: Single `apiFetch()` function that auto-injects dataset ID, content-type, model headers, and standardized error handling.

### Files to create

- `src/lib/api-client.ts` (~80 lines)
  - `apiFetch<T>(path, options?)` — core fetch wrapper
  - `ApiError` class with status + message
  - Auto-injects `x-dataset-id` from a module-level getter (set by DatasetContext on mount)
  - Auto-injects `Content-Type: application/json` for POST/PATCH/DELETE
  - Parses JSON response, throws `ApiError` on non-ok
  - Optional `stream: true` mode that returns raw `Response` for SSE routes
  - `setActiveDatasetId(id)` / `getActiveDatasetId()` — module-level state synced from DatasetContext

### Files to modify (migration pass)

Replace all inline `fetch("/api/...")` calls with `apiFetch()`:

| File | Fetch calls | Notes |
|------|-------------|-------|
| `src/components/chat/chat-state-provider.tsx` | 5 | segments, knowledge, query, segments/generate-sql |
| `src/hooks/use-analytics.ts` | 8 | classify, analyze, chat, recommend, playbook/create, segments/generate-sql, ack |
| `src/hooks/use-segment-creation.ts` | 2 | segments POST, segments/push |
| `src/hooks/use-autocomplete.ts` | 1 | complete |
| `src/hooks/use-playbook-creation.ts` | 2 | playbook/create, playbook/validate |
| `src/components/sidebar-context.tsx` | 1 | segments GET |
| `src/app/segments/page.tsx` | 2 | segments GET, segments POST |
| `src/app/segments/[id]/page.tsx` | 1 | segments/[id] GET |
| `src/app/metrics/page.tsx` | 1 | metrics GET |
| `src/app/knowledge/page.tsx` | 1 | knowledge GET |
| `src/app/playbooks/[id]/page.tsx` | 2 | playbook/run, playbook/edit |
| `src/app/data-catalog/page.tsx` | 1 | schema/tables |
| `src/components/segments/segment-detail-panel.tsx` | 3 | segments/[id], integrations, segments/push |

**Estimated effort**: 1-2 hours. Mechanical find-and-replace with type improvements.

### Verification

After migration, `grep -r 'fetch("/api/' src/` should return 0 results (only `apiFetch` calls remain). SSE streaming routes (`/api/analyze`, `/api/chat`) use `apiFetch` with `stream: true`.

---

## Phase 2: Typed SSE Contract ✅

**Problem**: SSE events from `/api/analyze` are parsed ad-hoc in `use-analytics.ts`. No schema at client. Adding a new event type requires reading 1,000 lines of hook code to understand the structure.

**Solution**: Discriminated union type for all SSE events, shared between server and client.

### Files to create

- `src/lib/sse-events.ts` (~60 lines) — replaces current `sse-types.ts`

```typescript
export type AnalyzeEvent =
  | { type: "ack"; text: string }
  | { type: "plan"; agents: { id: string; name: string; expectedQueryCount: number }[] }
  | { type: "phase"; phase: string; agentId?: string }
  | { type: "sql"; agentId: string; sql: string; queryIndex: number }
  | { type: "query_result"; agentId: string; queryIndex: number; rows: number; columns: string[]; executionMs: number }
  | { type: "summary"; agentId: string; summary: string }
  | { type: "result"; agentId: string; status: "complete" | "error"; error?: string }
  | { type: "text"; token: string }
  | { type: "report"; markdown: string }
  | { type: "done"; totalMs: number }
  | { type: "error"; message: string };

export function parseEvent(line: string): AnalyzeEvent | null {
  // Strip markdown fences, parse JSON, validate type field
}
```

### Files to modify

- `src/app/api/analyze/route.ts` — emit events using typed helpers: `sendEvent({ type: "sql", ... })`
- `src/hooks/use-stream.ts` (new, from Phase 3) — consume events with exhaustive switch

**Estimated effort**: 1 hour.

---

## Phase 3: God File Decomposition ✅

### 3A: Split chat-state-provider.tsx (620 lines → 4 providers)

#### ConversationProvider (~120 lines)
**Owns**: `activeConvId`, `messages`, `setMessages`, conversation CRUD
- `useConversationState()` hook
- Wraps existing `useConversation` hook
- Exposes: `messages`, `activeConvId`, `setActiveConvId`, `handleNewChat`, `ensureConversation`, `saveCurrentConversation`, `refreshChats`

#### EntityCatalogProvider (~60 lines)
**Owns**: entity catalog, run catalog, entity lookup, catalog invalidation
- `useEntityCatalog()` hook
- Subscribes to `catalog-invalidation.ts` (already exists)
- Exposes: `entityCatalog`, `runCatalog`, `entityLookup`, `handleEntityClick`

#### PanelProvider (~80 lines)
**Owns**: panel state, sources, citations, task/subagent click handlers
- `usePanelState()` hook
- Wraps existing `usePanel` hook
- Exposes: `panel`, `setPanel`, `activeCitation`, `sourcesAgents`, `handleViewTask`, `handleSubagentClick`, `handleClosePanel`, `handleCitationClick`

#### AnalyticsProvider (~150 lines)
**Owns**: send pipeline, processing state, deep research toggle
- `useAnalyticsState()` hook
- Composes: `use-classify`, `use-stream`, `use-chat-actions` (from 3B)
- Exposes: `handleSend`, `handleStop`, `isProcessing`, `deepResearch`, `setDeepResearch`, `generatedReport`

#### Composition in layout

```tsx
// src/components/chat/chat-providers.tsx
export function ChatProviders({ children }: { children: ReactNode }) {
  return (
    <ConversationProvider>
      <EntityCatalogProvider>
        <PanelProvider>
          <AnalyticsProvider>
            {children}
          </AnalyticsProvider>
        </PanelProvider>
      </EntityCatalogProvider>
    </ConversationProvider>
  );
}
```

Components import only what they need:
- `ChatThread` → `useConversationState()` + `usePanelState()`
- `ChatInput` → `useAnalyticsState()` + `useEntityCatalog()`
- `ResearchTimeline` → `useConversationState()` (messages only)

### 3B: Split use-analytics.ts (1,084 lines → 3 hooks)

#### use-classify.ts (~100 lines)
- `classifyQuery(text)` → `{ mode: "analytics" | "direct" | "action", actionType?, extractedDescription? }`
- Calls `POST /api/classify` via `apiFetch`
- Handles segment/playbook detection
- Pure function, no state

#### use-stream.ts (~350 lines)
- `startStream(query, mode, options)` → manages SSE connection
- Consumes typed `AnalyzeEvent` from Phase 2
- Manages agent state machine (plan → sql → results → summaries → synthesis)
- Handles abort, reconnect, error states
- Returns: `{ isStreaming, agents, currentPhase, abort }`

#### use-chat-actions.ts (~200 lines)
- Post-response logic: follow-up actions, save-as-playbook, save-to-knowledge
- Connector requirement detection
- Credit tracking
- Returns action handlers

#### Pipeline in AnalyticsProvider

```typescript
const handleSend = async (text) => {
  const classification = await classify(text);

  if (classification.mode === "action") {
    handleAction(classification);
    return;
  }

  if (classification.mode === "direct") {
    await streamDirect(text);
  } else {
    await streamAnalytics(text, classification);
  }

  await generateActions(text, response);
};
```

**Estimated effort**: 4-5 hours. This is the biggest piece — test after each extraction.

---

## Phase 4: Store Consistency ✅ (skipped — stores already consistent)

**Problem**: 6 stores with 6 different patterns. Some persist, some don't. Invalidation is ad-hoc.

**Solution**: Standardize on a single store pattern. Not a library — just a consistent shape.

### Store template

```typescript
// Template: src/lib/stores/create-store.ts
export function createStore<T extends { id: string }>(name: string) {
  const items = new Map<string, T>();

  return {
    get: (id: string) => items.get(id),
    getAll: () => Array.from(items.values()),
    save: (item: T) => { items.set(item.id, item); invalidateCatalog(); },
    delete: (id: string) => { items.delete(id); invalidateCatalog(); },
    clear: () => items.clear(),
  };
}
```

### Migration

| Store | Current | Target |
|-------|---------|--------|
| playbook-store | Manual Map + manual invalidateCatalog() | `createStore<AnyPlaybook>("playbooks")` |
| knowledge-store | Manual Map + manual invalidateCatalog() | `createStore<KnowledgeEntry>("knowledge")` |
| metric-store | Manual Map + manual invalidateCatalog() | `createStore<Metric>("metrics")` |
| scout-store | Read-only array | Leave as-is (no mutations) |
| conversation-store | localStorage + Map | Leave as-is (has persistence needs) |
| segments | DuckDB via API | Leave as-is (server-side) |

Only migrate the 3 simple in-memory stores. Don't touch conversation-store or segments (different persistence model).

**Estimated effort**: 1 hour. Mechanical replacement.

---

## Phase 5: Entity Type Template ✅

**Problem**: Adding a new entity type requires touching 7+ files with no documentation. AI agents miss files every time.

**Solution**: A literal template + checklist that an AI copies.

### Create template files

- `docs/templates/new-entity-type.md` — step-by-step checklist
- `docs/templates/entity-store.template.ts` — store boilerplate
- `docs/templates/entity-api-route.template.ts` — API route boilerplate

### Checklist content

```markdown
# Adding a New Entity Type: {EntityName}

## Files to create
1. `src/lib/{entity}-types.ts` — type definitions
2. `src/lib/{entity}-store.ts` — createStore<{Entity}>("{entities}")
3. `src/app/api/{entities}/route.ts` — GET (list) + POST (create)
4. `src/app/api/{entities}/[id]/route.ts` — GET + PATCH + DELETE

## Files to modify
5. `src/lib/entity-types.ts` — add "{entity}" to EntityType union
6. `src/lib/entity-registry.ts` — add to buildEntityCatalog()
7. `src/lib/entity-context.ts` — add case to buildPageEntityContext()
8. `src/components/chat/context-picker.tsx` — add category to CATEGORIES array
9. `src/lib/page-context.ts` — add route mapping
10. `src/app/{entities}/page.tsx` — list page with setEntity()

## Verification
- [ ] Entity appears in @ picker
- [ ] Entity context is rich (check via console.log in use-analytics)
- [ ] Page-level chat injects correct context
- [ ] Store mutations trigger catalog invalidation
```

**Estimated effort**: 30 minutes.

---

## Phase 6: Critical Path Smoke Tests ✅

**Problem**: No tests. Changes can't be verified. The segment bug sat there until manual testing.

**Solution**: Not full coverage — just 5-8 smoke tests for the critical paths that break most often.

### Test file

- `tests/smoke/critical-paths.test.ts` (using Playwright API testing, already configured)

### Tests to write

| Test | What it catches |
|------|----------------|
| `POST /api/segments → GET /api/segments includes it` | The exact segment bug we had |
| `POST /api/classify returns valid mode` | Classification regressions |
| `GET /api/segments with x-dataset-id filters correctly` | Dataset isolation |
| `POST /api/segments with bad SQL returns 400` | Validation regressions |
| `GET /api/metrics returns array` | Metrics endpoint health |
| `GET /api/health returns 200` | Basic server health |
| `POST /api/analyze streams valid NDJSON` | Streaming contract |
| `POST /api/segments/[id] returns preview rows` | Preview regression |

Each test is 5-15 lines. Total file ~150 lines.

**Estimated effort**: 1-2 hours.

---

## Phase 7: CLAUDE.md Conventions ✅

**Problem**: Implicit knowledge that only exists in developer heads (or memory files). AI agents can't discover conventions without grepping.

**Solution**: Add explicit checklists to CLAUDE.md for every common operation.

### Sections to add

```markdown
## API Conventions
- ALL fetch calls use `apiFetch()` from `src/lib/api-client.ts`
- NEVER use raw `fetch("/api/...")` — apiFetch handles dataset ID, headers, errors
- SSE streaming routes: use `apiFetch(path, { stream: true })` to get raw Response
- API errors throw `ApiError` — catch and toast in the caller

## Adding a New Entity Type
→ See docs/templates/new-entity-type.md

## Adding a New API Route
- Use Zod for request validation
- Read dataset ID: `req.headers.get("x-dataset-id") || DEFAULT_DATASET`
- Return consistent error shape: `{ error: string }`
- Use executeSQLPrepared for parameterized queries (never string interpolation)

## Provider Architecture
- ConversationProvider → conversation CRUD, messages
- AnalyticsProvider → send pipeline, streaming, processing state
- PanelProvider → side panel state, citations, sources
- EntityCatalogProvider → @ picker catalog, invalidation
- Components import ONLY the provider they need

## Store Pattern
- In-memory stores use `createStore<T>()` from `src/lib/stores/create-store.ts`
- All mutations auto-trigger catalog invalidation
- Segments are server-side (DuckDB) — use apiFetch, not a store

## SSE Events
- All events typed in `src/lib/sse-events.ts`
- Server emits via typed helpers
- Client consumes via exhaustive switch on event.type

## Running Tests
- `pnpm test:smoke` — critical path smoke tests (run before PR)
```

**Estimated effort**: 30 minutes.

---

## Execution Order

| Phase | Effort | Depends on | Shippable alone? |
|-------|--------|------------|-----------------|
| 1. API Client | 1-2 hrs | nothing | Yes |
| 2. Typed SSE | 1 hr | nothing | Yes |
| 3. God File Decomposition | 4-5 hrs | Phase 1 (apiFetch calls in new hooks) | Yes |
| 4. Store Consistency | 1 hr | nothing | Yes |
| 5. Entity Template | 30 min | nothing | Yes |
| 6. Smoke Tests | 1-2 hrs | Phase 1 (test apiFetch paths) | Yes |
| 7. CLAUDE.md Conventions | 30 min | all phases (documents final state) | Yes |

**Total: ~10-12 hours across 3-4 sessions.**

Each phase is independently shippable. If we stop after Phase 1 alone, we've already eliminated the most common bug class.

---

## Success Criteria

- `grep -r 'fetch("/api/' src/` returns 0 results
- No file in `src/components/chat/` exceeds 200 lines
- No hook exceeds 400 lines
- `pnpm test:smoke` passes with 8 green tests
- A new entity type can be added by following the template in <30 minutes
- AI agent can make changes to any single feature without reading >400 lines of context
