---
status: resolved
priority: p2
issue_id: "025"
tags: [code-review, cleanup, prompts, dead-code]
dependencies: []
---

# Dead code left by prompt extraction: shim file, dead exports, redundant variable

## Problem Statement

PR #32 extracted prompts cleanly but left several pieces of dead code: a shim file with zero callers, two exported constants that are never imported anywhere, a redundant logging variable, and an unused exported function. These add confusion for future maintainers and pollute the public API surface.

## Findings

### 1. `src/lib/datasets/generic-prompts.ts` — entire file has zero callers
Every caller was updated to import from `@/lib/prompts/schema-generic` directly in the same PR. The shim re-export file now has no `import from "@/lib/datasets/generic-prompts"` references anywhere in the codebase. The comment saying "kept for backward compatibility" is misleading — there is nothing left to be compatible with.

### 2. `src/lib/prompts/dataset-enrichment.ts:12-13` — `OUTPUT_JSON_ONLY` exported but never imported
```typescript
export const OUTPUT_JSON_ONLY =
  "Respond with ONLY valid JSON. No markdown, no explanation, no code fences.";
```
Zero `import ... OUTPUT_JSON_ONLY` references in the codebase. The actual JSON-only instruction is embedded as freeform text inside `buildColumnAnalysisPrompt` at line 49, not via this constant.

### 3. `src/lib/prompts/classify.ts:11` — `CLASSIFY_SYSTEM` exported as raw template with `{METRICS}` placeholder
```typescript
export const CLASSIFY_SYSTEM = `...{METRICS}...`;
export function buildClassifyPrompt(metricList: string): string {
  return CLASSIFY_SYSTEM.replace("{METRICS}", metricList);
}
```
All callers only import `buildClassifyPrompt`, never `CLASSIFY_SYSTEM`. Exporting the raw template leaks an implementation detail — if a caller imports `CLASSIFY_SYSTEM` without calling `.replace("{METRICS}", ...)`, it will produce a broken prompt with a literal `{METRICS}` placeholder.

### 4. `src/app/api/datasets/upload/route.ts:418-429` — `beforeSentinelFilter` variable powers a redundant log
```typescript
const beforeSentinelFilter = allTableNames.length;
allTableNames = allTableNames.filter(...);
if (beforeSentinelFilter !== allTableNames.length) {
  console.log(`[upload] filtered ${dropped} sentinel system table(s)`);
}
```
The per-table `console.warn` on line 422 already logs each dropped table by name. The summary "filtered N sentinel system table(s)" log adds no actionable information. The `beforeSentinelFilter` variable exists solely to power this redundant log.

### 5. `src/lib/prompts/schema-generic.ts` — `buildGenericSchemaContext` exported but never called
The function is exported but the upload route's fallback blocks (CSV: lines 286-300, DuckDB: lines 519-534) both manually build the same string inline rather than calling this function.

Flagged by: code-simplicity-reviewer, pattern-recognition-specialist, architecture-strategist.

## Proposed Solutions

**Option A (Recommended): Delete all dead code in one pass**
- Delete `src/lib/datasets/generic-prompts.ts`
- Remove `export` from `CLASSIFY_SYSTEM` (keep the `const` for internal use)
- Remove `export const OUTPUT_JSON_ONLY` or use it in `buildColumnAnalysisPrompt`
- Remove `beforeSentinelFilter` and the summary log block
- Either delete `buildGenericSchemaContext` or use it in the upload fallback blocks
- Effort: Small | Risk: Very Low

**Option B: Staged cleanup over multiple PRs**
- Address each item individually
- Higher overhead, more PR churn for minor changes
- Effort: Medium overall | Risk: Same

## Recommended Action

Option A — clean it all up in a single focused PR. These are all non-behavioral changes.

## Technical Details

- `src/lib/datasets/generic-prompts.ts` — delete entirely
- `src/lib/prompts/classify.ts:11` — remove `export` keyword
- `src/lib/prompts/dataset-enrichment.ts:12-13` — remove export or use in buildColumnAnalysisPrompt
- `src/app/api/datasets/upload/route.ts:418, 426-429` — remove beforeSentinelFilter and summary log
- `src/lib/prompts/schema-generic.ts:107-121` — delete or wire up in upload fallback blocks

## Acceptance Criteria

- [ ] `src/lib/datasets/generic-prompts.ts` is deleted
- [ ] `CLASSIFY_SYSTEM` is not exported (still usable internally in classify.ts)
- [ ] `OUTPUT_JSON_ONLY` is either removed or wired into `buildColumnAnalysisPrompt`
- [ ] `beforeSentinelFilter` variable is removed from upload route
- [ ] `pnpm build` passes with 0 type errors
- [ ] `pnpm lint` passes with 0 errors

## Work Log

- 2026-03-03: Found by code-simplicity-reviewer, pattern-recognition-specialist, architecture-strategist on PR #32 review
- 2026-03-03: Resolved in commit 2a3b248. All 5 dead code items removed: generic-prompts.ts shim deleted, OUTPUT_JSON_ONLY removed, CLASSIFY_SYSTEM unexported, beforeSentinelFilter variable removed, buildGenericSchemaContext removed.
