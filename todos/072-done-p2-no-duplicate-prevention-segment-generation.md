---
status: done
priority: p2
issue_id: "072"
tags: [code-review, data-integrity, segments, pr-41]
dependencies: []
---

# No duplicate prevention when re-generating starter segments

## Problem Statement

Clicking "Generate Starter Segments" multiple times inserts duplicate segments into `sentinel_segments`. There is no cleanup of previously generated segments, no idempotency check, and the button remains available even when segments already exist (the empty state disappears but the generation endpoint can still be called programmatically or if the page is refreshed mid-generation).

This creates a confusing UX where users end up with 2x or 3x the segments, all with different IDs but overlapping purposes (e.g., three "High-Value Users" segments).

## Findings

- `src/app/api/segments/generate-all/route.ts` — No `DELETE FROM sentinel_segments WHERE source = 'generated'` or similar cleanup before inserting
- `src/app/segments/page.tsx` — The "Generate" button only shows in empty state, but if the user navigates away during generation and comes back, they could trigger it again
- The `source_conversation_id` is set to `null` for generated segments, but there's no `source` column to mark them as auto-generated

## Proposed Solutions

**Option A (Recommended): Delete existing generated segments before inserting**
- Add a `DELETE FROM sentinel_segments WHERE source_conversation_id IS NULL` before the insert loop
- Or better: add a `source` column to distinguish generated vs user-created segments
- Effort: Small | Risk: Low

**Option B: Make the endpoint idempotent with a `replace` flag**
- Accept `{ datasetId, replace: true }` in body
- When `replace` is true, clear previous generated segments first
- Effort: Small | Risk: Low

**Option C: UI-only — disable after first generation**
- Show the generate button only when segment count is 0
- Already partially done (empty state), but doesn't prevent programmatic duplication
- Effort: Small | Risk: Medium (doesn't fix the root cause)

## Recommended Action

Option A — clean slate before generation.

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`

## Acceptance Criteria

- [ ] Re-running generation replaces previous generated segments
- [ ] User-created segments are NOT deleted during regeneration
- [ ] UI reflects the replacement correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | No idempotency on bulk generation |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
