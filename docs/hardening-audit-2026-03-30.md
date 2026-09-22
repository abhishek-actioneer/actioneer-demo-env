# Baby Sentinel — Hardening Audit (2026-03-30)

> Full stability audit of non-functional, fragile, and broken areas. Ranked by severity.
> Context: This PR (`metrics-ux`) touches many pages, so all cross-cutting hardening goes here.
> Decision: Remove Store module. Keep everything else. No Clerk yet.

---

## Scope Decisions

- **Remove:** Store module (5 pages, 1048 lines mock data, all routes/components)
- **Keep as-is:** Scouts, Connectors, Credits, Pre-loaded conversations, Dead UI buttons
- **Fix:** All stability issues below

---

## Priority 1 — CRITICAL (breaks user trust / loses data silently)

### 1. `/api/classify` silent misroute
- **File:** `src/app/api/classify/route.ts:40-42`
- **Issue:** On any error (LLM failure, JSON parse), returns `{ mode: "analytics", metricId: null }` with status 200
- **Impact:** User's question goes to wrong pipeline. No indication anything went wrong. Single point of failure for entire chat flow.

### 2. sendBeacon silent data loss
- **Files:** `board-store.ts:383-396`, `playbook-store.ts:177-191`, `conversation-store.ts:474-493`
- **Issue:** All three stores use `navigator.sendBeacon()` on page close with no size validation. sendBeacon has ~64KB limit. Return value (boolean success) is ignored.
- **Impact:** Large boards (50+ cards with chart data) exceed limit. User closes tab thinking data is saved — it wasn't. No fallback, no retry.

### 3. Fire-and-forget server syncs (6 stores)
- **Files:** `conversation-store.ts:199`, `playbook-store.ts:114`, `board-store.ts:119`, `knowledge-store.ts`, `metric-store.ts`, `credit-store.ts`
- **Issue:** All stores patch server with `.catch((err) => console.warn(...))`. No retry, no user notification.
- **Impact:** User sees "saved" locally. Server never got it. Next refresh = data gone. User blames the product.

### 4. localStorage version wipe with no migration
- **Files:** All 5 localStorage-backed stores (boards v13, playbooks v2, conversations v2, credits v2, folders v1)
- **Issue:** When `STORAGE_VERSION` changes: `localStorage.removeItem(STORAGE_KEY)` — all data deleted.
- **Impact:** Any code change that bumps version = total data loss for that store. No migration path, no warning.

---

## Priority 2 — HIGH (corrupts state / security)

### 5. SQL injection in `/api/ingest`
- **File:** `src/app/api/ingest/route.ts:24-42`
- **Issue:** String interpolation in SQL INSERT with naive `replace(/'/g, "''")` escaping
- **Fix:** Use parameterized queries via `conn.prepare()`

### 6. In-memory state lost on refresh
- **Files:** `approval-store.ts` (approval states), `metric-update-store.ts` (pending updates), `explorer-store.ts` (active config)
- **Issue:** 100% in-memory, zero persistence. `approval-store` uses `setTimeout(2500)` to simulate computation.
- **Impact:** User approves 10 metrics, refreshes page, all gone.

### 7. Board store race conditions
- **File:** `board-store.ts`
- **Issue:** 5 Maps (`boardsMap`, `cardsMap`, `connectionsMap`, `framesMap`, `sectionsMap`) accessed concurrently without locks. `persistBoardCards()` reads while another op writes.
- **Impact:** Multi-tab usage can corrupt board data.

### 8. Dataset switch state bleed
- **Files:** `metric-store.ts:4-16`, `knowledge-store.ts:4-17`
- **Issue:** Dataset-scoped Maps grow unbounded across switches. No cleanup on `notifyDatasetSwitch()`.
- **Impact:** Stale data from previous dataset remains in memory, can surface.

### 9. Hydration mismatch
- **File:** `dataset-context.tsx:62-70`
- **Issue:** Reads localStorage in `useState` initializer. SSR returns `DEFAULT_DATASET`, client returns stored value.
- **Impact:** React hydration warning, potential UI flicker, wrong dataset on first render.

---

## Priority 3 — MEDIUM (degrades experience / masks problems)

### 10. Silent failure routes
- `/api/recommend` → `{ actions: [] }` on error (looks like "no recommendations")
- `/api/complete` → `{ completions: [] }` on error (looks like "no suggestions")
- `/api/datasets/[id]/prompts` → fallback prompts on error

### 11. Beacon routes always 204
- `/api/boards/[id]/beacon`, `/api/conversations/[id]/beacon` — DB write fails, returns 204 anyway

### 12. localStorage quota overflow
- `board-store` async persist has no quota handling (sync version does). Silent failure.

### 13. Conversation debounce vs unload race
- Pending debounced write may not fire on tab close. sendBeacon sends stale data.

### 14. Inconsistent error response formats
- No standard contract across routes. `{ error }` vs `{ actions: [] }` vs 204.

---

## Priority 4 — LOW (code quality / future concerns)

### 15. Memory leaks
- Event listeners in board/playbook stores never removed
- Listener Sets grow unbounded in approval/metric-update stores
- Conversation debounce Map entries for deleted convos never pruned

### 16. 3 raw `fetch()` calls bypassing `apiFetch`
- `sidebar/panels.tsx:651`, `dataset-upload-modal.tsx:97`, `use-deck-upload-to-board.ts:86`

### 17. Excessive `console.log` in production paths
- 30+ statements across playbooks page (17), chat-thread (9), playbook-canvas (4)

### 18. Hardcoded `USER_ID = "default"`
- 4 conversation routes. Matters when Clerk arrives, not before.

### 19. No rate limiting
- All routes, especially LLM endpoints that could exhaust Gemini quota.

### 20. 2 remaining TODOs
- `board-store.ts:788` — server bulk delete cards
- `explore-tab.tsx:35` — segment SQL injection into explorer queries

---

## API Route Audit Summary

| Issue | Count | Routes |
|---|---|---|
| Silent error → fake success | 6 | classify, recommend, complete, prompts, board beacon, convo beacon |
| Missing input validation | 3 | playbook/run, ingest, enrich |
| SQL injection | 1 | ingest |
| Hardcoded USER_ID | 4 | conversations/* |
| 200 on failure | 4 | classify, recommend, explorer, explorer/funnel |
| No pagination | 2 | conversations, datasets |
| Inconsistent error format | 20+ | Most routes |

## Store Audit Summary

| Store | localStorage | Server sync | sendBeacon | Version wipe | Memory leak |
|---|---|---|---|---|---|
| board-store | v13 | fire-and-forget | yes, no size check | yes | yes (listeners) |
| playbook-store | v2 | fire-and-forget | yes, no size check | yes | yes (listeners) |
| conversation-store | v2 | fire-and-forget | yes, no size check | yes | yes (debounce Map) |
| credit-store | v2 | fire-and-forget | no | yes | no |
| folder-store | v1 | no server sync | no | yes | no |
| approval-store | none | none | none | n/a | yes (listener Set) |
| metric-update-store | none | none | none | n/a | yes (listener Set) |
| explorer-store | none | none | none | n/a | yes (listener Set) |
| metric-store | none (server) | fire-and-forget | no | n/a | unbounded Map |
| knowledge-store | none (server) | fire-and-forget | no | n/a | unbounded Map |
