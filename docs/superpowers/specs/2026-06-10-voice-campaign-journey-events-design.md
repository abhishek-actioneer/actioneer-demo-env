# Voice-Campaign Journey Events (Dispatch → Outcome Loop)

**Date:** 2026-06-10
**Status:** Draft
**Scope:** `/voice-campaign-insights` page + new journey data layer + simulator. Builds on the lanes spec (`2026-06-10-dynamic-voice-campaign-lanes-design.md`).

## Problem

The insights page is a static post-campaign readout. The demo story ("Actioneer turns
conversations into measured outcomes") needs the dots to *move*: act on a cluster
(send KYC link, schedule retry, suppress) and watch calls progress through
delivered → clicked → KYC completed, with a ₹ counter and a holdout-measured lift.

This spec covers the foundation only: the journey state model, event/dispatch
schemas, storage, the simulator contract, and the API surface. Dot-state visual
design and the action panel UI are a follow-up spec.

## Design principles

1. **Events are the source of truth; state is derived.** A call's journey state is a
   pure reduction over its events up to the demo clock. No mutable state fields.
2. **Deterministic at rest.** Like the clustering pipeline, the simulator is seeded
   (mulberry32). Dispatching a cluster generates the *entire* future event timeline
   immediately, with virtual timestamps, and persists it. Nothing is generated on a
   background timer — a crash or refresh loses nothing, and the same dispatch always
   produces the same outcomes.
3. **The clock is client-side.** Replay, scrub, pause, and time-lapse are all "move
   the demo clock and re-reduce." The server never sleeps.
4. **Simulated and real events share one pipe.** The SSE tail doesn't care whether
   an event was pre-written by the simulator or appended by a (future) WhatsApp
   webhook. Demo architecture == production architecture, one adapter swapped.

## Journey state machine

Per `callId`, derived by precedence (highest wins) over events with `at <= demoClock`:

```
completed > clicked > delivered > dispatched
          > retry_scheduled | routed_human | suppressed | held_out
          > analyzed (baseline: no events — call exists in clusters.json)
```

- `held_out` is the control group: selected at dispatch, receives no action, but the
  simulator still gives it an *organic* completion probability so lift is honest
  (control ≠ 0%).
- `suppressed` / `retry_scheduled` / `routed_human` are terminal-for-now states for
  the non-link actions. They produce no downstream events in v1.
- No expiry event. "Dispatched 72h ago, never completed" is just a dot that stopped.

## Schemas

New module `src/lib/voice-campaign-journey-types.ts` (client-safe, types only).

```ts
export type JourneyAction =
  | "send_kyc_link"     // → dispatched → delivered → clicked → completed
  | "schedule_retry"    // → retry_scheduled
  | "route_human"       // → routed_human
  | "suppress";         // → suppressed

export type JourneyEventType =
  | "dispatched" | "delivered" | "clicked" | "completed"
  | "retry_scheduled" | "routed_human" | "suppressed" | "held_out";

export interface JourneyEvent {
  id: string;            // evt_<dispatchId>_<seq>
  runId: string;
  callId: string;
  dispatchId: string;    // every event traces to a dispatch (incl. held_out, organic completions)
  type: JourneyEventType;
  channel?: "whatsapp" | "sms";  // link events only
  at: string;            // virtual ISO timestamp
}

export interface JourneyDispatch {
  id: string;            // dsp_<seq>, sequential per run
  runId: string;
  scope: { clusterId: string } | { laneId: string };
  action: JourneyAction;
  callIds: string[];         // treated
  holdoutCallIds: string[];  // control (empty for suppress/retry/route actions)
  holdoutFraction: number;   // requested fraction, default 0.1; 0 for non-link actions
  seed: number;              // mulberry32 seed used for split + timeline
  createdAt: string;         // virtual time of dispatch
}
```

Events carry **no** clusterId/laneId/x/y — the insights payload already maps
`callId → cluster/lane/position`. One source of truth; the client joins on callId.

## Storage

Per-run directory **sibling to** `analysis/`, never inside it (the regeneration
recipe deletes `analysis/{cluster-drafts,clusters,final-analysis,call-map}.json`;
journey state is operational history and must survive pipeline re-runs):

```
data/voice-simulation-runs/<runId>/journey/
  dispatches.json    # JourneyDispatch[]
  events.ndjson      # append-only JourneyEvent per line, ordered by write time (NOT by `at`)
  profiles.json      # simulator conversion profiles + ₹ config (hand-tunable, checked in)
```

Caveat carried over from the lanes work: journey events reference callIds and
clusterIds from the clusters.json that existed at dispatch time. Re-running the
analysis pipeline can reassign cluster membership, orphaning dispatch scopes. v1
rule: **re-running the pipeline implies resetting journey state** (delete the
`journey/` dir). The reset endpoint below makes this one call.

## Simulator contract

Server module `src/lib/voice-campaign-journey-sim.ts`. Pure function:

```ts
generateTimeline(dispatch, profile, calls): JourneyEvent[]
```

- PRNG: `mulberry32(dispatch.seed)`; seed = stable hash of `runId + dispatch.id`.
  Reuse `mulberry32` by extracting it from `scripts/lib/voice-clustering.ts` into a
  shared `src/lib/seeded-random.ts` that both scripts and server import (scripts
  already import from relative paths; Next can't import from `scripts/`).
- Per treated call (action `send_kyc_link`):
  `dispatched` at t0 → `delivered` (p≈0.97, +1–5 min) → `clicked`
  (p = profile.pClicked, lognormal offset, median ~3h) → `completed`
  (p = profile.pCompleted, lognormal offset, median ~14h, tail to 72h).
- Per holdout call: `held_out` at t0; then `completed` with
  p = profile.pOrganic (median ~36h) — the organic baseline that makes lift real.
- Non-link actions: a single `retry_scheduled` / `routed_human` / `suppressed`
  event per call at t0+seconds.
- The full timeline is generated and appended to `events.ndjson` synchronously in
  the dispatch request. No timers, no queues.

### profiles.json

```ts
{
  "unitValueInr": 1800,            // ₹ per completed KYC, drives the counter
  "horizonHours": 72,
  "defaults": { "pClicked": 0.55, "pCompleted": 0.5, "pOrganic": 0.07 },
  "clusters": {                     // overrides — the planted stories live here
    "cluster_02": { "pClicked": 0.7, "pCompleted": 0.62 },   // "atak gaya, baad mein" — hot
    "cluster_07": { "pClicked": 0.2, "pCompleted": 0.25 }    // distrust — cold
  }
}
```

Hand-tuned per run, checked in. If absent, defaults apply to every cluster. Numbers
above are placeholders; tune so recoverable lanes convert ~35–45% end-to-end and
distrust clusters <10%.

## API surface

Under the existing standalone namespace `src/app/api/voice-campaigns/insights/`
(Clerk-protected like the rest; the page is server-rendered and authed):

- **`POST /api/voice-campaigns/insights/dispatch`**
  Body `{ runId, scope, action, holdoutFraction? }`. Validates runId format and
  that scope ids exist in `clusters.json`; rejects a second link-dispatch covering
  already-dispatched callIds (409 with the conflicting dispatchId). Seeds the
  split, runs the simulator, persists, returns `{ dispatch, eventCount }`.
- **`GET /api/voice-campaigns/insights/journey?run=<runId>`**
  Snapshot `{ dispatches, events }` (full log) for SSR/initial render.
- **`GET /api/voice-campaigns/insights/journey/stream?run=<runId>`**
  SSE, NDJSON lines (same framing as `/api/analyze`): replays every persisted
  event, emits `{"type":"caught_up"}`, then tails file appends (fs.watch +
  byte-offset re-read; 15s keepalive comments). This is how a future real webhook
  event reaches an open page without refresh.
- **`DELETE /api/voice-campaigns/insights/journey?run=<runId>`**
  Demo reset: deletes the run's `journey/` dir. Required for repeated demos and
  after pipeline re-runs.

Future (out of scope, shape reserved): `POST /api/voice-campaigns/webhooks/wa`
appends real `delivered`/`clicked`/`completed` events to the same `events.ndjson`.

## Client reduction (contract only — UI is the next spec)

- A `useJourney(runId)` hook owns: SSE subscription, the event log, and the demo
  clock `{ virtualNow, speed, playing }`.
- Derived per render: `Map<callId, JourneyState>` from events with
  `at <= virtualNow`, plus aggregates (per-dispatch funnel counts, treated-vs-holdout
  completion rates → lift, `completed × unitValueInr` → ₹ counter).
- Scrubbing = setting `virtualNow`. "Live" mode pins `virtualNow` to wall clock so
  real webhook events surface as they arrive.
- Demo clock starts at the earliest dispatch `createdAt`; default playback
  compresses the 72h horizon to ~30s of real time.

## Non-goals (v1)

- Real WhatsApp/CleverTap integration (next phase: one test number, one in-call
  `send_kyc_link` tool on the Gemini Live bridge writing to the same event log).
- DuckDB landing of events (100x-scale concern, not demo-week).
- Multi-dispatch interaction effects (retry-then-link sequencing).
- Per-stakeholder views, drift alerts.

## Open questions

1. Should `dispatch` for a whole *lane* fan out into per-cluster profiles (yes —
   simulator reads per-cluster overrides per callId via the insights payload join)
   — confirm at implementation.
2. Where the ₹ unit value surfaces in UI copy ("estimated activation value, demo
   assumption") — needs a credibility footnote, decide in the UI spec.
3. `fs.watch` reliability on macOS for the SSE tail — fallback is 2s polling of
   file size; decide during implementation, contract is unchanged.
