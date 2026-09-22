# Hinglish Voice Agent Harness Conversation Brief

Created from the conversation on 2026-06-06.

## Objective

Build a hyper-realistic, highly expressive, maximum-control Hinglish voice agent harness for realtime voice agents, with a stronger emphasis on expressive quality and control than on compliance, sales flow, or provider convenience.

The user is currently unhappy with the quality/control tradeoffs from hosted or semi-hosted options including Gemini, Sarvam, Cartesia, Rumik, ElevenLabs, and Smallest. They are open to post-training or fine-tuning, but they are a single-person team, have limited funds, do not have access to licensed actors, and one excellent voice is enough.

## Core Conclusion

The best path is not to keep searching for another hosted TTS provider. The durable product should be a voice performance harness:

```text
LLM response
  -> spoken Hinglish rewrite
  -> performance plan
  -> controllable TTS or expressive source model
  -> optional voice conversion into target voice
  -> acoustic verification
  -> regenerate or repair bad spans
```

The real asset is the control layer around the model:

- Hinglish normalizer
- prosody planner
- style/reference selector
- provider/model renderer
- audio verifier
- span repair/regeneration

## Important Constraint Shift

Since the user is a single-person team without funds for voice actors, the recommended first step changes from full TTS fine-tuning to a voice-conversion cascade.

Recommended solo-founder path:

```text
expressive source TTS
  -> voice conversion into one owned/consented target voice
  -> realtime streaming output
```

This separates expressive performance from target voice identity. It also reduces the data requirement compared with direct TTS fine-tuning.

## Current Best Technical Path

### Phase 1: No-Training Bakeoff

Test open or controllable TTS bases on a fixed Hinglish evaluation set.

Candidates to test:

- Fish Speech S2/S2 Pro for expressive control and inline prosody tags
- Chatterbox-Multilingual for practical hacking, Hindi support, and expression knobs
- IndexTTS2 for emotion/duration control experiments
- CosyVoice 2/3 for training and serving infrastructure

Do not pick from model claims. Generate real Hinglish samples and score them.

### Phase 2: Voice Conversion Prototype

Use 30-120 minutes of clean, consented target voice data. This can be the user's own voice or another person who explicitly consents to voice cloning/model use.

Pipeline:

```text
Fish/Chatterbox/IndexTTS expressive audio
  -> RVC/Seed-VC/OpenVoice-style conversion
  -> target voice output
```

This should be the fastest route to a believable one-voice demo.

### Phase 3: Prosody DSL

Create a provider/model-neutral performance format.

Example:

```json
{
  "text": "haan, samajh gaya. ek quick question hai.",
  "style": "warm_curiosity",
  "pace": 1.05,
  "energy": 0.55,
  "emotion_intensity": 0.45,
  "pause_after_ms": 180,
  "emphasis": ["quick question"]
}
```

Then write renderers:

```text
PerformancePlan -> Fish tags
PerformancePlan -> Chatterbox params/tags
PerformancePlan -> IndexTTS controls/reference audio
PerformancePlan -> CosyVoice instruction prompt
```

### Phase 4: Small Fine-Tuning Only After Harness Works

Once the harness proves which controls matter, do direct LoRA/SFT on the best base model.

Training order:

```text
1. Hinglish adaptation
2. one-voice identity adaptation
3. expressive control tags
4. preference tuning from generated candidates
```

## Data Plan For One Voice

Minimum practical targets:

```text
10-30 minutes clean target voice: workable for VC experiments
1-2 hours clean target voice: much better
3-5 hours clean target voice: serious prototype territory
10-20 hours: useful for direct TTS fine-tuning
30+ hours: better stability and expression
```

The most valuable dataset is not huge random audio. It is a small, clean style pack.

Record 100-200 lines in multiple styles:

```text
neutral
warm
curious
confident
apologetic
urgent
smiling
slow-clear
lightly amused
thinking
reassuring
firm
```

Example line:

```text
haan, samajh gaya. ek second, main check kar raha hoon.
```

Record the same line in several styles. This teaches controllability far better than noisy long-form content.

## YouTube And Stream Data

YouTube/stream data should be treated as weak supplemental data, not the foundation.

It can help with:

- natural Hinglish rhythm
- colloquial phrases
- Indian English/Hindi switching
- conversational filler patterns

It is weak for precise expression control because it often has:

- compression artifacts
- background music
- overlapping speakers
- bad microphones
- room echo
- edits and jump cuts
- unreliable transcripts
- missing emotion/prosody labels

Even if a contractor has obtained rights, the cleanest source is creator-provided original audio files, not platform scraping. Also verify that the rights explicitly cover model training and voice likeness use.

## Maximum Control Design

Use three channels together:

```text
1. Text
2. explicit controls
3. style reference audio
```

Do not rely only on emotion labels or speed sliders. For realistic expression, the model needs short style references and controls that map to actual training examples.

Example control object:

```json
{
  "voice": "one_owned_voice",
  "text": "haan, samajh gaya. ek second, main check kar raha hoon.",
  "language_mix": "hinglish",
  "style_ref": "warm_reassuring_fast_01.wav",
  "pace": 0.92,
  "energy": 0.58,
  "emotion": "reassuring",
  "emotion_intensity": 0.42,
  "pitch_range": "medium",
  "pauses": [
    { "after": "samajh gaya", "ms": 220 },
    { "after": "ek second", "ms": 140 }
  ],
  "emphasis": ["check"],
  "nonverbal": ["soft_breath_before"]
}
```

## Realtime Strategy

Split by performance beats, not arbitrary sentences.

Example:

```text
Beat 1: "haan, samajh gaya."
Beat 2: "ek second..."
Beat 3: "main check kar raha hoon."
```

Generate Beat 1 immediately. While Beat 1 plays, generate later beats. This improves perceived latency while preserving expressive delivery.

Target behavior:

- first audio quickly
- barge-in friendly playback
- cached micro-responses only when useful
- regenerate bad spans instead of full utterances

## Audio Verifier

Add a verifier before trusting generated output.

Checks:

- ASR text match
- duration error
- pause placement
- pace
- pitch/energy contour
- pronunciation of names/numbers
- emotion/style classifier score
- clipping/noise
- unwanted spoken control tags

If a span fails, regenerate only that span.

## Practical Difficulty

For one voice as a solo founder:

```text
Decent prototype:       2-4 weeks, 6/10 hard
Good expressive demo:   1-2 months, 7/10 hard
Reliable realtime:      3-6 months, 8/10 hard
```

Full direct TTS post-training is harder:

```text
Data rights and sourcing:       hard
Audio cleaning/segmentation:    very hard
Transcription/alignment:        medium-hard
Emotion/style labeling:         very hard
LoRA/SFT training:              medium
True prosody control:           very hard
Realtime serving:               hard
Evaluation harness:             hard but mandatory
```

## Recommended MVP

Do not start with full post-training.

Build:

```text
1. 100-200 Hinglish test lines
2. no-training model bakeoff
3. 30-120 minutes clean target voice
4. expressive-source TTS + voice conversion
5. performance-plan DSL
6. audio verifier
7. small hand-recorded style pack
8. direct fine-tuning only after the harness is useful
```

## Main Principle

For this use case, the winning system is not a TTS API with more sliders. It is a controllable voice performance compiler:

```text
spoken Hinglish script
  + explicit prosody controls
  + style reference audio
  + one owned target voice
  + verification and span repair
```

That is the most realistic path to a single hyper-expressive Hinglish realtime voice without a large team or actor budget.
