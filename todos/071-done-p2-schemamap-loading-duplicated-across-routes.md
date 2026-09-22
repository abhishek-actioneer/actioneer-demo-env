---
status: done
priority: p2
issue_id: "071"
tags: [code-review, architecture, duplication, pr-41]
dependencies: []
---

# SchemaMap loading logic duplicated across 3 generate routes

## Problem Statement

The exact same ~20-line SchemaMap resolution block (file → dataset config fallback → 404) is copy-pasted across three API routes:

1. `src/app/api/segments/generate-all/route.ts:29-53`
2. `src/app/api/knowledge/generate/route.ts:29-53`
3. `src/app/api/metrics/generate/route.ts` (likely similar)

Any fix to SchemaMap loading (e.g., new fallback paths, additional fields) must be applied to all three files, creating maintenance burden and drift risk.

## Findings

Both `segments/generate-all` and `knowledge/generate` contain identical code:
```typescript
const schemaMapPath = join(DATASETS_DIR, datasetId, "schema-map.json");
if (existsSync(schemaMapPath)) {
  schemaMap = JSON.parse(readFileSync(schemaMapPath, "utf-8"));
} else if (ds.schemaContext) {
  schemaMap = {
    columns: {},
    domain: ds.label,
    domainPersona: "",
    // ... 10 more fields
  };
} else {
  return Response.json({ error: "No schema data available..." }, { status: 404 });
}
```

The `DATASETS_DIR` constant is also duplicated in each file.

## Proposed Solutions

**Option A (Recommended): Extract `loadSchemaMap(datasetId)` utility**
- Create `src/lib/datasets/schema-loader.ts` exporting `loadSchemaMap(datasetId): SchemaMap | null`
- Returns null when no schema is available (let routes handle the 404 response)
- All generate routes import and use this single function
- Effort: Small | Risk: Low

**Option B: Add to dynamic-registry.ts**
- Since `dynamic-registry.ts` already loads schema maps during init, expose a `getSchemaMap(id)` function
- Effort: Small | Risk: Low (but changes existing module responsibilities)

## Recommended Action

Option A — clean extraction into a dedicated file.

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`, `src/app/api/knowledge/generate/route.ts`, `src/app/api/metrics/generate/route.ts`
- **New file:** `src/lib/datasets/schema-loader.ts`

## Acceptance Criteria

- [ ] Single `loadSchemaMap` function used by all generate routes
- [ ] `DATASETS_DIR` defined in one place
- [ ] No behavioral change to any route

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Three routes share identical schema resolution |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
