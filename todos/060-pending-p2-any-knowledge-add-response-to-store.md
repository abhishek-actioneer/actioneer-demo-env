---
status: pending
priority: p2
issue_id: "060"
tags: [code-review, typescript, type-safety, use-action-handlers]
dependencies: []
---

# Untyped `any` on /api/knowledge/add response passed directly to knowledge store

## Problem Statement

`use-action-handlers.ts` uses an `eslint-disable-next-line @typescript-eslint/no-explicit-any` suppression to type the `/api/knowledge/add` response as `{ entry: any }`, then immediately spreads the result into `saveKnowledgeEntry()`. A shape mismatch between the actual API response and the expected `KnowledgeEntry` type will cause a silent runtime error inside the store rather than a TypeScript compile-time error — the exact failure mode that TypeScript is meant to prevent.

## Findings

`src/hooks/use-action-handlers.ts` lines 130-137:

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { entry } = await apiFetch<{ entry: any }>("/api/knowledge/add", {
  method: "POST",
  body: JSON.stringify({ ... }),
});
saveKnowledgeEntry({ ...entry, sourceConversationId: conversationId });
```

- The `eslint-disable` comment signals that the author was aware of the type escape but chose to suppress rather than fix it.
- `saveKnowledgeEntry` expects a `KnowledgeEntry` shape; spreading `any` means no compile-time check on required fields.
- If the API response evolves (e.g., renames a field), this call site will silently pass malformed data to the store.

## Proposed Solutions

### Option A: Type the response with the existing KnowledgeEntry type

Import `KnowledgeEntry` from `@/lib/knowledge-types` (or wherever it is defined) and type the `apiFetch` generic:

```typescript
import type { KnowledgeEntry } from "@/lib/knowledge-types";

const { entry } = await apiFetch<{ entry: KnowledgeEntry }>("/api/knowledge/add", {
  method: "POST",
  body: JSON.stringify({ ... }),
});
saveKnowledgeEntry({ ...entry, sourceConversationId: conversationId });
```

Remove the `eslint-disable` comment. TypeScript will now catch any field mismatches at compile time.

### Option B: Define an inline interface matching the API response shape

If `KnowledgeEntry` is not directly importable at the hook level, define an inline response interface that mirrors the API's returned shape. Less reuse than Option A but eliminates the `any`.

## Recommended Action

Option A. The `KnowledgeEntry` type already exists in the codebase and should be reused. Removing the eslint-disable is a quality signal that the type is now correct.

## Technical Details

- Affected file: `src/hooks/use-action-handlers.ts` lines 130-137.
- `KnowledgeEntry` type location: likely `src/lib/knowledge-types.ts` or co-located with `knowledge-store.ts`.
- `apiFetch` is a typed wrapper — using the correct generic is the intended API.

## Acceptance Criteria

- [ ] `apiFetch<{ entry: KnowledgeEntry }>` is used with the correct type (no `any`).
- [ ] The `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment is removed.
- [ ] `pnpm build` passes with no TypeScript errors at this call site.
- [ ] If the API response shape ever diverges from `KnowledgeEntry`, the build fails rather than silently accepting bad data.

## Work Log

## Resources

- `src/hooks/use-action-handlers.ts`
- `src/lib/knowledge-types.ts` (or equivalent)
- `src/lib/knowledge-store.ts`
