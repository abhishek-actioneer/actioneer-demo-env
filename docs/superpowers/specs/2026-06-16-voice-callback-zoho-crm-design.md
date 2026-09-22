# Voice Callback Scheduling + Zoho CRM Push

**Date:** 2026-06-16  
**Status:** Approved  
**Branch:** feat/clerk-auth-merged

## Problem

When a voice campaign call ends in one of two ways:
1. Caller says they are **busy / unavailable**
2. Agent decides to **transfer to a human agent**

…the agent currently does nothing structured. No callback time is collected, no record lands in Zoho CRM.

## Goal

- Agent asks caller for preferred callback time before ending/transferring
- After call ends: Gemini extracts summary, next steps, callback preference from transcript
- Zoho CRM is updated: Note + Task on the Contact/Lead record
- A per-call detail page exists so the Zoho Note can deep-link to full transcript + recording

---

## Section 1: Voice Prompt Change

`buildGeminiContextOnlyPrompt()` in `src/lib/voice-campaign-runner.ts` gains a new universal section added to every prompt:

```
[CALLBACK SCHEDULING]
If the customer says they are busy or unavailable: ask "Aapke liye kaunsa waqt theek rahega?" Wait for their answer. Confirm it back in one sentence. Then close the call politely.
If you are transferring to a human agent: before transferring, ask the same question, confirm their answer, then proceed with the transfer.
Never skip this step. Never suggest a time yourself.
```

Language mirrors the caller per the existing `[LANGUAGE]` rule. The section is added universally — not scoped to campaign type.

---

## Section 2: Post-call Extraction

**New file:** `src/lib/voice-call-outcome-extractor.ts`

Triggered from `closeBoth()` in `src/lib/plivo-gemini-live-bridge.ts` after every call that has ≥2 transcript turns.

Runs a single Gemini call (`generateContent`, JSON mode) on the `VoiceTranscriptTurn[]` array.

**Extracted schema:**
```typescript
{
  summary: string           // 2-3 sentence call summary
  nextSteps: string[]       // commitments made, e.g. ["Callback Tuesday afternoon"]
  callbackPreference: string | null  // exact words caller said, null if not mentioned
  outcome: "busy" | "transferred" | "interested" | "not_interested" | "completed"
}
```

**New fields on `VoiceCall`** (`src/lib/voice-campaign-types.ts`):
```typescript
aiSummary?: string
aiNextSteps?: string[]
callbackPreference?: string | null
zohoSyncStatus?: "pending" | "synced" | "failed"
```

Extraction is fire-and-forget (async, does not block hangup). On completion it triggers the Zoho push.

---

## Section 3: Zoho CRM Push

**New file:** `src/lib/zoho-crm-client.ts`

**Credentials (env vars):**
```
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
ZOHO_REFRESH_TOKEN
ZOHO_API_DOMAIN=https://www.zohoapis.in
```

**Token management:** POST to `{ZOHO_API_DOMAIN}/oauth/v2/token` with refresh token. Cache access token in-memory with expiry timestamp. Auto-refresh on expiry.

**Contact lookup flow:**
1. Search Contacts by phone number (`Phone` field)
2. If not found: search by `userId` in custom field `CF_Customer_ID`
3. If still not found: create a Lead with phone + userId

**Note created on Contact/Lead:**
```
Subject: Voice Call – {campaignName} – {date}

Summary: {aiSummary}

Next Steps:
• {step}
• {step}

Callback Preference: {callbackPreference | "Not mentioned"}
Outcome: {outcome}

---
Call Details: https://demo.actioneer.com/voice-campaigns/{campaignId}/calls/{callId}
Recording: {call.recording | "Not available"}
```

**Task created** (only if `callbackPreference` is non-null):
```
Subject: Callback – {phoneNumber}
Description: Customer preferred: "{callbackPreference}"
Status: Not Started
Due Date: today + 2 days (fallback — human agent to confirm exact time)
```

Raw natural language stored as-is — no NLP date parsing. Human agent reads it and sets the real time in Zoho.

`zohoSyncStatus` updates to `"synced"` on success, `"failed"` on error (error logged to console).

---

## Section 4: Per-call Detail Page

**New route:** `src/app/voice-campaigns/[id]/calls/[callId]/page.tsx`

Displays:
- Call metadata: number, duration, status, outcome
- AI summary + next steps + callback preference (from `aiSummary`, `aiNextSteps`, `callbackPreference`)
- Transcript (turn-by-turn, role-labelled)
- Recording player (Plivo URL or bridge recording URL if available)

This URL is what lands in the Zoho Note's "Call Details" link.

---

## New Files

| File | Purpose |
|------|---------|
| `src/lib/zoho-crm-client.ts` | Token refresh, contact lookup, note + task creation |
| `src/lib/voice-call-outcome-extractor.ts` | Gemini extraction of summary/next steps/callback |
| `src/app/api/integrations/zoho/callback/route.ts` | OAuth callback (returns code for initial token setup) |
| `src/app/voice-campaigns/[id]/calls/[callId]/page.tsx` | Per-call detail view |

## Modified Files

| File | Change |
|------|--------|
| `src/lib/voice-campaign-types.ts` | Add `aiSummary`, `aiNextSteps`, `callbackPreference`, `zohoSyncStatus` to `VoiceCall` |
| `src/lib/voice-campaign-runner.ts` | Add `[CALLBACK SCHEDULING]` section to `buildGeminiContextOnlyPrompt()` |
| `src/lib/plivo-gemini-live-bridge.ts` | Hook `closeBoth()` to trigger extraction + Zoho push async |

---

## Out of Scope

- NLP date parsing of callback preference (stored raw)
- Multi-tenant Zoho credentials (single org for now)
- Zoho webhook back into baby-sentinel
- UI for configuring Zoho credentials (env vars only)
