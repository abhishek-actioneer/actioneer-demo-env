---
status: done
priority: p2
issue_id: "073"
tags: [code-review, performance, segments, pr-41]
dependencies: []
---

# Sequential SQL validation in generate-all is slow with no timeout

## Problem Statement

`src/app/api/segments/generate-all/route.ts:83-114` validates each of up to 12 generated segments sequentially: execute SQL → insert into DB. Each SQL execution could take 1-10+ seconds depending on query complexity and data size. Total latency could reach 30-120 seconds with no timeout, no progress feedback, and no abort mechanism.

The client-side button shows a spinner but the user has no visibility into progress and cannot cancel.

## Findings

```typescript
for (const candidate of candidates.slice(0, 12)) {
  // Validate SQL by executing it
  const validationResult = await executeSQL(candidate.sql, datasetId);
  // ... insert ...
}
```

- No `AbortController` / request cancellation support
- No streaming progress (e.g., SSE with "validating segment 3/12...")
- No per-query timeout (relies on DuckDB's internal timeouts)
- The DuckDB singleton means these sequential queries block other requests

## Proposed Solutions

**Option A (Recommended): Add per-query timeout + parallel validation with concurrency limit**
- Use `Promise.allSettled` with a concurrency limiter (e.g., p-limit with concurrency 3)
- Add a 10-second timeout per SQL execution
- Return partial results on timeout
- Effort: Medium | Risk: Low

**Option B: Add SSE streaming for progress**
- Convert endpoint to streaming response
- Send progress events: `{ type: "progress", segment: "High-Value Users", status: "validating" }`
- Effort: Medium | Risk: Low

**Option C: Accept sequential but add overall timeout**
- Wrap the loop in a `Promise.race` with a 60-second deadline
- Return whatever was generated before the deadline
- Effort: Small | Risk: Low

## Recommended Action

Option C for immediate fix, Option A as follow-up.

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`
- **Related:** DuckDB singleton lock means sequential queries are necessary unless the pool supports concurrency

## Acceptance Criteria

- [ ] Generation completes or fails within a reasonable time (< 60s)
- [ ] Partial results are preserved if some segments fail
- [ ] User gets feedback that generation is progressing

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Sequential DuckDB queries block other requests |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
