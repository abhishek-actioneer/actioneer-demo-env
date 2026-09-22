# Dynamic Playbook Seeding

## Summary

Replace hardcoded playbook list with on-demand generation. When a user visits `/playbooks` for a dataset that has no playbooks, auto-generate a single "Company Health Check" playbook using the existing `/api/playbook/create` pipeline.

## Decisions

- **Approach A** selected: reuse existing `/api/playbook/create` endpoint (no new API route)
- **1 playbook** per dataset: a comprehensive health check
- **Visible loading** on the playbooks page during generation
- **Per-dataset**: triggers for each dataset on first visit
- **No fallback**: hardcoded `PLAYBOOK_LIST`, `MOCK_PLAYBOOK`, `TEMPLATE_PLAYBOOKS` removed entirely

## Changes

### 1. Remove hardcoded data — `src/lib/playbook-data.ts`

Delete `PLAYBOOK_LIST`, `MOCK_PLAYBOOK`, `TEMPLATE_PLAYBOOKS`, and `registerTemplate()`. The file can be deleted entirely or left as an empty module if other imports reference it.

Remove all imports of these exports from:
- `src/lib/playbook-store.ts` (imports `PLAYBOOK_LIST`)
- `src/app/playbooks/page.tsx` (imports `PLAYBOOK_LIST`)
- `src/app/playbooks/[id]/page.tsx` (imports `MOCK_PLAYBOOK`, `TEMPLATE_PLAYBOOKS`)
- `src/components/sidebar/panels.tsx` (imports `PLAYBOOK_LIST` — replace merge logic with just `getSavedPlaybookSummaries()`)
- `src/app/api/playbook/run/route.ts` (imports `MOCK_PLAYBOOK` as default fallback — remove fallback, require playbook in request body, return 400 if missing)

### 2. Track seeded datasets — `src/lib/playbook-store.ts`

Add an in-memory `Set<string>` called `seededDatasets` to track which datasets have had auto-generation attempted (success or failure).

New exports:
- `isDatasetSeeded(datasetId: string): boolean`
- `markDatasetSeeded(datasetId: string): void`

Update `getAllPlaybookSummariesMerged()` to stop merging `PLAYBOOK_LIST` (since it no longer exists). It just returns saved playbook summaries filtered by dataset.

### 3. Auto-generate on playbooks page — `src/app/playbooks/page.tsx`

Import `useDataset` from `@/lib/dataset-context` to get the active `datasetId`.

On mount, check if the current dataset has playbooks:
```
const { datasetId } = useDataset();
const saved = getSavedPlaybookSummaries() filtered by datasetId
if (saved.length === 0 && !isDatasetSeeded(datasetId)) → trigger generation
```

Generation flow:
1. Capture `datasetId` at invocation time (race-condition safety per CLAUDE.md)
2. Set `isSeeding = true` state
3. Create an `AbortController` — abort if dataset switches or component unmounts
4. Call `apiFetch("/api/playbook/create", { method: "POST", body: { query: SEED_PROMPT, datasetId: capturedDatasetId }, stream: true, signal: abort.signal })`
5. Parse NDJSON stream (same logic as `playbooks/[id]/page.tsx` `startGeneration`) — returns raw `Response`, parse body manually
6. Accumulate outline cells → detail fills → assemble `PlaybookV2` with `datasetId` field set
7. `savePlaybook(pb)` + `markDatasetSeeded(capturedDatasetId)`
8. Set `isSeeding = false`, page re-renders with the new playbook in the table

On error:
- `markDatasetSeeded(capturedDatasetId)` anyway (prevent retry loops)
- Show empty state with "New Playbook" button

On dataset switch during seeding:
- Abort the in-flight stream
- Reset seeding state
- Re-trigger for the new dataset if needed

Seed prompt (generic, works for any dataset):
```
"Create a comprehensive health check playbook that analyzes overall business performance — key metrics trends, user activity patterns, retention health, and revenue analysis"
```

### 4. Loading UX

While `isSeeding === true`:
- Hide the table
- Show centered: spinner + "Setting up your first playbook..." text
- Same monochrome spinner style used elsewhere in the app

Once complete, the table fades in with the generated playbook row.

### 5. Detail page cleanup — `src/app/playbooks/[id]/page.tsx`

Remove references to `MOCK_PLAYBOOK` and `TEMPLATE_PLAYBOOKS`. The initial state and useEffect fallback chain simplifies to just checking the store:
```
const fromStore = getPlaybook(playbookId);
setRawPlaybook(fromStore ?? null);
```

If not found and no `?query=` param, show "Playbook not available" (existing behavior).

## Files touched

| File | Change |
|------|--------|
| `src/lib/playbook-data.ts` | Delete or empty out |
| `src/lib/playbook-store.ts` | Add seeded tracking, remove `PLAYBOOK_LIST` import/merge |
| `src/app/playbooks/page.tsx` | Add auto-generation logic + loading state |
| `src/app/playbooks/[id]/page.tsx` | Remove `MOCK_PLAYBOOK`/`TEMPLATE_PLAYBOOKS` references |
| `src/components/sidebar/panels.tsx` | Remove `PLAYBOOK_LIST` import, use only `getSavedPlaybookSummaries()` |
| `src/app/api/playbook/run/route.ts` | Remove `MOCK_PLAYBOOK` fallback, require playbook in body |

## Notes

- `CATEGORY_COLORS` in `playbooks/page.tsx` uses colored badges (blue, purple, amber) which violates the monochrome convention. Pre-existing issue, not addressed here.
- `entity-registry.ts` calls `getAllPlaybookSummariesMerged()` — after this change it will return nothing for datasets not yet visited. Acceptable: entities appear after first playbook page visit.

## Out of scope

- Persisting seeded state across page refreshes (in-memory is fine for demo)
- Multiple auto-generated playbooks
- Custom seed prompts per dataset
- Background pre-generation on app boot
- Migrating playbook store to dataset-scoped nested Map pattern (pre-existing deviation from CLAUDE.md convention)
