---
title: Presto as default dataset with HFC visible, bypass onboarding picker
type: feat
date: 2026-04-21
branch: feat/clerk-auth-merged
brainstorm: docs/brainstorms/2026-04-21-presto-dataset-gating-brainstorm.md
deepened: 2026-04-21
---

# Presto as default dataset with HFC visible, bypass onboarding picker

## Enhancement Summary (2026-04-21, ultrathink deepen)

Reviewed by: `security-sentinel`, `kieran-typescript-reviewer`, `code-simplicity-reviewer`, `architecture-strategist` (parallel).

### Key findings folded back into this plan

1. **NEW in-scope step: audit `policy-store.ts` seed coupling.** Seeds at `src/lib/policy-store.ts:40,58,76,94` scope policies to `DEFAULT_DATASET`. Flipping to `gameramp` silently creates policies with `tableAccess` pointing at `events`/`orders`/`users` — tables that don't exist in the gameramp schema. Not a crash, but the Policies UI becomes meaningless on Presto. Must be addressed in this PR.
2. **NEW shared constant.** Hoist `DEFAULT_SAMPLE_DATASETS = ["gameramp", "vastu-hfc"] as const` into `src/lib/datasets/constants.ts` so the onboarding page, welcome modal, and any future "reset to defaults" logic share one source of truth.
3. **Replace `DEFAULT_META` hardcoding with a client-safe `meta.ts` extraction.** Simplicity + TypeScript reviews converged on this: extract dataset labels into `src/lib/datasets/meta.ts`, derive `DEFAULT_META` from `DATASET_META[DEFAULT_DATASET]`. Eliminates the drift TODO and `Out of Scope #5` simultaneously. Adds ~15 lines, removes a follow-up bead.
4. **Fix CLAUDE.md violation in onboarding rewrite.** The current `complete/page.tsx` uses raw `fetch` and bare `try {} catch {}`. The rewrite must use `apiFetch` (CLAUDE.md mandate) and log the catch. Don't perpetuate pre-existing non-compliance.
5. **Server-side security gap is broader than "static samples queryable".** Two additional issues surfaced: `/api/segments/route.ts:23-27,42-43` skips `getDatasetForUser` entirely (any authed user can list/create segments in any dataset), and `/api/onboarding/complete` has no CSRF protection (attacker page can forge metadata writes for any authed victim). Still out of scope here — this plan is UX — but flagged explicitly in follow-up beads.
6. **Header-less request ripple.** Every route that does `headers.get("x-dataset-id") || DEFAULT_DATASET` (30+ sites) shifts from quickhelp to gameramp after the flip. Client `apiFetch` always sends the header; external integrations/curl/healthchecks might not. Documented as a "known default-change ripple" in the Risk register.

### Unchanged after deepen
- Scope is still tight (5 files touched, one manual Clerk edit)
- No architectural drift; uses existing patterns only
- "Expose existing registration" framing holds
- Dataset-scoped stores, sidebar switcher, `notifyDatasetSwitch` lifecycle all correct as-is

## Overview

Expose the already-registered `gameramp` dataset (display label "Presto") as the default dataset for new users, keep `vastu-hfc` ("Housing Finance") visible alongside it, and replace the onboarding "pick a sample" picker with an auto-confirm screen that assigns both datasets. Existing onboarded users are untouched. The top-left sidebar dropdown (`src/components/sidebar.tsx:352`) remains the single "app switcher" — it already handles dataset isolation cleanly via `notifyDatasetSwitch()`.

No architectural changes. No new abstraction. No database migration. Expected diff: 4-5 files, ~80-120 lines net.

## Problem Statement

Today, a new user signing in sees only Housing Finance (`vastu-hfc`) in the top-left switcher because the onboarding picker is single-select, defaults to `quickhelp`, and only offers 2 options (neither of which is Presto). Presto/gameramp is fully registered in code (`src/lib/datasets/index.ts:18`, parquet at `data/parquet/gamerampv2/`) — the UI just doesn't expose it. The pre-sales demo needs Presto front-and-center while keeping HFC one click away.

## Research — Critical Findings

### Finding 1: Clerk auth does NOT gate dataset queries (security gap, out of scope)

`selectedSampleDatasets` is **display-only**. It filters `GET /api/datasets` (`src/app/api/datasets/route.ts:5-30`) which populates the switcher. **No content route checks it.** `getDatasetForUser(id, userId)` at `src/lib/datasets/index.ts:51-66` only verifies:
- Dataset exists (no silent fallback)
- Uploaded dataset ownership matches `userId`
- Dynamic dataset has an `ownerId` (rejects legacy orphans)

It does not read `selectedSampleDatasets`. A user with `["vastu-hfc"]` in their metadata can POST to `/api/analyze` with `x-dataset-id: gameramp` and get results — the middleware passes, the route passes, DuckDB runs the query.

**Implication for this plan:** Presto is *already queryable* by any authed, onboarded user today. Flipping onboarding state is strictly a UX change, not a security one. We intentionally leave the security gap as a separate bead (see "Out of Scope").

### Finding 2: `DEFAULT_DATASET` flip alone is insufficient

Three independent code paths decide the active dataset on first render:
1. **localStorage** `sentinel-dataset-id` (`src/lib/dataset-context.tsx:71`) — wins if present and valid
2. **`DEFAULT_DATASET` constant** (`src/lib/datasets/constants.ts:7`) — used when localStorage is empty
3. **Server reconciliation** (`dataset-context.tsx:102-109`) — if current `datasetId` isn't in `/api/datasets` response, fall back to `allDatasets[0].id`

For a brand-new user who completes onboarding with `selectedSampleDatasets: ["gameramp", "vastu-hfc"]`:
- Onboarding page writes localStorage `sentinel-dataset-id = "gameramp"` (`complete/page.tsx:38`) → DatasetProvider restores it → Presto is active ✓

For a user whose localStorage was cleared but Clerk metadata is `["gameramp", "vastu-hfc"]`:
- DatasetProvider reads `DEFAULT_DATASET = "gameramp"` → calls `/api/datasets` → gameramp is in the list → stays on Presto ✓

For an existing user with `["vastu-hfc"]` already persisted (the dev account):
- localStorage says `vastu-hfc` → DatasetProvider stays on HFC → `/api/datasets` returns only `vastu-hfc` → user never sees Presto in the switcher
- **Fix:** manually add `"gameramp"` to their Clerk `publicMetadata.selectedSampleDatasets` (one-off, see Step 5)

### Finding 3: Parquet and DuckDB wiring is ready

- `src/lib/datasets/gameramp.ts:42` → `dbFile: "data/gameramp.duckdb"`
- `src/lib/datasets/gameramp.ts:324` → `parquetDir = ${dataDir}/parquet/gamerampv2`
- Disk verified: `data/parquet/gamerampv2/` contains `installs.parquet`, `sessions.parquet`, `ad_impression_events.parquet`, `revenue.parquet`, `campaign.parquet` — all 5 referenced by `viewSQL()`
- First query triggers `ensureDatasetReady(gameramp)` → creates `data/gameramp.duckdb` lazily → subsequent queries are cached
- DuckDB file paths are NOT scoped per-user; one global file per dataset shared by all users (same as Housing Finance today)

### Finding 4: `DEFAULT_META` fallback is hardcoded to Quick Help labels

`src/lib/dataset-context.tsx:42-53` declares `DEFAULT_META` with `label: "Quick Help"`, `dbName: "quickhelp.duckdb"`, hardcoded totals, etc. This is used only until `/api/datasets` resolves, but if we flip `DEFAULT_DATASET` to `gameramp` and leave `DEFAULT_META` alone, the sidebar briefly flashes "Quick Help" for `datasetId = "gameramp"` — a visual regression.

### Finding 5: Onboarding page `complete/page.tsx` is single-select, lacks gameramp

Current `DATASETS` array at `src/app/onboarding/complete/page.tsx:10-21` only has `quickhelp` and `vastu-hfc`. User picks one. Body sent is `selectedSampleDatasets: [selected]` (single-element array). The wizard store (`onboarding-wizard-store.ts`) is also single-select via `setSelectedDataset(selected)`.

We need to auto-assign both datasets without breaking the wizard store contract used downstream by `welcome-modal.tsx` (which reads `state.selectedDataset` to display "Welcome to X" once).

## Proposed Solution

**High-level:** five small code edits + one manual Clerk metadata update.

1. Flip `DEFAULT_DATASET` → `"gameramp"`; add `DEFAULT_SAMPLE_DATASETS` shared constant (`src/lib/datasets/constants.ts`)
2. Extract `DATASET_META` to a new client-safe file (`src/lib/datasets/meta.ts`) and derive `DEFAULT_META` from it (`src/lib/dataset-context.tsx`)
3. Reorder `STATIC_DATASETS` → `gameramp` first (controls switcher order) (`src/lib/datasets/index.ts`)
4. Audit + scope `policy-store.ts` seed coupling so demo policies don't silently retarget gameramp (`src/lib/policy-store.ts`)
5. Rewrite `onboarding/complete/page.tsx` picker UI → auto-confirm screen that POSTs `["gameramp", "vastu-hfc"]` via `apiFetch`
6. Manually update `sashank@glitchcraft.io` Clerk `publicMetadata.selectedSampleDatasets` via Clerk Dashboard

## Technical Approach

### Step 1 — `src/lib/datasets/constants.ts`

Flip the default and add a shared sample-dataset list used by onboarding, welcome modal, and any future seeding.

```ts
// src/lib/datasets/constants.ts
export const DEFAULT_DATASET = "gameramp";

/** Sample datasets auto-assigned to new users during onboarding. */
export const DEFAULT_SAMPLE_DATASETS = ["gameramp", "vastu-hfc"] as const;
export type SampleDatasetId = (typeof DEFAULT_SAMPLE_DATASETS)[number];
```

**Why:** Every server-side fallback (`/api/datasets`, `/api/analyze` with no header, `withConnection` with empty `datasetId`) resolves to `DEFAULT_DATASET`. Flipping it makes Presto the system-wide default. The new `DEFAULT_SAMPLE_DATASETS` constant prevents the literal `["gameramp", "vastu-hfc"]` from being duplicated across files (it's used by Step 5 and could be reused by a future "reset to defaults" feature).

**Verified consumers of `DEFAULT_DATASET` (unchanged behavior, just new target):**
- `src/lib/db.ts:214` — `withConnection(datasetId || DEFAULT_DATASET)`
- `src/app/api/analyze/route.ts:40`, `src/app/api/chat/route.ts:23`, `src/app/api/classify/route.ts:31` — `headers.get("x-dataset-id") || DEFAULT_DATASET`
- `src/lib/policy-store.ts:40,58,76,94` — seeds demo policies scoped to default (**addressed in Step 4 below**)
- `src/app/api/ingest/route.ts:44` — external ingest default
- `src/lib/datasets/index.ts:28` — silent fallback when `getDataset(id)` fails
- `src/lib/dataset-context.tsx:65,79,106,124,149` — client-side default resolution

**Risk:** Any test/fixture that assumes `DEFAULT_DATASET === "quickhelp"`. Grep before shipping:
```
rg '"quickhelp"' src tests scripts
```
Expected hits (verified on current branch):
- `tests/api/funnels.spec.ts:17`, `tests/api/retentions.spec.ts:16`, `tests/e2e/funnels.spec.ts:11`, `tests/e2e/retentions.spec.ts:11` — hardcode `"quickhelp"` explicitly in `x-dataset-id`. Safe (they don't rely on the default).
- `scripts/startup.sh:75,134,138,143` — unconditionally provisions `quickhelp.duckdb` on Railway boot. **Not broken, but wastes startup time** for a dataset no new user sees. Non-blocking; consider follow-up cleanup bead.

### Step 2 — Extract client-safe dataset metadata to `src/lib/datasets/meta.ts` (new file)

Instead of patching hardcoded `DEFAULT_META` labels (drift-prone per Finding 4), extract the minimum client-safe subset into a dedicated file. This is the `DEFAULT_META` fallback's single source of truth and eliminates the TODO the previous plan version deferred.

**New file: `src/lib/datasets/meta.ts`** (no `fs` imports, safe to bundle for client):

```ts
// src/lib/datasets/meta.ts
import type { DatasetMeta } from "@/lib/dataset-context";

/**
 * Client-safe metadata snapshot for registered static datasets.
 * Must stay in sync with the labels/report values in each dataset config
 * (src/lib/datasets/<id>.ts). Used for first-paint fallback before
 * /api/datasets resolves.
 */
export const DATASET_META: Record<string, DatasetMeta> = {
  gameramp: {
    id: "gameramp",
    label: "Presto",
    currency: "$",
    entityName: "players",
    reportMeta: {
      // Copy values from src/lib/datasets/gameramp.ts (reportMeta / welcomeSubtitle)
      totalEvents: "<paste from gameramp.ts>",
      totalUsers: "<paste from gameramp.ts>",
      dateRangeLabel: "<paste from gameramp.ts>",
      dbName: "gameramp.duckdb",
    },
  },
  "vastu-hfc": {
    id: "vastu-hfc",
    label: "Housing Finance",
    currency: "₹",
    entityName: "loans",
    reportMeta: {
      totalEvents: "<paste from vastu-hfc.ts>",
      totalUsers: "<paste from vastu-hfc.ts>",
      dateRangeLabel: "<paste from vastu-hfc.ts>",
      dbName: "vastu-hfc.duckdb",
    },
  },
  // quickhelp, alpha — include for completeness (keeps fallback clean if a user
  // still has them in selectedSampleDatasets), but the implementor should
  // copy exact values from their respective config files.
};
```

**Update `src/lib/dataset-context.tsx`** (replace lines 42-53 hardcoded object):

```ts
import { DATASET_META } from "@/lib/datasets/meta";
// ...
const DEFAULT_META: DatasetMeta = DATASET_META[DEFAULT_DATASET] ?? {
  id: DEFAULT_DATASET,
  label: DEFAULT_DATASET,
  reportMeta: { totalEvents: "", totalUsers: "", dateRangeLabel: "", dbName: `${DEFAULT_DATASET}.duckdb` },
};
```

**Why this shape (simplicity review):** The first-paint flicker is <200ms in practice, so the old hardcoded object was "premature polish." But keeping the hardcoded object with *wrong* labels after the default flip is worse — it's a committed semantic lie. Extracting to a lookup table is small (one new file, ~30 lines), removes drift risk, eliminates `Out of Scope #5`, and makes the pattern reusable for the synthesized fallback at `dataset-context.tsx:149`.

**Consider also:** Move the `DatasetMeta` interface (`dataset-context.tsx:10-28`) into `src/lib/datasets/meta.ts` so the type lives with the data. Optional — if the move creates import churn across many files, leave the interface where it is.

**Don't touch** the `stored !== DEFAULT_DATASET` check at `dataset-context.tsx:72`. It short-circuits harmlessly when stored equals default.

### Step 3 — `src/lib/datasets/index.ts`

Reorder `STATIC_DATASETS` so the sidebar dropdown lists Presto first.

```ts
// src/lib/datasets/index.ts:16-21
const STATIC_DATASETS: Record<string, DatasetConfig> = {
  gameramp: gamerampDataset,     // ← moved to top
  "vastu-hfc": vastuHfcDataset,  // ← moved to #2
  quickhelp: quickhelpDataset,
  alpha: alphaDataset,
};
```

**Why:** `sidebar.tsx:365` renders `allDatasets.map(...)` which preserves object insertion order. No sort logic to add.

**Risk:** None. `Record<string, T>` has no stable-iteration guarantee per spec, but V8/Node preserves insertion order for string keys. Verified via architecture review: only two consumers iterate (`getAllDatasets` at `index.ts:34` and the sidebar); neither asserts specific ordering.

### Step 4 — Audit `src/lib/policy-store.ts` seed coupling (NEW, added after architecture review)

The seeds at `src/lib/policy-store.ts:40,58,76,94` create four demo policies with `datasetId: DEFAULT_DATASET` and `tableAccess` listing tables like `events`, `orders`, `users`, `sessions`. These tables exist in the `quickhelp` schema but **not in gameramp** (which has `installs`, `sessions`, `ad_impression_events`, `revenue`, `campaign`).

After the Step 1 flip, these seeds run for new users against `gameramp` — creating policy rows whose table list is nonsensical against the actual schema. The Policies UI won't crash, but it will show broken demo data on Presto.

**Two acceptable fixes (pick one):**

**Option A — Scope demo seeds to quickhelp explicitly** (minimal change):
```ts
// src/lib/policy-store.ts:40 (and 58, 76, 94)
// Before: datasetId: DEFAULT_DATASET,
// After:
datasetId: "quickhelp", // demo policies reference quickhelp schema tables
```
Pro: one-character-per-line change. Con: seeds are now dead for users who never onboard to quickhelp — the whole seeding is cosmetic anyway.

**Option B — Update table lists to match gameramp schema** (proper fix):
Rewrite the four seeds so `tableAccess` references `installs`, `sessions`, etc., aligning with the new default's actual schema. More work, but demo policies become meaningful on Presto.

**Recommendation:** Option A for this PR (smallest diff matching the "UX-only" scope). File a follow-up bead to replace with schema-aware seeding that adapts per dataset. Document in Acceptance Criteria that Presto's Policies UI should show either relevant policies or an empty state, not quickhelp-schema leftovers.

**Why this matters:** The architecture review flagged this as a silent breakage seam. Without addressing it, shipping the default flip causes new users' first visit to Policies to show nonsensical policy rows — a demo-quality regression that undermines the whole pre-sales UX.

### Step 5 — `src/app/onboarding/complete/page.tsx`

Rewrite the page to show a single "Get started" confirmation screen (no picker grid, no dataset cards). Auto-assign `DEFAULT_SAMPLE_DATASETS` (from Step 1) on Continue click.

**Behavior for new users with no uploaded dataset:**
- Show: "You're set up with Presto + Housing Finance sample data. Click to continue."
- On Continue: POST `{ orgName, selectedSampleDatasets: ["gameramp", "vastu-hfc"] }`, set `localStorage.sentinel-dataset-id = "gameramp"`, call `setSelectedDataset("gameramp")` in wizard store (for welcome-modal), navigate to `/onboarding/syncing`.

**Behavior for users with an uploaded dataset (preserved):**
- Show: "Your data is ready" (unchanged from today)
- On Continue: navigate to `/` (unchanged)

**Critical corrections applied after TypeScript review:**

1. **Use `apiFetch`, NOT raw `fetch`.** CLAUDE.md mandates `apiFetch` for all frontend→backend calls. The current code is already non-compliant; the rewrite should fix this, not perpetuate it. Pass `skipModel: true` (onboarding doesn't need model header).
2. **Don't bare-catch.** At minimum log: `catch (err) { console.warn("[onboarding] metadata write failed", err); }`. The existing localStorage write is enough to keep the UI working; logging preserves debuggability.
3. **Use a type predicate for sample-ID narrowing**, not `as` casts.
4. **Import the shared `DEFAULT_SAMPLE_DATASETS`** from `src/lib/datasets/constants.ts` (added in Step 1).

Pseudocode (replaces `src/app/onboarding/complete/page.tsx`):

```tsx
// src/app/onboarding/complete/page.tsx (abridged)
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { setSelectedDataset, setWizardStep, completeWizard, getWizardState } from "@/lib/onboarding-wizard-store";
import { DEFAULT_SAMPLE_DATASETS } from "@/lib/datasets/constants";
import { apiFetch } from "@/lib/api-client";

const DEFAULT_ACTIVE_SAMPLE = "gameramp"; // first of DEFAULT_SAMPLE_DATASETS

function isSampleId(id: string): boolean {
  return (DEFAULT_SAMPLE_DATASETS as readonly string[]).includes(id);
}

export default function CompleteStep() {
  const router = useRouter();
  const wizardState = getWizardState();
  const uploadedDatasetId =
    wizardState.selectedDataset && !isSampleId(wizardState.selectedDataset)
      ? wizardState.selectedDataset
      : null;
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    setSaving(true);
    const activeId = uploadedDatasetId ?? DEFAULT_ACTIVE_SAMPLE;
    setSelectedDataset(activeId);
    localStorage.setItem("sentinel-dataset-id", activeId);

    try {
      await apiFetch("/api/onboarding/complete", {
        method: "POST",
        skipModel: true,
        body: {
          orgName: wizardState.accountInfo?.orgName || undefined,
          selectedSampleDatasets: uploadedDatasetId
            ? []
            : [...DEFAULT_SAMPLE_DATASETS],
        },
      });
    } catch (err) {
      console.warn("[onboarding/complete] metadata write failed", err);
      // localStorage keeps the UI working; user can re-trigger onboarding if metadata is lost
    }

    if (uploadedDatasetId) {
      setWizardStep("complete");
      completeWizard();
      router.push("/");
    } else {
      setWizardStep("syncing");
      router.push("/onboarding/syncing");
    }
  }

  function handleBack() {
    setWizardStep("connect");
    router.push("/onboarding/connect");
  }

  return (
    <motion.div /* existing motion setup */>
      {/* Icon — unchanged */}
      {uploadedDatasetId ? (
        /* "Your data is ready" branch — unchanged */
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-[#e8e8e8] text-center mb-2">You're all set</h1>
          <p className="text-[13px] text-[#666] text-center mb-8 max-w-md mx-auto">
            Start with Presto sample data. Housing Finance is one click away in the top-left switcher.
          </p>
        </>
      )}
      {/* Back + Continue buttons — unchanged */}
    </motion.div>
  );
}
```

**Key deletions:**
- `DATASETS` array — gone
- `selected` / `setSelected` state — gone
- `<DatasetCard>` grid rendering — gone
- `isSample` branching — always true for sample branch (simplified)
- Imports of `DatasetCard`, `LayoutGrid` — unused

**Key preservations:**
- Uploaded-dataset branch UX ("Your data is ready")
- Back button to `/onboarding/connect`
- Wizard store integration (`setSelectedDataset`, `setWizardStep`, `completeWizard`)
- Motion/framer animations

**Optional (confirmed OK):** `src/components/onboarding/welcome-modal.tsx` already has a `gameramp` entry in `SAMPLE_LABELS` (line 9) — no change needed there.

### Step 6 — One-off Clerk metadata update for dev account

Via Clerk Dashboard (zero code):
1. Go to Clerk Dashboard → Users → search `sashank@glitchcraft.io`
2. Open Public metadata editor
3. Change `selectedSampleDatasets` from `["vastu-hfc"]` to `["gameramp", "vastu-hfc"]`
4. Save

Alternative (Node one-liner if Dashboard access is inconvenient):
```bash
CLERK_SECRET_KEY=<key> npx tsx -e '
import { clerkClient } from "@clerk/nextjs/server";
const c = await clerkClient();
const u = (await c.users.getUserList({ emailAddress: ["sashank@glitchcraft.io"] })).data[0];
await c.users.updateUser(u.id, {
  publicMetadata: { ...u.publicMetadata, selectedSampleDatasets: ["gameramp", "vastu-hfc"] }
});
'
```
**Note:** Always spread `...u.publicMetadata` — Clerk's `updateUser` replaces `publicMetadata` wholesale. Omitting existing fields like `onboardingComplete` would silently wipe them. (Same latent footgun exists in `src/app/api/onboarding/complete/route.ts:20-27` — flag as separate bead.)

## Acceptance Criteria

### Functional
- [ ] **New user sign-up flow:** complete onboarding → land on `/` with Presto active, Presto + HFC visible in the top-left switcher, Presto listed first
- [ ] **Dataset switcher:** clicking the top-left chevron reveals exactly `Presto` and `Housing Finance` (no Quick Help, no Alpha) for a newly-onboarded user
- [ ] **Switching to HFC:** click Housing Finance → `notifyDatasetSwitch` fires, streams abort, panel closes, queries now hit `vastu-hfc`, switcher label updates, `localStorage.sentinel-dataset-id === "vastu-hfc"`
- [ ] **Switching back to Presto:** same lifecycle, no stale data leaks
- [ ] **Presto query works end-to-end:** ask "how many users installed last week?" → classify → analyze → DuckDB query against `data/gameramp.duckdb` → streams results; no errors in server log about missing tables or parquet paths
- [ ] **Dev account Clerk update:** after manual metadata edit, `sashank@glitchcraft.io` sign-in shows Presto + HFC in switcher
- [ ] **First-load DuckDB init:** first Presto query creates `data/gameramp.duckdb` via `ensureDatasetReady` with no OOM, no WAL errors (regression test for memory/duckdb-wal-replay learning)

### Persistence safety (regression)
- [ ] Segments created in Presto don't leak into HFC and vice versa (verify `segment-repo` scoping)
- [ ] Playbooks saved in Presto don't leak into HFC (verify `playbook-store` dataset-scoped Map)
- [ ] Metrics created in Presto don't leak into HFC (verify `metric-store` dataset-scoped Map)
- [ ] Knowledge entries created in Presto don't leak into HFC (verify `knowledge-store` dataset-scoped Map)
- [ ] Boards created in Presto don't leak into HFC (verify `board.datasetId` filter)
- [ ] Existing `sashank@glitchcraft.io` HFC segments/playbooks remain visible on HFC after switching to Presto and back

### Policy seeding (regression, NEW after architecture review)
- [ ] Presto's Policies UI does NOT show demo policies with `tableAccess: ["events", "orders", "users"]` (quickhelp-schema leftovers). Either shows policies scoped to quickhelp only (Option A) or shows gameramp-appropriate policies (Option B) — never a mismatch.
- [ ] Switching from Presto to HFC and back does not multiply or re-seed policies (idempotent `ensureInitialized` contract).

### Existing-user safety
- [ ] An existing onboarded user with `selectedSampleDatasets: ["quickhelp"]` (if any exist) continues to see only Quick Help in their switcher after deploy — no forced migration, no switch of active dataset
- [ ] An existing onboarded user with `selectedSampleDatasets: ["vastu-hfc"]` continues to see only Housing Finance (before manual Clerk edit) — no unauthorized `gameramp` exposure via switcher

### Visual / onboarding flow
- [ ] `/onboarding/complete` shows a single "You're all set" confirmation screen, no dataset picker grid
- [ ] Continue button triggers POST + redirect to `/onboarding/syncing`
- [ ] Welcome modal on first `/` load shows "Welcome to Actioneer" with Presto label (wizard store has `selectedDataset: "gameramp"`)
- [ ] No "Quick Help" label briefly flashing during first paint (DEFAULT_META updated)

## Edge Cases & Spec-Flow Analysis

### Onboarding state machine
| Starting state | After deploy | Expected |
|---|---|---|
| Unauthenticated user | (navigates to `/`) | Redirect to `/auth` — unchanged |
| Authed, no onboardingComplete flag | Enters wizard at `/onboarding/account` | Finishes at new `/onboarding/complete` confirmation, gets `["gameramp", "vastu-hfc"]` |
| Authed, onboardingComplete=true, selectedSampleDatasets=["vastu-hfc"] (dev account) | Lands on `/` | Still sees only HFC in switcher until Step 5 manual update |
| Authed, onboardingComplete=true, selectedSampleDatasets=["quickhelp"] (hypothetical) | Lands on `/` | Still sees only Quick Help — intentional, no surprise |
| Mid-wizard when deploy happens (on `/onboarding/connect`) | Next step loads new `/onboarding/complete` | Gets auto-assigned Presto + HFC on Continue |
| Mid-wizard when deploy happens (on old `/onboarding/complete` with picker rendered) | Picker grid was their snapshot; they Continue | Old picker writes single dataset → one-dataset outcome. Minor, ephemeral. Acceptable. |

### localStorage vs Clerk metadata drift
| localStorage | Clerk selectedSampleDatasets | Active dataset | Switcher shows |
|---|---|---|---|
| empty | `["gameramp", "vastu-hfc"]` | DEFAULT_DATASET="gameramp" | gameramp, vastu-hfc |
| "gameramp" | `["gameramp", "vastu-hfc"]` | gameramp | gameramp, vastu-hfc |
| "vastu-hfc" | `["gameramp", "vastu-hfc"]` | vastu-hfc | gameramp, vastu-hfc |
| "gameramp" | `["vastu-hfc"]` only | gameramp (initial) → server says gameramp not in list → reconciles to vastu-hfc (dataset-context.tsx:122-133) | vastu-hfc only |
| "quickhelp" | `["vastu-hfc"]` only | same reconciliation → vastu-hfc | vastu-hfc only |

The reconciliation logic at `dataset-context.tsx:122-133` guarantees we never show a dataset the user can't query from the switcher — even if localStorage is stale.

### Dataset lifecycle (already-working, verify no regression)
- `notifyDatasetSwitch()` fires → `ChatStateProvider` aborts in-flight analytics, resets `deepResearch=false`, closes task panel, closes segment modal
- `setActiveDatasetId()` updates module-level `_datasetId` in `api-client.ts` before next `apiFetch`
- `apiFetch` long-running flows (`use-analytics.ts`) capture `datasetId` at invocation and pass explicit `datasetId` option to inner calls — switches mid-stream don't poison subsequent requests

### DuckDB cold-start
- First Presto query triggers `ensureDatasetReady(gameramp)` → reads `data/parquet/gamerampv2/*.parquet` into the DuckDB view → CHECKPOINTs WAL (per `duckdb-wal-replay-alter-table-default-crash.md` learning)
- On Railway: volume must contain `data/parquet/gamerampv2/` — confirm the deploy target has this directory. If the Railway image excludes `gamerampv2`, queries fail on first run. **Action item for deploy:** `ls /app/data/parquet/gamerampv2/` on Railway shell, expect 5 parquet files.

### Security (flag only, out of scope here)
Because `getDatasetForUser` does not check `selectedSampleDatasets` for static datasets, a malicious authed user with `["vastu-hfc"]` in their metadata can still query `gameramp` by hand-crafting a request with `x-dataset-id: gameramp`. This plan does NOT close that gap because the intent is "expose Presto to everyone" — but if a future user-segmentation story requires true multi-tenancy of static samples, a follow-up bead should:
- Extend `getDatasetForUser(id, userId, selectedSampleIds?)` to reject static datasets not in `selectedSampleIds`
- Thread `selectedSampleIds` from `sessionClaims.publicMetadata` in every API route (or via a middleware-level helper)

## Success Metrics
- `DEFAULT_DATASET` === `"gameramp"` in committed code
- `STATIC_DATASETS` key order: `gameramp, vastu-hfc, quickhelp, alpha`
- `onboarding/complete/page.tsx` contains no `<DatasetCard>` component references
- Manual test: new test account signup → active dataset is Presto → switcher shows Presto + HFC → Presto SQL queries return rows
- Manual test: dev account (after Clerk edit) → switcher shows Presto + HFC → existing HFC segments still present

## Dependencies & Risks

### Dependencies
- **Parquet files on deploy target.** Railway volume must have `data/parquet/gamerampv2/*.parquet`. Verify via Railway shell before deploy; if missing, upload or rebuild image with parquet included.
- **Clerk Dashboard access** for the dev-account metadata update (Step 5). If not available, use the Node one-liner with `CLERK_SECRET_KEY`.
- No new npm packages, no new env vars, no schema migration.

### Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Railway image missing `gamerampv2/` parquet | Low | High (queries fail) | Verify before deploy; existing HFC deploy presumably already included it since gameramp config is already in the bundle |
| Existing playwright tests asserting `DEFAULT_DATASET === "quickhelp"` | Medium | Low (test failures) | Grep for `"quickhelp"` in `tests/`, update fixtures. Confirmed hits in 4 spec files all hardcode `"quickhelp"` in the `x-dataset-id` header directly — safe (they don't depend on the default constant). |
| `DEFAULT_META` labels drift from dataset config | Eliminated | — | Step 2 extracts to `meta.ts` — drift risk removed |
| Users mid-wizard during deploy see mixed experience | Low | Low (single-session anomaly) | Accept — wizard is short (~2 min); rollout during quiet hours if risk-averse |
| Clerk `updateUser` wholesale-replace footgun (Step 6) | Medium | Medium if Dashboard edit is wrong | Use Dashboard editor (safer) or spread `...u.publicMetadata` explicitly in the one-liner |
| Existing user expected default behavior change | Low | Low | "New users only" design means existing users keep their settings — no surprise resets |
| Header-less request ripple (NEW) | Low | Medium | Any server route that falls back to `DEFAULT_DATASET` for missing `x-dataset-id` now routes to gameramp instead of quickhelp. Client `apiFetch` always sends the header; external integrations (curl, healthchecks, future SDK consumers) must be audited if any exist. Verified: 30+ routes use this pattern (`headers.get("x-dataset-id") \|\| DEFAULT_DATASET`). |
| `policy-store.ts` silent seed mismatch (NEW) | High without fix | Medium (demo regression) | Step 4 addresses directly — Option A scopes seeds to quickhelp, Option B rewrites for gameramp schema |
| `scripts/startup.sh` wasted provisioning (NEW) | Low | Low (boot time) | Railway startup still creates `quickhelp.duckdb` even though no new user sees it. Non-blocking; follow-up cleanup bead. |
| Discoverability surface shift (security) | Medium | Low in this plan's scope | `/api/datasets` now surfaces `gameramp` explicitly for new users, shrinking the obscurity gap around the pre-existing static-sample query gap. Still out of scope — see Out of Scope #1. |

## Testing Plan

### Local (dev server)
1. Wipe `localStorage.sentinel-dataset-id` in browser DevTools
2. Sign up as a fresh test account
3. Complete onboarding → observe landing on `/` with Presto active in switcher (top-left shows "Presto ⌵")
4. Open switcher → confirm Presto + Housing Finance visible, Presto first
5. Ask a Presto-specific question (e.g., "How many installs last week?") → verify SQL generated against gameramp schema, query succeeds, results stream
6. Switch to Housing Finance → verify switch lifecycle (panel closes, streams abort), query HFC-specific question → succeeds
7. Switch back to Presto → previous Presto state still intact (chat history preserved per datasetId scoping)

### Dev account
1. Update Clerk Dashboard metadata for `sashank@glitchcraft.io`: `selectedSampleDatasets = ["gameramp", "vastu-hfc"]`
2. Hard-refresh app
3. Verify switcher shows Presto + HFC
4. Verify existing HFC segments/playbooks still visible on HFC (no data loss)
5. Switch to Presto → verify empty-state (first time) renders cleanly

### Persistence regression
- Create a segment while on Presto → switch to HFC → confirm segment NOT in HFC list
- Switch back to Presto → confirm segment IS in Presto list
- Repeat for metrics, playbooks, knowledge, boards

### Policy seeding (NEW)
- On a fresh local dataset (delete `data/gameramp.duckdb` + any policy-store state), load Presto → open Policies UI → confirm it shows either (a) no policies (empty state) or (b) gameramp-schema-correct policies (depending on which Option of Step 4 was chosen), NOT the quickhelp-schema demo seeds with `events`/`orders`/`users` table access.
- Switch to quickhelp (if still in user's `selectedSampleDatasets`) → confirm demo policies appear there with correct schema references.

### Cold start
1. `rm -f data/gameramp.duckdb data/gameramp.duckdb.wal` (local only)
2. Restart dev server
3. Ask a Presto question → verify first-query creates DuckDB file and CHECKPOINT happens (no WAL replay crash per learning doc)

## Files Touched

| File | Change | Lines (approx) |
|---|---|---|
| `src/lib/datasets/constants.ts` | `DEFAULT_DATASET` → `"gameramp"`, add `DEFAULT_SAMPLE_DATASETS` + type | ~5 |
| `src/lib/datasets/meta.ts` | **NEW FILE** — client-safe `DATASET_META` lookup | ~35 |
| `src/lib/dataset-context.tsx` | Derive `DEFAULT_META` from `DATASET_META[DEFAULT_DATASET]` | ~5 (net shrinks) |
| `src/lib/datasets/index.ts` | Reorder `STATIC_DATASETS` keys | ~4 |
| `src/lib/policy-store.ts` | Scope demo seeds to `"quickhelp"` (Option A) | ~4 |
| `src/app/onboarding/complete/page.tsx` | Remove picker; add auto-confirm using `apiFetch` + `DEFAULT_SAMPLE_DATASETS` | ~-60 / +35 (net smaller) |
| (none — `welcome-modal.tsx` already has gameramp entry) | — | — |
| (none — `onboarding-wizard-store.ts` stays single-select) | — | — |

**Total:** 5 files edited + 1 new file. Net code change trends negative (rewrite removes more than it adds).

## Out of Scope (follow-up beads)

1. **Close the static-sample query gap.** `getDatasetForUser(id, userId)` at `src/lib/datasets/index.ts:51-66` does NOT check `selectedSampleDatasets`. Any authed user can query any static dataset by hand-crafting `x-dataset-id`. Concrete fix sketched by security review:
   ```ts
   export function getDatasetForUser(id, userId, selectedSampleIds?: string[]): DatasetConfig | null {
     // ... existing checks ...
     if (!ds.ownerId && !ds.isDynamic && selectedSampleIds && !selectedSampleIds.includes(ds.id)) return null;
     return ds;
   }
   ```
   Routes to update: `/api/analyze`, `/api/chat`, `/api/classify`, plus 20+ more that use `getDatasetForUser`. Read `sessionClaims.publicMetadata.selectedSampleDatasets` in each route. `bd create "feat(security): gate static dataset queries by selectedSampleDatasets"`
2. **`/api/segments/route.ts` skips `getDatasetForUser` entirely.** `src/app/api/segments/route.ts:23-27,42-43` reads the header and trusts it without calling the guard — bigger gap than (1) because segments are user-generated. Any authed user can list/create segments in any dataset id they know. `bd create "fix(security): add getDatasetForUser guard to /api/segments"`
3. **No CSRF protection on `/api/onboarding/complete`** (or any POST route). Next.js App Router doesn't ship CSRF tokens for POST handlers; an attacker's page can POST to Clerk-protected endpoints using the victim's session cookie and overwrite their `publicMetadata`. `bd create "feat(security): CSRF tokens on state-mutating routes"`
4. **`onboarding/complete` route footgun** — `updateUser` wholesale-replaces `publicMetadata`. A second partial update would drop fields not in the body. Refactor to read-then-merge. `bd create "fix: onboarding/complete publicMetadata wholesale replace"`
5. **Remove `quickhelp` / `alpha` from registry** if truly deprecated. Check no existing user has them in `selectedSampleDatasets` first. Also remove `scripts/startup.sh` provisioning of quickhelp.duckdb. `bd create "chore: prune unused static datasets (quickhelp, alpha) and Railway boot"`
6. **Rename dataset id `gameramp` → `presto`** — would require a data migration (rename `data/gameramp.duckdb` and any `publicMetadata.selectedSampleDatasets` entries). Skip; just keep display label as "Presto".
7. **Schema-aware policy seeds** — replace the quickhelp-scoped demo policies (this plan's Step 4 Option A) with per-dataset seed logic so each dataset gets meaningful demo policies. `bd create "refactor: per-dataset schema-aware policy seeds"`
8. **`executeSQLInternal` audit** on user-supplied SQL in segments route — `src/app/api/segments/route.ts:47-48,60` uses string-concat `SELECT * FROM (${cleanSql}) __validate`. Confirm `cleanSql` is passed through the SELECT-only validator (not just `Internal` bypass). `bd create "audit: executeSQLInternal validation chain on /api/segments"`

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-04-21-presto-dataset-gating-brainstorm.md`
- Dataset registry: `src/lib/datasets/index.ts:16-81`
- Default constant: `src/lib/datasets/constants.ts:7`
- Gameramp config: `src/lib/datasets/gameramp.ts`
- DatasetProvider: `src/lib/dataset-context.tsx:42-145`
- Sidebar switcher: `src/components/sidebar.tsx:347-394`
- Onboarding page: `src/app/onboarding/complete/page.tsx`
- Onboarding API: `src/app/api/onboarding/complete/route.ts`
- Dataset query guard: `src/lib/datasets/index.ts:51-81`
- Middleware: `src/proxy.ts`
- DuckDB singleton: `src/lib/db.ts:210-228`
- Policy store seeds (coupling site): `src/lib/policy-store.ts:40,58,76,94`
- Railway boot: `scripts/startup.sh:75,134,138,143`
- Segments route (security gap site): `src/app/api/segments/route.ts:23-48`
- Ingest fallback site: `src/app/api/ingest/route.ts:44`
- Test fixtures hardcoding quickhelp: `tests/api/funnels.spec.ts:17`, `tests/api/retentions.spec.ts:16`, `tests/e2e/funnels.spec.ts:11`, `tests/e2e/retentions.spec.ts:11`

### Institutional learnings (apply)
- `docs/solutions/database-issues/duckdb-wal-replay-alter-table-default-crash.md` — CHECKPOINT after DDL; no `ALTER TABLE ADD COLUMN ... DEFAULT`
- `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md` — localStorage reads belong in `useEffect`, not `useState` initializer (already respected in `dataset-context.tsx:69-82`; preserve)
- `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md` — static datasets like gameramp survive deploy; verify parquet dir on Railway volume
