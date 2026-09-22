---
title: "feat: User-scoped auth, dataset isolation, and onboarding CSV upload"
type: feat
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-custom-auth-page-brainstorm.md
---

# User-Scoped Auth, Dataset Isolation & Onboarding CSV Upload

## Overview

Baby-sentinel is transitioning from internal prototype to pre-sales client demo. Clerk authentication is in place but no API route knows WHO the user is — everything runs as `USER_ID = "default"`. Datasets are global with no ownership. The onboarding wizard collects user info into localStorage that goes nowhere, and the CSV upload flow is stubbed.

This plan adds **user identity to the backend**, **scopes datasets to their owner**, **wires CSV upload into onboarding**, and **fixes auth fragility** — so that when a prospect signs up, uploads their data, and uses the product, they only see their own data.

## Problem Statement

Five structural gaps make the product unsuitable for client-facing demos:

1. **No user identity in backend** — 7+ files hardcode `USER_ID = "default"`. Two prospects on the same server see each other's conversations, segments, boards, and playbooks.
2. **Datasets are global** — `getAllDatasets()` returns everything. No `ownerId` on `DatasetConfig`. Uploaded CSVs are visible to all.
3. **Onboarding is decorative** — Wizard data (org name, role, dataset choice) stored only in localStorage, never sent to a server, lost on browser clear, and the `selectedDataset` is never transferred to `DatasetProvider`.
4. **CSV upload is stubbed in onboarding** — The "Connect" step has `handleUploadCSV()` that skips to the next step. The working upload modal (`dataset-upload-modal.tsx`) isn't used.
5. **Auth code is fragile** — Legacy Clerk import, dead `proxy.ts` file, stale CLAUDE.md, hardcoded "Admin User" in sidebar.

## Proposed Solution

Four phases, each independently shippable:

```
Phase 1: Identity Plumbing (auth works end-to-end)
Phase 2: Dataset Ownership (uploads scoped to user)
Phase 3: Onboarding → Upload (CSV in wizard, dataset activation)
Phase 4: Polish & Hardening (error handling, docs, cleanup)
```

## Key Architectural Decisions

### D1: How userId flows from Clerk to API routes

Each API route calls `auth()` directly from `@clerk/nextjs/server`. No shared wrapper, no custom header — Clerk's `auth()` reads from the request context that the middleware already established.

```typescript
import { auth } from "@clerk/nextjs/server";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // use userId in queries
}
```

**Why not a shared wrapper:** There are only ~7 files that need `userId` today. A `withAuth(handler)` abstraction is premature — it adds indirection without reducing meaningful duplication. If the pattern grows beyond 15 files, extract then.

### D2: Who owns static datasets

Static datasets (`quickhelp`, `gameramp`, `alpha`, `vastu-hfc`) have `ownerId: null` — they are **sample datasets visible to all users**. Dynamic (uploaded) datasets have `ownerId: string` set to the uploader's Clerk userId.

Visibility rule: `dataset.ownerId === null || dataset.ownerId === userId`

### D3: Dataset directory structure stays global

Keep `data/datasets/<slug>/` (no user-scoping in paths). Slug collisions between users are prevented by prefixing the userId to the slug for dynamic datasets: `<userId-prefix>-<label-slug>`. The `ownerId` field handles visibility filtering.

**Why not `data/datasets/<userId>/<slug>/`:** DuckDB instance pooling keys on `dbFile` path. Adding a user tier to the path structure requires touching `db.ts`, `dynamic-registry.ts`, and all config.json paths. The `ownerId` field achieves isolation without restructuring storage.

### D4: Onboarding completion persists to Clerk metadata

Use Clerk's `publicMetadata` (server-writable, client-readable) to store `{ onboardingComplete: true, role: string }`. This survives browser clears and works across devices. The `OnboardingGate` checks Clerk metadata first, falls back to localStorage for instant response.

### D5: Existing "default" data migration

On this branch, there are no real external users yet — this is pre-launch. The migration strategy is: **leave "default" data in place, invisible to new real users.** Any data created under `USER_ID = "default"` becomes orphaned once real auth is wired in. A developer can manually reassign via SQLite if needed. No automated migration script.

### D6: Authorization model

**Owner-only for uploads, public for samples.** A user can only see/query/delete datasets they uploaded, plus all static sample datasets. No sharing, no team access, no link-based access. RBAC and organizations are deferred.

---

## Implementation Phases

### Phase 1: Identity Plumbing

**Goal:** Every API route that handles user-scoped data knows WHO the user is. Sidebar shows real user info.

**Estimated effort:** 3-4 hours

#### 1.1 Fix middleware conflict

**Problem:** Both `middleware.ts` (root) and `src/proxy.ts` exist. The learnings doc (`docs/solutions/build-errors/nextjs-16-middleware-proxy-file-conflict.md`) says these cannot coexist in Next.js 16.

**Action:**
- [x] Delete `src/proxy.ts` (dead code, tracked in git)
- [x] Verify `middleware.ts` at root is the active one (it is — already working)
- [x] Confirm `pnpm build` succeeds after deletion

**Files:** `src/proxy.ts` (delete)

#### 1.2 Fix legacy Clerk import

**Problem:** `src/app/auth/page.tsx:4` imports from `@clerk/nextjs/legacy` — deprecated path.

**Action:**
- [x] ~~Change import~~ — Kept `/legacy` import: Clerk v7 non-legacy hooks use signal API incompatible with current auth page. `/legacy` is the intended compat layer, not deprecated.
- [x] Verified hook API is compatible with `/legacy` path
- [ ] Test: Google SSO flow still works
- [ ] Test: Email OTP flow still works

**Files:** `src/app/auth/page.tsx`

#### 1.3 Wire Clerk userId into conversation routes

**Problem:** 4 conversation API files hardcode `const USER_ID = "default"`.

**Action:**
- [x] `src/app/api/conversations/route.ts` — import `auth` from `@clerk/nextjs/server`, extract `userId`, replace `USER_ID` constant
- [x] `src/app/api/conversations/[id]/route.ts` — same
- [x] `src/app/api/conversations/[id]/beacon/route.ts` — same
- [x] `src/app/api/conversations/migrate/route.ts` — same

**Pattern for each file:**
```typescript
import { auth } from "@clerk/nextjs/server";

// Replace: const USER_ID = "default";
// With:
const { userId } = await auth();
if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
```

The SQLite schema already has `user_id` column — no migration needed. Prepared statements already accept userId as a parameter.

**Files:**
- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/route.ts`
- `src/app/api/conversations/[id]/beacon/route.ts`
- `src/app/api/conversations/migrate/route.ts`

#### 1.4 Wire Clerk userId into repo files

**Problem:** 3 server repo files hardcode `USER_ID = "default"`.

**Action:**
- [x] `src/lib/server/segment-repo.ts` — add `userId` parameter to exported functions, pass to SQL
- [x] `src/lib/server/board-repo.ts` — same. Sub-resource routes get auth() checks; board-level ownership enforced via getFullBoard(userId, boardId)
- [x] `src/lib/server/playbook-repo.ts` — same

**Important:** Board sub-resources (cards, sections, connections, frames) currently query only by `board_id` without checking the board's `user_id`. This is an IDOR gap noted in `board-repo.ts`. The fix: sub-resource queries should join through the board table to verify ownership, or the calling API route should verify board ownership before querying sub-resources.

**Files:**
- `src/lib/server/segment-repo.ts`
- `src/lib/server/board-repo.ts`
- `src/lib/server/playbook-repo.ts`

#### 1.5 Update API routes that call repos

**Problem:** API routes for segments, boards, and playbooks call repo functions but don't pass userId yet.

**Action:**
- [x] Update segment API routes to extract `userId` from `auth()` and pass to repo (6 files)
- [x] Update board API routes — same (9 files including sub-resources with auth checks)
- [x] Update playbook API routes — same (2 files)

**Files:** All `route.ts` files under `src/app/api/segments/`, `src/app/api/boards/`, `src/app/api/playbooks/` that call repo functions.

#### 1.6 Show real user info in sidebar

**Problem:** `panels.tsx:530` and `user-panel.tsx:52` hardcode "Admin User" / "admin@company.com".

**Action:**
- [x] Import `useUser` from `@clerk/nextjs` in all 3 files
- [x] Replace hardcoded strings with `user.fullName` / `user.primaryEmailAddress?.emailAddress`
- [x] Use `user.imageUrl` for the avatar (replace the placeholder icon)
- [x] Fallback to "User" / email if name is missing

**Files:**
- `src/components/sidebar/panels.tsx`
- `src/components/sidebar/user-panel.tsx`
- `src/components/sidebar.tsx` (account popover — also had hardcoded "Admin" / "admin@company.com")

#### 1.7 Verification

- [ ] Two browser sessions (different Clerk accounts) create conversations — each sees only their own
- [ ] Sidebar shows correct name/email for each user
- [ ] Segments, boards, playbooks are isolated per user
- [x] `pnpm build` succeeds
- [x] `pnpm lint` passes (0 errors, 83 pre-existing warnings)

---

### Phase 2: Dataset Ownership

**Goal:** Uploaded datasets are tagged with their owner. Users only see their uploads + sample datasets.

**Estimated effort:** 2-3 hours

#### 2.1 Add `ownerId` to DatasetConfig

**Action:**
- [x] Add `ownerId?: string | null` to `DatasetConfig` in `src/lib/datasets/types.ts`
- [x] Add to `SerializableDatasetConfig` as well (inherited via Omit — automatic)
- [x] Static datasets: `ownerId` omitted (treated as `null` — public/sample)
- [x] Dynamic datasets: `ownerId` set to Clerk userId during upload

**Files:** `src/lib/datasets/types.ts`

#### 2.2 Tag uploads with ownerId

**Action:**
- [x] In `src/app/api/datasets/upload/route.ts`:
  - Import `auth` from `@clerk/nextjs/server`
  - Extract `userId` at the top of the POST handler
  - Add `ownerId: userId` to the `DatasetConfig` object before saving
- [x] `saveDynamicDataset()` in `dynamic-registry.ts` already persists all config fields — no change needed there

**Files:** `src/app/api/datasets/upload/route.ts`

#### 2.3 Filter datasets by ownership

**Action:**
- [x] Add `getAllDatasetsForUser(userId: string)` to `src/lib/datasets/index.ts`
- [x] Update `GET /api/datasets` route to extract `userId` from `auth()` and call `getAllDatasetsForUser(userId)` instead of `getAllDatasets()`
- [x] The dataset switcher UI reads from this API — will automatically show only visible datasets

**Files:**
- `src/lib/datasets/index.ts`
- `src/app/api/datasets/route.ts`

#### 2.4 Add ownership check to dataset operations

**Action:**
- [x] In `DELETE /api/datasets` route: verify `dataset.ownerId === userId` before deletion. Static datasets cannot be deleted.
- [x] In `POST /api/datasets/[id]/enrich` route: verify ownership before re-enrichment
- [x] In `GET /api/datasets/[id]/prompts` route: verify user can see the dataset
- [x] In `GET /api/datasets/[id]/enrich` route: verify visibility before returning schema map

**Guard pattern:**
```typescript
const ds = getDataset(datasetId);
if (ds.ownerId && ds.ownerId !== userId) {
  return Response.json({ error: "Not found" }, { status: 404 }); // 404, not 403
}
```

**Files:**
- `src/app/api/datasets/route.ts` (DELETE handler)
- `src/app/api/datasets/[id]/enrich/route.ts`
- `src/app/api/datasets/[id]/prompts/route.ts`

#### 2.5 Prevent slug collisions between users

**Problem:** Two users uploading "Sales Data" both get slug `sales-data` — second upload fails.

**Action:**
- [x] In the upload route, prefix the slug with a short userId hash (first 6 chars): `${userId.slice(0, 6)}-${slugify(label)}`
- [x] The `label` field stays human-readable ("Sales Data") — only the filesystem `id` gets the prefix
- [x] Users never see the prefixed ID in the UI (they see the label)
- [x] Collision check scoped to same user's datasets only

**Files:** `src/app/api/datasets/upload/route.ts`

#### 2.6 Verification

- [ ] User A uploads "Sales.csv" — only User A sees it in the dataset switcher
- [ ] User B uploads "Sales.csv" — both uploads coexist, each user sees only their own
- [ ] Both users can see all 4 sample datasets
- [ ] User A cannot delete User B's dataset
- [ ] `GET /api/datasets` returns correct filtered list per user

---

### Phase 3: Onboarding → Upload Connection

**Goal:** New user can upload a CSV during onboarding, or pick a sample dataset. Their choice activates in the app.

**Estimated effort:** 3-4 hours

#### 3.1 Wire CSV upload into onboarding Connect step

**Problem:** `src/app/onboarding/connect/page.tsx` has a stubbed `handleUploadCSV()`.

**Action:**
- [ ] Import the `DatasetUploadModal` component from `src/components/dataset-upload-modal.tsx`
- [ ] Replace the stub with a modal trigger: clicking "Upload CSV" opens the upload modal
- [ ] The modal already handles file selection, validation, upload, and enrichment
- [ ] On successful upload: store the new dataset ID in wizard state (`setSelectedDataset(newId)`), advance to next step
- [ ] On upload, skip the "syncing" step — go directly to `/onboarding/complete` with the uploaded dataset pre-selected
- [ ] Show enrichment progress: the upload modal already has "Processing... This may take up to 2 minutes" — sufficient for now

**Note:** The upload modal currently uses `useDataset()` context for `refreshDatasets` and `switchDataset`. During onboarding, `DatasetProvider` is not mounted (layout-shell bypasses providers for `/onboarding` paths). Two approaches:
- **(a)** Mount a minimal `DatasetProvider` in the onboarding layout — cleanest
- **(b)** Make the upload modal accept optional callback props instead of requiring context — more flexible

**Recommend (a):** Wrap onboarding layout with `DatasetProvider` so the upload modal works as-is. The provider initializes safely with defaults even without prior state.

**Files:**
- `src/app/onboarding/connect/page.tsx`
- `src/app/onboarding/layout.tsx` (add DatasetProvider wrapper)

#### 3.2 Transfer wizard dataset selection to DatasetProvider

**Problem:** `completeWizard()` sets `completed: true` in wizard localStorage. `DatasetProvider` reads from a different localStorage key (`sentinel-dataset-id`). The two stores are not connected.

**Action:**
- [ ] In `src/app/onboarding/complete/page.tsx`, before calling `completeWizard()`:
  ```typescript
  // Bridge wizard → dataset provider
  localStorage.setItem("sentinel-dataset-id", selected);
  ```
- [ ] This ensures `DatasetProvider` picks up the selected dataset when it mounts on `/`
- [ ] If the user uploaded a CSV in step 2, `selected` already holds the upload's dataset ID

**Files:** `src/app/onboarding/complete/page.tsx`

#### 3.3 Persist onboarding completion to Clerk metadata

**Problem:** `isWizardComplete()` reads localStorage — lost on browser clear, doesn't work on new devices.

**Action:**
- [ ] Create `POST /api/onboarding/complete` route:
  ```typescript
  import { auth, clerkClient } from "@clerk/nextjs/server";
  
  export async function POST(req: Request) {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    
    const body = await req.json();
    const client = await clerkClient();
    await client.users.updateUser(userId, {
      publicMetadata: {
        onboardingComplete: true,
        role: body.role,
        orgName: body.orgName,
      },
    });
    return Response.json({ ok: true });
  }
  ```
- [ ] Call this API from `completeWizard()` flow — fire-and-forget (don't block the redirect if it fails; localStorage is the primary check, Clerk metadata is the backup for cross-device)
- [ ] Update `OnboardingGate` to check Clerk metadata as a fallback:
  ```typescript
  const { user } = useUser();
  
  useEffect(() => {
    if (isWizardComplete()) {
      setChecked(true);
    } else if (user?.publicMetadata?.onboardingComplete) {
      // Cross-device: Clerk says done, sync localStorage
      completeWizard();
      setChecked(true);
    } else {
      router.replace("/onboarding/account");
    }
  }, [router, user]);
  ```

**Files:**
- `src/app/api/onboarding/complete/route.ts` (new)
- `src/app/onboarding/complete/page.tsx`
- `src/components/onboarding/onboarding-gate.tsx`

#### 3.4 Filter sample datasets by wizard selection

**Problem:** After onboarding, a user who picked "Quick Help" as their sample dataset should NOT see all 4 sample datasets in the switcher — only the one they chose (plus any they uploaded).

**Action:**
- [ ] Store `selectedSampleDatasets: string[]` in Clerk `publicMetadata` (from the onboarding completion API)
- [ ] Update `GET /api/datasets` to filter static datasets:
  ```typescript
  // Show: user's uploads + their selected sample datasets
  const visible = allDatasets.filter(ds => {
    if (ds.ownerId === userId) return true; // user's own uploads
    if (!ds.ownerId) {
      // Sample dataset — show if user selected it during onboarding
      const selectedSamples = user.publicMetadata?.selectedSampleDatasets as string[] | undefined;
      return selectedSamples?.includes(ds.id) ?? true; // fallback: show all if no metadata
    }
    return false;
  });
  ```
- [ ] The complete step already supports multi-select or single-select — adapt to store the selection

**Files:**
- `src/app/api/datasets/route.ts`
- `src/app/api/onboarding/complete/route.ts`
- `src/app/onboarding/complete/page.tsx`

#### 3.5 Fix SSO redirect for new users

**Problem:** `auth/page.tsx:33` sets `redirectUrlComplete: "/"` for Google SSO. New users hit `/`, get caught by `OnboardingGate`, bounce to `/onboarding/account` — visible flash.

**Action:**
- [ ] The SSO callback `signUpFallbackRedirectUrl="/onboarding/account"` already handles this correctly for the fallback case
- [ ] For the primary path: Clerk's `redirectUrlComplete` cannot distinguish new vs returning users at the time of the redirect
- [ ] Fix: In the SSO callback page, check if user has `publicMetadata.onboardingComplete` — if not, redirect to `/onboarding/account` explicitly instead of relying on `OnboardingGate`

**Files:** `src/app/auth/sso-callback/page.tsx`

#### 3.6 Verification

- [ ] New user signs up via Google → lands on onboarding → uploads CSV → enters app → sees only their uploaded dataset + selected sample
- [ ] New user signs up via email → picks sample dataset → enters app → sees that dataset active
- [ ] User clears browser → signs in again → `OnboardingGate` checks Clerk metadata → skips onboarding
- [ ] Upload modal works in onboarding context (DatasetProvider mounted)
- [ ] Upload failure shows error, allows retry without leaving onboarding

---

### Phase 4: Polish & Hardening

**Goal:** Error handling, docs update, and cleanup for production readiness.

**Estimated effort:** 1-2 hours

#### 4.1 Update CLAUDE.md

**Problem:** Still references `APP_PASSWORD`, `SESSION_SECRET`, session cookies, `/api/auth/*`.

**Action:**
- [ ] Remove old auth environment variables section
- [ ] Add Clerk environment variables section
- [ ] Update "Required Environment" to list Clerk keys
- [ ] Update route protection description (Clerk middleware, not session cookies)
- [ ] Add `ownerId` to DatasetConfig description
- [ ] Note the `auth()` pattern for API routes

**Files:** `CLAUDE.md`

#### 4.2 Add upload rate limiting

**Problem:** No per-user upload count limit. A user could exhaust disk or Gemini API credits.

**Action:**
- [ ] In the upload route, before processing: count existing datasets for this user
- [ ] Reject if `count >= MAX_DATASETS_PER_USER` (suggest: 5 for demo, configurable via env)
- [ ] Return 429 with clear error message

**Files:** `src/app/api/datasets/upload/route.ts`

#### 4.3 Session expiry awareness in apiFetch

**Problem:** When a Clerk session expires, API calls return 401/307. `apiFetch` doesn't handle this — the UI just breaks silently.

**Action:**
- [ ] In `apiFetch`, check for 401/307 responses before throwing
- [ ] If detected, redirect to `/auth` (Clerk will handle re-auth)
- [ ] For SSE streams: client-side, check if the stream ends unexpectedly without a `done` event — surface a "session expired" message

**Files:** `src/lib/api-client.ts`

#### 4.4 Error boundary on auth page

**Action:**
- [ ] Wrap the auth page content in a React error boundary
- [ ] Fallback: "Something went wrong. Please refresh and try again." + retry button
- [ ] Catches Clerk SDK failures, network errors, etc.

**Files:** `src/app/auth/page.tsx`

#### 4.5 Verification

- [ ] `pnpm build` succeeds
- [ ] `pnpm lint` passes
- [ ] CLAUDE.md accurately reflects the new auth architecture
- [ ] Upload rejects after limit is reached
- [ ] Session expiry redirects to `/auth` gracefully

---

## System-Wide Impact

### Interaction Graph

```
User action → Clerk middleware (auth.protect) → API route (auth() extracts userId)
  → repo function (userId param) → SQLite query (WHERE user_id = ?)
  → Response scoped to user

Dataset upload → upload route (auth() → userId → ownerId on config)
  → saveDynamicDataset (config.json with ownerId)
  → GET /api/datasets (filters by ownerId)
  → DatasetProvider (shows filtered list)
  → dataset switcher UI (only user's datasets)

Onboarding completion → completeWizard (localStorage)
  → POST /api/onboarding/complete (Clerk publicMetadata)
  → localStorage bridge (sentinel-dataset-id = selected)
  → redirect to / → DatasetProvider reads localStorage → correct dataset active
```

### Error Propagation

- `auth()` returns `{ userId: null }` for unauthenticated requests → API routes return 401 → `apiFetch` catches → redirect to `/auth`
- Upload failures → upload route returns 4xx/5xx → modal shows error → user retries
- Clerk API failures (metadata write) → fire-and-forget in onboarding → localStorage is primary, metadata is backup
- DuckDB query on unauthorized dataset → ownership check returns 404 before DuckDB is touched

### State Lifecycle Risks

- **Partial upload failure:** Upload route already handles cleanup — `deleteDynamicDataset(id)` on error, temp dir always cleaned
- **Onboarding abandonment:** If user closes tab mid-wizard, localStorage has partial state. On return, wizard resumes from last step. No server-side state to orphan.
- **Clerk metadata write failure:** Non-blocking. LocalStorage is primary check. Metadata is cross-device backup only. Worst case: user re-onboards on new device.

### API Surface Parity

Routes that need `auth()` extraction (all currently use `USER_ID = "default"` or have no user scoping):

| Route Group | Files | Change |
|---|---|---|
| Conversations | 4 files | Replace `USER_ID` constant |
| Segments | segment-repo.ts + API routes | Add `userId` param |
| Boards | board-repo.ts + API routes | Add `userId` param + fix IDOR on sub-resources |
| Playbooks | playbook-repo.ts + API routes | Add `userId` param |
| Datasets | upload, list, delete routes | Add `ownerId` filter |
| Onboarding | new route | New `POST /api/onboarding/complete` |

### Integration Test Scenarios

1. **Cross-user isolation:** User A creates conversation + segment + board. User B signs in. User B's conversation list, segment list, board list are all empty.
2. **Dataset visibility:** User A uploads CSV. User B calls `GET /api/datasets`. User A's dataset is not in the response.
3. **Upload during onboarding:** New user signs up → goes through wizard → uploads CSV in connect step → selects it in complete step → lands on app with that dataset active.
4. **Cross-device onboarding:** User completes onboarding on Chrome. Opens Safari, signs in. OnboardingGate checks Clerk metadata → skips wizard.
5. **Session expiry mid-stream:** User starts deep research query (60s). Session expires at 30s. Client shows session expired message instead of hanging.

---

## Acceptance Criteria

### Functional Requirements

- [ ] API routes extract real Clerk userId — no hardcoded `USER_ID` anywhere
- [ ] Conversations, segments, boards, playbooks are isolated per user
- [ ] Uploaded datasets have `ownerId` matching the uploader's Clerk userId
- [ ] Dataset switcher shows only: user's uploads + selected sample datasets
- [ ] CSV upload works from within the onboarding Connect step
- [ ] Wizard dataset selection activates as the app's active dataset
- [ ] Onboarding completion persists to Clerk metadata (cross-device)
- [ ] Real user name/email/avatar shown in sidebar
- [ ] Legacy `/legacy` import replaced with current Clerk SDK path
- [ ] Dead `src/proxy.ts` file removed

### Non-Functional Requirements

- [ ] `pnpm build` succeeds with zero errors
- [ ] `pnpm lint` passes
- [ ] No new TypeScript `any` types introduced
- [ ] Upload limited to MAX_DATASETS_PER_USER (default: 5)
- [ ] 401 responses redirect to `/auth` instead of silent failure

### Quality Gates

- [ ] Manual test: two-user isolation scenario passes
- [ ] Manual test: full onboarding → CSV upload → app entry flow works
- [ ] CLAUDE.md updated to reflect new auth architecture

---

## Dependencies & Risks

### Dependencies

- **Clerk SDK v7** (`@clerk/nextjs ^7.0.7`) — already installed, `auth()` server helper available
- **`clerkClient`** from `@clerk/nextjs/server` — needed for `publicMetadata` writes
- **SQLite schema** — already has `user_id` columns, no migration needed
- **`DatasetUploadModal`** — already functional, needs DatasetProvider context in onboarding

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy import migration changes hook API | Auth page breaks | Test both SSO + OTP flows after migration |
| Board sub-resource IDOR fix is deeper than expected | Delays Phase 1 | Can ship Phase 1 without sub-resource fix; add as follow-up |
| Upload modal requires DatasetProvider in onboarding layout | Provider initialization before dataset context exists | Use DEFAULT_DATASET as initial; upload creates the real one |
| Clerk metadata write latency | Onboarding feels slow | Fire-and-forget; localStorage is primary |
| Existing "default" data confusion for demo users | Users lose their prototype data | Documented in D5; acceptable for pre-launch |

---

## Future Considerations (Out of Scope)

- **Clerk Organizations** — team/org-level dataset sharing, RBAC
- **Webhook integration** — server-side user record creation on sign-up
- **Database persistence for onboarding** — replace localStorage with server-side state
- **Dataset sharing** — share uploaded datasets with team members
- **Session refresh UI** — proactive re-auth modal before expiry
- **Admin dashboard** — Sashank's priority; needs real user records first

---

## Sources & References

### Origin

- **Auth brainstorm:** [docs/brainstorms/2026-03-31-custom-auth-page-brainstorm.md](../brainstorms/2026-03-31-custom-auth-page-brainstorm.md) — single `/auth` page, Google SSO + email OTP, split layout
- **Onboarding plan:** [docs/plans/2026-03-30-feat-onboarding-wizard-plan.md](2026-03-30-feat-onboarding-wizard-plan.md) — 4-step wizard, dataset selection success criterion never implemented

### Internal References

- Middleware conflict learning: `docs/solutions/build-errors/nextjs-16-middleware-proxy-file-conflict.md`
- In-memory store split pattern: `docs/solutions/logic-errors/inmemory-store-api-generated-data-ui-rendering-split.md`
- Board IDOR note: `src/lib/server/board-repo.ts` (security comment)
- Dataset types: `src/lib/datasets/types.ts`
- Dynamic registry: `src/lib/datasets/dynamic-registry.ts`
- Upload route: `src/app/api/datasets/upload/route.ts` (693 lines, production-quality)
- Upload modal: `src/components/dataset-upload-modal.tsx` (239 lines)
- Conversation SQLite schema: `src/lib/meta-db.ts`

### Hardening Audit

- Auth was deferred to a separate PR in the [hardening audit](../../docs/hardening-audit-2026-03-30.md) — this plan fulfills that deferral
