# Voice Campaign Experimentation Conversation Notes

Date: 2026-06-02

This document captures the working conversation around Baby Sentinel / Actioneer voice campaigns, segments, audience resolution, Gemini + Plivo calling, and the campaign experimentation product scope.

## 1. Initial Codebase Understanding

The project is a demo/prototype frontend for Sentinel / Actioneer. It lets users ask natural-language questions over datasets, create segments, and trigger growth actions. The relevant systems reviewed were:

- Segments
- Voice campaigns
- Segment-to-voice workflow
- Gemini + Plivo call execution
- Post-call analysis
- Campaign experimentation and lifecycle experimentation references

### Segments

Segments are currently saved as SQL definitions plus metadata.

Key files:

- `src/lib/server/segment-repo.ts`
- `src/app/api/segments/route.ts`
- `src/app/api/segments/[id]/route.ts`
- `src/components/segments/segment-workspace.tsx`
- `src/lib/segment-compiler.ts`
- `src/app/api/segments/[id]/overview/route.ts`
- `src/app/api/segments/[id]/composition/route.ts`
- `src/app/api/segments/[id]/users/route.ts`

Current segment behavior:

- Users can create segments from chat or visual builder.
- Segment SQL is stored in SQLite.
- Segment detail APIs re-run the SQL against DuckDB for counts and previews.
- Segment workspace has a voice campaign entry point.
- Segment membership is not materialized as a stable audience table.

Important gaps found:

- Segment detail GET re-executes stored SQL through `executeSQLInternal`.
- Segment PATCH can persist SQL without validation.
- `getSegment(userId, id)` is not dataset-scoped.
- Segment descriptions are overwritten in list/sidebar display with "Segment created from chat analysis".
- Visual builder SQL aliases entity IDs as `user_id`, while datasets can use `investor_id`, `customer_id`, `borrower_id`, etc.
- Users API appears to accept search but does not apply it.

### Voice Campaigns

Key files:

- `src/app/voice-campaigns/new/page.tsx`
- `src/app/voice-campaigns/page.tsx`
- `src/app/api/voice-campaigns/route.ts`
- `src/app/api/voice-campaigns/[id]/route.ts`
- `src/app/api/voice-campaigns/[id]/launch/route.ts`
- `src/lib/voice-campaign-types.ts`
- `src/lib/voice-campaign-store.ts`
- `src/lib/voice-campaign-runner.ts`
- `src/lib/plivo-gemini-live-bridge.ts`
- `src/components/voice-campaigns/voice-campaign-studio.tsx`

Current voice campaign behavior:

- Voice campaign builder can select a segment, select/create an offer, generate a script/workflow, choose voice/provider/language, and launch test calls to manually pasted phone numbers.
- Backend validates segment and offer, saves a campaign, builds planned calls, seeds call records, and starts calls through Plivo/Gemini or Rumik/Pipecat.
- The Plivo/Gemini path opens or claims one Gemini Live WebSocket session per connected call.
- Call logs, recordings, transcripts, and response analysis exist.

Important gaps found:

- The UI implies launch to segment, but real launch to segment is not connected. It explicitly says recipient export from selected segment is not connected yet.
- Calls are launched only to manually pasted phone numbers.
- Voice campaign persistence is JSON-file backed, not transactional.
- Launch execution is fire-and-forget, not a durable scheduler.
- Campaign status is too coarse: `launching | in_progress | completed`.
- Post-call response analysis is available, but not yet structured as experiment events.

## 2. Gap Clusters

The initial 10 gaps were grouped into five clusters.

### Cluster 1: Audience And Recipient Foundation

Includes:

- True launch-to-segment is not connected.
- Dataset config lacks phone/contact/consent metadata.
- Customer context can mismatch pasted phone numbers.
- Visual-builder segment ID alias mismatch.
- Segment users search/filter cleanup.

Core question:

> Given a segment, who exactly can we call, why, with what private context, and what exclusions?

### Cluster 2: Segment Data Integrity And Safety

Includes:

- Segment SQL validation inconsistencies.
- Segment descriptions lost in list/entity catalog contexts.

Core question:

> Can every saved segment be trusted, safely re-run, clearly described, and reused by campaigns?

### Cluster 3: Campaign Runtime And Persistence

Includes:

- JSON-backed campaign store.
- Fire-and-forget launch.
- Coarse campaign lifecycle states.

Core question:

> Can campaigns survive real production conditions: retries, restarts, partial failure, pause/resume, and accurate lifecycle tracking?

### Cluster 4: Campaign Builder UX And Workflow

Includes:

- Builder implies audience launch but only supports manual/test numbers.
- Segment context should be richer and more trustworthy.
- UI should show callable count, skipped count, sample recipients, offer fit, and launch readiness.

Core question:

> Does the campaign setup page make the operator confident enough to launch?

### Cluster 5: Experimentation And Measurement

Includes:

- Campaign-level experimentation.
- Analytics on test/control per segment/campaign.
- Variants: script, offer, voice, language, timing, retry policy.
- Holdouts/control groups.
- Incrementality and downstream attribution.

Core question:

> Did this campaign actually move the metric compared to doing nothing or compared to another variant?

## 3. Audience And Recipient Foundation

The product uses mock datasets. The user does not expect customers to upload CSVs, and mock datasets should not contain real phone numbers or email IDs.

The recommended model is to separate:

```txt
segment membership
from
recipient/contact resolution
```

A segment answers:

```txt
Who qualifies?
```

A recipient resolver answers:

```txt
Which qualified users can be contacted, through what channel, under what policy, and with what private context?
```

For the mock product, the recommended modes were:

### Simulated Campaign Mode

- No real calls.
- Full 100k-scale audience simulation.
- Deterministic test/control assignment.
- Synthetic outcomes for conversions, pickup, acceptance, and revenue/AUM.
- Useful for demonstrating analytics and experimentation at scale.

### Persona Lab Mode

- 20 to 100 AI-generated conversations.
- Used for qualitative transcript variety and script testing.
- Not used as the source of statistical truth.

### Safe Live Test Mode

- Real Gemini + Plivo calls to whitelisted/internal/consented numbers only.
- Each real number can impersonate a synthetic persona.
- Segment provides mock user context; call goes to a real tester.

Key conclusion:

> Mock the contact layer, but keep the experiment math real.

## 4. Buying Phone Numbers

The user asked whether buying a database of Indian phone numbers would be viable.

Recommendation:

Do not do that.

Reasons:

- Cannot reliably prove consent for the brand, AI caller, and purpose.
- DND/consent risk.
- Complaint and carrier-blocking risk.
- Weak demo credibility.

Better alternatives:

- Internal test panel.
- Consented beta panel.
- User-testing/research participants.
- Synthetic audience plus whitelisted real numbers.
- Partner with a real business later where they provide opted-in customers.

## 5. Gemini + Plivo And Batch Calling

The current repo uses the Gemini Developer API-style WebSocket path:

```txt
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
```

with:

```txt
GOOGLE_API_KEY or GEMINI_API_KEY
```

This is not the Vertex/Agent Platform auth path as currently implemented.

The Plivo/Gemini execution flow is:

```txt
Voice campaign
-> planned calls
-> Plivo outbound call
-> Plivo media stream
-> Gemini Live WebSocket
-> transcript / recording / call status
-> response analysis
```

The current code opens or claims one Gemini Live session per connected call. It does not send one batch of calls to Gemini.

For a 100k-user segment, batch calling should be implemented as a scheduler:

```txt
queued -> dialing -> ringing -> connected -> completed -> analyzed
```

with configurable caps:

```ts
{
  maxDialStartsPerMinute: number,
  maxRingingCalls: number,
  maxConnectedGeminiSessions: number,
  dailyCallingWindow: string,
  maxAttemptsPerRecipient: number,
  retryAfterNoAnswerHours: number
}
```

Capacity formula:

```txt
active Gemini sessions ~= dial starts per minute * pickup rate * average connected minutes
```

Example:

```txt
100 starts/min
30% pickup
3 min average connected call

100 * 0.30 * 3 = about 90 active sessions
```

For pilot work:

```txt
max 5-10 concurrent calls
max 20 starts/min
one call per user
no retries initially
```

Important code issue:

- Current code prewarms Gemini Live sessions before initiating Plivo calls.
- At large scale, prewarming can waste Gemini sessions on ringing/no-answer calls.
- For scale, disable prewarm or use a very small rolling prewarm pool.

## 6. Vertex AI / Gemini Enterprise Agent Platform Notes

The user shared the new Gemini Enterprise Agent Platform docs URL and noted that old Vertex AI docs display a banner saying Vertex AI documentation is no longer updated.

Conclusion:

- The old Vertex Live API docs are useful for architecture concepts but should not be treated as the final source of current limits.
- The reliable operational answer is to read the actual project quota/rate-limit dashboard for the model/product being used.
- The app should not hardcode a concurrency number. It should use provider configuration:

```ts
{
  provider: "gemini-live",
  model: "gemini-latest-live",
  maxConcurrentSessions: env.GEMINI_LIVE_MAX_CONCURRENT_SESSIONS,
  maxSessionStartsPerMinute: env.GEMINI_LIVE_SESSION_STARTS_PER_MINUTE,
  safetyFactor: 0.7
}
```

## 7. Experimentation And Control Analytics

The core product primitive:

> A campaign is not just sent to a segment. It is an experiment over a segment, with deterministic assignment, exposed treatment users, unexposed control users, downstream outcomes, and lift analytics.

Core objects proposed:

```ts
Experiment {
  id: string
  campaignId: string
  segmentId: string
  hypothesis: string
  oecMetric: string
  guardrailMetrics: string[]
  randomizationUnit: "user" | "account"
  attributionWindowDays: number
  status: "draft" | "running" | "completed" | "stopped"
  salt: string
}

ExperimentArm {
  id: string
  experimentId: string
  type: "control" | "treatment"
  name: string
  allocationPct: number
  scriptId?: string
  skuStrategy?: string
  voiceConfig?: unknown
}

ExperimentAssignment {
  experimentId: string
  armId: string
  userId: string
  assignedAt: string
  eligible: boolean
  exclusionReason?: string
}

OfferInstance {
  id: string
  experimentId: string
  campaignId: string
  armId: string
  userId: string
  offerId: string
  skuId: string
  deeplink: string
  status: "assigned" | "pitched" | "accepted" | "rejected" | "converted"
}
```

The most important object is `ExperimentAssignment`. Without stable assignment, there is no trustworthy test/control analytics.

Assignment should be deterministic:

```txt
hash(experimentId + userId + salt) -> arm
```

Control users:

- Are qualified for the segment.
- Are eligible for campaign.
- Are intentionally not called.
- Are still tracked for downstream conversion.

## 8. Actioneer And Rumik Responsibility Split

The user provided a spec where:

Actioneer owns:

- User segmentation.
- Offer creation.
- Deep-link management.
- Experimentation infrastructure.
- Reporting / BI layer.

Rumik owns:

- Voice agents for calling.
- Trigger WhatsApp after call completion.

Refinement:

> Actioneer owns who to call, what to offer, what link to send, and whether it worked. Rumik owns the spoken interaction and post-call WhatsApp delivery.

Important correction:

The experimentation/BI layer cannot have "no interface with Rumik". Actioneer must ingest Rumik events to calculate delivery, pitch, offer delivery, acceptance, conversion, and breakage diagnostics.

The recommended ID model:

```txt
sku_id
offer_id
offer_instance_id
```

`offer_instance_id` is the per-user assignment key that stitches call, WhatsApp, deeplink, acceptance, and conversion.

Required Rumik events:

```txt
call_attempted
call_connected
sku_pitched
offer_accepted
offer_rejected
offer_pending
whatsapp_triggered
whatsapp_delivered
deeplink_clicked
call_failed
call_no_answer
call_limit_reached
policy_blocked
```

Each event should include:

```ts
{
  eventId: string,
  eventType: string,
  timestamp: string,
  userId: string,
  campaignId: string,
  experimentId: string,
  armId: string,
  offerInstanceId: string,
  metadata: Record<string, unknown>
}
```

## 9. Narrowing Scope To Gemini + Plivo

The user then decided to focus on the Gemini + Plivo flow first.

In that scope, Actioneer owns everything:

```txt
segmentation
experiment assignment
call execution
transcript analysis
WhatsApp/deeplink later
reporting
```

Rumik is out of scope for this phase.

Minimum Gemini + Plivo experiment pilot:

```txt
/experiments/new
-> paste/import 300 users
-> choose campaign + scripts
-> assign users
-> launch treatment calls through Plivo/Gemini
-> collect transcripts/status
-> run response analysis
-> show experiment results
```

What to build:

1. Pilot audience upload/paste.
2. Experiment setup.
3. Sticky assignment.
4. Per-user offer instance.
5. Gemini prompt personalization.
6. Call launch scheduler.
7. Transcript-derived event extraction.
8. Results dashboard.

Transcript-derived events for now:

```txt
call_connected
sku_pitched
offer_accepted
offer_rejected
offer_pending
followup_needed
conduct_flag
```

## 10. The 300-User E2E Pilot

The user has a list of 300 real users/numbers and wants to demo/test the end-to-end product.

Primary goal:

```txt
segment -> experiment setup -> random assignment -> Gemini + Plivo calls -> transcript analysis -> event ingestion -> dashboard -> decision record
```

This should be framed as an E2E pilot, not a statistically conclusive experiment.

Recommended split options:

```txt
50 control
125 treatment A
125 treatment B
```

or:

```txt
60 control
120 treatment A
120 treatment B
```

Reason:

- Control exists visibly.
- Most users produce real call/event volume.
- Two variants demonstrate the full experimentation engine.

UI should label results:

```txt
Pilot mode: Directional readout. Not powered for statistical significance.
```

For 300 users, small percentage-point lifts cannot be proven. The pilot proves orchestration and directional analytics.

Minimum data per user:

```ts
{
  userId: string,
  phoneNumber: string,
  name?: string,
  segmentAttributes?: Record<string, unknown>,
  targetSkuId?: string,
  targetSkuDescription?: string,
  preferredLanguage?: string,
  riskFlags?: string[]
}
```

Hard guardrails for real numbers:

```txt
max 1 call per user
quiet hours only
no retry for pilot unless explicitly approved
complaint / opt-out hard stop
wrong-number tracking
max call duration
max turns
mis-selling / false-claim flag
```

## 11. Current State Vs Required Buildout

Current system has:

- Segments.
- Voice campaign builder.
- Offer selection/creation.
- Script/workflow generation.
- Manual phone-number launch.
- Plivo/Gemini execution.
- Call logs/transcripts/recordings.
- Response analysis.

Missing for full experimentation:

1. Pilot audience store.
2. Experiment data model.
3. Sticky assignment engine.
4. Offer instance / deeplink attribution.
5. Experiment-aware Gemini/Plivo call tasks.
6. Event ingestion/extraction.
7. Experiment dashboard.
8. Pilot-mode statistics.
9. Guardrail system.
10. Experiment repository.

Shortest E2E build:

1. Admin audience import/paste for 300 users.
2. Experiment creation on top of voice campaign.
3. Sticky assignment: control / treatment A / treatment B.
4. Per-user `offerInstanceId`.
5. Gemini + Plivo launch for treatment users only.
6. Transcript-derived event extraction.
7. Experiment results dashboard.
8. Decision record.

## 12. Experiment Lifecycle From Playbook

The user provided `/Users/vimarsh/Downloads/Documents/campaign-experimentation-playbook.md`.

Key lifecycle:

```txt
Form a hypothesis
-> define OEC and guardrails
-> choose randomization unit
-> power-analyze for sample size and duration
-> assign randomly and stickily
-> run while monitoring SRM and guardrails
-> analyze for significance, confidence, and segment effects
-> decide to ship, kill, or iterate
-> document the result
```

This should become the backbone of the Actioneer experimentation layer.

Important adaptations for voice campaigns:

- OEC should be campaign economics, e.g. incremental revenue, incremental AUM, accepted offer, SKU conversion.
- Guardrails are non-negotiable in financial services.
- Randomization unit should usually be customer/user/account.
- Assignment must be sticky.
- SRM and guardrails are monitored during the run.
- Primary metric should not be over-peeked.
- With 300 users, show directional pilot readout.
- Results should be captured in a repository as institutional learning.

## 13. Product And Lifecycle Experimentation References

The research split into two groups:

### Product Experimentation Platforms

Useful for rigor:

- Statsig
- Eppo
- GrowthBook
- Amplitude Experiment
- Optimizely
- LaunchDarkly

Concepts to copy:

- Hypothesis-first setup.
- Exposures/assignment health before scorecard.
- Primary and secondary metric split.
- Confidence/credible intervals.
- Layers / mutual exclusion.
- Decision discipline.

### Customer Lifecycle Experimentation Platforms

Useful for journey orchestration:

- Braze Canvas
- Adobe Journey Optimizer
- Customer.io Journeys
- Salesforce Journey Builder
- CleverTap
- MoEngage
- Iterable
- Bird holdouts

Concepts to copy:

- Journey/path experimentation.
- Random cohort branches.
- Campaign/journey control groups.
- Holdouts for incrementality.
- Channel/cadence/content testing.
- Conversion/revenue reporting.

Product direction:

> Actioneer should not be "Statsig for campaigns" or "Braze with voice". It should be a lifecycle experimentation engine for revenue campaigns where voice is the primary treatment channel.

Unique Actioneer funnel:

```txt
Eligible
-> Assigned
-> Attempted
-> Connected
-> Pitched SKU
-> Accepted / Rejected / Pending
-> Deeplink sent
-> Converted
-> Incremental revenue / AUM
```

## 14. Proposed Product Scope

The full product can be scoped into eight modules.

### 1. Audience And Eligibility

- Segment source.
- Contactable user list.
- Consent, quiet-hours, frequency-cap checks.
- Exclusions and suppression.
- For the 300-user pilot: manual audience import/paste is enough.

### 2. Experiment Design

- Hypothesis.
- OEC.
- Guardrails.
- Randomization unit.
- Arms: control, variant A, variant B.
- Attribution window.
- Pilot warning when underpowered.

### 3. Sticky Assignment

- Deterministic hash assignment.
- Frozen assignment log.
- Control users tracked but not called.
- Treatment users become call tasks.
- Later: mutual exclusion/layers and global holdout.

### 4. Offer And Deeplink Layer

- SKU repository.
- Per-user `offerInstanceId`.
- Deeplink attribution.
- Status: assigned, pitched, accepted, sent, clicked, converted.

### 5. Voice Treatment Layer

- Script variants.
- Gemini + Plivo execution.
- Call limits.
- Guardrails.
- Transcript and recording capture.
- Transcript analysis for pitch, acceptance, rejection, objections, and conduct issues.

### 6. Run Monitor

- Assignment health.
- SRM check.
- Call queue.
- Attempted, connected, completed.
- Failures/no-answer.
- Guardrail alerts.
- No primary metric "winner" peeking in strict mode.

### 7. Results Scorecard

- Funnel by arm.
- Control vs treatment.
- Variant A vs B.
- Directional lift for pilot.
- Confidence/credible interval later.
- Incremental revenue/AUM.
- Breakdown by persona, language, SKU, objection, call outcome.

### 8. Experiment Repository

- Hypothesis.
- Setup.
- Assignment.
- Results.
- Decision: ship, kill, iterate.
- Learning captured for reuse.

## 15. V1 For 300-User E2E Demo

Do not build the full journey canvas yet.

Build:

```txt
Experiment setup
-> paste/import 300 users
-> define control / script A / script B
-> sticky assignment
-> launch treatment calls through Gemini + Plivo
-> analyze transcripts
-> show funnel + directional lift
-> save decision card
```

Recommended V1 screens:

### 1. Experiment Setup

- Campaign.
- Hypothesis.
- Segment/audience.
- Offer/SKU.
- OEC.
- Guardrails.
- Arms and allocation.

### 2. Audience Assignment

- Total users.
- Eligible users.
- Control users.
- Treatment A users.
- Treatment B users.
- Exclusions.
- SRM status.

### 3. Launch Monitor

- Queue.
- Attempted.
- Ringing.
- Connected.
- Completed.
- Failed/no-answer.
- Transcript analysis status.
- Guardrail alerts.

### 4. Results

- Funnel by arm.
- Control vs treatment.
- Script A vs B.
- Directional lift.
- Incremental revenue/AUM estimate.
- Sample calls/transcripts.
- Guardrail status.

### 5. Decision

- Ship.
- Kill.
- Iterate.
- Notes.
- Next recommended experiment.

## 16. Deferred Scope

Defer for now:

- Multi-armed bandits.
- Contextual bandits.
- Global holdouts.
- Full journey canvas.
- Power calculator.
- CUPED.
- Cross-client benchmarks.
- Automated winner rollout.
- Advanced mutual exclusion layers.
- Rumik integration.
- Real WhatsApp/deeplink fulfillment, unless needed for the pilot.

## 17. Current Recommended Next Step

Since the immediate focus is Gemini + Plivo, the next concrete step is to design the V1 experiment engine in the repo:

```txt
data model
API routes
assignment logic
launch queue
Gemini/Plivo treatment calls
transcript event extraction
experiment dashboard
decision record
```

This should be scoped to the 300-user E2E pilot and should explicitly label results as directional.

## 18. Dynamic Segment Lifecycle Model

A major product clarification:

> A dynamic segment is not a call list. It is an eligibility signal.
> A lifecycle campaign turns that signal into stateful user enrollment, experiment assignment, contact policy, outcomes, cooldowns, and learning.

For a dynamic segment such as:

```txt
Users who browsed products but never completed KYC
```

the end-to-end product flow should be:

```txt
Insight discovered
-> dynamic segment created
-> lifecycle campaign created
-> experiment configured
-> users enrolled as they qualify
-> users assigned once
-> treatment users called
-> outcomes observed
-> next action decided per user
-> aggregate lift measured
-> learning saved
```

The core product object becomes `LifecycleEnrollment`.

```ts
LifecycleEnrollment {
  userId: string
  segmentId: string
  campaignId: string
  experimentId: string
  armId: string
  firstQualifiedAt: string
  currentState: string
  offerInstanceId?: string
  lastTouchAt?: string
  cooldownUntil?: string
  exitReason?: string
}
```

So when a user browses a product and has incomplete KYC, they enter the dynamic segment. After that, the lifecycle campaign owns their state.

### User Lifecycle States

The user should move through states such as:

```txt
qualified
-> enrolled
-> assigned_control / assigned_treatment
-> queued
-> attempted
-> connected
-> pitched
-> accepted / rejected / pending / no_answer
-> converted / expired / cooldown / suppressed
```

Hard exits:

```txt
completed_kyc
opted_out
wrong_number
complaint
ineligible
```

This prevents bad behavior like:

```txt
Still in segment today -> call again
Still in segment tomorrow -> call again
```

Instead, the system should always answer:

```txt
What have we already done with this user?
What happened?
What is the next allowed action?
```

### Retargeting Rules

Users should not be targeted repeatedly just because they remain in the dynamic segment. Retargeting must be governed by explicit policy.

If the user was `no_answer`, they were not truly exposed. A retry can be reasonable:

```txt
retry once after 24h
then cooldown 7-14 days
```

If the user was `connected_not_pitched`, they may have been busy:

```txt
retry after 3-7 days
or send softer WhatsApp follow-up
```

If the user was `pitched_pending`, retargeting is valuable:

```txt
send KYC deeplink
wait 48h
send one reminder
then cooldown
```

If the user was `pitched_rejected`, avoid repeated pressure:

```txt
cooldown 30-60 days
or suppress from this offer
```

If the user accepted but did not complete KYC, do not repitch. Move to completion assistance:

```txt
help them finish the abandoned KYC step
```

If the user browses again after cooldown, that is new intent. They can re-enter, but as a new enrollment or offer instance, not an accidental repeat call.

### Experimentation Nuance For Dynamic Segments

Dynamic lifecycle campaigns can break experiments if state is not controlled.

Control users must stay untouched for the attribution window:

```txt
assigned_control
-> observe natural KYC completion
-> no call
```

Treatment users get the designed path:

```txt
variant A: call script A
variant B: call script B
```

If the experiment tests script, both variants must share the same retry and cooldown policy. Otherwise the experiment is testing script plus cadence.

If cadence is the actual question, cadence should be explicit:

```txt
Control: no touch
A: one call
B: call + WhatsApp reminder after 48h
```

The platform should make this explicit in experiment setup.

### Product Screens For Dynamic Lifecycle

#### 1. Insight Card

- "KYC dropoff opportunity found"
- Segment size
- Recent entrants
- Expected daily entrants
- Suggested campaign: KYC completion nudge

#### 2. Dynamic Segment Page

- Entry rule: browsed product and KYC incomplete
- Exit rule: completed KYC
- Re-entry rule: new browse after cooldown
- Current members
- New entrants
- Exited users

#### 3. Lifecycle Campaign Setup

- Offer/SKU
- KYC deeplink
- Call objective
- Contact policy
- Cooldown policy
- Suppression rules

#### 4. Experiment Setup

- Hypothesis
- OEC: KYC completion within 7 days
- Guardrails: opt-out, complaint, wrong number, conduct flag
- Arms: control, script A, script B
- Assignment unit: user

#### 5. Enrollment Monitor

- Qualified
- Enrolled
- Excluded
- Control
- Queued for call
- Cooldown
- Exited

#### 6. Run Monitor

- Attempted
- Connected
- Pitched
- Accepted
- Pending
- Rejected
- No-answer retry queue
- Guardrail alerts

#### 7. Results Scorecard

- Funnel by arm
- KYC completion by arm
- Treatment vs control lift
- Variant comparison
- Outcome by lifecycle state
- Directional/powered status

#### 8. User Timeline

For a single user, show:

```txt
browsed product
qualified for KYC campaign
assigned variant B
called
accepted deeplink
did not complete KYC
reminder sent
completed KYC
exited campaign
```

### Additional Modules Needed For Dynamic Segments

The eight core product modules remain:

```txt
Audience And Eligibility
Experiment Design
Sticky Assignment
Offer And Deeplink Layer
Voice Treatment Layer
Run Monitor
Results Scorecard
Experiment Repository
```

Dynamic lifecycle adds:

```txt
Dynamic segment evaluator
Lifecycle enrollment store
Contact policy engine
Cooldown/suppression store
Re-entry rules
User timeline
Streaming enrollment monitor
```

### V1 Recommendation

For the first E2E demo, do not build full streaming automation yet. Build the engine with dynamic semantics, but run it as a controlled snapshot:

```txt
300 users who browsed product and have incomplete KYC today
-> freeze cohort
-> assign control / A / B
-> call treatment users once
-> observe 7-day KYC completion
-> show directional lift
```

Then V1.1 becomes true dynamic lifecycle:

```txt
new users qualify every day
-> enroll once
-> assign once
-> apply contact policy
-> cooldown/re-entry
-> ongoing experiment reporting by enrollment cohort
```

This progression is safer and clearer. It proves the product loop first, then turns it into a real lifecycle automation engine.
