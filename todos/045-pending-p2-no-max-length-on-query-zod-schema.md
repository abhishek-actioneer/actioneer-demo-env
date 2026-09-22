---
status: done
priority: p2
issue_id: "045"
tags: [code-review, security, performance, pr-28]
dependencies: []
---

# No .max() length limit on `query` field in API Zod schemas

## Problem Statement

The new `quotedContext` feature in PR #28 allows users to select arbitrary text from AI reports and prepend it to their next query as a markdown blockquote. The combined string is submitted as the `query` field to `/api/analyze`, `/api/chat`, and `/api/classify` — but none of these routes enforce a maximum string length via their Zod schemas.

A user selecting an entire large report section could send a query of 30,000+ characters, causing:
- Token cost explosion (Gemini charges per input token)
- Context window pollution (dilutes SQL schema + system prompts that live at the start of the prompt)
- Memory pressure on Railway in production

## Findings

**Files affected:**
- `src/app/api/analyze/route.ts:42`: `query: z.string().min(1),`
- `src/app/api/chat/route.ts:7`: `query: z.string().min(1),`
- `src/app/api/classify/route.ts:6`: `query: z.string().min(1),`

**Root cause:** The quotedContext flow in `chat-input.tsx` lines 178-179:
```ts
const fullText = quotedContext
  ? `> ${quotedContext}\n\n${text}`
  : text;
```
`quotedContext` comes from `window.getSelection().toString()` — unbounded.

## Proposed Solutions

### Option A: Server-side .max() only
Add `.max(8000)` to all three Zod `query` fields. Returns 400 if exceeded.

**Pros:** Single enforcement point, stateless
**Cons:** User gets no feedback until submit

### Option B: Client + server (Recommended)
1. Server: Add `.max(8000)` to all three schemas
2. Client: In `chat-input.tsx`, truncate in `setQuotedContext`:
```ts
setQuotedContext: (text: string) => {
  setQuotedContext(text.slice(0, 2000)); // max 2000 chars selected
  requestAnimationFrame(() => textareaRef.current?.focus());
},
```

**Pros:** Immediate user feedback (text truncates visibly), prevents token waste
**Cons:** Slightly more code

**Recommended: Option B**

## Technical Details

- **Affected files:**
  - `src/app/api/analyze/route.ts`
  - `src/app/api/chat/route.ts`
  - `src/app/api/classify/route.ts`
  - `src/components/chat/chat-input.tsx` (optional client truncation)
- **PR context:** PR #28 introduced quotedContext feature

## Acceptance Criteria

- [x] All three Zod schemas have `.max(N)` on the `query` field
- [x] Requests over the limit return 400 with a clear error message
- [x] Optionally: `setQuotedContext` truncates client-side with a reasonable limit
- [x] Existing tests still pass

## Work Log

- 2026-03-03: Identified during PR #28 code review (security-sentinel agent)
- 2026-03-03: Fixed (Option B) in commit c8ac13a on vimarsh
