# Script / System-Prompt Generator — Design

**Status:** design, not built. 2026-07-31.
**Scope:** one generator that produces the best possible Gemini 3.1 Flash Live runtime input from whatever the operator actually gives us — a vague chat brief, an uploaded client script, or both.
**Companion:** `docs/dialogue-compiler-design.md` (the IR and passes). This doc is about the *front door* and the *emission*; the compiler doc is about the middle.

---

## The actual input distribution

Observed inputs, in decreasing order of information content:

1. **Voicebot-native client doc** (Piramal genre) — labelled utterance IDs, variables table, pitch ladders. Nearly the IR already.
2. **Human-telecaller client doc** (TVS genre) — Agent:/Customer: prose, process instructions, FAQ banks, broken placeholders.
3. **Doc + vague chat directive** — "use this but make it Tamil", "shorter", "female voice".
4. **Vague chat brief alone** — "create a voice agent for pre-due collections for this segment". No facts, no wording, no compliance text.
5. **Anything above + mid-studio refinements** over days.

Today paths 1–2 go through the import prompt, path 4 goes through a completely separate generation prompt, and paths 3/5 have no principled handling — refinements regenerate or hand-edit a flat script. The two prompts emit different shapes and neither reaches the compiled rule stack (the `editableScript` short-circuit).

**Design goal: every path produces the same artifact — a `DialoguePolicy` IR — and differs only in how much of it arrives pre-filled and how much is provenance-locked.**

---

## Principle 1 — Provenance is the unifying field

Add one field to every `Utterance` in the IR:

```
Utterance
  text        string
  span        [start,end] | null      // null for generated text
  provenance  "verbatim" | "generated" | "operator"
```

- `verbatim` — extracted from a client doc. Span-anchored. The verbatim gate applies; edits require explicit override ("this is client-approved text").
- `generated` — model-authored from a brief. Freely editable, but subject to the **fact ledger** (below).
- `operator` — typed or approved by a human in the studio. Editable, exempt from both gates.

Import and generation stop being different products. An imported campaign is a policy that is mostly `verbatim`; a chat-generated campaign is mostly `generated`; a mature campaign is a mix. Chat refinement of an imported script is legal wherever it touches `generated`/`operator` content and gated wherever it touches `verbatim`.

## Principle 2 — The fact ledger: generated content gets its own verbatim gate

The import path has `verifyVerbatimSpokenLines`. The generation path has nothing — the current prompt says "do not invent offer facts" and hopes.

Give generated content the same mechanical enforcement: every **fact atom** (number, amount, rate, date, product name, eligibility claim, legal/compliance assertion) in a `generated` utterance must trace to one of four sources:

1. the campaign brief (string match after normalization),
2. a bound dataset field,
3. an archetype default explicitly marked safe-to-assume (e.g. "this call may be recorded" phrasing — never rates or fees),
4. an operator answer captured in chat.

A deterministic post-pass extracts fact atoms from the draft (numbers and currency are regex-cheap; claims need one cheap LLM tagging call, verified by string presence in the source). Unsourced atom → the line is rewritten to a placeholder + a diagnostic, never shipped:

```
error  node explain-offer   "processing fee of 2%" has no source in brief, dataset, or answers.
                            Replaced with {processing_fee}. Provide the value or remove the claim.
```

This is the single most important mechanism for vague inputs: **vagueness becomes visible holes, not invisible hallucinations.**

## Principle 3 — Archetypes carry the 70% so the brief only has to carry the 30%

A vague brief is only workable because most of the call is predictable. Encode that as an **archetype library**, distilled from the client corpus (all present in the 20 docs on hand):

| Archetype | Spine skeleton | Slot schema | Sector pack |
|---|---|---|---|
| collections-pre-due | greet → RPC → disclose EMI → balance ask → warn → close | payment_commitment, callback_time | BFSI-collections |
| collections-post-due | greet → RPC → overdue pitch (ladder) → persuasion ladder → commit → close | payment_status, ptp_date | BFSI-collections |
| welcome / onboarding | greet → consent → detail verify ×N → close | details_confirmed[] | BFSI-sales |
| x-sell / pre-approved | greet → RPC → offer → interest check → channel handoff → close | interest, preferred_channel | BFSI-sales |
| activation (ECS/mandate) | greet → purpose → agree/refuse/hesitate → benefits → link send → close | activation_agreed | BFSI-sales |
| lead qualification | greet → source ack → product discover → qualify ×N → appointment → close | qualifiers[], appointment_slot | BFSI-sales |
| reminder / adherence *(health)* | greet → identity gate → reminder → confirm → close | confirmed, reschedule_time | health |

Each archetype bundles:

- **stage skeleton** with acts pre-typed (so budgets and lint work on generated output too),
- **slot schema** (per-campaign, replacing the global nine-value outcome enum),
- **default universal-route wording** — platform-authored, marked `generated`, displaced word-for-word the moment a client doc supplies its own (route binding, compiler doc),
- **sector guardrail pack** — BFSI-collections (RBI conduct: calling hours, no third-party disclosure before RPC, no harassment), BFSI-sales (no assured-approval claims, no fee invention), health (identity gate before any medical detail, no medical advice, stricter privacy).

Archetype selection is Pass 0's job (below). Unknown archetype → `UNCATEGORIZED` skeleton (greet → purpose → discover → close) with a diagnostic, never a forced wrong fit.

## Principle 4 — Elicit through diagnostics, not through a wizard

With vague inputs the temptation is a 10-question intake form. Wrong for this product: the operator is often a PM demoing, and half the questions can be answered by defaults or the dataset. Instead:

**Always generate immediately. Ship the draft with an "open items" checklist derived from diagnostics.**

The diagnostics panel is the elicitation surface. Each open item is a chat-answerable question bound to an IR patch:

```
Draft ready — 4 open items before this can dial:
  1. Late-fee amount is mentioned in the archetype but has no source. What is it? (or remove the warning line)
  2. No recording disclosure in your brief. Using platform default — needs your compliance sign-off.
  3. {emi_amount} bound to column emi_due_amt (0.94 match). Confirm.
  4. Voice: brief implies female (script grammar) — confirm Sulafat or pick another.
```

Answers patch the IR deterministically (fact-ledger source added, placeholder bound, config set) — they do not trigger regeneration. This is what makes multi-day refinement stable: the policy converges instead of resampling.

---

## Pipeline

```
                 chat brief          doc upload(s)
                     │                    │
                     ▼                    ▼
              ┌─ Pass 0: intake ──────────────────┐
              │  mode: generate | import | hybrid │
              │  archetype, sector, language(s),  │
              │  voice/gender, knowns, unknowns   │
              └──────────┬────────────────────────┘
            generate     │        import
                ▼        │           ▼
   Pass G: archetype     │   Pass 1: genre detect →
   instantiation +       │   extract & classify (verbatim)
   fact-fill (LLM,       │   → route binding
   ledger-constrained)   │   (compiler doc, Pass 1)
                └────────┬───────────┘
                         ▼
              merge, precedence (low→high):
              platform defaults < sector pack < archetype
              < client library < doc verbatim < operator
                         ▼
              Pass 2: policy annotation (acts, modes, turns)
                         ▼
              deterministic passes: placeholder→dataset binding,
              budgets, fact ledger, lint, diagnostics
                         ▼
              IR (DialoguePolicy)  ⇄  open-items loop (chat answers = IR patches)
                         ▼
              Backend: Gemini 3.1 Live emission
```

### Pass 0 — Intake (one cheap LLM call, structured output)

Input: chat brief (if any), doc metadata + first ~2k chars of each doc (if any), dataset context, segment, client profile (if returning client).

Output: `{ mode, archetype, sector, languages, agentGender, docGenre[], knowns: FactAtom[], unknowns: string[] }`.

This replaces the current keyword-regex `isVoiceAgentGenerationRequest` intent check as the routing brain. It is also where a *hybrid* is recognized: doc present + directive present → import first, then apply the directive as a transformation (never fold the directive into the extraction prompt — it would license rewriting).

### Pass G — Generation (the vague-brief path)

Replaces the monolithic `buildVoiceCampaignScriptPrompt`. Differences from today:

- The model receives the **archetype skeleton with acts already typed** and fills stage content — it no longer designs the graph shape from scratch. Graph shape is the archetype's job; wording is the model's job. (Model classifies/fills, code structures — same discipline as import.)
- The prompt lists the **allowed fact sources verbatim** (brief text, dataset columns with sample values, archetype safe-defaults) and instructs that any needed fact outside them must be emitted as `{placeholder}` — which the fact ledger then enforces mechanically, so the instruction has teeth.
- Universal routes come from the archetype/client library — the model never authors route behavior, only campaign-specific spine content.
- Output is IR-shaped (stages/turns/utterances with acts), not the current node/edge/narrative blob. The build-narrative UI events derive from the IR diff, not from asking the model to narrate itself.

### Import path

As specified in the compiler doc (Pass 1 + route binding + client library), unchanged here. Genre detection scales Pass-2 effort: voicebot-native docs skip most of turn segmentation.

### Hybrid directives

A chat directive over an existing policy compiles to a typed transformation:

| Directive | Transformation | Gate |
|---|---|---|
| "make it shorter" | lower EXPLANATION budgets; split over-budget turns at legal cut points | verbatim: only segmentation, never rewriting |
| "female voice" / "male voice" | voice config + grammar compatibility lint | verbatim mismatch → error, needs client variant |
| "add Tamil" | new policy variant, all utterances `generated`, flagged needs-client-approval | verbatim never machine-translated silently |
| "add an ECS pitch" | archetype fragment grafted into spine, `generated` provenance | fact ledger applies |
| "don't mention CIBIL" | drop/replace matching utterances | verbatim drop = fine; verbatim edit = gated |

Unrecognized directives fall back to a scoped LLM edit **over `generated`/`operator` content only**, with the fact ledger re-run.

---

## Backend — emitting the Gemini 3.1 Flash Live input

The emission target is not one string. It is:

```
LiveCallInput
  systemInstruction   string          // structured per Google's 4-part order
  seedTurns           Turn[]          // few-shot demonstrations via initial_history_in_client_content
  sessionConfig       { languageCode, voice, thinkingLevel, vad… }
  firstMessage        string          // spoken by launch code, as today
```

**systemInstruction layout** (Google's recommended order, mapped to the IR):

1. **Persona** — agent name, company, gender-matched grammar, `RESPOND IN {LANG}. YOU MUST RESPOND UNMISTAKABLY IN {LANG}.` (kept even though it duplicates `languageCode` — docs say both).
2. **One-time sequence** — the spine, stages in order, each stage's turns with act-derived budgets and waits. This is the "one-time elements" half of Google's rule-ordering guidance.
3. **Loops** — universal routes ("at any point, if…"), explicitly framed as recurring. The "conversational loops" half.
4. **Answer-only knowledge** — the knowledge plane, clearly labelled "consult to answer, never narrate", with `appliesWhen` conditions resolved at dial time (per-base FAQ variants pruned to the dialed customer's base — don't ship both).
5. **Tool conditions** — one sentence per tool, single-tool bias (3.1 is sync-only; every call stalls the line). At most the one disposition-critical slot tool, if any.
6. **Guardrails** — sector pack + campaign guardrails, last.

**seedTurns** — the underused channel. 2–3 short exchanges demonstrating: ideal turn length in the campaign language, a barge-in recovery, one FAQ deflection using the knowledge plane. Demonstration beats instruction for style; this is where "sound human" actually lands. Seeded once at setup (3.1 allows `send_client_content` only for initial history).

**Size discipline.** 3.1 has no mid-call prompt chaining, so selection is the whole game: dial-time pruning (resolve `appliesWhen`, drop unreachable branches for this customer's known slots, cap `choose-one` groups), and a hard emitted-size budget with an `info` diagnostic when the knowledge plane dominates. `send_realtime_input` text is the future retrieval channel when a client's FAQ bank outgrows the prompt — design the knowledge plane so units are individually addressable for that day.

**Config unification.** `thinkingLevel` (migrate off `GEMINI_LIVE_THINKING_BUDGET`), `languageCode` matched to campaign language, VAD — all emitted from the policy, not scattered env defaults, so an imported Piramal script that declares "Agent Voice: Female" and "English and Hindi only" actually constrains the session config.

---

## What this replaces / keeps

| Current | Fate |
|---|---|
| `buildVoiceCampaignScriptPrompt` (voice-campaign.ts) | replaced by Pass 0 + Pass G |
| `buildVoiceScriptImportPrompt` (voice-script-import.ts) | becomes Pass 1, gains route-binding + genre output |
| `compileVoiceCampaignScript` rule stack | becomes the backend's rule text, reordered into the 4-part layout |
| `verifyVerbatimSpokenLines` | kept as-is; fact ledger added as its `generated`-content sibling |
| `editableScript` runtime short-circuit | removed after the persistence fix (compiler doc, orphan #2) |
| `isVoiceAgentGenerationRequest` regex | absorbed into Pass 0 |
| Import UI upload flow (import-script route) | kept; becomes one of two front doors into the same pipeline |

## Sequencing

1. **Provenance field + fact ledger** on the existing generation path. Highest safety value, no IR dependency — the ledger can run on today's node bodies.
2. **Pass 0 intake + archetype library** (start with the 6 BFSI archetypes the corpus proves). Vague briefs get skeleton-true drafts immediately.
3. **Open-items loop** — diagnostics rendered as chat-answerable items patching campaign state.
4. **Backend emission upgrade** — 4-part layout, seedTurns, config unification. Lands for generated campaigns first, imported ones once the short-circuit is removed.
5. **Hybrid directive transformations** — after the IR lands (compiler doc, step 4), since typed transformations need typed content.

Steps 1–2 make the vague-brief path trustworthy. Step 4 is where call quality visibly improves. Step 5 is what makes week-three refinement not degrade week-one imports.

## Open questions

- **Fact-atom tagging recall** — regex catches numbers; claims ("zero foreclosure charges") need the LLM tagger, and a missed atom ships unsourced. Mitigation: run the tagger on emission too, diff against ledger, and measure on the 27 labelled docs.
- **Archetype drift** — client corpora will grow archetypes we haven't met (health has no corpus yet). `UNCATEGORIZED` + diagnostic is the escape hatch; watch its frequency as the signal to add archetypes.
- **seedTurns eval** — demonstration turns are prompt-cost paid every call. Needs the transcript-level eval harness (words/turn, questions/turn) to prove they earn their tokens before defaulting on.
