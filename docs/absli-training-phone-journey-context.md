# ABSLI Phone Training Journey Context

Created: 2026-07-06

This document captures the product and engineering context for rebuilding `/training` around ABSLI phone-based SP/RO training. It combines repo analysis, the Actioneer x ABSLI meeting summary, the proposition-call notes, and the current voice campaign / Plivo / Gemini implementation.

## Working Thesis

`/training` should not feel like "upload a document and generate roleplay JSON."

The product should feel like a training operations console for ABSLI managers who need thousands of field reps to execute a product-specific sales motion safely before they speak to real customers.

For the current pilot, the concrete job is:

> Train and assess SPs and ROs on Anmol Akshaya using phone calls where Actioneer's voice agent plays a realistic customer, records the call, transcribes it, scores the trainee, and shows managers readiness gaps.

The training call is not a browser demo. The training call happens on the phone using the same Plivo + Gemini voice infrastructure as voice campaigns, but with the agent role inverted.

## Business Context

ABSLI is operating inside HDFC Bank's bancassurance environment.

Important ground facts:

- HDFC Bank sells life insurance from multiple partners: HDFC Life, Tata AIA, and Aditya Birla Sun Life.
- HDFC Life has internal advantage and quota pressure, so ABSLI needs sharper execution when it does get airtime.
- ABSLI has a large field motion with roughly 1,000 SPs and 4,000 ROs in the broader operating context.
- The bank owns the lead and daily product push. ABSLI cannot fully control lead allocation.
- ROs under-report leads because their LCR looks bad if every weak lead is entered into CRM.
- A certified SP / LG must explain the product and obtain consent before entering a lead.
- BOAT / IVC / PIVC are downstream verification steps, with high-volume sub-5L policies and high-value human-assisted above-5L policies.
- Guardrails are critical. Rajeev described a real incident where a salesperson used generic AI to fabricate a fake product feature, leading to escalation and termination.

The training piece is therefore a risk-control and productivity lever:

- Make SPs explain the product correctly.
- Make ROs handle warm leads and objections without overpromising.
- Make both roles stay inside approved product facts.
- Give managers a readiness view before reps engage real customers.
- Use recorded real calls later to improve training scenarios.

## Roles Being Trained

### SP / LG

SP stands for Specified Person. This is the branch-first-contact role.

Primary job:

- Meet the customer in branch.
- Explain the product from scratch.
- Discover customer need.
- Capture explicit consent before entering the lead.
- Set expectation for the RO / BOAT / follow-up journey.

Critical failure modes:

- Jumps into pitch without need discovery.
- Uses jargon the customer does not understand.
- Promises fixed or guaranteed high returns.
- Confuses Anmol Akshaya with ULIP, mutual fund, FD, or market-linked product.
- Enters or advances a lead without customer consent.

### RO

RO stands for Relationship Officer. This is warm follow-up after branch interest.

Primary job:

- Re-establish context.
- Confirm permission to talk.
- Handle returns, lock-in, product-fit, and trust objections.
- Stay consistent with what the SP correctly explained.
- Correct any mistaken SP/customer memory without inflating the product.
- Earn the next concrete step: callback, appointment, BOAT/PIVC, or application continuation.

Critical failure modes:

- Launches into pitch without context.
- Amplifies a bad prior claim from the SP.
- Contradicts the approved explanation.
- Converts illustrative assumptions into guaranteed returns.
- Ends vaguely without a next step.

## The Training Call

The training call is the core event.

Before the call:

- Manager chooses product, role, scenario, persona, language, difficulty, and trainee cohort.
- Ground truth is locked from approved brochure / compliance facts / trainer notes.
- The system composes a phone-call prompt where the AI is the customer, not the advisor.
- The system stores enough call metadata to score the transcript after the call.

During the call:

- Actioneer calls the trainee's phone number via Plivo.
- Gemini Live powers the AI voice agent.
- The AI plays the customer persona.
- The trainee speaks naturally as SP or RO.
- The customer persona actively tests the trainee through objections and compliance traps.
- The call is recorded and transcribed.

After the call:

- The transcript is mapped to trainee/customer turns.
- The scorer grades exact evidence against the role rubric.
- Compliance gates dominate the outcome.
- The manager sees pass/fail, score, failed gates, evidence quotes, and coaching notes.

The phone call sits inside the broader product loop:

```text
Training Program Setup
        -> Ground Truth Approval
        -> Role Modules
        -> Persona / Scenario Selection
        -> Trainee Cohort Assignment
        -> Phone Training Calls
        -> Recording + Transcript
        -> Scorecard + Coaching
        -> Manager Readiness Dashboard
        -> Real-Call Feedback Loop
```

## End-to-End Product Flow

### 1. Create Training Program

The manager creates a program such as:

- "Anmol Akshaya SP Certification"
- "Anmol Akshaya RO Warm Lead Follow-up"
- "HDFC Bancassurance Karnataka RO Objection Handling"

Core fields:

- Product: Anmol Akshaya
- Role: SP, RO, or both
- Program type: Learn, Practice, Assessment, Certification
- Region / branch / cohort
- Language mix
- Difficulty
- Target outcome

### 2. Lock Product Ground Truth

The manager provides or selects approved material:

- Brochure
- Product facts
- Compliance notes
- Mandatory disclosures
- Forbidden claims
- Existing pitch scripts
- Example good calls
- Example failed calls

The system extracts:

- What reps may say.
- What reps must say.
- What reps must not say.
- Product category and boundaries.
- Objections likely to occur.
- Role-specific pass gates.

This needs a human approval moment. The manager should feel they are approving the training pack, not editing internal LLM output.

### 3. Build Role Modules

SP module:

- Need discovery
- Product explanation
- Jargon simplification
- Consent capture
- Handoff setup

RO module:

- Context reset
- Permission to continue
- Objection handling
- Carry-forward consistency
- Close / next step

### 4. Generate Customer Situations

The system creates realistic call situations:

- FD-renewal branch walk-in who wants safe child-future planning.
- Warm lead who thinks 8 percent return is guaranteed.
- Customer confused between participating plan, ULIP, mutual fund, and FD.
- Customer asks whether HER benefits mean instant fixed cash.
- Busy customer who gives the RO only 60 seconds.
- Customer says "SP ne kuch aur bola tha" to test carry-forward consistency.

Each situation should contain:

- Persona
- Customer opening line
- Language
- Difficulty
- Objections
- Compliance traps
- Expected good response
- Scoring gates

### 5. Trainer Review

The trainer reviews the program in business language:

- What will SPs be trained on?
- What will ROs be trained on?
- Which customer personas will they face?
- Which claims are forbidden?
- Which disclosures are mandatory?
- What fails the assessment?
- Which languages are covered?

This should not expose the current internal vocabulary as the primary interface:

- `spine`
- `roleModule`
- `traps`
- `rubric`
- `personas`

Those are useful implementation concepts, not the trainer's mental model.

### 6. Assign Trainees

The manager selects or uploads:

- SP names and phone numbers
- RO names and phone numbers
- Branch
- Region
- Manager
- Language preference
- Role

For the pilot, a pasted list of trainee phone numbers may be enough. For a scaled ABSLI workflow, cohort and manager metadata become important.

### 7. Preview The Training Call

The trainer should be able to run a preview before launching:

- Browser preview for fast internal testing.
- Phone preview to the trainer's own phone for real voice behavior.

The preview is not the main product. It is quality control before trainee calls go out.

### 8. Launch Phone Training Calls

The system starts phone calls to trainees.

Call modes:

- Practice: scored lightly or not scored, repeatable.
- Assessment: graded, saved, manager-visible.
- Certification: pass/fail gates decide readiness.

The voice agent must be framed correctly:

```text
Voice campaign:
  AI = advisor
  Human = real customer
  Goal = conversion / callback / link / lead action

Training:
  AI = simulated customer
  Human = SP or RO trainee
  Goal = readiness / compliance / coaching
```

### 9. Score And Coach

Each training call should produce:

- Recording
- Transcript
- Overall score
- Pass/fail
- Failed gates
- Evidence quote
- Ground-truth reference
- Strengths
- Improvements
- Recommended retry scenario

Compliance gates should be asymmetric:

- A trainee fails if they actually make a prohibited claim.
- A trainee also fails required gates if they do not affirmatively do required actions like consent capture.
- Smooth delivery should not rescue a false claim.

### 10. Manager Readiness Dashboard

The manager needs operational answers:

- Which SPs are ready?
- Which ROs are ready?
- Who failed consent capture?
- Who failed carry-forward consistency?
- Who overpromised returns?
- Which branches or regions need retraining?
- Which language cohorts are struggling?
- Which objections are hardest?

### 11. Real-Call Feedback Loop

After trainees go live, selected real calls can be transcribed weekly.

The system should learn:

- Which false claims are still appearing.
- Which objections occur most often.
- Which SP-to-RO handoff issues recur.
- Which customer segments need new scenarios.
- Which scripts work by branch, language, and persona.

This closes the loop:

```text
Training -> Real Calls -> Analysis -> Better Training
```

## How Current Voice Campaign UI Can Be Reused

The existing voice campaign UI is valuable as the call operations chassis, not as the final product language.

Mapping:

| Voice Campaign UI | Training UI |
| --- | --- |
| Campaign | Training Program |
| Customer segment | Trainee cohort |
| Campaign purpose | Training objective |
| Script | Scenario + persona behavior |
| Audience phone numbers | SP / RO trainee phone numbers |
| Live test | Trainer preview |
| Phone test | Trainer phone preview |
| Launch campaign | Start training calls |
| Call analytics | Readiness scorecards |
| Positive outcome | Passed assessment |
| Guardrail violation | Compliance failure |

What to reuse:

- Program/campaign creation shell.
- Prompt generation and preview infrastructure.
- Voice/language selectors.
- Phone-number audience input.
- Browser preview.
- Phone test path.
- Plivo launch path.
- Call transcript/recording display.
- Post-call analysis layout patterns.

What to replace:

- "Segment" language.
- "Campaign purpose" language.
- Customer-conversion metrics.
- Sales advisor prompt framing.
- Campaign outcome classifier as the main score.

What to add:

- Training program model.
- Role-specific trainee cohort model.
- Scenario/persona picker.
- Training call config.
- Roleplay scoring pipeline after Plivo calls.
- Manager readiness dashboard.

## Current Code Understanding

### Voice Campaign Phone Runtime

Main runtime path:

```text
Voice campaign UI / hooks
        -> /api/voice-campaigns/*
        -> voice-campaign-store / voice-call-state
        -> startPlannedVoiceCalls()
        -> initiatePlivoCall()
        -> /api/voice/plivo-answer
        -> Plivo <Stream>
        -> /plivo-media-stream/:callId
        -> handlePlivoGeminiLiveMediaStream()
        -> transcript / recording / analysis
```

Important files:

- `server.ts`
- `src/lib/voice-campaign-runner.ts`
- `src/lib/voice-campaign-flow.ts`
- `src/lib/voice-campaign-store.ts`
- `src/lib/voice-call-state.ts`
- `src/features/integrations/server/providers/plivo/client.ts`
- `src/app/api/voice/plivo-answer/route.ts`
- `src/app/api/voice/plivo-status/route.ts`
- `src/lib/plivo-gemini-live-bridge.ts`

The phone bridge is production-grade relative to the browser bridge:

- Plivo bidirectional stream.
- Gemini Live websocket.
- μ-law to PCM conversion.
- Prewarm.
- Indian language directive.
- VAD and interruption behavior.
- Screening / voicemail handling.
- Transcript persistence.
- Stereo bridge recording.
- Tool calls such as `send_link`.
- Disconnect handling.
- Post-call analysis hooks.

### Browser Live Test Runtime

Current `/training` uses the browser live test:

```text
VoiceTestPanel
        -> /voice-test-stream
        -> handleVoiceTestStream()
        -> Gemini Live
        -> browser transcript callback
        -> /api/roleplay/score
```

Important files:

- `src/components/voice-campaigns/voice-test-panel.tsx`
- `src/lib/voice-test-bridge.ts`

This path is useful for trainer preview, but it is not the final training-call product.

### Current Roleplay / Training Implementation

Current `/training` path:

```text
/training
        -> ingest URL/file
        -> save in-memory draft
        -> /training/draft/:id
        -> generate roleplay scenario bundle
        -> save in-memory scenario
        -> /training/scenario/:id
        -> Learn / Practice / Assess through browser VoiceTestPanel
        -> score browser transcript
```

Important files:

- `src/app/training/page.tsx`
- `src/app/training/draft/[id]/page.tsx`
- `src/app/training/scenario/[id]/page.tsx`
- `src/components/training/scenario-editor.tsx`
- `src/components/training/scorecard-view.tsx`
- `src/features/roleplay/roleplay-datasets.ts`
- `src/features/roleplay/roleplay-ingest.ts`
- `src/features/roleplay/roleplay-generator.ts`
- `src/features/roleplay/roleplay-scenario.ts`
- `src/features/roleplay/roleplay-scorer.ts`
- `src/features/roleplay/roleplay-draft-store.ts`
- `src/features/roleplay/roleplay-scenario-store.ts`
- `src/app/api/roleplay/*`

Important behavior:

- `/training` is gated to `absli-life`.
- APIs also enforce the dataset gate.
- Drafts and saved scenario bundles are in-memory `globalThis` maps.
- Scenario generation and scoring use `generateJson`, currently OpenAI-backed through `src/lib/llm.ts`.
- Spoken live sessions use Gemini Live.
- `roleplay-anmol-akshaya.ts` contains hand-authored seed Anmol Akshaya scenarios/facts, but nothing imports it today.
- The ABSLI dataset config powers analytics context, but `/training` does not currently query DuckDB.

## Product Gap In Current `/training`

Current UI exposes the construction mechanics:

- Fetch source.
- Review raw markdown-ish extracted text.
- Generate scenarios.
- Edit coverage/traps/rubric/personas.
- Run browser call.

This is a builder for internal authors, not a workflow for an ABSLI training manager.

The desired UI should expose operational concepts:

- Training program.
- Product ground truth.
- Role module.
- Customer simulation.
- Trainee cohort.
- Phone training calls.
- Readiness.
- Compliance risk.

## Likely First Redesign Target

The first usable redesign should turn `/training` into a phone-training program builder.

Suggested first screen structure:

1. Header
   - Training
   - "Anmol Akshaya phone training for SPs and ROs"
   - Primary action: New training program

2. Program list / current program
   - Program name
   - Product
   - Roles
   - Assigned trainees
   - Calls completed
   - Pass rate
   - Failed gates

3. Create program flow
   - Step 1: Product and role
   - Step 2: Ground truth
   - Step 3: Scenarios
   - Step 4: Trainees
   - Step 5: Preview
   - Step 6: Launch phone calls

4. Program detail
   - Overview
   - Ground truth
   - SP module
   - RO module
   - Scenarios
   - Trainees
   - Training calls
   - Scorecards

## Engineering Direction

Short-term pragmatic path:

- Reuse existing roleplay scenario composition for customer/coach prompts.
- Reuse existing voice campaign phone-call launch mechanics.
- Add a training-specific wrapper that creates call configs where the AI is the customer.
- Store training metadata on the call config and/or a new training program store.
- After phone call completion, run the roleplay scorer on the persisted transcript.
- Show the result in training-specific scorecards.

Avoid for the first pass:

- A full new telephony stack.
- A completely separate voice bridge.
- A generic training marketplace.
- Over-building trainee assignment imports before the phone-call loop works.

Needed conceptual model:

```ts
TrainingProgram
  id
  datasetId = "absli-life"
  productLabel
  roles: Array<"SP" | "RO">
  groundTruth
  scenarios
  trainees
  calls
  status

TrainingCall
  id
  programId
  traineeId
  traineeRole
  mode: "practice" | "assessment" | "certification"
  scenarioId
  personaId
  callConfigId
  providerRequestId
  status
  transcript
  recording
  scorecard
```

The first technical decision is whether to:

1. Extend `VoiceCampaign` with training tags and metadata.
2. Create a new `TrainingProgram` store while reusing only the dialer/bridge/call-state primitives.

The cleaner product model is option 2. The fastest prototype may use option 1 internally, but the UI should not expose campaign language.

## Open Questions

- Does the pilot require SP and RO calls in the same program, or separate programs?
- Should a trainee get Learn mode by phone, or only Practice/Assessment by phone?
- Should the AI call trainee immediately, or should the trainee schedule/start their own assessment call?
- What is the first cohort input: paste phone numbers, upload CSV, or hardcoded demo list?
- Do we need manager hierarchy in v1: branch, CM, CRH, AZRH, zonal head?
- Should scorecards be durable beyond the current demo process memory?
- Should Anmol Akshaya be preloaded as an approved product pack instead of requiring upload every time?

## North Star

The finished `/training` journey should make this easy:

> "I am an ABSLI manager. I choose Anmol Akshaya, select SP and RO modules, approve the product facts and compliance gates, add my trainee phone numbers, preview the AI customer, launch assessment calls, and see who is ready to talk to real customers."

