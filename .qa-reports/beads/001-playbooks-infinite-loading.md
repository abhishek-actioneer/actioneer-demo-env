# BEAD-001: Playbooks page stuck in infinite loading

**Severity:** CRITICAL
**Category:** Functional + Silent Failure
**Page:** /playbooks
**Ship-Readiness Impact:** BLOCK

---

## Summary

Navigating to `/playbooks` shows a spinner with "Setting up your first playbook..." that never resolves. The console logs `Playbook seed error: TypeError: network error` but no error state is shown to the user. There is no retry button, no timeout, no way to proceed. The page is completely non-functional.

## Screenshot

![Playbooks stuck loading](evidence/qa-playbooks.png)

## Console Output

```
[2026-03-20T07:35:42.946Z] [error] Playbook seed error: TypeError: network error
```

## Root Cause (source trace)

**File:** `src/app/playbooks/page.tsx` (lines 44–157)

The `seedPlaybook` callback makes a streaming POST to `/api/playbook/create`:

```typescript
// line 52
const res = (await apiFetch("/api/playbook/create", {
  method: "POST",
  body: { query: SEED_PROMPT, proceedWithout: true, datasetId: capturedDatasetId },
  stream: true,
  signal: abort.signal,
})) as Response;
```

When this request fails with a network error (e.g., the API route doesn't exist, or the Gemini API key is missing/invalid), the catch block at line 150 logs the error and calls `markDatasetSeeded()` — preventing retries — but sets `isSeeding` back to `false` without showing an error state:

```typescript
// line 149-154
} catch (err) {
  if (err instanceof DOMException && err.name === "AbortError") return;
  console.error("Playbook seed error:", err);
  markDatasetSeeded(capturedDatasetId);  // ← prevents retry forever
} finally {
  setIsSeeding(false);
}
```

The render logic at line 236-241 shows the spinner when `isSeeding` is true:

```typescript
// line 236-241
{isSeeding && (
  <div className="flex flex-col items-center gap-3 py-20">
    <Loader2 className="size-8 animate-spin text-muted-foreground" />
    <p className="text-sm text-muted-foreground">Setting up your first playbook...</p>
  </div>
)}
```

But after the error, `isSeeding` becomes `false` and `savedSummaries` is still empty, so the page falls through to the empty playbook list — but `markDatasetSeeded` prevents the auto-seed from running again. The user sees an empty page with no explanation.

**The real bug:** After the network error, the user should see either:
1. An error state with a retry button, OR
2. The normal empty state with "New Playbook" as the entry point

Instead they see... nothing. The spinner disappears and the page is just blank.

## Repro Steps

1. Navigate to http://localhost:3003/playbooks
2. Observe spinner "Setting up your first playbook..."
3. Wait 10+ seconds
4. Check console: `Playbook seed error: TypeError: network error`
5. Page never transitions to a usable state

## Why This Is Critical

- **Silent failure:** Error occurs with zero user feedback
- **No recovery path:** `markDatasetSeeded()` prevents auto-retry. Only a page refresh + localStorage clear would restart the flow
- **Blocks entire feature:** Playbooks are completely inaccessible
