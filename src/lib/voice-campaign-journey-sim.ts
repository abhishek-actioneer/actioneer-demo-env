// Deterministic journey simulator. Dispatching generates the ENTIRE future
// event timeline synchronously (virtual timestamps, seeded PRNG) — no timers,
// no queues. The client demo clock decides what is visible when.

import { mulberry32 } from "@/lib/seeded-random";
import type { JourneyDispatch, JourneyEvent, JourneyEventType } from "./voice-campaign-journey-types";

export interface JourneyClusterProfile {
  /** P(clicked | delivered). */
  pClicked: number;
  /** P(completed | clicked). */
  pCompleted: number;
  /** P(completed) for holdout calls with no action — the organic baseline. */
  pOrganic: number;
}

/** Wave 2 — the agent re-calls holding the granted tool and sends in-session. */
export interface JourneyWave2Profile {
  /** P(retry call connects). */
  pReached: number;
  /** P(agent sends the link in-call | reached). */
  pLinkSent: number;
  /** P(clicked | delivered) — higher than wave 1: the agent co-signs the link live. */
  pClicked: number;
  /** P(completed | clicked). */
  pCompleted: number;
}

export interface JourneyCapabilityConfig {
  /** Approved WhatsApp template id baked into proposed guardrails. */
  templateId: string;
  maxSendsPerHour: number;
  /** A cohort gets a request only at/above this movable-call count. */
  minEvidenceCalls: number;
  /**
   * Hand-tuned cohort → lever overrides; unmapped cohorts infer their lever
   * from the outcome mix.
   */
  clusterCapabilities?: Record<string, "send_kyc_link" | "schedule_retry" | "route_human" | "suppress">;
}

export interface JourneyProfiles {
  horizonHours: number;
  defaults: JourneyClusterProfile;
  /** Per-cluster overrides — the planted stories live here. */
  clusters: Record<string, Partial<JourneyClusterProfile>>;
  capability: JourneyCapabilityConfig;
  wave2: {
    defaults: JourneyWave2Profile;
    clusters: Record<string, Partial<JourneyWave2Profile>>;
  };
}

export const DEFAULT_JOURNEY_PROFILES: JourneyProfiles = {
  horizonHours: 72,
  defaults: { pClicked: 0.5, pCompleted: 0.45, pOrganic: 0.07 },
  clusters: {},
  capability: { templateId: "kyc_link_v3", maxSendsPerHour: 200, minEvidenceCalls: 5 },
  wave2: {
    defaults: { pReached: 0.65, pLinkSent: 0.9, pClicked: 0.85, pCompleted: 0.7 },
    clusters: {},
  },
};

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DELIVERY_PROBABILITY = 0.97;
const CLICK_MEDIAN_HOURS = 3;
const CLICK_SIGMA = 1.0;
const COMPLETE_MEDIAN_HOURS = 14;
const COMPLETE_SIGMA = 0.9;
const ORGANIC_MEDIAN_HOURS = 36;
const ORGANIC_SIGMA = 0.7;
// Wave 2: the click usually happens while still on (or just off) the phone.
const WAVE2_CLICK_MEDIAN_HOURS = 10 / 60;
const WAVE2_CLICK_SIGMA = 1.2;
const WAVE2_COMPLETE_MEDIAN_HOURS = 6;

export function resolveClusterProfile(
  profiles: JourneyProfiles,
  clusterId: string | undefined,
): JourneyClusterProfile {
  return { ...profiles.defaults, ...(clusterId ? profiles.clusters[clusterId] : undefined) };
}

export function resolveWave2Profile(
  profiles: JourneyProfiles,
  clusterId: string | undefined,
): JourneyWave2Profile {
  return { ...profiles.wave2.defaults, ...(clusterId ? profiles.wave2.clusters[clusterId] : undefined) };
}

/** Lognormal delay with the given median — Box-Muller over the seeded PRNG. */
function lognormalMs(random: () => number, medianHours: number, sigma: number): number {
  const u1 = Math.max(random(), 1e-12);
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return medianHours * Math.exp(sigma * z) * HOUR_MS;
}

const NON_LINK_EVENT: Record<string, JourneyEventType> = {
  schedule_retry: "retry_scheduled",
  route_human: "routed_human",
  suppress: "suppressed",
};

export function generateTimeline(
  dispatch: JourneyDispatch,
  profiles: JourneyProfiles,
  clusterIdByCallId: Record<string, string>,
): JourneyEvent[] {
  const random = mulberry32(dispatch.seed);
  const t0 = Date.parse(dispatch.createdAt);
  const horizonMs = profiles.horizonHours * HOUR_MS;
  const events: JourneyEvent[] = [];
  let seq = 0;

  const push = (callId: string, type: JourneyEventType, atMs: number, channel?: "whatsapp" | "voice") => {
    seq += 1;
    events.push({
      id: `evt_${dispatch.id}_${String(seq).padStart(4, "0")}`,
      runId: dispatch.runId,
      callId,
      dispatchId: dispatch.id,
      type,
      ...(channel ? { channel } : {}),
      at: new Date(atMs).toISOString(),
    });
  };

  if (dispatch.action === "send_kyc_link" && dispatch.wave === 2) {
    // Grant-gated re-call: the agent dials again holding the tool and sends
    // the link mid-conversation. Clicks land in minutes, not hours — the live
    // co-sign is what converts hesitant/distrustful customers.
    for (const callId of dispatch.callIds) {
      const wave2 = resolveWave2Profile(profiles, clusterIdByCallId[callId]);
      const recalledAt = t0 + random() * 10 * MINUTE_MS;
      push(callId, "recalled", recalledAt, "voice");
      if (random() >= wave2.pReached) continue;
      if (random() >= wave2.pLinkSent) continue;
      const dispatchedAt = recalledAt + MINUTE_MS + random() * 3 * MINUTE_MS;
      push(callId, "dispatched", dispatchedAt, "voice");
      const deliveredAt = dispatchedAt + 30_000 + random() * MINUTE_MS;
      push(callId, "delivered", deliveredAt, "whatsapp");
      if (random() >= wave2.pClicked) continue;
      const clickedAt = deliveredAt + lognormalMs(random, WAVE2_CLICK_MEDIAN_HOURS, WAVE2_CLICK_SIGMA);
      if (clickedAt - t0 > horizonMs) continue;
      push(callId, "clicked", clickedAt, "whatsapp");
      if (random() >= wave2.pCompleted) continue;
      const completedAt = clickedAt + lognormalMs(random, WAVE2_COMPLETE_MEDIAN_HOURS, COMPLETE_SIGMA);
      if (completedAt - t0 > horizonMs) continue;
      push(callId, "completed", completedAt);
    }
    for (const callId of dispatch.holdoutCallIds) {
      const profile = resolveClusterProfile(profiles, clusterIdByCallId[callId]);
      push(callId, "held_out", t0);
      if (random() < profile.pOrganic) {
        const completedAt = t0 + lognormalMs(random, ORGANIC_MEDIAN_HOURS, ORGANIC_SIGMA);
        if (completedAt - t0 <= horizonMs) push(callId, "completed", completedAt);
      }
    }
  } else if (dispatch.action === "send_kyc_link") {
    for (const callId of dispatch.callIds) {
      const profile = resolveClusterProfile(profiles, clusterIdByCallId[callId]);
      const dispatchedAt = t0 + random() * MINUTE_MS;
      push(callId, "dispatched", dispatchedAt, "whatsapp");
      if (random() >= DELIVERY_PROBABILITY) continue;
      const deliveredAt = dispatchedAt + MINUTE_MS + random() * 4 * MINUTE_MS;
      push(callId, "delivered", deliveredAt, "whatsapp");
      if (random() >= profile.pClicked) continue;
      const clickedAt = deliveredAt + lognormalMs(random, CLICK_MEDIAN_HOURS, CLICK_SIGMA);
      if (clickedAt - t0 > horizonMs) continue;
      push(callId, "clicked", clickedAt, "whatsapp");
      if (random() >= profile.pCompleted) continue;
      const completedAt = clickedAt + lognormalMs(random, COMPLETE_MEDIAN_HOURS, COMPLETE_SIGMA);
      if (completedAt - t0 > horizonMs) continue;
      push(callId, "completed", completedAt);
    }
    for (const callId of dispatch.holdoutCallIds) {
      const profile = resolveClusterProfile(profiles, clusterIdByCallId[callId]);
      push(callId, "held_out", t0);
      if (random() < profile.pOrganic) {
        const completedAt = t0 + lognormalMs(random, ORGANIC_MEDIAN_HOURS, ORGANIC_SIGMA);
        if (completedAt - t0 <= horizonMs) push(callId, "completed", completedAt);
      }
    }
  } else {
    const type = NON_LINK_EVENT[dispatch.action];
    for (const callId of dispatch.callIds) {
      push(callId, type, t0 + random() * 30_000);
    }
  }

  // ISO timestamps sort lexicographically; id breaks ties deterministically.
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
