---
status: pending
priority: p3
issue_id: "098"
tags: [code-review, quality, knowledge, prompts, pr-41]
dependencies: []
---

# Knowledge prompt hardcodes category list that may not match `KNOWLEDGE_CATEGORIES` type constants

## Problem Statement

`src/lib/prompts/knowledge.ts` line 43 includes `"Visualisation"` (British spelling) in the prompt's category example list. The route at `src/app/api/knowledge/generate/route.ts` line 60 validates against `KNOWLEDGE_CATEGORIES` from `knowledge-types.ts`:

```ts
category: KNOWLEDGE_CATEGORIES.includes(e.category as never)
  ? (e.category as KnowledgeEntry["category"])
  : "Insight",
```

If the canonical `KNOWLEDGE_CATEGORIES` array uses American spelling `"Visualization"` (or differs in any way), LLM outputs with `"Visualisation"` will silently fall through to the `"Insight"` default — every visualization-type entry will be mislabeled.

More broadly, the prompt hardcodes the category list as a string, meaning any future addition to `KNOWLEDGE_CATEGORIES` won't automatically appear in the LLM's instructions.

## Proposed Solutions

**Option A (Recommended): Generate the category list programmatically**
```ts
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge-types";
// In prompt:
`Categories (use exact spelling): ${KNOWLEDGE_CATEGORIES.join(", ")}`
```
- Effort: Trivial | Risk: None

**Option B: Verify spelling matches and add a comment**
- Check that `"Visualisation"` is in `KNOWLEDGE_CATEGORIES`; add a comment noting the dependency
- Effort: Trivial | Risk: Low (still breaks if KNOWLEDGE_CATEGORIES changes)

## Recommended Action

Option A — dynamic generation ensures prompt and types always agree.

## Technical Details

- **Affected file:** `src/lib/prompts/knowledge.ts`
- Check `src/lib/knowledge-types.ts` for the canonical `KNOWLEDGE_CATEGORIES` array spelling

## Acceptance Criteria

- [ ] The category list in the prompt is derived from `KNOWLEDGE_CATEGORIES` at runtime
- [ ] No hardcoded category string in the prompt file
- [ ] LLM-generated entries with valid categories are classified correctly

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (pattern recognition agent) | Hardcoded prompt strings drift from type constants silently |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
