# Voice Agent Realism & Expressiveness

**Date:** 2026-05-15  
**Scope:** ElevenLabs outbound call path only  
**Goal:** Make the voice agent sound like a warm, natural Indian girl — not a robot reading a script

---

## Problem

The current agent is expressive in theory but flat in practice:

1. **Pronunciation** — Hinglish fillers ("haan", "achha", "arey", "uff") are mispronounced or flattened by ElevenLabs because the model sees them as transliteration noise, not natural speech
2. **Delivery tags** — only `[curious]` and `[sighs]` are allowed; the agent can't laugh, exhale, or build real rapport
3. **Feminine speech patterns** — the prompt gives gender-consistency rules but no concrete Hinglish speech guidance; the LLM defaults to generic English phrasing
4. **Duplicate rules** — `voice-campaign.ts` instructs the LLM to include delivery rules AND `elevenLabsAgentPrompt()` appends them again; the agent sees them twice

---

## Design

### Part 1 — Pronunciation Dictionary

Create a W3C PLS alias-rule dictionary for ~35 common Hinglish words and fillers. Alias rules replace a written form with a phonetically natural approximation — they work on ElevenLabs v3 (unlike phoneme tags which are v2 only).

**File:** `data/girl-expressions-dict.pls`

Entries cover:
- Affirmations: haan, achha, theek hai, bilkul, zaroor, haan ji
- Fillers/connectors: arey, bas, yaar, suno, dekho, matlab, matlab yeh hai
- Negations: nahi, nahi nahi, mat karo
- Empathy sounds: uff, oh, achha achha, haan samjha
- Transitions: toh, toh basically, waise, waise bhi
- Natural closers: theek hai na, okay na, chalega

Alias form for each entry is a phonetically natural spelling that ElevenLabs renders well. Exact forms are determined by listening tests during implementation — the upload script makes iteration fast (upload → test call → adjust).

**Upload script:** `scripts/upload-pronunciation-dict.ts`
- Reads the `.pls` file
- POSTs to ElevenLabs Pronunciation Dictionary API
- Prints `pronunciation_dictionary_id` and `version_id` to stdout
- Run once; store output in `.env`

**Injection in `elevenlabs-agent-client.ts`:**

```typescript
// New env vars
ELEVENLABS_PRONUNCIATION_DICT_ID=...
ELEVENLABS_PRONUNCIATION_DICT_VERSION=...
```

Added to the `tts` block inside `conversation_config_override` (exact field placement to be verified against live ElevenLabs API during implementation — may be at a different nesting level):

```typescript
tts: {
  ...ttsOverride,
  ...(dictId && dictVersion
    ? { pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: dictId, version_id: dictVersion }] }
    : {}),
}
```

If either env var is missing, the dictionary is silently skipped (no hard failure).

---

### Part 2 — Delivery Tag Palette

Replace the current 2-tag allowlist with a **5-tag contextual palette**. Each tag gets a specific use-case instruction, not just permission to exist.

**Allowed tags:**

| Tag | Use case |
|-----|----------|
| `[laughs]` | A genuine light moment — rapport, something mildly amusing. Not forced positivity. |
| `[exhales]` | Before answering a tricky or thoughtful question. Signals "I'm considering this." |
| `[sighs]` | Real empathy — acknowledging a genuine concern. Once per call max. |
| `[curious]` | Gentle permission question. Keep current guidance. |
| `[excited]` | A real positive reveal (good news, strong benefit). Max once per call. |

**Blocked:** `[whispers]`, `[shout]`, `[crying]`, `[snorts]`, `[laughs harder]`, all sound effects — too theatrical for a phone call.

**Rules for all tags (in prompt):**
- One tag maximum per response, at the start only, never mid-sentence
- Most responses: no tag
- Never stack tags
- Never use a tag on a factual response

The tag guidance lives **only** in `elevenLabsAgentPrompt()`. The duplicate entry in `voice-campaign.ts` (which instructs the LLM to generate delivery rules) is stripped.

---

### Part 3 — Feminine Speech Pattern Instructions

A new section appended by `elevenLabsAgentPrompt()`, after the tag rules:

**Hinglish cadence:**
- Use `haan`, `achha`, `theek hai` as natural affirmations instead of "okay", "sure", "of course"
- Use `haan... ek sec` instead of "I understand, one moment please"
- Short bridging before pivoting: "achha, samjha... toh basically..." — then the point
- Rising intonation on soft questions through punctuation: "aap ke paas already kuch investment hai, right?"

**Laughter and rapport:**
- `[laughs]` + "arey yaar" for genuine light moments — not scripted warmth
- Never `[laughs]` on a serious concern or financial question

**Self-reference (gender consistency):**
- Always use feminine verb forms: `bol rahi hoon`, `samajh rahi hoon`, `dekh rahi hoon`
- Never masculine: not `bol raha hoon`, not `samajh raha hoon`

**Pacing:**
- Keep turns short — under 2 sentences before pausing for the caller
- A comma or `...` (one only) for a small natural pause
- Never stack `...` or use `—` dashes

---

## Bug Fixes (bundled in this change)

**1. Duplicate delivery rules**
- `voice-campaign.ts` currently instructs the LLM to generate an "Eleven v3 delivery rules" section in the system prompt
- `elevenLabsAgentPrompt()` then appends the same rules again
- Fix: remove the delivery-rules instruction from `buildVoiceCampaignScriptPrompt()` in `voice-campaign.ts`

**2. `undefined` status → `"completed"` in webhook**
- `statusFromElevenLabs(undefined)` currently returns `"completed"` because the first branch checks `!normalized`
- Fix: only map explicit "done"/"completed"/"success" strings to `"completed"`; undefined → `"failed"`

---

## Files Touched

| File | Change |
|------|--------|
| `data/girl-expressions-dict.pls` | New — pronunciation alias dictionary |
| `scripts/upload-pronunciation-dict.ts` | New — one-time upload script |
| `src/lib/elevenlabs-agent-client.ts` | Inject dictionary locators, expand `elevenLabsAgentPrompt()` with 5-tag palette + feminine speech section |
| `src/lib/prompts/voice-campaign.ts` | Strip duplicate delivery-rules instruction from LLM generation prompt |
| `src/app/api/voice/elevenlabs-webhook/route.ts` | Fix `undefined` → `"failed"` in `statusFromElevenLabs` |
| `.env.example` | Add `ELEVENLABS_PRONUNCIATION_DICT_ID`, `ELEVENLABS_PRONUNCIATION_DICT_VERSION` |

---

## Out of Scope

- Conversation branching / flow graph (separate spec)
- Per-campaign voice settings (future)
- Switching TTS provider to Silk (future — pending Silk 1-Mulberry open-source release)
- UI changes
