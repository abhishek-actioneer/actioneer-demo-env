# Hyper-Realistic Expressive Hinglish Voice Agent Harness — Research & Architecture Notes

> Working doc capturing the conversation + deep-research findings on building an expressive,
> controllable Hinglish (Hindi-English code-switched) voice agent for outbound voice campaigns.
> Date: 2026-06-06. Status: research complete, design not yet started.

---

## 1. Goal

Build a hyper-realistic, expressive **Hinglish** voice agent harness with **full prosody, pace,
and expression control**, for **outbound voice campaigns over Plivo telephony** (8kHz, realtime,
barge-in, semi-scripted).

**Current stack:** Gemini (LLM brain + Gemini Live speech-to-speech), Rumik (Pipecat-based
orchestration), Cartesia Sonic, Sarvam Bulbul.

**Constraints / preferences:**
- Dislikes ElevenLabs and Smallest.
- Finds Cartesia / Sarvam / Gemini-Live control ceilings too low.
- **Willing to post-train / fine-tune on Hinglish** → open-weight models strongly preferred.

---

## 2. The central tension

Three requirements pull in opposite architectural directions:

- **"Hyper-realistic / expressive"** → favors speech-native / end-to-end models (Gemini Live,
  Sesame CSM). Prosody emerges implicitly; you get magic but whatever the model decides.
- **"Full prosody/pace/expression *control*"** → favors cascaded + explicitly controllable TTS
  with disentangled knobs. Precision, historically at a naturalness cost.
- **"Hinglish"** → favors models that sidestep grapheme-to-phoneme (G2P), ingest Romanized text
  directly, and are fine-tunable.

Why the current tools cap out:

| Tool | What it is | Why it caps out |
|---|---|---|
| Gemini Live | Speech-to-speech (audio-token output) | No explicit pace/prosody control, no voice fine-tune, frozen Hinglish expressivity |
| Cartesia Sonic | Closed SSM/Mamba-class TTS API, ultra-low latency | Control ceiling = API surface; no deep Hinglish post-training |
| Sarvam (Bulbul) | Indic-focused TTS API | Good Indic phonetics, thin control surface, closed |
| Rumik | Pipecat-based orchestration | This is the *harness/pipe*, not the *mouth* — keep it, swap what flows through |

**Closed APIs all hit the same wall: you can't fine-tune the acoustic model or define your own
control vocabulary.** Since fine-tuning is on the table, the game is open-weight models.

---

## 3. Control taxonomy — pick the mechanism before the model

"Control" is five distinct mechanisms with very different ceilings:

1. **SSML / tag-based** (`<prosody rate pitch>`) — precise, robotic ceiling. Don't anchor here.
2. **Description / prompt-based** ("speaks slowly, warm, amused") — Parler-TTS style. Flexible,
   coarse (utterance-level), but you can define your *own* vocabulary via training annotations.
3. **Reference-audio style transfer** — give a clip in the target emotion. Style entangled with clip.
4. **Explicit prosody predictors** (duration/pitch/energy as overridable tensors) — FastSpeech2
   lineage, modernized in StyleTTS2. The *only* path to literal "full pace control" (per-phoneme
   duration + F0 contour).
5. **Context-conditioned** (Sesame CSM) — expressivity from conversation history. Most natural for
   agents, least explicit as knobs.

"Full prosody **and pace** control" → only #4 (frame-level override) and a fine-tuned #2 (dense own
vocabulary) actually deliver it. Speech-to-speech (Gemini Live) structurally cannot → **demote
Gemini from "the voice" to "the brain that writes the control markup."**

---

## 4. The "acoustic intent" architecture

Don't make the LLM emit plain text and hope the TTS guesses emotion. Make **Gemini emit text +
control markup**, and fine-tune the TTS to obey it. Decouples *steerability* (cheap, prompt-tunable)
from the *acoustic model* (expensive, retrained rarely).

```
Gemini (brain)
  → "[warm, slow] Arre {name} ji, ek minute… [pause] aapka portfolio
      [emphasis] grow kar raha hai. [excited, faster] 23 percent return!"
  → controllable Hinglish TTS (fine-tuned to YOUR tag vocabulary)
  → 8kHz mu-law stream → Plivo
```

Leverage: design a tag schema (emotion, rate, emphasis, pause, breath, interjection), then create
**paired training data** where the *same* line is performed across those tags. The model learns
your control vocabulary from data — the disentanglement-via-paired-data trick.

---

## 5. Hinglish-specific hard parts

1. **Code-switching mid-utterance** with correct pronunciation of each span.
2. **G2P is the silent killer.** Phoneme-based models (StyleTTS2, FastSpeech) need a G2P front-end;
   Romanized Hinglish has no clean G2P → pushes toward byte/char/BPE token models that ingest Roman
   text directly. **This single constraint eliminates many otherwise-great models** unless you build
   a Hinglish G2P or transliterate to Devanagari first.
3. **Hindi prosody ≠ English prosody** — different stress/pitch-accent.
4. **Data is the moat, not the model.** Expressive, emotion-labeled, code-switched Hinglish speech
   barely exists off the shelf. Whoever assembles it wins.

---

## 6. Deep research results (2026-06-06)

Method: fan-out web search → 27 sources fetched → 131 claims extracted → 25 adversarially verified
(3-vote, need 2/3 to kill). **24 confirmed, 1 killed.**

### 6.1 Corrected from first-pass

- **F5-TTS "seamless code-switching" — REFUTED (1-2).** F5-TTS sidesteps G2P (pads raw characters
  with filler tokens, no phonemizer, no duration model — great for fine-tuning + Romanized input)
  but does **not** do seamless code-switching. **Hinglish mixing must be created by your fine-tune
  data, not inherited from any base architecture.** (Aligns with willingness to fine-tune →
  Hinglish becomes the moat.)

### 6.2 The open, fine-tunable, commercially-usable shortlist (confirmed)

| Model | License | Control mechanism | Hinglish | Verdict |
|---|---|---|---|---|
| **Indic Parler-TTS** | Apache 2.0 | Natural-language **caption** (pitch/rate/expressivity/accent) | 21 langs incl Hindi+English, **no documented intra-utterance code-switch** | **Strongest controllable open base** |
| **IndicF5** | MIT | **Reference-audio only** (no knobs) | 11 Indic langs, **no English** | High naturalness, no English path, zero parametric control |
| **CosyVoice 2** | open | **Instruction tokens** `<instruction><\|endofprompt\|>` (emotion/pace/style/dialect) + streaming | Demonstrated Mandarin, **not English/Hinglish** | **Closest precedent for the LLM-markup layer**; streaming-capable |
| **Spark-TTS** | open | Dual-level: gender/style + **pitch value + rate** (LLM-predicted attribute tokens, not per-frame) | Indic not established | Viable middle-ground backbone |
| **IndicXlit** | MIT | — (Roman→Devanagari transliteration, ~11M params, 21 langs) | — | **Romanized-Hinglish front-end. Solved.** |
| **Sarvam Bulbul V3** | API-only | LLM-inferred prosody, **coarse global pace only** (V3 *removed* V2's pitch/loudness) | **Best Hinglish/code-mix** | Confirms the complaint exactly. Closed, no fine-tune → **dead end as a base** |

### 6.3 Load-bearing conclusion

**No single open model combines (a) documented Hinglish code-switching, (b) frame-level prosody
knobs, and (c) verified sub-300ms 8kHz streaming. You must compose it.**

### 6.4 On "FULL frame-level pace control" — temper expectations

Techniques exist but are **research-grade autoregressive architectures with zero verified
telephony/8kHz/streaming readiness:**
- Phoneme-level discrete F0+duration labels via unsupervised clustering (Ellinas et al., Speech
  Communication 2022, arXiv 2211.16307).
- **WeSCon** — first self-training framework for word-level emotion + speaking-rate control in a
  pretrained zero-shot TTS (arXiv 2509.24629, NeurIPS 2025).
- **DisCo-Speech** — tri-factor codec disentanglement of content/prosody/timbre (arXiv 2512.13251,
  Dec 2025).

Realistic ceiling today: caption/instruction-level control (shipping) + per-word emotion/rate
(achievable with WeSCon-style investment). True per-frame F0 override at sub-300ms barge-in latency
is **not a shipping thing.**

### 6.5 Honest gaps — nothing verifiable found on 4 of 8 questions

- **Q5** realtime telephony streaming benchmarks (Pipecat/LiveKit/Plivo latency) — no surviving claim
- **Q6** emotion-labeled code-switched Hinglish data pipeline — unresearched
- **Q7** control-adherence eval metrics — unresearched
- **Q8** staged offline/realtime synthesis tooling — unresearched
- **Orpheus, Llasa, Higgs Audio v3, MaskGCT, Sesame CSM, CosyVoice 3** were budget-dropped and
  never assessed → earlier "Orpheus/Llasa as primary realtime bet" is *unverified*, a hypothesis.

### 6.6 Time-sensitivity caveats

Model/license states pinned to cited primary sources: Indic Parler-TTS (Dec 2024, Apache 2.0);
IndicF5 / IN-F5 (mid-2025, MIT); IndicXlit (MIT); Spark-TTS (Mar 2025); CosyVoice 2 (Dec 2024,
CosyVoice 3 known but unverified); WeSCon (NeurIPS 2025); DisCo-Speech (Dec 2025); Bulbul V3
(2025-2026). IndicF5 GitHub lacks a separate LICENSE file (asserted on HF card only); its training
sets (Rasa, IndicTTS, LIMMITS, IndicVoices-R) + F5-TTS base may carry their own terms. Indic
Parler-TTS training data is "CC-BY-4.0 compatible" (attribution required).

---

## 7. Recommendation

### Primary bet (revised post-research)

```
Gemini (brain) → emits Hinglish text + control captions/instruction tokens
   ↓ IndicXlit (Romanized Hinglish → Devanagari, MIT)
   ↓ fine-tuned controllable backbone:
       • Indic Parler-TTS (Apache 2.0) — caption control + Indic foundation
       • OR CosyVoice 2 fine-tune — instruction-token control + streaming
   ↓ your Hinglish code-switch + emotion/pace fine-tune data  ← THE MOAT
   ↓ Plivo 8kHz
```

Prototype **two backbones head-to-head** (evidence doesn't crown one):
- **Indic Parler-TTS** — Indic foundation + permissive license.
- **CosyVoice 2** — exact instruction-markup pattern + streaming.

Both require *you* to supply Hinglish code-switching via fine-tuning — no model ships it.

### Keep

**Staged synthesis** for semi-scripted campaigns: offline-render the scripted backbone with the
heavy controllable model + human prosody review; realtime-fill only dynamic slots (name, amount,
date). Sidesteps the unproven "frame-level control at telephony latency" problem for the ~90% of
audio that's scripted. (No tooling found, but the architecture stands.)

### Drop

Sarvam / Cartesia / Gemini-Live as the *voice* (confirmed control ceilings). Keep Gemini as the
*brain*.

---

## 8. Build plan (staged)

1. **Build the eval harness first** — control-adherence test set (same text × target tags; measure
   did rate=slow slow down? did emotion register on a classifier? did F0 move?), objective metrics
   (WER via Hinglish ASR, speaker-sim, F0-RMSE, duration-error, emotion-classifier accuracy),
   subjective (CMOS, ABX).
2. **Keep Gemini as the brain** emitting text + control markup.
3. **Realtime/controllable backbone** — fine-tune Indic Parler-TTS and CosyVoice 2 head-to-head on
   Hinglish + tag vocabulary.
4. **Romanized front-end** — IndicXlit transliteration.
5. **Adopt staged synthesis** since the use case is campaigns.
6. **Data** — the moat (see below).

### Data strategy (the moat)

- Direct voice talent for *paired* emotion/pace data: same lines across emotions and speeds, labeled.
- Mine existing call recordings (transcript/rec dumps) — PII/consent gating mandatory before training.
- Pseudo-label at scale: forced alignment + pitch/energy extraction + emotion classifier → annotate
  large unlabeled Hinglish speech → train Parler-style description or token control.
- Oversample code-switch spans (where models break).

---

## 9. Open decisions (blocking the design)

1. **Are the campaign calls semi-scripted (→ staged synthesis wins) or open-ended conversation
   (→ forced onto the unproven realtime-control path)?** — biggest fork.
2. Latency budget / strictly Plivo 8kHz realtime?
3. How many distinct voices/personas (one brand voice vs many)?
4. What Hinglish data can realistically be collected (voice-talent budget? consented recordings?
   Roman vs Devanagari input)?

---

## 10. Next steps (offered)

- **(a)** Gap-filling research pass on Q5–Q8 + unassessed models (CosyVoice 3, Orpheus, Llasa,
  Higgs v3, Sesame CSM) — measured first-chunk latencies under Pipecat+Plivo, Hinglish data
  pipeline, eval metrics.
- **(b)** Move to design — concrete control-tag schema (what Gemini emits) + paired emotion/pace
  data-collection protocol + eval harness, against the existing Plivo/Gemini bridge.

---

## Appendix: key sources (verified)

- Indic Parler-TTS — https://huggingface.co/ai4bharat/indic-parler-tts ; https://github.com/huggingface/parler-tts
- IndicF5 — https://huggingface.co/ai4bharat/IndicF5 ; F5-TTS https://github.com/SWivid/F5-TTS ; arXiv 2505.20693
- F5-TTS architecture — arXiv 2410.06885 (ACL 2025)
- IndicXlit — https://github.com/AI4Bharat/IndicXlit ; https://huggingface.co/ai4bharat/IndicXlit
- Sarvam Bulbul V3 — https://www.sarvam.ai/blogs/bulbul-v3 ; https://docs.sarvam.ai/api-reference-docs/text-to-speech/models/bulbul
- CosyVoice 2 — https://funaudiollm.github.io/cosyvoice2/ ; arXiv 2412.10117
- Spark-TTS — arXiv 2503.01710 ; https://sparkaudio.github.io/
- Phoneme-level F0/duration control — arXiv 2211.16307 (Speech Communication 2022)
- WeSCon (word-level emotion+rate) — arXiv 2509.24629 (NeurIPS 2025)
- DisCo-Speech (tri-factor disentanglement) — arXiv 2512.13251 (Dec 2025)
