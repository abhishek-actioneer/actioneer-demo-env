# Canvas List Page Feature — Institutional Knowledge Summary

## Feature Request
Add a Canvas index/list page at `/canvas` showing all user canvases, with individual canvas pages at `/canvas/[id]`. Currently `/canvas` shows a single default canvas via query parameter.

## Key Findings

### 1. Current Canvas Routing Architecture
**File**: `src/app/canvas/page.tsx`
- Uses `useSearchParams()` to read `?board=` query parameter
- Passes `boardId` to dynamically-loaded `CanvasPage` component
- SSR disabled (`ssr: false` in dynamic import)
- Pattern: Client-side route parameter passing via URL search params

**Key pattern to replace**: Query param `?board=<id>` → Next.js dynamic route params `[id]`

---

### 2. Entity List Page Patterns (Proven in Codebase)

#### Pattern A: Segments List Page
**File**: `src/app/segments/page.tsx`
- Uses `useRouter()` for programmatic navigation
- Fetches list via `apiFetch("/api/segments")` 
- Search + filtering with tabs (`"active" | "archived"`)
- Modal for creation (`setShowCreate` state)
- Click handlers route to detail page: `router.push(`/segments/${segment.id}`)`
- Integration: calls `setEntity()` from `useChatPanel()` to inject context into sidebar chat

#### Pattern B: Metrics List Page
**File**: `src/app/metrics/page.tsx`
- Similar to segments: fetch, filter, create button
- Category tabs instead of active/archived
- Calls `setEntity()` to update chat context with catalog
- Uses `useScrollRestore` for scroll position persistence
- API: `/api/metrics?datasetId=...` (includes dataset in query)

**Common pattern across both:**
```tsx
const router = useRouter();
const { datasetId } = useDataset();

// 1. Fetch list
const fetchList = useCallback(async () => {
  const data = await apiFetch("/api/<entity>");
  setItems(data);
}, [datasetId]);

// 2. Handle click → detail page
const handleClick = (id: string) => {
  router.push(`/<entity>/${id}`);
};

// 3. Update chat context
const { setEntity } = useChatPanel();
useEffect(() => {
  setEntity({ /* catalog */ });
}, [items]);
```

---

### 3. Next.js 16 Dynamic Route Convention
**Key pattern from codebase**:
- Files like `src/app/segments/[id]/page.tsx` and `src/app/metrics/[id]/page.tsx` exist
- Pattern: `[id]` directory with `page.tsx` receives route params as props
- Access via: `params.id` (not `useParams()` hook in server components, though client-side uses `useParams()`)

**Recommended structure for canvas**:
```
src/app/canvas/
  page.tsx                 (list all canvases)
  [id]/
    page.tsx              (individual canvas, replaces current single-canvas page)
```

---

### 4. Canvas Store & Board Management
**From migration plan** (`2026-03-11-refactor-canvas-react-flow-to-tldraw-migration-plan.md`):
- `src/lib/board-store.ts` — in-memory Map + localStorage for canvas cards
- `src/lib/board-types.ts` — type definitions
- Multiple canvases ("boards") already conceptually supported via store

**Implication**: Board persistence infrastructure already exists; only UI routing needs updating.

---

### 5. State Management Pattern for Multi-Canvas
**From**: `docs/solutions/design-patterns/lift-sidebar-state-to-layout-context.md`

**Key lesson**: Keep layout-level state in `SidebarContext` or root layout provider to persist across navigation.

**Pattern to apply for canvas list**:
- Sidebar shows list of canvases (like current chat threads in `SidebarProvider`)
- Clicking canvas navigates to `/canvas/[id]`
- Active canvas ID persists in context across route changes

---

### 6. Critical Pattern: Three-Zone Pointer Events in Canvas
**File**: `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`

**Relevance**: When creating canvas list view, don't render the tldraw canvas on the list page. The pointer event model is specific to the single-canvas (editing) view. List page should be a simple grid/card layout using standard HTML.

---

### 7. SSE/Streaming Context
**From**: `CLAUDE.md` architecture section
- Canvas page uses SSE for live updates (phase changes, SQL execution results)
- List page should NOT stream SSE; that's per-canvas
- List should use simple REST API: `GET /api/canvases` (new endpoint needed)

---

## Implementation Checklist

### Phase 1: API Layer
- [ ] Create `GET /api/canvases` endpoint (returns list of canvas metadata)
- [ ] Ensure canvas ID is stored/fetchable (currently only defaults to `DEFAULT_BOARD_ID`)

### Phase 2: Routing Structure
- [ ] Move current `src/app/canvas/page.tsx` → `src/app/canvas/[id]/page.tsx`
- [ ] Update to read `params.id` instead of `searchParams.get("board")`
- [ ] Create new `src/app/canvas/page.tsx` (list view)

### Phase 3: List Page Component
- [ ] Follow segments/metrics list pattern
- [ ] Search + filter UI (optional but consistent)
- [ ] Create canvas button
- [ ] Click-to-detail navigation (`router.push(\`/canvas/${id}\`)`)
- [ ] Integration: `setEntity()` call (optional, depends on chat context needs)

### Phase 4: Sidebar Integration
- [ ] Update sidebar to show canvas list (if desired)
- [ ] Active canvas highlight
- [ ] Consider using callback refs pattern from `SidebarContext` to wire up handlers

---

## Gotchas & Anti-Patterns

1. **Query param vs dynamic route**: Current `?board=<id>` works but doesn't scale for browser back-button history. Dynamic route `[id]` is cleaner.

2. **Don't render tldraw on list page**: tldraw's pointer events setup is complex and only needed for editing. List should use simple HTML.

3. **SSE belongs in `[id]` page only**: List page fetches once; detail page streams updates.

4. **Canvas ID persistence**: Unlike boards/playbooks which are explicitly created/named, canvas might be auto-generated (current `DEFAULT_BOARD_ID`). Design decision needed: are canvases user-created or system-generated?

5. **Avoid re-mounting tldraw on route change**: `dynamic(() => ..., { ssr: false })` pattern already isolates canvas component. Preserve this.

---

## Files to Review Before Starting
1. `/src/app/segments/page.tsx` — gold standard list page pattern
2. `/src/app/metrics/page.tsx` — alternative list page pattern
3. `/src/app/canvas/page.tsx` — current single-canvas page (will move to `[id]`)
4. `/src/lib/board-store.ts` — canvas data persistence
5. **New**: Create `/src/app/api/canvases/route.ts` for list endpoint
