import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getVoiceStorageRoot } from "@/lib/voice-storage";
import type {
  VoiceCampaignCallDetail,
  VoiceCampaignCallZone,
  VoiceCampaignInsightCluster,
  VoiceCampaignInsightLane,
  VoiceCampaignInsightsPayload,
  VoiceCampaignTopInsight,
  VoiceCampaignWorkflowChange,
} from "@/lib/voice-campaign-insights-types";

interface AnalysisSummaryFile {
  calls?: number;
  signals?: number;
  clusters?: number;
}

interface FinalAnalysisFile {
  headline?: string;
  executiveReadout?: string;
  topInsights?: VoiceCampaignTopInsight[];
  workflowChanges?: VoiceCampaignWorkflowChange[];
  openQuestions?: string[];
}

interface ClusterFile {
  lanes?: VoiceCampaignInsightLane[];
  mapCaption?: string;
  clusters?: Array<VoiceCampaignInsightCluster & { callIds?: string[] }>;
}

interface SignalRecord {
  callId?: string;
  primarySignal?: string;
  observableSummary?: string;
  customerPosition?: string;
  evidenceQuotes?: string[];
  confidence?: number;
  outcome?: string;
  durationSeconds?: number;
  turnCount?: number;
  userTurnCount?: number;
}

export function safeVoiceInsightRunId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 160 ? value : undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function scanRunsDir(root: string): Array<{ runId: string; mtimeMs: number }> {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const analysisDir = join(root, entry.name, "analysis");
      const summaryPath = join(analysisDir, "summary.json");
      const finalPath = join(analysisDir, "final-analysis.json");
      const clustersPath = join(analysisDir, "clusters.json");
      if (!existsSync(summaryPath) || !existsSync(finalPath) || !existsSync(clustersPath)) return null;
      return { runId: entry.name, mtimeMs: statSync(summaryPath).mtimeMs };
    })
    .filter((entry): entry is { runId: string; mtimeMs: number } => Boolean(entry));
}

// bundled-analysis/ is committed to git and lives outside the Railway volume
// mount point (/app/data), so it is always accessible regardless of volume overlay.
const BUNDLED_RUNS_DIR = resolve(process.cwd(), "bundled-analysis", "voice-simulation-runs");

export function latestVoiceInsightRunId(): string | undefined {
  const primaryRoot = resolve(getVoiceStorageRoot(), "voice-simulation-runs");
  const candidates = [
    ...scanRunsDir(primaryRoot),
    ...scanRunsDir(BUNDLED_RUNS_DIR),
  ];
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.runId;
}

function analysisDirForRun(runId: string): string {
  const primaryDir = resolve(getVoiceStorageRoot(), "voice-simulation-runs", runId, "analysis");
  if (existsSync(primaryDir)) return primaryDir;

  const bundledDir = resolve(BUNDLED_RUNS_DIR, runId, "analysis");
  if (existsSync(bundledDir)) return bundledDir;

  return primaryDir; // consistent missing-path error for callers
}

export function loadVoiceCampaignInsights(runId: string): VoiceCampaignInsightsPayload | undefined {
  const analysisDir = analysisDirForRun(runId);
  const summaryPath = join(analysisDir, "summary.json");
  const finalPath = join(analysisDir, "final-analysis.json");
  const clustersPath = join(analysisDir, "clusters.json");
  if (!existsSync(summaryPath) || !existsSync(finalPath) || !existsSync(clustersPath)) return undefined;

  const summary = readJson<AnalysisSummaryFile>(summaryPath);
  const final = readJson<FinalAnalysisFile>(finalPath);
  const clusterFile = readJson<ClusterFile>(clustersPath);

  const signalsPath = join(analysisDir, "signals.json");
  const callDetails: Record<string, VoiceCampaignCallDetail> = {};
  if (existsSync(signalsPath)) {
    const signalsFile = readJson<SignalRecord[] | { signals?: SignalRecord[] }>(signalsPath);
    const records = Array.isArray(signalsFile) ? signalsFile : (signalsFile.signals ?? []);
    for (const record of records) {
      if (!record.callId) continue;
      callDetails[record.callId] = {
        callId: record.callId,
        primarySignal: record.primarySignal ?? "",
        observableSummary: record.observableSummary ?? "",
        customerPosition: record.customerPosition ?? "",
        evidenceQuotes: record.evidenceQuotes ?? [],
        confidence: record.confidence ?? 0,
        outcome: record.outcome ?? "unknown",
        durationSeconds: record.durationSeconds ?? 0,
        turnCount: record.turnCount ?? 0,
        userTurnCount: record.userTurnCount ?? 0,
      };
    }
  }

  const callMapPath = join(analysisDir, "call-map.json");
  const callMap: VoiceCampaignInsightsPayload["callMap"] = {};
  const callZones: VoiceCampaignCallZone[] = [];
  if (existsSync(callMapPath)) {
    const mapFile = readJson<{
      points?: Array<{
        callId?: string;
        x?: number;
        y?: number;
        zoneId?: string | null;
        laneX?: number | null;
        laneY?: number | null;
      }>;
      zones?: Array<{ id?: string; clusterId?: string; title?: string; count?: number }>;
    }>(callMapPath);
    for (const point of mapFile.points ?? []) {
      if (point.callId && typeof point.x === "number" && typeof point.y === "number") {
        callMap[point.callId] = {
          x: point.x,
          y: point.y,
          zoneId: point.zoneId ?? null,
          laneX: typeof point.laneX === "number" ? point.laneX : null,
          laneY: typeof point.laneY === "number" ? point.laneY : null,
        };
      }
    }
    for (const zone of mapFile.zones ?? []) {
      if (zone.id && zone.clusterId && zone.title) {
        callZones.push({
          id: zone.id,
          clusterId: zone.clusterId,
          title: zone.title,
          count: zone.count ?? 0,
        });
      }
    }
  }

  const clusters = (clusterFile.clusters ?? []).map((cluster) => ({
    id: cluster.id,
    laneId: cluster.laneId ?? "",
    title: cluster.title,
    description: cluster.description,
    customerLanguagePattern: cluster.customerLanguagePattern,
    count: cluster.count,
    share: cluster.share,
    outcomeMix: cluster.outcomeMix ?? {},
    avgDurationSeconds: cluster.avgDurationSeconds,
    medianTurns: cluster.medianTurns,
    evidenceQuotes: cluster.evidenceQuotes ?? [],
    recommendedChange: cluster.recommendedChange,
    confidence: cluster.confidence,
    sampleCallIds: (cluster.callIds ?? []).slice(0, 12),
    callIds: cluster.callIds ?? [],
  }));

  return {
    runId,
    source: "analysis-run",
    calls: summary.calls ?? 0,
    signals: summary.signals ?? 0,
    clusterCount: summary.clusters ?? clusters.length,
    headline: final.headline ?? "Campaign intelligence is ready",
    executiveReadout: final.executiveReadout ?? "",
    clusters,
    lanes: (clusterFile.lanes ?? []).slice().sort((a, b) => a.triageRank - b.triageRank),
    mapCaption: clusterFile.mapCaption ?? "",
    topInsights: final.topInsights ?? [],
    workflowChanges: final.workflowChanges ?? [],
    openQuestions: final.openQuestions ?? [],
    callDetails,
    callMap,
    callZones,
  };
}
