// Progression-plan derivation — pure and deterministic. One request per
// cohort: the model's read on which lever moves that cohort's users to the
// next bucket. Requests are never persisted: the same analysis payload +
// profiles always derive the same requests with the same ids
// (cap_<clusterId>), so only grant/reject decisions live in the event log. See
// docs/superpowers/specs/2026-06-11-voice-campaign-capability-requests-design.md

import type {
  VoiceCampaignInsightCluster,
  VoiceCampaignInsightsPayload,
} from "./voice-campaign-insights-types";
import { resolveWave2Profile, type JourneyProfiles } from "./voice-campaign-journey-sim";
import type {
  CapabilityExcerpt,
  CapabilityId,
  CapabilityRequest,
} from "./voice-campaign-journey-types";

// Outcome vocabulary from the signal-extraction pipeline. "positive" = the
// call already resolved; no lever needed. Which outcomes count as movable
// depends on the lever: a link moves the talked-but-stuck, a retry moves the
// never-reached, suppression moves dead ends out of the queue.
const RESOLVED = "positive";
const NO_CONTACT = new Set(["busy", "no_answer", "failed"]);

const EVIDENCE_OUTCOMES: Record<CapabilityId, ReadonlySet<string>> = {
  send_kyc_link: new Set(["neutral", "negative"]),
  route_human: new Set(["neutral", "negative"]),
  schedule_retry: NO_CONTACT,
  suppress: new Set(["wrong_number", "negative"]),
};

/** P(resolved | routed to a human caller) — demo assumption. */
const ROUTE_HUMAN_RESOLVE = 0.45;

const MAX_EXCERPTS = 3;

function outcomeCounts(
  cluster: VoiceCampaignInsightCluster,
  payload: VoiceCampaignInsightsPayload,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const callId of cluster.callIds) {
    const outcome = payload.callDetails[callId]?.outcome;
    if (!outcome) continue;
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  return counts;
}

/** Dominant-outcome heuristic; profiles.json overrides per cohort. */
function inferCapability(counts: Map<string, number>): CapabilityId {
  let dominant = "";
  let max = 0;
  for (const [outcome, count] of counts) {
    if (count > max) {
      dominant = outcome;
      max = count;
    }
  }
  if (dominant === "wrong_number") return "suppress";
  if (NO_CONTACT.has(dominant)) return "schedule_retry";
  if (dominant === "negative") return "suppress";
  return "send_kyc_link";
}

function evidenceCallIds(
  cluster: VoiceCampaignInsightCluster,
  payload: VoiceCampaignInsightsPayload,
  capability: CapabilityId,
): string[] {
  const movable = EVIDENCE_OUTCOMES[capability];
  return cluster.callIds.filter((callId) => {
    const outcome = payload.callDetails[callId]?.outcome;
    return outcome !== undefined && outcome !== RESOLVED && movable.has(outcome);
  });
}

/** Per-call quotes beat cluster-level quotes: every excerpt is traceable. */
function representativeExcerpts(
  callIds: string[],
  payload: VoiceCampaignInsightsPayload,
): CapabilityExcerpt[] {
  const excerpts: CapabilityExcerpt[] = [];
  for (const callId of callIds) {
    const quote = payload.callDetails[callId]?.evidenceQuotes?.[0];
    if (!quote) continue;
    excerpts.push({ callId, quote });
    if (excerpts.length >= MAX_EXCERPTS) break;
  }
  return excerpts;
}

interface Movement {
  moved: number;
  label: string;
}

function projectMovement(
  capability: CapabilityId,
  evidenceCount: number,
  clusterId: string,
  profiles: JourneyProfiles,
): Movement {
  const wave2 = resolveWave2Profile(profiles, clusterId);
  switch (capability) {
    case "send_kyc_link": {
      const moved = Math.round(
        evidenceCount * wave2.pReached * wave2.pLinkSent * wave2.pClicked * wave2.pCompleted,
      );
      return { moved, label: "KYC done" };
    }
    case "schedule_retry": {
      const moved = Math.round(evidenceCount * wave2.pReached);
      return { moved, label: "back in conversation" };
    }
    case "route_human": {
      const moved = Math.round(evidenceCount * ROUTE_HUMAN_RESOLVE);
      return { moved, label: "resolved by human callers" };
    }
    case "suppress":
      return { moved: evidenceCount, label: "dead-end calls out of the queue" };
  }
}

function rationale(
  capability: CapabilityId,
  title: string,
  evidenceCount: number,
  moved: number,
): string {
  switch (capability) {
    case "send_kyc_link":
      return `${evidenceCount} calls in “${title}” are stuck mid-journey — send_kyc_link would move ~${moved} of them to KYC done.`;
    case "schedule_retry":
      return `${evidenceCount} calls in “${title}” never became a conversation — time-shifted redial would move ~${moved} of them back into one.`;
    case "route_human":
      return `${evidenceCount} calls in “${title}” need judgment the script can't give — routing them to human callers would move ~${moved} to resolved.`;
    case "suppress":
      return `${evidenceCount} calls in “${title}” are dead ends — suppressing them moves the campaign's effort to cohorts that can convert.`;
  }
}

export function deriveCapabilityRequests(
  payload: VoiceCampaignInsightsPayload,
  profiles: JourneyProfiles,
): CapabilityRequest[] {
  const { capability: config } = profiles;
  const requests: CapabilityRequest[] = [];

  for (const cluster of payload.clusters) {
    const capability =
      config.clusterCapabilities?.[cluster.id] ?? inferCapability(outcomeCounts(cluster, payload));
    const callIds = evidenceCallIds(cluster, payload, capability);
    if (callIds.length < config.minEvidenceCalls) continue;

    const movement = projectMovement(capability, callIds.length, cluster.id, profiles);

    requests.push({
      id: `cap_${cluster.id}`,
      runId: payload.runId,
      capability,
      scope: { clusterId: cluster.id },
      rationale: rationale(capability, cluster.title, callIds.length, movement.moved),
      evidence: {
        callIds,
        excerpts: representativeExcerpts(callIds, payload),
        languagePattern: cluster.customerLanguagePattern,
        unresolvedCount: callIds.length,
        projectedMoved: movement.moved,
        movedLabel: movement.label,
      },
      proposedGuardrails: {
        templateId: config.templateId,
        maxSendsPerHour: config.maxSendsPerHour,
        scopeClusterIds: [cluster.id],
        maxWaves: 1,
        auditLog: true,
      },
    });
  }

  return requests.sort((a, b) => b.evidence.projectedMoved - a.evidence.projectedMoved);
}
