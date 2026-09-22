---
title: "fix: P0 Auth & Authorization Hardening"
type: fix
status: completed
date: 2026-03-31
---

# P0 Auth & Authorization Hardening

## Overview

The app has Clerk authentication at the edge (`src/proxy.ts` with `auth.protect()`), but **authorization** is missing from ~49 API routes. Authenticated users can access other users' datasets, and the onboarding gate is client-side only (bypassable via localStorage). This plan closes 3 P0 gaps without touching DuckDB tenant isolation (architectural, deferred).

## Problem Statement

1. **No dataset ownership verification** — `getDataset(id)` returns ANY dataset without checking who's asking. The `x-dataset-id` header is trusted blindly. An authenticated user can access another user's uploaded data by guessing the dataset ID.
2. **~49 API routes skip `auth()` calls** — While `proxy.ts` ensures authentication, these routes never extract `userId`, so they can't enforce ownership. Routes like `/api/query` execute arbitrary SQL against any dataset.
3. **Onboarding gate is client-side only** — `OnboardingGate` checks localStorage, bypassable with one line of JS. No server-side enforcement.

## Proposed Solution

Three changes, ordered by implementation dependency:

### Change 1: `getDatasetForUser()` helper

Add to `src/lib/datasets/index.ts` next to `getAllDatasetsForUser()`.

**Rules:**
- `ownerId === userId` → allow (user's own upload)
- `ownerId && ownerId !== userId` → deny (another user's upload)
- Static sample dataset (no ownerId, not dynamic) → allow (shared demo data, not sensitive)
- Dynamic dataset with no ownerId → deny (legacy orphan)
- Requested ID doesn't match returned ID (silent fallback triggered) → deny

**Design decision: static samples are unrestricted.** `selectedSampleDatasets` is a UI preference for which datasets appear in the sidebar — not a security boundary. Static samples are shared demo data. Restricting API access adds complexity (requires Clerk API call per request to read metadata) without security benefit. This matches the existing behavior where `getAllDatasetsForUser` only filters the listing, not individual access.

**Signature:**
```typescript
export function getDatasetForUser(
  id: string,
  userId: string,
): DatasetConfig | null  // null = denied
```

Returns `null` on denial (caller converts to 404). No Clerk API call needed — ownership is determined from the dataset's `ownerId` field alone.

### Change 2: Add `auth()` + ownership to unprotected API routes

Since `proxy.ts` already runs `auth.protect()`, calling `auth()` in route handlers is guaranteed to return a `userId`. The pattern:

```typescript
import { auth } from "@clerk/nextjs/server";
import { getDatasetForUser } from "@/lib/datasets";

const { userId } = await auth();
if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
const dataset = getDatasetForUser(datasetId, userId!);
if (!dataset) return Response.json({ error: "Not found" }, { status: 404 });
```

**Batched by similarity:**

| Batch | Routes | Count | Notes |
|-------|--------|-------|-------|
| 1: LLM | `chat`, `classify`, `ack`, `complete`, `recommend` | 5 | Same pattern — read datasetId, call LLM |
| 2: SQL | `analyze`, `query`, `schema/tables`, `chart-requery` | 4 | Higher risk — SQL execution |
| 3: Data | `events`, `ingest`, `integrations` | 3 | Write operations |
| 4: Canvas | `canvas-query`, `canvas-comment`, `canvas-present`, `canvas-drilldown`, `canvas-frame-title`, `canvas-collective`, `canvas-refresh` | 7 | All follow same canvas pattern |
| 5: Features | `explorer`, `explorer/funnel`, `explorer/retention`, `forecast/*` (3), `metrics` (1), `metrics/generate`, `metrics/infer-relationships`, `metric-update`, `knowledge/*` (4), `board-generate`, `board-from-research`, `decks/process` | ~16 | Mixed but each is straightforward |
| 6: Playbook ops | `playbook/create`, `playbook/edit`, `playbook/run`, `playbook/validate` | 4 | Note: `/api/playbooks/` (CRUD) already has auth |
| 7: Segment subs | `segments/count`, `segments/generate-all`, `segments/[id]/composition`, `segments/[id]/overview`, `segments/[id]/users`, `segments/[id]/users/distinct`, `segments/[id]/push`, `segments/[id]/movement`, `segments/[id]/overlap` | 9 | Note: `/api/segments/` (CRUD) already has auth |
| 8: Board subs | `boards/[id]/cards/[cardId]`, `boards/[id]/sections/[sectionId]`, `boards/[id]/frames/[frameId]`, `boards/[id]/connections/[connId]`, `boards/[id]/beacon`, `boards/migrate`, `conversations/[id]/beacon` | ~7 | Sub-resource routes |

**Total: ~55 route handlers across ~49 files.**

### Change 3: Server-side onboarding gate in `proxy.ts`

Add an onboarding completion check after `auth.protect()`. 

**Critical edge cases from SpecFlow analysis:**

1. **JWT caching (CRITICAL):** After `POST /api/onboarding/complete` writes `publicMetadata`, the Clerk session JWT won't reflect the change for up to 60 seconds. If the middleware reads `onboardingComplete` from the JWT, it will redirect the user back to onboarding immediately after completion.

   **Solution:** Use a **dual-gate** approach:
   - Middleware checks `sessionClaims.metadata.onboardingComplete` (from JWT) as defense-in-depth
   - Client-side `OnboardingGate` remains the primary gate for the immediate post-completion redirect
   - After `POST /api/onboarding/complete`, call `await clerk.session?.reload()` to force JWT refresh
   - The middleware tolerates stale JWTs gracefully — it only blocks clearly non-onboarded users

2. **Onboarding routes must be exempted (CRITICAL):** During onboarding, the user calls:
   - `/onboarding/*` pages
   - `/api/onboarding/complete`
   - `/api/datasets/upload` (step 3: syncing)
   - `/api/datasets/*/enrich` (schema enrichment)
   
   All must be exempt from the onboarding gate.

3. **API routes need 403, not 302 (CRITICAL):** Redirecting API routes breaks `apiFetch`. Differentiate:
   - Page routes → `NextResponse.redirect("/onboarding/account")`
   - API routes → `Response.json({ error: "Onboarding required" }, { status: 403 })`

**Updated `isOnboardingExempt` matcher:**
```typescript
const isOnboardingExempt = createRouteMatcher([
  "/onboarding(.*)",
  "/api/onboarding(.*)",
  "/api/datasets/upload",
  "/api/datasets/(.*)/enrich",
  "/auth(.*)",
  "/api/health",
]);
```

**Clerk session claims setup:** Configure Clerk Dashboard to sync `publicMetadata` into the session token. Then read via `auth().sessionClaims?.metadata?.onboardingComplete`. This avoids a Clerk API call on every request.

**If session claims are not configured**, fall back to NOT enforcing onboarding in middleware (rely on client-side OnboardingGate only). The middleware gate is defense-in-depth, not the primary mechanism.

## Technical Considerations

### `getDataset()` silent fallback
`getDataset(unknownId)` falls back to `DEFAULT_DATASET` instead of throwing. `getDatasetForUser()` must verify the returned dataset's `id` matches the requested `id` to prevent this from masking unauthorized access:

```typescript
export function getDatasetForUser(id: string, userId: string): DatasetConfig | null {
  const ds = (() => {
    try { return getDataset(id); } catch { return null; }
  })();
  if (!ds || ds.id !== id) return null;  // unknown or fallback — deny
  if (ds.ownerId && ds.ownerId !== userId) return null;  // another user's upload
  if (ds.isDynamic && !ds.ownerId) return null;  // legacy orphan
  return ds;
}
```

### Routes that already have `auth()` (26 files)
These routes already extract `userId` and pass it to repo functions. They should ALSO add dataset ownership checks where they read `x-dataset-id`. This is a smaller change — just add `getDatasetForUser()` call after their existing `auth()` block.

### Performance
- `getDatasetForUser()` is pure in-memory — reads from `STATIC_DATASETS` map and `dynamicRegistry` cache. No I/O.
- No Clerk API calls needed for ownership checks (ownerId is on the dataset config).
- Onboarding check in middleware reads from JWT session claims (no API call).

### What this does NOT fix (deferred)
- DuckDB row-level security (architectural — requires user_id columns in uploaded data)
- Rate limiting on LLM/SQL endpoints
- Logout localStorage cleanup
- publicMetadata → privateMetadata migration for role/orgName

## Acceptance Criteria

- [x] `getDatasetForUser(id, userId)` exists in `src/lib/datasets/index.ts` and returns `null` for unauthorized access
- [x] All ~49 previously unprotected API routes call `auth()` and validate dataset ownership
- [x] An authenticated user cannot access another user's uploaded dataset via any API route
- [x] `proxy.ts` checks onboarding completion for non-exempt routes (if session claims are configured)
- [x] API routes return 403 JSON (not 302 redirect) when onboarding is incomplete
- [x] Onboarding flow still works end-to-end: sign up → upload → complete → access app
- [x] `/api/datasets/upload` and `/api/datasets/*/enrich` work during onboarding (before completion)
- [x] `pnpm build` passes
- [ ] Existing auth-protected routes still work correctly

## Implementation Order

1. **`getDatasetForUser()`** — standalone helper, no dependencies
2. **Batch 1-8 route hardening** — can be parallelized across batches
3. **`proxy.ts` onboarding gate** — add after route hardening is verified working
4. **Verify onboarding flow** — end-to-end test of sign-up → onboarding → app access

## Sources

- `src/proxy.ts` — existing Clerk middleware (auth.protect, route matcher)
- `src/lib/datasets/index.ts:23-31` — `getDataset()` with silent fallback
- `src/lib/datasets/index.ts:42-55` — `getAllDatasetsForUser()` ownership logic (model for new helper)
- `src/app/api/conversations/route.ts` — canonical auth pattern to replicate
- `src/components/onboarding/onboarding-gate.tsx` — client-side gate (stays as primary)
- `docs/solutions/build-errors/nextjs-16-middleware-proxy-file-conflict.md` — MUST use `proxy.ts`, not `middleware.ts`
