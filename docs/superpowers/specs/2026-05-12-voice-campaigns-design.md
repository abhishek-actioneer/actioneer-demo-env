# Voice Campaigns — Design Spec

**Date:** 2026-05-12  
**Status:** Approved for implementation planning  

---

## Overview

A standalone Voice Campaigns feature that lets operators pick a segment, pick an offer from a pre-uploaded catalog, have Sentinel auto-generate a call script, paste phone numbers, and immediately dispatch outbound AI voice calls via ElevenLabs. Results are tracked live — connect rate, 20-second engagement (the conversion metric), per-call duration, and an AI-generated call summary.

---

## User Flow

```
/voice-campaigns          → campaign list + "New Campaign"
/voice-campaigns/new      → creation page (segment + offer + script + numbers → launch)
/voice-campaigns/[id]     → live results (call log, stats, 20s tracking)
```

### Creation Flow (single page, two panels)

**Left panel — Configure:**
1. Pick a segment (dropdown, shows user count)
2. Pick an offer from the catalog (cards showing name, tagline, price_display)
3. Pick agent voice (ElevenLabs voice list) and language
4. Paste phone numbers (one per line or comma-separated textarea)
5. Hit **Generate Script**

**Right panel — appears after generation:**
1. Sentinel's reasoning (why this script for this segment + offer)
2. Generated script (editable, regenerate button)
3. **Launch N Calls** button — dispatches immediately

---

## Offers Catalog

### CSV Format

```csv
offer_id,sku,name,category,tagline,description,value_prop,price_display,cta
OFF001,SGB-Q1-2024,Sovereign Gold Bond,investment,"Gold + 2.5% guaranteed returns","Govt-backed, no storage risk","2.5% p.a. + gold appreciation","₹5,890/gram · min ₹5,000","Say yes and our team calls back to complete paperwork"
OFF002,FD-FLEXI-12M,Flexi Fixed Deposit,investment,"8.5% guaranteed, withdraw anytime","12-month FD, zero penalty","8.5% p.a., no lock-in","₹10,000 minimum","Say yes and we set it up digitally in 5 mins"
OFF003,GJEWEL-22K,Gold Jewellery Collection,jewellery,"22K hallmarked, 5% making charge","BIS certified, EMI available","Lowest making charges in city","Starting ₹15,000","Say yes and we WhatsApp you the catalogue"
OFF004,MF-LARGECAP-SIP,Large Cap SIP,investment,"Top 100 companies, ₹500/month","SEBI-regulated, 12.4% CAGR 5yr","Start small, compounding from day 1","₹500/month minimum","Say yes and we send you the link to start"
```

**Columns:**
| Column | Purpose |
|--------|---------|
| `offer_id` | Unique identifier (referenced in campaigns) |
| `sku` | Product code |
| `name` | Display name |
| `category` | `investment`, `jewellery`, `d2c`, etc. |
| `tagline` | One-liner for the picker card |
| `description` | Full product description injected into script prompt |
| `value_prop` | Key benefit — agent leads with this |
| `price_display` | Human-readable price/rate string |
| `cta` | Exact closing line the agent says |

### Storage
In-memory `Map<string, Offer>` for now (mock/demo). CSV parsed on upload. Pre-seeded with the 4 mock offers above.

---

## Script Generation

### Prompt Inputs
- **Segment profile**: segment name, user count, SQL filter, and description (if set). Sentinel uses these to infer audience characteristics for the script — no additional API call needed.
- **Offer fields**: all columns from the CSV (name, tagline, description, value_prop, price_display, cta)
- **Language/voice**: selected language code

### Prompt Output
```json
{
  "script": "Hello, am I speaking with [Name]?...",
  "reasoning": "Segment skews 35–50, high MF affinity. Gold bond framing chosen over FD due to equity exposure signals. CTA kept soft given cold-call context."
}
```

### Prompt location
`src/lib/prompts/voice-campaign.ts` — `buildVoiceCampaignScriptPrompt(segment, offer, language)`

---

## ElevenLabs Integration

### Product: ElevenAgents + Batch Calls

ElevenLabs has a dedicated outbound calling product called **ElevenAgents** with a **Batch Calls** API. This is the right fit — it dispatches multiple outbound calls simultaneously from a recipient list, auto-managing concurrency (50% of workspace limit).

### How it works

1. **Create agent** — POST to ElevenLabs Agents API with the generated script as system prompt + voice selection. Returns `agent_id`.
2. **Build recipient CSV** — server-side, from the user's pasted phone numbers. Mandatory column: `phone_number`. Optional: `name` (for per-call personalization in the script via `[name]` placeholder).
3. **Submit batch call** — POST to ElevenLabs Batch Calls API with `agent_id` + `phone_number_id` (provisioned DID) + batch name + recipient CSV file. ElevenLabs dispatches all calls.
4. **Receive webhook events** — ElevenLabs fires a webhook per call completion with `conversation_id`, `duration_seconds`, `transcript`, and AI-generated `summary`.

### Recipient CSV format (generated server-side)
```csv
phone_number,name
+91 98765 43210,User
+91 87654 32109,User
```

### Telephony setup
- ElevenLabs supports Twilio and SIP trunk integration for phone calls
- For India: provision an Indian DID via Twilio, connect it to ElevenLabs dashboard
- For demo: one configured test number in ElevenLabs dashboard is sufficient

### Webhook URL
ElevenLabs POSTs to `/api/voice-campaigns/[id]/webhook` on each call end. In production (Railway) this is public. In local dev, use `ngrok http 3000` and set `ELEVENLABS_WEBHOOK_URL` env var.

### Client module
`src/lib/elevenlabs-client.ts`:
```typescript
createAgent(script: string, voiceId: string): Promise<string>
// → agent_id

submitBatchCall(args: {
  agentId: string;
  phoneNumberId: string;
  batchName: string;
  recipients: Array<{ phone_number: string; name?: string }>;
}): Promise<string>
// → batch_call_id
```

---

## Conversion Metric

**20-second rule**: A call is counted as "engaged" if `duration_seconds >= 20` on the webhook payload.

This is the primary success metric displayed in the results dashboard. No downstream purchase tracking in v1.

---

## Data Model

### `VoiceCampaign`
```typescript
interface VoiceCampaign {
  id: string;
  name: string;                    // "{offer.name} · {segment.name}"
  segmentId: string;
  segmentName: string;
  offerId: string;
  offerName: string;
  script: string;
  scriptReasoning: string;
  agentId: string;                 // ElevenLabs agent ID
  voice: string;
  language: string;
  status: "launching" | "in_progress" | "completed";
  calls: VoiceCall[];
  createdAt: string;
}

interface VoiceCall {
  id: string;                      // ElevenLabs conversationId
  toNumber: string;                // masked in UI (+91 987•••210)
  status: "queued" | "calling" | "connected" | "completed" | "failed" | "no_answer";
  durationSeconds?: number;
  engaged: boolean;                // duration >= 20s
  summary?: string;                // ElevenLabs-generated call summary
  startedAt?: string;
  endedAt?: string;
}
```

### `Offer`
```typescript
interface Offer {
  offerId: string;
  sku: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  valueProp: string;
  priceDisplay: string;
  cta: string;
}
```

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/offers` | GET | List all offers |
| `/api/offers/upload` | POST | Upload offers CSV, parse + store |
| `/api/voice-campaigns` | GET | List all campaigns |
| `/api/voice-campaigns` | POST | Create campaign (generate script + create EL agent) |
| `/api/voice-campaigns/[id]` | GET | Get campaign + call statuses |
| `/api/voice-campaigns/[id]/launch` | POST | Dispatch outbound calls (loop through numbers) |
| `/api/voice-campaigns/[id]/webhook` | POST | ElevenLabs call-end event receiver |

---

## Pages

### `/voice-campaigns` — List
- Campaign cards: name, offer, segment, status badge, call count, 20s rate
- "New Campaign" button top-right
- Sidebar nav item: "Voice" (or "Voice Campaigns")

### `/voice-campaigns/new` — Creation
- Two-panel layout (configure left, script right)
- Script panel hidden until "Generate Script" clicked
- "Launch N Calls" disabled until script generated + ≥1 number entered

### `/voice-campaigns/[id]` — Detail
- Header: campaign name + offer + segment + status + launched-at
- Stats row: Total Calls · Connected · 20s Engaged · Avg Duration
- Call log table: masked number, status, duration, 20s flag, summary
- Collapsible script section at bottom
- Auto-refreshes every 5s while status is `in_progress`

---

## New Files

```
src/lib/offer-store.ts                          in-memory offer CRUD + CSV parser
src/lib/voice-campaign-store.ts                 in-memory campaign + call records
src/lib/elevenlabs-client.ts                    createAgent + initiateCall
src/lib/prompts/voice-campaign.ts               buildVoiceCampaignScriptPrompt()
src/app/api/offers/route.ts                     GET list + POST upload
src/app/api/voice-campaigns/route.ts            GET list + POST create
src/app/api/voice-campaigns/[id]/route.ts       GET detail
src/app/api/voice-campaigns/[id]/launch/route.ts POST dispatch calls
src/app/api/voice-campaigns/[id]/webhook/route.ts POST EL call events
src/app/voice-campaigns/page.tsx                campaign list page
src/app/voice-campaigns/new/page.tsx            creation page
src/app/voice-campaigns/[id]/page.tsx           detail/results page
```

### Modified Files
```
src/lib/feature-flags.ts              add "voice-campaigns" feature id
src/lib/sidebar-config.ts             add Voice Campaigns nav item
```

---

## Environment Variables

```
ELEVENLABS_API_KEY          ElevenLabs API key (ElevenAgents product)
ELEVENLABS_PHONE_NUMBER_ID  ID of the provisioned DID in ElevenLabs dashboard (not the number itself)
ELEVENLABS_WEBHOOK_URL      Public URL for call-end webhooks (set to Railway URL in prod, ngrok in dev)
```

---

## Out of Scope (v1)

- Test/control experimentation split (future)
- Contact list management (operator pastes numbers manually)
- Scheduling calls for a later time (calls go out immediately)
- Multi-offer campaigns
- DND (Do Not Disturb) registry filtering
- Call recording playback in UI
