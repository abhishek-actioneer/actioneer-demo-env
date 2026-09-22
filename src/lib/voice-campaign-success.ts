import type {
  VoiceCampaignSuccessBaselineSource,
  VoiceCampaignSuccessCallOutcome,
  VoiceCampaignSuccessDefinition,
  VoiceCampaignSuccessMetric,
  VoiceCampaignSuccessMetricType,
} from "./voice-campaign-types";

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 7;
const SUCCESS_METRIC_TYPES = new Set<VoiceCampaignSuccessMetricType>(["call_outcome", "link", "dataset_event", "sql"]);
const SUCCESS_CALL_OUTCOMES = new Set<VoiceCampaignSuccessCallOutcome>([
  "positive",
  "neutral",
  "negative",
  "busy",
  "wrong_number",
  "no_answer",
  "failed",
  "unknown",
  "callback_scheduled",
]);
const BASELINE_SOURCES = new Set<VoiceCampaignSuccessBaselineSource>([
  "historical_crm",
  "holdout",
  "previous_campaign",
  "dataset_average",
  "manual",
  "unavailable",
]);

/**
 * Returns the first link-type success metric in a definition, checking the
 * primary metric and then every secondary metric. A link metric only counts
 * when it has a destination URL. This is what enables the mid-call send_link
 * tool — it activates for ANY link metric configured in the success section,
 * not only when the link is the primary goal.
 */
export function findLinkSuccessMetric(
  definition?: VoiceCampaignSuccessDefinition,
): VoiceCampaignSuccessMetric | undefined {
  if (!definition) return undefined;
  const candidates = [definition.primary, ...(definition.secondary ?? [])];
  return candidates.find(
    (metric): metric is VoiceCampaignSuccessMetric =>
      !!metric && metric.type === "link" && !!metric.destinationUrl?.trim(),
  );
}

export interface ResolvedLinkSuccessConfig {
  dest: string;
  windowDays: number;
  template?: string;
}

/** A usable attribution window, or undefined when unset/zero/invalid. */
function positiveWindowDays(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Resolves the runtime link config (dest/window/template) for the call layer. */
export function resolveLinkSuccessConfig(
  definition?: VoiceCampaignSuccessDefinition,
): ResolvedLinkSuccessConfig | undefined {
  const metric = findLinkSuccessMetric(definition);
  if (!metric?.destinationUrl) return undefined;
  return {
    dest: metric.destinationUrl,
    // `?? ` was wrong here: windowDays is 0 on the default (call_outcome)
    // metric, and switching that metric to type "link" keeps the 0. Nullish
    // coalescing passes 0 straight through, so every token was minted with
    // expiresAt === now and every link came back "This link has expired."
    // A zero-day attribution window is meaningless — treat it as unset.
    windowDays: positiveWindowDays(metric.windowDays)
      ?? positiveWindowDays(definition?.attributionWindowDays)
      ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    template: metric.followUpTemplate,
  };
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  return text.length <= maxLength ? text : text.slice(0, maxLength).trim();
}

function cleanLongText(value: unknown, fallback = "", maxLength = 12_000): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  const cleaned = text || fallback;
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function cleanWindowDays(value: unknown, fallback: number): number {
  const days = Number(value);
  if (!Number.isFinite(days)) return fallback;
  return Math.max(0, Math.min(365, Math.round(days)));
}

function cleanRate(value: unknown): number | undefined {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return undefined;
  return Math.max(0, Math.min(1, rate));
}

export function defaultVoiceCampaignSuccessDefinition(): VoiceCampaignSuccessDefinition {
  return {
    primary: {
      id: "primary-positive-response",
      label: "Positive response",
      type: "call_outcome",
      outcome: "positive",
      windowDays: 0,
      description: "Customer showed clear interest or consented to the next step during the call.",
    },
    secondary: [
      {
        id: "secondary-callback-scheduled",
        label: "Callback scheduled",
        type: "call_outcome",
        outcome: "callback_scheduled",
        windowDays: 0,
        description: "Advisor, support, or expert follow-up was requested or scheduled.",
      },
    ],
    guardrails: ["negative_response", "wrong_number", "opt_out"],
    baseline: {
      source: "unavailable",
      label: "Baseline unavailable",
      description: "Set a historical, holdout, or manual baseline to calculate lift.",
    },
    attributionWindowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
  };
}

export function normalizeVoiceCampaignSuccessMetric(
  metric: Partial<VoiceCampaignSuccessMetric> | undefined,
  fallback: VoiceCampaignSuccessMetric,
): VoiceCampaignSuccessMetric {
  const type = SUCCESS_METRIC_TYPES.has(metric?.type as VoiceCampaignSuccessMetricType)
    ? metric?.type as VoiceCampaignSuccessMetricType
    : fallback.type;
  const outcome = SUCCESS_CALL_OUTCOMES.has(metric?.outcome as VoiceCampaignSuccessCallOutcome)
    ? metric?.outcome as VoiceCampaignSuccessCallOutcome
    : fallback.outcome;

  return {
    id: cleanText(metric?.id, fallback.id, 80),
    label: cleanText(metric?.label, fallback.label, 160),
    type,
    ...(type === "call_outcome" ? { outcome: outcome ?? "positive" } : {}),
    ...(type === "link" ? {
      destinationUrl: cleanLongText(metric?.destinationUrl, fallback.destinationUrl, 2048),
      followUpTemplate: cleanLongText(metric?.followUpTemplate, fallback.followUpTemplate, 480),
    } : {}),
    ...(type === "dataset_event" ? { eventName: cleanLongText(metric?.eventName, fallback.eventName, 180) } : {}),
    ...(type === "sql" ? { sql: cleanLongText(metric?.sql, fallback.sql, 12_000) } : {}),
    windowDays: cleanWindowDays(metric?.windowDays, fallback.windowDays ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS),
    ...(cleanLongText(metric?.description, fallback.description, 500)
      ? { description: cleanLongText(metric?.description, fallback.description, 500) }
      : {}),
  };
}

export function normalizeVoiceCampaignSuccessDefinition(
  definition?: Partial<VoiceCampaignSuccessDefinition> | null,
): VoiceCampaignSuccessDefinition {
  const fallback = defaultVoiceCampaignSuccessDefinition();
  const attributionWindowDays = cleanWindowDays(
    definition?.attributionWindowDays,
    fallback.attributionWindowDays,
  );
  const baselineSource = BASELINE_SOURCES.has(definition?.baseline?.source as VoiceCampaignSuccessBaselineSource)
    ? definition?.baseline?.source as VoiceCampaignSuccessBaselineSource
    : fallback.baseline.source;
  const baselineRate = cleanRate(definition?.baseline?.rate);

  return {
    primary: normalizeVoiceCampaignSuccessMetric(definition?.primary, fallback.primary),
    secondary: (Array.isArray(definition?.secondary) ? definition.secondary : fallback.secondary)
      .slice(0, 5)
      .map((metric, index) => normalizeVoiceCampaignSuccessMetric(metric, fallback.secondary[index] ?? fallback.secondary[0])),
    guardrails: (Array.isArray(definition?.guardrails) ? definition.guardrails : fallback.guardrails)
      .map((guardrail) => cleanText(guardrail, "", 80))
      .filter(Boolean)
      .slice(0, 12),
    baseline: {
      source: baselineSource,
      ...(baselineRate !== undefined ? { rate: baselineRate } : {}),
      label: cleanText(definition?.baseline?.label, fallback.baseline.label ?? "Baseline unavailable", 160),
      ...(cleanLongText(definition?.baseline?.description, fallback.baseline.description, 500)
        ? { description: cleanLongText(definition?.baseline?.description, fallback.baseline.description, 500) }
        : {}),
    },
    attributionWindowDays,
  };
}
