---
status: done
priority: p3
issue_id: "082"
tags: [code-review, data-loss, segments, pr-41]
dependencies: []
---

# Generated segment description from LLM is discarded — not stored in DB

## Problem Statement

The segment generation prompt asks the LLM to produce `name`, `description`, and `sql` for each segment. However, the INSERT at `src/app/api/segments/generate-all/route.ts:102` only stores `(id, name, sql, user_count, source_conversation_id)`. The LLM-generated `description` is silently dropped because the `sentinel_segments` table has no `description` column.

The richer LLM descriptions could improve the segments page UX.

## Proposed Solutions

**Option A: Add description column to sentinel_segments**
- ALTER TABLE ADD COLUMN description TEXT
- Update INSERT to include description
- Display on segments page
- Effort: Medium | Risk: Low

**Option B: Remove description from prompt to avoid wasting tokens**
- Effort: Trivial | Risk: None

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`, `src/lib/prompts/segments.ts`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | LLM output fields not aligned with DB schema |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
