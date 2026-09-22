---
title: Onboarding dataset picker with Presto as default
type: feat
date: 2026-04-21
branch: feat/clerk-auth-merged
revises: docs/brainstorms/2026-04-21-presto-dataset-gating-brainstorm.md (auto-assign decision)
supersedes: 061446d feat(onboarding): auto-assign Presto + HFC, remove sample picker
---

# Onboarding dataset picker with Presto as default

## Overview

Restore the onboarding sample-dataset picker that commit `061446d` removed, but with two changes versus the pre-`061446d` state:
1. **Presto is now an option** (previously the picker only offered `quickhelp` + `vastu-hfc`)
2. **Presto is pre-selected as the default highlight** — clicking "Continue to Actioneer" without changing the pick lands the user on Presto
3. **Clerk metadata still gets both datasets** regardless of pick — so Housing Finance remains one click away in the top-left switcher (preserves the brainstorm's "both visible" decision)

Picker shape: **single-select**, 2 cards side-by-side. Category chips ("Gaming", "Finance") to make the industry pitch explicit.

## Problem Statement

Commit `061446d` chose auto-assign + skip-picker to minimize clicks. That was correct for the time, but it drops the demo value of showing users our multi-industry breadth during the pre-sales-demo moment. Reintroducing the picker (with Presto featured) gives new users an explicit "here are the datasets we cover, pick what's most relevant to you" beat — better UX for the pre-sales context in which Baby Sentinel exists (per `CLAUDE.md` overview).

The fix is localized: `src/app/onboarding/complete/page.tsx` and a small `DatasetCard` prop addition. No change to Clerk, middleware, dataset registry, or dataset-scoped stores.

## Proposed Solution

Two file edits. No new files. No deletions.

1. **`src/app/onboarding/complete/page.tsx`** — rewrite sample-branch body from "You're all set" confirmation back to a 2-card picker grid. Presto pre-selected. On Continue: active dataset = user's pick; Clerk metadata gets both.
2. **`src/components/onboarding/dataset-card.tsx`** — add an optional `category` prop (e.g., "Gaming", "Finance") that renders as a second chip next to the existing "Demo" chip.

Net diff: ~+60 / -10 lines (mostly restoring the picker UI we just removed, plus Presto entry + category chip).

## Technical Approach

### Step 1 — `src/components/onboarding/dataset-card.tsx`

Add an optional `category` prop that renders a second chip.

```tsx
// src/components/onboarding/dataset-card.tsx
"use client";

interface DatasetCardProps {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  /** Optional industry/category label shown as a second chip (e.g. "Gaming", "Finance"). */
  category?: string;
}

export function DatasetCard({ name, description, selected, onClick, category }: DatasetCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all duration-150 ${
        selected
          ? "border-[#e8e8e8] bg-[#1e1e1e]"
          : "border-[#282828] bg-[#161616] hover:border-[#333] hover:bg-[#1a1a1a]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[14px] font-medium text-[#e8e8e8]">{name}</span>
        {category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#333] text-[#888] font-medium">
            {category}
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#333] text-[#666] font-medium">
          Demo
        </span>
      </div>
      <p className="text-[12px] text-[#555] leading-relaxed">{description}</p>
    </button>
  );
}
```

**Why optional:** `DatasetCard` may be reused elsewhere in the future; making `category` required would force every call site to supply one.

### Step 2 — `src/app/onboarding/complete/page.tsx`

Restore the picker for the sample branch. Uploaded-dataset branch ("Your data is ready") is unchanged. Wizard store + API contract stay identical to the current shipped version — only the pre-POST `selected` value changes based on user's click.

Key behavior:
- Options: `gameramp` (Presto, Gaming) and `vastu-hfc` (Housing Finance, Finance)
- Pre-selected: `DEFAULT_SAMPLE_DATASETS[0]` (= `gameramp`), imported from `src/lib/datasets/constants.ts`
- On Continue (sample branch):
  - `setSelectedDataset(selected)` — wizard store records the primary
  - `localStorage.sentinel-dataset-id = selected` — DatasetProvider opens with this dataset active
  - POST `selectedSampleDatasets: [...DEFAULT_SAMPLE_DATASETS]` (ALWAYS both, regardless of pick) — so top-left switcher shows both
  - Navigate to `/onboarding/syncing`

Pseudocode:

```tsx
// src/app/onboarding/complete/page.tsx (sample branch only; uploaded branch unchanged)
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { LayoutGrid, ArrowLeft } from "lucide-react";
import { DatasetCard } from "@/components/onboarding/dataset-card";
import { setSelectedDataset, setWizardStep, completeWizard, getWizardState } from "@/lib/onboarding-wizard-store";
import { DEFAULT_SAMPLE_DATASETS } from "@/lib/datasets/constants";
import { apiFetch } from "@/lib/api-client";

interface SampleOption {
  id: (typeof DEFAULT_SAMPLE_DATASETS)[number];
  name: string;
  category: string;
  description: string;
}

const SAMPLE_OPTIONS: SampleOption[] = [
  {
    id: "gameramp",
    name: "Presto",
    category: "Gaming",
    description: "Casual mobile game UA data — CPI, LTV curves, RoAS, channel fraud, and cohort payback.",
  },
  {
    id: "vastu-hfc",
    name: "Housing Finance",
    category: "Finance",
    description: "Property lending with loan grades, vintage years, DPD buckets, GNPA, and funding mix.",
  },
];

const DEFAULT_PICK: SampleOption["id"] = DEFAULT_SAMPLE_DATASETS[0]; // "gameramp"

function isSampleId(id: string): id is SampleOption["id"] {
  return (DEFAULT_SAMPLE_DATASETS as readonly string[]).includes(id);
}

export default function CompleteStep() {
  const router = useRouter();
  const wizardState = getWizardState();
  const uploadedDatasetId =
    wizardState.selectedDataset && !isSampleId(wizardState.selectedDataset)
      ? wizardState.selectedDataset
      : null;

  // If user returned to this step after already picking a sample, restore that pick.
  const initialPick = isSampleId(wizardState.selectedDataset)
    ? (wizardState.selectedDataset as SampleOption["id"])
    : DEFAULT_PICK;
  const [selected, setSelected] = useState<SampleOption["id"]>(initialPick);
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    setSaving(true);
    const activeId = uploadedDatasetId ?? selected;
    setSelectedDataset(activeId);
    localStorage.setItem("sentinel-dataset-id", activeId);

    try {
      await apiFetch("/api/onboarding/complete", {
        method: "POST",
        skipDataset: true,
        skipModel: true,
        body: {
          orgName: wizardState.accountInfo?.orgName || undefined,
          // Always both samples — user's pick only decides which is active on first load.
          selectedSampleDatasets: uploadedDatasetId ? [] : [...DEFAULT_SAMPLE_DATASETS],
        },
      });
    } catch (err) {
      console.warn("[onboarding/complete] metadata write failed", err);
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

  // ... handleBack unchanged

  return (
    <motion.div /* existing motion + icon unchanged */>
      {uploadedDatasetId ? (
        /* "Your data is ready" branch — unchanged */
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-[#e8e8e8] text-center mb-2">
            Pick your demo dataset
          </h1>
          <p className="text-[13px] text-[#666] text-center mb-8 max-w-md mx-auto">
            Start with the dataset closest to your industry. You can switch to the other any time
            from the top-left app switcher.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {SAMPLE_OPTIONS.map((opt) => (
              <DatasetCard
                key={opt.id}
                id={opt.id}
                name={opt.name}
                category={opt.category}
                description={opt.description}
                selected={selected === opt.id}
                onClick={() => setSelected(opt.id)}
              />
            ))}
          </div>
        </>
      )}
      {/* Back + Continue buttons — unchanged */}
    </motion.div>
  );
}
```

**What's restored vs current shipped state:**
- `SAMPLE_OPTIONS` array (replaces old `DATASETS` array, now with Presto + category)
- `selected` state + `setSelected` handler
- `<DatasetCard>` grid rendering
- "Pick your demo dataset" heading (replaces "You're all set")

**What's preserved from current shipped state:**
- `apiFetch` (CLAUDE.md mandate) not raw `fetch`
- `console.warn` on POST failure (no bare catch)
- Single source of truth via `DEFAULT_SAMPLE_DATASETS` import
- Uploaded-dataset branch ("Your data is ready") untouched
- Back button to `/onboarding/connect`
- Motion animations
- `DEFAULT_SAMPLE_DATASETS` still the array of all samples sent to Clerk

## Acceptance Criteria

### Functional
- [ ] `/onboarding/complete` renders two `<DatasetCard>` components for a sample-branch user: Presto (Gaming) and Housing Finance (Finance)
- [ ] On first render, Presto card is visually highlighted (selected border + background)
- [ ] Clicking the Housing Finance card changes the highlight to HFC; clicking Presto restores
- [ ] "Continue to Actioneer" → POST succeeds with `selectedSampleDatasets: ["gameramp", "vastu-hfc"]` regardless of which card was picked
- [ ] `localStorage.sentinel-dataset-id` equals the user's pick (not hardcoded `"gameramp"`)
- [ ] After redirect to `/`, the top-left switcher shows both datasets; the active one is the user's pick
- [ ] User picked Presto → lands on Presto → switcher shows both
- [ ] User picked HFC → lands on HFC → switcher shows both
- [ ] Uploaded-CSV branch is unchanged: shows "Your data is ready" and no picker grid

### Wizard-store invariants
- [ ] `wizardState.selectedDataset` persists across route changes (Back → Continue keeps the same pick)
- [ ] If the user Backs from `/complete` to `/connect` and returns, their previously-selected card is still highlighted (not reset to Presto)
- [ ] If `wizardState.selectedDataset` contains a non-sample id (uploaded dataset), picker is hidden and uploaded branch renders instead

### Visual / copy
- [ ] Headings: "Pick your demo dataset" (title) + industry-oriented subtitle ("Start with the dataset closest to your industry…")
- [ ] Each card shows two chips: industry category (Gaming/Finance) + "Demo"
- [ ] No regressions in Back button behavior
- [ ] Motion enter animation unchanged

### Regression
- [ ] Existing users (already onboarded) do NOT re-enter the wizard on sign-in — middleware still honors `onboardingComplete: true`
- [ ] `sashank@glitchcraft.io` test account (if their metadata was updated manually) continues to see both datasets in the switcher post-login
- [ ] No change to dataset-scoped store isolation (segments, playbooks, metrics, knowledge remain namespaced)

## Edge Cases

| Scenario | Expected |
|---|---|
| User picks Presto → clicks Continue | Active = gameramp; switcher shows both; metadata = both |
| User picks HFC → clicks Continue | Active = vastu-hfc; switcher shows both; metadata = both |
| User never clicks a card, just hits Continue | Presto is active (default pre-selection) |
| User backs out to `/connect`, returns to `/complete` | Previous pick restored from wizard store (not reset to Presto) |
| User uploaded a CSV | Picker hidden; "Your data is ready" branch; existing behavior |
| POST to `/api/onboarding/complete` fails (500) | `console.warn`, localStorage still has pick, user still routes to `/onboarding/syncing`; Clerk metadata is empty → `/api/datasets` filter rules (empty `selectedSampleDatasets` = treated as pre-onboarding, shows all samples). Acceptable fallback. |
| User returns to `/complete` after deploy with old `wizardState.selectedDataset = "quickhelp"` (left over from pre-`061446d` flow) | `isSampleId("quickhelp")` returns `false` (not in `DEFAULT_SAMPLE_DATASETS`) → `uploadedDatasetId` becomes `"quickhelp"` → shows "Your data is ready" branch. Minor mislabel but won't crash. Rare; acceptable. |
| `DEFAULT_SAMPLE_DATASETS` expanded to 3+ ids in the future | Picker grid stays 2-col unless `SAMPLE_OPTIONS` array is also expanded. Grid layout is independent of the constant's length. |

## Files Touched

| File | Change | Lines |
|---|---|---|
| `src/app/onboarding/complete/page.tsx` | Restore picker grid; keep `apiFetch` + shared constant + metadata-always-both | ~+55 / -10 |
| `src/components/onboarding/dataset-card.tsx` | Add optional `category` prop + chip render | ~+5 |

**Total:** 2 files. No new files, no deletions.

## Out of Scope

1. **Quick Help / Alpha in the picker** — user explicitly chose "Presto + HFC only"
2. **Multi-select picker** — single-select per user decision
3. **Changing what goes into Clerk `selectedSampleDatasets`** — always both, per user decision ("HFC always available in switcher")
4. **Category-based routing or filtering** — the "Gaming"/"Finance" chips are descriptive only
5. **Featured/hero card layout** — user picked the flat 2-card grid option
6. **Changes to uploaded-dataset branch** — untouched
7. **Security hardening of `getDatasetForUser`** — still carried in `2026-04-21-feat-presto-dataset-default-gating-plan.md` out-of-scope list

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Breaking existing users mid-wizard | Very low | Low | Middleware's `onboardingComplete` gate only runs new users through the wizard; existing users don't re-enter |
| `DatasetCard` being used elsewhere with the old prop surface | None | — | Grepped — only use is in `onboarding/complete/page.tsx`; `category` prop is optional so no call-site break even if more existed |
| `isSampleId` type predicate incorrectly typed | Low | Low | Uses `as readonly string[]` cast on the literal tuple; returns narrowed type; TS strict passes |
| Copy regression ("Pick your demo dataset" feels wrong) | Low | Low | Copy is easy to iterate post-launch; not load-bearing |
| User tests the auto-assign flow expecting it to still work | Low | Low | Calls out this plan supersedes `061446d`; wizard now requires a pick (even if default is Presto) |

## Success Metrics
- Fresh signup → picker visible at `/onboarding/complete` → click Continue without changing → land on Presto with HFC in switcher
- Fresh signup, click HFC card → click Continue → land on HFC with Presto in switcher
- No "Housing Finance is one click away" copy lingering (copy now lives on the card subtitle)

## Testing Plan

### Local
1. `resetWizard()` in browser console + clear localStorage
2. Sign up as a fresh test account
3. Go through wizard: account info → connect → **new complete page**
4. Verify: 2 cards render; Presto is highlighted; subtitle mentions top-left switcher; "Continue" button
5. Test path A: click Continue without changing → verify landing on Presto; open switcher; verify HFC present
6. Reset and test path B: click HFC card → verify highlight moves; click Continue → verify landing on HFC; open switcher; verify Presto present
7. Test Back button: on `/complete`, click Back → `/connect` → click Next/Continue on `/connect` → back to `/complete` → verify the previously-selected card is still highlighted (persistence)
8. Test uploaded-CSV branch (if you have an upload path): confirm it shows "Your data is ready" and no picker

### Existing-user safety
- Log in as `sashank@glitchcraft.io` → verify NO wizard redirect (middleware honors `onboardingComplete`); app renders with whatever was in localStorage/Clerk metadata pre-deploy

### Quality gates
- `pnpm lint` — 0 errors (warnings fine)
- `pnpm build` — clean Next.js build

## References

### Internal
- Supersedes: commit `061446d` `feat(onboarding): auto-assign Presto + HFC, remove sample picker`
- Revises: `docs/brainstorms/2026-04-21-presto-dataset-gating-brainstorm.md` (the "auto-assign" decision specifically)
- Related plan: `docs/plans/2026-04-21-feat-presto-dataset-default-gating-plan.md` (the parent work; Steps 1-3 of that plan remain correct)
- Picker component: `src/components/onboarding/dataset-card.tsx`
- Onboarding page: `src/app/onboarding/complete/page.tsx`
- Shared constant: `src/lib/datasets/constants.ts:10` (`DEFAULT_SAMPLE_DATASETS`)
- Wizard store: `src/lib/onboarding-wizard-store.ts:31` (`selectedDataset` field)
- API route: `src/app/api/onboarding/complete/route.ts`
- API client: `src/lib/api-client.ts` (`apiFetch` with `skipDataset`, `skipModel`)

### Institutional learnings (apply)
- `docs/solutions/ui-bugs/hydration-mismatch-localstorage-usestate-Sidebar-20260218.md` — localStorage reads in `useState` initializers risk SSR mismatch. `getWizardState()` already guards with `typeof window === "undefined"` and returns defaults. Safe pattern; keep.
