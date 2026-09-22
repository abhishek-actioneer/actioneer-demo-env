---
title: Expose Presto dataset, default to it, keep Housing Finance visible
branch: feat/clerk-auth-merged
date: 2026-04-21
status: brainstorm
---

# Expose Presto dataset, default to it, keep Housing Finance visible

## What We're Building

Make the already-registered Presto dataset (internal id `gameramp`) the default app that loads on sign-in, while keeping Housing Finance (`vastu-hfc`) visible in the same top-left switcher. No new dataset definitions, no new architecture — we are flipping visibility and defaults. The existing `ChevronsUpDown` dropdown in the sidebar header (`src/components/sidebar.tsx:352`) remains the single "app switcher" that gates entry to each dataset; dataset-scoped stores handle isolation automatically.

Scope is intentionally small: one constant change, one onboarding-flow tweak, no UI redesign, no new entity, no new persistence layer.

## Why This Approach

- **Presto is already in the code.** `STATIC_DATASETS` in `src/lib/datasets/index.ts:16` already registers `gameramp`. Parquet data exists at `data/parquet/gameramp/` and `data/parquet/gamerampv2/`. Schema context, domain hints, and LLM persona are defined in `src/lib/datasets/gameramp.ts`. There's nothing to "import."
- **The existing dataset switcher IS the app switcher.** The top-left dropdown already lists every dataset the user has access to (`allDatasets.map(...)` at `sidebar.tsx:365`) and `switchDataset()` already drives a clean lifecycle via `dataset-switch.ts` (aborts streams, resets UI, updates api-client headers). No reason to invent a parallel "app" concept — that would duplicate logic and break the existing guarantee that stores are dataset-scoped.
- **Dataset-scoped stores already isolate persistence.** `metric-store`, `board-store`, `playbook-store`, `knowledge-store` all use `Map<datasetId, Map<id, T>>` + `ensureInitialized(datasetId)`. Segments and boards carry `datasetId` server-side. Switching between Presto and HFC is already safe — no data leaks, no mutation of the "wrong" dataset. User-scoped data is namespaced by Clerk `userId` at the repo layer, which is orthogonal to dataset selection.
- **"New users only" default keeps current sessions safe.** Existing users (including the current signed-in account, which has `selectedSampleDatasets: ["vastu-hfc"]` and `localStorage.sentinel-dataset-id` set) are untouched. The only change they see is that Presto is now available — they can opt in by switching, no forced reset.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Source of Presto | Use existing `gameramp` dataset in `STATIC_DATASETS` | Zero migration risk; parquet and schema already in place |
| Default dataset | `DEFAULT_DATASET = "gameramp"` (was `"quickhelp"`) | One-line flip in `src/lib/datasets/constants.ts` |
| Who gets the new default | New users only | Existing users' Clerk metadata + localStorage unchanged |
| HFC (`vastu-hfc`) visibility | Remains visible alongside Presto | Users switch via the existing dropdown — honors the "gated by switcher" intent |
| `quickhelp` / `alpha` | Remain registered in code, not pre-selected for new users | Keeps the switcher uncluttered; existing users who already selected them keep them |
| Onboarding picker | Auto-assign `["gameramp", "vastu-hfc"]` and skip the sample-dataset selection screen | Matches "app switch IS the gate" — there's no point asking up front when the switcher is one click away |
| Top-left UI | No visual changes to the dropdown | Already functions as the app switcher; renaming would be churn |
| Switcher ordering | Presto first, HFC second | Reorder keys in `STATIC_DATASETS` (it iterates `Object.values` for display) |

## Affected Surfaces (reference, not implementation)

- `src/lib/datasets/constants.ts` — `DEFAULT_DATASET` constant
- `src/lib/datasets/index.ts` — `STATIC_DATASETS` key order (Presto first)
- `src/app/onboarding/*` + `src/app/api/onboarding/complete/route.ts` — auto-complete path that writes `selectedSampleDatasets: ["gameramp", "vastu-hfc"]` without showing the sample picker
- `src/components/onboarding/welcome-modal.tsx` (if still used) — bypass or simplify so the picker step is a confirmation, not a selection
- No changes needed in: sidebar switcher UI, dataset-scoped stores, api routes, segment/playbook/metric persistence, Clerk middleware

## Open Questions (for `/workflows:plan`)

1. **Onboarding skip mechanics.** Is the picker still in `welcome-modal.tsx`, and is it rendered conditionally? What's the smallest edit that converts it from "pick your datasets" to "click to start with Presto + HFC"? Plan phase should inspect `src/app/onboarding/` and decide: auto-POST on mount, redirect straight to the app, or render a one-button confirmation screen.
2. **Current user's metadata.** The signed-in development account (`sashank@glitchcraft.io`) has `selectedSampleDatasets: ["vastu-hfc"]`. Do we want a dev-only one-off Clerk API call to add `"gameramp"` to that array so testing immediately shows both, or is it fine to use the in-app "switch dataset" UI / re-run onboarding?
3. **Parquet freshness.** `data/parquet/gameramp/` and `data/parquet/gamerampv2/` both exist. Commit `e76e054` points all paths to `gamerampv2`. Plan phase should confirm `src/lib/datasets/gameramp.ts` references the right parquet directory and that no stale `gameramp/` path leaks into queries.
4. **`quickhelp` and `alpha` future.** These stay registered but won't appear for new users. Is that the long-term intent, or should we delete them from `STATIC_DATASETS` entirely in a follow-up? (Not in scope here.)
5. **Agent/entity catalog rebuild on first Presto load.** `buildEntityCatalog(datasetId, segments)` runs per dataset; confirm the first time a new user loads Presto there are no stale catalog entries from the onboarding bootstrap.

## Out of Scope

- Renaming any dataset ids (`gameramp` stays as the internal id; `Presto` is only the display label)
- Introducing a separate "app" abstraction above datasets
- Hiding HFC or removing `quickhelp` / `alpha` registrations
- Adding icons/logos per app to the switcher
- Any schema, prompt, or domain-hint changes to the Presto dataset config

## Next Step

Run `/workflows:plan` to turn these decisions into an execution plan. The plan should address all 5 open questions above and produce a diff-sized changeset (expected: 2-4 files touched, no migrations, no store changes).
