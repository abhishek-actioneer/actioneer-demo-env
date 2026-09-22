# BEAD-002: Board-store hydration race condition on every page load

**Severity:** HIGH
**Category:** Dev/Infrastructure
**Page:** ALL pages (9/9)
**Ship-Readiness Impact:** SHIP_WITH_CONCERNS

---

## Summary

Every single page navigation triggers a warning: `apiFetch called before setActiveDatasetId() — DatasetProvider must mount first`. This is a race condition in the provider mount order where `SidebarProvider` calls `refreshBoards()` → `getBoardSummaries()` → `ensureInitialized()` → `apiFetch()` before `DatasetProvider` has finished mounting and calling `setActiveDatasetId()`.

The error is caught and logged as a warning — it doesn't crash the app — but it means board data never hydrates from the server on initial load. Every page load starts with stale or empty board state.

## Console Output (captured on every page)

```
[warning] [board-store] server hydration failed: Error: apiFetch called before 
setActiveDatasetId() — DatasetProvider must mount first
    at apiFetch (src_lib_b3e484a6._.js:56:15)
    at ensureInitialized (src_lib_b3e484a6._.js:1667:152)
    at getBoardSummaries (src_lib_b3e484a6._.js:2178:5)
    at SidebarProvider.useCallback[refreshBoards] (src_components_2875ca6b._.js:156:176)
    at SidebarProvider.useEffect (src_components_2875ca6b._.js:200:13)
```

Additionally on first load:
```
[warning] [board-store] version mismatch: stored="null" expected="6" — clearing storage
```

## Root Cause (source trace)

### Provider mount order
**File:** `src/components/layout-shell.tsx` (lines 23-38)

```tsx
<DatasetProvider>           // ← sets _datasetId on mount
  <ModelProvider>
    <SidebarProvider>       // ← useEffect calls refreshBoards() immediately
      <EntityCatalogProvider>  // ← useMemo calls buildEntityCatalog → getAllBoards → apiFetch
        <ChatStateProvider>
          <ChatPanelProvider>
```

### The guard that throws
**File:** `src/lib/api-client.ts` (line 87)

```typescript
if (!skipDataset && !_datasetId && !datasetId) {
  throw new Error("apiFetch called before setActiveDatasetId() — DatasetProvider must mount first");
}
```

`_datasetId` is a module-level variable initialized to `""`. It gets set by `setActiveDatasetId()` which is called by `DatasetProvider` on mount. But React mounts children's effects after the parent's render — so `SidebarProvider`'s `useEffect` fires before `DatasetProvider`'s `setActiveDatasetId()` has been invoked.

### Board-store ensureInitialized
**File:** `src/lib/board-store.ts` (line 35)

```typescript
function ensureInitialized() {
  // ... calls apiFetch to hydrate from server
}
```

`getBoardSummaries()` (line 651) calls `ensureInitialized()` which calls `apiFetch()` — but `_datasetId` is still `""` at this point.

## Evidence: Consistent across all pages

| Page | Warning Present | Board Data Loaded |
|------|----------------|-------------------|
| / | ✓ | ✗ (falls back to localStorage) |
| /metrics | ✓ | ✗ |
| /segments | ✓ | ✗ |
| /playbooks | ✓ | ✗ |
| /scouts | ✓ | ✗ |
| /knowledge | ✓ | ✗ |
| /decks | ✓ | ✗ |
| /connectors | ✓ | ✗ |
| /metric-tree | ✓ | ✗ |

## Impact

- Board data never hydrates from server on initial page load
- Falls back to localStorage (which may be empty or stale)
- 9 console warnings per session pollute developer logs
- Masks real errors in the noise
