---
status: pending
priority: p3
issue_id: "026"
tags: [code-review, prompts, cleanup, forecast, playbook]
dependencies: []
---

# Remaining inline LLM prompts not extracted: forecast/, playbook/, chat/, ack/

## Problem Statement

PR #32 extracted prompts from the core analytics pipeline (sql-generator, action-recommender, classify, knowledge/parse, segments/generate-sql, schema-enricher). However, several feature areas were left with inline LLM system prompts — the same pattern the PR was designed to eliminate. These will drift independently and are harder to audit.

## Findings

The following files contain inline multi-paragraph LLM system prompts that were not extracted:

### forecast/ routes
- `src/app/api/forecast/generate-sql/route.ts:16` — SQL generation for forecasting
- `src/app/api/forecast/predict/route.ts:41` — Time-series forecasting prompt
- `src/app/api/forecast/seed/route.ts:75` — Error-fixing/retry prompt

### playbook/ routes
- `src/app/api/playbook/create/route.ts:19` — Playbook creation system prompt
- `src/app/api/playbook/create/route.ts:61` — Playbook action prompt
- `src/app/api/playbook/create/route.ts:338` — Third inline prompt in same file
- `src/app/api/playbook/edit/route.ts:51` — Edit prompt
- `src/app/api/playbook/intent/route.ts:53` — Intent classification prompt

### Other
- `src/app/api/knowledge/add/route.ts:16` — Categorization prompt (semantically related to the extracted `PARSE_PROMPT` in knowledge.ts)
- `src/app/api/chat/route.ts:26` — Chat persona instruction fragment
- `src/app/api/ack/route.ts:33` — Acknowledgment prompt

Flagged by: pattern-recognition-specialist.

## Proposed Solutions

**Option A (Recommended): Extract feature-by-feature**
- `src/lib/prompts/forecast.ts` — 3 forecast prompts
- `src/lib/prompts/playbook.ts` — 5 playbook prompts
- Add `CATEGORIZATION_PROMPT` to `src/lib/prompts/knowledge.ts` (alongside existing `PARSE_PROMPT`)
- Move chat fragment to `src/lib/prompts/chat.ts`
- Effort: Medium | Risk: Low

**Option B: Extract only the large ones**
- Focus on `playbook/create/route.ts` (374 lines, 3 embedded prompts) first
- Leave small single-line fragments in place
- Effort: Small | Risk: Very Low

## Recommended Action

Option B for now — prioritize `playbook/create/route.ts` which has the most severe inline-prompt density. Schedule the rest as follow-up.

## Technical Details

- Primary target: `src/app/api/playbook/create/route.ts` (3 prompts, ~374 lines)
- Secondary: `src/app/api/forecast/` (3 prompts across 3 files)
- New files needed: `src/lib/prompts/playbook.ts`, `src/lib/prompts/forecast.ts`

## Acceptance Criteria

- [ ] No multi-paragraph system prompt strings are inline in `playbook/create/route.ts`
- [ ] New prompt files follow `buildXxxPrompt` / `SCREAMING_SNAKE` naming convention
- [ ] `pnpm build` passes with 0 type errors

## Work Log

- 2026-03-03: Found by pattern-recognition-specialist on PR #32 review
