import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { UMAP } from "umap-js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedTexts,
  kMeans,
  loadCachedEmbeddings,
  meanSilhouette,
  mulberry32,
  saveEmbeddings,
  signalEmbeddingText,
} from "./lib/voice-clustering";

// Embeds every call's extracted signal and projects to 2D with UMAP, producing
// analysis/call-map.json for the voice-campaign-insights cluster map.
//
// Usage: npx tsx scripts/embed-voice-campaign-calls.ts [--run <runId>] [--force]

interface SignalRecord {
  callId?: string;
  primarySignal?: string;
  observableSummary?: string;
  customerPosition?: string;
}

interface ClusterRecord {
  id: string;
  laneId?: string;
  title: string;
  callIds?: string[];
}

interface CallMapPoint {
  callId: string;
  clusterId: string | null;
  zoneId: string | null;
  x: number;
  y: number;
  /** Lane-local UMAP position — faithful local geometry for the drill-down map. */
  laneX: number | null;
  laneY: number | null;
}

interface CallZone {
  id: string;
  clusterId: string;
  title: string;
  count: number;
  silhouette: number;
}

const RUNS_ROOT = resolve("data/voice-simulation-runs");
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Sub-zone discovery: only split clusters with enough calls, only keep splits
// the embedding geometry actually supports.
const MIN_CLUSTER_SIZE_TO_SPLIT = 16;
const MIN_ZONE_SIZE = 5;
const MIN_SILHOUETTE = 0.1;
const MAX_ZONES_PER_CLUSTER = 4;

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue
      .replace(/^export\s+/, "")
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  }
}

function parseArgs(): { runId: string | undefined; force: boolean } {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return { runId: get("run"), force: argv.includes("--force") };
}

function latestRunId(): string | undefined {
  if (!existsSync(RUNS_ROOT)) return undefined;
  return readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(RUNS_ROOT, name, "analysis", "signals.json")))
    .sort()
    .at(-1);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Rotates 2D points onto their principal axes so the dominant spread is
 * horizontal — UMAP orientation is arbitrary, and the insights chart is wide.
 */
function pcaRotate(points: number[][]): number[][] {
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / n;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point[0] - meanX;
    const dy = point[1] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return points.map((point) => {
    const dx = point[0] - meanX;
    const dy = point[1] - meanY;
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  });
}

async function labelZones(
  model: string,
  zones: Array<{ zoneId: string; clusterTitle: string; samples: string[] }>,
): Promise<Map<string, string>> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      zones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            zoneId: { type: "string" },
            title: { type: "string" },
          },
          required: ["zoneId", "title"],
        },
      },
    },
    required: ["zones"],
  };

  const prompt = [
    "You are labeling sub-zones discovered inside clusters of voice-call signals from a KYC completion campaign (Hinglish calls).",
    "For each zone, write a short specific title (max 8 words, may use Hinglish customer phrasing) that distinguishes it from sibling zones of the same parent cluster.",
    "Zones:",
    JSON.stringify(
      zones.map((zone) => ({
        zoneId: zone.zoneId,
        parentCluster: zone.clusterTitle,
        sampleSignals: zone.samples,
      })),
      null,
      1,
    ),
  ].join("\n");

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      text: { format: { type: "json_schema", name: "zone_labels", strict: true, schema } },
      max_output_tokens: 4000,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI Responses API error ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text =
    typeof data.output_text === "string"
      ? data.output_text
      : (data.output ?? [])
          .flatMap((item) => item.content ?? [])
          .map((content) => content.text ?? "")
          .join("");
  const parsed = JSON.parse(text) as { zones: Array<{ zoneId: string; title: string }> };
  return new Map(parsed.zones.map((zone) => [zone.zoneId, zone.title]));
}

async function main(): Promise<void> {
  loadEnvFile(resolve(".env"));
  loadEnvFile(resolve(".env.local"));
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env.local or export it before running.");
  }

  const { runId: requestedRunId, force } = parseArgs();
  const runId = requestedRunId ?? latestRunId();
  if (!runId) throw new Error("No run with analysis/signals.json found under data/voice-simulation-runs");

  const analysisDir = join(RUNS_ROOT, runId, "analysis");
  const outPath = join(analysisDir, "call-map.json");
  if (existsSync(outPath) && !force) {
    console.log(`call-map.json already exists for ${runId} — pass --force to regenerate.`);
    return;
  }

  const signalsFile = readJson<SignalRecord[] | { signals?: SignalRecord[] }>(
    join(analysisDir, "signals.json"),
  );
  const signals = (Array.isArray(signalsFile) ? signalsFile : (signalsFile.signals ?? [])).filter(
    (record): record is SignalRecord & { callId: string } => Boolean(record.callId),
  );
  if (signals.length === 0) throw new Error("signals.json has no records with callId");

  const clusterFile = readJson<{ clusters?: ClusterRecord[] }>(join(analysisDir, "clusters.json"));
  const clusterByCall = new Map<string, string>();
  const clusterTitles = new Map<string, string>();
  for (const cluster of clusterFile.clusters ?? []) {
    clusterTitles.set(cluster.id, cluster.title.replace(/^"+|"+$/g, ""));
    for (const callId of cluster.callIds ?? []) clusterByCall.set(callId, cluster.id);
  }

  // Reuse the vectors the analysis pipeline clustered on, so zones and UMAP
  // projections share the exact geometry of the primary clusters.
  const embeddingsPath = join(analysisDir, "embeddings.json");
  const callIds = signals.map((record) => record.callId);
  let vectors = loadCachedEmbeddings(embeddingsPath, callIds);
  if (vectors) {
    console.log(`Reusing cached embeddings for ${vectors.length} call signals from ${runId}.`);
  } else {
    console.log(`Embedding ${signals.length} call signals from ${runId} with ${EMBEDDING_MODEL}...`);
    vectors = await embedTexts(signals.map(signalEmbeddingText), (done, total) =>
      console.log(`  embedded ${done}/${total}`),
    );
    saveEmbeddings(embeddingsPath, callIds, vectors);
  }

  // Second-level zones: split each large cluster in embedding space when the
  // geometry confidently supports it (silhouette-gated k-means).
  console.log("Discovering sub-zones inside clusters...");
  const indexByCall = new Map(signals.map((record, index) => [record.callId, index]));
  const zoneByCall = new Map<string, string>();
  const zones: CallZone[] = [];
  const zonesToLabel: Array<{ zoneId: string; clusterTitle: string; samples: string[] }> = [];

  for (const cluster of clusterFile.clusters ?? []) {
    const memberIds = (cluster.callIds ?? []).filter((callId) => indexByCall.has(callId));
    if (memberIds.length === 0) continue;
    const memberVectors = memberIds.map((callId) => vectors[indexByCall.get(callId)!]);
    const clusterTitle = clusterTitles.get(cluster.id) ?? cluster.id;

    let bestK = 1;
    let bestScore = 0;
    let bestAssignment: number[] = new Array(memberIds.length).fill(0);
    if (memberIds.length >= MIN_CLUSTER_SIZE_TO_SPLIT) {
      for (let k = 2; k <= MAX_ZONES_PER_CLUSTER; k += 1) {
        const assignment = kMeans(memberVectors, k, mulberry32(1000 + k));
        const sizes = new Array<number>(k).fill(0);
        for (const value of assignment) sizes[value] += 1;
        if (Math.min(...sizes) < MIN_ZONE_SIZE) continue;
        const score = meanSilhouette(memberVectors, assignment, k);
        if (score > bestScore) {
          bestScore = score;
          bestK = k;
          bestAssignment = assignment;
        }
      }
      if (bestScore < MIN_SILHOUETTE) {
        bestK = 1;
        bestAssignment = new Array(memberIds.length).fill(0);
      }
    }

    for (let zoneIndex = 0; zoneIndex < bestK; zoneIndex += 1) {
      const zoneId = bestK === 1 ? cluster.id : `${cluster.id}-z${zoneIndex + 1}`;
      const zoneCallIds = memberIds.filter((_, i) => bestAssignment[i] === zoneIndex);
      for (const callId of zoneCallIds) zoneByCall.set(callId, zoneId);
      zones.push({
        id: zoneId,
        clusterId: cluster.id,
        title: bestK === 1 ? clusterTitle : "",
        count: zoneCallIds.length,
        silhouette: bestK === 1 ? 0 : Number(bestScore.toFixed(3)),
      });
      if (bestK > 1) {
        const samples = zoneCallIds
          .slice(0, 10)
          .map((callId) => signals[indexByCall.get(callId)!].primarySignal ?? "")
          .filter(Boolean);
        zonesToLabel.push({ zoneId, clusterTitle, samples });
      }
    }
    if (bestK > 1) {
      console.log(`  ${clusterTitle}: split into ${bestK} zones (silhouette ${bestScore.toFixed(2)})`);
    }
  }

  if (zonesToLabel.length > 0) {
    const labelModel = process.env.OPENAI_MODEL ?? "gpt-5.4";
    console.log(`Labeling ${zonesToLabel.length} zones with ${labelModel}...`);
    const titles = await labelZones(labelModel, zonesToLabel);
    for (const zone of zones) {
      if (!zone.title) zone.title = titles.get(zone.id) ?? clusterTitles.get(zone.clusterId) ?? zone.id;
    }
  }

  console.log("Projecting to 2D with UMAP...");
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: 15,
    minDist: 0.25,
    random: mulberry32(42),
  });
  const projected = umap.fit(vectors);

  // Lane-local projections: the global map packs each lane into a tiny region
  // whose internal layout is mostly arbitrary, so drill-down views magnify
  // noise. A per-lane UMAP gives faithful local geometry instead.
  console.log("Projecting lane-local maps...");
  const lanePosByCall = new Map<string, { x: number; y: number }>();
  const laneMembers = new Map<string, string[]>();
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
  if (laneMembers.size === 0) {
    console.warn(
      "No clusters with laneId found — lane-local projections skipped (laneX/laneY will be null). Re-run the analysis pipeline first.",
    );
  }

  let laneSeed = 7;
  for (const [lane, memberIds] of laneMembers) {
    laneSeed += 1;
    if (memberIds.length < 5) {
      memberIds.forEach((callId, index) => {
        lanePosByCall.set(callId, { x: (index + 1) / (memberIds.length + 1), y: 0.5 });
      });
      continue;
    }
    const laneVectors = memberIds.map((callId) => vectors[indexByCall.get(callId)!]);
    const laneUmap = new UMAP({
      nComponents: 2,
      nNeighbors: Math.min(15, memberIds.length - 1),
      minDist: 0.3,
      random: mulberry32(laneSeed * 101),
    });
    const lanePoints = pcaRotate(laneUmap.fit(laneVectors));
    const laneXs = lanePoints.map((point) => point[0]);
    const laneYs = lanePoints.map((point) => point[1]);
    const laneMinX = Math.min(...laneXs);
    const laneMaxX = Math.max(...laneXs);
    const laneMinY = Math.min(...laneYs);
    const laneMaxY = Math.max(...laneYs);
    const laneSpanX = Math.max(laneMaxX - laneMinX, 1e-9);
    const laneSpanY = Math.max(laneMaxY - laneMinY, 1e-9);
    memberIds.forEach((callId, index) => {
      lanePosByCall.set(callId, {
        x: Number(((lanePoints[index][0] - laneMinX) / laneSpanX).toFixed(4)),
        y: Number(((lanePoints[index][1] - laneMinY) / laneSpanY).toFixed(4)),
      });
    });
    console.log(`  ${lane}: ${memberIds.length} calls`);
  }

  const xs = projected.map((point) => point[0]);
  const ys = projected.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);

  const points: CallMapPoint[] = signals.map((record, index) => ({
    callId: record.callId,
    clusterId: clusterByCall.get(record.callId) ?? null,
    zoneId: zoneByCall.get(record.callId) ?? null,
    x: Number(((projected[index][0] - minX) / spanX).toFixed(4)),
    y: Number(((projected[index][1] - minY) / spanY).toFixed(4)),
    laneX: lanePosByCall.get(record.callId)?.x ?? null,
    laneY: lanePosByCall.get(record.callId)?.y ?? null,
  }));

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        runId,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        projection: { method: "umap", nNeighbors: 15, minDist: 0.25, seed: 42 },
        generatedAt: new Date().toISOString(),
        count: points.length,
        zones,
        points,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${points.length} points to ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
