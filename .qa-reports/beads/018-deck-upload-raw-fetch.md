# BEAD-018: use-deck-upload-to-board.ts uses raw fetch instead of apiFetch

**Severity:** LOW
**Category:** Consistency / Convention
**Page:** Board (deck upload flow)
**Ship-Readiness Impact:** INFO
**PR:** #48

---

## Summary

`src/hooks/use-deck-upload-to-board.ts:86` uses raw `fetch("/api/decks/process", ...)` instead of `apiFetch`. This bypasses the auto-injected `x-dataset-id` and `x-model-id` headers that `apiFetch` provides.

## Root Cause

**File:** `src/hooks/use-deck-upload-to-board.ts` (line 86)

```typescript
const res = await fetch("/api/decks/process", {
  method: "POST",
  body: formData,
});
```

Per AGENTS.md convention: "All frontend→backend calls MUST use `apiFetch`" with the only exception being FormData uploads (multipart).

## Assessment

This is a FormData upload (multipart), so it falls under the documented exception. However, the route may still need `x-dataset-id` for dataset-scoped processing. If the API route reads dataset from headers, this call will be missing it.

## Fix

Check if `/api/decks/process` reads `x-dataset-id` from headers. If yes, manually add the header:
```typescript
const res = await fetch("/api/decks/process", {
  method: "POST",
  body: formData,
  headers: { "x-dataset-id": datasetId },
});
```

If the route doesn't need dataset context, document this as an intentional exception with a comment.
