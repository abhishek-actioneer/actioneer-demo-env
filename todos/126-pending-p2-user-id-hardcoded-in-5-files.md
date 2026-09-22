---
status: pending
priority: p2
issue_id: "126"
tags: [code-review, architecture, auth, pr-48]
dependencies: []
---

# USER_ID = "default" copy-pasted across 5 files — future auth change will miss some

## Problem Statement

`const USER_ID = "default"; // Future: extract from session` appears independently in 5 files:

- `src/lib/server/board-repo.ts:4`
- `src/app/api/conversations/route.ts:3`
- `src/app/api/conversations/[id]/route.ts:3`
- `src/app/api/conversations/[id]/beacon/route.ts:3`
- `src/app/api/conversations/migrate/route.ts:3`

When multi-user auth is added, all 5 must be updated. Missing even one leaves some routes still using `"default"`, creating partial isolation — a hard-to-detect bug where some data is user-scoped and some is shared.

## Findings

Source: Architecture Strategist + Security Sentinel + Pattern Reviewer.

- 5 identical constant declarations across 5 route files
- `meta-db.ts:27` has `DEFAULT 'default'` in schema — existing rows will need migration when real users are added
- The pattern creates divergence risk: each file's `USER_ID` is an independent constant

## Proposed Solutions

**Option A (Recommended): Centralize in a shared stub function**
Create `src/lib/server/auth.ts`:
```ts
// Future: extract from session cookie
export function getRequestUserId(_req: Request): string {
  return "default";
}
```
Replace all 5 `const USER_ID = "default"` with `getRequestUserId(req)` calls. Future multi-user change is one function edit.

**Option B: Re-export from meta-db.ts**
```ts
export const DEFAULT_USER_ID = "default";
```
Import and use everywhere. Less correct (no request context) but simpler.

## Recommended Action

Option A — stub function that takes `req` parameter is ready for the real implementation.

## Technical Details

- **Affected files:** 5 files listed above
- **Low risk change** — all call sites just need an import swap

## Acceptance Criteria

- [ ] Single source of truth for the user ID stub
- [ ] All 5 files import from the shared location
- [ ] Future auth implementation is a one-file change

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (architecture-strategist, security-sentinel) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
