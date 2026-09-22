// Shared cohort view-model — the single data shape every intelligence view
// (table, stages, treemap, composition, flow) reads. Derived from the analysis
// clusters + the live journey, so selection and outcome state stay consistent
// across views.

import type {
  CapabilityId,
  CapabilityRequestStatus,
  JourneyState,
} from "@/lib/voice-campaign-journey-types";

export type CohortStage = "no_contact" | "stuck" | "dead_end" | "completed";

export const STAGE_LABEL: Record<CohortStage, string> = {
  no_contact: "No contact",
  stuck: "Stuck mid-journey",
  dead_end: "Dead end",
  completed: "Completed",
};

export const STAGE_ORDER: CohortStage[] = ["no_contact", "stuck", "dead_end", "completed"];

/** Minimal cohort source — the main component maps its ClusterDatum into this. */
export interface CohortSource {
  id: string;
  title: string;
  shortTitle: string;
  laneId: string;
  laneLabel: string;
  accent: string;
  count: number;
  share: number;
  confidence: number;
  outcomeMix: Record<string, number>;
  callIds: string[];
  topQuote?: string;
}

export interface CohortVM extends CohortSource {
  dominantOutcome: string;
  /** Proposed progression move, if the plan produced one for this cohort. */
  capability?: CapabilityId;
  projectedMoved?: number;
  movedLabel?: string;
  status?: CapabilityRequestStatus;
  /** Live rollup at the demo clock. */
  completed: number;
  inFlight: number;
  stage: CohortStage;
}

export interface CohortRequestInfo {
  clusterId: string;
  capability: CapabilityId;
  projectedMoved: number;
  movedLabel: string;
  status: CapabilityRequestStatus;
}

function dominantOutcome(mix: Record<string, number>): string {
  let best = "";
  let max = -1;
  for (const [outcome, count] of Object.entries(mix)) {
    if (count > max) {
      best = outcome;
      max = count;
    }
  }
  return best;
}

const NO_CONTACT_OUTCOMES = new Set(["busy", "no_answer", "failed"]);
const DEAD_END_OUTCOMES = new Set(["wrong_number"]);

function stageFor(capability: CapabilityId | undefined, dominant: string): CohortStage {
  if (capability === "suppress") return "dead_end";
  if (capability === "schedule_retry") return "no_contact";
  if (capability === "send_kyc_link" || capability === "route_human") return "stuck";
  // No proposed move — infer from the dominant outcome.
  if (DEAD_END_OUTCOMES.has(dominant)) return "dead_end";
  if (NO_CONTACT_OUTCOMES.has(dominant)) return "no_contact";
  if (dominant === "negative") return "dead_end";
  return "stuck";
}

const IN_FLIGHT: ReadonlySet<JourneyState> = new Set<JourneyState>([
  "recalled",
  "dispatched",
  "delivered",
  "clicked",
]);

export function buildCohortVMs(
  sources: CohortSource[],
  requests: CohortRequestInfo[],
  states: Map<string, JourneyState>,
): CohortVM[] {
  const byCluster = new Map(requests.map((request) => [request.clusterId, request]));

  return sources.map((source) => {
    const request = byCluster.get(source.id);
    const dominant = dominantOutcome(source.outcomeMix);

    let completed = 0;
    let inFlight = 0;
    for (const callId of source.callIds) {
      const state = states.get(callId);
      if (state === "completed") completed += 1;
      else if (state && IN_FLIGHT.has(state)) inFlight += 1;
    }

    return {
      ...source,
      dominantOutcome: dominant,
      capability: request?.capability,
      projectedMoved: request?.projectedMoved,
      movedLabel: request?.movedLabel,
      status: request?.status,
      completed,
      inFlight,
      stage: stageFor(request?.capability, dominant),
    };
  });
}

// ---------------------------------------------------------------------------
// Shared rendering helpers — keep every view visually consistent.
// ---------------------------------------------------------------------------

/** Monochrome ramp for outcome-mix segments; positive = brightest. */
export const OUTCOME_SHADE: Record<string, string> = {
  positive: "var(--foreground)",
  neutral: "color-mix(in oklab, var(--foreground) 55%, var(--background))",
  negative: "color-mix(in oklab, var(--foreground) 30%, var(--background))",
  busy: "color-mix(in oklab, var(--foreground) 40%, var(--background))",
  no_answer: "color-mix(in oklab, var(--foreground) 25%, var(--background))",
  failed: "color-mix(in oklab, var(--foreground) 18%, var(--background))",
  wrong_number: "color-mix(in oklab, var(--foreground) 14%, var(--background))",
};

export function outcomeShade(outcome: string): string {
  return OUTCOME_SHADE[outcome] ?? "color-mix(in oklab, var(--foreground) 35%, var(--background))";
}

/** Outcome-mix entries sorted brightest-first, for stacked bars. */
export function sortedMix(mix: Record<string, number>): Array<[string, number]> {
  const rank = (o: string) =>
    ["positive", "neutral", "busy", "no_answer", "negative", "failed", "wrong_number"].indexOf(o);
  return Object.entries(mix)
    .filter(([, count]) => count > 0)
    .sort((a, b) => rank(a[0]) - rank(b[0]));
}

export function formatPercentShare(value: number): string {
  const pct = value <= 1 ? value * 100 : value;
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${Number(pct.toFixed(1))}%`;
}
