# Sentinel Action Layer and Voice Agent Integration PRD

Status: Draft  
Date: 2026-06-24  
Scope: Main Sentinel product, not the Baby Sentinel prototype  
Primary v1 channel: Outbound voice campaigns using Gemini Live API  

## 1. Executive Summary

Sentinel already has the core intelligence foundation: CDP-style customer data, segmentation, context retrieval, and connectors into warehouses and downstream systems. The missing layer is an action system that can take an insight or segment and safely execute customer-facing workflows across channels.

This PRD defines the v1 action layer with voice agents as the first execution channel. Voice is not a standalone product. It is one action runtime attached to Sentinel's CDP, context, campaign, governance, and attribution layers.

The v1 system should let a Sentinel user:

1. Select or generate an audience from CDP segments.
2. Define an action campaign with a goal, offer, success metric, guardrails, holdout, and voice agent flow.
3. Materialize audience members into durable action jobs.
4. Execute outbound calls through a telephony provider and Gemini Live.
5. Allow the live voice agent to call approved realtime tools during the call.
6. Persist every call event, transcript, tool call, outcome, follow-up, and attribution event back into Sentinel.
7. Write summaries and outcomes back to CRM/CLM systems.

The v1 deployment model is cloud or hybrid-context. Because Gemini Live is a cloud-hosted realtime model endpoint, v1 does not provide fully on-prem voice inference. For customers with residency requirements, v1 should support regional Google Cloud deployment where the selected Gemini Live model and region are supported, and a hybrid pattern where the warehouse/CDP stays on-prem while only minimized, approved context packets are sent to the voice runtime.

## 2. Problem Statement

Sentinel can identify audiences and explain what is happening, but the product does not yet own the path from insight to customer action. Today, the user still needs to export a segment, configure another tool, write a message/call script elsewhere, manually track outcomes, and reconcile results back into analytics.

That gap causes three problems:

1. Insights do not reliably turn into action.
2. Actions executed outside Sentinel lose context, guardrails, attribution, and learning loops.
3. Voice agents cannot safely use Sentinel's customer context unless there is a clear runtime contract, permission model, and audit trail.

The desired product shift is:

```text
Insights and segments
  -> governed action campaigns
  -> durable recipient jobs
  -> channel runtimes
  -> outcomes and attribution
  -> learnings back into CDP and analytics
```

## 3. Goals

### 3.1 Product Goals

- Make "act on this segment" a first-class Sentinel workflow.
- Launch voice campaigns from any CDP segment, generated audience, or user list.
- Let users define campaign goal, success metric, offer, voice script, approved tools, and holdout/control design.
- Give operators a live execution console for campaign status, calls, failures, retries, and outcomes.
- Persist a complete action ledger per recipient.
- Tie call outcomes to downstream conversion events and revenue.
- Support post-call CRM/CLM writeback with transcript, summary, disposition, and follow-up status.

### 3.2 Engineering Goals

- Introduce a channel-agnostic action layer, with voice as the first channel.
- Keep voice runtime isolated from raw warehouse access.
- Use a typed context packet contract for call-time personalization.
- Use a realtime tool gateway for live-call actions.
- Make every external side effect idempotent, auditable, and replayable.
- Separate live-call runtime from post-call deterministic processing.
- Support cloud and hybrid-context deployment in v1.
- Make provider substitution possible by abstracting telephony, realtime model, messaging, and CRM connectors.

## 4. Non-Goals for V1

- Fully on-prem voice inference.
- A generalized journey builder for every channel and branching workflow.
- Inbound support center replacement.
- Human call-center workforce management.
- Real-time bidding or spend optimization.
- Autonomous campaign generation without explicit user approval.
- Arbitrary agent tool access to warehouse, CRM, billing, or internal systems.
- Full MCP-first architecture. MCP compatibility can be exposed later, but v1 should build the internal tool gateway first.

## 5. Current Foundation

The main Sentinel architecture already provides the core upstream layers this feature should use:

| Layer | Current responsibility | How action layer uses it |
| --- | --- | --- |
| CDP | Customer identities, traits, events, segments, cohorts | Defines who can be acted on and why they qualify |
| Context layer | Customer and business context retrieval | Produces call-safe context packets |
| Warehouse connectors | Snowflake, BigQuery, Postgres, ClickHouse, etc. | Source of truth for audiences, events, and conversions |
| Agent/research layer | Analysis, SQL, graph/context retrieval, recommendations | Can recommend campaigns and explain performance |
| Destination connectors | CRM, CLM, messaging, ads, etc. | Writeback and follow-up actions |

The new layer is not another analytics agent. It is the execution system that controls customer-facing actions.

## 6. Proposed Architecture

### 6.1 Logical Architecture

```text
Warehouse / App Events / CRM / CLM
              |
              v
       Sentinel CDP Layer
              |
              v
       Context Layer
              |
              v
   Audience and Segment Resolver
              |
              v
      Action Campaign Service
              |
              v
      Audience Snapshot Service
              |
              v
       Contact Policy Service
              |
              v
      Action Job Orchestrator
              |
              v
        Voice Runtime
   Telephony <-> Gemini Live
              |
              v
      Realtime Tool Gateway
              |
              v
 Action/Event Ledger + Transcript Store
              |
              v
 Post-call Pipeline + Attribution + CRM/CLM Writeback
              |
              v
      CDP History and Analytics
```

### 6.2 Core Design Principle

The atomic execution unit is not the campaign. It is the `ActionJob`.

A campaign defines intent and policy. An audience snapshot defines the frozen set of recipients. An action job represents one planned action for one recipient on one channel. Every call, retry, link, follow-up, tool call, and attribution result attaches to that job.

## 7. V1 User Journey

### 7.1 Campaign Creation

1. User starts from a segment, insight, imported list, or campaign page.
2. User selects voice as the action channel.
3. Sentinel asks for:
   - Campaign goal
   - Audience
   - Offer or CTA
   - Success metric
   - Attribution window
   - Holdout percentage
   - Call language and voice
   - Script or agent flow
   - Approved realtime tools
   - Follow-up channels
   - CRM/CLM writeback destination
4. Sentinel previews:
   - Audience size
   - Suppression count
   - Holdout count
   - Estimated call volume
   - Estimated cost
   - Context fields that will be exposed to the voice agent
   - Compliance warnings
5. User sends a test call.
6. User approves and schedules launch.

### 7.2 Audience Materialization

1. Sentinel resolves the segment against the CDP/warehouse.
2. Sentinel writes an immutable `AudienceSnapshot`.
3. Sentinel records why each recipient qualified.
4. Sentinel assigns holdout/control membership.
5. Sentinel applies contact policy:
   - Consent
   - Do-not-call
   - Quiet hours
   - Max attempts
   - Recent-contact suppression
   - Channel eligibility
   - Language preference
   - Customer exclusions
6. Sentinel creates one `ActionJob` per eligible recipient.

### 7.3 Call Execution

1. Voice runtime pulls or receives an eligible `ActionJob`.
2. Runtime requests a context snapshot for the job.
3. Context service returns only approved, call-safe fields.
4. Runtime starts an outbound call through the configured telephony provider.
5. Telephony provider bridges call audio to the voice runtime.
6. Voice runtime opens a stateful Gemini Live session.
7. Gemini Live handles low-latency speech interaction.
8. When the model needs external action or data, it emits a function call.
9. Voice runtime forwards the function call to Sentinel's realtime tool gateway.
10. Tool gateway validates permissions, injects trusted IDs, executes the tool, logs the event, and returns a constrained result.
11. Voice runtime streams speech back to the caller.
12. Call end event closes the session and emits final call lifecycle events.

### 7.4 Post-Call Processing

1. Final transcript and recording are assembled.
2. Post-call classifier determines disposition and outcome.
3. Follow-up actions are scheduled or sent:
   - SMS
   - WhatsApp
   - Email
   - CLM event
   - Callback task
4. CRM/CLM writeback sends summary, transcript, recording URL, disposition, and next action.
5. Attribution service watches for conversion events during the configured window.
6. Campaign analytics updates with call, outcome, cost, attribution, and holdout lift.

## 8. What Needs to Be Built

### 8.1 Integration Inventory

| Integration | V1 requirement | Existing foundation | New build needed |
| --- | --- | --- | --- |
| CDP segment resolver | Resolve segment to customer IDs and qualification reasons | CDP/segmentation exists | Audience snapshot API and job materialization |
| Context layer | Return call-safe customer context | Context retrieval exists | Context packet contract, field allowlist, provenance, TTL |
| Warehouse connectors | Read audience and conversion events | Connectors exist | Conversion event mapping into attribution |
| Contact policy | Suppress ineligible recipients | Partial or absent | Central contact policy service |
| Campaign builder | Define campaign and voice flow | Not built | New action campaign UX/API |
| Voice agent builder | Configure prompt, language, tools, guardrails | Not built | V1 flow builder and test call |
| Telephony/dialer | Place outbound calls and receive status callbacks | Not built in main Sentinel | Provider adapter, callbacks, retries |
| Gemini Live runtime | Run realtime conversation | Not built in main Sentinel | Voice runtime service and session bridge |
| Realtime tool gateway | Execute approved live-call tools | Not built | Tool registry, permissions, audit, idempotency |
| Link service | Generate tracked URLs | May exist partially | Campaign/job/customer link tokens and UTM |
| Messaging follow-up | SMS/WhatsApp/email after call | Connectors may exist | Unified follow-up scheduler and templates |
| CRM/CLM writeback | Push transcript/summary/outcome | Connectors may exist | Per-call writeback mapping and retry queue |
| Event ingestion | Persist call lifecycle and tool events | Analytics events exist | Action/event ledger schema and API |
| Attribution | Link call to downstream outcome | Analytics exists | Holdout-aware attribution service |
| Ops console | Monitor and control live campaigns | Not built | Campaign execution UI |
| Compliance/audit | Explain what happened and why | Partial | Immutable audit logs, DNC, consent trail |

### 8.2 V1 Build Boundary

V1 should ship one high-quality vertical path:

```text
CDP segment -> voice campaign -> outbound calls -> realtime tools -> post-call outcome -> attribution -> CRM/CLM writeback
```

Everything outside this path should be designed for, but not fully built.

## 9. Product Requirements

### 9.1 Action Campaign

Users must be able to create, edit, approve, schedule, pause, resume, and stop a voice campaign.

Required fields:

| Field | Description |
| --- | --- |
| `name` | Human-readable campaign name |
| `goal` | Business objective |
| `channel` | `voice` for v1 |
| `audience_source` | Segment ID, query ID, imported list, or generated insight audience |
| `success_metric` | Conversion event or metric to optimize for |
| `attribution_window` | Time window for conversion credit |
| `holdout_percentage` | Control group percentage |
| `offer` | Offer/CTA details |
| `voice_agent_flow_id` | Voice script/flow |
| `approved_tools` | Tool IDs available during calls |
| `followup_policy` | Post-call SMS/WhatsApp/email/callback behavior |
| `contact_policy_id` | Consent and suppression policy |
| `crm_writeback_config` | Destination and field mapping |
| `schedule` | Start time, daily windows, timezone |
| `budget_limits` | Max calls, max spend, max retries |
| `approval_status` | Draft, approved, rejected |

### 9.2 Voice Agent Flow

The v1 builder should be structured enough to keep agents safe, not a free-form prompt box.

Required sections:

- Opening line
- Identity disclosure
- Reason for call
- Customer context variables that may be spoken
- Offer/CTA
- Qualification questions
- Objection handling snippets
- Disallowed claims
- Tool permissions
- Success criteria
- Callback/handoff behavior
- Closing behavior
- Language and voice settings

The prompt generated from this flow should be versioned. Every call must record the exact flow version used.

### 9.3 Campaign Approval

Before launch, Sentinel must require explicit approval for:

- Final audience count
- Suppression count
- Holdout size
- Context fields exposed to voice runtime
- Script/agent flow
- Approved tools
- Call schedule and timezone
- Estimated cost
- Compliance warnings

### 9.4 Execution Console

Operators need a live console with:

- Queued, dialing, connected, completed, failed, suppressed counts
- Connect rate
- Average call duration
- Tool success/failure rate
- Outcome distribution
- Follow-up status
- Spend estimate
- Provider errors
- Retry queue
- Pause/resume/stop controls
- Single recipient timeline
- Webhook replay

### 9.5 Call Record View

Every call must have a detail view:

- Recipient identity and segment reason
- Context packet version
- Campaign/job IDs
- Telephony provider call ID
- Gemini session ID or runtime session ID
- Timeline of call events
- Transcript
- Recording link, if enabled
- Realtime tool calls and results
- Final disposition
- Follow-up actions
- CRM writeback status
- Attribution status
- Audit log

## 10. System Requirements

### 10.1 Action Campaign Service

Responsibilities:

- Store campaign definitions.
- Store voice flow versions.
- Manage approval state.
- Schedule launches.
- Lock campaign config at launch.
- Provide campaign config to the job orchestrator.

Key rule: once a campaign is launched, any edit creates a new campaign version. Active jobs continue using the locked version they were created with.

### 10.2 Audience Snapshot Service

Responsibilities:

- Materialize audiences from CDP segments or query definitions.
- Store membership as a snapshot.
- Store `qualification_reason` per recipient.
- Assign holdout membership.
- Support refresh only by creating a new snapshot version.

Required properties:

- Immutable after creation.
- Dataset/tenant scoped.
- Query provenance retained.
- Count and sample preview available before approval.

### 10.3 Contact Policy Service

Responsibilities:

- Determine whether a recipient can be contacted.
- Explain suppression reasons.
- Enforce policy before every attempt, not only at campaign creation.

Policy checks:

- Consent exists for channel.
- Not on DNC list.
- Not manually suppressed.
- Within allowed calling hours.
- Under max attempts.
- Under max campaigns per period.
- No recent support escalation.
- Phone number validity.
- Language/country/provider eligibility.

### 10.4 Action Job Orchestrator

Responsibilities:

- Create one job per recipient/channel/action.
- Queue eligible jobs.
- Retry transient failures.
- Stop jobs when campaign is paused.
- Prevent duplicate outbound calls.
- Reconcile provider callbacks.

Job states:

```text
created
suppressed
queued
leased
dialing
ringing
connected
in_call
completed
failed
no_answer
busy
retry_scheduled
cancelled
holdout
```

The orchestrator must support leasing so multiple workers cannot call the same recipient.

### 10.5 Context Snapshot API

The voice runtime must not query the warehouse directly. It requests a scoped context packet.

Example endpoint:

```http
GET /api/action-jobs/{job_id}/context
Authorization: Bearer <runtime-token>
```

Example response:

```json
{
  "tenant_id": "tenant_123",
  "campaign_id": "camp_123",
  "campaign_version": 4,
  "job_id": "job_123",
  "recipient_id": "cust_123",
  "context_version": "ctx_2026_06_24_001",
  "expires_at": "2026-06-24T15:00:00Z",
  "customer": {
    "first_name": {
      "value": "Aarav",
      "source": "crm.contacts.first_name",
      "allowed_to_say": true
    },
    "plan_name": {
      "value": "Gold",
      "source": "warehouse.user_traits.plan_name",
      "allowed_to_say": true
    },
    "ltv_bucket": {
      "value": "high",
      "source": "cdp.computed_traits.ltv_bucket",
      "allowed_to_say": false
    }
  },
  "segment_reason": {
    "summary": "Customer has high purchase intent and no transaction in the last 21 days.",
    "allowed_to_say": false
  },
  "offer": {
    "name": "Priority callback",
    "cta": "Book a callback with a specialist",
    "terms": "Valid until 2026-07-01"
  },
  "guardrails": {
    "must_say": ["This call is from Sentinel on behalf of <brand>."],
    "must_not_say": ["Do not promise guaranteed approval."],
    "requires_consent_before_link": true
  },
  "allowed_tools": [
    "send_link",
    "schedule_callback",
    "mark_do_not_call",
    "transfer_to_human",
    "end_call"
  ]
}
```

Context requirements:

- Every field must include source/provenance.
- Every field must have `allowed_to_say`.
- Context must have TTL.
- Sensitive fields should be redacted or bucketed.
- The response must be small enough for realtime prompt injection.
- Fresh lookups during calls should be narrow and tool-gated.

### 10.6 Voice Runtime Service

Responsibilities:

- Lease jobs from orchestrator.
- Start outbound calls through telephony provider.
- Maintain call session state.
- Bridge telephony audio to Gemini Live.
- Register approved realtime tools with Gemini.
- Execute tool requests through Sentinel tool gateway.
- Emit lifecycle, transcript, and tool events.
- Handle call interruptions, end call, errors, and reconnects.

The runtime should be a separate service from the web app because it holds long-lived WebSocket sessions and call state.

### 10.7 Telephony Provider Adapter

V1 should choose one primary provider, but the internal interface should not assume only one provider.

Provider capabilities to model:

- Outbound call
- Status callbacks
- Inbound webhook signature verification
- Media stream over WebSocket/WebRTC/SIP
- Recording
- DTMF
- Call transfer
- Number provisioning
- Regional routing
- India support
- Retry-safe callback IDs

Adapter interface:

```typescript
interface TelephonyProvider {
  createOutboundCall(input: CreateCallInput): Promise<CreateCallResult>;
  endCall(input: EndCallInput): Promise<void>;
  transferCall(input: TransferCallInput): Promise<void>;
  normalizeStatusCallback(payload: unknown): CallProviderEvent;
  verifyWebhookSignature(input: VerifyWebhookInput): Promise<boolean>;
}
```

#### App-to-Dialer Connection Flow

Sentinel does not let the browser call the dialer directly. The main app creates campaigns and jobs; the voice runtime connects to the dialer using server-side credentials.

Outbound call flow:

```text
ActionJob queued
  -> Voice runtime leases job
  -> Voice runtime fetches context packet
  -> Voice runtime calls TelephonyProvider.createOutboundCall()
  -> Dialer places PSTN/SIP call
  -> Dialer requests answer instructions from Sentinel webhook
  -> Sentinel returns media-stream/SIP bridge instructions
  -> Dialer opens media stream to Voice runtime
  -> Voice runtime opens Gemini Live session
  -> Voice runtime bridges Dialer audio <-> Gemini Live audio
  -> Dialer sends status callbacks
  -> Sentinel normalizes callbacks into action events
```

Required dialer integration endpoints:

```http
POST /api/voice/dialer/{provider}/answer
POST /api/voice/dialer/{provider}/status
POST /api/voice/dialer/{provider}/recording
POST /api/voice/dialer/{provider}/fallback
```

Dialer webhook requirements:

- Verify provider signature before processing.
- Normalize provider-specific payloads into Sentinel `CallProviderEvent`.
- Treat duplicate callbacks as normal and idempotent.
- Store raw callback payload for debugging.
- Reconcile callbacks against `voice_calls.provider_call_id`.
- Do not trust tenant/campaign/job IDs from provider query params unless they are signed.
- Support fallback behavior if the media stream cannot connect.
- Support provider-level retry and Sentinel-level reconciliation.

Provider configuration required per workspace:

| Config | Purpose |
| --- | --- |
| `provider` | Twilio, Plivo, Exotel, Sarvam partner, custom SIP, etc. |
| `from_number` | Number used for outbound calls |
| `region` | Provider/media region |
| `answer_webhook_url` | URL provider calls when call is answered |
| `status_webhook_url` | URL provider calls for lifecycle callbacks |
| `recording_webhook_url` | URL provider calls when recording is available |
| `media_stream_url` | WebSocket/WebRTC/SIP endpoint for live media |
| `auth_secret_ref` | Secret-manager reference for provider credentials |

### 10.8 Gemini Live Adapter

V1 uses Gemini Live for realtime conversation.

The adapter must:

- Open a stateful WebSocket session.
- Send system instruction, voice/language config, and tool definitions.
- Stream call audio into Gemini Live in the required audio format.
- Stream model audio back to telephony.
- Receive transcripts and function calls.
- Return tool responses to Gemini.
- Close session on call end.

### 10.9 Realtime Tool Gateway

The realtime tool gateway is the only way a live voice agent can call Sentinel or external systems.

Principles:

- The model never supplies trusted tenant, campaign, job, customer, or call IDs.
- Runtime injects trusted IDs from server-side session state.
- Every tool has a schema, permissions, timeout, idempotency key, audit policy, and speakability rule.
- Tool results must be compact and safe to read aloud.
- Tool failures must return a controlled fallback message.

V1 tools:

| Tool | Purpose | Required in v1 |
| --- | --- | --- |
| `fetch_customer_context` | Narrow fresh lookup for allowed context | Yes |
| `send_link` | Send tracked SMS/WhatsApp/email link | Yes |
| `schedule_callback` | Create callback task | Yes |
| `mark_do_not_call` | Respect opt-out | Yes |
| `update_contact_preference` | Update channel/language preference | Yes |
| `transfer_to_human` | Warm/cold transfer or callback fallback | Optional v1 |
| `verify_status` | Check application/order/account status | Use-case dependent |
| `end_call` | End conversation intentionally | Yes |

Example tool execution request from runtime to gateway:

```json
{
  "tool_name": "send_link",
  "tenant_id": "tenant_123",
  "campaign_id": "camp_123",
  "job_id": "job_123",
  "call_id": "call_123",
  "recipient_id": "cust_123",
  "idempotency_key": "call_123:send_link:1",
  "arguments": {
    "template_id": "offer_link",
    "channel": "sms"
  }
}
```

Gateway response:

```json
{
  "status": "ok",
  "speakable": true,
  "message": "I have sent the link by SMS.",
  "result": {
    "link_id": "lnk_123",
    "delivery_status": "queued"
  }
}
```

### 10.10 Event Ledger

Every action event must be persisted in order and be replayable.

Required event families:

```text
campaign.created
campaign.approved
campaign.scheduled
audience.snapshot_created
job.created
job.suppressed
job.queued
job.leased
call.requested
call.started
call.ringing
call.connected
call.transcript_turn
tool.requested
tool.succeeded
tool.failed
message.queued
message.sent
message.delivered
message.failed
link.created
link.clicked
call.ended
call.recording_available
outcome.classified
followup.queued
followup.sent
crm.writeback_queued
crm.writeback_succeeded
crm.writeback_failed
conversion.received
conversion.observed
attribution.assigned
```

Event requirements:

- Tenant scoped.
- Idempotent.
- Append-only.
- Causally linked with `campaign_id`, `job_id`, `call_id`, and `recipient_id`.
- Replayable into analytics tables.
- Safe for audit export.

### 10.11 Post-Call Pipeline

This should be deterministic and asynchronous. It should not depend on the live voice model staying open.

Steps:

1. Finalize transcript.
2. Attach recording URL if enabled.
3. Run disposition classifier.
4. Extract callback requests, objections, intent, and promised actions.
5. Queue follow-ups.
6. Queue CRM/CLM writeback.
7. Enroll job into attribution window.
8. Materialize analytics metrics.

Post-call output:

```json
{
  "call_id": "call_123",
  "job_id": "job_123",
  "disposition": "interested_link_sent",
  "sentiment": "positive",
  "summary": "Customer asked for details and agreed to receive a link by SMS.",
  "next_action": "wait_for_link_click",
  "followups": [
    {
      "type": "sms",
      "status": "queued",
      "template_id": "offer_link"
    }
  ],
  "crm_writeback": {
    "status": "queued",
    "destination": "zoho"
  }
}
```

### 10.12 Realtime vs Post-Call Tooling

Realtime tools are for decisions and actions needed while the customer is on the call. Post-call processing should not depend on the live model making tool calls after the call ends.

Use realtime tools for:

- Fetching narrow fresh context.
- Sending a link while the customer is engaged.
- Scheduling a callback after the customer agrees.
- Marking do-not-call when the customer opts out.
- Transferring to a human while the call is active.
- Ending the call intentionally.

Use post-call backend jobs for:

- Final transcript assembly.
- Recording storage.
- Disposition classification.
- CRM/CLM writeback.
- Follow-up retry handling.
- Attribution enrollment.
- Analytics materialization.

This keeps the live agent responsive and keeps post-call side effects durable, retryable, and inspectable.

### 10.13 Attribution Service

Attribution is not just UTM links. Voice needs recipient-level attribution.

Required inputs:

- `campaign_id`
- `audience_snapshot_id`
- `job_id`
- `recipient_id`
- `call_id`
- holdout/control membership
- call outcome
- link clicks
- downstream conversion events
- revenue or value event
- attribution window

V1 attribution modes:

| Mode | Use case |
| --- | --- |
| Direct link attribution | Customer clicked tracked link and converted |
| Recipient-window attribution | Customer converted within window after call |
| Holdout lift | Compare contacted population against randomized control |

Attribution must define conflict rules when multiple campaigns touch the same recipient.

### 10.14 Conversion API, Webhooks, and Tracked Links

Success attribution needs three input paths, because not every conversion will happen through a campaign link.

#### Input Path A: Sentinel Conversion API

Customers or app SDKs can send conversion events directly to Sentinel.

```http
POST /api/conversion-events/ingest
```

Example:

```json
{
  "event_id": "evt_123",
  "tenant_id": "tenant_123",
  "customer_id": "cust_123",
  "event_name": "purchase_completed",
  "occurred_at": "2026-06-24T12:34:00Z",
  "value": 2499,
  "currency": "INR",
  "properties": {
    "order_id": "ord_123",
    "plan": "gold"
  },
  "context": {
    "sentinel_campaign_id": "camp_123",
    "sentinel_job_id": "job_123",
    "sentinel_link_id": "lnk_123"
  }
}
```

Requirements:

- Idempotent on `event_id`.
- Accept direct identifiers: `customer_id`, `recipient_id`, phone hash, email hash, or external user ID.
- Accept optional Sentinel attribution hints: campaign ID, job ID, call ID, link ID.
- Store raw payload and normalized event.
- Support late-arriving events.
- Support server-to-server authentication per workspace.
- Reject unauthenticated public writes unless using a scoped ingest token.

#### Input Path B: Destination Webhooks

Some success events arrive from CRM, CLM, payment, lead-management, or product systems.

Examples:

- CRM deal created or stage changed.
- CLM campaign conversion event.
- Payment/order completed.
- Form submitted.
- Appointment booked.
- App event webhook.

Webhook requirements:

- Workspace-specific webhook URL and secret.
- Signature verification where provider supports it.
- Idempotency by provider event ID.
- Raw payload storage.
- Mapping UI/API from provider payload to Sentinel `conversion_event`.
- Dead-letter queue for unmapped or failed events.
- Replay support after mapping fixes.

#### Input Path C: Tracked Links and UTM Params

Every link sent during or after a call must be a Sentinel tracked link.

Tracked link requirements:

- Generate a unique `link_id`.
- Attach `tenant_id`, `campaign_id`, `job_id`, `call_id`, `recipient_id`, and `channel`.
- Redirect to final destination with UTM params.
- Record click events before redirect.
- Support deep links and web links.
- Support short links for SMS.
- Expire links by campaign policy.
- Prevent leaking raw customer IDs in public URLs.

Recommended UTM contract:

```text
utm_source=sentinel
utm_medium=voice_sms | voice_whatsapp | voice_email | voice_call
utm_campaign=<campaign_slug_or_id>
utm_content=<offer_or_template_id>
sentinel_campaign_id=<opaque_campaign_token>
sentinel_job_id=<opaque_job_token>
sentinel_link_id=<opaque_link_token>
```

The public URL must use opaque tokens, not internal database IDs. Server-side click handling resolves tokens to internal IDs.

#### Attribution Decision Order

When a conversion event arrives, attribution should evaluate in this order:

1. Exact `sentinel_link_id` match.
2. Exact `sentinel_job_id` or `call_id` match.
3. Recipient match within attribution window after a positive call outcome.
4. Recipient match within attribution window after any connected call.
5. Campaign holdout comparison for incrementality.
6. No attribution.

Attribution must store both the winning attribution and all candidate touches considered.

#### Success Metric Definition

Every campaign must define success before launch:

```json
{
  "success_metric": {
    "event_name": "purchase_completed",
    "value_field": "value",
    "currency_field": "currency",
    "window_seconds": 604800,
    "dedupe_key": "order_id",
    "attribution_model": "last_sent_link_then_recipient_window",
    "holdout_enabled": true
  }
}
```

### 10.15 Messaging During and After Calls

V1 must support SMS during the call and after the call. WhatsApp and email should use the same messaging abstraction, but SMS is required for v1 because it is the default "send link now" path.

#### During-Call Messaging

During-call messages are triggered by realtime tools while the customer is on the call.

Primary tool:

```text
send_link(template_id, channel, destination_override?)
```

Rules:

- The agent must get customer consent before sending a link if campaign policy requires it.
- The tool gateway generates the tracked link.
- The messaging service sends the message.
- The tool response tells the agent only a safe status: sent, queued, failed, or fallback needed.
- The call should continue without waiting for final delivery receipt.
- Delivery receipts update asynchronously through provider webhooks.

#### Post-Call Messaging

Post-call messages are queued by the post-call pipeline based on disposition and policy.

Examples:

- Send offer link after interested call.
- Send appointment confirmation after callback scheduled.
- Send missed-call follow-up after no answer.
- Send "we will not contact again" confirmation after opt-out, where legally appropriate.
- Send summary or next-step email after high-intent call.

Post-call messaging requirements:

- Template versioning.
- Channel priority and fallback.
- Quiet-hour enforcement.
- Consent enforcement.
- Idempotency per job/template/channel.
- Delivery receipt ingestion.
- Retry policy.
- Suppression after opt-out.
- Attribution attachment to generated links.

Messaging events:

```text
message.queued
message.sent
message.delivered
message.failed
message.opted_out
link.created
link.clicked
```

### 10.16 What Else Is Needed for Reliable Success Attribution

Beyond webhooks, message links, and UTM params, v1 needs:

- Identity resolution between phone number, customer ID, CRM lead ID, app user ID, and warehouse ID.
- Conversion event taxonomy per workspace.
- Pre-launch success metric selection.
- Holdout/control group assignment before campaign execution.
- Exposure logging for attempted, connected, and positive-intent calls.
- Negative-outcome logging for opt-out, wrong number, not interested, and complaint.
- Multi-touch conflict rules across campaigns and channels.
- Lookback and cooldown windows so old calls do not claim new conversions forever.
- Revenue/value normalization.
- Refund/cancellation reversal handling.
- Late event handling.
- Backfill/replay for webhook and warehouse events.
- Campaign-level and recipient-level attribution explanations.

## 11. Data Model

### 11.1 Core Tables

```text
action_campaigns
  id
  tenant_id
  name
  channel
  goal
  status
  success_metric_id
  attribution_window_seconds
  holdout_percentage
  contact_policy_id
  schedule_config_json
  budget_config_json
  created_by
  created_at
  updated_at

action_campaign_versions
  id
  campaign_id
  version
  config_json
  approved_by
  approved_at
  created_at

voice_agent_flows
  id
  tenant_id
  name
  status
  latest_version
  created_at
  updated_at

voice_agent_flow_versions
  id
  flow_id
  version
  prompt_json
  tool_permissions_json
  guardrails_json
  language_config_json
  created_by
  created_at

audience_snapshots
  id
  tenant_id
  campaign_id
  campaign_version_id
  source_type
  source_id
  query_provenance_json
  total_count
  eligible_count
  suppressed_count
  holdout_count
  created_at

audience_snapshot_members
  snapshot_id
  recipient_id
  customer_id
  qualification_reason_json
  holdout_group
  suppression_reason
  created_at

action_jobs
  id
  tenant_id
  campaign_id
  campaign_version_id
  audience_snapshot_id
  recipient_id
  channel
  status
  attempt_count
  next_attempt_at
  leased_by
  lease_expires_at
  created_at
  updated_at

voice_calls
  id
  tenant_id
  job_id
  campaign_id
  recipient_id
  provider
  provider_call_id
  runtime_session_id
  gemini_session_id
  status
  started_at
  connected_at
  ended_at
  duration_seconds
  recording_url
  transcript_status
  created_at

voice_tool_calls
  id
  tenant_id
  call_id
  job_id
  tool_name
  status
  arguments_json
  result_json
  idempotency_key
  requested_at
  completed_at

tracked_links
  id
  tenant_id
  campaign_id
  job_id
  call_id
  recipient_id
  channel
  template_id
  opaque_token
  destination_url
  rendered_url
  expires_at
  created_at

tracked_link_clicks
  id
  tenant_id
  link_id
  campaign_id
  job_id
  recipient_id
  user_agent
  ip_hash
  referrer
  clicked_at

message_deliveries
  id
  tenant_id
  campaign_id
  job_id
  call_id
  recipient_id
  channel
  provider
  provider_message_id
  template_id
  status
  tracked_link_id
  idempotency_key
  sent_at
  delivered_at
  failed_at
  failure_reason
  created_at

action_events
  id
  tenant_id
  event_type
  campaign_id
  job_id
  call_id
  recipient_id
  provider_event_id
  payload_json
  occurred_at
  ingested_at

voice_outcomes
  id
  tenant_id
  call_id
  job_id
  disposition
  sentiment
  summary
  next_action
  confidence
  created_at

conversion_events
  id
  tenant_id
  event_id
  customer_id
  recipient_id
  external_user_id
  phone_hash
  email_hash
  event_name
  value
  currency
  properties_json
  raw_payload_json
  source
  occurred_at
  ingested_at

attribution_events
  id
  tenant_id
  campaign_id
  job_id
  recipient_id
  conversion_event_id
  attribution_mode
  attribution_status
  candidate_touches_json
  value
  observed_at
  created_at

provider_webhook_events
  id
  tenant_id
  provider
  provider_event_id
  event_family
  signature_verified
  raw_payload_json
  normalized_payload_json
  status
  received_at
  processed_at
```

### 11.2 Recipient Action Ledger

The product should expose a recipient-level ledger that joins jobs, calls, tools, follow-ups, outcomes, and attribution.

Ledger fields:

```text
tenant_id
recipient_id
campaign_id
job_id
channel
attempt
status
last_touch_at
tool_calls
outcome
next_action
attribution_state
crm_sync_state
audit_state
```

This ledger is the ground truth for "what did Sentinel do to this customer?"

## 12. API Surface

### 12.1 Campaign APIs

```http
POST /api/action-campaigns
GET /api/action-campaigns
GET /api/action-campaigns/{campaign_id}
PATCH /api/action-campaigns/{campaign_id}
POST /api/action-campaigns/{campaign_id}/preview
POST /api/action-campaigns/{campaign_id}/approve
POST /api/action-campaigns/{campaign_id}/schedule
POST /api/action-campaigns/{campaign_id}/pause
POST /api/action-campaigns/{campaign_id}/resume
POST /api/action-campaigns/{campaign_id}/stop
```

### 12.2 Audience APIs

```http
POST /api/action-campaigns/{campaign_id}/audience-snapshots
GET /api/audience-snapshots/{snapshot_id}
GET /api/audience-snapshots/{snapshot_id}/members
```

### 12.3 Job APIs

```http
POST /api/action-jobs/lease
POST /api/action-jobs/{job_id}/heartbeat
POST /api/action-jobs/{job_id}/complete
POST /api/action-jobs/{job_id}/fail
GET /api/action-jobs/{job_id}/context
GET /api/action-jobs/{job_id}/timeline
```

### 12.4 Voice Runtime APIs

```http
POST /api/voice/calls/start
POST /api/voice/calls/{call_id}/events
POST /api/voice/provider-callbacks/{provider}
POST /api/voice/tool-gateway/execute
GET /api/voice/calls/{call_id}
GET /api/voice/calls/{call_id}/transcript
```

### 12.5 Dialer Webhook APIs

```http
POST /api/voice/dialer/{provider}/answer
POST /api/voice/dialer/{provider}/status
POST /api/voice/dialer/{provider}/recording
POST /api/voice/dialer/{provider}/fallback
```

### 12.6 Link and Messaging APIs

```http
POST /api/tracked-links
GET /r/{opaque_link_token}
POST /api/messages/send
POST /api/messages/provider-callbacks/{provider}
GET /api/action-jobs/{job_id}/messages
```

### 12.7 Writeback and Conversion APIs

```http
POST /api/followups/queue
POST /api/crm-writebacks/queue
POST /api/attribution/enroll
POST /api/conversion-events/ingest
POST /api/conversion-events/webhooks/{source}
POST /api/conversion-events/replay
```

## 13. Gemini Live V1 Design

### 13.1 What Gemini Live Provides

Gemini Live provides the realtime voice agent primitive for v1:

- Stateful WebSocket session.
- Low-latency audio interaction.
- Native audio output.
- Barge-in.
- Voice activity detection.
- Tool/function calling.
- Audio transcription.
- Multilingual conversation support.

V1 should use `gemini-live-2.5-flash-native-audio` as the default target model where available.

### 13.2 Server-to-Server Runtime

Use server-to-server, not browser-to-Gemini, for campaign calls.

Reasons:

- Outbound calls originate from telephony, not a browser.
- The runtime needs secrets and provider credentials.
- Tool calls require trusted server identity.
- We need deterministic event logging.
- We need to inject trusted campaign/job/customer IDs.
- We need retry and recovery logic outside the end-user client.

### 13.3 Audio Path

V1 runtime must normalize telephony audio to the format Gemini Live requires.

```text
Caller
  <-> Telephony provider
  <-> Voice runtime media bridge
  <-> Gemini Live WebSocket
```

Engineering must explicitly handle:

- Telephony input format.
- Gemini input format.
- Gemini output format.
- Transcoding latency.
- Barge-in behavior.
- Silence detection.
- End-of-call flush.
- Reconnect behavior.

### 13.4 Regional Residency in V1

V1 should support regional deployment only where the selected Google Cloud model and endpoint support the required residency behavior.

Requirements:

- Use Google Cloud / Gemini Enterprise Agent Platform / Vertex-style regional configuration for customers that require residency.
- Store Sentinel action data at rest in the selected Sentinel deployment region.
- Route Gemini Live requests to the selected supported model location.
- Treat endpoint selection and data residency as separate checks. A regional endpoint alone is not enough; the model and capability must be listed as supporting residency in that region.
- For India residency, validate use of the `asia-south1` location for `gemini-live-2.5-flash-native-audio` before any customer commitment.
- Avoid global endpoints for customers with strict jurisdictional processing requirements.
- Make selected region visible in campaign/runtime audit logs.

V1 deployment profiles:

| Profile | Use case | Data movement |
| --- | --- | --- |
| Cloud default | Fastest path for non-strict customers | Sentinel cloud, voice runtime cloud, Gemini cloud |
| Regional cloud | Customers needing supported regional processing | Sentinel and voice runtime in selected region, Gemini routed to supported regional endpoint |
| Hybrid context | Warehouse/CDP must remain customer-controlled | On-prem/customer VPC context proxy sends minimized context packet to Sentinel voice runtime |

### 13.5 Gemini Live Limitations in V1

These limitations must be explicitly stated in customer-facing and internal docs:

- Gemini Live is a cloud model endpoint. V1 is not fully on-prem voice.
- Live call audio and selected prompt/context are processed by Google infrastructure.
- Regional residency depends on model, endpoint, and listed capability support.
- Some advanced features may have preview/pre-GA behavior depending on the selected API surface and model.
- Session resumption must stay disabled if zero data retention is required.
- In-memory caching and abuse monitoring settings must be reviewed per Google Cloud project before enterprise deployment.
- If a customer requires "audio never leaves our environment", they are not eligible for Gemini Live v1.

### 13.6 V1 Positioning Statement

Recommended internal/customer wording:

> Sentinel v1 voice agents support cloud and hybrid-context deployment. Gemini Live provides the realtime voice model and requires call audio plus selected prompt/context to be processed by Google infrastructure. For customers with regional requirements, Sentinel can deploy the voice runtime in a supported region and route Gemini Live through a supported regional Google Cloud endpoint. For strict on-prem voice inference, v1 is not sufficient; that requires a separate on-prem realtime model, STT/TTS, and telephony architecture.

## 14. On-Prem vs Off-Prem

### 14.1 Definitions

| Term | Meaning |
| --- | --- |
| Off-prem/cloud | Sentinel services, voice runtime, and model provider run in cloud infrastructure |
| Regional cloud | Cloud deployment constrained to a supported region or multi-region |
| Hybrid-context | Customer data systems stay on-prem/customer VPC; minimized context is sent to cloud runtime |
| Fully on-prem | Telephony, voice runtime, STT/TTS, LLM/realtime model, tools, and storage all run inside customer environment |

### 14.2 V1 Supported Modes

V1 supports:

- Cloud default.
- Regional cloud where supported.
- Hybrid-context with on-prem context proxy.

V1 does not support:

- Fully on-prem voice inference with Gemini Live.
- On-prem Gemini Live runtime.
- Customer-controlled model weights.
- No-audio-egress deployment.

### 14.3 Hybrid Context Proxy

For customers who cannot expose the warehouse or CDP directly:

```text
Customer VPC / On-prem
  Warehouse / CDP
       |
       v
  Sentinel Context Proxy
       |
       | mTLS, allowlisted fields, short TTL
       v
Sentinel Voice Runtime
       |
       v
Gemini Live
```

Proxy requirements:

- Runs in customer-controlled environment.
- Has read-only access to approved data sources.
- Returns only the context packet schema.
- Enforces field allowlists locally.
- Logs every context request.
- Supports tenant/campaign/job scoped authorization.
- Does not let voice runtime issue arbitrary SQL.
- Redacts sensitive fields before egress.

## 15. Security, Privacy, and Compliance

### 15.1 Required Controls

- Tenant isolation on every table, event, tool, and provider callback.
- Runtime service authentication with short-lived credentials.
- mTLS for hybrid context proxy.
- Signed provider callbacks.
- Idempotency keys on all write paths.
- Immutable action audit log.
- Field-level context allowlist.
- `allowed_to_say` enforcement.
- Prompt/context redaction.
- Recording retention policy.
- Transcript retention policy.
- Customer opt-out propagation.
- DNC enforcement before every call attempt.
- Role-based access for campaign approval and launch.
- Emergency campaign kill switch.

### 15.2 PII Handling

PII sent to the live model must be minimized.

Default rule:

- Use first name only when needed.
- Do not send raw address unless required.
- Do not send full account numbers, cards, IDs, or medical/financial sensitive details.
- Bucket sensitive values where possible.
- Mark internal segmentation reasons as not speakable by default.

### 15.3 Tool Safety

Each tool must define:

- Who can call it.
- Which campaigns can call it.
- Whether customer consent is required.
- Whether result can be spoken.
- Timeout and retry behavior.
- Idempotency behavior.
- Audit fields.
- Failure fallback.

## 16. Observability

### 16.1 Product Metrics

- Campaigns launched.
- Calls attempted.
- Connect rate.
- Average call duration.
- Positive intent rate.
- Link sent rate.
- Callback scheduled rate.
- Conversion rate.
- Revenue attributed.
- Incremental lift vs holdout.
- Cost per connected call.
- Cost per conversion.

### 16.2 System Metrics

- Job queue depth.
- Job lease failures.
- Duplicate prevention events.
- Telephony callback delay.
- Call setup latency.
- Time to first agent speech.
- Tool call latency.
- Tool call failure rate.
- Gemini session errors.
- Transcoding latency.
- Dropped calls.
- Transcript finalization delay.
- CRM writeback retries.

### 16.3 Debugging Requirements

Engineers and operators must be able to inspect:

- One campaign timeline.
- One job timeline.
- One call timeline.
- Raw provider callbacks.
- Normalized events.
- Tool request/response pairs.
- Context packet used.
- Prompt/flow version used.
- Post-call classifier output.
- Attribution decision.

## 17. Rollout Plan

### Phase 0: Architecture and Contracts

Deliverables:

- This PRD approved.
- Data model reviewed.
- Provider selection made.
- Gemini Live deployment mode selected.
- Security review for context packet and tool gateway.
- Open compliance questions assigned.

Exit criteria:

- Engineering agrees on service boundaries.
- Product agrees on v1 scope.
- No ambiguity on on-prem/off-prem positioning.

### Phase 1: Campaign, Audience, and Job Foundation

Deliverables:

- Action campaign tables/APIs.
- Audience snapshot materialization.
- Contact policy service.
- Action job orchestrator.
- Basic execution console.

Exit criteria:

- A segment can create jobs with holdout and suppression.
- Jobs are durable, idempotent, and inspectable.

### Phase 2: Context and Tool Gateway

Deliverables:

- Context snapshot API.
- Field allowlist.
- Realtime tool gateway.
- V1 tool implementations.
- Audit events for tool calls.

Exit criteria:

- Voice runtime can fetch safe context and execute `send_link`, `schedule_callback`, `mark_do_not_call`, and `end_call`.

### Phase 3: Voice Runtime

Deliverables:

- Telephony adapter.
- Gemini Live adapter.
- Media bridge.
- Runtime session state.
- Call lifecycle events.
- Transcript capture.

Exit criteria:

- Test campaign can place a call, personalize opening, handle barge-in, call one tool, and persist transcript/outcome.

### Phase 4: Post-Call and Writeback

Deliverables:

- Post-call classifier.
- Follow-up scheduler.
- CRM/CLM writeback queue.
- Recording/transcript retention.
- Call record detail page.

Exit criteria:

- Every completed call produces disposition, summary, next action, and writeback status.

### Phase 5: Attribution and Analytics

Deliverables:

- Attribution enrollment.
- Conversion event ingestion.
- Holdout lift reporting.
- Campaign analytics dashboard.

Exit criteria:

- Campaign report shows call funnel, outcomes, conversions, cost, and lift vs holdout.

### Phase 6: Regional and Hybrid Hardening

Deliverables:

- Region selection in deployment/runtime config.
- Regional audit logging.
- Hybrid context proxy.
- Residency deployment checklist.
- Customer-facing limitation language.

Exit criteria:

- One regional deployment profile is validated end to end.
- One hybrid context proxy deployment is validated end to end.

## 18. Acceptance Criteria for V1

V1 is complete when:

1. A user can create a voice campaign from an existing CDP segment.
2. Sentinel materializes an immutable audience snapshot with holdout.
3. Contact policy suppresses ineligible recipients before calling.
4. A durable action job is created per eligible recipient.
5. Voice runtime places outbound calls through the selected provider.
6. Gemini Live handles the realtime conversation.
7. Realtime tool calls are executed through Sentinel's tool gateway.
8. Tool calls are permissioned, idempotent, and audited.
9. Call transcript and recording metadata are persisted.
10. Post-call disposition and summary are generated.
11. Follow-up links are tracked by campaign/job/recipient.
12. SMS can be sent during the call through the `send_link` realtime tool.
13. SMS can be queued after the call through the post-call pipeline.
14. Message delivery receipts are ingested and visible.
15. Dialer answer/status/recording callbacks are verified, normalized, and persisted.
16. CRM/CLM writeback is queued, retried, and visible.
17. Conversion API and conversion webhooks can ingest downstream success events.
18. Attribution can connect downstream conversion events to jobs.
19. Holdout analysis is visible.
20. Operators can pause, resume, stop, and inspect campaigns.
21. Regional/Gemini Live limitations are shown in deployment docs.

## 19. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Gemini Live regional support differs by model/region | Cannot satisfy customer residency promise | Validate supported model/location before sale and deploy |
| Customer assumes Gemini Live is on-prem | Compliance/product risk | Explicit v1 limitation language in PRD, sales, and security docs |
| Voice runtime gets raw warehouse access | Data leakage risk | Context packet API only; no arbitrary SQL from runtime |
| Tool call performs wrong action | Customer harm | Permissioned gateway, idempotency, typed schemas, audit, restricted tools |
| Campaign over-contacts users | Trust/compliance risk | Central contact policy and max-attempt controls |
| Attribution is inaccurate | Product value risk | Holdout design, recipient-level ledger, clear conflict rules |
| Provider callbacks are missed or duplicated | Incorrect job state | Idempotent event ingestion and reconciliation jobs |
| Realtime latency too high | Poor call quality | Regional runtime, transcoding optimization, metrics on first speech/tool latency |
| Agent says unsafe claims | Compliance risk | Structured flow builder, must-not-say guardrails, call review |
| CRM writeback fails silently | Operational risk | Retry queue, visible status, dead-letter queue |

## 20. Open Questions

Product:

- What is the first customer/use-case for v1?
- Which vertical compliance rules matter first?
- What is the minimum acceptable campaign builder?
- Should campaign approval be required for all users or only risky actions?
- What should the default holdout percentage be?

Engineering:

- Which telephony provider is primary for v1?
- Will voice runtime run as a separate service or inside existing backend infra?
- Which queue system will orchestrate jobs?
- Which storage system owns recordings and transcripts?
- What is the exact context layer API today?
- Which CRM/CLM connector is first?
- Which conversion event taxonomy already exists?

Security/compliance:

- What PII classes can be sent to Gemini Live?
- Which regions are required for first customers?
- Do we need zero data retention configuration for Google Cloud project from day one?
- What recording consent language is required by market?
- What DNC/quiet-hour rules apply by country?

## 21. V1 Engineering Checklist

- [ ] Action campaign schema and APIs.
- [ ] Voice flow schema and versioning.
- [ ] Audience snapshot materialization.
- [ ] Holdout assignment.
- [ ] Contact policy service.
- [ ] Action job table and lease API.
- [ ] Context packet schema.
- [ ] Context field allowlist UI/API.
- [ ] Telephony provider adapter.
- [ ] Dialer answer/status/recording webhook endpoints.
- [ ] Gemini Live adapter.
- [ ] Voice runtime service.
- [ ] Realtime tool gateway.
- [ ] `send_link` tool.
- [ ] `schedule_callback` tool.
- [ ] `mark_do_not_call` tool.
- [ ] `end_call` tool.
- [ ] Action event ledger.
- [ ] Transcript store.
- [ ] Recording metadata store.
- [ ] Tracked link service.
- [ ] Link click redirect endpoint.
- [ ] SMS provider adapter.
- [ ] Message delivery receipt ingestion.
- [ ] Post-call classifier.
- [ ] Follow-up scheduler.
- [ ] CRM/CLM writeback queue.
- [ ] Conversion API.
- [ ] Conversion webhook ingestion and replay.
- [ ] Attribution service.
- [ ] Campaign analytics dashboard.
- [ ] Ops console.
- [ ] Regional deployment checklist.
- [ ] Hybrid context proxy design.
- [ ] Customer-facing Gemini Live limitation copy.

## 22. Reference Notes

Official docs reviewed on 2026-06-24:

- Gemini Live API overview: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api
- Gemini Enterprise Agent Platform data residency: https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency
- Gemini Enterprise Agent Platform deployment endpoints: https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations
- Gemini Enterprise Agent Platform zero data retention: https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention

Important doc-derived constraints:

- Gemini Live uses stateful WebSocket sessions and supports realtime voice, barge-in, tool use, and transcriptions.
- `gemini-live-2.5-flash-native-audio` is the recommended GA model in the Agent Platform docs at the time of review.
- Google Cloud regional endpoints and data residency guarantees must be evaluated separately.
- Data at rest and ML processing guarantees depend on selected location, model, and supported capability.
- Session resumption for Gemini Live stores session data for up to 24 hours if enabled, so it should remain disabled for zero-data-retention-sensitive deployments.
- In-memory caching behavior and abuse monitoring exceptions must be reviewed at the Google Cloud project/account level for enterprise deployments.
