# Dynamic Voice-Campaign Lanes (Level-0 Grouping)

**Date:** 2026-06-10
**Status:** Approved
**Scope:** `/voice-campaign-insights` page + voice-campaign analysis pipeline

## Problem

The insights page has a three-level structure: lanes → clusters → zones. Clusters
(level 1) and zones (level 2) are now derived from embedding geometry with the LLM
only naming them. Lanes (level 0) remain a hardcoded 5-bucket taxonomy:

- `LANE_CONFIGS` in `voice-campaign-cluster-visualization.tsx` hardcodes id, label,
  chip text, claim, action copy, and accent color for 5 fixed lanes.
- `inferVoiceLane` in `src/lib/voice-campaign-lanes.ts` assigns clusters to lanes
  via outcome-share thresholds and a brittle keyword list (already misfires:
  "karna baad mein hai" → callback via the word "baad").
- `buildInterventions` hand-writes a 5-step waterfall keyed to those lane ids.

Decision: lanes become **thematic super-clusters** — derived from embedding
geometry per run, like the levels below them. A lane only exists if the run's data
produced it.

## Design

### 1. Derivation (in `scripts/analyze-voice-campaign-logs.ts`)

After primary clusters are formed and named:

1. Compute each cluster's embedding centroid (mean of member vectors).
2. Cluster the ~10 centroids with the existing seeded k-means
   (`scripts/lib/voice-clustering.ts`), sweeping k = 2..min(6, clusters − 1),
   picking k by mean silhouette. Geometry alone decides lane membership.
3. One new LLM call (separate from cluster naming; input = each lane's named
   clusters with counts and sample evidence) returns per lane:
   - `label` — full lane name
   - `compactLabel` — chip text (≤ 2 words)
   - `claim` — one-sentence diagnostic claim
   - `action` — recommended intervention copy
   plus two global fields:
   - `triageOrder` — lane ids in recommended intervention sequence
   - `mapCaption` — one-line reading guide for the signal map (replaces the
     hardcoded "Separate non-intent calls first…" subtitle)

The namer must describe what is actually in a lane; if geometry produced a mixed
lane, the label says so. No predefined lane vocabulary appears in the prompt.

### 2. Artifacts

- `clusters.json`: each cluster gains `laneId`; new top-level `lanes` array:
  `{ id, label, compactLabel, claim, action, clusterIds, count, share, triageRank }`.
  `count`/`share` are computed sums of cluster counts — never LLM output.
- `mapCaption` stored alongside `lanes` in `clusters.json`.
- `final-analysis.json`: the synthesis prompt receives lane context so the
  executive readout references the same groupings the page renders.
- No back-compat with old artifact shapes. The only run (`kyc-450-2026-06-09`)
  is regenerated. Loader treats missing lanes as a data error (page already has
  an empty state).

### 3. UI

- Delete `src/lib/voice-campaign-lanes.ts` (`inferVoiceLane`, `VoiceLaneId`
  union). Lane ids become plain strings everywhere.
- `scripts/embed-voice-campaign-calls.ts` reads `laneId` from `clusters.json`
  for lane-local UMAP groupings instead of calling `inferVoiceLane`.
- `LANE_CONFIGS` is replaced by a static accent **palette** (the existing 5 hexes
  + matching Tailwind chip classes, fixed order; reused cyclically if a run
  produces more lanes than palette entries). Palette slots are assigned to lanes
  by triage order. Colors are stable within a run, not semantically pinned
  across runs — accepted consequence.
- Lane left-to-right order on the signal map = `triageOrder`, so map and
  waterfall tell the same story.
- `buildInterventions` becomes generic: one waterfall step per lane in triage
  order, rendering the lane's `claim`/`action`. Hand-written 5-step copy is
  deleted.
- `CallDetailPanel` and all other lane lookups resolve lane data from the loaded
  payload instead of `laneConfigById`.
- Loader (`voice-campaign-insights-loader.ts`) and types
  (`voice-campaign-insights-types.ts`) expose `lanes` + `mapCaption`.

### 4. Verification

1. Re-run `npx tsx scripts/analyze-voice-campaign-logs.ts` (signal batches and
   embeddings stay cached; delete `cluster-drafts.json` downstream artifacts so
   clustering/naming/lanes recompute).
2. Re-run `npx tsx scripts/embed-voice-campaign-calls.ts --run kyc-450-2026-06-09 --force`.
3. Screenshot overview + lane drill-down via the proxy/localStorage recipe
   (temporarily public route in `src/proxy.ts` — always reverted; wizard
   localStorage flag requires `version: 1`).
4. Sanity-check lane groupings read thematically sane; waterfall coherent;
   typecheck scripts with `tsc --noEmit` (scripts are excluded from the project
   tsconfig, so check them directly).

## Accepted Risks

- At n≈10 centroids, silhouette is noisy; geometry may group semantically close
  but action-divergent clusters (e.g. "abhi busy" with "interest nahi"). The
  honest mitigation is in naming, not reassignment.
- Lane colors/copy change between runs; cross-run comparability of lanes is
  intentionally given up in favor of per-run fidelity.

## Out of Scope

- Re-clustering levels 1–2 (done earlier today).
- Multi-run lane alignment / longitudinal lane tracking.
- Any change to signal extraction.
