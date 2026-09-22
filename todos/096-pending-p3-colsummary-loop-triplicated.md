---
status: pending
priority: p3
issue_id: "096"
tags: [code-review, simplicity, prompts, pr-41]
dependencies: []
---

# `colSummary` schema-to-text loop duplicated verbatim in 3 prompt files

## Problem Statement

The following 6-line block appears identically in three prompt files:

```ts
let colSummary = "";
for (const [name, meta] of Object.entries(schemaMap.columns)) {
  const type = meta.semanticType;
  const desc = meta.description;
  const gotcha = meta.sqlGotcha ? ` [GOTCHA: ${meta.sqlGotcha}]` : "";
  colSummary += `  - ${name}: ${desc} [${type}]${gotcha}\n`;
}
```

Files:
- `src/lib/prompts/segments.ts` lines 13–18
- `src/lib/prompts/knowledge.ts` lines 12–17
- `src/lib/prompts/metrics.ts` lines 9–14

This is a schema serializer — it should live in one place. Any change to how schema columns are displayed in prompts (e.g., adding `sampleValues`, changing the gotcha format) must be applied in three places.

## Proposed Solutions

**Option A (Recommended): Add `buildColSummary(schemaMap: SchemaMap): string` to `schema-loader.ts`**
- Export from the file that already handles schema loading
- All three prompt builders call `schemaMap.annotatedSchemaContext || buildColSummary(schemaMap)`
- Effort: Trivial | Risk: None

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `src/lib/prompts/segments.ts`, `src/lib/prompts/knowledge.ts`, `src/lib/prompts/metrics.ts`, `src/lib/datasets/schema-loader.ts`

## Acceptance Criteria

- [ ] `buildColSummary` exported from `schema-loader.ts`
- [ ] Three prompt files call it instead of repeating the loop
- [ ] Column summary output is identical to current behavior

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (simplicity reviewer) | Third copy added in this PR — time to extract |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
