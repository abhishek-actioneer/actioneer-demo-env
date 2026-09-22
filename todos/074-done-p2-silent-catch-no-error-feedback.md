---
status: done
priority: p2
issue_id: "074"
tags: [code-review, ux, error-handling, pr-41]
dependencies: []
---

# Silent catch {} on generation failures hides errors from users

## Problem Statement

All three generation handlers swallow errors silently:

- `src/app/segments/page.tsx:121-122` — `handleGenerateAll`: `catch { }`
- `src/app/metrics/page.tsx:89-90` — `handleGenerate`: `catch { }`
- `src/app/knowledge/page.tsx:169-170` — `handleGenerateAll`: `catch { }`

When generation fails (LLM timeout, invalid JSON, SQL validation failures, network error), the user sees the spinner stop with no feedback. They'll assume it worked and be confused when no data appears.

## Findings

Comments say "silently fail — user can retry" but there's no indication that a retry is needed. The segments page shows `generateResult` but only in the empty state container which may not be visible if the page re-rendered.

## Proposed Solutions

**Option A (Recommended): Show inline error message**
- Add `error` state: `const [genError, setGenError] = useState<string | null>(null)`
- In catch: `setGenError("Failed to generate. Try again.")`
- Display below the button or as a toast
- Effort: Small | Risk: Low

**Option B: Use a toast notification system**
- Add a shared toast component/hook
- Show error toast on failure, success toast on completion
- Effort: Medium | Risk: Low (adds a new primitive)

## Recommended Action

Option A — minimal inline error display.

## Technical Details

- **Affected files:** `src/app/segments/page.tsx`, `src/app/metrics/page.tsx`, `src/app/knowledge/page.tsx`

## Acceptance Criteria

- [ ] Failed generation shows user-visible error message
- [ ] Error clears on next attempt
- [ ] Success also shows confirmation (at least for segments, which already has `generateResult`)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review | Three pages share same silent-catch anti-pattern |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
