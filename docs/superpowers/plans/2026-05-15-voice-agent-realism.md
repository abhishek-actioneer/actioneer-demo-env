# Voice Agent Realism & Expressiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ElevenLabs voice agent sound like a warm, natural Indian girl — richer delivery tag palette, feminine Hinglish speech patterns, and a pronunciation dictionary for common Hinglish words.

**Architecture:** Four independent changes: (1) bug fixes in webhook + prompt, (2) pronunciation dictionary file + one-time upload script, (3) expanded `elevenLabsAgentPrompt()` with new tag palette and feminine speech section, (4) dictionary locator injection in the outbound call payload.

**Tech Stack:** TypeScript, ElevenLabs Pronunciation Dictionary API (REST), W3C PLS XML format, Next.js API routes

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/app/api/voice/elevenlabs-webhook/route.ts` | Modify | Fix `undefined` status → `"failed"` |
| `src/lib/prompts/voice-campaign.ts` | Modify | Strip duplicate delivery-rules instruction |
| `data/girl-expressions-dict.pls` | Create | W3C PLS alias dictionary for Hinglish expressions |
| `scripts/upload-pronunciation-dict.ts` | Create | One-time upload script, prints dict ID + version |
| `src/lib/elevenlabs-agent-client.ts` | Modify | Expanded `elevenLabsAgentPrompt()` + dict locator injection |
| `.env.example` | Modify | Add `ELEVENLABS_PRONUNCIATION_DICT_ID` + `_VERSION` |

---

## Task 1: Fix `statusFromElevenLabs` — undefined maps to "failed"

**Files:**
- Modify: `src/app/api/voice/elevenlabs-webhook/route.ts:82-89`

Current code treats `undefined` status as `"completed"` because the first branch checks `!normalized`. This silently marks calls complete when ElevenLabs fires the webhook with a missing status field.

- [ ] **Open** `src/app/api/voice/elevenlabs-webhook/route.ts`

- [ ] **Replace** the `statusFromElevenLabs` function (lines 82–89):

```typescript
function statusFromElevenLabs(status: string | undefined): VoiceCallStatus {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "done" || normalized === "completed" || normalized === "success") return "completed";
  if (normalized === "no_answer" || normalized === "no-answer") return "no_answer";
  return "failed";
}
```

- [ ] **Verify** by mentally tracing: `statusFromElevenLabs(undefined)` → `normalized` is `undefined` → falls through all branches → returns `"failed"`. ✓

- [ ] **Commit**
```bash
git add src/app/api/voice/elevenlabs-webhook/route.ts
git commit -m "fix: undefined ElevenLabs call status maps to failed, not completed"
```

---

## Task 2: Strip duplicate delivery rules from LLM generation prompt

**Files:**
- Modify: `src/lib/prompts/voice-campaign.ts:36-48`

`buildVoiceCampaignScriptPrompt()` currently instructs the LLM to generate an "Eleven v3 delivery rules" section inside the system prompt. `elevenLabsAgentPrompt()` (in `elevenlabs-agent-client.ts`) then appends the same rules again. The agent sees them twice. We keep the hardcoded append (Task 4) and remove the LLM instruction.

- [ ] **Open** `src/lib/prompts/voice-campaign.ts`

- [ ] **Remove** lines 36–48 (the delivery rules instruction block):

```
- Include an "Eleven v3 delivery rules" section in the system prompt:
  - Use audio tags rarely and intentionally.
  - Allowed tags for this call: [curious] for a gentle question, [sighs] only for brief empathy.
  - Do not use [whispers], [shout], [excited], [laughs], sound-effect tags, theatrical tags, SSML, <break> tags, or markdown.
  - Use at most one audio tag, and only at the start of a response.
  - Most responses should have no tag.
  - Use commas, short sentences, and at most one ellipsis for a small pause.
  - Do not stack ellipses or dashes.
```

The surrounding lines (the "Speech normalization" section below it, and the lines above it) stay untouched.

- [ ] **Verify** the file still compiles: `pnpm build 2>&1 | head -20`

- [ ] **Commit**
```bash
git add src/lib/prompts/voice-campaign.ts
git commit -m "fix: remove duplicate ElevenLabs delivery rules from LLM generation prompt"
```

---

## Task 3: Create the Hinglish girl-expressions pronunciation dictionary

**Files:**
- Create: `data/girl-expressions-dict.pls`

W3C PLS format with alias rules. Alias rules replace a written grapheme with a phonetically natural spelling — they work on ElevenLabs v3. The aliases below are starting points; tune by listening after upload (re-run the upload script from Task 4 with edited entries, get a new version ID).

- [ ] **Create** `data/girl-expressions-dict.pls`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0"
  xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon
    http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/PLS.xsd"
  alphabet="ipa"
  xml:lang="hi">

  <!-- Affirmations -->
  <lexeme><grapheme>haan</grapheme><alias>hahn</alias></lexeme>
  <lexeme><grapheme>haan ji</grapheme><alias>hahn jee</alias></lexeme>
  <lexeme><grapheme>achha</grapheme><alias>utcha</alias></lexeme>
  <lexeme><grapheme>achha achha</grapheme><alias>utcha utcha</alias></lexeme>
  <lexeme><grapheme>bilkul</grapheme><alias>bil-kool</alias></lexeme>
  <lexeme><grapheme>zaroor</grapheme><alias>za-roor</alias></lexeme>
  <lexeme><grapheme>theek hai</grapheme><alias>teek hay</alias></lexeme>
  <lexeme><grapheme>theek hai na</grapheme><alias>teek hay na</alias></lexeme>
  <lexeme><grapheme>theek</grapheme><alias>teek</alias></lexeme>

  <!-- Fillers and connectors -->
  <lexeme><grapheme>arey</grapheme><alias>a-ray</alias></lexeme>
  <lexeme><grapheme>arey yaar</grapheme><alias>a-ray yaar</alias></lexeme>
  <lexeme><grapheme>yaar</grapheme><alias>yaar</alias></lexeme>
  <lexeme><grapheme>bas</grapheme><alias>bus</alias></lexeme>
  <lexeme><grapheme>toh</grapheme><alias>toh</alias></lexeme>
  <lexeme><grapheme>matlab</grapheme><alias>mut-lub</alias></lexeme>
  <lexeme><grapheme>waise</grapheme><alias>why-say</alias></lexeme>
  <lexeme><grapheme>waise bhi</grapheme><alias>why-say bhee</alias></lexeme>
  <lexeme><grapheme>suno</grapheme><alias>su-no</alias></lexeme>
  <lexeme><grapheme>dekho</grapheme><alias>dek-ho</alias></lexeme>
  <lexeme><grapheme>bolo</grapheme><alias>bo-lo</alias></lexeme>
  <lexeme><grapheme>chalega</grapheme><alias>chuh-lay-ga</alias></lexeme>

  <!-- Negations -->
  <lexeme><grapheme>nahi</grapheme><alias>nuh-hee</alias></lexeme>
  <lexeme><grapheme>nahi nahi</grapheme><alias>nuh-hee nuh-hee</alias></lexeme>
  <lexeme><grapheme>mat karo</grapheme><alias>mut kuh-ro</alias></lexeme>

  <!-- Empathy sounds -->
  <lexeme><grapheme>uff</grapheme><alias>oof</alias></lexeme>
  <lexeme><grapheme>haan samjha</grapheme><alias>hahn sumjha</alias></lexeme>
  <lexeme><grapheme>samjha</grapheme><alias>sumjha</alias></lexeme>

  <!-- Natural closers -->
  <lexeme><grapheme>ek sec</grapheme><alias>ek seck</alias></lexeme>
  <lexeme><grapheme>kya</grapheme><alias>kyaa</alias></lexeme>
  <lexeme><grapheme>haan bolo</grapheme><alias>hahn bo-lo</alias></lexeme>

</lexicon>
```

- [ ] **Commit**
```bash
git add data/girl-expressions-dict.pls
git commit -m "feat: add Hinglish girl-expressions pronunciation dictionary (PLS)"
```

---

## Task 4: Create the upload script

**Files:**
- Create: `scripts/upload-pronunciation-dict.ts`

One-time script. Run it once, paste the printed IDs into `.env`, done. Re-run when you edit the `.pls` file to get a new version ID.

- [ ] **Create** `scripts/upload-pronunciation-dict.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Set ELEVENLABS_API_KEY in your environment before running this script.");
  process.exit(1);
}

const plsPath = path.resolve(process.cwd(), "data/girl-expressions-dict.pls");
if (!fs.existsSync(plsPath)) {
  console.error(`PLS file not found at: ${plsPath}`);
  process.exit(1);
}

const plsContent = fs.readFileSync(plsPath);

const formData = new FormData();
formData.append(
  "file",
  new Blob([plsContent], { type: "application/pls+xml" }),
  "girl-expressions-dict.pls",
);
formData.append("name", "girl-expressions-dict");
formData.append("description", "Hinglish girl expressions and fillers for Indian voice agent");

const residency = process.env.ELEVENLABS_RESIDENCY?.trim().toLowerCase();
const baseUrl =
  process.env.ELEVENLABS_API_BASE_URL?.trim().replace(/\/+$/, "") ||
  (residency === "india" || residency === "in"
    ? "https://api.in.residency.elevenlabs.io"
    : residency === "eu" || residency === "europe"
      ? "https://api.eu.residency.elevenlabs.io"
      : "https://api.elevenlabs.io");

const url = `${baseUrl}/v1/pronunciation-dictionaries/add-from-file`;
console.log(`Uploading to: ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: { "xi-api-key": apiKey },
  body: formData,
});

if (!res.ok) {
  const err = await res.text();
  console.error(`Upload failed (${res.status}):`, err);
  process.exit(1);
}

const data = await res.json() as { id?: string; version_id?: string };
if (!data.id || !data.version_id) {
  console.error("Unexpected response shape:", JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log("\n✓ Pronunciation dictionary uploaded successfully.\n");
console.log("Add these to your .env:\n");
console.log(`ELEVENLABS_PRONUNCIATION_DICT_ID=${data.id}`);
console.log(`ELEVENLABS_PRONUNCIATION_DICT_VERSION=${data.version_id}`);
```

- [ ] **Run the script** (requires `ELEVENLABS_API_KEY` in env):
```bash
ELEVENLABS_API_KEY=your_key npx tsx scripts/upload-pronunciation-dict.ts
```

Expected output:
```
Uploading to: https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file
✓ Pronunciation dictionary uploaded successfully.

Add these to your .env:

ELEVENLABS_PRONUNCIATION_DICT_ID=abc123...
ELEVENLABS_PRONUNCIATION_DICT_VERSION=v1_xyz...
```

If you get a 404, the endpoint path may differ. Try `${baseUrl}/v1/pronunciation-dictionaries` with the same form data — ElevenLabs occasionally reorganises their API paths.

- [ ] **Paste** the printed IDs into `.env`:
```
ELEVENLABS_PRONUNCIATION_DICT_ID=<printed value>
ELEVENLABS_PRONUNCIATION_DICT_VERSION=<printed value>
```

- [ ] **Commit** the script (not the `.env` values):
```bash
git add scripts/upload-pronunciation-dict.ts
git commit -m "feat: add one-time script to upload Hinglish pronunciation dictionary to ElevenLabs"
```

---

## Task 5: Expand `elevenLabsAgentPrompt()` and inject pronunciation dictionary

**Files:**
- Modify: `src/lib/elevenlabs-agent-client.ts:89-166`

Two changes in one file: (a) rewrite `elevenLabsAgentPrompt()` with expanded tag palette + feminine Hinglish speech section, (b) add pronunciation dictionary locators to the `tts` block in the outbound call payload.

- [ ] **Replace** `elevenLabsAgentPrompt()` (lines 89–103):

```typescript
function elevenLabsAgentPrompt(systemPrompt: string): string {
  return `${systemPrompt}

--- ElevenLabs v3 Voice Runtime Rules ---

DELIVERY TAGS — one per response maximum, at the very start only. Most responses: no tag.

  [laughs]   — a genuine light moment, something mildly amusing. Never on a serious topic.
  [exhales]  — before answering something thoughtful or tricky. Signals considering.
  [sighs]    — real empathy for a genuine concern. At most once per call.
  [curious]  — a soft, gentle permission question.
  [excited]  — a real positive reveal. At most once per call.

Never use: [whispers], [shout], [crying], [snorts], [laughs harder], any sound effect, or any other tag.
Never put a tag mid-sentence or on a factual or neutral response.

PACING: short sentences, commas for natural pause, one ellipsis maximum. Never stack ... or use — dashes.

FEMININE HINGLISH SPEECH:
- Affirmations: "haan", "achha", "theek hai", "bilkul" — not "okay", "sure", "of course"
- Bridging before a pivot: "achha, samjha... toh basically" — not "I understand, let me explain"
- Fillers: "haan... ek sec" — not "one moment please"
- Soft questions with rising intonation: "aap ke paas SIP chal rahi hai already, right?"
- Rapport laughter: [laughs] + "arey yaar" for genuine light moments only
- Self-reference always feminine: "bol rahi hoon", "samajh rahi hoon", "dekh rahi hoon"
  Never: "bol raha hoon", "samajh raha hoon"
- Two sentences max per turn before pausing for the caller`;
}
```

- [ ] **Add** pronunciation dictionary locator reading above `ttsOverride` (after line ~110, before `const ttsOverride`):

```typescript
const dictId = process.env.ELEVENLABS_PRONUNCIATION_DICT_ID?.trim();
const dictVersion = process.env.ELEVENLABS_PRONUNCIATION_DICT_VERSION?.trim();
```

- [ ] **Replace** the `ttsOverride` block (lines 111–119) to include the dictionary locator:

```typescript
const ttsOverride = {
  ...(process.env.ELEVENLABS_VOICE_ID ? { voice_id: process.env.ELEVENLABS_VOICE_ID } : {}),
  ...(envNumber("ELEVENLABS_TTS_SPEED", 0.7, 1.2) !== undefined
    ? { speed: envNumber("ELEVENLABS_TTS_SPEED", 0.7, 1.2) }
    : {}),
  ...(envNumber("ELEVENLABS_TTS_STABILITY", 0, 1) !== undefined
    ? { stability: envNumber("ELEVENLABS_TTS_STABILITY", 0, 1) }
    : {}),
  ...(dictId && dictVersion
    ? { pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: dictId, version_id: dictVersion }] }
    : {}),
};
```

- [ ] **Verify** the file compiles: `pnpm build 2>&1 | head -30`

- [ ] **Commit**
```bash
git add src/lib/elevenlabs-agent-client.ts
git commit -m "feat: expand ElevenLabs agent prompt with 5-tag palette, feminine Hinglish speech, and pronunciation dictionary injection"
```

---

## Task 6: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Add** the two new vars to the ElevenLabs section, after `ELEVENLABS_WEBHOOK_SECRET=`:

```
# Pronunciation dictionary for Hinglish girl expressions.
# Upload once with: npx tsx scripts/upload-pronunciation-dict.ts
ELEVENLABS_PRONUNCIATION_DICT_ID=
ELEVENLABS_PRONUNCIATION_DICT_VERSION=
```

- [ ] **Commit**
```bash
git add .env.example
git commit -m "chore: add ELEVENLABS_PRONUNCIATION_DICT_ID and _VERSION to env example"
```

---

## Task 7: End-to-end smoke test

No automated test is possible here without a live ElevenLabs account and a real phone number. Do this manually after all tasks are committed.

- [ ] Set `VOICE_AGENT_PROVIDER=elevenlabs` in local `.env`
- [ ] Confirm `ELEVENLABS_PRONUNCIATION_DICT_ID` and `ELEVENLABS_PRONUNCIATION_DICT_VERSION` are set (from Task 4)
- [ ] Start dev server: `pnpm dev`
- [ ] Create a test campaign with a FundsIndia segment and any offer
- [ ] Launch to a real Indian mobile number you control
- [ ] Listen for:
  - **Pronunciation**: does the agent say "hahn" (Indian "haan") or "han" (English)?
  - **Delivery tags**: does the agent occasionally use `[exhales]` before a thoughtful answer?
  - **Feminine speech**: does it say "bol rahi hoon" not "bol raha hoon"? Does it use "achha" as an affirmation?
  - **No duplicates**: delivery rules should not appear twice in the system prompt (verify by logging the prompt in `elevenLabsAgentPrompt()` if needed)
- [ ] If pronunciation aliases sound wrong, edit `data/girl-expressions-dict.pls` and re-run the upload script to get a new version ID
