# Boards: dynamic, dataset-agnostic dashboards with document + canvas views

**Status:** Spec handoff — prototyped in baby-sentinel, validated, ready for main-app build.
**Prototype repo:** baby-sentinel
**Prototype branch:** `feat/clerk-auth-merged`
**Related Linear:** GR-1220 (Solution Boards)

---

## Summary

Boards are dynamically-generated dashboards scoped to a dataset. The same underlying data renders in two views: a scrollable **document view** and a spatial **canvas view**. Users can generate a board from scratch (LLM + dataset metrics) or from a deep-research report.

## Why

[FILL IN: 1–2 lines on the user problem. Why do users need boards? What's broken today without them?]

## Prototype

- Repo: baby-sentinel
- Branch: `feat/clerk-auth-merged`
- Try it: [FILL IN: loom / screenshots / local run instructions]

## Core behaviors (validated in proto)

1. **Dynamic generation** — given a `datasetId`, the LLM picks relevant metrics and composes a board. No hardcoded layouts. Works for any dataset (sample or uploaded).
2. **Dual view** — document (sections, scrollable) and canvas (tldraw v4, spatial). Same underlying data; user toggles between them without losing state.
3. **Research → Board** — take a Deep Research report + subagent outputs (`SubagentInfo[]` + report markdown) and turn it into a board. One section per agent, charts inferred from the queries the agents ran.
4. **Chart inference** — given query columns and row shape, pick the right card type (line, bar, table, big number, etc.) via `inferCardType` + `inferChartSpec` + `sanitizeChartData`. No manual chart config.
5. **Persistence** — boards live per dataset, survive reloads. Proto uses localStorage with version checking and debounced writes; main app needs server persistence.
6. **Sidebar nav** — "Boards" dropdown in the sidebar lists boards for the active dataset. Replaces the old Canvas nav item.
7. **Card types** — 10 card renderers covering charts, tables, insights, SQL, etc. Document mode requires `doc-card-interactive` CSS class for pointer-events.
8. **Editability** — users can add/remove/reorder sections and cards in both views.

## Key implementation notes from the proto

- **Dynamic generation API:** `/api/board-generate` — takes `datasetId`, loads metrics from `metrics.json` (or `PRESEEDED_METRICS` for ecommerce), prompts Gemini, returns a board structure.
- **Research → Board API:** `/api/board-from-research` — takes `SubagentInfo[]` + report markdown, returns a board.
- **Chart inference module:** `src/lib/chart-inference.ts` — canonical source for card type + chart spec decisions.
- **Dual-view rendering:** both views read from the same store; document view uses named Tailwind groups (`group/card`, `group/section`, `group/prose`) to prevent nested hover conflicts.
- **Board store:** live (not reactive) reads — when deleting items, snapshot IDs in a `useRef` before mutating so placeholders can render in position.
- Related docs in proto memory: `board-document-view.md`, `board-improvements-2026-03-24.md`.

## Out of scope (for v1)

- [FILL IN: anything you explicitly want deferred — e.g. real-time collab, sharing links, export to PDF, scheduled refresh, etc.]

## Open questions for eng

- **Storage backend** — proto uses localStorage; main app needs server persistence. Schema? Ownership model? Versioning?
- **Canvas library** — proto uses tldraw v4. Confirm for main app or pick alternative (React Flow is also in proto for decks).
- **Permissions / sharing** — who can see/edit a board? Per-user, per-org, per-dataset?
- **Auth scoping** — boards must be scoped by `userId` + `datasetId` (see baby-sentinel `board-repo.ts` pattern).
- **Refresh semantics** — do boards auto-refresh when underlying metrics change? On open? Manual only?
- **Collaboration** — multi-user editing? Comments on cards?
- [FILL IN: any other open questions you already know about]

## Acceptance criteria

- [ ] User can generate a board from a dataset with one click
- [ ] User can generate a board from a deep-research report
- [ ] User can toggle between document and canvas views without losing state
- [ ] Charts are inferred automatically from query results
- [ ] Boards persist server-side, scoped by user + dataset
- [ ] Sidebar shows boards for the active dataset
- [ ] User can add/remove/reorder sections and cards
- [FILL IN: anything else that must be true for v1 to ship]

## Related

- GR-1220 — Solution Boards (parent/related initiative)
- Proto memory docs: `memory/board-document-view.md`, `memory/board-improvements-2026-03-24.md`
