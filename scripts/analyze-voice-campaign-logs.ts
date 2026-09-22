import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import {
  EMBEDDING_MODEL,
  embedTexts,
  kMeans,
  loadCachedEmbeddings,
  meanSilhouette,
  mulberry32,
  saveEmbeddings,
  signalEmbeddingText,
  squaredDistance,
} from "./lib/voice-clustering";

type VoiceCallOutcome =
  | "positive"
  | "neutral"
  | "negative"
  | "busy"
  | "wrong_number"
  | "no_answer"
  | "failed"
  | "unknown";

interface TranscriptTurn {
  role: "assistant" | "user";
  text: string;
  offsetSeconds?: number;
}

interface StructuredCallLog {
  runId: string;
  campaign: {
    name: string;
    segmentName: string;
    objective: string;
    language: string;
  };
  call: {
    id: string;
    status: string;
    outcome: VoiceCallOutcome;
    durationSeconds: number;
    engaged: boolean;
  };
  measurements: {
    turnCount: number;
    userTurnCount: number;
    assistantTurnCount: number;
  };
  transcript: TranscriptTurn[];
}

interface Args {
  input: string;
  outDir: string;
  model: string;
  batchSize: number;
  maxCalls?: number;
  force: boolean;
}

interface CallSignal {
  callId: string;
  primarySignal: string;
  observableSummary: string;
  customerPosition: string;
  evidenceQuotes: string[];
  confidence: number;
}

interface SignalWithMetrics extends CallSignal {
  outcome: VoiceCallOutcome;
  status: string;
  durationSeconds: number;
  turnCount: number;
  userTurnCount: number;
}

interface BatchSignalResult {
  signals: CallSignal[];
}

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

interface EnrichedCluster extends ClusterDraft {
  id: string;
  count: number;
  share: number;
  outcomeMix: Record<string, number>;
  avgDurationSeconds: number;
  medianTurns: number;
}

interface FinalInsight {
  title: string;
  readout: string;
  whyItMatters: string;
  suggestedChange: string;
  evidenceQuotes: string[];
  confidence: number;
}

interface FinalAnalysis {
  headline: string;
  executiveReadout: string;
  topInsights: FinalInsight[];
  workflowChanges: Array<{
    title: string;
    targetMoment: string;
    change: string;
    measurement: string;
  }>;
  openQuestions: string[];
}

const DEFAULT_INPUT = "data/voice-simulation-runs/kyc-450-2026-06-09/transcripts.jsonl";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Primary clustering: k-means in embedding space, k chosen by silhouette sweep
// over the same 8-14 range the retired LLM prompt used. The LLM only names
// clusters afterwards — it no longer decides membership.
const MIN_PRIMARY_K = 8;
const MAX_PRIMARY_K = 14;
const MIN_PRIMARY_CLUSTER_SIZE = 5;
const MAX_NAMING_SAMPLES = 15;

// Lanes (level-0 grouping): cluster the cluster centroids the same way —
// geometry decides which clusters share a lane, the LLM only names lanes.
const MIN_LANE_K = 2;
const MAX_LANE_K = 6;

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    if (index >= 0) return argv[index + 1];
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    return inline?.slice(name.length + 3);
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const input = resolve(get("input") ?? DEFAULT_INPUT);
  const defaultOutDir = join(dirname(input), "analysis");
  return {
    input,
    outDir: resolve(get("out-dir") ?? defaultOutDir),
    model: get("model") ?? process.env.OPENAI_MODEL ?? "gpt-5.4",
    batchSize: Number(get("batch-size") ?? 30),
    maxCalls: get("max-calls") ? Number(get("max-calls")) : undefined,
    force: has("force"),
  };
}

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
    const value = rawValue
      .replace(/^export\s+/, "")
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
    process.env[key] = value;
  }
}

function ensureEnv(): void {
  loadEnvFile(resolve(".env"));
  loadEnvFile(resolve(".env.local"));
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env.local or export it before running this script.");
  }
}

function readJsonl(input: string, maxCalls?: number): StructuredCallLog[] {
  const lines = readFileSync(input, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = lines.map((line) => JSON.parse(line) as StructuredCallLog);
  return typeof maxCalls === "number" && maxCalls > 0 ? rows.slice(0, maxCalls) : rows;
}

function transcriptForPrompt(log: StructuredCallLog): string {
  return log.transcript
    .map((turn, index) => {
      const speaker = turn.role === "assistant" ? "Agent" : "Customer";
      return `${index + 1}. ${speaker}: ${turn.text}`;
    })
    .join("\n")
    .slice(0, 6000);
}

function compactCall(log: StructuredCallLog): string {
  return [
    `CALL_ID: ${log.call.id}`,
    `STATUS: ${log.call.status}`,
    `OUTCOME: ${log.call.outcome}`,
    `DURATION_SECONDS: ${log.call.durationSeconds}`,
    `USER_TURNS: ${log.measurements.userTurnCount}`,
    "TRANSCRIPT:",
    transcriptForPrompt(log),
  ].join("\n");
}

function extractOutputText(response: unknown): string {
  const data = response as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("");
}

async function postJson<T>(
  model: string,
  messages: Array<{ role: "system" | "user"; text: string }>,
  schemaName: string,
  schema: object,
  maxOutputTokens: number,
): Promise<T> {
  const body = {
    model,
    input: messages.map((message) => ({
      role: message.role,
      content: [{ type: "input_text", text: message.text }],
    })),
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
    max_output_tokens: maxOutputTokens,
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Responses API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return JSON.parse(extractOutputText(data)) as T;
}

const signalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          callId: { type: "string" },
          primarySignal: { type: "string" },
          observableSummary: { type: "string" },
          customerPosition: { type: "string" },
          evidenceQuotes: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
        required: [
          "callId",
          "primarySignal",
          "observableSummary",
          "customerPosition",
          "evidenceQuotes",
          "confidence",
        ],
      },
    },
  },
  required: ["signals"],
};

async function extractBatchSignals(args: Args, batch: StructuredCallLog[], batchIndex: number): Promise<CallSignal[]> {
  const batchPath = join(args.outDir, "signal-batches", `batch-${String(batchIndex + 1).padStart(3, "0")}.json`);
  if (!args.force && existsSync(batchPath)) {
    return (JSON.parse(readFileSync(batchPath, "utf8")) as BatchSignalResult).signals;
  }

  const result = await postJson<BatchSignalResult>(
    args.model,
    [
      {
        role: "system",
        text: `You analyze outbound voice call transcripts.
Your job is to extract one observable primary customer signal per call.
Do not use a predefined issue taxonomy.
Do not infer hidden causes, internal system truth, or product recommendations.
Use the customer's words and behavior only. If there is no customer speech, say that directly.`,
      },
      {
        role: "user",
        text: `Campaign context:
- Segment: KYC not completed
- Objective: understand why completion did not happen and whether the customer will continue.

For each call below, return exactly one signal with:
- primarySignal: a short label derived from the transcript, not from a predefined list.
- observableSummary: what can be seen/heard in the call.
- customerPosition: what the customer appears to want or not want.
- evidenceQuotes: 1-3 short exact customer quotes where available.
- confidence: 0 to 1.

Calls:

${batch.map(compactCall).join("\n\n---\n\n")}`,
      },
    ],
    "voice_campaign_call_signals",
    signalSchema,
    Math.max(5000, batch.length * 450),
  );

  mkdirSync(dirname(batchPath), { recursive: true });
  writeFileSync(batchPath, JSON.stringify(result, null, 2));
  return result.signals;
}

function attachMetrics(logs: StructuredCallLog[], signals: CallSignal[]): SignalWithMetrics[] {
  const byId = new Map(logs.map((log) => [log.call.id, log]));
  const deduped = new Map<string, CallSignal>();
  for (const signal of signals) {
    if (byId.has(signal.callId) && !deduped.has(signal.callId)) deduped.set(signal.callId, signal);
  }
  for (const log of logs) {
    if (!deduped.has(log.call.id)) {
      deduped.set(log.call.id, {
        callId: log.call.id,
        primarySignal: log.measurements.userTurnCount > 0 ? "Customer signal requires review" : "No customer response",
        observableSummary: log.measurements.userTurnCount > 0
          ? "The model did not return a signal for this answered call."
          : "No customer-side transcript was captured.",
        customerPosition: log.measurements.userTurnCount > 0 ? "Unclear from extracted signal." : "No response.",
        evidenceQuotes: [],
        confidence: 0.2,
      });
    }
  }

  return Array.from(deduped.values()).map((signal) => {
    const log = byId.get(signal.callId);
    if (!log) throw new Error(`Missing log for signal callId=${signal.callId}`);
    return {
      ...signal,
      outcome: log.call.outcome,
      status: log.call.status,
      durationSeconds: log.call.durationSeconds,
      turnCount: log.measurements.turnCount,
      userTurnCount: log.measurements.userTurnCount,
    };
  });
}

function signalLine(signal: SignalWithMetrics): string {
  const quotes = signal.evidenceQuotes.slice(0, 2).map((quote) => `"${quote}"`).join(" | ");
  return [
    signal.callId,
    `outcome=${signal.outcome}`,
    `duration=${signal.durationSeconds}s`,
    `signal=${signal.primarySignal}`,
    `summary=${signal.observableSummary}`,
    `customer=${signal.customerPosition}`,
    quotes ? `quotes=${quotes}` : "quotes=[]",
  ].join(" ; ");
}

async function embedSignals(args: Args, signals: SignalWithMetrics[]): Promise<number[][]> {
  const path = join(args.outDir, "embeddings.json");
  const callIds = signals.map((signal) => signal.callId);
  if (!args.force) {
    const cached = loadCachedEmbeddings(path, callIds);
    if (cached) {
      console.log(`[voice-analysis] reusing cached embeddings (${cached.length})`);
      return cached;
    }
  }
  console.log(`[voice-analysis] embedding ${signals.length} signals with ${EMBEDDING_MODEL}`);
  const vectors = await embedTexts(signals.map(signalEmbeddingText), (done, total) =>
    console.log(`[voice-analysis] embedded ${done}/${total}`),
  );
  saveEmbeddings(path, callIds, vectors);
  return vectors;
}

/**
 * Representative member indices for naming: sorted by distance to the cluster
 * centroid, sampled evenly from core to edge so the namer sees breadth, not
 * just the densest signals.
 */
function representativeIndices(group: number[], vectors: number[][], max: number): number[] {
  const centroid = new Array<number>(vectors[group[0]].length).fill(0);
  for (const index of group) {
    const vector = vectors[index];
    for (let dim = 0; dim < vector.length; dim += 1) centroid[dim] += vector[dim];
  }
  for (let dim = 0; dim < centroid.length; dim += 1) centroid[dim] /= group.length;
  const sorted = [...group].sort(
    (a, b) => squaredDistance(vectors[a], centroid) - squaredDistance(vectors[b], centroid),
  );
  if (sorted.length <= max) return sorted;
  return Array.from({ length: max }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / (max - 1))]);
}

interface ClusterNaming {
  clusterIndex: number;
  title: string;
  description: string;
  customerLanguagePattern: string;
  recommendedChange: string;
  evidenceQuotes: string[];
  confidence: number;
}

const namingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          clusterIndex: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          customerLanguagePattern: { type: "string" },
          recommendedChange: { type: "string" },
          evidenceQuotes: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
        required: [
          "clusterIndex",
          "title",
          "description",
          "customerLanguagePattern",
          "recommendedChange",
          "evidenceQuotes",
          "confidence",
        ],
      },
    },
  },
  required: ["clusters"],
};

async function nameClusters(
  args: Args,
  totalCalls: number,
  summaries: Array<{ index: number; members: SignalWithMetrics[]; sampleLines: string[] }>,
): Promise<Map<number, ClusterNaming>> {
  const clusterBlock = (summary: { index: number; members: SignalWithMetrics[]; sampleLines: string[] }) => {
    const outcomeMix = summary.members.reduce<Record<string, number>>((acc, signal) => {
      acc[signal.outcome] = (acc[signal.outcome] ?? 0) + 1;
      return acc;
    }, {});
    const avgDuration = Math.round(
      summary.members.reduce((sum, signal) => sum + signal.durationSeconds, 0) / summary.members.length,
    );
    return [
      `CLUSTER ${summary.index}`,
      `calls=${summary.members.length} (${Math.round((summary.members.length / totalCalls) * 1000) / 10}%)`,
      `outcomes=${JSON.stringify(outcomeMix)}`,
      `avgDuration=${avgDuration}s`,
      "representative signals (core to edge):",
      ...summary.sampleLines,
    ].join("\n");
  };

  const result = await postJson<{ clusters: ClusterNaming[] }>(
    args.model,
    [
      {
        role: "system",
        text: `You name clusters of voice-call signals from a KYC completion campaign (Hinglish calls).
Cluster membership was computed from embeddings and is fixed — do not propose moving or merging calls.
Do not use a predefined KYC taxonomy. Derive everything from the representative signals shown.
Do not invent counts; the counts are provided.`,
      },
      {
        role: "user",
        text: `Name these ${summaries.length} clusters (${totalCalls} calls total).

For each cluster return:
- clusterIndex: echoed from the input.
- title: a plain-English operational name, 3-6 words, sentence case — name the blocker or behavior (like "Stuck at document upload" or "Asked to call back later"). Not a customer quote: no Hinglish, no quotation marks, no slashes, no trailing punctuation. Titles must distinguish clusters from each other; the customer's own words belong in evidenceQuotes, not the title.
- description: what is observably happening in these calls.
- customerLanguagePattern: how customers in this cluster talk.
- recommendedChange: a practical campaign/workflow/script/product change supported by this cluster.
- evidenceQuotes: 1-4 short exact customer quotes copied from the sample signals.
- confidence: 0 to 1 — how coherent this cluster reads from its samples.

Clusters:

${summaries.map(clusterBlock).join("\n\n---\n\n")}`,
      },
    ],
    "voice_campaign_cluster_naming",
    namingSchema,
    18_000,
  );

  return new Map(result.clusters.map((cluster) => [cluster.clusterIndex, cluster]));
}

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

async function consolidateClusters(args: Args, signals: SignalWithMetrics[]): Promise<ConsolidationResult> {
  const path = join(args.outDir, "cluster-drafts.json");
  if (!args.force && existsSync(path)) {
    // Pre-lane cache files lack `lanes` — fall through and regenerate those.
    const cached = JSON.parse(readFileSync(path, "utf8")) as ConsolidationResult;
    if (Array.isArray(cached.lanes)) return cached;
  }

  const vectors = await embedSignals(args, signals);

  let bestK = 0;
  let bestScore = -Infinity;
  let bestAssignment: number[] | null = null;
  for (let k = MIN_PRIMARY_K; k <= MAX_PRIMARY_K; k += 1) {
    const assignment = kMeans(vectors, k, mulberry32(2000 + k));
    const sizes = new Array<number>(k).fill(0);
    for (const value of assignment) sizes[value] += 1;
    if (Math.min(...sizes.filter((size) => size > 0)) < MIN_PRIMARY_CLUSTER_SIZE) {
      console.log(`[voice-analysis] k=${k} rejected (cluster below ${MIN_PRIMARY_CLUSTER_SIZE} calls)`);
      continue;
    }
    const score = meanSilhouette(vectors, assignment, k);
    console.log(`[voice-analysis] k=${k} silhouette=${score.toFixed(3)}`);
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
      bestAssignment = assignment;
    }
  }
  if (!bestAssignment) {
    // Every k produced an undersized cluster — fall back to the smallest k unfiltered.
    bestK = MIN_PRIMARY_K;
    bestAssignment = kMeans(vectors, bestK, mulberry32(2000 + bestK));
    bestScore = meanSilhouette(vectors, bestAssignment, bestK);
    console.log(`[voice-analysis] all k rejected by size gate; falling back to k=${bestK}`);
  }
  console.log(`[voice-analysis] primary clustering: k=${bestK} silhouette=${bestScore.toFixed(3)}`);

  const groups: number[][] = Array.from({ length: bestK }, () => []);
  bestAssignment.forEach((cluster, index) => groups[cluster].push(index));
  const ordered = groups.filter((group) => group.length > 0).sort((a, b) => b.length - a.length);

  const summaries = ordered.map((group, index) => ({
    index,
    members: group.map((i) => signals[i]),
    sampleLines: representativeIndices(group, vectors, MAX_NAMING_SAMPLES).map((i) => signalLine(signals[i])),
  }));

  console.log(`[voice-analysis] naming ${summaries.length} clusters with ${args.model}`);
  const namings = await nameClusters(args, signals.length, summaries);

  const drafts: ClusterDraft[] = ordered.map((group, index) => {
    const naming = namings.get(index);
    return {
      title: naming?.title ?? `Cluster ${index + 1}`,
      description: naming?.description ?? "",
      customerLanguagePattern: naming?.customerLanguagePattern ?? "",
      callIds: group.map((i) => signals[i].callId),
      evidenceQuotes: naming?.evidenceQuotes ?? [],
      recommendedChange: naming?.recommendedChange ?? "",
      confidence: naming?.confidence ?? 0.5,
      laneId: "",
    };
  });

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
  if (!Number.isFinite(laneScore)) {
    laneScore = 0;
    console.log("[voice-analysis] lane sweep accepted no k; defaulting to a single lane");
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
  const knownLaneIndexes = new Set(laneSummaries.map((summary) => summary.laneIndex));
  const unknownLaneIndexes = [
    ...laneNaming.lanes.map((lane) => lane.laneIndex),
    ...laneNaming.triageOrder,
  ].filter((laneIndex) => !knownLaneIndexes.has(laneIndex));
  if (unknownLaneIndexes.length > 0) {
    throw new Error(
      `Lane naming returned unknown laneIndex(es): ${unknownLaneIndexes.join(", ")} — expected 0..${laneSummaries.length - 1}. Re-run to retry.`,
    );
  }
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
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function enrichClusters(signals: SignalWithMetrics[], drafts: ClusterDraft[]): EnrichedCluster[] {
  const signalById = new Map(signals.map((signal) => [signal.callId, signal]));
  const assigned = new Set<string>();
  const clusters: EnrichedCluster[] = [];

  drafts.forEach((draft, index) => {
    const validCallIds = Array.from(new Set(draft.callIds))
      .filter((callId) => signalById.has(callId) && !assigned.has(callId));
    validCallIds.forEach((callId) => assigned.add(callId));
    if (validCallIds.length === 0) return;

    const members = validCallIds.map((callId) => signalById.get(callId)!);
    const outcomeMix = members.reduce<Record<string, number>>((acc, signal) => {
      acc[signal.outcome] = (acc[signal.outcome] ?? 0) + 1;
      return acc;
    }, {});
    clusters.push({
      ...draft,
      id: `cluster_${String(index + 1).padStart(2, "0")}`,
      callIds: validCallIds,
      count: members.length,
      share: Number((members.length / signals.length).toFixed(4)),
      outcomeMix,
      avgDurationSeconds: Math.round(members.reduce((sum, signal) => sum + signal.durationSeconds, 0) / members.length),
      medianTurns: median(members.map((signal) => signal.turnCount)),
    });
  });

  const unassigned = signals.filter((signal) => !assigned.has(signal.callId));
  if (unassigned.length > 0) {
    const outcomeMix = unassigned.reduce<Record<string, number>>((acc, signal) => {
      acc[signal.outcome] = (acc[signal.outcome] ?? 0) + 1;
      return acc;
    }, {});
    clusters.push({
      id: "cluster_other",
      title: "Other lower-frequency signals",
      description: "Signals not assigned to a higher-confidence primary cluster.",
      customerLanguagePattern: "Mixed low-frequency language.",
      callIds: unassigned.map((signal) => signal.callId),
      evidenceQuotes: unassigned.flatMap((signal) => signal.evidenceQuotes).slice(0, 5),
      recommendedChange: "Review after the primary clusters; do not overfit the campaign to this mixed residue yet.",
      confidence: 0.4,
      laneId: "",
      count: unassigned.length,
      share: Number((unassigned.length / signals.length).toFixed(4)),
      outcomeMix,
      avgDurationSeconds: Math.round(unassigned.reduce((sum, signal) => sum + signal.durationSeconds, 0) / unassigned.length),
      medianTurns: median(unassigned.map((signal) => signal.turnCount)),
    });
  }

  return clusters.sort((a, b) => b.count - a.count);
}

function clusterLine(cluster: EnrichedCluster): string {
  return [
    `${cluster.id}: ${cluster.title}`,
    `calls=${cluster.count}`,
    `share=${Math.round(cluster.share * 1000) / 10}%`,
    `outcomes=${JSON.stringify(cluster.outcomeMix)}`,
    `avgDuration=${cluster.avgDurationSeconds}s`,
    `pattern=${cluster.customerLanguagePattern}`,
    `evidence=${cluster.evidenceQuotes.slice(0, 4).map((quote) => `"${quote}"`).join(" | ")}`,
    `draftChange=${cluster.recommendedChange}`,
  ].join("\n");
}

const finalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    executiveReadout: { type: "string" },
    topInsights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          readout: { type: "string" },
          whyItMatters: { type: "string" },
          suggestedChange: { type: "string" },
          evidenceQuotes: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
        required: ["title", "readout", "whyItMatters", "suggestedChange", "evidenceQuotes", "confidence"],
      },
    },
    workflowChanges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          targetMoment: { type: "string" },
          change: { type: "string" },
          measurement: { type: "string" },
        },
        required: ["title", "targetMoment", "change", "measurement"],
      },
    },
    openQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "executiveReadout", "topInsights", "workflowChanges", "openQuestions"],
};

async function synthesizeFinal(
  args: Args,
  logs: StructuredCallLog[],
  clusters: EnrichedCluster[],
  lanes: Array<{ id: string; label: string; count: number; claim: string; action: string; clusterIds: string[] }>,
): Promise<FinalAnalysis> {
  const path = join(args.outDir, "final-analysis.json");
  if (!args.force && existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as FinalAnalysis;
  }

  const outcomeMix = logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.call.outcome] = (acc[log.call.outcome] ?? 0) + 1;
    return acc;
  }, {});

  const result = await postJson<FinalAnalysis>(
    args.model,
    [
      {
        role: "system",
        text: `You create executive post-campaign intelligence from derived call clusters.
Be concrete and evidence-led. Do not claim causal lift or exact future improvement unless it is directly measured.
Write for a demo of during/post-campaign intelligence: concise, actionable, and inspectable.`,
      },
      {
        role: "user",
        text: `Campaign:
- Segment: ${logs[0]?.campaign.segmentName ?? "Unknown"}
- Objective: ${logs[0]?.campaign.objective ?? "Unknown"}
- Calls analyzed: ${logs.length}
- Outcome mix: ${JSON.stringify(outcomeMix)}

Lanes (triage groupings of the clusters, in recommended intervention order):
${lanes.map((lane) => `${lane.id}: ${lane.label} — ${lane.count} calls; claim=${lane.claim}; action=${lane.action}; clusters=[${lane.clusterIds.join(", ")}]`).join("\n")}

Derived clusters:

${clusters.map(clusterLine).join("\n\n---\n\n")}

Return a concise intelligence readout:
- headline: one short, concrete claim grounded in the counts, max 12 words. Lead with the numbers and state what customers observably did and what blocked them (like "229 of 450 customers tried to finish KYC but got blocked"). Every word must be unambiguous: no abstractions ("friction", "journey", "leverage") and no impression words ("willing", "engaged", "positive") — say the behavior, not how it seemed.
- executiveReadout
- topInsights: 5-8 insights with readouts grounded in the cluster counts
- workflowChanges: 4-6 concrete changes to test next
- openQuestions: what still needs real campaign data or instrumentation`,
      },
    ],
    "voice_campaign_final_analysis",
    finalSchema,
    9000,
  );

  writeFileSync(path, JSON.stringify(result, null, 2));
  return result;
}

function writeMarkdown(outDir: string, logs: StructuredCallLog[], clusters: EnrichedCluster[], final: FinalAnalysis): void {
  const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;
  const lines = [
    `# ${final.headline}`,
    "",
    final.executiveReadout,
    "",
    "## Run",
    "",
    `- Calls analyzed: ${logs.length}`,
    `- Source: ${basename(dirname(outDir)) || "voice simulation run"}`,
    "",
    "## Top Clusters",
    "",
    ...clusters.slice(0, 12).flatMap((cluster) => [
      `### ${cluster.title}`,
      "",
      `- Calls: ${cluster.count} (${pct(cluster.share)})`,
      `- Outcomes: ${JSON.stringify(cluster.outcomeMix)}`,
      `- Avg duration: ${cluster.avgDurationSeconds}s`,
      `- Pattern: ${cluster.customerLanguagePattern}`,
      `- Suggested change: ${cluster.recommendedChange}`,
      ...(cluster.evidenceQuotes.length > 0
        ? [`- Evidence: ${cluster.evidenceQuotes.slice(0, 3).map((quote) => `"${quote}"`).join(" / ")}`]
        : []),
      "",
    ]),
    "## Intelligence Readout",
    "",
    ...final.topInsights.flatMap((insight) => [
      `### ${insight.title}`,
      "",
      `- Readout: ${insight.readout}`,
      `- Why it matters: ${insight.whyItMatters}`,
      `- Suggested change: ${insight.suggestedChange}`,
      ...(insight.evidenceQuotes.length > 0
        ? [`- Evidence: ${insight.evidenceQuotes.slice(0, 3).map((quote) => `"${quote}"`).join(" / ")}`]
        : []),
      "",
    ]),
    "## Workflow Changes To Test",
    "",
    ...final.workflowChanges.flatMap((change) => [
      `### ${change.title}`,
      "",
      `- Moment: ${change.targetMoment}`,
      `- Change: ${change.change}`,
      `- Measure: ${change.measurement}`,
      "",
    ]),
    "## Open Questions",
    "",
    ...final.openQuestions.map((question) => `- ${question}`),
    "",
  ];

  writeFileSync(join(outDir, "analysis-report.md"), lines.join("\n"));
}

async function main(): Promise<void> {
  ensureEnv();
  const args = parseArgs();
  if (!existsSync(args.input)) throw new Error(`Input file not found: ${args.input}`);
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) throw new Error("--batch-size must be positive");
  mkdirSync(args.outDir, { recursive: true });

  const logs = readJsonl(args.input, args.maxCalls);
  console.log(`[voice-analysis] input=${args.input}`);
  console.log(`[voice-analysis] outDir=${args.outDir}`);
  console.log(`[voice-analysis] model=${args.model}`);
  console.log(`[voice-analysis] calls=${logs.length} batchSize=${args.batchSize}`);
  console.log("[voice-analysis] no predefined KYC issue taxonomy is used");
  console.log("[voice-analysis] clustering=embedding k-means (silhouette-selected k); LLM names clusters only");

  const allSignals: CallSignal[] = [];
  for (let start = 0; start < logs.length; start += args.batchSize) {
    const batch = logs.slice(start, start + args.batchSize);
    const batchIndex = Math.floor(start / args.batchSize);
    console.log(`[voice-analysis] extracting signals ${start + 1}-${start + batch.length}`);
    const signals = await extractBatchSignals(args, batch, batchIndex);
    allSignals.push(...signals);
    writeFileSync(join(args.outDir, "signals-raw.json"), JSON.stringify({ signals: allSignals }, null, 2));
  }

  const signals = attachMetrics(logs, allSignals);
  writeFileSync(join(args.outDir, "signals.json"), JSON.stringify({ signals }, null, 2));
  console.log(`[voice-analysis] signals=${signals.length}`);

  console.log("[voice-analysis] consolidating clusters");
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

  console.log("[voice-analysis] synthesizing final analysis");
  const final = await synthesizeFinal(args, logs, clusters, lanes);
  writeMarkdown(args.outDir, logs, clusters, final);
  writeFileSync(join(args.outDir, "summary.json"), JSON.stringify({
    input: args.input,
    model: args.model,
    calls: logs.length,
    signals: signals.length,
    clusters: clusters.length,
    topClusters: clusters.slice(0, 8).map((cluster) => ({
      id: cluster.id,
      title: cluster.title,
      count: cluster.count,
      share: cluster.share,
      outcomeMix: cluster.outcomeMix,
    })),
    files: {
      signals: "signals.json",
      clusters: "clusters.json",
      finalAnalysis: "final-analysis.json",
      report: "analysis-report.md",
    },
  }, null, 2));
  console.log("[voice-analysis] complete");
}

main().catch((error) => {
  console.error("[voice-analysis] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
