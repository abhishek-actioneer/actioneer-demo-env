---
status: pending
priority: p2
issue_id: "085"
tags: [code-review, type-safety, pr-41]
dependencies: []
---

# LLM JSON responses parsed without Zod validation — `as` casts on untrusted data

## Problem Statement

All three generate routes `JSON.parse` the LLM response and assign it to a typed array without runtime validation:

- `segments/generate-all/route.ts:65-73` — `candidates` typed as `{ name: string; description: string; sql: string }[]` with only `Array.isArray` check
- `knowledge/generate/route.ts:63-67` — `raw` typed as `{ content?: string; category?: string; priority?: string }[]`
- `metric-generator.ts:19-26` — `metrics` typed as `MetricDefinition[]`

The elements could be anything the LLM returns. If the LLM returns `{ sql: true }` (boolean instead of string), `executeSQL` receives a boolean. Zod is already imported in the routes — it should be used.

## Findings

Source: TypeScript reviewer agent.

The manual `if (!candidate.name || !candidate.sql)` check in segments is a partial guard but misses type validation. `candidate.description` is never checked.

## Proposed Solutions

**Option A (Recommended): Add Zod schemas for LLM output**
```typescript
const CandidateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  sql: z.string().min(1),
});
// candidates = z.array(CandidateSchema).parse(parsed);
```
- Replaces both the cast and manual checks with a single source of truth
- Effort: Small | Risk: Low

## Technical Details

- **Affected files:** `src/app/api/segments/generate-all/route.ts`, `src/app/api/knowledge/generate/route.ts`, `src/lib/datasets/metric-generator.ts`

## Acceptance Criteria

- [ ] All LLM JSON outputs validated with Zod before use
- [ ] Invalid elements filtered out gracefully (not crash entire generation)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (TypeScript reviewer agent) | Zod already in scope — use it |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
