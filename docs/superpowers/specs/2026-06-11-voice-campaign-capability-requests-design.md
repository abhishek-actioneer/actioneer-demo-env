# Voice-Campaign Capability Requests (Agent-Initiated, Operator-Approved)

**Date:** 2026-06-11
**Status:** Implemented (revised same day: the UI section is named
**"Progression plan"** and derives one movement request per cohort — the lever
per cohort is inferred from its outcome mix or overridden via
`profiles.capability.clusterCapabilities`; `CapabilityId` is the union
`send_kyc_link | schedule_retry | route_human | suppress`; projections are
movement-framed as user counts — the ₹/`unitValueInr` value layer was removed
entirely; `eligibleClusterIds` is replaced by the per-cohort mapping; the
proposed-move card renders inside the selected-cohort panel, not a standing
rail)
**Scope:** Reframes the dispatch → outcome loop from operator-initiated to
agent-initiated. Builds on the journey events spec
(`2026-06-10-voice-campaign-journey-events-design.md`); the reverted UI diffs
live in `patches/journey-viz-integration.diff` + `patches/journey-shared-files.diff`.

## Problem

The built journey loop is operator-initiated: a human looks at a cluster and
clicks "send KYC links". The stronger frame for FS buyers (HDFC Credit, TVS
Credit, FundsIndia, DCB Niyo): the **agent** hits walls in-call, the
intelligence layer detects the pattern across a cluster, and the system
generates a **capability request** to its operator —

> "I couldn't resolve 229 calls without `send_kyc_link`. Scoped to the approved
> WhatsApp template, rate-limited, audit-logged. Evidence: these transcripts.
> Projected recovery: ₹2.1L."

The operator grants with visible guardrails → the next wave of calls runs with
the tool → the lane shrinks. Governance *is* the feature: the demo shows that
agents in this system can't acquire reach without evidence, scope, and a human
signature.

## Vocabulary

Say **capability**, **request**, **grant**, **guardrails**. Never "permission",
"role", or "policy" — main Sentinel RBAC is Tarun's SQL/data layer and must not
be conflated with this. A capability is an *action verb the voice agent may use*,
not a data-access rule.

## Design principles

1. **Requests derive from cluster evidence, never one call.** A request exists
   only when ≥ `minEvidenceCalls` calls in a cluster hit the same wall. The
   derivation is a pure, deterministic function of the analysis payload +
   profiles — no LLM call, no persistence. Re-deriving always yields the same
   requests with the same ids.
2. **Decisions are events; requests are not.** Only grant/reject decisions are
   appended to `events.ndjson` (same file, same SSE pipe — a grant is just
   another operator action in the journey event model). Request *status* is a
   reduction over decision events, exactly like call journey states.
3. **Grants never widen mid-campaign.** Guardrails are frozen at grant time as a
   copy on the grant event. A wave-2 dispatch must match the grant exactly:
   same scope, same action, one wave per grant. The operator can decline; they
   cannot enlarge.
4. **Rejection is a first-class path.** A rejected request collapses with a
   reason and stays visible (audit). It can only reappear with new evidence —
   i.e. a new analysis run.
5. **Demo architecture == production architecture.** In the real version the
   grant object becomes the function-declaration allowlist on the Gemini Live
   session config (Plivo↔Gemini bridge), and in-call tool calls append to the
   same `events.ndjson`. Nothing in the schema is demo-only.

## Schemas

Additions to `src/lib/voice-campaign-journey-types.ts` (client-safe, types +
pure reducers only):

```ts
export type CapabilityId = "send_kyc_link"; // v1: one capability; the union grows

export interface CapabilityGuardrails {
  templateId: string;        // approved WhatsApp template — locked, not free-text
  maxSendsPerHour: number;
  scopeClusterIds: string[]; // frozen at grant; wave-2 dispatch must be ⊆ this
  maxWaves: 1;               // grant expires after one wave (v1 constant)
  auditLog: true;
}

export interface CapabilityEvidence {
  callIds: string[];                            // every call backing the request
  excerpts: { callId: string; quote: string }[]; // 3 representative transcript moments
  signalTerms: string[];                        // cluster customerLanguagePattern terms
  unresolvedCount: number;
  projectedCompletions: number;                 // unresolved × wave-2 end-to-end p
  projectedValueInr: number;                    // × profiles.unitValueInr
}

export interface CapabilityRequest {
  id: string;                 // cap_<clusterId> — stable across derivations
  runId: string;
  capability: CapabilityId;
  scope: JourneyDispatchScope; // { clusterId } in v1 (lane-scoped requests are out)
  rationale: string;           // agent-voice one-liner, templated from cluster fields
  evidence: CapabilityEvidence;
  proposedGuardrails: CapabilityGuardrails;
}

export type CapabilityEventType =
  | "capability_granted"
  | "capability_rejected";

export interface CapabilityEvent {
  id: string;          // evt_cap_<requestId>_<seq>
  runId: string;
  requestId: string;
  type: CapabilityEventType;
  guardrails?: CapabilityGuardrails; // granted only — the frozen copy
  reason?: string;                   // rejected only — operator-entered
  at: string;                        // virtual ISO timestamp (client virtualAt)
}

export type JourneyLogEvent = JourneyEvent | CapabilityEvent; // discriminate on type
```

`events.ndjson` becomes a `JourneyLogEvent` log. `reduceJourneyStates()` skips
capability events (no `callId`); a sibling reducer derives request status:

```
granted | rejected > requested (baseline: derivable but undecided)
```

### Call-event additions (wave 2)

- New `JourneyEventType`: `"recalled"` — the agent calls the customer again,
  now holding the tool.
- `channel` union gains `"voice"` — a `dispatched` event with
  `channel: "voice"` means the link was sent *during a live call* (the agent
  co-signs it: "I'm sending it now from the official number" — this is what
  converts the distrust/vishing cluster).
- `JourneyDispatch` gains `wave: 1 | 2` and optional `grantRequestId`
  (required iff wave 2).

State precedence renumbers to make room (still a pure table change):

```
completed 9 > clicked 8 > delivered 7 > dispatched 6 > recalled 5
> retry_scheduled | routed_human | suppressed | held_out 4 > analyzed 0
```

## Request derivation

New pure function in a server-safe module (e.g.
`src/lib/voice-campaign-capability.ts`):

```ts
deriveCapabilityRequests(payload, profiles): CapabilityRequest[]
```

- A cluster qualifies when its unresolved-call count ≥
  `profiles.capability.minEvidenceCalls` (default 20). Unresolved = callIds
  whose `callDetails[].outcome` is not in a small `RESOLVED_OUTCOMES` set
  (constant in the module, decided against the kyc-450 outcome strings at
  implementation).
- `excerpts` = first 3 of the cluster's `evidenceQuotes` joined to
  `sampleCallIds`; `signalTerms` from `customerLanguagePattern`.
- `rationale` is templated, written in the agent's voice:
  `"I couldn't resolve ${unresolvedCount} calls in “${cluster.title}” without
  send_kyc_link."`
- Projection: `unresolvedCount × (pReached × pLinkSent × pClicked × pCompleted)`
  from the wave-2 profile (per-cluster overrides apply), `× unitValueInr`.
- An optional `profiles.capability.eligibleClusterIds` allowlist narrows
  derivation for demo curation; absent ⇒ every qualifying cluster.

Requests are computed on `GET /journey` and returned alongside dispatches and
events — never stored. Stable ids (`cap_<clusterId>`) make decision events
joinable across requests recomputed on every GET.

## Wave-2 simulation

`generateTimeline()` branches on `dispatch.wave === 2` (action is still
`send_kyc_link`):

- Eligible calls = grant scope's callIds minus calls `completed` before the
  dispatch's virtual t0 minus `suppressed` calls. Same seeded 10% holdout split
  (`held_out` + `pOrganic`, unchanged) so wave-2 lift is honest too.
- Per treated call: `recalled` at t0 + jitter (≤ 10 min, the redial queue)
  → reached with `pReached` (~0.65; not reached = dot rests at `recalled`)
  → `dispatched` `channel:"voice"` with `pLinkSent` (~0.9, +1–4 min into call)
  → `delivered` (+1 min) → `clicked` (`pClicked` ~0.85, median ~10 min — often
  while still on the phone) → `completed` (`pCompleted`, median ~6h).
- The wave-2 deltas vs wave 1 are the planted story: the distrust cluster gets
  the largest uplift override, because a live co-signed link answers the
  vishing fear that a cold WhatsApp blast cannot.

### profiles.json additions

```jsonc
{
  // existing: unitValueInr, horizonHours, defaults, clusters
  "capability": {
    "templateId": "kyc_link_v3",
    "maxSendsPerHour": 200,
    "minEvidenceCalls": 20
    // optional: "eligibleClusterIds": ["cluster_04", "cluster_08"]
  },
  "wave2": {
    "defaults": { "pReached": 0.65, "pLinkSent": 0.9, "pClicked": 0.85, "pCompleted": 0.7 },
    "clusters": { "cluster_07": { "pClicked": 0.9, "pCompleted": 0.8 } } // distrust uplift
  }
}
```

All hand-tunable without code, per the existing convention.

## API surface

- **`GET /api/voice-campaigns/insights/journey`** — response gains
  `requests: (CapabilityRequest & { status })[]` (derived + status-reduced).
- **`POST /api/voice-campaigns/insights/capability`** *(new)* — body
  `{ runId, requestId, decision: "grant" | "reject", reason?, virtualAt }`.
  Validates the request is currently derivable; 409 if a decision event already
  exists for `requestId`. Grant appends `capability_granted` with the frozen
  guardrails copied from `proposedGuardrails` (operator cannot edit scope —
  never-widen is structural, not a UI promise). Reject requires `reason`.
- **`POST /api/voice-campaigns/insights/dispatch`** — body gains
  `{ wave?: 1 | 2, grantRequestId?, virtualAt? }`. Wave-2 validation: a
  `capability_granted` event exists for `grantRequestId`; dispatch scope ===
  request scope; action === granted capability; 409 if a wave-2 dispatch
  already references this grant (`maxWaves: 1`). `virtualAt` (the client demo
  clock) becomes the timeline t0 and the completed-before cutoff — the server
  has no demo clock of its own.
- Reset (`DELETE /journey`) and the stream are unchanged; the stream simply
  tails a file that now contains the union type.

The existing wave-1 dispatch path stays valid at the API layer (useful for
scripts/tests), but the restructured UI removes the operator-direct
`send_kyc_link` button — in the product narrative, link-sending reach exists
*only* behind a grant. `schedule_retry` / `route_human` / `suppress` remain
operator-direct actions (they are operator work, not agent capabilities).

## UI restructure (sketch — re-apply `patches/` around this)

- **Requests rail** replaces dispatch buttons as the journey entry point: an
  "Agent requests" inbox above the control bar, one card per derived request,
  ordered by projected ₹.
- **Request card**: agent-voice rationale → evidence row (`229 calls`,
  expandable transcript excerpts, signal terms) → projected ₹ (with the demo-
  assumption footnote) → guardrails list (template, rate limit, scope, expiry,
  audit) → `Grant` / `Reject`.
- **Grant** opens an `AlertDialog` whose body *is* the guardrails list — the
  consent moment. Confirming appends the grant event and immediately fires the
  wave-2 dispatch (one gesture: grant ⇒ next wave runs). **Reject** opens a
  reason field; the card collapses to a single audit line.
- The grant moment is a tick on the scrubber timeline; scrubbing past it shows
  wave 2 igniting — `recalled` rings, voice-channel sends, the lane's bubble
  inner-fill growing as it resolves.
- Everything monochrome per house style; lane accents remain the only scoped
  exception.

## Production contract (out of scope for demo week; design settled 2026-06-11)

The simulator is the only throwaway component. Production replaces it with
three adapters — **mint-link**, **send**, **ingest** — writing to the same
event log the simulator writes today. The UI does not change.

### Grant → session config

The grant compiles to the Gemini Live session config for the wave's calls:
`tools: [{ functionDeclarations: [send_kyc_link] }]` present iff a grant
covers the call. No grant ⇒ the declaration is absent — the agent cannot even
attempt it. That is the governance claim made literal, but it is the UX half.
The security half is the bridge's tool-call handler, which re-validates
server-side on every call: grant active and covers this callId, template
matches, rate budget available, not already sent. Never trust the model side.

### The tool-call information rule

The agent never receives or supplies customer identity through the tool. The
session is already bound to it: `CallConfig` (written before the phone rings;
see `voice-call-state.ts`) carries `toNumber`, customer/booking identity, and
gains `grantRequestId` + `journeyCallId`. The handler closes over it. The model
decides *when and which*; the server decides *what and to whom*.

Argument spectrum by capability — free-text arguments never (that is the
prompt-injection door; "send it to my other number" must be structurally
impossible):

- **zero-arg** — `send_kyc_link`: identity from session, link to the dialed
  (= registered) number only
- **enum-arg** — `send_reco_card({contentId})`: selection from a pre-approved,
  grant-frozen content catalog; the model never composes content (SEBI-shaped
  clusters demand this)
- **bounded-numeric** — `send_voucher({amountInr ≤ grant cap})`: plus total
  budget + expiry in guardrails
- **sensitive-payload-behind-auth** — `send_report_link`: message body is
  content-free; health data sits behind the client's auth wall (DPDP sensitive
  data; authenticated link, registered number only, 24h expiry)

After the send, the handler returns a `toolResponse` so the agent can close
verbally ("bhej diya, check kar lijiye") — without it the model stalls or
hallucinates the outcome — then appends `dispatched` (`channel:"voice"`) to
the journey log. Delivery receipts append `delivered`; the destination
surface's own `link_opened` event appends `clicked`.

### Generalization = config, not products

One pipeline. Per-campaign config is exactly three things:

1. **Objective** — outcome event + horizon + value framing. `kyc_completed`/
   72h/₹1800 per unit; `sip_resumed`/14d; `feedback_submitted`/48h as a *rate*
   — no ₹ on browses or feedback submissions; that is where the credibility
   footnote stops working. Outcomes always join against the client's own data
   (the positioning moat); holdouts matter most where organic noise is highest
   (reactivation).
2. **Topology** — **batch** (segment campaigns: wave = re-dial of the
   unresolved list; holdout = withheld customers) vs **stream**
   (event-triggered calls, e.g. post-collection feedback, fraud verification:
   wave = a time/volume-boxed window of *future* calls with the tool enabled;
   holdout = capability A/B on incoming calls; the lane "shrinks" in the next
   analysis window).
3. **Capability catalog + guardrail vocabulary** — clusters map to
   capabilities; guardrails speak the buyer's compliance language. The one
   hardcoded KYC-ism in the current build is the cluster→capability mapping
   (every eligible cluster ⇒ `send_kyc_link`); the lane-naming LLM call can
   emit a capability id from the campaign's catalog at analysis time — a
   prompt change, not a runtime LLM call.

### Links: one URL, the phone decides

One HTTPS link for everyone — never separate app/web links. Universal Links
(iOS, AASA) / App Links (Android, assetlinks.json) open the installed app at
the right step; no app falls back to mobile web automatically. The token
encodes resume-at-step; in-app routing of the claimed path is the client's
side of the contract.

Two hard-won specifics:

- **Redirect-based click tracking breaks app-opening.** The OS resolves
  app-vs-web from the *tapped* domain only; universal links do not survive a
  server-side redirect through a tracking domain. Read `clicked` from the
  destination's own event instead (also bot-proof — SMS scanners and preview
  fetchers inflate redirect clicks). Fallbacks: branded subdomain
  (`go.client.com` → our redirector, claimed by their app) or the client's
  existing Branch/AppsFlyer webhooks.
- **Never detour through the app store.** Deferred deep linking trades the
  outcome for an install inside a 48–72h window; web fallback always works
  for KYC/feedback/report flows.

### Per-client integration ask (the solutions-call list)

1. **Mint-link**: `POST /links {customerId|bookingId, intent} → {url,
   expiresAt}` inside their boundary (link semantics, KYC-provider sessions,
   expiry stay theirs; we never learn how their KYC works) — or, pilot-grade,
   a URL pattern + shared signing secret on their existing domain.
2. **One approved message template** — Meta WhatsApp template or TRAI DLT SMS
   registration. Multi-day approval lead time: a week-one ask.
3. **Universal/app links live** on their domain + app routes the claimed path
   (usually already true for consumer apps).
4. **Outcome read path** — the objective's completion event from their
   warehouse/event stream, plus `link_opened` for clicks.
5. Compliance sign-off on the grant/audit model — the guardrails UI is the
   artifact for that meeting.

Everything else — grant store, rate limiter, audit log, event pipe, the
journey UI — is ours and exists in v1 shape on this branch.

## Non-goals (v1)

- Multiple capabilities / a capability catalog (`send_kyc_link` only).
- Operator-edited guardrails (tighten-only editing is a plausible v2; v1 grants
  exactly what was proposed or nothing).
- Mid-wave revocation (grants expire after one wave by construction).
- Lane-scoped requests (cluster-scoped only; a lane request is just its
  qualifying clusters' requests).
- Real Gemini Live function declarations, DuckDB event landing, multi-tenant
  template registries.

## Open questions

1. Grant auto-fires the wave-2 dispatch (recommended: one gesture, and the
   AlertDialog is the consent) vs a separate "Run next wave" click after grant.
   The API keeps them separate either way; only the UI composes them.
2. Should an *undecided* request block wave-1-style operator actions on the
   same cluster (`schedule_retry` etc.)? Leaning no — they're orthogonal — but
   the demo script should avoid mixing them on one cluster.
3. Exact `RESOLVED_OUTCOMES` set against the kyc-450 outcome vocabulary —
   decide at implementation by inspecting `callDetails[].outcome` values.
4. Whether the rejected-request audit line needs to survive journey reset
   (currently no: reset wipes `events.ndjson`, and a demo reset means "fresh
   campaign").
