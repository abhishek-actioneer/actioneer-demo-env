---
status: resolved
priority: p2
issue_id: "024"
tags: [code-review, prompts, sql-generation, segments]
dependencies: []
---

# buildSegmentSqlPrompt() concatenated into user message instead of passed as systemPrompt

## Problem Statement

`src/app/api/segments/generate-sql/route.ts` uses `buildSegmentSqlPrompt` incorrectly — it concatenates the system prompt string directly into the user-facing `generateText` call instead of passing it via a `systemPrompt` option. This means the LLM receives the entire system context as part of the user message rather than as a proper system turn.

## Findings

`src/app/api/segments/generate-sql/route.ts` lines 20-23:
```typescript
const prompt = buildSegmentSqlPrompt(datasetId);
const sql = (await generateText(`${prompt}\n\nUser segment description: ${description}`, { modelId })).trim();
```

Compare to the correct pattern used in `classify/route.ts`:
```typescript
const classifyPrompt = buildClassifyPrompt(metricList);
const result = await generateText(userMessage, { modelId, systemPrompt: classifyPrompt });
```

The `generateText` function signature (in `src/lib/gemini.ts`) accepts a `systemPrompt` option. The segment SQL route does not use it, causing the entire multi-paragraph system prompt to be prepended to the user message. This may work currently because Gemini is permissive about system vs user content, but it is architecturally wrong and may cause unexpected behavior with future model changes.

This is a pre-existing bug — it predated the prompt extraction in PR #32. PR #32 touched this file (migrating the inline prompt to `buildSegmentSqlPrompt`) and is the natural moment to fix the calling convention.

Flagged by: kieran-typescript-reviewer.

## Proposed Solutions

**Option A (Recommended): Pass as systemPrompt option**
```typescript
const systemPrompt = buildSegmentSqlPrompt(datasetId);
const sql = (await generateText(description, { modelId, systemPrompt })).trim();
```
- Effort: Small | Risk: Very Low (straightforward fix, consistent with all other routes)

**Option B: Keep as-is but document the pattern**
- Add a comment explaining the concatenation is intentional
- Effort: Trivial | Risk: Low (but this pattern is inconsistent and wrong)

## Recommended Action

Option A — fix the calling convention.

## Technical Details

- File: `src/app/api/segments/generate-sql/route.ts` lines 20-23
- Cross-reference: `src/lib/gemini.ts` — `generateText` signature for `systemPrompt` option

## Acceptance Criteria

- [ ] `buildSegmentSqlPrompt` return value is passed as `systemPrompt`, not concatenated into user message
- [ ] User message to `generateText` is only `description`
- [ ] `pnpm build` passes with 0 type errors
- [ ] Manual test: segment SQL still generates correctly

## Work Log

- 2026-03-03: Found by kieran-typescript-reviewer on PR #32 review
- 2026-03-03: Resolved in commit 2a3b248. segments/generate-sql/route.ts now passes prompt via { systemPrompt } option, consistent with all other generateText calls.
