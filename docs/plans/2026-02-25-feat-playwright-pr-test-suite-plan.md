---
title: "feat: Add Playwright test suite for PR gating"
type: feat
date: 2026-02-25
---

# feat: Add Playwright test suite for PR gating

## Overview

Add a full Playwright test suite covering API integration, E2E browser flows, and visual regression — blocking PR merges on failures. Zero tests exist today. This establishes the foundation from scratch.

**Three Playwright projects:**
| Project | Blocks PR | Scope |
|---|---|---|
| `api` | Yes | All non-excluded API routes |
| `e2e` | Yes | Full browser user flows |
| `visual` | No | Screenshot diffs of stable pages; flags but never blocks |

---

## Technical Approach

### Auth model (confirmed)

`src/proxy.ts` is the Next.js middleware. Session validation is **presence-only** — any non-empty `session_token` cookie is valid. The token value is never stored or verified server-side.

**Test implication:** Inject `session_token=playwright-test-session` directly into browser context for all tests that need auth. Only `tests/api/auth.spec.ts` and `tests/e2e/login.spec.ts` exercise the real login flow.

### DuckDB test data strategy

Parquet files are not committed. The plan is:
1. Create `tests/fixtures/sample.csv` — a small synthetic ecommerce CSV (~50 rows) with the same schema as the production events table
2. Create `scripts/setup-test-data.ts` — wraps `setup-data.ts` logic but reads from `tests/fixtures/sample.csv` and writes to `data/ecommerce.duckdb`
3. CI runs `npx tsx scripts/setup-test-data.ts` before tests as a prerequisite step

### Visual snapshot baseline

Initial snapshots are committed to the repo in `tests/visual/snapshots/`. `.gitignore` is updated to exclude `tests/visual/snapshots/*-actual.png` and `tests/visual/snapshots/*-diff.png` (generated on update runs) but not the baseline `.png` files themselves. To update baselines: `pnpm test:visual:update` regenerates and commits the new set.

Snapshot file naming: `<page>-<description>-v<N>.png` (e.g. `metrics-list-v1.png`). When updating, bump the version counter and delete all files two or more versions behind.

### Excluded from automated tests

- `POST /api/datasets/upload` — creates files on disk, triggers LLM enrichment, requires teardown of `data/datasets/` directory; too complex for CI without a dedicated cleanup harness
- `POST /api/knowledge/fetch-url` — proxies external URLs; requires network mocking or live internet in CI

### Streaming test assertions

Each streaming endpoint has defined minimum events:

| Endpoint | Required events |
|---|---|
| `POST /api/analyze` (quick) | `phase`, `sql`, `query_result`, `text`, `done` |
| `POST /api/analyze` (deep) | `phase`, `sql`, `query_result`, `summary`, `text`, `done` |
| `POST /api/chat` | raw text chunks (non-NDJSON), non-empty total |
| `POST /api/playbook/create` | `outline_cell`, `cell_detail`, `generation_complete`, `done` |
| `POST /api/playbook/run` | `phase`, `result`, `done` |
| `POST /api/playbook/edit` | `cell_detail`, `done` |

### Segment test isolation

Each segments test file runs a `beforeAll` that deletes any `segments` rows with `name LIKE 'test-%'` via `POST /api/query`. This prevents state bleed between test runs.

---

## Implementation Phases

### Phase 1: Foundation

Install Playwright, create config, test fixtures, and data setup script. All subsequent phases depend on this.

**Files to create/modify:**

#### `package.json` — add scripts and devDependency
```json
{
  "scripts": {
    "test": "playwright test",
    "test:api": "playwright test --project=api",
    "test:e2e": "playwright test --project=e2e",
    "test:visual": "playwright test --project=visual",
    "test:visual:update": "playwright test --project=visual --update-snapshots"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0"
  }
}
```

Install: `pnpm add -D @playwright/test`

#### `playwright.config.ts`
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      APP_PASSWORD: process.env.APP_PASSWORD ?? 'test-password',
    },
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testDir: './tests/visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
```

#### `tests/fixtures/auth.ts`
```ts
// Shared auth helpers
export const TEST_COOKIE = {
  name: 'session_token',
  value: 'playwright-test-session',
  domain: 'localhost',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax' as const,
};

export async function injectAuthCookie(context: BrowserContext) {
  await context.addCookies([TEST_COOKIE]);
}

export async function loginViaAPI(request: APIRequestContext): Promise<string> {
  const resp = await request.post('/api/auth/login', {
    data: { password: process.env.APP_PASSWORD ?? 'test-password' },
  });
  const cookies = resp.headers()['set-cookie'];
  const match = cookies?.match(/session_token=([^;]+)/);
  return match?.[1] ?? '';
}
```

#### `tests/fixtures/index.ts`
```ts
// Base test extending Playwright with auth pre-wired
import { test as base } from '@playwright/test';
import { injectAuthCookie } from './auth';

export const test = base.extend({
  context: async ({ context }, use) => {
    await injectAuthCookie(context);
    await use(context);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
```

#### `tests/fixtures/sample.csv`
A minimal synthetic CSV with the same schema as the production `events` table (~50 rows covering multiple event types, users, and dates).

#### `scripts/setup-test-data.ts`
```ts
// Wraps setup-data.ts to seed from tests/fixtures/sample.csv
// Writes to data/ecommerce.duckdb (same path as dev DB)
```

#### `.gitignore` additions
```
# Playwright test artifacts
/playwright-report/
/test-results/
/tests/visual/snapshots/*-actual.png
/tests/visual/snapshots/*-diff.png
```

---

### Phase 2: API Tests

All tests use Playwright's `request` context. Authenticated routes use the `session_token` cookie injected via headers.

**Acceptance criteria:** All tests return expected HTTP status codes, response shapes match schemas, streaming endpoints emit all required event types.

**Files to create:**

#### `tests/api/auth.spec.ts`
- `POST /api/auth/login` — correct password → 200 + `set-cookie` header with `session_token`
- `POST /api/auth/login` — wrong password → 401 `{ error: "Incorrect password" }`
- `POST /api/auth/login` — empty password → 400
- `POST /api/auth/login` — missing body → 400

#### `tests/api/health.spec.ts`
- `GET /api/health?datasetId=ecommerce` — no auth required → `{ dbReady: true }` after DB setup
- `GET /api/health` — no `datasetId` → still 200 (returns dbReady for default dataset)

#### `tests/api/protected.spec.ts`
- Each protected route group called without `session_token` cookie → 302 redirect to `/login` (middleware behavior)
- Routes called with `session_token=any-value` → not 302 (middleware passes through)

#### `tests/api/classify.spec.ts`
- `POST /api/classify` with `{ message: "what is revenue?" }` → `{ type: "analytics" }` or `{ type: "direct" }`
- `POST /api/classify` with `{ message: "hello" }` → `{ type: "direct" }`
- Missing `message` → 400

#### `tests/api/analyze.spec.ts` — timeout: 120_000
```ts
test('quick mode emits required events', async ({ request }) => {
  // Read NDJSON stream, collect event types
  // Assert: phase, sql, query_result, text, done all present
  // Assert: no error event
});
test('deep mode emits summary events', async ({ request }) => {
  // Assert: summary events present in addition to quick mode events
});
```

#### `tests/api/chat.spec.ts` — timeout: 60_000
- `POST /api/chat` with `{ message: "hello" }` → streaming response, total text non-empty

#### `tests/api/query.spec.ts`
- `POST /api/query` valid SELECT → `{ rows: [...], columns: [...] }`
- Non-SELECT statement → 400
- SQL with DDL keyword → 400
- Invalid SQL → 400 with error message

#### `tests/api/segments.spec.ts`
- `beforeAll`: cleanup `test-%` segments via query
- `POST /api/segments` create → 201, returns segment with `id`
- `GET /api/segments` → array containing created segment
- `GET /api/segments/:id` → `{ count: number, preview: [...] }`
- `PATCH /api/segments/:id` `{ name: "test-updated" }` → 200
- `POST /api/segments/:id/push` `{ integrationId: "klaviyo" }` → `{ success: true }` (after ~1.5s)
- `POST /api/segments/generate-sql` `{ description: "..." }` → `{ sql: string }`
- `DELETE /api/segments/:id` → `{ success: true }`; subsequent GET → 404

#### `tests/api/datasets.spec.ts`
- `GET /api/datasets` → array with at least ecommerce dataset
- `GET /api/datasets/ecommerce/prompts` → array of suggestion strings
- `GET /api/datasets/ecommerce/enrich` → enrichment metadata object
- `DELETE /api/datasets` with non-default dataset id → 200 (create a dynamic dataset first if needed, otherwise skip)

#### `tests/api/playbooks.spec.ts` — timeout: 120_000
- `POST /api/playbook/create` `{ prompt: "..." }` → streaming NDJSON; assert `outline_cell`, `cell_detail`, `generation_complete`, `done` events
- `POST /api/playbook/intent` `{ annotations: [...] }` → `{ ops: [...] }`
- `POST /api/playbook/validate` with playbook containing SQL cells → per-cell validity array
- `POST /api/playbook/run` with minimal V2 playbook → streaming; assert `phase`, `result`, `done`
- `POST /api/playbook/edit` with annotation → streaming; assert `cell_detail`, `done`

#### `tests/api/forecast.spec.ts` — timeout: 60_000
- `POST /api/forecast/seed` → `{ success: true }`
- `POST /api/forecast/generate-sql` `{ metric: "revenue" }` → `{ sql: string }`
- `POST /api/forecast/predict` with seeded metrics → `{ forecasts: [{ weeks: [...] }] }`

#### `tests/api/schema.spec.ts`
- `GET /api/schema/tables` → array with at least one table name
- `POST /api/schema/tables` valid SELECT → `{ valid: true }`
- `POST /api/schema/tables` invalid SQL → `{ valid: false, error: string }`

#### `tests/api/knowledge.spec.ts` — timeout: 60_000
- `POST /api/knowledge/add` `{ text: "..." }` → `{ entry: { category: string, ... } }`
- `POST /api/knowledge/parse` `{ text: "..." }` → `{ entries: [...] }`

#### `tests/api/integrations.spec.ts`
- `GET /api/integrations` → array of integration objects
- `PATCH /api/integrations` `{ id: "klaviyo", connected: true }` → 200
- `PATCH /api/integrations` `{ id: "klaviyo", connected: false }` → 200; GET reflects `connected: false`

#### `tests/api/recommend.spec.ts` — timeout: 60_000
- `POST /api/recommend` `{ query: "...", responseText: "...", mode: "quick" }` → `{ recommendations: [...] }`

---

### Phase 3: E2E Tests

All E2E tests use the extended `test` from `tests/fixtures/index.ts` which pre-injects the auth cookie. Only `login.spec.ts` uses the base Playwright `test`.

#### `tests/e2e/login.spec.ts`
- Visit `/` unauthenticated → redirected to `/login`
- Enter correct password → redirected to `/`
- Enter wrong password → stays on `/login`, error message visible
- Already authenticated → visiting `/login` redirects to `/`

#### `tests/e2e/chat.spec.ts` — timeout: 120_000
- Visit `/` → welcome message visible
- Type an analytics question → agent cards appear → streaming completes → response visible
- Quick mode toggle → single SQL card visible
- Deep mode → multiple agent cards visible

#### `tests/e2e/sidebar.spec.ts`
- Each main nav item (Analytics section: home, metrics, segments, forecasting, playbooks, scouts, data-catalog; Actions section: connectors, knowledge, store) → correct URL on click, active item highlight updates
- Settings popover → opens on click, closes on outside click
- Account popover → opens on click, closes on outside click
- Topbar title updates to match active page

#### `tests/e2e/segments.spec.ts` — timeout: 60_000
- `beforeAll`: cleanup `test-%` segments
- Visit `/segments` → list renders
- Open "Create Segment" modal → SQL tab → enter valid SQL → save → new row in list
- Click segment → detail page loads with count + preview table
- Edit segment name inline → change persists on reload
- Delete segment → removed from list

#### `tests/e2e/metrics.spec.ts`
- Visit `/metrics` → metrics list renders
- Click a metric card → detail page `/metrics/[id]` loads

#### `tests/e2e/forecasting.spec.ts` — timeout: 60_000
- Visit `/forecasting` → page loads
- Seed metrics → success state
- Generate forecast → chart renders

---

### Phase 4: Visual Tests

Use the base Playwright `test` (no auth cookie injection via fixture — use `page.context().addCookies()` in `beforeEach` instead since base test is needed for screenshot comparison).

**Initial baseline:** Run `pnpm test:visual:update` locally after Phase 3 is complete to generate and commit initial snapshots.

#### `tests/visual/pages.spec.ts`
```
beforeEach: inject session_token cookie

Screenshots taken at:
- /metrics             → metrics-list-v1.png
- /segments            → segments-list-v1.png
- /forecasting         → forecasting-dashboard-v1.png
- /playbooks           → playbooks-list-v1.png
- /data-catalog        → data-catalog-v1.png
- /connectors          → connectors-v1.png
- /knowledge           → knowledge-v1.png
- sidebar (full)       → sidebar-all-items-v1.png
- sidebar active state → sidebar-metrics-active-v1.png
```

Pixel diff threshold: 0.5% (tolerates anti-aliasing variance).

**Snapshot versioning script:** `scripts/cleanup-old-snapshots.ts` — deletes `*-v{N}.png` where N is 2 or more behind the current highest version for each basename.

---

### Phase 5: CI Workflow

#### `.github/workflows/test.yml`

```yaml
name: Tests
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

env:
  APP_PASSWORD: ${{ secrets.APP_PASSWORD }}
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: "10.27.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install
      - run: pnpm lint
      - run: npx tsc --noEmit

  setup-test-db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: "10.27.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install
      - run: npx tsx scripts/setup-test-data.ts
      - uses: actions/upload-artifact@v4
        with:
          name: test-duckdb
          path: data/ecommerce.duckdb

  api-tests:
    needs: [lint-and-typecheck, setup-test-db]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: "10.27.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install
      - uses: actions/download-artifact@v4
        with: { name: test-duckdb, path: data/ }
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:api
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: api-test-report
          path: playwright-report/

  e2e-tests:
    needs: [lint-and-typecheck, setup-test-db]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: "10.27.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install
      - uses: actions/download-artifact@v4
        with: { name: test-duckdb, path: data/ }
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-test-report
          path: playwright-report/

  visual-tests:
    needs: setup-test-db
    runs-on: ubuntu-latest
    continue-on-error: true
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: "10.27.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install
      - uses: actions/download-artifact@v4
        with: { name: test-duckdb, path: data/ }
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:visual
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visual-test-report
          path: playwright-report/
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] `pnpm test:api` passes with all API tests green
- [ ] `pnpm test:e2e` passes with all E2E tests green
- [ ] `pnpm test:visual` runs and generates a report (pass or fail is non-blocking)
- [ ] CI workflow blocks PR merge when `api-tests` or `e2e-tests` fail
- [ ] CI workflow does not block PR merge when `visual-tests` fail
- [ ] `pnpm test:visual:update` regenerates snapshot baselines and script deletes old versioned snapshots

### Non-Functional Requirements

- [ ] Individual test timeout: 60s default, 120s for streaming/LLM-heavy tests
- [ ] Global CI job timeout: 30 minutes
- [ ] `scripts/setup-test-data.ts` completes in under 30 seconds with fixture CSV
- [ ] Visual snapshots committed to repo as baseline; actual/diff PNGs gitignored

### Quality Gates

- [ ] No test uses mocked Gemini calls — all LLM calls hit the real API
- [ ] Segments tests clean up `test-%` prefixed rows in `beforeAll`
- [ ] Streaming tests assert specific required event types, not just a non-empty response
- [ ] Upload endpoint and `knowledge/fetch-url` are explicitly excluded with a comment explaining why

---

## Dependencies & Prerequisites

- `GEMINI_API_KEY` added to GitHub Actions secrets
- `APP_PASSWORD` added to GitHub Actions secrets
- `@playwright/test` added to devDependencies
- `tests/fixtures/sample.csv` committed (synthetic ecommerce data, ~50 rows)
- Initial visual baselines committed after `pnpm test:visual:update` on a clean local run

---

## File Creation Checklist

### Phase 1 — Foundation
- [x] `playwright.config.ts`
- [x] `tests/fixtures/auth.ts`
- [x] `tests/fixtures/index.ts`
- [x] `tests/fixtures/sample.csv`
- [x] `scripts/setup-test-data.ts`
- [x] `scripts/cleanup-old-snapshots.ts`
- [x] Update `package.json` (scripts + devDependency)
- [x] Update `.gitignore`

### Phase 2 — API Tests
- [x] `tests/api/auth.spec.ts`
- [x] `tests/api/health.spec.ts`
- [x] `tests/api/protected.spec.ts`
- [x] `tests/api/classify.spec.ts`
- [x] `tests/api/analyze.spec.ts`
- [x] `tests/api/chat.spec.ts`
- [x] `tests/api/query.spec.ts`
- [x] `tests/api/segments.spec.ts`
- [x] `tests/api/datasets.spec.ts`
- [x] `tests/api/playbooks.spec.ts`
- [x] `tests/api/forecast.spec.ts`
- [x] `tests/api/schema.spec.ts`
- [x] `tests/api/knowledge.spec.ts`
- [x] `tests/api/integrations.spec.ts`
- [x] `tests/api/recommend.spec.ts`

### Phase 3 — E2E Tests
- [x] `tests/e2e/login.spec.ts`
- [x] `tests/e2e/chat.spec.ts`
- [x] `tests/e2e/sidebar.spec.ts`
- [x] `tests/e2e/segments.spec.ts`
- [x] `tests/e2e/metrics.spec.ts`
- [x] `tests/e2e/forecasting.spec.ts`

### Phase 4 — Visual Tests
- [x] `tests/visual/pages.spec.ts`
- [ ] `tests/visual/snapshots/*.png` (initial baselines — run `pnpm test:visual:update` locally after app is running)

### Phase 5 — CI
- [x] `.github/workflows/test.yml`

---

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-25-pr-test-suite-brainstorm.md`
- Auth middleware: `src/proxy.ts`
- Auth login route: `src/app/api/auth/login/route.ts`
- DuckDB init: `src/lib/db.ts`
- DB setup script: `scripts/setup-data.ts`
- Existing CI: `.github/workflows/claude-code-review.yml`

### External
- [Playwright docs — projects](https://playwright.dev/docs/test-projects)
- [Playwright docs — webServer](https://playwright.dev/docs/test-webserver)
- [Playwright docs — API testing](https://playwright.dev/docs/api-testing)
- [Playwright docs — visual comparisons](https://playwright.dev/docs/test-snapshots)
