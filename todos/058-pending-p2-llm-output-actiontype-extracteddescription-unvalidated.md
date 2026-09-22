---
status: pending
priority: p2
issue_id: "058"
tags: [code-review, security, prompt-injection, classify-route]
dependencies: []
---

# LLM-extracted actionType and extractedDescription not allowlist-validated before use in control flow

## Problem Statement

`POST /api/classify/route.ts` returns `actionType` and `extractedDescription` from raw Gemini JSON output with only a `typeof result.actionType === "string"` check. `extractedDescription` is passed downstream to `/api/segments/generate-sql` as the description input — and to further LLM calls — without length cap or sanitization. `actionType` drives control flow without enum allowlisting. If a malicious query causes Gemini to output an unexpected `actionType` or inject content into `extractedDescription`, it propagates unchecked into downstream LLM calls.

## Findings

- `src/app/api/classify/route.ts` lines 31-32 — loose `typeof result.actionType === "string"` check only; no enum validation.
- `src/hooks/use-analytics.ts` line ~246 — passes `classified.extractedDescription || text` directly to the generate-sql endpoint without sanitization or length cap.
- `src/hooks/use-action-handlers.ts` line 228 (`handleSegmentRefine`) — same pattern: `extractedDescription` passed forward unchecked.
- No Zod schema on the `/api/segments/generate-sql` route validates the incoming description for length.
- A crafted user message that causes Gemini to output injected content in `extractedDescription` will propagate that content verbatim into the next LLM call's prompt.

## Proposed Solutions

### Option A: Zod enum for actionType + length cap on extractedDescription

In `/api/classify/route.ts`, parse the Gemini response through a Zod schema:

```typescript
const classifyResponseSchema = z.object({
  intent: z.enum(["analytics", "direct", "create-segment", "refine-segment"]),
  actionType: z.enum(["create-segment", "refine-segment"]).optional(),
  extractedDescription: z.string().max(500).optional(),
});
```

Return an error or fall back to `"direct"` intent if the schema parse fails. Apply the same `max(500)` in `/api/segments/generate-sql/route.ts` Zod schema.

### Option B: Treat extractedDescription as untrusted user input

Regardless of schema validation on the classify route, truncate `extractedDescription` to 200 chars at every consumption site in `use-analytics.ts` and `use-action-handlers.ts`. Wrap in delimiters before passing to any LLM prompt (same pattern as issue 057 Option B).

## Recommended Action

Option A is the correct fix — it validates at the source (LLM output parsing) rather than at every downstream consumption site. Option B is a useful defense-in-depth layer that should be applied in addition to A.

## Technical Details

- Affected files: `src/app/api/classify/route.ts`, `src/hooks/use-analytics.ts`, `src/hooks/use-action-handlers.ts`, `src/app/api/segments/generate-sql/route.ts`.
- `actionType` drives a conditional branch that triggers a segment creation or refinement flow — an unexpected value could silently fall through or trigger unintended behavior.
- `extractedDescription` is used as the seed prompt for a SQL-generating LLM call, making injection particularly impactful.

## Acceptance Criteria

- [ ] `actionType` from Gemini output is validated against an allowlist enum before use in control flow.
- [ ] `extractedDescription` has a maximum length enforced at the classify route before returning to the client.
- [ ] `extractedDescription` has a maximum length enforced at the generate-sql route Zod schema.
- [ ] An unexpected `actionType` value from Gemini causes the classify route to return a safe fallback (e.g., `"direct"` intent) rather than propagating the unknown value.
- [ ] Existing classify behavior for valid `actionType` values is unchanged.

## Work Log

## Resources

- `src/app/api/classify/route.ts`
- `src/hooks/use-analytics.ts`
- `src/hooks/use-action-handlers.ts`
- `src/app/api/segments/generate-sql/route.ts`
- Related: issue 057 (pageContext injection)
