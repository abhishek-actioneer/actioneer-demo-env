# Adding a New Entity Type: {EntityName}

Follow this checklist when adding a new entity type (like segments, playbooks, metrics, knowledge entries).

## Files to create

### 1. Type definitions — `src/lib/{entity}-types.ts`
```typescript
export interface {Entity} {
  id: string;
  name: string;
  // ... entity-specific fields
}
```

### 2. Store — `src/lib/{entity}-store.ts`
Follow the existing store pattern (Map + invalidateCatalog):
```typescript
import { invalidateCatalog } from "./catalog-invalidation";
import type { {Entity} } from "./{entity}-types";

const items = new Map<string, {Entity}>();

export function get{Entity}(id: string): {Entity} | undefined {
  return items.get(id);
}

export function getAll{Entities}(): {Entity}[] {
  return Array.from(items.values());
}

export function save{Entity}(item: {Entity}): boolean {
  items.set(item.id, item);
  invalidateCatalog(); // Required — triggers @ picker rebuild
  return true;
}

export function delete{Entity}(id: string): boolean {
  const result = items.delete(id);
  if (result) invalidateCatalog();
  return result;
}
```

### 3. API routes — `src/app/api/{entities}/route.ts`
```typescript
// GET: list all, POST: create
// Always read x-dataset-id from headers:
const datasetId = req.headers.get("x-dataset-id") || "ecommerce";
```

### 4. API detail route — `src/app/api/{entities}/[id]/route.ts`
```typescript
// GET: single, PATCH: update, DELETE: remove
```

## Files to modify

### 5. Entity type union — `src/lib/entity-types.ts`
Add `"{entity}"` to the `EntityType` type union.

### 6. Entity registry — `src/lib/entity-registry.ts`
Add entries to `buildEntityCatalog()`:
```typescript
// In buildEntityCatalog():
const {entities} = getAll{Entities}();
for (const item of {entities}) {
  catalog.push({
    id: item.id,
    type: "{entity}",
    name: item.name,
    description: "...",
    route: "/{entities}/" + item.id,
    contextPayload: { /* rich context for @ picker */ },
  });
}
```

### 7. Entity context — `src/lib/entity-context.ts`
Add a case to `buildPageEntityContext()` for the new type, providing both `sqlContext` (for SQL generation) and `synthesisContext` (for response synthesis).

### 8. Context picker — `src/components/chat/context-picker.tsx`
Add a category to `CATEGORIES` array so the entity appears in the @ picker.

### 9. Page context — `src/lib/page-context.ts`
Add route mapping so the page label is detected.

### 10. List page — `src/app/{entities}/page.tsx`
Must call `setEntity()` from `useChatPanel()` to inject context into sidebar chat:
```typescript
const { setEntity } = useChatPanel();
useEffect(() => {
  setEntity({
    id: "{entities}-list",
    name: "{Entities}",
    type: "{entities}-list",
    summary: `${items.length} {entities}`,
    contextPayload: { /* catalog data */ },
  });
}, [items, setEntity]);
```

### 11. Detail page — `src/app/{entities}/[id]/page.tsx`
Same pattern as list page, but for single entity context.

## API call convention

**All frontend→backend calls MUST use `apiFetch`** from `src/lib/api-client.ts`. Never use raw `fetch("/api/...")`. This auto-injects `x-dataset-id` and `x-model-id` headers.

## Verification checklist

- [ ] Entity appears in @ picker with correct category
- [ ] Entity context is rich (contextPayload includes all relevant fields)
- [ ] Page-level sidebar chat injects correct context via `setEntity()`
- [ ] Store mutations call `invalidateCatalog()`
- [ ] API routes read `x-dataset-id` from request headers
- [ ] All API calls use `apiFetch` (not raw `fetch`)
- [ ] Creating/deleting entity updates @ picker without page refresh
