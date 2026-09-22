---
status: pending
priority: p3
issue_id: "097"
tags: [code-review, quality, error-handling, pr-41]
dependencies: []
---

# Client page handlers swallow server error messages — bare `catch {}` shows generic string

## Problem Statement

All three generation page handlers use bare `catch` blocks that discard the actual API error:

```ts
// segments/page.tsx:123, metrics/page.tsx:89, knowledge/page.tsx:171
} catch { setGenError("Generation failed. Please try again."); }
```

The server returns structured errors: `{ error: "No schema data available. Enrich the dataset first." }` (404), `{ error: "All generated segments failed SQL validation", failed: 5 }` (422), etc. These are actionable messages that tell the user exactly what went wrong. The client discards them and shows a static fallback string.

Additionally, the `apiFetch` wrapper may throw with a meaningful error message. That too is lost.

## Proposed Solutions

**Option A (Recommended): Extract error message from response body**
```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : "Generation failed. Please try again.";
  setGenError(msg);
}
```
Or better — read the server JSON error in the success path:
```ts
const result = await apiFetch<GenerateResult | { error: string }>(...);
if ("error" in result) { setGenError(result.error); return; }
```
- Effort: Trivial | Risk: None

## Recommended Action

Option A — surface `err.message` for Error instances, keep static fallback as last resort.

## Technical Details

- **Affected files:**
  - `src/app/segments/page.tsx` line 123
  - `src/app/metrics/page.tsx` line 89
  - `src/app/knowledge/page.tsx` line 171

## Acceptance Criteria

- [ ] When server returns `{ error: "No schema data available..." }`, that message appears in the UI
- [ ] The static fallback string is only shown when no better message is available

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (pattern recognition agent) | Server returns rich error context that should reach the user |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
