# Critic Review — Fix Plan Gaps & Corrections

## Gaps Found

### BEAD-001: Infinite retry loop risk ⚠️

**The plan says:** Remove `markDatasetSeeded()` from the catch block to allow retry.

**The critic says:** This creates an infinite retry loop. The auto-seed `useEffect` (line 159-164) checks `!isDatasetSeeded(datasetId) && !isSeeding`. If `markDatasetSeeded` is never called on error, and `isSeeding` becomes `false` in `finally`, the `useEffect` will re-fire immediately — calling `seedPlaybook()` again — which will fail again — in an infinite loop.

**Correction:** Keep `markDatasetSeeded()` in the catch block (prevents auto-retry loop). Instead, the retry button should call a modified version that temporarily un-marks the dataset:

```typescript
const retrySeed = useCallback(() => {
  setSeedError(null);
  // Reset seeded flag so seedPlaybook can run
  // (markDatasetSeeded will be called again on success or failure)
  resetDatasetSeeded(datasetId);  // ← new function needed in playbook-store
  seedPlaybook(datasetId);
}, [datasetId, seedPlaybook]);
```

Add `resetDatasetSeeded` to `src/lib/playbook-store.ts`:
```typescript
export function resetDatasetSeeded(datasetId: string) {
  seededDatasets.delete(datasetId);
}
```

**Alternatively (simpler):** Don't touch `markDatasetSeeded` at all. Just have the retry button call `seedPlaybook()` directly (which ignores the seeded flag since it's invoked manually, not from the useEffect guard).

### BEAD-002: `/api/boards` requires `x-dataset-id` header ⚠️

**The plan says (alternative):** Use `skipDataset: true` to bypass the dataset check.

**The critic says:** This won't work. The `/api/boards` route at line 4-5 explicitly requires the `x-dataset-id` header:
```typescript
const datasetId = req.headers.get("x-dataset-id");
if (!datasetId) return Response.json({ error: "x-dataset-id required" }, { status: 400 });
```

So `skipDataset: true` would send the request without the header → 400 error → hydration still fails.

**Correction:** The guard approach is the correct one. In `ensureInitialized()`, check `getActiveDatasetId()` before calling `apiFetch`. If empty, set `initialized = false` so it retries on the next call (when the dataset is available):

```typescript
function ensureInitialized() {
  // ... version check logic stays the same ...
  
  if (initialized) return;
  
  // localStorage restore stays the same...
  
  // Guard: only attempt server hydration if dataset is set
  const activeDatasetId = getActiveDatasetId();
  if (!activeDatasetId) {
    // Mark as initialized for localStorage, but skip server hydration
    // SidebarProvider will re-call getBoardSummaries when dataset changes,
    // triggering a re-init with valid dataset
    initialized = true;  // prevent repeated localStorage parsing
    return;
  }
  
  initialized = true;
  
  // Server hydration (existing apiFetch call)
  apiFetch<...>("/api/boards", { skipModel: true })
    .then(...)
```

But wait — `initialized` is set to `true` even without server hydration. The next call to `getBoardSummaries` (when dataset IS set) will short-circuit at `if (initialized) return`. This means boards never hydrate from server on the second call.

**Better correction:** Split `initialized` into two flags: `localStorageLoaded` and `serverHydrated`. Or: add a separate `hydrateFromServer(datasetId)` function that `SidebarProvider` calls explicitly after dataset is known:

```typescript
// board-store.ts
export function hydrateFromServer() {
  const dsId = getActiveDatasetId();
  if (!dsId || serverHydrated) return;
  serverHydrated = true;
  apiFetch<...>("/api/boards", { skipModel: true }).then(...);
}
```

```typescript
// sidebar-context.tsx — call after dataset is available
useEffect(() => {
  if (currentDatasetId) hydrateFromServer();
}, [currentDatasetId]);
```

### BEAD-003: Re-classify as test artifact, not user-facing bug ✓

**The critic agrees** with the plan's note. The send button works correctly for real users (keyboard onChange → React state update → button enables). The `$B fill` command uses Playwright's fill which should dispatch input events, but may not trigger React 19's synthetic event system. This is a **test infrastructure gap**, not a product bug.

**Recommendation:** Demote from HIGH to LOW. Add a tooltip as UX polish.

### BEAD-004: Mobile hamburger needs sidebar context exposure ⚠️

**The plan says:** Add hamburger toggle in `layout-shell.tsx`.

**The critic says:** `layout-shell.tsx` doesn't have access to the sidebar collapsed state. The `collapsed` state lives inside `sidebar.tsx` as local state (line 94). The `SidebarProvider` context does expose `sidebarCollapsed` and `setSidebarCollapsed`, but `layout-shell.tsx` would need to consume that context.

**Correction:** The hamburger button should go inside `sidebar.tsx` itself (it already has access to `collapsed`/`setCollapsed`) or inside a new `MobileHeader` component that consumes `useSidebarContext()`. The layout-shell approach requires plumbing context which is already available.

Better: Put the hamburger inside `sidebar.tsx` as a fixed-position button visible only on mobile, placed where the sidebar expand button currently is.

### BEAD-006: Metrics already has caching + Promise.all ⚠️

**The plan says:** Add caching and parallelize queries.

**The critic says:** Both are already implemented:
- `Promise.all(definitions.map(...))` at line 171
- In-memory cache with `CACHE_TTL_MS` + stale-while-revalidate pattern at lines 137-170
- Background recompute at line 121

The 14-second load is the **cold-start first request** (no cache exists). Subsequent loads hit cache and return instantly.

**Correction:** The fix should focus on:
1. **Pre-warming the cache** — call `/api/metrics?datasetId=quickhelp` on server startup or first login, so the cache is warm by the time the user navigates to /metrics
2. **Limiting concurrent DuckDB queries** — the `Promise.all` fires 30×2=60 queries simultaneously. Adding `p-limit(5)` would reduce DuckDB memory pressure and may actually be faster (less contention)
3. **Or: accept the cold start** — subsequent loads are fast. This is a first-visit-only problem.

### BEAD-005: Missing `next.config.ts` image domain check ✓

The plan correctly identifies that `cdn.brandfetch.io` is missing from `remotePatterns`. However, the 400 errors might be from `fivetran.com` URL changes, not the brandfetch domain. Need to verify which specific URLs return 400 before deciding which to update vs remove.

### BEAD-007: DOM growth — plan is appropriately cautious ✓

The plan correctly calls for investigation before fixing. No correction needed.

### BEAD-008 & 009: Plans are straightforward ✓

No gaps found.

---

## Decisions to Escalate

### 1. BEAD-001: Retry strategy
**Options:**
- **A)** Unlimited manual retry (user clicks "Try again" each time) + "Skip" button
- **B)** Auto-retry 3x with exponential backoff, then show error with "Try again" + "Skip"
- **C)** Remove auto-seed entirely — just show an empty state with "New Playbook" button (the seed feature is a convenience, not a requirement)

**My recommendation:** C — the auto-seed is a nice-to-have that's causing a critical bug. The simplest fix is to remove it and show a proper empty state. Users can create playbooks manually.

### 2. BEAD-002: Fix approach
**Options:**
- **A)** Split `initialized` into `localStorageLoaded` + `serverHydrated`, add explicit `hydrateFromServer()` call in sidebar-context — clean but more code
- **B)** Catch the error silently in `ensureInitialized` (wrap the `apiFetch` call in a try/catch that swallows the "datasetId not set" error) — hacky but minimal diff
- **C)** Change `_datasetId` initial value from `""` to `DEFAULT_DATASET` in `api-client.ts` — fixes the race but means the first request always uses the default dataset even if the user's stored preference is different

**My recommendation:** A — it's the cleanest. The split is small (one boolean to two), and the explicit `hydrateFromServer()` call makes the dependency on dataset clear.

### 3. BEAD-004: Scope of mobile fix
**Options:**
- **A)** Full responsive implementation: hamburger menu, overlay sidebar, touch-optimized navigation, responsive content areas on all pages — estimated M/L effort
- **B)** Auto-collapse to rail (56px) on mobile, no hamburger — minimal effort but rail still takes space on 375px screens
- **C)** Simply hide sidebar entirely on mobile with a toggle — fastest, covers 80% of the issue

**My recommendation:** This depends on whether mobile is a priority for this demo app. If yes → A. If it's desktop-focused → B is sufficient.

### 4. BEAD-006: Cold-start strategy
**Options:**
- **A)** Pre-warm cache on login — adds a background fetch that runs after successful auth
- **B)** Add `p-limit(5)` concurrency limiter to DuckDB queries — may reduce cold-start from 14s to ~5s
- **C)** Accept 14s cold start — the skeleton is already there, subsequent loads are instant
- **D)** A + B

**My recommendation:** B alone. The concurrency limiter is a one-line change (`p-limit`) that benefits all metric queries, not just cold start. Pre-warming adds complexity for a one-time benefit.
