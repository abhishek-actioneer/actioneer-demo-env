---
title: "Knowledge generation: entries saved server-side not visible in client UI (in-memory store split)"
problem_type: logic-error
component:
  - src/app/api/knowledge/generate/route.ts
  - src/app/knowledge/page.tsx
symptoms:
  - POST /api/knowledge/generate returns {count: 18, saved: true} but knowledge list remains empty
  - 404 on first generate for a dynamic dataset that hasn't been enriched yet
  - Generic "Generation failed. Please try again." even when server returns a descriptive error
tags:
  - knowledge-store
  - in-memory-store
  - client-server-split
  - dataset-enrichment
  - api-error-handling
related_files:
  - src/app/api/knowledge/generate/route.ts
  - src/app/knowledge/page.tsx
  - src/lib/knowledge-store.ts
  - src/lib/api-client.ts
  - src/lib/datasets/schema-enricher.ts
severity: high
---

## Symptoms

1. "Generate Starter Knowledge" completes without error. The network tab shows `{count: 18, saved: true}`. The knowledge list stays empty.
2. On a freshly uploaded dataset (never enriched), clicking generate returns a 404: `"No schema data available. Enrich the dataset first."`
3. When enrichment or generation fails for a real reason, the UI shows the generic fallback message instead of the actual error.

## Root Cause

Three separate bugs interacted:

### Bug 1 — Server/client in-memory store split

`knowledge-store.ts` is an in-memory `Map` with no persistence layer. In Next.js:

- API route handlers run in the **Node.js server process** — `saveKnowledgeEntry()` writes to the server's Map instance.
- `"use client"` components run in the **browser** — `getAllEntries()` reads from the browser's Map instance.

These are two completely separate runtime instances. A write on the server is invisible to a read in the browser. The original generate route called `saveKnowledgeEntry(datasetId, entry)` 18 times on the server, then returned `{ count: 18, saved: true }` — but the client's Map was untouched.

This pattern only works when both the write and the read happen on the same side. Manual adds (`handleAddEntry`) call `saveKnowledgeEntry` directly in the browser component — so they appear immediately. API-generated entries did not.

### Bug 2 — Missing auto-enrichment

`loadSchemaMap(datasetId)` returns `null` for a dataset that hasn't been through the enrich flow yet. The route guarded against this with an immediate 404. Dynamic datasets (user-uploaded) have all the data needed to enrich themselves — the route should recover automatically rather than pushing the user to a manual step.

### Bug 3 — Bare `catch {}` swallowed server errors

```typescript
// Before
} catch {
  setGenError("Generation failed. Please try again.");
}
```

`apiFetch` throws `ApiError` with `.status` and `.message` populated from the server response body. The bare catch discarded it.

## Solution

### 1. Return entries from the API; save them client-side

**`route.ts`** — include `entries` in the success response:

```typescript
return Response.json({ count: entries.length, saved: true, entries });
```

**`page.tsx`** — save the returned entries to the browser store, then bump `refreshKey`:

```typescript
const res = await apiFetch<{ count: number; saved: boolean; entries: KnowledgeEntry[] }>(
  "/api/knowledge/generate",
  { method: "POST", body: { datasetId } },
);
res.entries?.forEach((e) => saveKnowledgeEntry(datasetId, e));
setRefreshKey((k) => k + 1);
```

The `saveKnowledgeEntry` call now runs in the browser, writing to the same Map that `getAllEntries` reads from.

### 2. Auto-enrich dynamic datasets before generating knowledge

**`route.ts`** — replace the 404 guard with auto-enrichment:

```typescript
let schemaMap = loadSchemaMap(datasetId);

if (!schemaMap) {
  if (!ds.isDynamic) {
    return Response.json({ error: "No schema data available for this dataset." }, { status: 404 });
  }

  const datasetDir = join(DATASETS_DIR, datasetId);
  const dbPath = resolve(process.cwd(), ds.dbFile);

  if (!existsSync(dbPath)) {
    return Response.json(
      { error: "Dataset database file not found. Re-upload the dataset." },
      { status: 404 },
    );
  }

  const sourceFiles = ds.sourceFiles || [];
  const viewSQLStatements = sourceFiles.map((fileName) => {
    const tn = fileToTableName(fileName);
    return `CREATE OR REPLACE VIEW ${tn} AS SELECT * FROM read_csv('${join(datasetDir, fileName)}', auto_detect=true, ignore_errors=true)`;
  });
  const tables = sourceFiles.length > 0
    ? sourceFiles.map((f) => ({ tableName: fileToTableName(f), viewSQL: viewSQLStatements }))
    : [{ tableName: ds.primaryTable, viewSQL: viewSQLStatements }];

  schemaMap = await enrichDataset({ dbPath, datasetDir, tables, label: ds.label });

  ds.schemaContext = schemaMap.annotatedSchemaContext;
  ds.systemContext = buildEnrichedSystemContext(schemaMap, ds.label, 0);
  ds.domainHints = schemaMap.domainHints;
  ds.summaryTableHint = schemaMap.summaryTableHint;
  ds.multiAgentPrompt = schemaMap.multiAgentPrompt;
  ds.queryDescriptions = schemaMap.queryDescriptions;
  ds.agents = schemaMap.agents;
  ds.suggestedPrompts = schemaMap.suggestedPrompts;
  ds.welcomeSubtitle = schemaMap.welcomeSubtitle;
  saveDynamicDataset(ds);
  reloadDynamicDatasets();
}
// schemaMap is now guaranteed non-null; continue to knowledge generation
```

If `enrichDataset()` throws, the outer `catch` at the bottom of the handler catches it and returns a 500 with `err.message` — which the fixed client will now display.

### 3. Surface `ApiError.message` in the catch block

```typescript
} catch (err) {
  setGenError(err instanceof ApiError ? err.message : "Generation failed. Please try again.");
}
```

Import `ApiError` alongside `apiFetch`:

```typescript
import { apiFetch, ApiError } from "@/lib/api-client";
```

## Key Rule: When store mutations belong on each side

| Write location | Read location | Pattern | Works? |
|---|---|---|---|
| Browser (client component) | Browser (same component) | Direct store import | ✅ |
| Server (API route) | Server (same route) | Direct store import | ✅ |
| Server (API route) | Browser (client component) | API returns data → client saves to store | ✅ |
| Server (API route) | Browser (client component) | Client reads store after API write | ❌ separate instances |

**Rule of thumb:** If data originates on the server (AI-generated, computed, etc.), the API response must carry it back to the client. Never rely on the client reading the server's in-memory store.

## Prevention

**Code review checklist item:**
> After any `apiFetch` POST, does the UI update come from (a) React state set from the response body, or (b) a store read that assumes the server write is visible? If (b), flag it — the client and server stores are separate instances.

**Error handling rule:**
> Never use bare `catch {}` on `apiFetch` calls. Always check `err instanceof ApiError` and surface `.message`. The server puts the diagnostic detail in the message body; swallowing it turns a diagnosable failure into a mystery.

**Auto-enrichment rule:**
> API routes that depend on enriched schema data should attempt auto-enrichment on `null` schema rather than returning 404. The `!ds.isDynamic` guard ensures static datasets still fail fast if their baked-in schema is somehow missing.

## Related

- `src/app/api/datasets/[id]/enrich/route.ts` — canonical enrichment implementation this fix mirrors
- `src/lib/api-client.ts` — `ApiError` class with `.status` and `.message`
- `docs/plans/2026-03-16-fix-generate-segments-knowledge-422-plan.md` — related error surfacing fixes for segments
