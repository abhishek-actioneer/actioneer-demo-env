# Segments & Explore Architecture

## Segment Data Model

**Core type** (`src/lib/types.ts:45-54`):
```typescript
interface Segment {
  id: string; name: string; sql: string; description?: string;
  userCount: number; createdAt: string;
  sourceConversationId?: string;  // null = auto-generated, set = from chat
  pushStatus: Record<string, "idle" | "pushing" | "synced" | "error">;
}
```

Stored in **SQLite** (`src/lib/meta-db.ts:103-118`) with `user_id` + `dataset_id` scoping. Extended to `SegmentDisplay` for UI with behavioral traits, trend data, refresh status, similar segments.

## Segment Creation — 3 Entry Points

### 1. Chat-Based Creation
```
User asks "create a segment of high-value users"
  → use-action-handlers.ts classifies as "create-segment"
  → POST /api/segments/generate-sql { description }
    → buildSegmentSqlPrompt() + Gemini generates SQL
  → POST /api/segments/count { sql } → live user count
  → Renders SegmentConfirmCard in chat thread
    States: ready → confirming → confirmed/error
    User can: edit name, view SQL, refine (regenerate), confirm, cancel
  → On confirm: POST /api/segments { name, sql, sourceConversationId }
    → SQL validated by wrapping in SELECT * FROM (...) LIMIT 1
    → COUNT(*) for real user count
    → Stored in SQLite
  → refreshSegments() updates sidebar
```

### 2. UI Modal (CreateSegmentModal)
Two tabs:
- **"Describe" tab**: textarea → "Generate SQL" → `POST /api/segments/generate-sql` → shows SQL + live count
- **"SQL" tab**: direct SQL input with debounced (1000ms) count fetching as you type

### 3. Bulk Auto-Generation (when no segments exist)
`POST /api/segments/generate-all`:
1. Load schema — dataset config, schema map, userIdField
2. LLM prompt asks Gemini for 8-12 segments covering acquisition, activation, retention, monetization, risk
3. Pre-validation: each candidate SQL is executed against DuckDB. Failed SQL dropped. Valid SQL gets real COUNT.
4. Clears old auto-generated segments (sourceConversationId is null)
5. Inserts validated segments

## Segment Workspace (`/segments/[id]`) — 3 Tabs

### Tab 1: Overview
- Size-Over-Time chart via `POST /api/segments/{id}/overview`
- vs All Users comparison, trend over time
- Segment overlap via `POST /api/segments/{id}/overlap`
- "Explore Events" button → slides in explorer panel (340px)

### Tab 2: Composition
`POST /api/segments/{id}/composition` auto-discovers breakdowns:
1. Queries information_schema.columns for VARCHAR columns
2. Samples 5000 segment users, computes COUNT(DISTINCT col)
3. Classifies: user-level (ratio < 0.01 OR count ≤ 20), event-level (20-50), skipped (>50 or constants)
4. Returns up to 6 properties with top 20 values each

### Tab 3: Users
Paginated user listing with sort, search, column filtering via `POST /api/segments/{id}/users`.

## API Surface

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/segments` | List all for user+dataset |
| POST | `/api/segments` | Create (validates SQL) |
| GET | `/api/segments/:id` | Get + fresh count + preview |
| PATCH | `/api/segments/:id` | Update name/sql/description |
| DELETE | `/api/segments/:id` | Delete |
| POST | `/api/segments/:id/users` | Paginated user table |
| POST | `/api/segments/:id/users/distinct` | Distinct values for filters |
| POST | `/api/segments/:id/composition` | Auto-discovered breakdowns |
| POST | `/api/segments/:id/movement` | Inflow/outflow |
| POST | `/api/segments/:id/overlap` | Overlap analysis |
| POST | `/api/segments/:id/overview` | Growth + size over time |
| POST | `/api/segments/:id/push` | Push to integration |
| POST | `/api/segments/count` | Count users |
| POST | `/api/segments/generate-sql` | LLM generates SQL from description |
| POST | `/api/segments/generate-all` | Bulk generation |

## Events & Breakdowns — The Gap

### How Events Work
`DatasetConfig.events` is **optional** (`events?: EventDefinition[]`). Events are only defined for handcrafted sample datasets:

| Dataset | Events | Count |
|---------|--------|-------|
| quickhelp | Yes | ~30 |
| gameramp | Yes | 3 |
| alpha | Yes | 3 |
| vastu-hfc | Yes | 25 |
| **Any uploaded dataset** | **No** | **undefined → []** |

### Why Events Are Missing on Uploaded Datasets

Schema enrichment (`schema-enricher.ts`) generates agents, prompts, metrics, domain hints — but **never generates events**. The dynamic registry overlay merges enriched fields but skips `events`. So `dataset.events` is always `undefined` for uploaded datasets.

### The Effect in Segment Workspace

```typescript
// segment-workspace.tsx:77
const eventCatalog = useMemo(() => dataset?.events ?? [], [dataset]);
```

When events is undefined → eventCatalog = [] → ExplorerConfigPanel gets empty catalog:
- "Add Event" button never renders (guarded by `availableEvents.length > 0`)
- User sees only "Select an event to start exploring" with nothing to select
- No events → no properties → breakdown section never renders
- The "Explore Events" button in Overview is effectively dead for uploaded datasets

### Segment SQL ↔ Explorer Integration

In segment workspace, segment SQL is injected as WHERE filter:
```typescript
// explorer-sql.ts:179-183
for (const segSQL of segmentSQLs) {
  conditions.push(`${quoteIdent(userIdField)} IN (${segSQL})`);
}
```

Note: standalone `/explore` page does NOT inject segment SQL yet (TODO in code).
