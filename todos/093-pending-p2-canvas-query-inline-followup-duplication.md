---
status: pending
priority: p2
issue_id: "093"
tags: [code-review, architecture, simplicity, canvas-query, pr-41]
dependencies: []
---

# `canvas-query/route.ts` re-implements `generateFollowUpQuestions` inline — 60 lines of duplication

## Problem Statement

`src/lib/prompts/follow-up.ts` was introduced in this PR as the canonical, reusable implementation of follow-up question generation. It handles prompt building, fence stripping, JSON parsing, slicing to 3 results, and returns `[]` on failure.

`src/app/api/canvas-query/route.ts` lines 571–634 re-implement the same logic inline (~60 lines): same prompt template, same fence-strip regex, same `arr.slice(0, 3)`, same `[]` fallback. It also adds a hardcoded fallback block (lines 625–633) with generic questions — unnecessary since `generateFollowUpQuestions` already returns `[]` on failure.

`src/app/api/board-from-research/route.ts` (also in this PR) correctly calls `generateFollowUpQuestions`. The inconsistency is that two routes in the same PR treat the same abstraction differently.

Any future improvement to the follow-up prompt (e.g., adding row data context, changing the question count) must now be applied in two places or they will silently diverge.

## Findings

Source: Simplicity reviewer + Architecture agent.

- `src/app/api/canvas-query/route.ts` lines 571–634: ~60 lines of inline follow-up logic
- `src/lib/prompts/follow-up.ts` lines 17–78: identical capability
- `board-from-research/route.ts` uses `generateFollowUpQuestions` correctly
- The inline version builds `cardSummaryLines` as a string blob; `follow-up.ts` accepts typed `CardSummary[]`

## Proposed Solutions

**Option A (Recommended): Replace inline block with `generateFollowUpQuestions` call**
```ts
import { generateFollowUpQuestions } from "@/lib/prompts/follow-up";
// ...
const cardSummaries = ordered.map((c) => {
  const d = cardData.get(c.cardId);
  return {
    type: c.type,
    title: c.title,
    rowCount: d?.rowCount,
    hasChart: !!d?.chartSpec,
    metricValue: d?.metricValue,
    error: d?.error,
  };
});
const questions = await generateFollowUpQuestions(datasetId, effectiveQuery, cardSummaries);
if (questions.length > 0 && targetCard) {
  send({ type: "suggestions", questions, targetCardId: targetCard.cardId, queryGroupId });
}
```
Removes ~55 lines, the generic fallback block becomes unnecessary.
- Effort: Small | Risk: Low

**Option B: Keep inline but extract shared prompt builder**
- Effort: Medium | Risk: Low

## Recommended Action

Option A.

## Technical Details

- **Affected file:** `src/app/api/canvas-query/route.ts` lines 570–634
- Also eliminates the generic fallback questions (lines 625–633) which are now dead code since `generateFollowUpQuestions` returns `[]` on failure

## Acceptance Criteria

- [ ] `canvas-query/route.ts` calls `generateFollowUpQuestions` from `src/lib/prompts/follow-up.ts`
- [ ] No inline follow-up prompt building in the route
- [ ] Follow-up behavior is identical (same question count, same fallback)
- [ ] `board-from-research` and `canvas-query` both use the same shared function

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (simplicity + architecture agents) | The abstraction was created in this same PR but not applied consistently |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
