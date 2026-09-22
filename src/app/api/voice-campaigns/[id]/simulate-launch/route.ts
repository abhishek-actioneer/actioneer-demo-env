import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { listSegments } from "@/lib/server/segment-repo";
import { getCampaign, updateCampaign } from "@/lib/voice-campaign-store";
import type {
  VoiceCallOutcome,
  VoiceCampaignExperimentSplit,
  VoiceCampaignSimulation,
  VoiceCampaignSimulationMetrics,
} from "@/lib/voice-campaign-types";
import { normalizeVoiceCampaignExperimentSplit } from "@/lib/voice-campaign-experiment";

const ESTIMATED_AGENT_TALK_SHARE = 0.45;
const GEMINI_LIVE_INPUT_AUDIO_PER_MINUTE_USD = 0.005;
const GEMINI_LIVE_OUTPUT_AUDIO_PER_MINUTE_USD = 0.018;
const DEFAULT_PLIVO_CONCURRENT_CALLS = 50;
const DEFAULT_PLIVO_OUTBOUND_CPS = 2;
const DEFAULT_GEMINI_LIVE_CONCURRENT_SESSIONS = 1000;
const CAPACITY_UTILIZATION = 0.82;
const MIN_SIMULATION_DURATION_HOURS = 0.08;

const SCRIPT_ADHERENCE_CHECKS = [
  {
    key: "permission",
    label: "Permission gate",
    detail: "Introduced the caller and asked before continuing.",
    baselinePassRate: 0.96,
  },
  {
    key: "discovery",
    label: "Discovery question",
    detail: "Asked the campaign's main diagnostic question.",
    baselinePassRate: 0.91,
  },
  {
    key: "offer_discipline",
    label: "Offer discipline",
    detail: "Did not push callback or offer before customer context.",
    baselinePassRate: 0.88,
  },
  {
    key: "concern_handling",
    label: "Concern handling",
    detail: "Handled busy, refusal, opt-out, or blocker before proceeding.",
    baselinePassRate: 0.84,
  },
  {
    key: "guardrails",
    label: "Guardrails",
    detail: "No unsafe ask, unsupported claim, or pressure language.",
    baselinePassRate: 0.99,
  },
  {
    key: "turn_discipline",
    label: "Turn discipline",
    detail: "Kept turns focused and avoided stacked questions.",
    baselinePassRate: 0.87,
  },
] as const;

const SimulateLaunchSchema = z.object({
  audienceSize: z.number().int().positive().max(1_000_000).optional(),
});

function datasetIdFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampRate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildMetrics(audienceSize: number, seedKey: string): VoiceCampaignSimulationMetrics {
  const random = mulberry32(hashString(seedKey));
  const attempted = Math.max(1, audienceSize);
  const ringRate = clampRate(0.91 + (random() - 0.5) * 0.04);
  const pickupRate = clampRate(0.33 + (random() - 0.5) * 0.08);
  const engagedRate = clampRate(0.24 + (random() - 0.5) * 0.06);
  const positiveRate = clampRate(0.10 + (random() - 0.5) * 0.04);
  const negativeRate = clampRate(0.035 + (random() - 0.5) * 0.018);
  const busyRate = clampRate(0.07 + (random() - 0.5) * 0.035);
  const wrongRate = clampRate(0.02 + (random() - 0.5) * 0.012);
  const failedRate = clampRate(0.018 + (random() - 0.5) * 0.012);

  const rang = Math.min(attempted, Math.round(attempted * ringRate));
  const pickedUp = Math.min(rang, Math.round(attempted * pickupRate));
  const engaged20s = Math.min(pickedUp, Math.round(attempted * engagedRate));
  const positive = Math.min(engaged20s, Math.round(attempted * positiveRate));
  const negative = Math.min(Math.max(pickedUp - positive, 0), Math.round(attempted * negativeRate));
  const busy = Math.min(Math.max(pickedUp - positive - negative, 0), Math.round(attempted * busyRate));
  const wrongNumber = Math.min(Math.max(attempted - pickedUp, 0), Math.round(attempted * wrongRate));
  const failed = Math.min(Math.max(attempted - pickedUp - wrongNumber, 0), Math.round(attempted * failedRate));
  const neutral = Math.max(pickedUp - positive - negative - busy, 0);
  const noAnswer = Math.max(attempted - pickedUp - wrongNumber - failed, 0);
  const assigned = positive + neutral + negative + busy + wrongNumber + noAnswer + failed;

  return {
    attempted,
    rang,
    pickedUp,
    aiConnected: pickedUp,
    engaged20s,
    positive,
    outcomes: {
      positive,
      callback_scheduled: 0,
      neutral,
      negative,
      busy,
      wrong_number: wrongNumber,
      no_answer: noAnswer,
      failed,
      unknown: Math.max(attempted - assigned, 0),
    },
  };
}

function experimentTestAudienceSize(audienceSize: number, splitInput: Partial<VoiceCampaignExperimentSplit> | null | undefined): number {
  const split = normalizeVoiceCampaignExperimentSplit(splitInput);
  if (!split.enabled) return audienceSize;
  return Math.max(1, Math.round((audienceSize * split.testPercent) / 100));
}

function estimateSpend(metrics: VoiceCampaignSimulationMetrics): number {
  const noAnswerMinutes = metrics.outcomes.no_answer * 0.16;
  const shortOutcomeMinutes = (metrics.outcomes.failed + metrics.outcomes.wrong_number) * 0.22;
  const connectedMinutes = metrics.pickedUp * 2.25;
  const inputMinutes = noAnswerMinutes + shortOutcomeMinutes + connectedMinutes;
  const outputMinutes = inputMinutes * ESTIMATED_AGENT_TALK_SHARE;
  return Number(((inputMinutes * GEMINI_LIVE_INPUT_AUDIO_PER_MINUTE_USD) +
    (outputMinutes * GEMINI_LIVE_OUTPUT_AUDIO_PER_MINUTE_USD)).toFixed(2));
}

function averageActiveCallSeconds(metrics: VoiceCampaignSimulationMetrics): number {
  const noAnswerSeconds = metrics.outcomes.no_answer * 10;
  const shortOutcomeSeconds = (metrics.outcomes.failed + metrics.outcomes.wrong_number) * 13;
  const connectedSeconds = metrics.pickedUp * 135;
  const totalSeconds = noAnswerSeconds + shortOutcomeSeconds + connectedSeconds;
  return Math.max(18, totalSeconds / Math.max(metrics.attempted, 1));
}

function buildCapacity(metrics: VoiceCampaignSimulationMetrics): VoiceCampaignSimulation["capacity"] {
  const plivoConcurrentCalls = envNumber("PLIVO_CONCURRENT_CALL_LIMIT", DEFAULT_PLIVO_CONCURRENT_CALLS);
  const plivoOutboundCps = envNumber("PLIVO_OUTBOUND_CPS", DEFAULT_PLIVO_OUTBOUND_CPS);
  const geminiConcurrentSessions = envNumber("GEMINI_LIVE_CONCURRENT_SESSION_LIMIT", DEFAULT_GEMINI_LIVE_CONCURRENT_SESSIONS);
  const averageCallSeconds = averageActiveCallSeconds(metrics);
  const plivoConcurrencyCallsPerHour = (plivoConcurrentCalls * CAPACITY_UTILIZATION * 3600) / averageCallSeconds;
  const plivoCpsCallsPerHour = plivoOutboundCps * CAPACITY_UTILIZATION * 3600;
  const geminiCallsPerHour = (geminiConcurrentSessions * CAPACITY_UTILIZATION * 3600) / averageCallSeconds;
  const plivoCallsPerHour = Math.min(plivoConcurrencyCallsPerHour, plivoCpsCallsPerHour);
  const effectiveCallsPerHour = Math.max(1, Math.floor(Math.min(plivoCallsPerHour, geminiCallsPerHour)));

  return {
    plivoConcurrentCalls,
    plivoOutboundCps,
    geminiConcurrentSessions,
    limitingProvider: plivoCallsPerHour <= geminiCallsPerHour ? "plivo" : "gemini",
    utilization: CAPACITY_UTILIZATION,
    averageCallSeconds: Math.round(averageCallSeconds),
    effectiveCallsPerHour,
  };
}

function buildTimeline(
  metrics: VoiceCampaignSimulationMetrics,
  modelSpendUsd: number,
  durationHours: number,
): VoiceCampaignSimulation["timeline"] {
  const points = Math.max(6, Math.min(12, Math.ceil(durationHours)));
  return Array.from({ length: points }, (_, index) => {
    const ratio = (index + 1) / points;
    const elapsedHours = durationHours * ratio;
    return {
      label: index === points - 1 ? "Done" : `${elapsedHours < 1 ? Math.round(elapsedHours * 60) + "m" : Math.round(elapsedHours) + "h"}`,
      attempted: Math.round(metrics.attempted * ratio),
      connected: Math.round(metrics.pickedUp * ratio),
      engaged: Math.round(metrics.engaged20s * ratio),
      positive: Math.round(metrics.positive * ratio),
      cost: Number((modelSpendUsd * ratio).toFixed(2)),
    };
  });
}

function buildRetention(metrics: VoiceCampaignSimulationMetrics): VoiceCampaignSimulation["retention"] {
  const pickedUp = Math.max(0, metrics.pickedUp);
  const conversational = metrics.outcomes.positive + metrics.outcomes.neutral + metrics.outcomes.negative;
  const retained45 = Math.min(
    metrics.engaged20s,
    Math.round(conversational + metrics.outcomes.busy * 0.35),
  );
  const retained90 = Math.min(
    retained45,
    Math.round(metrics.outcomes.positive + metrics.outcomes.neutral * 0.48 + metrics.outcomes.negative * 0.22),
  );
  const retained120 = Math.min(
    retained90,
    Math.round(metrics.outcomes.positive * 0.78 + metrics.outcomes.neutral * 0.18),
  );
  const retained180 = Math.min(retained120, Math.round(metrics.outcomes.positive * 0.42));
  const rows = [
    { label: "Pickup", elapsedSeconds: 0, retained: pickedUp },
    { label: "20s", elapsedSeconds: 20, retained: metrics.engaged20s },
    { label: "45s", elapsedSeconds: 45, retained: retained45 },
    { label: "90s", elapsedSeconds: 90, retained: retained90 },
    { label: "2m", elapsedSeconds: 120, retained: retained120 },
    { label: "3m", elapsedSeconds: 180, retained: retained180 },
  ];

  return rows.map((row) => ({
    ...row,
    percent: pickedUp > 0 ? Math.round((row.retained / pickedUp) * 100) : 0,
  }));
}

function buildLatency(
  metrics: VoiceCampaignSimulationMetrics,
  capacity: VoiceCampaignSimulation["capacity"],
  durationHours: number,
  seedKey: string,
): VoiceCampaignSimulation["latency"] {
  if (metrics.pickedUp <= 0) return [];

  const random = mulberry32(hashString(`${seedKey}:latency`));
  const points = Math.max(6, Math.min(12, Math.ceil(durationHours)));
  const utilizationPressure = capacity.limitingProvider === "gemini" ? 170 : 80;
  const connectedBase = Math.max(metrics.pickedUp, 1);

  return Array.from({ length: points }, (_, index) => {
    const ratio = (index + 1) / points;
    const wave = Math.sin(ratio * Math.PI * 1.35) * 85;
    const jitter = (random() - 0.5) * 140;
    const p50Ms = Math.round(Math.max(520, 860 + utilizationPressure + wave + jitter));
    const p90Ms = Math.round(p50Ms + 520 + random() * 420 + utilizationPressure * 0.55);
    const elapsedHours = durationHours * ratio;

    return {
      label: index === points - 1 ? "Done" : `${elapsedHours < 1 ? Math.round(elapsedHours * 60) + "m" : Math.round(elapsedHours) + "h"}`,
      p50Ms,
      p90Ms,
      sampleSize: Math.max(1, Math.round(connectedBase * ratio)),
    };
  });
}

function buildScriptAdherence(
  metrics: VoiceCampaignSimulationMetrics,
  seedKey: string,
): VoiceCampaignSimulation["scriptAdherence"] {
  const random = mulberry32(hashString(`${seedKey}:script-adherence`));
  const evaluatedCalls = Math.max(0, metrics.pickedUp);
  const pressure = metrics.pickedUp > 0
    ? (metrics.outcomes.negative + metrics.outcomes.busy) / metrics.pickedUp
    : 0;
  const checkRows = SCRIPT_ADHERENCE_CHECKS.map((check, index) => {
    const adjustedRate = clampRate(check.baselinePassRate - pressure * (index === 3 ? 0.22 : 0.08) + (random() - 0.5) * 0.035);
    const passed = Math.min(evaluatedCalls, Math.round(evaluatedCalls * adjustedRate));

    return {
      key: check.key,
      label: check.label,
      detail: check.detail,
      passed,
      total: evaluatedCalls,
      percent: evaluatedCalls > 0 ? Math.round((passed / evaluatedCalls) * 100) : 0,
    };
  });
  const averageScore = checkRows.length > 0
    ? Math.round(checkRows.reduce((sum, row) => sum + row.percent, 0) / checkRows.length)
    : 0;
  const strictPassCalls = evaluatedCalls > 0
    ? Math.round(evaluatedCalls * clampRate((averageScore - 9) / 100))
    : 0;
  const guardrailIssues = evaluatedCalls - (checkRows.find((row) => row.key === "guardrails")?.passed ?? evaluatedCalls);
  const reviewOutcomes: VoiceCallOutcome[] = ["neutral", "busy", "negative", "positive"];
  const failedSets: Array<Array<typeof SCRIPT_ADHERENCE_CHECKS[number]["key"]>> = [
    ["concern_handling", "turn_discipline"],
    ["offer_discipline"],
    ["discovery", "turn_discipline"],
    ["permission"],
  ];
  const reviewRows = failedSets
    .slice(0, Math.min(4, evaluatedCalls))
    .map((failedKeys, index) => ({
      callId: `sim-review-${index + 1}`,
      label: `Sim call ${String(index + 1).padStart(3, "0")}`,
      outcome: reviewOutcomes[index] ?? "neutral",
      score: Math.max(50, 100 - failedKeys.length * 15 - Math.round(random() * 8)),
      failedKeys,
    }));

  return {
    evaluatedCalls,
    averageScore,
    strictPassCalls,
    guardrailIssues,
    checkRows,
    reviewRows,
  };
}

function buildRecentActivity(
  metrics: VoiceCampaignSimulationMetrics,
  seedKey: string,
  generatedAt: string,
): VoiceCampaignSimulation["recentActivity"] {
  const random = mulberry32(hashString(`${seedKey}:activity`));
  const entries: Array<{ outcome: VoiceCallOutcome; summary: string; minDuration: number; maxDuration: number }> = [
    { outcome: "positive", summary: "Customer showed interest and should move to follow-up.", minDuration: 76, maxDuration: 156 },
    { outcome: "neutral", summary: "Customer listened but did not commit to a next step.", minDuration: 42, maxDuration: 104 },
    { outcome: "busy", summary: "Customer asked to be contacted later.", minDuration: 18, maxDuration: 44 },
    { outcome: "negative", summary: "Customer declined the offer and should not be pressured.", minDuration: 28, maxDuration: 72 },
    { outcome: "no_answer", summary: "Call was not answered.", minDuration: 6, maxDuration: 14 },
    { outcome: "wrong_number", summary: "Number hygiene issue detected.", minDuration: 10, maxDuration: 22 },
  ];
  const weighted = entries.flatMap((entry) => {
    const count = Math.max(1, Math.round((metrics.outcomes[entry.outcome] / Math.max(metrics.attempted, 1)) * 20));
    return Array.from({ length: count }, () => entry);
  });

  return Array.from({ length: 6 }, (_, index) => {
    const entry = weighted[Math.floor(random() * weighted.length)] ?? entries[0];
    const durationSeconds = Math.round(entry.minDuration + random() * (entry.maxDuration - entry.minDuration));
    const at = new Date(new Date(generatedAt).getTime() - index * 11 * 60_000).toISOString();
    return {
      id: `sim-${seedKey}-${index}`,
      label: `Recipient ${String(index + 1).padStart(3, "0")}`,
      outcome: entry.outcome,
      summary: entry.summary,
      durationSeconds,
      at,
    };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const requestedDatasetId = datasetIdFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const parsed = SimulateLaunchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  const datasetId = campaign.datasetId || requestedDatasetId;

  const segment = listSegments(userId, datasetId).find((item) => item.id === campaign.segmentId);
  const audienceSize = parsed.data.audienceSize ?? segment?.userCount ?? campaign.phoneNumbers.length;
  if (audienceSize <= 0) {
    return Response.json({ error: "Selected audience is empty" }, { status: 400 });
  }

  const generatedAt = new Date().toISOString();
  const testAudienceSize = experimentTestAudienceSize(audienceSize, campaign.experimentSplit);
  const seedKey = `${campaign.id}:${campaign.segmentId}:${campaign.purposeId}:${audienceSize}:${testAudienceSize}`;
  const metrics = buildMetrics(testAudienceSize, seedKey);
  const modelSpendUsd = estimateSpend(metrics);
  const capacity = buildCapacity(metrics);
  const durationHours = Math.max(
    MIN_SIMULATION_DURATION_HOURS,
    Number((audienceSize / capacity.effectiveCallsPerHour).toFixed(2)),
  );
  const simulation: VoiceCampaignSimulation = {
    generatedAt,
    source: "audience-no-phone-export",
    audienceSize,
    modelSpendUsd,
    durationHours,
    capacity,
    metrics,
    timeline: buildTimeline(metrics, modelSpendUsd, durationHours),
    retention: buildRetention(metrics),
    latency: buildLatency(metrics, capacity, durationHours, seedKey),
    scriptAdherence: buildScriptAdherence(metrics, seedKey),
    recentActivity: buildRecentActivity(metrics, seedKey, generatedAt),
  };

  const updated = updateCampaign(id, {
    status: "in_progress",
    launchedAt: generatedAt,
    audienceLaunchedAt: generatedAt,
    simulation,
  }, { userId, datasetId });

  return Response.json(
    { ok: true, campaign: updated ?? getCampaign(id, { userId }) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
