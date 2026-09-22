# Voice Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Voice Campaigns feature that lets operators pick a segment + offer, generate a call script via Sentinel, paste phone numbers, and dispatch outbound AI voice calls via ElevenLabs Batch Calls API — with a live results dashboard tracking 20s engagement.

**Architecture:** Pre-seeded mock offers catalog (in-memory store), voice campaigns stored in-memory, ElevenLabs client creates an agent per campaign then submits a batch call with a generated recipient CSV. Webhooks from ElevenLabs update per-call status and flag 20s conversions.

**Tech Stack:** Next.js 16 App Router · TypeScript · ElevenLabs Conversational AI API (ElevenAgents) · OpenAI GPT-5.5 (script generation via existing `llm.ts`) · Clerk auth · shadcn/ui · `apiFetch` for all client→server calls

---

## File Map

**New files:**
```
src/lib/offer-types.ts                             Offer interface
src/lib/offer-store.ts                             In-memory offer CRUD + pre-seeded mock data + CSV parser
src/lib/voice-campaign-types.ts                    VoiceCampaign + VoiceCall interfaces
src/lib/voice-campaign-store.ts                    In-memory campaign + call CRUD
src/lib/elevenlabs-client.ts                       createAgent() + submitBatchCall()
src/lib/prompts/voice-campaign.ts                  buildVoiceCampaignScriptPrompt()
src/app/api/offers/route.ts                        GET list + POST upload CSV
src/app/api/voice-campaigns/route.ts               GET list + POST create campaign
src/app/api/voice-campaigns/generate-script/route.ts  POST generate script (LLM)
src/app/api/voice-campaigns/[id]/route.ts          GET campaign detail
src/app/api/voice-campaigns/[id]/launch/route.ts   POST dispatch ElevenLabs batch call
src/app/api/voice-campaigns/[id]/webhook/route.ts  POST receive ElevenLabs call events
src/app/voice-campaigns/page.tsx                   Campaign list page
src/app/voice-campaigns/new/page.tsx               Campaign creation page (two-panel)
src/app/voice-campaigns/[id]/page.tsx              Campaign detail + live results
```

**Modified files:**
```
src/lib/feature-flags.ts              Add "voice-campaigns" to FeatureId union
src/components/sidebar.tsx            Add Voice Campaigns to ALL_NAV_ITEMS + getActivePage
```

---

## Task 1: Types

**Files:**
- Create: `src/lib/offer-types.ts`
- Create: `src/lib/voice-campaign-types.ts`

- [ ] **Step 1: Create offer types**

```typescript
// src/lib/offer-types.ts
export interface Offer {
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

- [ ] **Step 2: Create voice campaign types**

```typescript
// src/lib/voice-campaign-types.ts
export type VoiceCallStatus =
  | "queued"
  | "calling"
  | "connected"
  | "completed"
  | "failed"
  | "no_answer";

export type VoiceCampaignStatus = "launching" | "in_progress" | "completed";

export interface VoiceCall {
  id: string;               // ElevenLabs conversationId
  toNumber: string;         // stored as-is; masked in UI
  status: VoiceCallStatus;
  durationSeconds?: number;
  engaged: boolean;         // durationSeconds >= 20
  summary?: string;         // ElevenLabs AI summary
  startedAt?: string;
  endedAt?: string;
}

export interface VoiceCampaign {
  id: string;
  name: string;             // "{offer.name} · {segment.name}"
  segmentId: string;
  segmentName: string;
  offerId: string;
  offerName: string;
  script: string;
  firstMessage: string;     // ElevenLabs agent opening line
  scriptReasoning: string;
  agentId: string;          // ElevenLabs agent id
  batchCallId?: string;     // ElevenLabs batch call id
  voice: string;            // ElevenLabs voice id
  language: string;
  phoneNumbers: string[];   // raw numbers as entered
  status: VoiceCampaignStatus;
  calls: VoiceCall[];
  createdAt: string;
  launchedAt?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/offer-types.ts src/lib/voice-campaign-types.ts
git commit -m "feat(voice-campaigns): add Offer and VoiceCampaign types"
```

---

## Task 2: Offer Store (mock data + CSV parser)

**Files:**
- Create: `src/lib/offer-store.ts`

- [ ] **Step 1: Create offer store with pre-seeded mock data and CSV parser**

```typescript
// src/lib/offer-store.ts
import type { Offer } from "./offer-types";

// ── Pre-seeded mock offers ──

const MOCK_OFFERS: Offer[] = [
  {
    offerId: "OFF001",
    sku: "SGB-Q1-2024",
    name: "Sovereign Gold Bond",
    category: "investment",
    tagline: "Gold + 2.5% guaranteed returns",
    description: "Government of India backed security. No storage risk, no making charges. Fully digital.",
    valueProp: "2.5% p.a. interest + gold price appreciation",
    priceDisplay: "₹5,890/gram · min ₹5,000",
    cta: "Say yes and our team will call you back to complete the paperwork",
  },
  {
    offerId: "OFF002",
    sku: "FD-FLEXI-12M",
    name: "Flexi Fixed Deposit",
    category: "investment",
    tagline: "8.5% guaranteed, withdraw anytime",
    description: "12-month FD with zero penalty on premature withdrawal. DICGC insured up to ₹5L.",
    valueProp: "8.5% p.a., no lock-in penalty",
    priceDisplay: "₹10,000 minimum",
    cta: "Say yes and we will set it up digitally in 5 minutes",
  },
  {
    offerId: "OFF003",
    sku: "GJEWEL-22K",
    name: "Gold Jewellery Collection",
    category: "jewellery",
    tagline: "22K hallmarked, 5% making charge",
    description: "BIS hallmarked gold jewellery. Easy EMI available. 1 year free insurance.",
    valueProp: "Lowest making charges in city",
    priceDisplay: "Starting ₹15,000",
    cta: "Say yes and we will send you our catalogue on WhatsApp",
  },
  {
    offerId: "OFF004",
    sku: "MF-LARGECAP-SIP",
    name: "Large Cap SIP",
    category: "investment",
    tagline: "Top 100 companies, ₹500/month",
    description: "SEBI-regulated large cap mutual fund. 12.4% CAGR over last 5 years. Start and stop anytime.",
    valueProp: "Start small, compounding from day 1",
    priceDisplay: "₹500/month minimum",
    cta: "Say yes and we will send you the link to start in minutes",
  },
];

// ── In-memory store ──

const offerMap = new Map<string, Offer>(
  MOCK_OFFERS.map((o) => [o.offerId, o])
);

export function listOffers(): Offer[] {
  return Array.from(offerMap.values());
}

export function getOffer(offerId: string): Offer | undefined {
  return offerMap.get(offerId);
}

// ── CSV parser ──
// Expected header: offer_id,sku,name,category,tagline,description,value_prop,price_display,cta

export function parseOffersCsv(csvText: string): { offers: Offer[]; errors: string[] } {
  const lines = csvText.trim().split("\n").map((l) => l.trim());
  if (lines.length < 2) return { offers: [], errors: ["CSV must have a header row and at least one data row"] };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const required = ["offer_id", "sku", "name", "category", "tagline", "description", "value_prop", "price_display", "cta"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length > 0) return { offers: [], errors: [`Missing columns: ${missing.join(", ")}`] };

  const offers: Offer[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    // Basic CSV split — handles quoted fields with commas
    const values = splitCsvLine(lines[i]);
    if (values.length < required.length) {
      errors.push(`Row ${i + 1}: expected ${required.length} columns, got ${values.length}`);
      continue;
    }
    const get = (col: string) => values[header.indexOf(col)]?.trim().replace(/^"|"$/g, "") ?? "";
    offers.push({
      offerId: get("offer_id"),
      sku: get("sku"),
      name: get("name"),
      category: get("category"),
      tagline: get("tagline"),
      description: get("description"),
      valueProp: get("value_prop"),
      priceDisplay: get("price_display"),
      cta: get("cta"),
    });
  }

  return { offers, errors };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += char;
  }
  result.push(current);
  return result;
}

export function upsertOffers(offers: Offer[]): void {
  for (const offer of offers) {
    offerMap.set(offer.offerId, offer);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/offer-store.ts
git commit -m "feat(voice-campaigns): offer store with mock data and CSV parser"
```

---

## Task 3: Voice Campaign Store

**Files:**
- Create: `src/lib/voice-campaign-store.ts`

- [ ] **Step 1: Create voice campaign store**

```typescript
// src/lib/voice-campaign-store.ts
import type { VoiceCampaign, VoiceCall, VoiceCampaignStatus } from "./voice-campaign-types";

const campaignMap = new Map<string, VoiceCampaign>();

export function saveCampaign(campaign: VoiceCampaign): void {
  campaignMap.set(campaign.id, campaign);
}

export function getCampaign(id: string): VoiceCampaign | undefined {
  return campaignMap.get(id);
}

export function listCampaigns(): VoiceCampaign[] {
  return Array.from(campaignMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function updateCampaignStatus(id: string, status: VoiceCampaignStatus, batchCallId?: string): void {
  const c = campaignMap.get(id);
  if (!c) return;
  campaignMap.set(id, {
    ...c,
    status,
    ...(batchCallId ? { batchCallId } : {}),
    ...(status === "in_progress" ? { launchedAt: new Date().toISOString() } : {}),
  });
}

// Called when ElevenLabs webhook fires for a single call
export function upsertCall(campaignId: string, call: Partial<VoiceCall> & { id: string }): void {
  const c = campaignMap.get(campaignId);
  if (!c) return;
  const existing = c.calls.find((cl) => cl.id === call.id);
  const updated: VoiceCall = existing
    ? { ...existing, ...call }
    : {
        id: call.id,
        toNumber: call.toNumber ?? "",
        status: call.status ?? "calling",
        engaged: call.engaged ?? false,
        ...call,
      };
  const calls = existing
    ? c.calls.map((cl) => (cl.id === call.id ? updated : cl))
    : [...c.calls, updated];

  // Mark campaign completed when all calls have a terminal status
  const terminalStatuses = new Set(["completed", "failed", "no_answer"]);
  const allDone = calls.length > 0 && calls.every((cl) => terminalStatuses.has(cl.status));

  campaignMap.set(campaignId, {
    ...c,
    calls,
    status: allDone ? "completed" : c.status,
  });
}

// Seed call stubs when batch is submitted (one per phone number)
export function seedCallStubs(campaignId: string, phoneNumbers: string[]): void {
  const c = campaignMap.get(campaignId);
  if (!c) return;
  const stubs: VoiceCall[] = phoneNumbers.map((num, i) => ({
    id: `pending-${campaignId}-${i}`,
    toNumber: num,
    status: "queued",
    engaged: false,
  }));
  campaignMap.set(campaignId, { ...c, calls: stubs });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/voice-campaign-store.ts
git commit -m "feat(voice-campaigns): in-memory voice campaign store"
```

---

## Task 4: ElevenLabs Client

**Files:**
- Create: `src/lib/elevenlabs-client.ts`

> **Before implementing:** Verify the exact API endpoints in the ElevenLabs dashboard at https://elevenlabs.io/docs/eleven-agents/overview. The endpoints below are based on available documentation and may need adjustment.

- [ ] **Step 1: Create ElevenLabs client**

```typescript
// src/lib/elevenlabs-client.ts

const BASE_URL = "https://api.elevenlabs.io";

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

function headers(): Record<string, string> {
  return {
    "xi-api-key": getApiKey(),
    "Content-Type": "application/json",
  };
}

/**
 * Creates an ElevenLabs conversational AI agent with the given script.
 * Returns the agent_id to use for batch calls.
 */
export async function createAgent(args: {
  name: string;
  script: string;
  firstMessage: string;
  voiceId: string;
}): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/convai/agents`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: args.name,
      conversation_config: {
        agent: {
          prompt: { prompt: args.script },
          first_message: args.firstMessage,
        },
        tts: { voice_id: args.voiceId },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs createAgent failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { agent_id: string };
  return data.agent_id;
}

/**
 * Submits a batch outbound call campaign via ElevenLabs.
 * Recipients is an array of { phone_number, name? }.
 * Returns the batch_call_id.
 *
 * ElevenLabs accepts a CSV file as multipart form-data for the recipient list.
 */
export async function submitBatchCall(args: {
  agentId: string;
  phoneNumberId: string;
  batchName: string;
  recipients: Array<{ phone_number: string; name?: string }>;
}): Promise<string> {
  // Build recipient CSV
  const csvLines = ["phone_number,name"];
  for (const r of args.recipients) {
    csvLines.push(`${r.phone_number},${r.name ?? "User"}`);
  }
  const csvBlob = new Blob([csvLines.join("\n")], { type: "text/csv" });

  const form = new FormData();
  form.append("agent_id", args.agentId);
  form.append("phone_number_id", args.phoneNumberId);
  form.append("name", args.batchName);
  form.append("recipients", csvBlob, "recipients.csv");

  // Remove Content-Type so fetch sets it with the correct multipart boundary
  const { "Content-Type": _ct, ...headersWithoutCT } = headers();

  const res = await fetch(`${BASE_URL}/v1/convai/batches`, {
    method: "POST",
    headers: headersWithoutCT,
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs submitBatchCall failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { batch_call_id?: string; id?: string };
  return data.batch_call_id ?? data.id ?? "";
}
```

- [ ] **Step 2: Add env vars to `.env.example`**

Open `src/../.env.example` and append:

```bash
# ElevenLabs (Voice Campaigns)
ELEVENLABS_API_KEY=
ELEVENLABS_PHONE_NUMBER_ID=   # ID of provisioned DID in ElevenLabs dashboard
ELEVENLABS_WEBHOOK_URL=       # Public URL for call-end webhooks (ngrok in dev, Railway URL in prod)
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/elevenlabs-client.ts .env.example
git commit -m "feat(voice-campaigns): ElevenLabs client (createAgent + submitBatchCall)"
```

---

## Task 5: Script Generation Prompt

**Files:**
- Create: `src/lib/prompts/voice-campaign.ts`

- [ ] **Step 1: Create prompt builder**

```typescript
// src/lib/prompts/voice-campaign.ts
import type { Offer } from "@/lib/offer-types";
import type { Segment } from "@/lib/types";

export interface ScriptPromptResult {
  script: string;
  firstMessage: string;
  reasoning: string;
}

export function buildVoiceCampaignScriptPrompt(
  segment: Pick<Segment, "name" | "sql" | "userCount" | "description">,
  offer: Offer,
  language: string
): { system: string; user: string } {
  const system = `You are an expert call script writer for outbound sales campaigns. You write natural, conversational scripts for AI voice agents.

Rules:
- The script is what the agent says AFTER the opening. It should be warm, concise, and benefit-led.
- Use [name] as a placeholder where the customer's name should appear.
- Keep the script under 150 words. Cold calls must be short.
- End with the exact CTA text provided — do not paraphrase it.
- The "firstMessage" is the agent's very first line (a greeting + name check). Keep it under 20 words.
- Write in ${language}.
- Do not use filler phrases like "Absolutely!" or "Great question!".

Respond with a JSON object exactly matching this schema:
{
  "script": "<full script body — does NOT include the firstMessage>",
  "firstMessage": "<opening greeting, under 20 words>",
  "reasoning": "<1-2 sentences on why this framing suits this segment>"
}`;

  const user = `Segment: "${segment.name}"
Users: ${segment.userCount.toLocaleString()}
Description: ${segment.description || segment.sql}

Offer:
- Name: ${offer.name}
- Category: ${offer.category}
- Tagline: ${offer.tagline}
- Description: ${offer.description}
- Key benefit: ${offer.valueProp}
- Price / rate: ${offer.priceDisplay}
- CTA (use exactly): "${offer.cta}"

Write the call script.`;

  return { system, user };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/prompts/voice-campaign.ts
git commit -m "feat(voice-campaigns): script generation prompt builder"
```

---

## Task 6: Offers API

**Files:**
- Create: `src/app/api/offers/route.ts`

- [ ] **Step 1: Create offers API route**

```typescript
// src/app/api/offers/route.ts
import { auth } from "@clerk/nextjs/server";
import { listOffers, parseOffersCsv, upsertOffers } from "@/lib/offer-store";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ offers: listOffers() });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let csvText: string;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });
    csvText = await file.text();
  } else {
    csvText = await req.text();
  }

  const { offers, errors } = parseOffersCsv(csvText);
  if (offers.length === 0) {
    return Response.json({ error: "No valid offers parsed", details: errors }, { status: 400 });
  }

  upsertOffers(offers);
  return Response.json({ imported: offers.length, errors });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/offers/route.ts
git commit -m "feat(voice-campaigns): offers API (list + CSV upload)"
```

---

## Task 7: Generate Script API

**Files:**
- Create: `src/app/api/voice-campaigns/generate-script/route.ts`

- [ ] **Step 1: Create generate-script route**

```typescript
// src/app/api/voice-campaigns/generate-script/route.ts
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { generateText } from "@/lib/llm";
import { getSegment } from "@/lib/server/segment-repo";
import { getOffer } from "@/lib/offer-store";
import { buildVoiceCampaignScriptPrompt } from "@/lib/prompts/voice-campaign";
import type { ScriptPromptResult } from "@/lib/prompts/voice-campaign";

const Schema = z.object({
  segmentId: z.string().min(1),
  offerId: z.string().min(1),
  language: z.string().default("English"),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { segmentId, offerId, language } = parsed.data;

  const segment = getSegment(userId, segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const offer = getOffer(offerId);
  if (!offer) return Response.json({ error: "Offer not found" }, { status: 404 });

  const { system, user } = buildVoiceCampaignScriptPrompt(segment, offer, language);

  const raw = await generateText({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonSchema: {
      name: "voice_campaign_script",
      schema: {
        type: "object",
        properties: {
          script: { type: "string" },
          firstMessage: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["script", "firstMessage", "reasoning"],
        additionalProperties: false,
      },
      strict: true,
    },
    feature: "voice-campaigns.generate-script",
    label: "voice campaign script generation",
  });

  const result = JSON.parse(raw) as ScriptPromptResult;
  return Response.json(result);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/voice-campaigns/generate-script/route.ts
git commit -m "feat(voice-campaigns): generate-script API route"
```

---

## Task 8: Voice Campaigns CRUD API

**Files:**
- Create: `src/app/api/voice-campaigns/route.ts`
- Create: `src/app/api/voice-campaigns/[id]/route.ts`

- [ ] **Step 1: Create list + create route**

```typescript
// src/app/api/voice-campaigns/route.ts
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { saveCampaign, listCampaigns } from "@/lib/voice-campaign-store";
import { createAgent } from "@/lib/elevenlabs-client";
import { getOffer } from "@/lib/offer-store";
import { getSegment } from "@/lib/server/segment-repo";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

const CreateSchema = z.object({
  segmentId: z.string().min(1),
  offerId: z.string().min(1),
  script: z.string().min(1),
  firstMessage: z.string().min(1),
  scriptReasoning: z.string(),
  voice: z.string().min(1),
  language: z.string().default("English"),
  phoneNumbers: z.array(z.string().min(1)).min(1).max(500),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ campaigns: listCampaigns() });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { segmentId, offerId, script, firstMessage, scriptReasoning, voice, language, phoneNumbers } = parsed.data;

  const segment = getSegment(userId, segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const offer = getOffer(offerId);
  if (!offer) return Response.json({ error: "Offer not found" }, { status: 404 });

  const id = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `${offer.name} · ${segment.name}`;

  // Create the ElevenLabs agent
  let agentId: string;
  try {
    agentId = await createAgent({ name, script, firstMessage, voiceId: voice });
  } catch (err) {
    return Response.json({ error: `ElevenLabs agent creation failed: ${(err as Error).message}` }, { status: 502 });
  }

  const campaign: VoiceCampaign = {
    id,
    name,
    segmentId,
    segmentName: segment.name,
    offerId,
    offerName: offer.name,
    script,
    scriptReasoning,
    agentId,
    voice,
    language,
    phoneNumbers,
    status: "launching",
    calls: [],
    createdAt: new Date().toISOString(),
  };

  saveCampaign(campaign);
  return Response.json({ id, name, agentId });
}
```

- [ ] **Step 2: Create detail route**

```typescript
// src/app/api/voice-campaigns/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { getCampaign } from "@/lib/voice-campaign-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(campaign);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/voice-campaigns/route.ts src/app/api/voice-campaigns/[id]/route.ts
git commit -m "feat(voice-campaigns): campaigns CRUD API (list, create, detail)"
```

---

## Task 9: Launch + Webhook API

**Files:**
- Create: `src/app/api/voice-campaigns/[id]/launch/route.ts`
- Create: `src/app/api/voice-campaigns/[id]/webhook/route.ts`

- [ ] **Step 1: Create launch route**

```typescript
// src/app/api/voice-campaigns/[id]/launch/route.ts
import { auth } from "@clerk/nextjs/server";
import { getCampaign, updateCampaignStatus, seedCallStubs } from "@/lib/voice-campaign-store";
import { submitBatchCall } from "@/lib/elevenlabs-client";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  if (campaign.status !== "launching") {
    return Response.json({ error: "Campaign already launched" }, { status: 409 });
  }

  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!phoneNumberId) return Response.json({ error: "ELEVENLABS_PHONE_NUMBER_ID not configured" }, { status: 500 });

  const recipients = campaign.phoneNumbers.map((num) => ({ phone_number: num }));

  let batchCallId: string;
  try {
    batchCallId = await submitBatchCall({
      agentId: campaign.agentId,
      phoneNumberId,
      batchName: campaign.name,
      recipients,
    });
  } catch (err) {
    return Response.json({ error: `ElevenLabs batch call failed: ${(err as Error).message}` }, { status: 502 });
  }

  seedCallStubs(id, campaign.phoneNumbers);
  updateCampaignStatus(id, "in_progress", batchCallId);

  return Response.json({ batchCallId });
}
```

- [ ] **Step 2: Create webhook route**

```typescript
// src/app/api/voice-campaigns/[id]/webhook/route.ts
// Receives ElevenLabs call-end events. No auth — ElevenLabs calls this directly.
// Event payload shape is based on ElevenLabs Conversational AI webhook docs.

import { upsertCall, listCampaigns } from "@/lib/voice-campaign-store";

interface ElevenLabsCallEvent {
  type: string;                        // e.g. "conversation_ended"
  conversation_id: string;
  batch_call_id?: string;
  phone_number?: string;
  duration_seconds?: number;
  transcript?: string;
  summary?: string;
  status?: string;                     // "completed" | "failed" | "no_answer"
}

// Find which campaign owns this conversation (by batchCallId or scan)
function findCampaignId(event: ElevenLabsCallEvent): string | undefined {
  if (event.batch_call_id) {
    const all = listCampaigns();
    return all.find((c) => c.batchCallId === event.batch_call_id)?.id;
  }
  return undefined;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await req.json() as ElevenLabsCallEvent;

  const campaignId = id !== "unknown" ? id : findCampaignId(event);
  if (!campaignId) return Response.json({ ok: false, reason: "campaign not found" });

  if (event.type === "conversation_ended" || event.conversation_id) {
    const durationSeconds = event.duration_seconds;
    upsertCall(campaignId, {
      id: event.conversation_id,
      toNumber: event.phone_number ?? "",
      status: (event.status as "completed" | "failed" | "no_answer") ?? "completed",
      durationSeconds,
      engaged: (durationSeconds ?? 0) >= 20,
      summary: event.summary,
      endedAt: new Date().toISOString(),
    });
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/voice-campaigns/[id]/launch/route.ts src/app/api/voice-campaigns/[id]/webhook/route.ts
git commit -m "feat(voice-campaigns): launch + webhook API routes"
```

---

## Task 10: Feature Flag + Sidebar Nav

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Add feature flag**

In `src/lib/feature-flags.ts`, add `"voice-campaigns"` to the `FeatureId` union:

```typescript
export type FeatureId =
  | "scouts"
  | "store"
  | "connectors"
  | "playbooks"
  | "forecasting"
  | "knowledge"
  | "metrics"
  | "explorer"
  | "boards"
  | "catalog"
  | "metric-tree"
  | "segments"
  | "credits"
  | "funnels"
  | "retentions"
  | "ad-creative"
  | "campaigns"
  | "voice-campaigns"   // ← add this
  | "admin";
```

- [ ] **Step 2: Add sidebar nav item**

In `src/components/sidebar.tsx`:

1. Add `Phone` to the lucide-react import at the top:
```typescript
import {
  // ... existing imports ...
  Phone,
} from "lucide-react";
```

2. Add to `getActivePage`:
```typescript
if (pathname.startsWith("/voice-campaigns")) return "voice-campaigns";
```

3. Add to `ALL_NAV_ITEMS` array (after Campaigns):
```typescript
{ icon: Phone, label: "Voice", href: "/voice-campaigns", page: "voice-campaigns", feature: "voice-campaigns" as FeatureId },
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/feature-flags.ts src/components/sidebar.tsx
git commit -m "feat(voice-campaigns): feature flag + sidebar nav item"
```

---

## Task 11: Campaign List Page

**Files:**
- Create: `src/app/voice-campaigns/page.tsx`

- [ ] **Step 1: Create campaign list page**

```typescript
// src/app/voice-campaigns/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Phone, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function engagementRate(campaign: VoiceCampaign): string {
  const connected = campaign.calls.filter((c) =>
    ["connected", "completed"].includes(c.status)
  ).length;
  const engaged = campaign.calls.filter((c) => c.engaged).length;
  if (connected === 0) return "—";
  return `${Math.round((engaged / connected) * 100)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  launching: "Launching",
  in_progress: "In Progress",
  completed: "Completed",
};

export default function VoiceCampaignsPage() {
  const [campaigns, setCampaigns] = useState<VoiceCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ campaigns: VoiceCampaign[] }>("/api/voice-campaigns", { skipModel: true })
      .then((res) => setCampaigns(res.campaigns))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="max-w-5xl mx-auto px-6 py-8 w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold">Voice Campaigns</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Outbound AI voice calls to user segments
            </p>
          </div>
          <Link
            href="/voice-campaigns/new"
            className="flex items-center gap-2 text-sm font-medium border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Campaign
          </Link>
        </div>

        {loading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {!loading && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Phone className="w-10 h-10 text-muted-foreground mb-4" />
            <h2 className="text-sm font-medium mb-1">No voice campaigns yet</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Pick a segment and an offer to launch your first campaign
            </p>
            <Link
              href="/voice-campaigns/new"
              className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
            >
              New Campaign
            </Link>
          </div>
        )}

        {!loading && campaigns.length > 0 && (
          <div className="flex flex-col gap-2">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/voice-campaigns/${c.id}`}
                className="flex items-center justify-between border border-border rounded-lg px-4 py-3 hover:bg-muted transition-colors"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.calls.length} call{c.calls.length !== 1 ? "s" : ""} · 20s rate {engagementRate(c)} · {relativeTime(c.createdAt)}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground border border-border rounded px-2 py-0.5 ml-4 shrink-0">
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/voice-campaigns/page.tsx
git commit -m "feat(voice-campaigns): campaign list page"
```

---

## Task 12: Campaign Creation Page

**Files:**
- Create: `src/app/voice-campaigns/new/page.tsx`

- [ ] **Step 1: Create the two-panel creation page**

```typescript
// src/app/voice-campaigns/new/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { Offer } from "@/lib/offer-types";
import type { Segment } from "@/lib/types";

// Parse raw textarea input into cleaned phone number array
function parsePhoneNumbers(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Mask phone for display: +91 98765 43210 → +91 987•••210
function maskPhone(num: string): string {
  if (num.length < 7) return num;
  return num.slice(0, num.length - 6) + "•••" + num.slice(-3);
}

export default function NewVoiceCampaignPage() {
  const router = useRouter();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [offerId, setOfferId] = useState("");
  const [voice, setVoice] = useState("EXAVITQu4vr4xnSDxMaL"); // Rachel — ElevenLabs default
  const [language, setLanguage] = useState("English");
  const [phoneRaw, setPhoneRaw] = useState("");
  const [generating, setGenerating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [script, setScript] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);

  const phoneNumbers = parsePhoneNumbers(phoneRaw);

  useEffect(() => {
    // Load segments and offers in parallel
    Promise.all([
      apiFetch<Segment[]>("/api/segments", { skipModel: true }),
      apiFetch<{ offers: Offer[] }>("/api/offers", { skipModel: true }),
    ]).then(([segs, offRes]) => {
      setSegments(Array.isArray(segs) ? segs : []);
      setOffers(offRes.offers);
      if (segs.length > 0) setSegmentId(segs[0].id);
      if (offRes.offers.length > 0) setOfferId(offRes.offers[0].offerId);
    });
  }, []);

  async function handleGenerate() {
    if (!segmentId || !offerId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch<{ script: string; firstMessage: string; reasoning: string }>(
        "/api/voice-campaigns/generate-script",
        { method: "POST", body: { segmentId, offerId, language }, skipModel: true }
      );
      setScript(res.script);
      setFirstMessage(res.firstMessage);
      setReasoning(res.reasoning);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleLaunch() {
    if (!script || phoneNumbers.length === 0) return;
    setLaunching(true);
    setError(null);
    try {
      // Step 1: create campaign + EL agent
      const { id } = await apiFetch<{ id: string }>(
        "/api/voice-campaigns",
        {
          method: "POST",
          body: { segmentId, offerId, script, firstMessage, scriptReasoning: reasoning, voice, language, phoneNumbers },
          skipModel: true,
        }
      );

      // Step 2: dispatch batch call
      await apiFetch(`/api/voice-campaigns/${id}/launch`, { method: "POST", skipModel: true });

      router.push(`/voice-campaigns/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setLaunching(false);
    }
  }

  const selectedSegment = segments.find((s) => s.id === segmentId);
  const selectedOffer = offers.find((o) => o.offerId === offerId);
  const canGenerate = !!segmentId && !!offerId;
  const canLaunch = !!script && phoneNumbers.length > 0 && !launching;

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="max-w-5xl mx-auto px-6 py-8 w-full">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">New Voice Campaign</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a segment and offer — Sentinel writes the script
          </p>
        </div>

        {error && (
          <div className="mb-4 text-sm text-destructive border border-destructive/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          {/* Left: configure */}
          <div className="flex flex-col gap-5 border border-border rounded-lg p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Configure
            </p>

            {/* Segment */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Segment</label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="text-sm border border-border rounded-md px-3 py-2 bg-background"
              >
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.userCount.toLocaleString()} users
                  </option>
                ))}
              </select>
            </div>

            {/* Offer */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Offer</label>
              <div className="flex flex-col gap-2">
                {offers.map((o) => (
                  <button
                    key={o.offerId}
                    onClick={() => setOfferId(o.offerId)}
                    className={`text-left border rounded-md px-3 py-2 transition-colors ${
                      offerId === o.offerId ? "border-foreground" : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="text-sm font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{o.tagline}</div>
                    <div className="text-xs text-muted-foreground">{o.priceDisplay}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="text-sm border border-border rounded-md px-3 py-2 bg-background"
              >
                <option>English</option>
                <option>Hindi</option>
                <option>Hinglish</option>
              </select>
            </div>

            {/* Phone numbers */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Phone Numbers</label>
              <textarea
                value={phoneRaw}
                onChange={(e) => setPhoneRaw(e.target.value)}
                placeholder={"+91 98765 43210\n+91 87654 32109"}
                rows={4}
                className="text-sm border border-border rounded-md px-3 py-2 bg-background resize-none font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {phoneNumbers.length} number{phoneNumbers.length !== 1 ? "s" : ""}
              </p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className="flex items-center justify-center gap-2 text-sm font-medium border border-border rounded-md px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50"
            >
              {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {generating ? "Generating…" : "Generate Script →"}
            </button>
          </div>

          {/* Right: script */}
          <div className="flex flex-col gap-4 border border-border rounded-lg p-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Generated Script
            </p>

            {!script && !generating && (
              <div className="flex flex-col items-center justify-center flex-1 text-center text-sm text-muted-foreground py-16">
                Configure and click Generate Script
              </div>
            )}

            {generating && (
              <div className="flex items-center justify-center flex-1 py-16">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {script && !generating && (
              <>
                {reasoning && (
                  <div className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 leading-relaxed">
                    <span className="font-medium text-foreground">Why this script: </span>
                    {reasoning}
                  </div>
                )}

                {firstMessage && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">Opening line</label>
                    <textarea
                      value={firstMessage}
                      onChange={(e) => setFirstMessage(e.target.value)}
                      rows={2}
                      className="text-sm border border-border rounded-md px-3 py-2 bg-background resize-none font-mono"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs text-muted-foreground">Script</label>
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    rows={10}
                    className="text-sm border border-border rounded-md px-3 py-2 bg-background resize-none font-mono leading-relaxed"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleGenerate}
                    className="text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={handleLaunch}
                    disabled={!canLaunch}
                    className="flex-1 flex items-center justify-center gap-2 text-sm font-medium bg-foreground text-background rounded-md px-3 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    {launching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {launching
                      ? "Launching…"
                      : `Launch ${phoneNumbers.length} Call${phoneNumbers.length !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/voice-campaigns/new/page.tsx
git commit -m "feat(voice-campaigns): campaign creation page (two-panel)"
```

---

## Task 13: Campaign Detail Page

**Files:**
- Create: `src/app/voice-campaigns/[id]/page.tsx`

- [ ] **Step 1: Create campaign detail + results page**

```typescript
// src/app/voice-campaigns/[id]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { VoiceCampaign, VoiceCall } from "@/lib/voice-campaign-types";

function maskPhone(num: string): string {
  if (num.length < 7) return num;
  return num.slice(0, num.length - 6) + "•••" + num.slice(-3);
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function avgDuration(calls: VoiceCall[]): string {
  const completed = calls.filter((c) => c.durationSeconds !== undefined);
  if (completed.length === 0) return "—";
  const avg = Math.round(
    completed.reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0) / completed.length
  );
  return formatDuration(avg);
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  calling: "Calling…",
  connected: "Connected",
  completed: "Done",
  failed: "Failed",
  no_answer: "No Answer",
};

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  launching: "Launching",
  in_progress: "In Progress",
  completed: "Completed",
};

export default function VoiceCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [campaign, setCampaign] = useState<VoiceCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<VoiceCampaign>(`/api/voice-campaigns/${id}`, { skipModel: true })
      .then((c) => { setCampaign(c); setLoading(false); })
      .catch((err) => { setError((err as Error).message); setLoading(false); });
  }

  useEffect(() => {
    load();
  }, [id]);

  // Auto-refresh every 5s while in progress
  useEffect(() => {
    if (!campaign || campaign.status === "completed") return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [campaign?.status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <p className="text-sm text-destructive">{error ?? "Campaign not found"}</p>
      </div>
    );
  }

  const connected = campaign.calls.filter((c) => ["connected", "completed"].includes(c.status)).length;
  const engaged = campaign.calls.filter((c) => c.engaged).length;
  const connectRate = campaign.calls.length > 0
    ? `${Math.round((connected / campaign.calls.length) * 100)}%`
    : "—";
  const engagedRate = connected > 0
    ? `${Math.round((engaged / connected) * 100)}%`
    : "—";

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="max-w-5xl mx-auto px-6 py-8 w-full">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex flex-col gap-1">
            <Link
              href="/voice-campaigns"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
            >
              <ArrowLeft className="w-3 h-3" /> Voice Campaigns
            </Link>
            <h1 className="text-xl font-semibold">{campaign.name}</h1>
            <p className="text-sm text-muted-foreground">
              {campaign.calls.length} call{campaign.calls.length !== 1 ? "s" : ""} ·{" "}
              {campaign.launchedAt
                ? `launched ${new Date(campaign.launchedAt).toLocaleTimeString()}`
                : "not yet launched"}
            </p>
          </div>
          <span className="text-xs text-muted-foreground border border-border rounded px-2 py-1">
            {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-px border border-border rounded-lg overflow-hidden mb-6">
          {[
            { label: "Total Calls", value: campaign.calls.length.toString(), sub: null },
            { label: "Connected", value: connected.toString(), sub: connectRate + " rate" },
            { label: "20s Engaged", value: engaged.toString(), sub: engagedRate + " of connected" },
            { label: "Avg Duration", value: avgDuration(campaign.calls), sub: "connected calls" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-background px-5 py-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
              <p className="text-2xl font-semibold">{value}</p>
              {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Call log */}
        <div className="border border-border rounded-lg overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Call Log
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left px-5 py-2 font-normal">Number</th>
                <th className="text-left px-5 py-2 font-normal">Status</th>
                <th className="text-left px-5 py-2 font-normal">Duration</th>
                <th className="text-left px-5 py-2 font-normal">20s</th>
                <th className="text-left px-5 py-2 font-normal">Summary</th>
              </tr>
            </thead>
            <tbody>
              {campaign.calls.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-sm text-muted-foreground">
                    Calls will appear here as they connect
                  </td>
                </tr>
              )}
              {campaign.calls.map((call) => (
                <tr key={call.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-mono text-xs">{maskPhone(call.toNumber)}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs border border-border rounded px-2 py-0.5">
                      {STATUS_LABEL[call.status] ?? call.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {formatDuration(call.durationSeconds)}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {call.status === "completed"
                      ? call.engaged
                        ? <span className="font-medium">✓ Yes</span>
                        : <span className="text-muted-foreground">— No</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground max-w-xs truncate">
                    {call.summary ?? (call.status === "calling" ? "In progress…" : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Script (collapsed by default) */}
        <details className="border border-border rounded-lg">
          <summary className="px-5 py-3 text-xs text-muted-foreground cursor-pointer select-none">
            Script used in this campaign
          </summary>
          <div className="px-5 pb-4 text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap border-t border-border pt-3">
            {campaign.firstMessage && (
              <p className="mb-3 text-foreground font-sans text-xs">
                <strong>Opening:</strong> {campaign.firstMessage}
              </p>
            )}
            {campaign.script}
          </div>
        </details>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/voice-campaigns/[id]/page.tsx
git commit -m "feat(voice-campaigns): campaign detail + live results page"
```

---

## Post-Implementation Checklist

- [ ] Set `ELEVENLABS_API_KEY` in `.env.local`
- [ ] Set `ELEVENLABS_PHONE_NUMBER_ID` (get from ElevenLabs dashboard after connecting a Twilio number)
- [ ] Set `ELEVENLABS_WEBHOOK_URL` (use `ngrok http 3000` locally; copy the https URL + `/api/voice-campaigns/unknown/webhook`)
- [ ] In ElevenLabs dashboard: configure the webhook URL under your workspace settings
- [ ] Verify ElevenLabs API endpoints match: `POST /v1/convai/agents` and `POST /v1/convai/batches` — adjust in `elevenlabs-client.ts` if different
- [ ] Run `pnpm dev`, navigate to `/voice-campaigns`, create a test campaign with your phone number

---

## Out of Scope (v1)
- Test/control experimentation split
- Contact list CSV upload (numbers pasted manually)
- Scheduling calls for later
- DND registry filtering
- Call recording playback
