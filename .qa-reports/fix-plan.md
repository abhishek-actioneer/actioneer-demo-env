# Fix Plan — QA Report 2026-03-20

## BEAD-001: Playbooks infinite loading [CRITICAL]

### Problem
`seedPlaybook()` in `src/app/playbooks/page.tsx:44-157` catches the network error at line 150, calls `markDatasetSeeded()` (preventing retries forever), sets `isSeeding=false`, but the render at line 236 only shows the spinner when `isSeeding===true`. After the error, `isSeeding` is false and `savedSummaries` is empty, so the page silently falls through to the empty playbook list — but there's no explicit empty state rendered for this case.

### Fix

**File:** `src/app/playbooks/page.tsx`

1. Add a `seedError` state:
   ```typescript
   const [seedError, setSeedError] = useState<string | null>(null);
   ```

2. In the catch block (line 150), set the error state and **do NOT call `markDatasetSeeded()`** — allow retry:
   ```typescript
   } catch (err) {
     if (err instanceof DOMException && err.name === "AbortError") return;
     console.error("Playbook seed error:", err);
     setSeedError("Failed to set up your first playbook. Please try again.");
     // Do NOT call markDatasetSeeded — allow retry
   } finally {
     setIsSeeding(false);
     abortRef.current = null;
   }
   ```

3. Add a retry function:
   ```typescript
   const retrySeed = useCallback(() => {
     setSeedError(null);
     seedPlaybook(datasetId);
   }, [datasetId, seedPlaybook]);
   ```

4. Add error state UI after the `isSeeding` block (around line 245):
   ```tsx
   {seedError && allPlaybooks.length === 0 && (
     <div className="flex flex-col items-center justify-center py-24 gap-4">
       <AlertCircle className="w-8 h-8 text-muted-foreground" />
       <p className="text-sm text-muted-foreground">{seedError}</p>
       <button onClick={retrySeed} className="...button styles...">
         Try again
       </button>
       <button onClick={() => { markDatasetSeeded(datasetId); setSeedError(null); }} className="text-xs text-muted-foreground underline">
         Skip — I'll create one manually
       </button>
     </div>
   )}
   ```

5. Clear `seedError` on successful seed (in the happy path, after `savePlaybook()`):
   ```typescript
   setSeedError(null);
   ```

### Files changed
- `src/app/playbooks/page.tsx` — add error state, retry, skip

---

## BEAD-002: Board-store race condition [HIGH]

### Problem
`SidebarProvider` → `useEffect` → `refreshBoards()` → `getBoardSummaries()` → `ensureInitialized()` → `apiFetch()` runs before `DatasetProvider` calls `setActiveDatasetId()`. The `_datasetId` module variable is still `""` when the first `apiFetch` fires.

### Fix

**File:** `src/lib/board-store.ts` — guard `ensureInitialized()` against empty datasetId

The `ensureInitialized` function (line 35) calls `apiFetch` for server hydration. Wrap the hydration call so it only fires when `_datasetId` is non-empty:

```typescript
// In ensureInitialized(), around the apiFetch call at line 97:
import { getActiveDatasetId } from "@/lib/api-client";

// Guard: skip server hydration if dataset not set yet
const currentDatasetId = getActiveDatasetId();
if (!currentDatasetId) {
  console.log("[board-store] init: skipping server hydration — datasetId not set yet");
  return;
}

apiFetch<...>("/api/boards", { skipModel: true })
  .then(...)
```

**File:** `src/lib/api-client.ts` — export a getter:

```typescript
export function getActiveDatasetId(): string {
  return _datasetId;
}
```

**File:** `src/components/sidebar-context.tsx` — re-trigger board refresh when dataset becomes available:

The `refreshBoards` callback (line 152) already depends on `currentDatasetId`. The `useEffect` at line 178-180 already re-runs when `refreshBoards` changes. So once `DatasetProvider` sets the active dataset and causes a re-render, `SidebarProvider` will re-run `refreshBoards()` with a valid `currentDatasetId`. The board-store will then see a non-empty dataset ID and proceed with server hydration.

**Alternative (simpler):** In `ensureInitialized()`, change the `apiFetch` call to use `skipDataset: true` and pass the dataset ID manually:

```typescript
apiFetch<...>("/api/boards", { skipModel: true, skipDataset: true })
```

This avoids the guard throw since `skipDataset` bypasses the `_datasetId` check. The `/api/boards` route may not need the dataset header if it returns all boards.

### Files changed
- `src/lib/board-store.ts` — guard or skipDataset on init hydration
- `src/lib/api-client.ts` — export `getActiveDatasetId()` (if guard approach)

---

## BEAD-003: Chat submit button unresponsive [HIGH]

### Problem
The send button's `disabled` prop at `src/components/chat/chat-input.tsx:413` checks `!value.trim()`. When gstack browse's `$B fill` sets the DOM input value, it may not trigger React's synthetic `onChange`, leaving the React state `value` as `""`.

### Fix

This is partially a test-infrastructure issue (Playwright `fill` should dispatch input events). However, the UX can be improved:

**File:** `src/components/chat/chat-input.tsx`

1. Add a visual hint for keyboard submission. After the send button (around line 413), or as a tooltip:
   ```tsx
   <Tooltip>
     <TooltipTrigger asChild>
       <button ... disabled={!value.trim() && !isProcessing && contextRefs.length === 0}>
         <ArrowUp ... />
       </button>
     </TooltipTrigger>
     <TooltipContent>Send message (Enter)</TooltipContent>
   </Tooltip>
   ```

2. The `disabled` logic itself is correct — the button should be disabled when there's no text. No code change needed for the disabled condition.

### Files changed
- `src/components/chat/chat-input.tsx` — add tooltip to send button (optional UX improvement)

### Note
This bead may not be a real user-facing bug — it's a headless browser interaction artifact. Real users type with keyboard (triggering `onChange`) and can press Enter to send. Demote to LOW if manual testing confirms the button works correctly with real keyboard input.

---

## BEAD-004: Mobile layout broken [HIGH]

### Problem
Sidebar renders at fixed 240px width with no responsive breakpoint. No hamburger menu, no auto-collapse on small viewports.

### Fix

**File:** `src/components/sidebar.tsx`

1. Add responsive auto-collapse. In the `useEffect` for collapsed state (around line 125):
   ```typescript
   useEffect(() => {
     const mql = window.matchMedia("(max-width: 768px)");
     const handleChange = (e: MediaQueryListEvent) => {
       if (e.matches) setCollapsed(true);
     };
     // Auto-collapse on initial load for mobile
     if (mql.matches) setCollapsed(true);
     mql.addEventListener("change", handleChange);
     return () => mql.removeEventListener("change", handleChange);
   }, []);
   ```

2. On mobile, the collapsed sidebar (56px rail) still takes space. For truly small viewports, hide it entirely and show a hamburger overlay:

   Add to the outer `<aside>` (line 266):
   ```tsx
   className="relative h-full shrink-0 border-r border-border bg-background transition-[width] duration-200 ease-out overflow-hidden max-md:absolute max-md:z-40 max-md:h-full"
   ```

   This makes the sidebar absolutely positioned on mobile so it overlays content instead of pushing it.

3. Add a mobile hamburger toggle. In `layout-shell.tsx`, add a topbar button visible only on mobile:
   ```tsx
   <button className="md:hidden fixed top-3 left-3 z-50 p-2 ..." onClick={toggleSidebar}>
     <Menu className="w-5 h-5" />
   </button>
   ```

4. Add a backdrop overlay when sidebar is open on mobile:
   ```tsx
   {!collapsed && (
     <div className="md:hidden fixed inset-0 bg-black/20 z-30" onClick={() => setCollapsed(true)} />
   )}
   ```

### Files changed
- `src/components/sidebar.tsx` — responsive auto-collapse, absolute positioning on mobile, backdrop
- `src/components/layout-shell.tsx` — hamburger toggle button (md:hidden)
- `src/components/sidebar-context.tsx` — may need to expose toggle method globally

---

## BEAD-005: Connector 400 errors + clipped logos [MEDIUM]

### Problem
1. Some `fivetran.com` and `cdn.brandfetch.io` logo URLs return 400
2. Next.js `Image` warnings about missing `width: "auto"` / `height: "auto"`
3. Logo text clipped by `overflow-hidden` container (ClickHouse, Singular, Kochava)

### Fix

**File:** `src/components/connectors/connector-logo.tsx`

1. Add `onError` fallback to `Image` — when external URL fails, show the Lucide icon fallback:
   ```tsx
   const [imgError, setImgError] = useState(false);

   {logoUrl && !imgError ? (
     <Image
       src={logoUrl}
       alt={name}
       width={size}
       height={size}
       style={{ width: "auto", height: "auto", maxWidth: size, maxHeight: size }}
       className="object-contain"
       onError={() => setImgError(true)}
     />
   ) : (
     <FallbackIcon ... />
   )}
   ```

2. Add `style={{ width: "auto", height: "auto" }}` to fix the Next.js warning.

**File:** `src/lib/connector-logos.ts`

3. Verify and update broken URLs. The `cdn.brandfetch.io` URLs (ClickHouse, Singular, Kochava, Unity Ads, CleverTap) are the likely 400 sources. Replace with working alternatives or remove them (the `onError` fallback handles missing logos gracefully).

**File:** `next.config.ts`

4. Add `cdn.brandfetch.io` to `remotePatterns` if keeping those URLs:
   ```typescript
   images: {
     remotePatterns: [
       { protocol: "https", hostname: "fivetran.com" },
       { protocol: "https", hostname: "cdn.brandfetch.io" },
     ],
   },
   ```

### Files changed
- `src/components/connectors/connector-logo.tsx` — onError fallback, auto dimensions
- `src/lib/connector-logos.ts` — update/remove broken URLs
- `next.config.ts` — add brandfetch.io to image domains

---

## BEAD-006: Metrics 14s load, no skeleton [MEDIUM]

### Problem (REVISED)
The metrics page DOES have a loading skeleton (lines 179-196 of `src/app/metrics/page.tsx`). The `loading` state is set to `true` initially and the skeleton renders when `loading===true`. The 14-second load is the API itself (`GET /api/metrics?datasetId=quickhelp` → 13,977ms).

**Why the skeleton might not have been visible during QA:** The gstack browse `$B goto` + `$B wait --networkidle` waits until the page is fully loaded (including the API response). By the time the screenshot was taken, loading was already complete. The skeleton IS there during the 14 seconds — just not captured by the testing methodology.

### Revised fix: API performance only

**File:** `src/app/api/metrics/route.ts`

The API runs `valueSql` and `timeSeriesSql` for all 30 metrics sequentially. Optimize:

1. **Parallelize SQL execution** — Run all 30 metric value queries in parallel using `Promise.all`:
   ```typescript
   const results = await Promise.all(
     definitions.map(async (def) => {
       const [valueResult, tsResult] = await Promise.all([
         executeSql(def.valueSql),
         executeSql(def.timeSeriesSql),
       ]);
       return { ...def, value: valueResult, timeSeries: tsResult };
     })
   );
   ```

2. **Add caching** — Cache metric results with a short TTL (e.g., 60s) since metric values don't change every request:
   ```typescript
   const CACHE_TTL = 60_000; // 60 seconds
   let cacheTimestamp = 0;
   let cachedResult: { metrics: Metric[]; hasDefinitions: boolean } | null = null;

   if (Date.now() - cacheTimestamp < CACHE_TTL && cachedResult) {
     return NextResponse.json(cachedResult);
   }
   ```

3. **Limit concurrent DuckDB queries** — Don't fire all 30 at once; use a semaphore (e.g., 5 concurrent max) to avoid overwhelming DuckDB memory:
   ```typescript
   import pLimit from "p-limit";
   const limit = pLimit(5);
   const results = await Promise.all(defs.map(d => limit(() => runMetricQuery(d))));
   ```

### Files changed
- `src/app/api/metrics/route.ts` — parallelize queries, add cache, limit concurrency

---

## BEAD-007: DOM growth / memory [MEDIUM]

### Problem
DOM nodes grow from 432 (home) to 1,143 (after navigating all pages) — 165% increase.

### Fix

This needs investigation rather than a blind fix. The most likely sources:

1. **Radix UI portals** — Tooltip, Popover, DropdownMenu portal containers may persist after navigation. Check with:
   ```typescript
   // In a useEffect cleanup in layout-shell.tsx or a debug util:
   document.querySelectorAll('[data-radix-portal]').length
   ```

2. **Toast region accumulation** — The Sonner toast container may accumulate dismissed toast DOM elements.

3. **Sidebar conversation list** — If conversation history grows across navigations without virtualization.

**Diagnostic step (before fixing):**
Add a development-only DOM counter to the layout:
```tsx
{process.env.NODE_ENV === "development" && (
  <div className="fixed bottom-1 right-1 text-[10px] text-muted-foreground/50 font-mono">
    DOM: {useDomCount()}
  </div>
)}
```

Where `useDomCount` is a hook that polls `document.querySelectorAll('*').length` every 2s.

**After diagnosis, likely fixes:**
- Ensure Radix portals clean up via `forceMount` + `AnimatePresence`
- Add `limit` to Sonner toaster: `<Toaster richColors position="top-right" toastOptions={{ duration: 4000 }} />`
- Virtualize long conversation lists in sidebar

### Files changed
- Diagnosis first — then targeted cleanup in portal/toast/sidebar components

---

## BEAD-008: Inconsistent empty states [LOW]

### Problem
Knowledge page has an exemplary empty state (icon + heading + description + CTAs). Decks page shows plain text.

### Fix

**File:** `src/app/decks/page.tsx` (around line 243)

Replace:
```tsx
No decks yet. Upload a PDF to get started.
```

With the Knowledge page pattern:
```tsx
<div className="flex flex-col items-center justify-center py-20 gap-4">
  <FileUp className="w-10 h-10 text-muted-foreground" />
  <div className="text-center">
    <p className="text-sm font-medium mb-1">No decks yet</p>
    <p className="text-sm text-muted-foreground max-w-sm">
      Upload a business review deck to reconstruct it with live data from your connected sources.
    </p>
  </div>
  <button onClick={...} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg">
    <Upload className="w-4 h-4" />
    Upload PDF
  </button>
</div>
```

### Files changed
- `src/app/decks/page.tsx` — replace plain text with structured empty state

---

## BEAD-009: Metric tree readability [LOW]

### Problem
Tree visualization too small at default zoom, no relationship labels, focus metric not highlighted in tree.

### Fix

This is a larger UX effort. Minimal fixes:

1. **Default zoom level** — If using React Flow or similar, set `defaultViewport` to fit all nodes with padding:
   ```tsx
   <ReactFlow defaultViewport={{ x: 0, y: 0, zoom: 0.8 }} fitView fitViewOptions={{ padding: 0.2 }} />
   ```

2. **Highlight focus metric** — Add a visual indicator (border, glow, or background color) to the focus metric node in the tree.

3. **Truncation in right panel** — Show full metric names on hover with a tooltip, or expand the panel width.

### Files changed
- `src/app/metric-tree/page.tsx` or the tree component — default zoom, highlight focus node
- Right panel component — add tooltips for truncated metric names

---

## BEAD-010: Aesthetic assessment (POSITIVE — no fix needed)

Design is CRAFTED (8/10). No action required.

---

## Priority Order

| Order | Bead | Effort | Risk |
|-------|------|--------|------|
| 1 | 001 — Playbooks error state | S (30 min) | Low — isolated to one page |
| 2 | 002 — Board-store race | S (20 min) | Low — guard or skipDataset flag |
| 3 | 004 — Mobile responsive | M (1 hr) | Medium — CSS + layout changes |
| 4 | 005 — Connector logos | S (20 min) | Low — onError fallback + config |
| 5 | 006 — Metrics API perf | M (45 min) | Medium — parallelization + cache |
| 6 | 008 — Empty states | S (15 min) | Low — copy-paste Knowledge pattern |
| 7 | 003 — Chat button | S (10 min) | Low — tooltip only |
| 8 | 007 — DOM growth | M (investigation) | Low — diagnostic first |
| 9 | 009 — Metric tree | L (design decision) | Low — default zoom + highlights |
