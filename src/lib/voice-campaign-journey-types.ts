// Journey events for the voice-campaign dispatch → outcome loop.
// Events are the source of truth; a call's journey state is a pure reduction
// over its events up to the demo clock. See
// docs/superpowers/specs/2026-06-10-voice-campaign-journey-events-design.md and
// docs/superpowers/specs/2026-06-11-voice-campaign-capability-requests-design.md

export type JourneyAction =
  | "send_kyc_link" // → dispatched → delivered → clicked → completed
  | "schedule_retry" // → retry_scheduled
  | "route_human" // → routed_human
  | "suppress"; // → suppressed

export type JourneyEventType =
  | "dispatched"
  | "delivered"
  | "clicked"
  | "completed"
  | "recalled" // wave 2: the agent calls again, now holding the granted tool
  | "retry_scheduled"
  | "routed_human"
  | "suppressed"
  | "held_out";

export interface JourneyEvent {
  id: string; // evt_<dispatchId>_<seq>
  runId: string;
  callId: string;
  dispatchId: string;
  type: JourneyEventType;
  /** "voice" = link sent during a live call (the agent co-signs it). */
  channel?: "whatsapp" | "sms" | "voice";
  /** Virtual ISO timestamp — the client demo clock decides visibility. */
  at: string;
}

export type JourneyDispatchScope = { clusterId: string } | { laneId: string };

export interface JourneyDispatch {
  id: string; // dsp_<seq>, sequential per run
  runId: string;
  scope: JourneyDispatchScope;
  action: JourneyAction;
  /** 1 = post-call remediation; 2 = grant-gated re-call with the tool in-session. */
  wave: 1 | 2;
  /** The granted capability request this dispatch executes. Required iff wave 2. */
  grantRequestId?: string;
  /** Treated calls. */
  callIds: string[];
  /** Control group — no action, organic completion only. Empty for non-link actions. */
  holdoutCallIds: string[];
  holdoutFraction: number;
  /** mulberry32 seed used for the holdout split and the simulated timeline. */
  seed: number;
  createdAt: string;
}

/** Derived journey state, by precedence (highest wins). */
export type JourneyState =
  | "completed"
  | "clicked"
  | "delivered"
  | "dispatched"
  | "recalled"
  | "retry_scheduled"
  | "routed_human"
  | "suppressed"
  | "held_out"
  | "analyzed";

const STATE_PRECEDENCE: Record<JourneyState, number> = {
  completed: 9,
  clicked: 8,
  delivered: 7,
  dispatched: 6,
  recalled: 5,
  retry_scheduled: 4,
  routed_human: 4,
  suppressed: 4,
  held_out: 4,
  analyzed: 0,
};

/** Reduce events (already filtered to `at <= demoClock`) into per-call states. */
export function reduceJourneyStates(events: JourneyLogEvent[]): Map<string, JourneyState> {
  const states = new Map<string, JourneyState>();
  for (const event of events) {
    if (!isCallEvent(event)) continue;
    const next = event.type as JourneyState;
    const current = states.get(event.callId);
    if (!current || STATE_PRECEDENCE[next] > STATE_PRECEDENCE[current]) {
      states.set(event.callId, next);
    }
  }
  return states;
}

// ---------------------------------------------------------------------------
// Capability requests — agent-initiated, operator-approved. Requests are pure
// derivations from cluster evidence (never persisted); only grant/reject
// decisions are events, in the same log as call events. Vocabulary is
// deliberately "capability/grant", never RBAC terms.
// ---------------------------------------------------------------------------

/**
 * The movement levers the agent can request, one per cohort. Which lever fits
 * a cohort is inferred from its outcome mix (overridable in profiles.json).
 */
export type CapabilityId = "send_kyc_link" | "schedule_retry" | "route_human" | "suppress";

export interface CapabilityGuardrails {
  /** Approved WhatsApp template — locked, not free-text. */
  templateId: string;
  maxSendsPerHour: number;
  /** Frozen at grant; a wave-2 dispatch scope must be ⊆ this. Never widens. */
  scopeClusterIds: string[];
  /** Grant expires after one wave. */
  maxWaves: 1;
  auditLog: true;
}

export interface CapabilityExcerpt {
  callId: string;
  quote: string;
}

export interface CapabilityEvidence {
  /** Every movable call backing the request — never derived from one call. */
  callIds: string[];
  /** Representative transcript moments, traceable to specific calls. */
  excerpts: CapabilityExcerpt[];
  /** The cluster's customer-language pattern (prose, from analysis). */
  languagePattern: string;
  /** Calls in this cohort the capability could move (evidence size). */
  unresolvedCount: number;
  /** Projected users moved to the next bucket. */
  projectedMoved: number;
  /** What "moved" means for this lever — "KYC done", "reconnected", … */
  movedLabel: string;
}

export interface CapabilityRequest {
  id: string; // cap_<clusterId> — stable across derivations
  runId: string;
  capability: CapabilityId;
  scope: JourneyDispatchScope;
  /** Agent-voice one-liner, templated from cluster fields. */
  rationale: string;
  evidence: CapabilityEvidence;
  proposedGuardrails: CapabilityGuardrails;
}

export type CapabilityEventType = "capability_granted" | "capability_rejected";

export interface CapabilityEvent {
  id: string; // evt_cap_<requestId>_0001
  runId: string;
  requestId: string;
  type: CapabilityEventType;
  /** Granted only — the frozen guardrails copy. */
  guardrails?: CapabilityGuardrails;
  /** Rejected only — operator-entered. */
  reason?: string;
  /** Virtual ISO timestamp (client demo clock at decision time). */
  at: string;
}

/** events.ndjson holds the union; simulated and real events share one pipe. */
export type JourneyLogEvent = JourneyEvent | CapabilityEvent;

export function isCallEvent(event: JourneyLogEvent): event is JourneyEvent {
  return "callId" in event;
}

export type CapabilityRequestStatus = "requested" | "granted" | "rejected";

export interface CapabilityRequestWithStatus extends CapabilityRequest {
  status: CapabilityRequestStatus;
  decidedAt?: string;
  /** Rejected only. */
  reason?: string;
  /** Granted only — the frozen copy from the grant event. */
  guardrails?: CapabilityGuardrails;
}

/** First decision wins — the API rejects a second decision with 409. */
export function reduceCapabilityDecisions(events: JourneyLogEvent[]): Map<string, CapabilityEvent> {
  const decisions = new Map<string, CapabilityEvent>();
  for (const event of events) {
    if (isCallEvent(event)) continue;
    if (!decisions.has(event.requestId)) decisions.set(event.requestId, event);
  }
  return decisions;
}

export function withCapabilityStatus(
  requests: CapabilityRequest[],
  events: JourneyLogEvent[],
): CapabilityRequestWithStatus[] {
  const decisions = reduceCapabilityDecisions(events);
  return requests.map((request) => {
    const decision = decisions.get(request.id);
    if (!decision) return { ...request, status: "requested" };
    return {
      ...request,
      status: decision.type === "capability_granted" ? "granted" : "rejected",
      decidedAt: decision.at,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.guardrails ? { guardrails: decision.guardrails } : {}),
    };
  });
}
