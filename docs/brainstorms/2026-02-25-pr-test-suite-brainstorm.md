# Brainstorm: Comprehensive PR Test Suite

**Date:** 2026-02-25
**Status:** Complete → ready for planning

---

## What We're Building

A full automated test suite that gates every PR before it merges to `main`. Zero tests exist today — this establishes the foundation from scratch using a single framework (Playwright) organized into three independent test projects.

**Goal:** No PR can introduce a regression in API behavior, user flows, or non-targeted UI without it being caught automatically.

---

## Why This Approach

**Playwright for everything** — one framework, one config, three named projects:

| Project | What it tests | CI behavior |
|---|---|---|
| `api` | All 28 API routes via HTTP | Blocking — PR fails if any test fails |
| `e2e` | Full browser user flows | Blocking — PR fails if any test fails |
| `visual` | Screenshot diffs of stable pages | Non-blocking — flags differences but doesn't block merge; bypass with PR label |

Single-framework simplicity beats the Vitest+Playwright alternative. Playwright can make real HTTP requests (`request` context) with less ceremony than Vitest for a Next.js app. The team already has zero testing infrastructure — one tool is far easier to onboard.

**Real Gemini API calls** — no mocking. Tests reflect actual system behavior. Gemini responses are non-deterministic so assertions check structure/shape, not exact content.

---

## Test Coverage Map

### API Project (`tests/api/`)

**Auth**
- `POST /api/auth/login` — valid password → session cookie; wrong password → 401; missing body → 400

**Health**
- `GET /api/health` — always 200, no auth required

**Core analytics flow**
- `POST /api/classify` — returns `{ type: "analytics" | "direct" }` for sample queries
- `POST /api/analyze` — streaming NDJSON; assert event sequence (`phase` → `sql` → `query_result` → `text` → `done`); quick mode returns fewer events than deep mode
- `POST /api/chat` — streaming text response; assert non-empty content
- `POST /api/query` — valid SELECT succeeds; non-SELECT returns 400; DDL keywords blocked

**Segments**
- `GET /api/segments` — returns array
- `POST /api/segments` — create with valid SQL; assert segment in subsequent GET
- `GET /api/segments/[id]` — returns count + preview rows
- `PATCH /api/segments/[id]` — update name; assert change persists
- `DELETE /api/segments/[id]` — assert 404 on subsequent GET
- `POST /api/segments/generate-sql` — returns valid SQL string

**Datasets**
- `GET /api/datasets` — returns default ecommerce dataset
- `POST /api/datasets/upload` — upload small CSV; assert dataset appears in list

**Playbooks**
- `POST /api/playbook/create` — streaming; assert `outline` and `detail` events emitted
- `POST /api/playbook/validate` — valid SQL → passes; invalid SQL → returns error

**Forecasting**
- `POST /api/forecast/seed` — seeds metrics; assert success
- `POST /api/forecast/predict` — returns forecast object with weeks array

**Schema**
- `GET /api/schema/tables` — returns at least one table entry
- `POST /api/schema/tables` — valid query → passes; invalid query → error

**Knowledge**
- `POST /api/knowledge/add` — returns categorised entry
- `POST /api/knowledge/fetch-url` — fetches and returns content

**Integrations**
- `GET /api/integrations` — returns list
- `PATCH /api/integrations` — toggle connected state; assert change reflected in GET

**Recommendations**
- `POST /api/recommend` — returns array of action suggestions

**Auth protection**
- All protected routes return 401 without a session cookie

---

### E2E Project (`tests/e2e/`)

**Login flow**
- Visit `/login` → enter correct password → redirected to `/`
- Enter wrong password → stays on `/login` with error

**Chat (main page)**
- Type a question → classify fires → analysis starts → agent cards appear → response streams in → done
- Quick mode toggle → single SQL + faster response

**Sidebar navigation**
- Click each nav item → correct page loads → active item is highlighted
- Settings popover opens and closes
- Account popover opens and closes

**Segments**
- Visit `/segments` → list loads
- Open "Create Segment" modal → describe in NL → generate SQL → save → appears in list
- Open segment detail → edit name → delete segment

**Metrics**
- Visit `/metrics` → list loads
- Click metric → detail page loads

**Forecasting**
- Visit `/forecasting` → seed metrics → generate forecast → chart appears

**Data Catalog**
- Visit `/data-catalog` → table list loads

---

### Visual Project (`tests/visual/`)

**Scope: stable secondary pages** (not the chat page — it changes with UX improvements)

- `/metrics` — metrics list
- `/segments` — segments list
- `/forecasting` — forecast dashboard
- `/playbooks` — playbooks list
- `/data-catalog` — data catalog
- `/connectors` — connectors page
- Sidebar component — all nav items, active states

**Excluded from visual tests:**
- `/` (chat page) — changes frequently with UX work
- Any page in active redesign

**CI behavior:**
- Visual tests always run and always report
- A diff doesn't fail the PR gate — CI job uses `continue-on-error: true`; Playwright HTML report is uploaded as an artifact for review
- Engineer reviews and either updates snapshots (`pnpm test:visual:update`) or reverts

**Snapshot management:**
- Snapshots are **gitignored** — generated locally and in CI as artifacts, never committed
- Snapshots are versioned by a counter in the filename (e.g. `sidebar-v3.png`)
- Snapshots from 2+ versions earlier are automatically deleted during the update step

---

## CI Integration

New GitHub Actions workflow: `.github/workflows/test.yml`

```
Trigger: PR opened, synchronized, ready_for_review
Jobs:
  1. lint-and-typecheck  (pnpm lint && tsc --noEmit)
  2. setup-test-db       (npx tsx scripts/setup-data.ts with DUCKDB_PATH=data/test.duckdb)
  3. api-tests           (playwright test --project=api)   [needs: setup-test-db]
  4. e2e-tests           (playwright test --project=e2e)   [needs: setup-test-db]
  5. visual-tests        (playwright test --project=visual, continue-on-error: true, uploads HTML report artifact)
```

Jobs 1–4 are blocking. Job 5 always runs; a diff uploads an artifact but never fails the gate.

`webServer` in `playwright.config.ts` starts `next dev` automatically before the test run.

Environment secrets needed: `GEMINI_API_KEY`, `APP_PASSWORD`, `SESSION_SECRET`

---

## Key Decisions

1. **Playwright only** — no Vitest; one tool minimizes setup and maintenance overhead
2. **Real Gemini calls** — assertions check structure/shape, not exact LLM output text
3. **Visual is non-blocking** — flags regressions without stopping unrelated PRs; report uploaded as CI artifact
4. **Three Playwright projects** — `api`, `e2e`, `visual` can be run independently locally or in CI
5. **`next dev` in CI** — faster startup (~10s vs ~60s for production build); TypeScript/lint errors caught by the separate typecheck job before tests run
6. **Seeded test DuckDB** — a dedicated `data/test.duckdb` seeded from the same ecommerce parquet files; initialized in CI as a setup step; isolated from dev DB
7. **Snapshots gitignored + versioned** — never committed; versioned by counter suffix; snapshots 2+ cycles old are auto-deleted on update
8. **Liberal CI timeout budget** — per-test: 60s (120s for streaming); global CI job timeout: 30 min
9. **Lint + typecheck added to CI** — catches TypeScript errors before tests even run

---

## Open Questions

_None — all decisions resolved._
