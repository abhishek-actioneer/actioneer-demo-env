# FundsIndia Lifecycle Campaign Experimentation Plan

Date: 2026-06-02

## Purpose

Build Actioneer's first real lifecycle experimentation loop on top of voice campaigns, using the FundsIndia dataset and the Gemini + Plivo call path.

The first journey is:

```txt
Investors who browsed/searched/watchlisted funds or started a SIP flow
AND have not completed KYC/account activation
```

The product loop we are proving:

```txt
Insight -> Audience -> Offer -> Experiment -> Calls -> Lift -> Learning
```

This is not a static 300-user CSV experiment. The CSV, if used, is only a contact mapping layer. The source of truth for who qualifies is the dynamic segment plus lifecycle enrollment state.

## Current Decision Record

### Journey

Use FundsIndia and focus on KYC/account activation recovery:

- Eligibility signal: recent product/fund/SIP browsing behavior with incomplete KYC or account activation.
- Experiment unit: `investor_id`.
- Primary treatment channel: Gemini + Plivo voice call.
- Initial arms: control, script A, script B.
- Control users are enrolled and observed but never contacted.
- Treatment users get per-user `offerInstanceId` and voice call tasks.

### Synthetic Clock

Skip the repo-wide synthetic clock for V1.

Use a campaign-local `asOfDate` / enrollment window instead:

```txt
fixed FundsIndia historical dataset
+ campaign-local asOfDate
+ lifecycle enrollments
+ campaign overlay events
= dynamic lifecycle behavior
```

Reasoning:

- FundsIndia does not currently have a registered synthetic live-data plan.
- Adding a full FundsIndia synthetic generator before experimentation would expand scope materially.
- The core product truth is enrollment state, assignment, treatment, outcome, and learning, not fake new rows.
- Campaign-local time is enough to prove dynamic lifecycle behavior without changing all analytics.

Tradeoff:

- We will not get organic new FundsIndia behavior events appearing daily unless we replay historical windows or add overlay events.
- That is acceptable for V1. Later, add a FundsIndia synthetic plan if the whole dataset needs to feel live.

### Product Surface

`/campaigns` should become the canonical lifecycle campaign surface.

Existing `/campaigns` is currently a segment-push/CleverTap activity log. It should be migrated or folded into the new campaign hub as legacy campaign activity/history.

`/voice-campaigns` should remain the voice studio/live-test surface, but not the core business object.

## Conceptual Model

A dynamic segment is an eligibility signal. A lifecycle campaign turns eligibility into durable per-user state.

```txt
Segment says who qualifies.
Enrollment remembers what happened.
Experiment decides what treatment they get.
Policy decides whether they can be contacted.
Offer instance stitches the revenue journey together.
```

For this journey:

```txt
qualified
-> enrolled
-> assigned_control / assigned_treatment
-> observing / queued
-> attempted
-> connected
-> pitched
-> accepted / rejected / pending / no_answer
-> converted / expired / cooldown / suppressed
```

Hard exits:

```txt
completed_kyc
account_activated
opted_out
wrong_number
complaint
ineligible
```

## V1 Scope

Build an end-to-end dynamic-backed pilot:

1. Create lifecycle campaign from a FundsIndia segment.
2. Define hypothesis, OEC, guardrails, arms, allocation, and attribution window.
3. Evaluate eligible investors as of campaign `asOfDate`.
4. Resolve contactability from manual CSV mapping.
5. Enroll eligible/contactable investors once.
6. Assign deterministically into control / script A / script B.
7. Create offer instances for treatment users.
8. Create Gemini + Plivo call tasks for treatment users only.
9. Analyze transcripts into structured experiment events.
10. Show run monitor and results scorecard.
11. Save decision record: ship / kill / iterate.

Every result screen must label:

```txt
Pilot mode: directional readout, not powered for statistical significance.
```

## Out Of Scope For V1

- Full journey canvas.
- Multi-armed bandits.
- Automated winner rollout.
- Global holdouts and mutual exclusion layers.
- CUPED/power calculator.
- Rumik integration.
- WhatsApp/deeplink fulfillment, unless explicitly needed for the pilot.
- Full FundsIndia synthetic live-data generator.
- Large-scale durable scheduler beyond a conservative treatment task runner.

## Data Model

Use SQLite via `meta-db`, not JSON, because this becomes the durable product core.

All server write paths must be idempotent upserts.

### `lifecycle_campaigns`

Represents the business campaign.

Fields:

```ts
{
  id: string;
  userId: string;
  datasetId: "fundsindia";
  name: string;
  status: "draft" | "enrolling" | "running" | "completed" | "stopped";
  lifecycleProfileId: "fundsindia_kyc_recovery";
  segmentId: string;
  offerId: string;
  asOfDate: string;
  attributionWindowDays: number;
  contactPolicyJson: string;
  createdAt: string;
  updatedAt: string;
}
```

### `campaign_experiments`

Represents measurement design.

```ts
{
  id: string;
  campaignId: string;
  hypothesis: string;
  oecMetric: "account_activated" | "kyc_completed" | "bank_verified";
  guardrailMetricsJson: string;
  randomizationUnit: "investor_id";
  salt: string;
  status: "draft" | "running" | "completed" | "stopped";
  createdAt: string;
  updatedAt: string;
}
```

### `experiment_arms`

```ts
{
  id: string;
  experimentId: string;
  type: "control" | "treatment";
  name: string;
  allocationPct: number;
  scriptVariantId?: string;
  voiceConfigJson?: string;
  metadataJson?: string;
}
```

### `lifecycle_enrollments`

The most important table. One row per investor per campaign enrollment.

```ts
{
  id: string;
  campaignId: string;
  experimentId: string;
  armId: string;
  investorId: string;
  segmentId: string;
  currentState: string;
  firstQualifiedAt: string;
  enrolledAt: string;
  assignedAt: string;
  attributionWindowEndsAt: string;
  offerInstanceId?: string;
  lastTouchAt?: string;
  cooldownUntil?: string;
  exitReason?: string;
  createdAt: string;
  updatedAt: string;
}
```

### `offer_instances`

Per-user treatment identity.

```ts
{
  id: string;
  campaignId: string;
  experimentId: string;
  armId: string;
  enrollmentId: string;
  investorId: string;
  offerId: string;
  skuId?: string;
  deeplink?: string;
  status: "assigned" | "pitched" | "accepted" | "rejected" | "pending" | "converted" | "expired";
  createdAt: string;
  updatedAt: string;
}
```

### `campaign_events`

Append-only event ledger.

```ts
{
  id: string;
  userId: string;
  datasetId: string;
  campaignId: string;
  experimentId?: string;
  armId?: string;
  enrollmentId?: string;
  offerInstanceId?: string;
  investorId: string;
  eventType: string;
  occurredAt: string;
  source: "segment_evaluator" | "assignment" | "voice_call" | "transcript_analysis" | "manual" | "simulator" | "system";
  metadataJson?: string;
}
```

Event classes:

```txt
Domain events: kyc_completed, bank_verified, account_activated, sip_created
Experiment events: assigned, call_attempted, call_connected, sku_pitched, offer_accepted, offer_rejected, offer_pending
Policy events: opted_out, wrong_number, complaint, conduct_flag, suppression_added
```

### `contact_identities`

Manual CSV contact mapping.

```ts
{
  id: string;
  userId: string;
  datasetId: string;
  entityId: string;      // investor_id for FundsIndia
  phoneNumber: string;
  consent: boolean;
  name?: string;
  preferredLanguage?: string;
  source: "manual_csv" | "manual_entry";
  createdAt: string;
  updatedAt: string;
}
```

If the CSV only has phone numbers and no `investor_id`, it can be a tester pool later, but it cannot define the experiment audience.

### `treatment_tasks`

Durable call tasks for treatment users.

```ts
{
  id: string;
  campaignId: string;
  experimentId: string;
  armId: string;
  enrollmentId: string;
  offerInstanceId: string;
  investorId: string;
  channel: "voice";
  provider: "plivo-gemini";
  status: "queued" | "starting" | "calling" | "connected" | "completed" | "failed" | "no_answer" | "cancelled";
  voiceCampaignId?: string;
  voiceCallId?: string;
  scheduledFor?: string;
  startedAt?: string;
  endedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
```

### `decision_records`

```ts
{
  id: string;
  campaignId: string;
  experimentId: string;
  decision: "ship" | "kill" | "iterate";
  notes: string;
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}
```

## FundsIndia Lifecycle Profile

Add a profile module, for example:

```txt
src/lib/lifecycle/profiles/fundsindia-kyc-recovery.ts
```

Responsibilities:

- Define eligibility SQL.
- Define conversion SQL.
- Define exit events.
- Define suggested guardrails.
- Define default contact policy.
- Define default experiment metrics.
- Provide investor context for Gemini prompt personalization.

Eligibility should be based on existing FundsIndia events and columns:

- `fund_searched`
- `fund_page_viewed`
- `fund_watchlisted`
- `sip_flow_started`
- `sip_amount_entered`
- `sip_flow_abandoned`
- `kyc_status`
- `bank_verified_date`
- `account_activated_date`

The profile should not depend on a CSV upload for audience membership.

## Assignment Logic

Deterministic assignment:

```txt
hash(experimentId + investorId + salt) -> 0..1 -> arm bucket
```

Requirements:

- Stable across retries.
- Same investor cannot flip arms after enrollment.
- Re-running enrollment is idempotent.
- Control rows are created and measured, but no treatment tasks are created.

Default pilot allocation:

```txt
20% control
40% script A
40% script B
```

For 300 users, this gives visible control while preserving call volume.

## Contact Policy

V1 hard rules:

- Max one call per investor unless explicitly overridden.
- No retries by default.
- Quiet hours enforced.
- Suppress wrong number.
- Suppress opt-out.
- Stop on complaint.
- Flag conduct issues.
- Cooldown rejected investors.
- Accepted-but-not-converted users should move to completion assistance later, not repitch.

## APIs

Use `apiFetch` for all frontend calls.

Proposed API routes:

```txt
GET    /api/campaigns
POST   /api/campaigns
GET    /api/campaigns/[id]
PATCH  /api/campaigns/[id]

POST   /api/campaigns/[id]/contacts/import
GET    /api/campaigns/[id]/audience/preview
POST   /api/campaigns/[id]/enroll
POST   /api/campaigns/[id]/assign

POST   /api/campaigns/[id]/launch
GET    /api/campaigns/[id]/run
POST   /api/campaigns/[id]/events
POST   /api/campaigns/[id]/analyze-transcripts

GET    /api/campaigns/[id]/results
POST   /api/campaigns/[id]/decision
```

Implementation note:

- Enrollment and assignment should be separate from launch.
- Launch should only operate on already-assigned treatment tasks.
- Control users should never pass through launch.

## UI Plan

Canonical route:

```txt
/campaigns
/campaigns/new
/campaigns/[id]/overview
/campaigns/[id]/audience
/campaigns/[id]/experiment
/campaigns/[id]/actions
/campaigns/[id]/run
/campaigns/[id]/results
/campaigns/[id]/decision
```

### Campaign Hub

List lifecycle campaigns with:

- campaign name
- dataset
- segment
- status
- enrolled count
- treatment attempted
- conversion rate
- guardrail count
- latest decision

Legacy segment-push activity can be shown as a separate "Legacy sends" section or migrated later.

### New Campaign Wizard

Steps:

1. Audience
   - Pick FundsIndia KYC recovery profile.
   - Pick or create segment.
   - Set `asOfDate`.
   - Preview eligible count.
2. Contactability
   - Import manual contact CSV.
   - Show matched, missing phone, no consent, duplicate phone, invalid phone.
3. Offer
   - Pick/create offer.
   - Define SKU/objective.
4. Experiment
   - Hypothesis.
   - OEC.
   - Guardrails.
   - Arms and allocation.
5. Voice Actions
   - Script A / Script B.
   - Voice/provider/language.
   - Gemini + Plivo only for V1.
6. Review
   - Eligible, enrolled, control, treatment, excluded.
   - Pilot warning.
   - Launch readiness.

### Run Monitor

Show:

- assignment health
- queued
- attempted
- connected
- pitched
- accepted
- rejected
- pending
- no answer
- failed
- conduct flags

### Results

Show funnel by arm:

```txt
Eligible -> Enrolled -> Assigned -> Attempted -> Connected -> Pitched -> Accepted/Pending/Rejected -> Converted
```

Show:

- control vs treatment conversion
- script A vs script B response and conversion
- absolute counts
- rates
- deltas vs control
- guardrails
- sample transcripts

Do not declare a winner in V1. Use "directional readout."

### Decision

Capture:

- ship / kill / iterate
- rationale
- learning
- next recommended test

## Voice Integration

Reuse the existing Gemini + Plivo path:

- `voice-campaign-runner.ts`
- `voice-campaign-store.ts`
- `plivo-gemini-live-bridge.ts`
- existing transcript/recording/status plumbing

Needed additions:

- Include experiment metadata in call task/config.
- Map `voiceCallId` back to `treatment_task`, `enrollmentId`, and `offerInstanceId`.
- Add transcript event extraction after call completion.
- Keep existing broad response analysis as a secondary readout.

## Transcript Event Extraction

Add a structured extractor that emits experiment events:

```txt
call_connected
sku_pitched
offer_accepted
offer_rejected
offer_pending
followup_needed
wrong_number
conduct_flag
```

Important distinction:

- `offer_accepted` is a response event.
- `kyc_completed` / `account_activated` is the business conversion event.

Do not count acceptance as conversion unless the campaign explicitly sets acceptance as the OEC.

## Edge Cases

- User remains in segment after rejection: do not re-enroll; cooldown/suppress.
- User exits segment after control assignment: keep enrollment; mark exit/conversion/ineligible.
- User qualifies again after cooldown: create a new enrollment only if re-entry policy allows it.
- Segment SQL is arbitrary: allow enrollment diffing, but require explicit conversion/exit config.
- Manual CSV has duplicate phone numbers: dedupe or mark conflict before launch.
- Manual CSV has no `investor_id`: usable only as tester pool, not real audience identity.
- Control user receives treatment event: treat as data integrity error.
- Treatment user lacks phone/consent: exclude before task creation.
- Transcript says accepted but no conversion event arrives: remain accepted/pending until attribution window expires.
- Wrong number: suppress phone and mark enrollment suppressed.
- Conduct flag: stop follow-up and surface guardrail alert.

## Implementation Phases

### Phase 1: Durable Core

- Add DB migrations in `meta-db`.
- Add lifecycle/experiment TypeScript types.
- Add repository modules.
- Add deterministic assignment helper.
- Add unit tests for assignment stability and allocation.

### Phase 2: FundsIndia Profile And Enrollment

- Add FundsIndia KYC recovery profile.
- Add eligibility evaluator.
- Add contact import.
- Add enrollment preview API.
- Add idempotent enroll/assign API.

### Phase 3: Campaign UI

- Convert `/campaigns` into lifecycle campaign hub.
- Add `/campaigns/new` wizard.
- Add campaign detail tabs/pages.
- Use monochrome, dense operational UI consistent with the repo.

### Phase 4: Voice Launch

- Create treatment tasks.
- Delegate treatment tasks to Gemini + Plivo.
- Persist call/task mappings.
- Show run monitor.

### Phase 5: Event Extraction And Results

- Add transcript event extractor.
- Ingest events into `campaign_events`.
- Compute funnel by arm.
- Add results scorecard and decision record.

## Validation

Minimum checks:

- `pnpm lint`
- targeted API tests for enrollment, assignment, launch task creation, and results aggregation
- assignment determinism test
- control users create no treatment tasks
- manual CSV import validation
- transcript extractor fixture tests
- Playwright smoke test for campaign wizard and results page

## Open Questions

- Exact OEC for first FundsIndia run: `account_activated`, `bank_verified`, or `kyc_completed`.
- Exact offer/SKU for the pilot.
- Whether script A/B differ only in script, or script plus language/voice.
- Whether the 300-phone CSV includes `investor_id`.
- Whether accepted-but-not-converted users should get a manual follow-up state in V1.

