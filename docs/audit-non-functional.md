# Baby Sentinel — Non-Functional & Low-Confidence Audit

> Generated 2026-03-30. Comprehensive audit of hardcoded, mock, fake, broken, and fragile areas.

---

## 1. Completely Fake Features (No Real Backend)

### Scouts (`/scouts`)
- **Files:** `src/lib/scout-data.ts` (594 lines)
- 5 hardcoded scouts with pre-written reports containing fabricated findings
  - "Android monetization gap (13.9x lower conversion)"
  - "64 whale users = 85.8% revenue"
  - "ARPPU collapsed 90% Oct→Nov"
- Reports are sophisticated enough to appear authoritative — would mislead users
- No execution engine, no scheduling, no ability to create or run scouts
- `getScouts()` returns static array; `makeMessages()` generates fake conversation threads
- **Verdict:** Fully decorative. Zero backend functionality.

### Segment Push to Integrations
- **File:** `src/app/api/segments/[id]/push/route.ts`
- Implementation: `await new Promise((resolve) => setTimeout(resolve, 1500))` → returns `{ status: "synced" }`
- **Never calls** Clevertap, Firebase, BigQuery, or any external API
- UI shows "synced" status after fake 1.5s delay — completely misleading
- Segment creation and SQL querying are real; only the push is fake

### Connectors (`/connectors`)
- **File:** `src/lib/connector-data.ts` (32 lines)
- Hardcodes BigQuery and AppsFlyer as "connected" with fake timestamps ("7 days ago", "3 days ago")
- `isConnectorConnected(name)` checks against hardcoded list
- Status toggle writes to `sentinel_integrations` DB table but no actual platform integration exists
- "Invite a teammate" and "Join Slack" links are `href="#"` — go nowhere (`connectors/page.tsx:411,415`)

### Credit System — Tracks But Doesn't Gate
- **Files:** `src/lib/credit-store.ts`, `src/lib/credit-types.ts`
- Tracks balance, deductions, team usage in localStorage
- **Never prevents any operation** when credits reach 0
- Top-up "purchases" credit packs (Starter $10, Growth $40, Pro $70) with no payment processing
- 6 seed transactions with fake teams assigned via `Math.random()`:
  - "Revenue Team", "Growth Team", "Product Team", "Analytics Team"
- Default org: "Acme Corp" with 453 credits
- Credit costs defined but not enforced: deep=12, quick=3, direct=1

---

## 2. Hardcoded Mock Data Powering Real UI

### Store Module (`/store/*`) — 100% Mock
- **File:** `src/lib/store-data.ts` (1,048 lines)
- **MOCK_SKUS** (15 items): Game currency packs, cosmetics, battle passes with pricing and territory variations
- **MOCK_PLAYERS** (20): Fake accounts ("DragonSlayer99", "NovaBlade", "PixelWitch") with activity history
- **MOCK_TRANSACTIONS** (50): Fake purchases with `makeTx()` helper using `Math.random()` for IPs and timestamps
- **MOCK_STORE_KPIS**: Gross revenue $48,230, Transactions 1,247, ARPU $12.40, AOV $38.67, Refunds 23
- **MOCK_REVENUE_CHART** (30 days): `Math.sin()` for trend + `Math.random()` for noise
- **MOCK_OFFERS** (8): Campaigns with `dailyRevenue()` helper generating fake trends
- **MOCK_CAMPAIGNS** (3): "Spring Campaign", "Summer Expansion", "Holiday Rush"
- All 5 store pages (catalog, offers, transactions, players, KPIs) render this data
- `store-store.ts` initializes from these constants — no real data source
- **Would be immediately obvious** if user connects real payment/product data

### Pre-seeded Metrics
- **File:** `src/lib/metric-data.ts` (579 lines)
- 16 eCommerce metrics with synthetic time-series via `genSeries(base, variance)` using `Math.random()`
- Examples: DAU=147,500±12,000, Page Views=1,850,000±150,000, Cart Abandonment=67.8%±3%
- Period: Nov 1-16, 2019 (hardcoded dates)
- These seed the metric store on first load; real SQL-computed metrics exist alongside them
- Categories: Acquisition (3), Engagement (4), Revenue (6), Monetization (3)

### Pre-loaded Chat Conversations
- **File:** `src/lib/conversation-data.ts` (205 lines)
- 7 hardcoded conversations with pre-written Q&A:
  1. **funnel**: "2.36M views, 487K cart adds, 211K purchases, 79.4% never adding to cart"
  2. **revenue**: "Daily revenue $7.0-7.5M, AOV ~$534"
  3. **brands**: "Apple $24.8M, Samsung $18.2M"
  4. **retention**: "80% one-time buyers, repeat buyers contribute 45% revenue"
  5. **categories**: "Electronics 77% of revenue"
  6. **patterns**: "Peak 2PM-6PM"
  7. **ux-frozen**: Revenue segments with follow-up actions
- Appear in sidebar as if real prior analyses — all numbers fabricated
- **File:** `src/lib/chat-data.ts` (167 lines) — maps conversation IDs to preloaded data

### Segment Preview Users
- **File:** `src/components/segments/segment-detail-panel.tsx:50-59`
- 8 hardcoded mock users shown for any segment with ID starting `"mock-"`
- Disables refresh, push to integrations, and API calls when mock segment active
- Real segments show actual DuckDB query results

---

## 3. Non-Functional UI Elements

| Element | File:Line | Issue |
|---------|-----------|-------|
| "Share to Slack" button | `src/components/chat/response-footer.tsx:79` | `onClick={() => {}}` — does nothing |
| "Notifications" setting | `src/components/sidebar/user-panel.tsx:134` | "Coming soon" — `pointer-events-none`, `opacity-50` |
| "API Keys" setting | `src/components/sidebar/user-panel.tsx:141` | "Coming soon" — disabled, grayed out |
| "Notifications" (duplicate) | `src/components/settings/settings-panel.tsx:38` | Same "Coming soon" in settings panel |
| "API Keys" (duplicate) | `src/components/settings/settings-panel.tsx:46` | Same "Coming soon" in settings panel |
| "Help & Support" link | `src/components/sidebar/user-panel.tsx:154` | No onClick handler — dead button |
| "Help & Support" (duplicate) | `src/components/sidebar/panels.tsx:768` | Same pattern — no handler |
| "Push" in segment workspace | `src/components/segments/segment-workspace.tsx:269` | `{/* push flow */}` comment — stub handler |
| "Invite teammate" link | `src/app/connectors/page.tsx:411` | `href="#"` — goes nowhere |
| "Join Slack" link | `src/app/connectors/page.tsx:415` | `href="#"` — goes nowhere |
| Connector playbook message | `src/hooks/use-playbook-creation.ts:277` | Shows "Coming soon" placeholder in chat |

---

## 4. API Route Issues

### No Auth Middleware (All 80+ Routes Unprotected)
- `validTokens` set exists in `src/lib/auth.ts` and is populated by `/api/auth/login`
- **No middleware.ts exists** — no route validates session tokens
- All routes accept unauthenticated requests
- Hardcoded `USER_ID = "default"` on conversation routes — no multi-user support
  - `src/app/api/conversations/route.ts:3`
  - `src/app/api/conversations/[id]/beacon/route.ts:3`
  - `src/app/api/conversations/migrate/route.ts:3`

### Silent Failure Routes
| Route | Method | Issue |
|-------|--------|-------|
| `/api/boards/[id]/beacon` | POST | Always returns 204 even if DB write fails. Errors `console.error`'d and swallowed. |
| `/api/conversations/[id]/beacon` | POST | Same — always 204, errors swallowed. Sent via `sendBeacon` so user never knows. |
| `/api/recommend` | POST | Returns `{ actions: [] }` on ANY error — indistinguishable from "no recommendations" |
| `/api/complete` | POST | Returns `{ completions: [] }` on ANY error — looks like "no suggestions" |
| `/api/classify` | POST | Defaults to `{ mode: "analytics", metricId: null }` on failure — silently misroutes queries |

### SQL Injection Risk in Event Ingestion
- **File:** `src/app/api/ingest/route.ts:24-42`
- Uses string interpolation (`${...}`) in SQL INSERT instead of parameterized queries
- Naive escaping: `replace(/'/g, "''")`
- Should use `executeSQLPrepared()` with proper parameter binding

### Inconsistent Error Response Formats
- Some routes: `{ error: "..." }`
- Some routes: `{ message: "..." }`
- Some routes: `{ actions: [] }` (empty array implies success)
- Some routes: HTTP 204 with null body
- No standardized error contract

### No Rate Limiting
- All routes accept unlimited requests
- LLM endpoints (`/api/chat`, `/api/analyze`, `/api/classify`) could exhaust Gemini quota
- `/api/ingest` could be flooded with events
- `/api/datasets/upload` has file size limits (50MB) but no request rate limits

---

## 5. Data Store Fragility

### Data Loss on Version Bump (No Migration)
| Store | Version | localStorage Key |
|-------|---------|-----------------|
| `playbook-store` | v2 | `baby-sentinel-playbooks` |
| `conversation-store` | v2 | `baby-sentinel-conversations` |
| `board-store` | v13 | `baby-sentinel-boards` |
| `credit-store` | v2 | `baby-sentinel-credits` |
| `folder-store` | v1 | `baby-sentinel-folders` |

When `STORAGE_VERSION` changes, entire store is **wiped without migration**:
```typescript
if (storedVersion !== String(STORAGE_VERSION)) {
  localStorage.removeItem(STORAGE_KEY); // All data gone
}
```
If server is out of sync (offline edits, stale server), data is unrecoverable.

### In-Memory-Only Critical State (Lost on Page Refresh)
| Store | File | What's Lost |
|-------|------|-------------|
| `approval-store` | `src/lib/approval-store.ts` | All metric approval states — must re-approve everything. Uses `setTimeout(2500)` to simulate computation. |
| `metric-update-store` | `src/lib/metric-update-store.ts` | All pending metric definition changes |
| `explorer-store` | `src/lib/explorer-store.ts` | Active explorer configuration (event selections, filters, chart type) |
| `forecast-store` | `src/lib/forecast-store.ts` | Edited forecast models and seed data |

### sendBeacon Unreliability
- **Affected:** `board-store`, `playbook-store`, `conversation-store`
- Uses `navigator.sendBeacon()` with JSON Blob on page close
- **Silently fails** if payload > ~64KB (boards with 50+ cards can exceed this)
- No retry mechanism, no fallback to sync write
- Unreliable on mobile browsers (may be killed mid-flight)
- Blob size never validated before sending

### Race Conditions
| Store | Issue | Likelihood |
|-------|-------|------------|
| `board-store` | 5 Maps (`boardsMap`, `cardsMap`, `connectionsMap`, `framesMap`, `sectionsMap`) accessed concurrently without locks. `persistBoardCards()` reads from Map while another operation modifies it. | HIGH (multi-tab usage) |
| `conversation-store` | `ensureInitialized()` and `debouncedPatchOnServer()` can race during page load — debounced writes fire to empty/stale state. | MEDIUM |
| Dataset switch | `switchDataset()` doesn't clear global stores — stale playbooks/conversations from previous dataset remain visible. | MEDIUM |

### Server Sync Errors Swallowed
All stores catch server sync failures with `console.warn()` and continue:
```typescript
apiFetch(`/api/conversations/${id}`, { method: "PATCH", body: data })
  .catch((err) => {
    console.warn("[conversation-store] server patch failed:", err);
    // User thinks save succeeded. Next page load loses changes.
  });
```
Affected: `conversation-store`, `playbook-store`, `board-store`, `knowledge-store`, `metric-store`, `credit-store`

### localStorage Quota Overflow
- `board-store` serializes all boards + cards with nested chart data, uncompressed
- `MAX_PERSISTED_ROWS = 30` only caps row arrays, not object nesting depth
- **Quota math:** 20 boards x 50 cards x 2KB = 2MB minimum; chart specs push toward 5MB limit
- `QuotaExceededError` on next write requires manual cleanup

### Memory Leaks
- `playbook-store` and `board-store` register global event listeners (`beforeunload`, `visibilitychange`) at module load — never removed
- `approval-store`, `metric-update-store`: listener Sets grow without cleanup
- `conversation-store`: `serverDebounce` Map entries for deleted conversations never cleaned up

### Hydration Mismatch
- `dataset-context.tsx:62-70` reads localStorage during `useState` initializer
- Server returns `DEFAULT_DATASET`, client returns stored value → React hydration warning, potential UI flicker

---

## 6. Partially Functional Features

### Metric Tree — LLM-Inferred Dependencies
- **File:** `src/app/api/metrics/infer-relationships/route.ts`
- Relationships between metrics are inferred by Gemini, not derived from actual SQL lineage
- Not always accurate — tree structure can be misleading
- If no relationships inferred, tree renders flat
- Works but confidence in correctness is low

### Segment Explorer Tab — Missing Filter
- **File:** `src/components/segments/explore-tab.tsx:35`
- TODO: "inject segment.sql into all queries via segmentSQLs param"
- `onSegmentIdsChange={() => {}}` is a stub — segment filter not applied to explorer
- Explorer runs on full dataset, not scoped to selected segment

### Board Server Bulk Delete
- **File:** `src/lib/board-store.ts:788`
- `// TODO: server bulk delete cards`
- Cards deleted locally but not synced to server in bulk operations

---

## 7. Fully Functional Features (High Confidence)

For contrast, these work end-to-end with real data:

| Feature | Data Source | Confidence |
|---------|------------|------------|
| Analytics query flow (classify → SQL → DuckDB → Gemini → SSE) | Real DuckDB + Gemini | HIGH |
| Deep Research (6 parallel subagents + critique) | Real DuckDB + Gemini | HIGH |
| Analytics Explorer (trends, funnel, retention) | Real DuckDB queries | HIGH |
| Playbook execution (DAG-based SQL + LLM cells) | Real DuckDB + Gemini | HIGH |
| Board/Canvas cards (SQL execution, drill-down, refresh) | Real DuckDB queries | HIGH |
| Forecasting (seed from SQL, predict via Gemini) | Real DuckDB + Gemini | HIGH |
| Knowledge base (add, search, use in query context) | File-based + in-memory | HIGH |
| Event ingestion (`/api/ingest`) | Real DuckDB inserts | HIGH |
| Dataset upload + LLM enrichment | Real CSV → DuckDB → Gemini | HIGH |
| Segment creation (SQL gen → DuckDB count → save) | Real DuckDB + Gemini | HIGH |
| Conversation persistence (localStorage + server sync) | SQLite + localStorage | MEDIUM |

---

## 8. Summary — Priority Map

| Severity | Area | Impact |
|----------|------|--------|
| **Completely fake** | Scouts (5 hardcoded reports), Push integration (simulated delay), Credit gating (tracks but doesn't enforce) | Users misled into thinking features work |
| **All mock data** | Store module (5 pages, 1048 lines of fake data), Pre-loaded conversations (7 fabricated analyses), Pre-seeded metrics (16 synthetic time-series) | Obvious if real data connected |
| **Dead UI** | Slack share, Help & Support, Notifications, API Keys, connector invite/Slack links, segment push button | Broken user experience |
| **Security** | No auth middleware on 80+ routes, SQL injection in `/api/ingest`, hardcoded `USER_ID = "default"` | All data accessible without login |
| **Silent data loss** | Beacon saves failing silently, version wipes with no migration, server sync errors swallowed | User loses work without knowing |
| **Fragile state** | Board-store race conditions, localStorage quota overflow, in-memory approval/forecast state lost on refresh | Data corruption under normal usage |
| **Partial/incomplete** | Metric tree accuracy, segment explorer filter, board bulk delete sync | Features work but with gaps |
