# Voice Callback Scheduling + Zoho CRM Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a caller says they're busy or gets transferred to a human agent, the voice AI asks for their preferred callback time, then pushes a call summary + next steps + callback preference to Zoho CRM as a Note and Task on their Contact/Lead record. Works for both live campaign calls and browser-based live test calls.

**Architecture:** Prompt change teaches the agent to collect callback time. After every call with ≥2 transcript turns, the existing `analyzeVoiceCallResponse()` in `voice-response-analysis.ts` is auto-triggered (it already extracts outcome, summary, nextStep via LLM — we add `callbackPreference` to its schema). The hook fires in both `plivo-gemini-live-bridge.ts` and `voice-test-bridge.ts` `closeBoth()` functions. Zoho CRM client (token-refreshing) looks up the Contact/Lead by phone then userId, creates a Note with full context and a deep-link to the per-call detail page, and creates a Task if callback was mentioned.

**Tech Stack:** Existing `voice-response-analysis.ts` (extended), Zoho CRM REST API v2 (OAuth2 refresh token), Next.js App Router (client page + existing GET campaign route)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/voice-campaign-types.ts` | Modify | Add `callbackPreference` to `VoiceCallAnalysis`; add `zohoSyncStatus` to `VoiceCall` |
| `src/lib/voice-response-analysis.ts` | Modify | Add `callbackPreference` to `LLMVoiceCallAnalysis`, `VoiceCallAnalysis`, and JSON schema |
| `src/lib/voice-campaign-runner.ts` | Modify | Add `[CALLBACK SCHEDULING]` section to `buildGeminiContextOnlyPrompt()` |
| `src/lib/zoho-crm-client.ts` | Create | Token refresh, contact lookup, Note + Task creation |
| `src/lib/plivo-gemini-live-bridge.ts` | Modify | Hook `closeBoth()` to auto-trigger analysis + Zoho push |
| `src/lib/voice-test-bridge.ts` | Modify | Same hook in `closeBoth()` for browser live test calls |
| `src/app/voice-campaigns/[id]/calls/[callId]/page.tsx` | Create | Per-call detail page (transcript, recording, AI summary) |
| `src/app/api/integrations/zoho/callback/route.ts` | Create | OAuth callback stub (shows code for future re-auth) |

---

## Task 1: Add callbackPreference + zohoSyncStatus to Types

**Files:**
- Modify: `src/lib/voice-campaign-types.ts`

- [ ] **Step 1: Add `callbackPreference` to `VoiceCallAnalysis` and `zohoSyncStatus` to `VoiceCall`**

Open `src/lib/voice-campaign-types.ts`.

In `VoiceCallAnalysis` (line ~114), add `callbackPreference` after `nextStep`:
```typescript
export interface VoiceCallAnalysis {
  outcome: VoiceCallOutcome;
  summary: string;
  reason: string;
  customerNeed?: string;
  nextStep?: string;
  callbackPreference?: string | null;   // ADD THIS
  confidence: number;
  source: "llm" | "heuristic" | "status";
  inputHash: string;
  analyzedAt: string;
}
```

In `VoiceCall` (line ~126), add `zohoSyncStatus` after `followUps`:
```typescript
  followUps?: VoiceFollowUp[];
  zohoSyncStatus?: "pending" | "synced" | "failed";   // ADD THIS
  endedBy?: VoiceCallEndedBy;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/voice-campaign-types.ts
git commit -m "feat: add callbackPreference to VoiceCallAnalysis, zohoSyncStatus to VoiceCall"
```

---

## Task 2: Add Callback Scheduling to Prompt

**Files:**
- Modify: `src/lib/voice-campaign-runner.ts`

- [ ] **Step 1: Add the `[CALLBACK SCHEDULING]` section to `buildGeminiContextOnlyPrompt()`**

In `src/lib/voice-campaign-runner.ts`, find the `parts` array inside `buildGeminiContextOnlyPrompt()` (around line 198). Add the callback scheduling block after the routing lines and before the concern handling line:

```typescript
  const parts: Array<string | undefined> = [
    // ... existing parts ...
    routingLines ? `\nROUTING:\n${routingLines}` : undefined,
    "",
    // ADD THIS BLOCK:
    [
      "CALLBACK SCHEDULING:",
      "- If the customer says they are busy or unavailable: ask \"Aapke liye kaunsa waqt theek rahega?\" (mirror their language). Wait for their answer. Confirm it back in one sentence. Then close the call politely.",
      "- If you are transferring to a human agent: before transferring, ask the same question, confirm their answer, then proceed with the transfer.",
      "- Never skip this step. Never suggest a time yourself.",
    ].join("\n"),
    "",
    // ... existing concern handling line ...
    "If the customer raises any concern: acknowledge briefly, address it, then return to the guide.",
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/voice-campaign-runner.ts
git commit -m "feat: add callback scheduling instruction to voice agent prompt"
```

---

## Task 3: Extend voice-response-analysis with callbackPreference

**Files:**
- Modify: `src/lib/voice-response-analysis.ts`

The existing `analyzeVoiceCallResponse()` already extracts `outcome`, `summary`, `reason`, `nextStep` via LLM. We add `callbackPreference` to it.

- [ ] **Step 1: Add `callbackPreference` to `LLMVoiceCallAnalysis` interface**

In `src/lib/voice-response-analysis.ts`, find `interface LLMVoiceCallAnalysis` (~line 11). Add the field:

```typescript
interface LLMVoiceCallAnalysis {
  outcome: VoiceCallOutcome;
  summary: string;
  reason: string;
  customerNeed: string;
  nextStep: string;
  callbackPreference: string | null;   // ADD THIS
  confidence: number;
}
```

- [ ] **Step 2: Add `callbackPreference` to the JSON schema in `analyzeVoiceCallResponse()`**

Find the `jsonSchema` object inside `analyzeVoiceCallResponse()` (~line 285). Add to `properties` and `required`:

```typescript
properties: {
  outcome: { type: "string", enum: OUTCOMES },
  summary: { type: "string" },
  reason: { type: "string" },
  customerNeed: { type: "string" },
  nextStep: { type: "string" },
  callbackPreference: { type: ["string", "null"] },   // ADD THIS
  confidence: { type: "number" },
},
required: ["outcome", "summary", "reason", "customerNeed", "nextStep", "callbackPreference", "confidence"],
```

- [ ] **Step 3: Thread `callbackPreference` through `sanitizeLLMAnalysis()`**

Find `sanitizeLLMAnalysis()` (~line 226). Add `callbackPreference` to the spread:

```typescript
function sanitizeLLMAnalysis(call: VoiceCall, raw: LLMVoiceCallAnalysis): VoiceCallAnalysis {
  return baseAnalysis(
    call,
    normalizeOutcome(raw.outcome),
    raw.summary,
    raw.reason,
    "llm",
    {
      customerNeed: raw.customerNeed,
      nextStep: raw.nextStep,
      callbackPreference: raw.callbackPreference ?? null,   // ADD THIS
      confidence: raw.confidence,
    },
  );
}
```

- [ ] **Step 4: Add `callbackPreference` to `baseAnalysis()` patch param**

Find `baseAnalysis()` (~line 139). Add `callbackPreference` to the patch type and the returned object:

```typescript
function baseAnalysis(
  call: VoiceCall,
  outcome: VoiceCallOutcome,
  summary: string,
  reason: string,
  source: VoiceCallAnalysis["source"],
  patch: Partial<Pick<VoiceCallAnalysis, "customerNeed" | "nextStep" | "callbackPreference" | "confidence">> = {},
): VoiceCallAnalysis {
  return {
    outcome,
    summary: cleanText(summary, 360) || "No customer response captured yet.",
    reason: cleanText(reason, 360) || "Insufficient call content for deeper analysis.",
    customerNeed: cleanText(patch.customerNeed, 180) || undefined,
    nextStep: cleanText(patch.nextStep, 180) || undefined,
    callbackPreference: patch.callbackPreference ?? null,   // ADD THIS
    confidence: normalizeConfidence(patch.confidence ?? (source === "llm" ? 0.7 : 0.45)),
    source,
    inputHash: voiceCallAnalysisInputHash(call),
    analyzedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/voice-response-analysis.ts
git commit -m "feat: add callbackPreference to voice call analysis LLM schema and output"
```

---

## Task 4: Create Zoho CRM Client

**Files:**
- Create: `src/lib/zoho-crm-client.ts`

- [ ] **Step 1: Add env vars to `.env.local`** (if not already present)

```bash
grep -l "ZOHO_REFRESH_TOKEN" /Users/vimarsh/Documents/baby-sentinel/.env.local 2>/dev/null || echo "Add to .env.local:"
```

Ensure `.env.local` contains:
```
ZOHO_CLIENT_ID=1000.GF1CBBVMWVSUTZT7W51DJTMZQMVV3D
ZOHO_CLIENT_SECRET=49e66c65d0acc3bbe36c3170ce949dd53de01df9b3
ZOHO_REFRESH_TOKEN=1000.7cb486d621467e767fc4d388e4d77187.b4010824a7a0267a0cf77357d27b74bc
ZOHO_API_DOMAIN=https://www.zohoapis.in
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.in
```

- [ ] **Step 2: Create the Zoho CRM client file**

```typescript
// src/lib/zoho-crm-client.ts

const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in";
const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
  });
  const res = await fetch(`${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    body: params,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);
  cachedToken = {
    value: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in as number) * 1000,
  };
  return cachedToken.value;
}

async function zohoGet(path: string): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v2/${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function zohoPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch(`${ZOHO_API_DOMAIN}/crm/v2/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function findContactByPhone(phone: string): Promise<string | null> {
  const data = await zohoGet(
    `Contacts/search?criteria=((Phone:equals:${encodeURIComponent(phone)}))`,
  );
  return ((data?.data as Array<{ id: string }>)?.[0]?.id) ?? null;
}

async function findContactByUserId(userId: string): Promise<string | null> {
  const data = await zohoGet(
    `Contacts/search?criteria=((CF_Customer_ID:equals:${encodeURIComponent(userId)}))`,
  );
  return ((data?.data as Array<{ id: string }>)?.[0]?.id) ?? null;
}

async function createLead(phone: string, userId: string): Promise<string> {
  const data = await zohoPost("Leads", {
    data: [{ Last_Name: phone, Phone: phone, CF_Customer_ID: userId }],
  });
  return ((data?.data as Array<{ details: { id: string } }>)?.[0]?.details?.id) ?? "";
}

async function resolveOrCreateRecord(
  phone: string,
  userId: string,
): Promise<{ module: "Contacts" | "Leads"; id: string }> {
  const byPhone = await findContactByPhone(phone);
  if (byPhone) return { module: "Contacts", id: byPhone };

  const byUserId = await findContactByUserId(userId);
  if (byUserId) return { module: "Contacts", id: byUserId };

  const leadId = await createLead(phone, userId);
  return { module: "Leads", id: leadId };
}

export interface ZohoCrmPushInput {
  campaignId: string;
  callId: string;
  campaignName: string;
  phone: string;
  userId: string;
  summary: string;
  nextStep: string | null;
  callbackPreference: string | null;
  outcome: string;
  recordingUrl?: string;
  baseUrl: string;
}

export async function pushCallToZohoCrm(input: ZohoCrmPushInput): Promise<void> {
  const { module, id } = await resolveOrCreateRecord(input.phone, input.userId);

  const callUrl = `${input.baseUrl}/voice-campaigns/${input.campaignId}/calls/${input.callId}`;
  const date = new Date().toLocaleDateString("en-IN");

  const noteLines = [
    `Summary: ${input.summary}`,
    "",
    ...(input.nextStep ? [`Next Step: ${input.nextStep}`, ""] : []),
    `Callback Preference: ${input.callbackPreference ?? "Not mentioned"}`,
    `Outcome: ${input.outcome}`,
    "",
    "---",
    `Call Details: ${callUrl}`,
    ...(input.recordingUrl ? [`Recording: ${input.recordingUrl}`] : []),
  ];

  await zohoPost("Notes", {
    data: [
      {
        Note_Title: `Voice Call – ${input.campaignName} – ${date}`,
        Note_Content: noteLines.join("\n"),
        Parent_Id: id,
        $se_module: module,
      },
    ],
  });

  if (input.callbackPreference) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);
    await zohoPost("Tasks", {
      data: [
        {
          Subject: `Callback – ${input.phone}`,
          Description: `Customer preferred: "${input.callbackPreference}"`,
          Status: "Not Started",
          Due_Date: dueDate.toISOString().split("T")[0],
          ...(module === "Contacts" ? { Who_Id: { id } } : {}),
        },
      ],
    });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/zoho-crm-client.ts
git commit -m "feat: add Zoho CRM client (token refresh, contact lookup, note + task creation)"
```

---

## Task 5: Hook closeBoth() in Both Bridges

**Files:**
- Modify: `src/lib/plivo-gemini-live-bridge.ts`
- Modify: `src/lib/voice-test-bridge.ts`

Both bridges have a `closeBoth()` function. We add the same async post-call hook to each. The hook calls the existing `analyzeVoiceCallResponse()` (extended in Task 3) then pushes to Zoho.

### 5a — plivo-gemini-live-bridge.ts

- [ ] **Step 1: Add imports**

At the top of `src/lib/plivo-gemini-live-bridge.ts`, add:

```typescript
import { analyzeVoiceCallResponse } from "./voice-response-analysis";
import { pushCallToZohoCrm } from "./zoho-crm-client";
import { getCampaign } from "./voice-campaign-store";
```

Note: `upsertCall` is already imported — do not duplicate.

- [ ] **Step 2: Add hook inside `closeBoth()` after `sessionDump.close({...})`**

Find `closeBoth()` (~line 706). After the `sessionDump.close({...})` block and before the closing `}`, add:

```typescript
    // Post-call: run analysis + push to Zoho — async, does not block hangup
    if (liveTranscriptTurns.length >= 2 && callConfig?.campaignId && currentCallUuid) {
      const capturedCampaignId = callConfig.campaignId;
      const capturedCallUuid = currentCallUuid;
      const capturedToNumber = callConfig.toNumber;
      const capturedUserId =
        (callConfig.customerContext as { investorId?: string } | undefined)?.investorId ??
        capturedToNumber;
      void (async () => {
        try {
          const campaign = getCampaign(capturedCampaignId);
          if (!campaign) return;
          const call = campaign.calls.find((c) => c.id === capturedCallUuid || c.callConfigId === capturedCallUuid);
          if (!call) return;
          upsertCall(capturedCampaignId, { id: capturedCallUuid, zohoSyncStatus: "pending" });
          const analysis = await analyzeVoiceCallResponse(campaign, call);
          upsertCall(capturedCampaignId, { id: capturedCallUuid, analysis });
          if (process.env.ZOHO_REFRESH_TOKEN) {
            await pushCallToZohoCrm({
              campaignId: capturedCampaignId,
              callId: capturedCallUuid,
              campaignName: campaign.name,
              phone: capturedToNumber,
              userId: capturedUserId,
              summary: analysis.summary,
              nextStep: analysis.nextStep ?? null,
              callbackPreference: analysis.callbackPreference ?? null,
              outcome: analysis.outcome,
              baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "https://demo.actioneer.com",
            });
            upsertCall(capturedCampaignId, { id: capturedCallUuid, zohoSyncStatus: "synced" });
          }
        } catch (err) {
          console.error("[voice/gemini-live] Post-call analysis/Zoho push failed:", err);
          upsertCall(capturedCampaignId, { id: capturedCallUuid, zohoSyncStatus: "failed" });
        }
      })();
    }
```

### 5b — voice-test-bridge.ts

- [ ] **Step 3: Add imports**

At the top of `src/lib/voice-test-bridge.ts`, add:

```typescript
import { analyzeVoiceCallResponse } from "./voice-response-analysis";
import { pushCallToZohoCrm } from "./zoho-crm-client";
import { getCampaign } from "./voice-campaign-store";
```

Note: `upsertCall` is already imported — do not duplicate.

- [ ] **Step 4: Add hook inside `closeBoth()` after `finalizeLiveTestCall()`**

Find `closeBoth()` (~line 429). After `finalizeLiveTestCall()` and before closing WebSockets, add:

```typescript
    // Post-call: run analysis + push to Zoho — async, does not block close
    if (transcriptTurns.length >= 2 && campaignId && liveTestCallId) {
      const capturedCampaignId = campaignId;
      const capturedCallId = liveTestCallId;
      void (async () => {
        try {
          const campaign = getCampaign(capturedCampaignId);
          if (!campaign) return;
          const call = campaign.calls.find((c) => c.id === capturedCallId || c.callConfigId === capturedCallId);
          if (!call) return;
          upsertCall(capturedCampaignId, { id: capturedCallId, zohoSyncStatus: "pending" });
          const analysis = await analyzeVoiceCallResponse(campaign, call);
          upsertCall(capturedCampaignId, { id: capturedCallId, analysis });
          if (process.env.ZOHO_REFRESH_TOKEN) {
            await pushCallToZohoCrm({
              campaignId: capturedCampaignId,
              callId: capturedCallId,
              campaignName: campaign.name,
              phone: call.toNumber,
              userId: (call.recipientContext as { investorId?: string } | undefined)?.investorId ?? call.toNumber,
              summary: analysis.summary,
              nextStep: analysis.nextStep ?? null,
              callbackPreference: analysis.callbackPreference ?? null,
              outcome: analysis.outcome,
              baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "https://demo.actioneer.com",
            });
            upsertCall(capturedCampaignId, { id: capturedCallId, zohoSyncStatus: "synced" });
          }
        } catch (err) {
          console.error("[voice/test-bridge] Post-call analysis/Zoho push failed:", err);
          upsertCall(capturedCampaignId, { id: capturedCallId, zohoSyncStatus: "failed" });
        }
      })();
    }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plivo-gemini-live-bridge.ts src/lib/voice-test-bridge.ts
git commit -m "feat: auto-trigger analysis + Zoho push on call close in both bridges"
```

---

## Task 6: Per-Call Detail Page

**Files:**
- Create: `src/app/voice-campaigns/[id]/calls/[callId]/page.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /Users/vimarsh/Documents/baby-sentinel/src/app/voice-campaigns/\[id\]/calls/\[callId\]
```

- [ ] **Step 2: Create the page**

```typescript
// src/app/voice-campaigns/[id]/calls/[callId]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { VoiceCampaign, VoiceCall } from "@/lib/voice-campaign-types";

function withDataset(url: string) {
  return url;
}

export default function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string; callId: string }>;
}) {
  const { id: campaignId, callId } = use(params);
  const [campaign, setCampaign] = useState<VoiceCampaign | null>(null);
  const [call, setCall] = useState<VoiceCall | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<VoiceCampaign>(`/api/voice-campaigns/${campaignId}`, { skipModel: true })
      .then((c) => {
        setCampaign(c);
        const found = c.calls.find((cl) => cl.id === callId || cl.callConfigId === callId);
        setCall(found ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [campaignId, callId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!campaign || !call) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Call not found.
      </div>
    );
  }

  const recordingUrl =
    call.recording?.twilioUrl ??
    (call.recording?.sid && call.id
      ? `/api/voice/recordings/${call.id}/${call.recording.sid}`
      : null);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="max-w-3xl mx-auto px-6 py-8 w-full space-y-6">
        {/* Header */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {campaign.name} · {call.toNumber.replace(/(\d{2})\d+(\d{3})/, "$1…$2")}
          </p>
          <h1 className="text-lg font-semibold">Call Detail</h1>
        </div>

        {/* Metadata */}
        <div className="border rounded-md divide-y text-sm">
          <Row label="Status" value={call.status} />
          <Row label="Outcome" value={call.analysis?.outcome ?? "—"} />
          <Row
            label="Duration"
            value={call.durationSeconds != null ? `${call.durationSeconds}s` : "—"}
          />
          <Row label="Started" value={call.startedAt ? new Date(call.startedAt).toLocaleString("en-IN") : "—"} />
          <Row label="Zoho Sync" value={call.zohoSyncStatus ?? "not synced"} />
        </div>

        {/* AI Summary */}
        {(call.aiSummary || call.aiNextSteps?.length || call.callbackPreference) && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">AI Summary</h2>
            <div className="border rounded-md p-4 text-sm space-y-3">
              {call.aiSummary && <p className="text-muted-foreground">{call.aiSummary}</p>}
              {call.aiNextSteps && call.aiNextSteps.length > 0 && (
                <div>
                  <p className="font-medium mb-1">Next Steps</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                    {call.aiNextSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {call.callbackPreference && (
                <div>
                  <p className="font-medium mb-0.5">Callback Preference</p>
                  <p className="text-muted-foreground">{call.callbackPreference}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Recording */}
        {recordingUrl && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Recording</h2>
            <audio controls src={recordingUrl} className="w-full" />
          </section>
        )}

        {/* Transcript */}
        {call.transcript && call.transcript.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Transcript</h2>
            <div className="border rounded-md divide-y text-sm">
              {call.transcript.map((turn) => (
                <div key={turn.id} className="px-4 py-3 flex gap-3">
                  <span
                    className={`text-xs font-medium shrink-0 mt-0.5 ${
                      turn.role === "assistant" ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {turn.role === "assistant" ? "Agent" : "Caller"}
                  </span>
                  <p className="text-muted-foreground">{turn.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-4 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Verify page loads**

Start dev server if not running: `pnpm dev`

Visit: `http://localhost:3000/voice-campaigns/any-id/calls/any-callid`

Expected: "Call not found." message (no crash, no 404 from Next.js router).

- [ ] **Step 5: Commit**

```bash
git add "src/app/voice-campaigns/[id]/calls/[callId]/page.tsx"
git commit -m "feat: add per-call detail page with transcript, recording, AI summary"
```

---

## Task 7: OAuth Callback Stub

**Files:**
- Create: `src/app/api/integrations/zoho/callback/route.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/app/api/integrations/zoho/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  return NextResponse.json({ code, message: "Exchange this code for a refresh token." });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/vimarsh/Documents/baby-sentinel && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/integrations/zoho/callback/route.ts
git commit -m "feat: add Zoho OAuth callback stub"
```

---

## Task 8: End-to-End Smoke Test

- [ ] **Step 1: Verify env vars are set**

```bash
grep -E "ZOHO_CLIENT_ID|ZOHO_REFRESH_TOKEN|ZOHO_API_DOMAIN" /Users/vimarsh/Documents/baby-sentinel/.env.local
```

Expected: all three lines present.

- [ ] **Step 2: Test token refresh manually**

```bash
curl -s -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=refresh_token" \
  -d "client_id=$(grep ZOHO_CLIENT_ID /Users/vimarsh/Documents/baby-sentinel/.env.local | cut -d= -f2)" \
  -d "client_secret=$(grep ZOHO_CLIENT_SECRET /Users/vimarsh/Documents/baby-sentinel/.env.local | cut -d= -f2)" \
  -d "refresh_token=$(grep ZOHO_REFRESH_TOKEN /Users/vimarsh/Documents/baby-sentinel/.env.local | cut -d= -f2)" \
  | python3 -m json.tool
```

Expected: `{"access_token": "...", "expires_in": 3600, ...}`

- [ ] **Step 3: Verify the prompt addition**

Make a test call via `/voice-kyc-demo`. After call connects and the agent speaks the opening, say "Main abhi busy hoon" (I am busy right now). 

Expected agent behavior: asks "Aapke liye kaunsa waqt theek rahega?" — waits — confirms the time back — closes the call politely.

- [ ] **Step 4: Verify Zoho push in session dump**

After the call ends, check the session dump:

```bash
ls -t /Users/vimarsh/Documents/baby-sentinel/data/voice-callback-dumps/plivo-gemini-live-session/ | head -1 | xargs -I{} python3 -c "import json; d=json.load(open('data/voice-callback-dumps/plivo-gemini-live-session/{}'))" 2>/dev/null || echo "check logs"
```

Check server logs for: `[voice/gemini-live] Post-call extraction/Zoho push failed` (should NOT appear).

- [ ] **Step 5: Verify Zoho CRM**

Log into Zoho CRM → Contacts or Leads → search by the test phone number. Confirm:
- A Note exists with the call summary, next steps, callback preference, and call detail URL
- If callback was mentioned: a Task exists with `Status: Not Started`
