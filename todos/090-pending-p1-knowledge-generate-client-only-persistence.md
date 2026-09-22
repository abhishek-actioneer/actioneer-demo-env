---
status: pending
priority: p1
issue_id: "090"
tags: [code-review, agent-native, knowledge, pr-41]
dependencies: []
---

# `/api/knowledge/generate` returns entries but does not persist them — client-only save

## Problem Statement

`POST /api/knowledge/generate` returns `{ entries, count }` but does not save anything to the knowledge store. Persistence happens entirely client-side in `src/app/knowledge/page.tsx` lines 169–170:

```ts
result.entries.forEach((e: KnowledgeEntry) => saveKnowledgeEntry(datasetId, e));
```

This means:
1. Any non-browser caller (agent, curl, CI script, `apiFetch` from another route) that hits this endpoint will receive a successful response but produce **no lasting state change** — the knowledge base remains empty.
2. If the browser tab is closed or navigated away after the API response arrives but before the forEach completes, entries are lost.
3. This is architecturally inconsistent: `POST /api/segments/generate-all` persists directly to DuckDB in the route; `POST /api/metrics/generate` persists to disk in the route. Knowledge is the only generation that requires a mandatory client-side save step.

## Findings

Source: Agent-Native reviewer + Pattern Recognition agent.

- `src/app/api/knowledge/generate/route.ts:75` — returns entries, no `saveKnowledgeEntry` call
- `src/app/knowledge/page.tsx:169` — client does the actual saving
- `src/lib/knowledge-store.ts` exports `saveKnowledgeEntry(datasetId, entry)` — callable server-side
- Segments route: saves to DuckDB in `executeSQLPrepared` at route level
- Metrics route: writes `metrics.json` to disk in route handler
- Knowledge route: returns entries for client-side iteration

## Proposed Solutions

**Option A (Recommended): Move `saveKnowledgeEntry` into the route handler**
- Call `saveKnowledgeEntry(datasetId, e)` for each entry before returning the response
- Return `{ count, saved: true }` — no need to return the full entry list
- Remove the `forEach` from `knowledge/page.tsx` (replace with a `refreshKey` bump to re-fetch from store)
- Effort: Small | Risk: Low

**Option B: Keep client-side save, add a server-side save endpoint**
- Add a `POST /api/knowledge/bulk` route that accepts an array of entries and saves them
- Client calls generate, then calls bulk-save
- Effort: Medium | Risk: Low (more complexity)

**Option C: Document the intentional asymmetry**
- Add a JSDoc comment explaining why knowledge generation is client-persisted
- Effort: Trivial | Risk: High (doesn't fix the agent-accessibility problem)

## Recommended Action

Option A — align with the segments and metrics pattern.

## Technical Details

- **Affected files:**
  - `src/app/api/knowledge/generate/route.ts` — add `saveKnowledgeEntry` calls
  - `src/app/knowledge/page.tsx` — remove `forEach`, add refresh trigger
  - `src/lib/knowledge-store.ts` — already has `saveKnowledgeEntry(datasetId, entry)`, no changes needed

## Acceptance Criteria

- [ ] Calling `POST /api/knowledge/generate` from curl or an agent persists entries to the store
- [ ] The knowledge page shows generated entries after reload (not just in the current session)
- [ ] `saveKnowledgeEntry` is not called in the page component for generated entries

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (agent-native + pattern agents) | All three generation routes should own their own persistence |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
