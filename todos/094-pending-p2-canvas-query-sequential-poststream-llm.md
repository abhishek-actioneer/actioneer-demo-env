---
status: pending
priority: p2
issue_id: "094"
tags: [code-review, performance, canvas-query, pr-41]
dependencies: []
---

# `canvas-query` runs follow-up + annotation LLM calls sequentially after cards complete — up to 23s tail latency

## Problem Statement

After all SQL cards have been emitted, `src/app/api/canvas-query/route.ts` makes two more LLM calls **sequentially** before sending `done`:

1. Follow-up questions generation (lines 603–614): 8-second timeout
2. Annotation generation (lines 657–668): 15-second timeout with one retry (so up to 30s worst case)

The user sees all their cards render, then waits up to 23–38 seconds before the follow-up chips and annotations appear — because the stream isn't closed until both calls complete. This is perceived as the UI "hanging" after visual completion.

Additionally, if follow-up generation fails (the resolved-and-retried annotation path), the stream still waits for the full annotation timeout.

## Findings

Source: Performance Oracle agent review.

- `canvas-query/route.ts` lines 570–679: follow-ups then annotations, sequential
- `send({ type: "done" })` only fires after both complete (line 681)
- Annotation retry: 2 attempts × 15s = up to 30s
- Follow-up: 8s timeout
- Theoretical maximum tail latency after card completion: 38 seconds

## Proposed Solutions

**Option A (Recommended): Run follow-up and annotation in parallel with `Promise.all`**
```ts
await Promise.all([
  generateFollowUpQuestions(...).then((questions) => { /* send suggestions */ }),
  generateAnnotations(...).then((annotations) => { /* send annotations */ }),
]);
send({ type: "done", queryGroupId });
```
Reduces tail latency from 23–38s to max(8s, 30s) = 30s worst case, 15s typical.
- Effort: Small | Risk: Low

**Option B: Send `done` before follow-ups/annotations, emit them as separate event types**
- Client shows cards immediately; chips appear async after
- Follow-ups and annotations become optional enhancements, not blocking
- Effort: Medium | Risk: Low (requires client-side handling of post-`done` events)

**Option C: Apply Option A AND also resolve todo 093 (use `generateFollowUpQuestions`)**
- After fixing 093, the inline follow-up call is replaced and can be run concurrently with annotations cleanly
- Effort: Small (once 093 is done) | Risk: Low

## Recommended Action

Option A immediately (reduces worst case). Option C as follow-on after 093 is resolved.

## Technical Details

- **Affected file:** `src/app/api/canvas-query/route.ts` lines 570–679

## Acceptance Criteria

- [ ] Follow-up generation and annotation generation run concurrently (not sequentially)
- [ ] `done` event is emitted after both complete (same semantics, lower latency)
- [ ] No change to client-side behavior — suggestions and annotations still arrive before `done`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (performance-oracle agent) | Annotations have a retry budget; parallelizing cuts worst case by 8s |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
- Related: todo 093 (inline follow-up duplication)
