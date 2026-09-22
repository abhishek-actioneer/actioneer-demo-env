---
title: "fix: Persist knowledge entries to DuckDB"
type: fix
date: 2026-03-16
---

# fix: Persist knowledge entries to DuckDB

## Problem

Knowledge entries are stored in a server-side in-memory `Map`. They are lost on every server restart, and are invisible to other browser sessions because the client and server each maintain separate Map instances.

## Approach

Add a `sentinel_knowledge` table to each dataset's DuckDB file, following the exact same pattern as `sentinel_segments`. The in-memory Map becomes a read cache populated from DuckDB on first use. All mutations write through to DuckDB.

The page stops calling the store directly; instead it fetches entries from a `GET /api/knowledge` route on mount and uses local React state for display.

---

## Changes

### 1. `src/lib/db.ts` — Create `sentinel_knowledge` table

Inside `ensureDatasetReady`, after the `sentinel_segments` block, add:

```typescript
// sentinel_knowledge table
await conn.run(`
  CREATE TABLE IF NOT EXISTS sentinel_knowledge (
    id          VARCHAR PRIMARY KEY,
    content     VARCHAR NOT NULL,
    level       VARCHAR NOT NULL,
    category    VARCHAR NOT NULL,
    priority    VARCHAR NOT NULL,
    source      VARCHAR NOT NULL,
    date_added  VARCHAR NOT NULL,
    added_by    VARCHAR NOT NULL,
    reference_thread       VARCHAR,
    source_conversation_id VARCHAR
  )
`);
```

Add `sentinel_knowledge` to the `SENTINEL_SYSTEM_TABLES` set.

Run `CHECKPOINT` after this block (it already runs at the end of `ensureDatasetReady` — confirm it covers this addition).

---

### 2. `src/lib/knowledge-store.ts` — Write-through to DuckDB

Make `saveKnowledgeEntry`, `updateKnowledgeEntry`, and `deleteKnowledgeEntry` async. Each function keeps its in-memory Map update and adds a `withConnection` call for DB persistence:

**`saveKnowledgeEntry`:**
```typescript
export async function saveKnowledgeEntry(datasetId: string, entry: KnowledgeEntry) {
  ensureInitialized(datasetId);
  stores.get(datasetId)!.set(entry.id, entry);
  invalidateCatalog();
  await withConnection(datasetId, async (conn) => {
    await conn.run(
      `INSERT OR REPLACE INTO sentinel_knowledge
        (id, content, level, category, priority, source, date_added, added_by,
         reference_thread, source_conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.content, entry.level, entry.category, entry.priority,
       entry.source, entry.dateAdded, entry.addedBy,
       entry.referenceThread ?? null, entry.sourceConversationId ?? null]
    );
  });
}
```

> **Note:** DuckDB's `node-api` supports `INSERT OR REPLACE` via the `ON CONFLICT` extension. If not, use `DELETE + INSERT` in a single `withConnection` call.

**`deleteKnowledgeEntry`:**
```typescript
export async function deleteKnowledgeEntry(datasetId: string, id: string) {
  ensureInitialized(datasetId);
  stores.get(datasetId)!.delete(id);
  invalidateCatalog();
  await withConnection(datasetId, async (conn) => {
    await conn.run(`DELETE FROM sentinel_knowledge WHERE id = ?`, [id]);
  });
}
```

**`updateKnowledgeEntry`:**
```typescript
export async function updateKnowledgeEntry(datasetId: string, id: string, updates: Partial<KnowledgeEntry>) {
  ensureInitialized(datasetId);
  const existing = stores.get(datasetId)!.get(id);
  if (!existing) return;
  const updated = { ...existing, ...updates };
  stores.get(datasetId)!.set(id, updated);
  invalidateCatalog();
  await withConnection(datasetId, async (conn) => {
    await conn.run(
      `UPDATE sentinel_knowledge SET content=?, level=?, category=?, priority=?,
        source=?, date_added=?, added_by=?, reference_thread=?, source_conversation_id=?
       WHERE id=?`,
      [updated.content, updated.level, updated.category, updated.priority,
       updated.source, updated.dateAdded, updated.addedBy,
       updated.referenceThread ?? null, updated.sourceConversationId ?? null,
       id]
    );
  });
}
```

---

### 3. `src/app/api/knowledge/route.ts` — New GET + POST route

**GET** — loads entries from DuckDB, hydrates in-memory store, returns entries:

```typescript
export async function GET(req: Request) {
  const datasetId = validateDatasetId(req.headers.get("x-dataset-id") ?? "");
  const entries = await withConnection(datasetId, async (conn) => {
    const result = await conn.run(`SELECT * FROM sentinel_knowledge ORDER BY date_added DESC`);
    return rowsToEntries(result); // map snake_case columns → KnowledgeEntry
  });
  return Response.json({ entries });
}
```

**POST** — add a single entry (moves server-side save logic out of the page):

```typescript
export async function POST(req: Request) {
  const datasetId = validateDatasetId(req.headers.get("x-dataset-id") ?? "");
  const entry: KnowledgeEntry = await req.json();
  await saveKnowledgeEntry(datasetId, entry);
  return Response.json({ entry });
}
```

---

### 4. `src/app/knowledge/page.tsx` — Fetch on mount, mutations via API

Replace direct store reads/writes with API calls:

- On mount: `apiFetch<{ entries: KnowledgeEntry[] }>("/api/knowledge")` → set React state
- `handleAddEntry`: `apiFetch("/api/knowledge", { method: "POST", body: entry })` → append to state
- `handleDelete`: `apiFetch("/api/knowledge/${id}", { method: "DELETE" })` → filter from state
- `handleEdit`: `apiFetch("/api/knowledge/${id}", { method: "PATCH", body: updates })` → update in state
- `handleGenerateAll`: already returns `entries` in response → `POST /api/knowledge` each one, or accept bulk `POST /api/knowledge/bulk`

Remove: `getAllEntries`, `saveKnowledgeEntry`, `deleteKnowledgeEntry`, `updateKnowledgeEntry` imports from the page. All client-side state is React state, not the store Map.

Keep `refreshKey` pattern or replace with direct state mutation after each API response.

---

### 5. `src/app/api/knowledge/[id]/route.ts` — PATCH + DELETE by id

```typescript
export async function DELETE(req, { params }) {
  const { id } = await params;
  const datasetId = validateDatasetId(req.headers.get("x-dataset-id") ?? "");
  await deleteKnowledgeEntry(datasetId, id);
  return Response.json({ deleted: true });
}

export async function PATCH(req, { params }) {
  const { id } = await params;
  const datasetId = validateDatasetId(req.headers.get("x-dataset-id") ?? "");
  const updates = await req.json();
  await updateKnowledgeEntry(datasetId, id, updates);
  return Response.json({ updated: true });
}
```

---

## Acceptance Criteria

- [ ] Knowledge entries survive a server restart — entries added before restart appear on reload
- [ ] Entries are visible in a new browser tab without re-generating
- [ ] Manual adds, edits, and deletes persist across restarts
- [ ] Auto-generated entries (from `/api/knowledge/generate`) persist
- [ ] Pre-seeded ecommerce entries load correctly on first init (INSERT OR REPLACE handles re-runs safely)
- [ ] No double-insert on concurrent first requests (idempotent on `id` primary key)
- [ ] Optional fields (`referenceThread`, `sourceConversationId`) stored as NULL, not empty string

## Key Constraints

- **`CREATE TABLE IF NOT EXISTS`** — safe to run on every startup, including existing deployments
- **Never `DEFAULT` in `ALTER TABLE ADD COLUMN`** — would crash WAL replay on Railway restart (not needed here since it's a new table)
- **`CHECKPOINT` after DDL** — already runs at the end of `ensureDatasetReady`; confirm it follows the new `CREATE TABLE`
- **`INSERT OR REPLACE`** — handles the re-seed scenario (pre-seeded entries keep user edits because a DELETE+INSERT roundtrip preserves the row; only runs if `id` conflicts)
- **`dateAdded` stored as VARCHAR** — avoids `TIMESTAMP` → JS `Date` type mismatch on read; keep as ISO string throughout

## References

- `src/lib/db.ts` — `ensureDatasetReady`, `withConnection`, `SENTINEL_SYSTEM_TABLES`
- `src/lib/knowledge-store.ts` — current in-memory implementation to extend
- `src/lib/knowledge-types.ts` — `KnowledgeEntry` type
- `docs/solutions/database-issues/duckdb-wal-replay-alter-table-default-crash.md` — DuckDB safety rules
- `docs/solutions/logic-errors/inmemory-store-api-generated-data-ui-rendering-split.md` — the split bug this fully resolves
