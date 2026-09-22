---
title: "feat: Rebase Playwright test suite onto post-lint main"
type: feat
date: 2026-02-25
---

# feat: Rebase Playwright test suite onto post-lint main

## Overview

PR #17 (`feat/playwright-test-suite`) is being closed without merging. PR #18 (`fix/eslint-zero-warnings`) is merging first to establish a clean, zero-warning `main`. This plan carries forward the full Playwright test suite — infrastructure, fixtures, and tests — as a fresh branch off the new `main`.

**This is not a rewrite.** All test files were finalized in PR #17. The work here is cherry-picking + rebasing, not authoring from scratch.

---

## Context

| Branch | Status | What it contained |
|---|---|---|
| `feat/playwright-test-suite` (PR #17) | Closing | Full test suite, CI workflow, DuckDB seeding, lint fixes |
| `fix/eslint-zero-warnings` (PR #18) | Merging | Lint fixes only (34 files, 76 warnings → 0) |
| `main` | Post-PR#18 | Clean zero-warning baseline |

After PR #18 merges, `main` will have the lint fixes. The test suite files from PR #17 can be carried forward cleanly — they don't overlap with the lint changes.

---

## Files to Carry Forward

All files below exist on `origin/feat/playwright-test-suite` and need to be re-applied to the new `main`.

### Infrastructure (must come first — tests depend on these)

| File | Type | Change |
|---|---|---|
| `playwright.config.ts` | New | Three-project Playwright config (api, e2e, visual) |
| `.github/workflows/test.yml` | New | 5-job CI pipeline blocking PRs on test failure |
| `scripts/setup-test-data.ts` | New | Seeds `data/ecommerce.duckdb` from `tests/fixtures/sample.csv` |
| `scripts/cleanup-old-snapshots.ts` | New | Deletes versioned snapshots 2+ cycles behind current |
| `src/lib/db.ts` | Modified | Wraps `CREATE OR REPLACE VIEW` in try/catch for CI compatibility — when DuckDB table pre-exists, VIEW creation is skipped gracefully |
| `package.json` | Modified | Add `test`, `test:api`, `test:e2e`, `test:visual`, `test:visual:update` scripts; add `@playwright/test` devDependency |
| `pnpm-lock.yaml` | Modified | Updated lockfile after `pnpm add -D @playwright/test` |
| `.gitignore` | Modified | Add `/playwright-report/`, `/test-results/`, visual snapshot diffs |

### Test Fixtures

| File | Type | Purpose |
|---|---|---|
| `tests/fixtures/auth.ts` | New | `authHeaders()` helper + `TEST_COOKIE` constant shared by all 15 API specs |
| `tests/fixtures/index.ts` | New | Extended test fixture with auth cookie pre-injected for E2E |
| `tests/fixtures/ndjson.ts` | New | `parseNDJSON()` helper used by streaming endpoint tests |
| `tests/fixtures/sample.csv` | New | ~50-row synthetic ecommerce dataset matching production schema |

### API Tests (`tests/api/`)

15 spec files, all fully written in PR #17:

`auth.spec.ts` · `health.spec.ts` · `protected.spec.ts` · `classify.spec.ts` · `analyze.spec.ts` · `chat.spec.ts` · `query.spec.ts` · `segments.spec.ts` · `datasets.spec.ts` · `playbooks.spec.ts` · `forecast.spec.ts` · `schema.spec.ts` · `knowledge.spec.ts` · `integrations.spec.ts` · `recommend.spec.ts`

### E2E Tests (`tests/e2e/`)

6 spec files:

`login.spec.ts` · `chat.spec.ts` · `sidebar.spec.ts` · `segments.spec.ts` · `metrics.spec.ts` · `forecasting.spec.ts`

### Visual Tests (`tests/visual/`)

`pages.spec.ts` — screenshots 9 pages at 1280×800; non-blocking in CI.

---

## Proposed Solution

### Branch strategy

```
main (post-PR#18)
└── feat/playwright-test-suite-v2  ← new branch, single commit
```

Base the new branch off the `main` HEAD after PR #18 merges. Apply all files above in one commit: `feat(tests): add Playwright test suite gating PRs to main`.

### How to apply

The cleanest path: checkout the new branch from `main`, then copy files from `origin/feat/playwright-test-suite` using `git checkout origin/feat/playwright-test-suite -- <paths>` for the new files, and cherry-pick the `src/lib/db.ts` modification.

The `fix/eslint-zero-warnings` branch (PR #18's branch) still has the test suite files as **unstaged changes** — these can also be used as the source, since the stash pop left them in the working tree.

### Potential conflicts

None expected. The lint fixes in PR #18 touch source files; the test suite adds files that don't exist on `main` at all. The only overlapping file is `src/lib/db.ts`, where PR #18 made no changes (it was in the stash pop conflict but resolved to the remote version).

---

## Acceptance Criteria

### Functional

- [ ] `pnpm test:api` — all 15 API spec files pass green
- [ ] `pnpm test:e2e` — all 6 E2E spec files pass green
- [ ] `pnpm test:visual` — runs and generates HTML report (pass or diff is non-blocking)
- [ ] CI `lint-and-typecheck` job passes with 0 errors and 0 warnings
- [ ] CI `api-tests` and `e2e-tests` jobs block PR merge on failure
- [ ] CI `visual-tests` job never blocks PR merge (`continue-on-error: true`)
- [ ] `scripts/setup-test-data.ts` seeds the DuckDB in < 30 seconds
- [ ] DuckDB `CHECKPOINT` is called at end of setup script so WAL is flushed before CI artifact upload

### Quality gates (from `docs/solutions/best-practices/playwright-test-quality-anti-patterns-*`)

- [ ] Every API spec imports `authHeaders()` from `tests/fixtures/auth.ts` — no inline cookie constants
- [ ] Every dependent test in serial suites has `test.skip(!sharedVar, 'depends on X')` guard
- [ ] No `if (await el.count() > 0)` no-op guards — all element checks use `expect(el).toBeVisible()`
- [ ] No `.catch(() => waitForTimeout(N))` — Playwright timeout errors surface properly
- [ ] `src/lib/db.ts` catch block re-throws non-"already exists" errors
- [ ] Shared utilities (`parseNDJSON`, auth helpers) live in `tests/fixtures/`, not duplicated per-spec

### Non-functional

- [ ] Per-test timeout: 60s default, 120s for streaming tests (`analyze`, `chat`, `playbooks`)
- [ ] Global CI job timeout: 30 minutes
- [ ] Visual snapshot baselines generated locally with `pnpm test:visual:update` and committed as initial baseline PNGs (gitignore excludes `*-actual.png` and `*-diff.png` only)

---

## Dependencies & Prerequisites

- PR #18 merged to `main` first
- GitHub Actions secrets confirmed: `GEMINI_API_KEY`, `APP_PASSWORD`
- `@playwright/test` browser installation: CI runs `pnpm exec playwright install --with-deps chromium`
- `tests/fixtures/sample.csv` committed (already written in PR #17 — carry over as-is)
- Initial visual snapshots committed after a local `pnpm test:visual:update` run on the new branch

---

## References

### Internal
- Original brainstorm: `docs/brainstorms/2026-02-25-pr-test-suite-brainstorm.md`
- Original detailed plan (phases 1–5): `docs/plans/2026-02-25-feat-playwright-pr-test-suite-plan.md`
- Anti-patterns to avoid: `docs/solutions/best-practices/playwright-test-quality-anti-patterns-*.md`
- ESLint config patterns: `docs/solutions/build-errors/eslint-worktrees-and-react-hooks-v7-false-positives-*.md`
- Source branch: `origin/feat/playwright-test-suite` (all files are already written there)

### External
- [Playwright docs — projects](https://playwright.dev/docs/test-projects)
- [Playwright docs — webServer](https://playwright.dev/docs/test-webserver)
- [Playwright docs — API testing](https://playwright.dev/docs/api-testing)
