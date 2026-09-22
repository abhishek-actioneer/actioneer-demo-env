# Dynamic Voice-Campaign Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 5-lane taxonomy on `/voice-campaign-insights` with lanes derived per run from embedding geometry (centroid clustering) and named by the LLM.

**Architecture:** The analysis pipeline (`scripts/analyze-voice-campaign-logs.ts`) already k-means-clusters call-signal embeddings into primary clusters. This plan adds one level above: cluster the ~10 cluster centroids (seeded k-means, silhouette-picked k=2..6), then one LLM call names each lane (label/compactLabel/claim/action) and returns a global triage order + map caption. Lanes land in `clusters.json`; the UI reads them from the payload instead of `LANE_CONFIGS`/`inferVoiceLane`, with accent colors assigned from a static palette by triage order. `src/lib/voice-campaign-lanes.ts` is deleted.

**Tech Stack:** TypeScript, Next.js 16, OpenAI Responses API (gpt-5.4) + text-embedding-3-small, tsx scripts, agent-browser for visual verification.

**Spec:** `docs/superpowers/specs/2026-06-10-dynamic-voice-campaign-lanes-design.md`

**Conventions that override defaults:**
- NO git commits — the user handles all commits. Skip every commit step you'd normally add.
- No unit-test infra exists for the scripts or this component (only Playwright e2e behind Clerk auth). Verification = direct `tsc` typechecks, re-running the pipeline, and screenshot checks via agent-browser.
- `scripts/` is EXCLUDED from the project tsconfig — `npx tsc --noEmit` does not check scripts. Use the direct command given in each task.
- Dev server runs on :3000.

---

### Task 1: Lane derivation + naming in the analysis pipeline

**Files:**
- Modify: `scripts/analyze-voice-campaign-logs.ts`

The script currently: extracts signals → embeds them (cached `analysis/embeddings.json`) → k-means sweep (k=8..14) → `nameClusters` LLM call → writes `cluster-drafts.json` → `enrichClusters` → `clusters.json` → `synthesizeFinal`. This task adds lane derivation inside `consolidateClusters` and changes its return type.

- [ ] **Step 1: Add lane constants**

Below the existing `MAX_NAMING_SAMPLES = 15;` line, add:

```ts
// Lanes (level-0 grouping): cluster the cluster centroids the same way —
// geometry decides which clusters share a lane, the LLM only names lanes.
const MIN_LANE_K = 2;
const MAX_LANE_K = 6;
```

- [ ] **Step 2: Extend `ClusterDraft` and replace `ClusterDraftResult`**

Add `laneId` to the `ClusterDraft` interface (after `confidence: number;`):

```ts
interface ClusterDraft {
  title: string;
  description: string;
  customerLanguagePattern: string;
  callIds: string[];
  evidenceQuotes: string[];
  recommendedChange: string;
  confidence: number;
  /** Lane (level-0 grouping) this cluster belongs to — stamped after lane derivation. */
  laneId: string;
}
```

Replace the `ClusterDraftResult` interface with:

```ts
interface LaneDraft {
  id: string;
  label: string;
  compactLabel: string;
  claim: string;
  action: string;
  clusterIndexes: number[];
  triageRank: number;
}

interface ConsolidationResult {
  clusters: ClusterDraft[];
  lanes: LaneDraft[];
  mapCaption: string;
}
```

- [ ] **Step 3: Fix the `enrichClusters` unassigned fallback**

The `cluster_other` object literal in `enrichClusters` now fails to satisfy `ClusterDraft`. Add `laneId: ""` to it (after `confidence: 0.4,`). It never triggers with k-means (every call is assigned), but the type must be complete. The loader/UI treat an empty `laneId` as "not in any lane".

- [ ] **Step 4: Add the lane-naming schema and LLM call**

After the `nameClusters` function, add:

```ts
interface LaneNamingResponse {
  lanes: Array<{
    laneIndex: number;
    label: string;
    compactLabel: string;
    claim: string;
    action: string;
  }>;
  triageOrder: number[];
  mapCaption: string;
}

const laneNamingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    lanes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          laneIndex: { type: "integer" },
          label: { type: "string" },
          compactLabel: { type: "string" },
          claim: { type: "string" },
          action: { type: "string" },
        },
        required: ["laneIndex", "label", "compactLabel", "claim", "action"],
      },
    },
    triageOrder: { type: "array", items: { type: "integer" } },
    mapCaption: { type: "string" },
  },
  required: ["lanes", "triageOrder", "mapCaption"],
};

async function nameLanes(
  args: Args,
  totalCalls: number,
  laneSummaries: Array<{ laneIndex: number; clusters: Array<{ title: string; count: number; recommendedChange: string; quotes: string[] }> }>,
): Promise<LaneNamingResponse> {
  const laneBlock = (summary: (typeof laneSummaries)[number]) =>
    [
      `LANE ${summary.laneIndex} (${summary.clusters.reduce((sum, cluster) => sum + cluster.count, 0)} calls)`,
      ...summary.clusters.map(
        (cluster) =>
          `- ${cluster.title} (${cluster.count} calls) ; draftChange=${cluster.recommendedChange}` +
          (cluster.quotes.length > 0 ? ` ; quotes=${cluster.quotes.map((quote) => `"${quote}"`).join(" | ")}` : ""),
      ),
    ].join("\n");

  return postJson<LaneNamingResponse>(
    args.model,
    [
      {
        role: "system",
        text: `You name lanes — top-level groupings of voice-call signal clusters from a KYC completion campaign (Hinglish calls).
Lane membership was computed by clustering cluster centroids in embedding space and is fixed — do not propose moving clusters.
Do not use a predefined taxonomy. Describe what is actually inside each lane; if a lane is mixed, the label must say so honestly.
Do not invent counts; the counts are provided.`,
      },
      {
        role: "user",
        text: `Name these ${laneSummaries.length} lanes (${totalCalls} calls total).

For each lane return:
- laneIndex: echoed from the input.
- label: full lane name, specific to its contents.
- compactLabel: chip text, at most 2 words.
- claim: one-sentence diagnostic claim about what this lane means for the campaign.
- action: the practical intervention this lane calls for.

Also return:
- triageOrder: ALL laneIndex values, ordered as a recommended intervention sequence (handle-first lanes first — e.g. remove non-signal, suppress, schedule, then recover).
- mapCaption: one short line teaching a reader how to scan the lane map left to right (lanes will be displayed in triage order).

Lanes:

${laneSummaries.map(laneBlock).join("\n\n---\n\n")}`,
      },
    ],
    "voice_campaign_lane_naming",
    laneNamingSchema,
    6000,
  );
}
```

- [ ] **Step 5: Derive lanes inside `consolidateClusters`**

Change the signature to `async function consolidateClusters(args: Args, signals: SignalWithMetrics[]): Promise<ConsolidationResult>` and the cache read to:

```ts
  if (!args.force && existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as ConsolidationResult;
  }
```

In the drafts construction, add `laneId: ""` to the returned object (stamped below). Then replace the final `writeFileSync(...)` / `return drafts;` block with:

```ts
  // Lane derivation: cluster the cluster centroids — same geometry, one level up.
  const centroids = ordered.map((group) => {
    const centroid = new Array<number>(vectors[0].length).fill(0);
    for (const index of group) {
      for (let dim = 0; dim < centroid.length; dim += 1) centroid[dim] += vectors[index][dim];
    }
    return centroid.map((value) => value / group.length);
  });

  let laneK = 1;
  let laneScore = -Infinity;
  let laneAssignment = new Array<number>(centroids.length).fill(0);
  const maxLaneK = Math.min(MAX_LANE_K, centroids.length - 1);
  for (let k = MIN_LANE_K; k <= maxLaneK; k += 1) {
    const assignment = kMeans(centroids, k, mulberry32(3000 + k));
    if (new Set(assignment).size < k) continue;
    const score = meanSilhouette(centroids, assignment, k);
    console.log(`[voice-analysis] lanes k=${k} silhouette=${score.toFixed(3)}`);
    if (score > laneScore) {
      laneScore = score;
      laneK = k;
      laneAssignment = assignment;
    }
  }
  console.log(`[voice-analysis] lane clustering: k=${laneK} silhouette=${laneScore.toFixed(3)}`);

  const laneGroups = Array.from({ length: laneK }, (_, laneIndex) =>
    ordered.map((_, clusterIndex) => clusterIndex).filter((clusterIndex) => laneAssignment[clusterIndex] === laneIndex),
  ).filter((group) => group.length > 0);

  const laneSummaries = laneGroups.map((clusterIndexes, laneIndex) => ({
    laneIndex,
    clusters: clusterIndexes.map((clusterIndex) => ({
      title: drafts[clusterIndex].title,
      count: drafts[clusterIndex].callIds.length,
      recommendedChange: drafts[clusterIndex].recommendedChange,
      quotes: drafts[clusterIndex].evidenceQuotes.slice(0, 2),
    })),
  }));

  console.log(`[voice-analysis] naming ${laneSummaries.length} lanes with ${args.model}`);
  const laneNaming = await nameLanes(args, signals.length, laneSummaries);
  const namingByLaneIndex = new Map(laneNaming.lanes.map((lane) => [lane.laneIndex, lane]));
  const rankByLaneIndex = new Map(laneNaming.triageOrder.map((laneIndex, rank) => [laneIndex, rank]));

  const lanes: LaneDraft[] = laneGroups
    .map((clusterIndexes, laneIndex) => ({ laneIndex, clusterIndexes }))
    .sort(
      (a, b) =>
        (rankByLaneIndex.get(a.laneIndex) ?? laneGroups.length) -
        (rankByLaneIndex.get(b.laneIndex) ?? laneGroups.length),
    )
    .map((entry, rank) => {
      const naming = namingByLaneIndex.get(entry.laneIndex);
      return {
        id: `lane_${String(rank + 1).padStart(2, "0")}`,
        label: naming?.label ?? `Lane ${rank + 1}`,
        compactLabel: naming?.compactLabel ?? `Lane ${rank + 1}`,
        claim: naming?.claim ?? "",
        action: naming?.action ?? "",
        clusterIndexes: entry.clusterIndexes,
        triageRank: rank,
      };
    });

  for (const lane of lanes) {
    for (const clusterIndex of lane.clusterIndexes) {
      drafts[clusterIndex].laneId = lane.id;
    }
  }

  const result: ConsolidationResult = { clusters: drafts, lanes, mapCaption: laneNaming.mapCaption };
  writeFileSync(
    path,
    JSON.stringify(
      {
        clustering: { method: "kmeans-embedding", k: bestK, silhouette: Number(bestScore.toFixed(3)) },
        laneClustering: { method: "kmeans-centroids", k: laneK, silhouette: Number(laneScore.toFixed(3)) },
        ...result,
      },
      null,
      2,
    ),
  );
  return result;
```

- [ ] **Step 6: Write lanes into `clusters.json` from `main()`**

In `main()`, replace:

```ts
  const drafts = await consolidateClusters(args, signals);
  const clusters = enrichClusters(signals, drafts);
  writeFileSync(join(args.outDir, "clusters.json"), JSON.stringify({ clusters }, null, 2));
  console.log(`[voice-analysis] clusters=${clusters.length}`);
```

with:

```ts
  const consolidation = await consolidateClusters(args, signals);
  const clusters = enrichClusters(signals, consolidation.clusters);
  const lanes = consolidation.lanes.map((lane) => {
    const members = clusters.filter((cluster) => cluster.laneId === lane.id);
    const count = members.reduce((sum, cluster) => sum + cluster.count, 0);
    return {
      id: lane.id,
      label: lane.label,
      compactLabel: lane.compactLabel,
      claim: lane.claim,
      action: lane.action,
      clusterIds: members.map((cluster) => cluster.id),
      count,
      share: Number((count / signals.length).toFixed(4)),
      triageRank: lane.triageRank,
    };
  });
  writeFileSync(
    join(args.outDir, "clusters.json"),
    JSON.stringify({ lanes, mapCaption: consolidation.mapCaption, clusters }, null, 2),
  );
  console.log(`[voice-analysis] clusters=${clusters.length} lanes=${lanes.length}`);
```

Then update the `synthesizeFinal` call site to pass lanes: `const final = await synthesizeFinal(args, logs, clusters, lanes);`

- [ ] **Step 7: Feed lane context into `synthesizeFinal`**

Change the signature to:

```ts
async function synthesizeFinal(
  args: Args,
  logs: StructuredCallLog[],
  clusters: EnrichedCluster[],
  lanes: Array<{ id: string; label: string; count: number; claim: string; action: string; clusterIds: string[] }>,
): Promise<FinalAnalysis> {
```

and in the user prompt, after the `Outcome mix:` line, add:

```ts
Lanes (triage groupings of the clusters, in recommended intervention order):
${lanes.map((lane) => `${lane.id}: ${lane.label} — ${lane.count} calls; claim=${lane.claim}; action=${lane.action}; clusters=[${lane.clusterIds.join(", ")}]`).join("\n")}
```

(inside the existing template literal, between the campaign block and `Derived clusters:`).

- [ ] **Step 8: Typecheck**

Run:
```bash
npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck scripts/analyze-voice-campaign-logs.ts
```
Expected: exit 0, no output. (Do NOT rely on project-wide `tsc --noEmit` — `scripts/` is excluded.)

---

### Task 2: Embed script reads `laneId`; delete the lane heuristic module

**Files:**
- Modify: `scripts/embed-voice-campaign-calls.ts`
- Delete: `src/lib/voice-campaign-lanes.ts`

- [ ] **Step 1: Drop the `inferVoiceLane` import**

Remove the line:
```ts
import { inferVoiceLane } from "../src/lib/voice-campaign-lanes";
```

- [ ] **Step 2: Add `laneId` to `ClusterRecord`**

In the `ClusterRecord` interface, add `laneId?: string;` after `id: string;`.

- [ ] **Step 3: Replace the lane-membership block**

Replace this block (inside `main()`, under the "Lane-local projections" comment):

```ts
  for (const cluster of clusterFile.clusters ?? []) {
    if (cluster.title.toLowerCase().includes("other lower-frequency")) continue;
    const lane = inferVoiceLane({
      title: cluster.title,
      description: cluster.description,
      customerLanguagePattern: cluster.customerLanguagePattern,
      count: cluster.count ?? (cluster.callIds ?? []).length,
      outcomeMix: cluster.outcomeMix,
    });
    const list = laneMembers.get(lane) ?? [];
    for (const callId of cluster.callIds ?? []) {
      if (indexByCall.has(callId)) list.push(callId);
    }
    laneMembers.set(lane, list);
  }
```

with:

```ts
  for (const cluster of clusterFile.clusters ?? []) {
    // Lanes come from the analysis pipeline (centroid clustering) — clusters
    // without a laneId (legacy artifacts) get no lane-local projection.
    if (!cluster.laneId) continue;
    const list = laneMembers.get(cluster.laneId) ?? [];
    for (const callId of cluster.callIds ?? []) {
      if (indexByCall.has(callId)) list.push(callId);
    }
    laneMembers.set(cluster.laneId, list);
  }
```

- [ ] **Step 4: Remove now-unused `ClusterRecord` fields**

`description`, `customerLanguagePattern`, `count`, and `outcomeMix` on `ClusterRecord` were only consumed by `inferVoiceLane`. Remove those four fields from the interface (keep `id`, `laneId`, `title`, `callIds`).

- [ ] **Step 5: Delete the heuristic module and check for stragglers**

```bash
rm src/lib/voice-campaign-lanes.ts
grep -rn "voice-campaign-lanes\|inferVoiceLane\|VoiceLaneId" src scripts
```
Expected: grep finds matches ONLY in `src/components/voice-campaigns/voice-campaign-cluster-visualization.tsx` (fixed in Task 4). If anything else matches, fix it now.

- [ ] **Step 6: Typecheck the script**

```bash
npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck scripts/embed-voice-campaign-calls.ts
```
Expected: exit 0.

---

### Task 3: Types + loader expose lanes

**Files:**
- Modify: `src/lib/voice-campaign-insights-types.ts`
- Modify: `src/lib/voice-campaign-insights-loader.ts`

- [ ] **Step 1: Add the lane type and extend cluster/payload types**

In `voice-campaign-insights-types.ts`:

Add after `VoiceCampaignCallDetail`:

```ts
export interface VoiceCampaignInsightLane {
  id: string;
  label: string;
  /** Chip text (≤ 2 words). */
  compactLabel: string;
  /** One-sentence diagnostic claim. */
  claim: string;
  /** Recommended intervention copy. */
  action: string;
  clusterIds: string[];
  count: number;
  share: number;
  /** 0-based position in the pipeline-recommended intervention sequence. */
  triageRank: number;
}
```

In `VoiceCampaignInsightCluster`, add after `id: string;`:

```ts
  /** Lane (level-0 grouping) this cluster belongs to; "" if unassigned. */
  laneId: string;
```

In `VoiceCampaignInsightsPayload`, add after `clusters: VoiceCampaignInsightCluster[];`:

```ts
  /** Run-derived lanes (centroid clustering + LLM naming), sorted by triageRank. */
  lanes: VoiceCampaignInsightLane[];
  /** One-line reading guide for the lane map, from the lane-naming LLM call. */
  mapCaption: string;
```

- [ ] **Step 2: Read lanes in the loader**

In `voice-campaign-insights-loader.ts`:

Add `VoiceCampaignInsightLane` to the type import list.

Change `ClusterFile` to:

```ts
interface ClusterFile {
  lanes?: VoiceCampaignInsightLane[];
  mapCaption?: string;
  clusters?: Array<VoiceCampaignInsightCluster & { callIds?: string[] }>;
}
```

In the `clusters` mapping, add after `id: cluster.id,`:

```ts
    laneId: cluster.laneId ?? "",
```

In the returned payload, add after `clusters,`:

```ts
    lanes: (clusterFile.lanes ?? []).slice().sort((a, b) => a.triageRank - b.triageRank),
    mapCaption: clusterFile.mapCaption ?? "",
```

- [ ] **Step 3: Typecheck the app**

```bash
npx tsc --noEmit
```
Expected: errors ONLY in `voice-campaign-cluster-visualization.tsx` (it still imports the deleted `voice-campaign-lanes` module and doesn't pass new props yet — Task 4 fixes it). No errors in loader/types.

---

### Task 4: UI reads lanes from the payload

**Files:**
- Modify: `src/components/voice-campaigns/voice-campaign-cluster-visualization.tsx`

All lane lookups currently flow through `LANE_CONFIGS` + `laneConfigById(laneId)` + `inferVoiceLane`. Strategy: build `LaneConfig[]` from `insights.lanes` (palette by triage order), stamp `accent`/`chip`/`laneCompactLabel` onto each `ClusterDatum`, and remove every `laneConfigById` call.

- [ ] **Step 1: Replace the lanes import and `LaneId` type**

Remove:
```ts
import { inferVoiceLane, type VoiceLaneId } from "@/lib/voice-campaign-lanes";

type LaneId = VoiceLaneId;
```
Add `VoiceCampaignInsightLane` to the types import from `@/lib/voice-campaign-insights-types`, and:
```ts
type LaneId = string;
```

- [ ] **Step 2: Replace `LANE_CONFIGS` + `laneConfigById` with a palette + builder**

Delete the entire `LANE_CONFIGS` array and the `laneConfigById` function. In their place:

```ts
/**
 * Static accent palette — assigned to lanes by triage order. Colors are stable
 * within a run, not semantically pinned across runs (lanes are run-derived).
 */
const LANE_ACCENTS: Array<{ accent: string; chip: string }> = [
  { accent: "#60a5fa", chip: "bg-blue-400/15 text-blue-300" },
  { accent: "#fb7185", chip: "bg-rose-400/15 text-rose-300" },
  { accent: "#fbbf24", chip: "bg-amber-400/15 text-amber-200" },
  { accent: "#34d399", chip: "bg-emerald-400/15 text-emerald-300" },
  { accent: "#a78bfa", chip: "bg-violet-400/15 text-violet-300" },
];

function toLaneConfigs(lanes: VoiceCampaignInsightLane[]): LaneConfig[] {
  return lanes
    .slice()
    .sort((a, b) => a.triageRank - b.triageRank)
    .map((lane, index) => ({
      id: lane.id,
      label: lane.label,
      compactLabel: lane.compactLabel,
      claim: lane.claim,
      action: lane.action,
      ...LANE_ACCENTS[index % LANE_ACCENTS.length],
    }));
}
```

Also remove the now-dead `const inferLane = inferVoiceLane;` line.

- [ ] **Step 3: Stamp lane visuals onto `ClusterDatum`**

Add to the `ClusterDatum` interface (after `laneId: LaneId;`):

```ts
  /** Lane visuals, denormalized so render code never needs a lane lookup. */
  accent: string;
  chip: string;
  laneCompactLabel: string;
```

Rewrite `toClusterData` to take lane configs and use payload `laneId`:

```ts
function toClusterData(
  clusters: VoiceCampaignInsightCluster[],
  laneConfigs: LaneConfig[],
): ClusterDatum[] {
  const laneById = new Map(laneConfigs.map((lane) => [lane.id, lane]));
  const sorted = clusters
    .slice()
    .filter((cluster) => laneById.has(cluster.laneId))
    .sort((a, b) => b.count - a.count);

  // Lane positions are derived from lanes that actually have clusters, so the
  // plot always spans the full width even when a lane is empty for a run.
  const presentLaneIds = laneConfigs
    .filter((lane) => sorted.some((cluster) => cluster.laneId === lane.id))
    .map((lane) => lane.id);

  const laneOrders = new Map<LaneId, number>();
  const laneSizes = new Map<LaneId, number>();
  for (const cluster of sorted) {
    laneSizes.set(cluster.laneId, (laneSizes.get(cluster.laneId) ?? 0) + 1);
  }

  return sorted.map((cluster) => {
    const lane = laneById.get(cluster.laneId)!;
    const laneIndex = presentLaneIds.indexOf(cluster.laneId);
    const laneOrder = laneOrders.get(cluster.laneId) ?? 0;
    laneOrders.set(cluster.laneId, laneOrder + 1);

    const title = cluster.title.replace(/^"+|"+$/g, "");
    // Spread clusters symmetrically around the lane center so a busy lane
    // doesn't drift into its neighbor.
    const laneSize = laneSizes.get(cluster.laneId) ?? 1;
    const offsetWithinLane = (laneOrder - (laneSize - 1) / 2) * 0.9;
    const plotDate = new Date(laneDateAt(laneIndex).getTime() + offsetWithinLane * 24 * 60 * 60 * 1000);

    return {
      id: cluster.id,
      title,
      shortTitle: compactText(title, 44),
      count: cluster.count,
      share: cluster.share,
      confidence: cluster.confidence,
      laneId: cluster.laneId,
      accent: lane.accent,
      chip: lane.chip,
      laneCompactLabel: lane.compactLabel,
      laneIndex,
      laneOrder,
      plotDate,
      // Square-root position scale: keeps volume ordering while giving the
      // many small clusters enough vertical room for collision-free labels.
      plotValue: Math.sqrt(cluster.count),
      radius: clamp(4 + Math.sqrt(cluster.count) * 0.82, 7, 14),
      description: cluster.description,
      evidenceQuotes: cluster.evidenceQuotes,
      recommendedChange: cluster.recommendedChange,
      avgDurationSeconds: cluster.avgDurationSeconds,
      medianTurns: cluster.medianTurns,
      outcomeMix: cluster.outcomeMix,
      sampleCallIds: cluster.sampleCallIds,
      callIds: cluster.callIds,
    };
  });
}
```

NOTE: preserve whatever trailing fields the current mapper returns — the body above must produce the same `ClusterDatum` fields as today plus the three new ones. The old `.filter((cluster) => !cluster.title.toLowerCase().includes("other lower-frequency"))` is replaced by the `laneById.has(cluster.laneId)` filter (the residue cluster no longer exists; legacy clusters with `laneId: ""` are excluded the same way). The old `assignments` array (pairing cluster with `inferLane(cluster)`) is gone entirely.

- [ ] **Step 4: `buildLanes` takes lane configs**

```ts
function buildLanes(
  clusters: ClusterDatum[],
  totalCalls: number,
  laneConfigs: LaneConfig[],
): LaneModel[] {
  return laneConfigs
    .filter((config) => clusters.some((cluster) => cluster.laneId === config.id))
    .map((config, index) => {
      const laneClusters = clusters
        .filter((cluster) => cluster.laneId === config.id)
        .sort((a, b) => b.count - a.count);
      const total = laneClusters.reduce((sum, cluster) => sum + cluster.count, 0);

      return {
        ...config,
        index,
        clusters: laneClusters,
        total,
        share: total / Math.max(totalCalls, 1),
        topTitle: laneClusters[0]?.title ?? "No dominant signal",
      };
    });
}
```

- [ ] **Step 5: Remove remaining `laneConfigById` call sites**

Four call sites; replace each with the denormalized field:

1. `CampaignTriageOverlay` — `const accent = laneConfigById(cluster.laneId).accent;` → `const accent = cluster.accent;`
2. `ClusterTooltipContent` — `style={{ backgroundColor: laneConfigById(cluster.laneId).accent }}` → `style={{ backgroundColor: cluster.accent }}`
3. `SelectedSignal` — the chip:
   ```tsx
   <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cluster.chip}`}>
     {cluster.laneCompactLabel}
   </span>
   ```
4. `CallDetailPanel` — `const lane = laneConfigById(cluster.laneId);` → delete the line; replace `lane.chip` → `cluster.chip`, `lane.compactLabel` → `cluster.laneCompactLabel`, `lane.accent` (evidence-quote `borderColor`) → `cluster.accent`.

- [ ] **Step 6: Generic intervention waterfall**

Add `accent: string;` and `chip: string;` to `InterventionStep`. Replace `buildInterventions` entirely:

```ts
function buildInterventions(lanes: LaneModel[], totalCalls: number): InterventionStep[] {
  // Lanes arrive in pipeline triage order — the waterfall is one step per lane.
  let cumulative = 0;
  return lanes
    .filter((lane) => lane.total > 0)
    .map((lane) => {
      cumulative += lane.total;
      const weightedConfidence =
        lane.clusters.reduce((sum, cluster) => sum + cluster.confidence * cluster.count, 0) /
        Math.max(lane.total, 1);

      return {
        id: lane.id,
        title: lane.label,
        laneId: lane.id,
        accent: lane.accent,
        chip: lane.chip,
        affected: lane.total,
        share: lane.total / Math.max(totalCalls, 1),
        cumulative,
        confidence: weightedConfidence,
        source: lane.topTitle,
        action: lane.action,
      };
    });
}
```

In `InterventionWaterfall`, remove `const lane = laneConfigById(step.laneId);` and use `step.chip` / `step.accent` in the chip className and bar `backgroundColor`.

- [ ] **Step 7: Dynamic map caption**

`SignalArchitecture` gains a `mapCaption: string` prop (add to both the destructured params and the props type). Replace the hardcoded subtitle:

```tsx
<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
  {mapCaption || "Clusters are grouped into lanes discovered from this run's calls."}
</p>
```

- [ ] **Step 8: Wire the main component**

In `VoiceCampaignClusterVisualization`:

```ts
  const laneConfigs = useMemo(() => toLaneConfigs(insights.lanes), [insights.lanes]);
  const clusters = useMemo(() => toClusterData(insights.clusters, laneConfigs), [insights.clusters, laneConfigs]);
  const lanes = useMemo(
    () => buildLanes(clusters, insights.calls, laneConfigs),
    [clusters, insights.calls, laneConfigs],
  );
```

and pass `mapCaption={insights.mapCaption}` to `<SignalArchitecture ... />`.

- [ ] **Step 9: Typecheck + lint**

```bash
npx tsc --noEmit
npx eslint src/components/voice-campaigns/voice-campaign-cluster-visualization.tsx src/lib/voice-campaign-insights-loader.ts src/lib/voice-campaign-insights-types.ts
```
Expected: both clean. If `tsc` reports unused identifiers (`labelAnchorForLane` etc. are still used — only lane-heuristic leftovers should be unused), delete the leftovers.

---

### Task 5: Regenerate run artifacts

**Files:**
- Regenerates: `data/voice-simulation-runs/kyc-450-2026-06-09/analysis/{cluster-drafts,clusters,final-analysis,summary,call-map}.json`, `analysis-report.md`

- [ ] **Step 1: Delete stale cluster-stage artifacts (KEEP signal batches and embeddings)**

```bash
cd /Users/vimarsh/Documents/baby-sentinel
rm data/voice-simulation-runs/kyc-450-2026-06-09/analysis/cluster-drafts.json \
   data/voice-simulation-runs/kyc-450-2026-06-09/analysis/clusters.json \
   data/voice-simulation-runs/kyc-450-2026-06-09/analysis/final-analysis.json \
   data/voice-simulation-runs/kyc-450-2026-06-09/analysis/call-map.json
```
Do NOT pass `--force` to the analyze script and do NOT delete `signal-batches/`, `signals.json`, or `embeddings.json` — signal extraction is the expensive cached stage and embeddings are reused.

- [ ] **Step 2: Run the analysis pipeline**

```bash
npx tsx scripts/analyze-voice-campaign-logs.ts
```
Expected log lines (values vary): cached embeddings reused; `k=8..14 silhouette=...` sweep; `primary clustering: k=10 silhouette=0.185`; `lanes k=2..6 silhouette=...`; `lane clustering: k=<n>`; `naming <n> lanes with gpt-5.4`; `clusters=10 lanes=<n>`; `complete`.

- [ ] **Step 3: Sanity-check the lanes**

```bash
npx tsx -e "
import { readFileSync } from 'fs';
const { lanes, mapCaption, clusters } = JSON.parse(readFileSync('data/voice-simulation-runs/kyc-450-2026-06-09/analysis/clusters.json', 'utf8'));
console.log('mapCaption:', mapCaption);
for (const lane of lanes) {
  console.log(\`\${lane.id} rank=\${lane.triageRank} n=\${lane.count} \${lane.compactLabel} :: \${lane.label}\`);
  for (const id of lane.clusterIds) console.log('   ', id, clusters.find((c) => c.id === id)?.title);
}
console.log('lane total', lanes.reduce((s, l) => s + l.count, 0), '— expect 450');
"
```
Expected: every cluster appears in exactly one lane; lane totals sum to 450; labels read coherent. If a lane mixes wildly unrelated clusters, that is ACCEPTED (spec: honest naming over curation) — do not hand-edit.

- [ ] **Step 4: Rebuild the call map**

```bash
npx tsx scripts/embed-voice-campaign-calls.ts --run kyc-450-2026-06-09 --force
```
Expected: "Reusing cached embeddings", zone splits logged, lane-local projections logged per `lane_NN` id, "Wrote 450 points".

---

### Task 6: Visual verification

**Files:**
- Temporarily modify, then REVERT: `src/proxy.ts`

- [ ] **Step 1: Make the route temporarily public**

In `src/proxy.ts`, add `"/voice-campaign-insights",` as the first entry of the `isPublicRoute` matcher array. ⚠️ This MUST be reverted in Step 4 — never finish with this in place.

- [ ] **Step 2: Open and screenshot (dev server on :3000)**

```bash
agent-browser open "http://localhost:3000/voice-campaign-insights"
agent-browser eval "localStorage.setItem('sentinel-onboarding-wizard', JSON.stringify({version:1,currentStep:'complete',accountInfo:{orgName:'',appName:'',appUrl:''},selectedConnectors:[],selectedDataset:'',completed:true}))"
agent-browser open "http://localhost:3000/voice-campaign-insights"
# wait ~6s for compile; if a "Welcome to Actioneer" modal appears, click "Start Exploring" (find its ref via agent-browser snapshot)
agent-browser screenshot /tmp/lanes-overview.png
```
The wizard flag must include `version: 1` or `getWizardState()` discards it. The page scrolls inside the second `main` (className contains `overflow-y-auto`), not the window:
```bash
agent-browser eval "(() => { const m=[...document.querySelectorAll('main')].find(x=>x.className.includes('overflow-y-auto')); m.scrollTop=400; return 'ok'; })()"
```

- [ ] **Step 3: Check the four surfaces**

1. Overview: lane chips show LLM `compactLabel`s with palette colors in triage order; caption under "Signal architecture" is the run's `mapCaption`; cluster dots/labels colored by lane.
2. Drill-down: click a lane chip (`agent-browser snapshot` → find button ref → `agent-browser click "@eNN"`); per-call dots + zone mosaic render; header shows lane `label` + `claim`/`action`.
3. Selected signal section: chip shows the cluster's lane `compactLabel`.
4. Intervention waterfall: one step per lane, in the same order as the chip strip, with lane `label`/`action` copy.

- [ ] **Step 4: REVERT the proxy change**

Remove `"/voice-campaign-insights",` from `src/proxy.ts` and verify:
```bash
git diff src/proxy.ts
```
Expected: empty output.

---

## Self-review notes

- Spec coverage: derivation (Task 1 steps 4-5), artifacts (Task 1 step 6, Task 3), final-analysis lane context (Task 1 step 7), UI palette/order/waterfall/caption (Task 4), embed-script laneId + module deletion (Task 2), regeneration + verification (Tasks 5-6). No back-compat by design; loader defaults (`laneId: ""`, `lanes: []`) only prevent crashes on legacy artifacts — the page will render no lanes for them, which is acceptable per spec.
- Type consistency: `LaneDraft.triageRank` (pipeline) ↔ `VoiceCampaignInsightLane.triageRank` (app); `ClusterDraft.laneId` ↔ cluster `laneId` in artifacts ↔ `VoiceCampaignInsightCluster.laneId`; `toLaneConfigs`/`toClusterData`/`buildLanes` signatures match their call sites in Task 4 step 8.
