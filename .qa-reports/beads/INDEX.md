# QA Beads Index — localhost:3003 — 2026-03-20

**Report:** [qa-report-localhost-3003-2026-03-20.md](../qa-report-localhost-3003-2026-03-20.md)

## Beads by Severity

### CRITICAL (1)

| # | Title | Category | Page | Evidence |
|---|-------|----------|------|----------|
| [001](001-playbooks-infinite-loading.md) | Playbooks stuck in infinite loading | Functional + Silent Failure | /playbooks | Screenshot, console error, source trace to `page.tsx:44-157` |

### HIGH (3)

| # | Title | Category | Page | Evidence |
|---|-------|----------|------|----------|
| [002](002-board-store-race-condition.md) | Board-store hydration race on every page | Dev/Infra | ALL (9/9) | Console warnings, source trace to `api-client.ts:87`, `layout-shell.tsx:23-38` |
| [003](003-chat-submit-button-unresponsive.md) | Chat submit button unresponsive | Functional | / | Interaction log, snapshot showing `[disabled]`, source trace to `chat-input.tsx:413` |
| [004](004-mobile-layout-broken.md) | Mobile layout broken — sidebar overlaps | Visual/Responsive | ALL | Responsive screenshot at 375px, source trace to `sidebar.tsx:267` |

### MEDIUM (3)

| # | Title | Category | Page | Evidence |
|---|-------|----------|------|----------|
| [005](005-connector-400-errors.md) | Connector 400 errors + clipped logos | Dev/Infra + Visual | /connectors | Console errors, screenshot, source trace to `connector-logos.ts`, `connector-logo.tsx` |
| [006](006-metrics-14s-load-no-skeleton.md) | Metrics 14s load, no skeleton | Performance + Product | /metrics | Network timing (13,977ms), screenshot of blank table, API route trace |
| [007](007-dom-growth-memory-concern.md) | 165% DOM growth across navigation | Performance | Cross-page | DOM counts: 432 → 1143, JS heap 32MB |

### LOW (2)

| # | Title | Category | Page | Evidence |
|---|-------|----------|------|----------|
| [008](008-inconsistent-empty-states.md) | Inconsistent empty state patterns | Product | /decks, /knowledge | Side-by-side screenshots, comparison table |
| [009](009-metric-tree-readability.md) | Metric tree hard to read at default zoom | Product + UX | /metric-tree | Screenshot, readability assessment |

### POSITIVE (1)

| # | Title | Category | Page | Evidence |
|---|-------|----------|------|----------|
| [010](010-aesthetic-assessment.md) | Aesthetic assessment — CRAFTED (8/10) | Aesthetic | ALL | Typography data, color analysis, AI slop checklist, 7-dimension scoring |

---

## Evidence Directory

All screenshots are in [`evidence/`](evidence/):

| File | Page | Type |
|------|------|------|
| `qa-landing.png` | /login | Login gate |
| `qa-home.png` | / | Main chat interface |
| `qa-home-annotated.png` | / | Annotated interactive elements |
| `qa-home-autocomplete.png` | / | Autocomplete dropdown active |
| `qa-metrics.png` | /metrics | Metrics table (loaded) |
| `qa-segments.png` | /segments | Segments list |
| `qa-playbooks.png` | /playbooks | Stuck loading spinner |
| `qa-scouts.png` | /scouts | Scouts list |
| `qa-knowledge.png` | /knowledge | Empty state (exemplar) |
| `qa-decks.png` | /decks | Empty state (plain text) |
| `qa-connectors.png` | /connectors | Connector cards |
| `qa-metric-tree.png` | /metric-tree | Tree visualization |
| `qa-responsive-mobile.png` | / | 375px viewport — BROKEN |
| `qa-responsive-tablet.png` | / | 768px viewport |
| `qa-responsive-desktop.png` | / | 1280px viewport |

---

## PR #48 Review Beads (chart-system branch)

### CRITICAL (1)

| # | Title | Category | File | Impact |
|---|-------|----------|------|--------|
| [011](011-explorer-const-reassignment-build-blocker.md) | Explorer route const reassignment — build blocker | Build / Dev Infra | `src/app/api/explorer/route.ts:145` | Blocks all production builds |

### MEDIUM (2)

| # | Title | Category | File | Impact |
|---|-------|----------|------|--------|
| [012](012-module-level-palette-state.md) | Module-level mutable palette state | Architecture / SSR Safety | `src/lib/chart-colors.ts:88` | Cross-request palette bleed in SSR |
| [014](014-chart-requery-fragile-regex-sql-rewrite.md) | chart-requery regex SQL rewrite fragile | Correctness / Edge Case | `src/app/api/chart-requery/route.ts` | Silent wrong results on multi-predicate SQL |

### LOW (4)

| # | Title | Category | File | Impact |
|---|-------|----------|------|--------|
| [013](013-chart-requery-missing-validate-dataset.md) | chart-requery missing validateDatasetId | Consistency / Input Validation | `src/app/api/chart-requery/route.ts:74` | Inconsistent validation |
| [015](015-csv-export-duplicated.md) | CSV export logic duplicated | Code Quality / DRY | `chart-drawer.tsx` + `unified-chart.tsx` | Maintenance burden |
| [016](016-dead-card-control-bar.md) | CardControlBar is dead code | Code Quality / Dead Code | `src/components/board/card-control-bar.tsx` | ~220 lines of dead code |
| [017](017-meta-db-plain-insert-footgun.md) | meta-db plain INSERT violates upsert convention | Consistency / Data Integrity | `src/lib/meta-db.ts` | Throws on retry |
| [018](018-deck-upload-raw-fetch.md) | use-deck-upload-to-board uses raw fetch | Consistency / Convention | `src/hooks/use-deck-upload-to-board.ts:86` | Missing headers |

---

## Summary Stats

- **Total beads:** 18 (9 QA issues + 1 positive assessment + 8 PR review issues)
- **Source files traced:** 14
- **Screenshots captured:** 15
- **Pages audited:** 9
- **Console errors documented:** 5 unique error types
- **PR review issues:** 1 critical (build blocker), 2 medium, 5 low
