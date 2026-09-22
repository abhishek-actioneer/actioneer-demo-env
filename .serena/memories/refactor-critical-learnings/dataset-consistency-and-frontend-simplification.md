# Critical Learnings for Dataset Consistency & Frontend Simplification Refactors

## PLAN 1: Dataset Consistency (Eliminating Hardcoded "ecommerce")

### HIGH-SEVERITY CONSTRAINTS

#### 1. SQL Context Functions — Three-Way Confusion (CRITICAL)
**File:** `docs/solutions/logic-errors/deck-processing-wrong-sql-context-function.md`
**Rule:** Three functions in `src/lib/schema.ts` and `src/lib/prompts/sql.ts` do VERY different things:
- `getSystemContext(datasetId)` → LLM persona ("You are Sentinel...") — use ONLY for chat response synthesis
- `getSchemaContext(datasetId)` → Raw table schema (internal use only)
- `buildTextToSqlPrompt(datasetId)` → Schema + SQL rules combined — use ONLY for SQL generation

**Why it matters for your refactor:** When refactoring to make LLM prompts dataset-dynamic, you MUST use `buildTextToSqlPrompt()` for ALL SQL generation. Using `getSystemContext()` causes Gemini to hallucinate table names.

**Code review signal:** If you see `getSystemContext` imported in an API route that also calls `executeSQL`, that's a red flag.

**Applies to phases:**
- Phase 2 (API route dataset awareness) — audit all SQL generation calls
- Phase 3 (dataset-dynamic prompts) — ensure dataset-aware prompts use `buildTextToSqlPrompt`

---

#### 2. DuckDB Connection Lifecycle — Singleton Pattern Required (CRITICAL)
**File:** `docs/solutions/database-issues/duckdb-connection-leak-server-crash-System-20260219.md`
**Rule:** Every `getConnection()` call creates a new native DuckDB connection. If not closed, the server crashes with SIGBUS after 5-10 requests. Max connection leak severity.

**Implementation pattern:**
- Singleton `connection` variable in `src/lib/db.ts`
- Reuse the same connection across all requests
- Never call `inst.connect()` more than once at module load time
- All API routes share this singleton via `src/lib/sql-executor.ts`

**Why it matters for your refactor:** When making DB connections dataset-aware, do NOT create per-dataset connections. That will multiply the leak by N datasets. Keep the singleton pattern.

**Applies to phases:**
- Phase 1 (data preparation) — if setting up new dataset connections, use singleton per instance
- Phase 2 (API routes) — critical when passing datasetId through the connection layer

---

#### 3. DuckDB File Lock Behavior — In-Memory for Standalone Scripts (HIGH)
**File:** `docs/solutions/database-issues/duckdb-node-api-v1-usage-patterns.md`
**Rule:** DuckDB takes an exclusive write lock on `.duckdb` file, including the WAL. Even `READ_ONLY` mode cannot bypass this if another process holds the write lock (e.g., dev server). For standalone scripts while dev is running, use `:memory:` + `read_parquet()`.

**Pattern for standalone scripts:**
```typescript
const db = DuckDBInstance.create(':memory:');
const conn = db.connect();
// Read from parquet directly
const result = await conn.stream(`SELECT * FROM read_parquet('data/parquet/*.parquet')`);
```

**Why it matters for your refactor:** When seeding datasets from JSON or parquet, use `:memory:` mode if script runs during dev. Schema changes during dev require this pattern.

**Applies to phases:**
- Phase 1 (data preparation) — any schema migration script must use `:memory:`

---

### MEDIUM-SEVERITY CONSTRAINTS

#### 4. Dataset-Specific API Routes via Header Injection (MEDIUM)
**File:** `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md`
**Rule:** Use `apiFetch()` from `src/lib/api-client.ts` for all frontend→backend calls. It auto-injects `x-dataset-id` header. Never use raw `fetch()`.

**Pattern:**
```typescript
// ✅ Correct
const data = await apiFetch<Segments[]>("/api/segments"); // auto-injects x-dataset-id

// ❌ Wrong
const data = await fetch("/api/segments").then(r => r.json()); // header missing
```

**Why it matters for your refactor:** Phase 2 (API route dataset awareness) depends on consistent header injection. Missing headers will cause silent failures.

**Applies to phases:**
- Phase 2 (API route dataset awareness) — all new routes must use apiFetch
- Phase 3 (dataset-dynamic prompts) — ensure headers propagate to Gemini calls

---

#### 5. Seed Data File vs Store Pattern (MEDIUM)
**File:** Referenced in CLAUDE.md (existing project convention)
**Rule:** Entities with seed data use two-file pattern:
- `src/lib/<entity>-data.ts` — Static seed data constants only (never mutated)
- `src/lib/<entity>-store.ts` — Runtime in-memory CRUD using `Map<string, T>`

**Store pattern enforces:**
- `ensureInitialized()` guard on first access (lazy seeding)
- Call `invalidateCatalog()` on every save/delete
- Export named functions: `saveX()`, `getX()`, `deleteX()`, `getAllX()`

**Why it matters for your refactor:** Phase 1 (moving seed data to JSON) requires refactoring seed constants into loadable JSON files. The store pattern remains the same; only the data source changes.

**Applies to phases:**
- Phase 1 (data preparation) — seed JSON still loads via `ensureInitialized()`
- Phase 1.5 (seed data extraction) — review all `-data.ts` files for hardcoded "ecommerce" strings

---

## PLAN 2: Frontend Simplification

### HIGH-SEVERITY CONSTRAINTS

#### 6. Hydration Mismatch Pattern — localStorage in Initialization (CRITICAL for Context Splitting)
**Files:** 
- `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md` (useState variant)
- `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usememo-PlaybookPage-20260224.md` (useMemo variant)

**Rule:** Never read from `localStorage` in:
1. `useState()` initializer (server renders different HTML than client)
2. `useMemo()` or `useCallback()` sync code (server has no window object)

**Fix pattern:** Move localStorage access into `useEffect`:
```typescript
// ❌ Wrong
const [pinned, setPinned] = useState(() => 
  localStorage.getItem("sidebar-pinned") === "true" // server renders false, client renders true
);

// ✅ Correct
const [pinned, setPinned] = useState(false);
useEffect(() => {
  setPinned(localStorage.getItem("sidebar-pinned") === "true");
}, []);
```

**Why it matters for frontend simplification:** When splitting React contexts, many contexts depend on localStorage for persistence. Any new context that reads localStorage must follow this pattern or cause hydration errors across multiple pages.

**Applies to phases:**
- Phase 2 (context splitting) — any new context provider that reads localStorage must defer to useEffect
- Phase 3 (dead code removal) — when consolidating localStorage access, apply this pattern universally

**Affected entities:** Sidebar, Playbook, any feature with persisted state

---

#### 7. Provider Dependencies — Implicit Ordering (CRITICAL for Context Splitting)
**File:** Referenced in CLAUDE.md section "Provider Architecture"
**Rule:** Provider tree has hard ordering dependency:
```
DatasetProvider → ModelProvider → SidebarProvider → EntityCatalogProvider → ChatStateProvider → ChatPanelProvider
```

Each provider depends on upstream context. DO NOT REORDER.

**Additional constraint:** `EntityCatalogProvider` subscribes to `catalog-invalidation.ts` pub/sub. When stores call `invalidateCatalog()`, the entity picker rebuilds.

**Why it matters for context splitting:** If you split ChatStateProvider or create new contexts, they must be positioned correctly in the tree. Upstream contexts cannot depend on downstream ones.

**Applies to phases:**
- Phase 1 (decomposing ChatStateProvider) — new contexts must insert in the correct position
- Phase 2 (deleting dead contexts) — removing a context may break downstream providers that depend on it

---

#### 8. Canvas Provider Separation — ReactFlowProvider & tldraw Context (HIGH)
**Files:**
- `docs/solutions/runtime-errors/reactflow-provider-missing-canvasflow-context.md`
- `docs/solutions/runtime-errors/tldraw-useeditor-crash-outside-canvas-context-20260315.md`

**Rules:**

**ReactFlow pattern:** `CanvasFlow` wraps itself in `ReactFlowProvider` internally. Do NOT wrap it again at the page level. Other pages using React Flow hooks must check if provider exists.

```typescript
// ✅ Correct
function CanvasFlow({ boardId }) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner boardId={boardId} />
    </ReactFlowProvider>
  );
}
```

**tldraw pattern:** Card renderers (ChartRenderer, TableRenderer) are used in TWO contexts:
1. Inside tldraw canvas (context present ✓)
2. In document/board view (context absent ✗)

Any hook calling `useEditor()` MUST NOT be in shared card renderers. Extract tldraw-specific logic into canvas-only components.

**Why it matters for frontend simplification:** When deleting canvas components or extracting shared renderers, you must respect these provider boundaries. Moving a tldraw-dependent function into a shared component will break the board/document view.

**Applies to phases:**
- Phase 2 (extracting shared components) — card renderers cannot use tldraw hooks
- Phase 3 (dead code removal) — check if canvas components can be safely deleted without breaking document view

---

#### 9. Build Error: Next.js 16 Middleware → Proxy Transition (MEDIUM)
**File:** `docs/solutions/build-errors/nextjs-16-middleware-proxy-file-conflict.md`
**Rule:** Next.js 16 renamed `middleware.ts` to `proxy.ts`. Having BOTH files simultaneously crashes server startup with "Both middleware file and proxy file are detected" error.

**If you see both files:** Delete `middleware.ts`, rename to `proxy.ts`, change export from `export function middleware()` to `export function proxy()`.

**Why it matters for frontend simplification:** When refactoring routes or auth logic, ensure only `proxy.ts` exists (not `middleware.ts`). CI/CD checks may fail otherwise.

**Applies to phases:**
- If any refactor involves auth or routes — verify proxy.ts is the only middleware file

---

#### 10. ESLint Config for Worktrees & React Compiler False Positives (MEDIUM)
**File:** `docs/solutions/build-errors/eslint-worktrees-and-react-hooks-v7-false-positives-System-20260225.md`
**Rule:** When adding new files or refactoring, ESLint config MUST:

1. **Ignore worktree build artifacts:**
```javascript
globalIgnores: [".worktrees/**", ".next/**", "node_modules/**"]
```

2. **Disable React Compiler rules (not enabled in this project):**
```javascript
"react-hooks/preserve-manual-memoization": "off",
"react-hooks/set-state-in-effect": "off",
"react-hooks/refs": "off"
```

3. **For Playwright tests, disable hooks check:**
```javascript
{
  files: ["tests/**"],
  rules: { "react-hooks/rules-of-hooks": "off" }
}
```

**Why it matters for frontend simplification:** Refactoring will create new files. If eslint.config.mjs is not set up correctly, `pnpm lint` will fail on worktree artifacts or false positives from React Compiler rules.

**Applies to all phases:** Before starting refactor, verify lint passes with 0 errors

---

### MEDIUM-SEVERITY CONSTRAINTS

#### 11. Sidebar State Management — Pinned State Persists Across Routes (MEDIUM)
**File:** `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`
**Rule:** Sidebar component was in 9 separate page files. It unmounted/remounted on every route change, losing `pinned` and `hoveredItem` state. The fix: move Sidebar into shared `layout.tsx` and lift state to `SidebarProvider`.

**Consequence:** If refactoring Sidebar, state must remain in a layout-level provider that persists across route changes.

**Why it matters for frontend simplification:** When extracting Sidebar components or removing dead code, do not move Sidebar initialization out of the layout. It will break pinned state persistence.

**Applies to phases:**
- Phase 2 (context splitting) — SidebarProvider location is critical
- Phase 3 (dead code removal) — do not delete layout-level Sidebar wrapper

---

#### 12. Sidebar Panel Pattern — 3-Tier Architecture Standard (MEDIUM)
**Files:**
- `docs/solutions/design-patterns/split-panel-to-sidebar-three-tier-consolidation.md`
- `docs/solutions/best-practices/sidebar-panel-replacement-checklist-Sidebar-20260219.md`

**Rule:** All features (Metrics, Playbooks, Knowledge, Segments) follow 3-tier pattern:
1. **Sidebar hover panel** — compact item list in expandable sidebar section
2. **Landing page** (`/feature`) — full-width table/grid with filters
3. **Detail route** (`/feature/{id}`) — full-width detail page with breadcrumb

**Panel addition requires 7 integration points:**
- HoverPanel type union
- getActivePage function
- pageToPanel mapping
- RailIcon
- Panel header
- Panel content
- External panel component

**Why it matters for frontend simplification:** If deleting a feature or moving sidebar panels, respect this architecture. Deviating causes orphaned sidebar icons or broken navigation.

**Applies to phases:**
- Phase 3 (dead code removal) — when deleting a feature, remove all 7 sidebar integration points
- Phase 2 (extracting shared components) — detail panels follow a consistent shape

---

#### 13. tldraw Canvas: Three-Zone Pointer Events (MEDIUM)
**File:** `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`
**Rule:** Canvas card interaction requires three pointer event zones:
1. **Header row:** `isSelected || isEditing ? "all" : "none"` (shows toolbar when selected)
2. **Content area:** `"none"` always (tldraw drag/pan/zoom takes precedence)
3. **Toolbar buttons:** `onPointerDownCapture` + `editor.markEventAsHandled(e)` (capture phase, mark as handled)

**Pattern:**
```tsx
<HTMLContainer id={shape.id} pointerEvents="none">
  <div className="flex gap-2 p-2"
    pointerEvents={isSelected ? "all" : "none"}>
    <button 
      onPointerDownCapture={(e) => {
        editor.markEventAsHandled(e); // ← critical
        onClick?.();
      }}
    />
  </div>
</HTMLContainer>
```

**Why it matters for frontend simplification:** If extracting canvas components or refactoring card renderers, this pointer event pattern is non-negotiable. Using `onClick` alone will not work.

**Applies to phases:**
- Phase 2 (extracting shared components) — card renderers must preserve pointer event structure
- Phase 3 (dead code removal) — if deleting canvas UI, preserve three-zone pattern in remaining components

---

#### 14. tldraw Context Menu: Use Module-Level Registry Instead of React Context (MEDIUM)
**File:** `docs/solutions/ui-bugs/tldraw-context-menu-react-context-not-propagating.md`
**Rule:** React context does NOT propagate reliably through tldraw's internal Radix portals. For context menu items that depend on external state (e.g., follow-up actions), use module-level `Map<boardId, callback>` instead.

**Pattern:**
```typescript
// Module level — immune to portal/tree propagation issues
const followUpRegistry = new Map<string, (cardId: string) => void>();

// Parent component populates via useEffect
useEffect(() => {
  if (onAskFollowUp) followUpRegistry.set(boardId, onAskFollowUp);
  return () => { followUpRegistry.delete(boardId); };
}, [boardId, onAskFollowUp]);

// Context menu reads from registry (not React context)
const callback = followUpRegistry.get(boardId);
```

**Why it matters for frontend simplification:** If refactoring context menu or extracting tldraw logic, do not rely on React context for menu item state. Use the registry pattern instead.

**Applies to phases:**
- Phase 2 (extracting shared components) — context menus must use registry, not React context
- Phase 3 (dead code removal) — if cleaning up follow-up action logic, preserve the registry

---

#### 15. Chart Consistency: Use report-chart.tsx Conventions (LOW-MEDIUM)
**File:** `docs/solutions/best-practices/recharts-consistency-custom-tooltip-Forecasting-20260220.md`
**Rule:** All new Recharts charts (forecast, metrics, etc.) must match `src/components/chart/report-chart.tsx` conventions:
- Use `CustomTooltip` component for consistent formatting
- Wrap chart in `bg-card` (not ad-hoc CSS variables)
- Round tooltip values to 2 decimal places
- Use consistent grid, colors, and margins

**Why it matters for frontend simplification:** When extracting or consolidating chart components, ensure they use the shared `report-chart.tsx` pattern. Ad-hoc chart styling creates technical debt.

**Applies to phases:**
- Phase 2 (extracting shared components) — chart components should defer to report-chart.tsx
- Phase 3 (dead code removal) — consolidate chart rendering to single source of truth

---

#### 16. Canvas Dark Mode: Use CSS Variables, Not Hardcoded Hex (LOW-MEDIUM)
**File:** `docs/solutions/best-practices/canvas-dark-mode-centralized-theming-bypass-20260219.md`
**Rule:** Canvas components use ~30 hardcoded hex colors that bypass shadcn/Tailwind v4 token system. This breaks dark mode. When refactoring:
- Replace `#ffffff` → `bg-card`
- Replace `#fafafa` → `bg-muted`
- Define CSS variables for severity colors in `globals.css` with `.dark` overrides
- Use `var(--severity-critical)` instead of hardcoded hex

**Why it matters for frontend simplification:** If refactoring canvas styles, follow token system. Ad-hoc hex colors create technical debt and break dark mode.

**Applies to phases:**
- Phase 2 (extracting shared components) — canvas components must use Tailwind tokens
- Phase 3 (dead code removal) — consolidate theme colors to single `globals.css`

---

## SUMMARY TABLE: Critical Rules by Refactor Phase

| Phase | Top Constraints | Files to Audit | Risk Level |
|-------|-----------------|-----------------|-----------|
| **Plan 1: Phase 1** (Data prep, seed JSON) | DuckDB file locks, seed data pattern, store pattern | `src/lib/db.ts`, all `-data.ts`, all `-store.ts` | HIGH (connection leak) |
| **Plan 1: Phase 2** (API dataset awareness) | SQL context functions, apiFetch headers, header propagation | All `src/app/api/*/route.ts`, sql-generator.ts, sql-executor.ts | CRITICAL (hallucinated tables) |
| **Plan 1: Phase 3** (Dataset-dynamic prompts) | SQL context vs system context, buildTextToSqlPrompt usage | `src/lib/prompts/sql.ts`, all SQL generation sites | CRITICAL (Gemini schema confusion) |
| **Plan 2: Phase 1** (Dead code audit) | Sidebar 3-tier pattern, canvas provider separation, eslint config | `src/components/sidebar.tsx`, canvas components, `eslint.config.mjs` | MEDIUM (lint failures) |
| **Plan 2: Phase 2** (Context splitting) | Provider ordering, hydration mismatch pattern, localStorage in useEffect | All `*-provider.tsx`, all components with localStorage | CRITICAL (hydration errors, provider crashes) |
| **Plan 2: Phase 3** (Shared components) | Card renderer context isolation, pointer event zones, chart consistency | `src/components/chart/*`, `src/components/board/*`, canvas renderers | MEDIUM (broken canvas/board) |

---

## Quick Reference: Do's and Don'ts

### DO
- ✅ Use `buildTextToSqlPrompt()` for ALL SQL generation
- ✅ Keep singleton DuckDB connection in `src/lib/db.ts`
- ✅ Use `apiFetch()` for all frontend API calls (auto-injects headers)
- ✅ Move localStorage access into `useEffect` (never in initializers)
- ✅ Respect provider tree ordering (DatasetProvider → ... → ChatPanelProvider)
- ✅ Use three-zone pointer event pattern in canvas cards
- ✅ Use module-level registry for tldraw context menu state
- ✅ Use Tailwind tokens for canvas colors (not hardcoded hex)

### DON'T
- ❌ Use `getSystemContext()` for SQL generation (causes hallucinated table names)
- ❌ Create per-dataset DuckDB connections (multiplies connection leak)
- ❌ Read localStorage in useState initializer or useMemo (hydration mismatch)
- ❌ Reorder provider tree (breaks downstream dependencies)
- ❌ Wrap CanvasFlow in ReactFlowProvider at page level (it wraps itself)
- ❌ Use tldraw hooks (useEditor) in shared card renderers (breaks board view)
- ❌ Use React context for tldraw context menu state (portals don't propagate)
- ❌ Use hardcoded hex colors in canvas (breaks dark mode)
- ❌ Delete `proxy.ts` and keep `middleware.ts` (build error)
- ❌ Ignore `.worktrees/**` in eslint globalIgnores (80+ lint errors)

