# BEAD-013: /api/chart-requery missing validateDatasetId

**Severity:** LOW
**Category:** Consistency / Input Validation
**Page:** /api/chart-requery
**Ship-Readiness Impact:** INFO
**PR:** #48

---

## Summary

The `/api/chart-requery` endpoint reads the `x-dataset-id` header with a raw `.get()` fallback to `undefined`, skipping the `validateDatasetId()` format validation (`/^[a-z0-9-]+$/`, max 64 chars) that other API routes use.

## Root Cause

**File:** `src/app/api/chart-requery/route.ts` (line 74)

```typescript
const datasetId = req.headers.get("x-dataset-id") || undefined;
```

Compare with other routes (e.g., segments, boards):
```typescript
const datasetId = validateDatasetId(req.headers.get("x-dataset-id"));
```

## Risk

Low — `datasetId` is passed to `executeSQL()` which scopes queries by dataset. No direct SQL injection vector. But inconsistent validation across routes creates a maintenance risk.

## Fix

```typescript
import { validateDatasetId } from "@/lib/datasets";
// ...
const datasetId = validateDatasetId(req.headers.get("x-dataset-id"));
```
