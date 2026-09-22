# ElevenLabs Implementation Audit

> Benchmarked against ElevenLabs TTS best-practices docs + SDK source  
> Date: 2026-05-14

---

## Summary Table

| Feature | ElevenLabs Has | We Use | Gap |
|---|---|---|---|
| Pronunciation dictionary | PLS/alias/phoneme rules | Nothing — LLM instruction only | **Create one for Indian finance terms** |
| Dynamic variables in prompt | `{{variable_name}}` in system_prompt | Pass metadata but never reference in template | **Personalize per-investor** |
| Audio tags (full set) | 20+ tags | Only `[curious]`, `[sighs]` | Acceptable; add `[exhales]` optionally |
| SSML break tags | v2 only, not v3 | Blocked ✅ | Correct |
| `apply_text_normalization` | "on"/"off"/"auto" | Not set | Test if controllable at agent level |
| Speed | 0.7–1.2 per call | Single global env var | Per-language speed would be better |
| Stability/creative/robust | Named modes (v3) | 0-1 float | Verify 0.7+ → robust zone |
| Phoneme tags | v2 only | Not used ✅ | Correct for v3 |
| Batch calling | Full batch job API | Manual loop | Worth switching for scale |
| Duplicate rules in prompt | N/A | Appears twice | **Fix: deduplicate** |
| `status: undefined` in webhook | N/A | Mapped to "completed" | **Fix: map to "failed"** |

---

## 1. Pronunciation Dictionary — Not used at all 🔴

**What ElevenLabs has:**

- A first-class pronunciation dictionary system via **PLS (W3C Pronunciation Lexicon Specification)** or `.txt` files
- Two rule types:
  - **Phoneme rules**: `<phoneme alphabet="cmu-arpabet|ipa" ph="...">word</phoneme>` — exact phonetic rendering (v2/v2.5 only, NOT v3)
  - **Alias rules**: replace a word with a phonetically spelled approximation (works on v3)
- Dictionaries can be attached per API call via `pronunciation_dictionary_locators` field in the TTS/agent request body
- Case-sensitive, sequential matching (first match wins)
- Available for both TTS and Conversational AI agents

**What we do:**

```typescript
// In voice-campaign.ts and elevenlabs-agent-client.ts — we instruct the LLM:
"Normalize numbers, rupee amounts, percentages, dates, EMI, loan IDs..."
"Say 'E M I' for EMI"
"Expand abbreviations when they could sound awkward"
```

This is **soft guidance** to the LLM inside the system prompt. The LLM may or may not follow it on each turn.

**The gap:**

We have a large set of Indian finance terms that get mispronounced without a dictionary: `SIP`, `ELSS`, `NACH`, `NPS`, `ULIP`, `AMC`, fund names (`Kotak`, `Mirae`, `Nippon`), Hindi numerals, rupee amounts. Relying on the LLM to normalize is unreliable — the LLM might say "SIP" as a word rather than "S-I-P", or mangle "Kotak Mahindra".

**Recommendation:**

Create a `data/pronunciation-dictionary.pls` with alias rules for Indian finance terms and inject it via `pronunciation_dictionary_locators` in the outbound call payload:

```typescript
pronunciation_dictionary_locators: [
  { pronunciation_dictionary_id: "...", version_id: "..." }
]
```

This goes inside `conversation_initiation_client_data.conversation_config_override.tts` (exact placement needs verification against live ElevenLabs docs).

---

## 2. Dynamic Variables — Underutilized 🟠

**What ElevenLabs has:**

- `dynamic_variables` is a `dict` passed under `conversation_initiation_client_data`
- Variables can be referenced with `{{variable_name}}` syntax **inside the system prompt and first_message**
- This allows per-call personalization without regenerating the entire prompt

**What we do:**

```typescript
dynamic_variables: {
  campaign_id: callConfig.campaignId,
  call_config_id: callId,
  phone_number: normalizedToNumber,
  language: callConfig.language,
  voice_name: callConfig.voiceName || "",
},
```

We pass 5 variables, but **none are referenced via `{{variable_name}}` in the system prompt**. They're metadata only, not used for prompt personalization.

**The gap:**

Every call in a campaign gets the **identical system prompt**. For a FundsIndia campaign, each investor has a different SIP amount, fund name, mandate status, and last transaction date — but the agent speaks generically to all of them.

**Recommendation:**

Use `{{variable_name}}` in the system prompt template:

```
The investor's name is {{investor_name}}.
Their current SIP amount is {{sip_amount}}.
Their primary fund is {{fund_name}}.
Mandate status: {{mandate_status}}.
```

Then per-call:

```typescript
dynamic_variables: {
  investor_name: "Ramesh Verma",
  sip_amount: "₹5,000",
  fund_name: "Kotak Flexicap",
  mandate_status: "active",
  // ...
}
```

This makes calls dramatically more personalized and conversion-effective.

---

## 3. Duplicate System Prompt Rules — Bug 🔴

**The issue:**

`buildVoiceCampaignScriptPrompt()` in `src/lib/prompts/voice-campaign.ts` instructs the LLM to **include** an "Eleven v3 delivery rules" section in the generated system prompt. Then `elevenLabsAgentPrompt()` in `src/lib/elevenlabs-agent-client.ts` **appends another copy** of the same rules.

Result: the agent's effective prompt has delivery rules **twice** — once in the LLM-generated body and once hardcoded at the end. Wastes tokens and could create confusing contradictions if the two copies diverge.

**Fix:** Either:
- Remove the delivery-rules instruction from `buildVoiceCampaignScriptPrompt()` and rely solely on `elevenLabsAgentPrompt()` append, or
- Remove the `elevenLabsAgentPrompt()` wrapper and generate complete prompts from the LLM step

The `elevenLabsAgentPrompt()` approach is safer (guarantees rules are always present regardless of what the LLM generates), so strip the delivery-rules section from the LLM generation prompt.

---

## 4. `statusFromElevenLabs` — Undefined Mapped to "completed" 🔴

**The bug** (`src/app/api/voice/elevenlabs-webhook/route.ts`):

```typescript
function statusFromElevenLabs(status: string | undefined): VoiceCallStatus {
  const normalized = status?.trim().toLowerCase();
  if (!normalized || normalized === "done" || normalized === "completed" || normalized === "success") {
    return "completed";  // ← treats undefined/null as "completed"
  }
  if (normalized === "no_answer" || normalized === "no-answer") return "no_answer";
  return "failed";
}
```

If ElevenLabs fires the webhook with a null/missing status, we incorrectly mark the call as completed.

**Fix:**

```typescript
function statusFromElevenLabs(status: string | undefined): VoiceCallStatus {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "done" || normalized === "completed" || normalized === "success") return "completed";
  if (normalized === "no_answer" || normalized === "no-answer") return "no_answer";
  return "failed";  // undefined → failed, not completed
}
```

---

## 5. Audio/Delivery Tags — Overly Conservative but Defensible 🟡

**Full v3 tag list from ElevenLabs docs:**

| Category | Tags |
|----------|------|
| Voice emotion | `[laughs]`, `[laughs harder]`, `[starts laughing]`, `[wheezing]`, `[crying]`, `[snorts]`, `[mischievously]`, `[sarcastic]`, `[curious]`, `[excited]` |
| Vocal sounds | `[whispers]`, `[sighs]`, `[exhales]`, `[swallows]`, `[gulps]` |
| Sound effects | `[gunshot]`, `[applause]`, `[clapping]`, `[explosion]` |
| Experimental | `[strong X accent]`, `[sings]`, `[woo]`, `[fart]` |

**What we allow:** Only `[curious]` and `[sighs]`.

**Assessment:** Correct for a professional finance call. Sound effects and theatrical tags are inappropriate. The one candidate to consider: `[exhales]` — a brief exhale before answering a hard objection ("should I really invest now?") sounds human and natural without being theatrical.

---

## 6. SSML Break Tags — Correctly Blocked ✅

ElevenLabs v3 **does not support** `<break time="x.xs" />`. We correctly block them in both the prompt generation step and the runtime addendum. For v2 models they work (up to 3s), but excessive use causes instability and artifacts even there.

Our alternative (commas, short sentences, single ellipsis) is the recommended approach per ElevenLabs docs.

---

## 7. Phoneme Tags — Correctly Not Used on v3 ✅

`<phoneme alphabet="cmu-arpabet" ph="...">word</phoneme>` is v2/v2.5 only. We never use them and our SSML block covers this. Correct.

---

## 8. `apply_text_normalization` — Not Set 🟡

**What ElevenLabs has:**

TTS API accepts `apply_text_normalization: "auto" | "on" | "off"`:
- `"on"` = ElevenLabs normalizes numbers/dates/currencies before TTS
- `"off"` = raw text passed as-is (useful when you've pre-normalized)
- `"auto"` = model decides

**What we do:** Not set. We rely on LLM-level normalization instructions in the system prompt.

**Potential improvement:** If this is configurable inside `conversation_config_override.tts` at the agent level (needs verification), setting `"on"` would let ElevenLabs handle "₹50,000" → "fifty thousand rupees" automatically, removing the need for LLM normalization instructions.

---

## 9. Speed Parameter — No Per-Language Control 🟡

**What ElevenLabs has:** `speed` 0.7–1.2 per call.

**What we do:** Single global `ELEVENLABS_TTS_SPEED` env var for all calls.

Hindi/Hinglish speech may need different pacing than English. Worth adding per-language speed in the campaign config and passing it dynamically rather than from a global env var.

---

## 10. Stability — Float Sent, Semantic Zones Unclear 🟡

**ElevenLabs v3 stability modes:**

| Mode | Value Range | Behavior |
|------|-------------|----------|
| Creative | Low | Emotional, expressive, prone to hallucinations |
| Natural | Mid | Balanced, closest to original voice recording |
| Robust | High | Stable, less responsive to directional prompts |

**What we do:** Send `stability: 0–1` float from `ELEVENLABS_TTS_STABILITY` env var.

For a phone sales agent, the robust zone (stability >= ~0.7) is safest — prevents the agent from going unexpectedly emotional during serious financial questions.

---

## 11. Batch Calling API — Manual Loop Instead 🟡

**What ElevenLabs has:** A dedicated batch calling job API with built-in retry logic.

**What we do:**

```typescript
// voice-campaign-launcher.ts
for (const phoneNumber of phoneNumbers) {
  await initiateVoiceCall(phoneNumber, callConfigId);
}
```

Manual sequential fire-and-forget loop. For campaigns with 100+ numbers, the ElevenLabs batch API would be more reliable and observable. Low priority until campaigns reach that scale.

---

## 12. Webhook — No In-Progress State 🟡

We only handle `post_call_transcription`. If ElevenLabs emits a `call_started` or `call_connected` event, we silently return 200. This means calls go straight from `"calling"` to `"completed"` in our state — no real-time `"connected"` status during the call.

Worth adding a handler for call_started to flip status to `"connected"` for live UI feedback, once we confirm ElevenLabs emits it.

---

## Priorities

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Fix `status: undefined` → `"failed"` in webhook | 2 lines | Correctness bug |
| 2 | Deduplicate delivery rules (strip from LLM prompt) | Small | Cleaner prompts, fewer tokens |
| 3 | Dynamic variables for per-investor personalization | Medium | Conversion quality |
| 4 | Pronunciation dictionary for Indian finance terms | Medium | Speech accuracy |
| 5 | Per-language speed control | Small | Voice quality |
| 6 | Set stability to robust zone (0.7+) as default | 1 line | Reliability |
| 7 | `apply_text_normalization: "on"` if agent-level supported | Small | Reliability |
| 8 | Batch calling API | Large | Scale (future) |
