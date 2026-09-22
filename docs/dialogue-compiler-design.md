# Dialogue Compiler — Design

**Status:** design, not built. 2026-07-31.
**Scope:** converting arbitrary enterprise telecalling documents into a runtime dialogue policy for Gemini Live.

---

## The problem

Client scripts arrive as Word, PDF, spreadsheets, IVR exports, call-centre handbooks, SOPs, and FAQ dumps. No two share a structure. One gives `Greeting / Pitch / FAQ`. One gives `Step 1 / Step 2 / Notes / CRM Codes`. One gives `Agent: / Customer: / If Yes… / If No…`. One gives 200 FAQs and nothing else.

Underneath, roughly 70% of the conversation is the same across all of them. The remaining 30% is client wording, compliance text, and routing that must survive untouched.

Today the pipeline is:

```
Client script → LLM → workflow
```

The runtime wants a **dialogue policy**, which is a different representation. Compiling straight from source to output with one LLM pass means every new document format re-opens the same problem, and the two independent hard problems — understanding heterogeneous documents, and generating good realtime dialogue — get solved by the same prompt, badly.

The proposal is a compiler with a well-defined intermediate representation:

```
heterogeneous sources → IR → backend → Gemini Live prompt
```

Once the IR exists, a new source format is a frontend, a new realtime model is a backend, and neither re-solves the other.

---

## The invariant

Everything in the back half of the compiler obeys one rule:

> **The optimizer may segment, select, order, and annotate. It may never compose, compress, translate, or paraphrase.**

Rationale: the only property that makes this sellable to a bank's compliance team is that every spoken line is character-identical to the approved source. Naturalness must therefore come from *how much is said per turn* and *which approved variant is chosen* — never from rewriting.

This rules out a tempting optimization. Given an approved line like:

> Main aapke Vastu Housing Finance loan ke recent due follow-up ke liye call kar rahi hoon, dekhna tha payment ho gaya hai ya abhi pending hai.

it is **not** legitimate to emit "Namaste, main Ananya bol rahi hoon Vastu Housing Finance se." followed by "Payment ho gaya tha?". Those strings do not exist in the source. That is composition wearing segmentation's clothes, and it fails `verifyVerbatimSpokenLines` on every line.

Monologuing is caused by saying six approved lines back to back, not by any single line being too long. Fixing the first is safe; the second requires the client to approve new copy.

---

## The determinism boundary

A compiler is deterministic; a dialogue system is probabilistic. The temptation is to pick one. The resolution is that it is not one dial — determinism is set **per content class**, and deciding which class each piece of content belongs to is the compiler's actual job.

| Content class | Latitude | Enforced by |
|---|---|---|
| Compliance text | none — verbatim, must fire | `deliver-all` + `verbatim-exempt` budget |
| Approved talk track | choose one of N; never invent an N+1 | `choose-one` + verbatim gate |
| Acknowledgements, transitions, ordering, the unexpected | free improvisation | act budgets only |

So the output is not a program to execute. It is closer to a **type system**: it constrains what is legal without specifying behaviour. Gemini improvises; the policy declares where improvisation is out of bounds.

This matters for positioning as much as architecture. The product is not deterministic scripting — a DTMF tree already does that, badly. It is constrained improvisation, and the constraint surface is the compiler's output.

---

## The IR

Everything else in this design is replaceable. This is not.

```
DialoguePolicy
  meta          sourceDoc, contentHash, language, company, campaign
  spine         Stage[]            // canonical, ordered — the ~30% that varies
  routes        UniversalRoute[]   // 10 fixed kinds — the ~70% that doesn't
  slots         SlotDef[]          // conversation state — see "Conversation state"
  knowledge     KnowledgeUnit[]    // FAQ, rates, eligibility — reachable, never walked
  compliance    ComplianceUnit[]   // RBI, recording notice, disclosures
  procedures    ProcedureUnit[]    // transfer scripts, escalation steps — never spoken
  placeholders  PlaceholderBinding[]
  diagnostics   Diagnostic[]

Stage
  canonical     GREET | IDENTIFY | PURPOSE | DISCOVER | QUALIFY
              | EXPLAIN | OBJECTION | COMMIT | CALLBACK | CLOSE | UNCATEGORIZED
  clientLabel   "Bounce Notification"       // display only, never reaches runtime
  goal          private, never spoken
  turns         Turn[]
  reads         SlotRef[]                   // skip/branch on what's already known
  writes        SlotRef[]                   // what this stage is expected to establish
  next          { to, when: SlotCondition }[]

Turn
  act           QUESTION | CLARIFY | ACKNOWLEDGEMENT | EXPLANATION
              | CONFIRM | TRANSITION | DISCLOSURE | CLOSE
  mode          "choose-one" | "deliver-all"
  utterances    Utterance[]
  waitsFor      derived from act
  budget        derived from act

Utterance
  text          VERBATIM from source
  span          [start, end] offsets into the extracted source document
  contentType   "conversation" | "compliance"

SlotDef
  name          payment_status
  type          enum | string | number | date | bool
  values        paid | promised | disputed | refused        // from the client's own codes
  source        "conversation" | "dataset" | "derived"
```

Three fields carry most of the weight.

**`mode`** resolves the alternates bug and compliance delivery in one field. Piramal's six approved reminder pitches are `choose-one`. An RBI disclosure is `deliver-all`. Today both are an undifferentiated pile of `Say:` lines in a node body, which is exactly why the agent recites all of them.

**`act`** types every turn from a closed set, which makes `waitsFor` and `budget` derived rather than annotated (see below). It is also what makes the linter possible — "three consecutive questions" is not computable without it.

**`budget` with `verbatim-exempt`** resolves the word-cap vs compliance-text tension. A single global word cap either makes the agent chatty or silently truncates regulated text — and the second failure is the expensive one. Budgets key off act and content type instead. Concretely: conversational Hinglish runs ~2.5 words/sec, so a 7–9 second target is **20–25 words**. Express it in words; Gemini Live has no clock but can count words.

**`span`** is the field nobody asks for and everybody needs. Provenance makes verification mechanical, and it makes a side-by-side audit view possible. For enterprise sign-off, "show me where this line came from in our approved document" is the difference between a two-week legal review and a demo. It is also what turns onboarding from a services engagement into self-serve.

### Three planes, not one graph

The spine, the routes, and the knowledge store are siblings — not fields on each other.

Attaching FAQs per-stage is the obvious modelling mistake. TWD has 23 FAQs; Piramal has an FAQ library plus a persuasion library plus a callback library. "What's the penalty?" can arrive during greeting, discovery, or close. Per-stage attachment forces you to either duplicate all 23 across every stage or assign each to one stage where it is unreachable from the others. Both rebuild the bloat the design is meant to remove.

A human agent doesn't memorise the FAQ per stage. They keep it beside the flow and reach for it. Model it that way.

### Dialogue acts vs canonical stages

These are two levels of one tree, not competing abstractions. A DISCOVER stage may contain `QUESTION → CLARIFY → QUESTION`. Stages are business positions; acts are conversational moves.

Both are needed, for different reasons:

- **Stages** carry client routing and compliance obligations. The source document says "if customer refuses, go to Callback" and "disclosure before purpose" — always in business terms, never in act terms. Drop the stage layer and the 30% you are contractually obliged to preserve becomes inexpressible.
- **Acts** are cross-domain (banking, insurance, healthcare, ecommerce) and mechanically useful. They are what let the compiler derive behaviour instead of asking the model for it.

| act | waitsFor | budget | notes |
|---|---|---|---|
| QUESTION | customer | 25 words | at most one per turn |
| CLARIFY | customer | 25 words | follow-up on an unclear answer |
| ACKNOWLEDGEMENT | none | 6 words | "samjhi", "theek hai" — never merged with an explanation |
| EXPLANATION | none | 40 words | the monologue risk lives here |
| CONFIRM | customer | 20 words | read back a commitment |
| TRANSITION | none | 10 words | stage handoff |
| DISCLOSURE | none | verbatim-exempt | compliance; `deliver-all` |
| CLOSE | none | 25 words | terminal — nothing may follow |

An earlier draft of this IR had `Turn.objective` as free text. That was unverifiable and unusable downstream. A closed act enum replaces it, moves two decisions from the model into a lookup table, and reinforces the "model classifies, code transforms" split.

### Conversation state

The current state model in the repo is `VoiceCallOutcome` (`src/lib/voice-campaign-types.ts:14-23`) — **one global nine-value enum**, campaign-agnostic, derived after the call ends. That is the whole thing.

Client documents already specify something much richer. TWD ships a disposition table; Piramal ships reason and issue codes. An earlier draft filed these under `procedures` marked "never spoken" — which discards them, even though they are the client's own slot schema and the thing their CRM ingests. They are arguably the commercial output of the call.

So slots are declared in the IR, extracted from the disposition and reason-code tables the documents already contain:

```
DISCOVER_PAYMENT
  reads   —
  writes  payment_status ∈ { paid, promised, disputed, refused }
  next    payment_status = paid       → CLOSE
          payment_status = promised   → COMMIT
          payment_status = disputed   → OBJECTION
```

What this buys:

- **Routing as conditions over state** rather than free-text edge labels the model has to interpret at runtime.
- **A generated "don't re-ask what you already know" section** — the repetition problem, solved structurally rather than by pleading in the prompt.
- **Schema-driven post-call extraction**, replacing the nine-value enum with per-campaign fields.
- **CRM writeback in the client's own codes**, which is what they asked for in the document.

**The honest caveat.** Gemini Live has no trustworthy writable memory. There is no reliable "set variable" primitive without function calls, and function calls cost latency and fire unpredictably mid-conversation. So `payment_status = paid` must not be modelled as something the runtime *executes*.

Enforcement is one of:

1. **Transcript-derived** (default) — slots extracted after the call by the existing analysis layer, now schema-driven. Zero runtime cost, no mid-call routing.
2. **Tool-call-backed** (selective) — for the few slots worth the latency, typically the one that determines the call's disposition.

Declaring state is cheap and pays for itself in routing clarity and post-call extraction even under option 1. Claiming the runtime writes memory would be overselling.

---

## Frontends

Source → normalized text + structural hints.

| Source | Status | Notes |
|---|---|---|
| DOCX | built | `extractScriptDocument`, tables preserved as markdown pipe tables |
| PDF | built | via `unpdf` |
| Legacy `.doc` | detected, rejected | OLE magic-byte check → actionable "save as .docx" error |
| Pasted text | built | JSON body path on the import route |
| Excel | not built | structure lives in cells; a genuinely different parse problem |
| IVR export | not built | already a state machine — read it, don't infer it |

Excel and IVR are not prompt problems. Pretending one LLM pass handles all five source types is how the IR turns to mush. Each frontend earns its own extractor and emits the same normalized shape.

---

## Passes

The load-bearing split is not "document understanding vs dialogue management." It is:

> **The model classifies. Code transforms.**

Classification is verifiable — every output can be checked against the source. Transformation is not. The current importer already works because the model only segments and labels, while deterministic code does placeholder rewriting and verbatim checking. Keep that discipline as passes are added.

### Pass 1 — Extract & classify (LLM, verbatim-constrained)

Roughly today's importer plus classification. Emits spans, content types, placeholder roles, branch conditions, and canonical stage tags. Every spoken line must be a character-exact substring of source; enforced downstream, not trusted.

### Pass 2 — Policy annotation (LLM, span-only)

Turn boundaries within a stage, per-turn objective, `choose-one` vs `deliver-all`.

**Operates only on span references, never on text.** It cannot corrupt copy because it never receives a mutable string — it emits "split stage 4 after utterance 2." Cheap, parallelizable per stage, independently testable.

### Deterministic passes (code)

Placeholder rewriting, budget assignment, universal-route binding, verbatim verification, diagnostics, prompt emission.

---

## Turn segmentation

The one pass with real unknowns. Worth stating precisely because the word is overloaded (`/segments` in this repo is the SQL user-segments feature, unrelated).

**Document segmentation** (Pass 1) partitions the file: this heading is talk track, this table is CRM codes, this block is an FAQ bank. Mechanical once the categories are defined.

**Turn segmentation** (Pass 2) decides where one agent turn ends and the next begins — where the agent stops talking and waits.

Example. TWD's "Customer Profile Verification" stage lists, under one heading:

```
employment type
monthly income
residence status
```

As one node, its body holds three `Say:` lines and Gemini delivers them in one breath — three questions, no pause. Segmented:

```
Stage QUALIFY  (clientLabel: "Customer Profile Verification")
  turn 1  objective: employment type   waitsFor: customer
  turn 2  objective: monthly income    waitsFor: customer
  turn 3  objective: residence         waitsFor: customer
```

Same words, same order, same stage. The pass adds only the pauses.

Same for TWD's "Pitching Two-wheeler specifications & Digital Offers," which packs thank-you, pricing, vehicle, financing, offers, and appointment request under one heading — a ninety-second monologue as one node, five or six turns segmented.

### The ceiling

**Cuts are only legal at boundaries that already exist in the document.** Segmentation reorganizes approved lines into turns; splitting a sentence produces text the client never approved.

Most telecalling docs give plenty of cut points — numbered variants (G1/G2/G3, B4/B5), bullets, `Agent:`/`Customer:` alternation, FAQ pairs. Piramal's six reminder pitches are six separate approved utterances. Combined with `choose-one`, segmentation alone removes most monologuing.

Where a stage is a single dense approved paragraph, there are exactly two honest options: deliver it whole and accept the long turn, or get a split version approved by the client. Any third option is rewriting compliance text. Surface it rather than hide it:

```
warn  span 1840-1910  Stage EXPLAIN: single 47-word utterance, no internal cut points.
                      Turn will exceed budget. Client approval needed to split.
```

### Why it stays hard

- **Which lines share a turn.** "Thanks for confirming" + "let me explain the financing" is one turn. "Explain financing" + "ask for a showroom visit" is two.
- **Which turns actually wait.** An acknowledgement needs no pause; a question does. Too permissive and the agent talks over people; too strict and it stops dead after "theek hai."
- **Where a branch begins.** If the document says "If customer says no —", the preceding turn must wait or the branch is unreachable.

None of this is verifiable against the source the way verbatim is — the document contains no ground truth for "should the agent pause here." Build the eval harness before the feature, and measure at transcript level: words per turn, questions per turn, consecutive agent turns without customer speech.

---

## Backends

IR → runtime artifact. `compileVoiceCampaignScript` becomes the Gemini Live backend.

More than one consumer already exists and they currently risk drifting apart: outbound (`src/app/api/voice-campaigns/[id]/call-user/route.ts`), inbound (`src/app/api/voice/plivo-answer-inbound/route.ts`), `src/lib/inbound-agent-prompt.ts`, and eval context. Under an IR they become backends over one representation. That convergence is the actual engineering argument for this work — a second realtime model later is a bonus, not the driver.

---

## Diagnostics

What makes this a compiler rather than a generator. A compiler doesn't just fail; it says where and why, with a source location.

```
warn  span 2210-2260  Branch "if customer refuses" has no target stage
warn  span 8804-9130  23 FAQ entries → knowledge plane; will not be spoken
error span 471-495    Placeholder <Name> ambiguous: agent in L12, customer in L47
info  —               Universal route `escalation` unbound; using default behaviour
```

This is how onboarding becomes self-service, and how the system earns trust: it reports what it did and did not understand about *the client's* document instead of silently producing something plausible.

### Lint rules

Most of these are computable **only because turns are typed by act** — the act enum is what makes the linter buildable, and the linter is the payoff for the act enum.

| Severity | Rule | Detects |
|---|---|---|
| error | Stage unreachable | no inbound edge and not the entry stage |
| error | Question without wait | `QUESTION` turn with `waitsFor: none` — agent talks over the answer |
| error | Compliance after close | `DISCLOSURE` positioned where `CLOSE` already terminated the call |
| error | Placeholder role ambiguous | same token used as agent in one line, customer in another |
| error | Infinite callback loop | cycle in `next` with no terminal exit |
| error | Turn after CLOSE | anything scheduled past a terminal act |
| warn | Three consecutive questions | `QUESTION ×3` with no intervening customer turn |
| warn | Turn exceeds budget | word count over the act's budget, no internal cut points |
| warn | Missing acknowledgement | stage transition with no `ACKNOWLEDGEMENT` after a customer answer |
| warn | Knowledge unreachable | FAQ entry no route or intent can reach |
| warn | Compliance unreachable | `DISCLOSURE` on a branch that can never fire |
| warn | Duplicate utterance | same line emitted in two stages — usually a segmentation error |
| warn | Branch without target | condition in the source with no destination stage |
| warn | Slot written twice | two stages claim the same slot with no precedence |
| warn | Slot never written | declared in the disposition table, no stage establishes it |
| info | Choose-one group size | `choose-one` with >6 variants — prompt weight for little gain |
| info | Route unbound | universal route using default behaviour |

**Determinism** is a hard requirement alongside it. Cache LLM passes by document content hash so an unchanged file always yields the same policy. Without it there is no regression testing, and clients see output shift between imports of the same document — which reads as instability.

---

## What already exists

The IR is mostly a promotion of things already in the repo into one representation, plus connecting two that are orphaned.

| Asset | Location | State |
|---|---|---|
| 10 canonical universal routes | `src/lib/voice-campaign-flow.ts:143-162` | typed, required (`voice-agent-generation-types.ts:147`), validated, persisted — **never reaches the prompt** |
| Full dialogue rule stack | `src/lib/voice-campaign-flow.ts:625-684` | authored — one question/turn, one idea/response, word budget, interruption handling, acknowledgements, language + gender agreement, screening/voicemail, guardrails |
| Verbatim fidelity gate | `verifyVerbatimSpokenLines` in `src/lib/voice-script-import.ts` | built, 33 unit tests |
| Document frontends | `src/lib/server/voice-script-document.ts` | DOCX + PDF + legacy-doc detection |
| Import prompt | `src/lib/prompts/voice-script-import.ts` | verbatim-constrained segmentation + placeholder role classification |
| Flow graph + canvas editor | `VoiceFlowNode` / `VoiceFlowEdge` + `src/components/canvas/` | the spine already has a UI |
| Call outcome | `VoiceCallOutcome`, `voice-campaign-types.ts:14-23` | one global 9-value enum — the entire current state model; slots generalise it |
| Post-call analysis | `src/lib/voice-response-analysis.ts` | transcript judging + compliance check — where schema-driven slot extraction would attach |

### The two orphans

**1. `universalRoutes` is a dead parameter.** `compileVoiceCampaignScript` destructures it at `voice-campaign-flow.ts:459` and types it at `:483`. Those are the only two occurrences in the file — it is never referenced in the prompt body. Callers thread it through faithfully (`use-campaign-actions.ts:106`, `use-campaign-studio.ts:239`) and it evaporates on arrival.

**2. Imported campaigns bypass the compiler entirely.** `src/lib/voice-campaign-runtime-prompt.ts:78`:

```ts
const scriptPrompt = editableScriptRuntimePrompt(campaign);
const rawPrompt = scriptPrompt ?? (campaign.systemPrompt ?? "");
```

If `editableScript` is non-empty the compiled `systemPrompt` is discarded. Import always sets `editableScript`. So every imported campaign dials with the ten-bullet prompt at `voice-campaign-runtime-prompt.ts:23-48` — of which exactly one bullet is turn-shaped and none is budgeted — plus the flat script blob.

The observed monologuing is therefore mostly a routing failure, not a prompt-design failure. Most of the rules the critique asks for already exist; they just never reach an imported campaign.

The short-circuit exists for a real reason — the comment at `voice-campaign-runtime-prompt.ts:72-77` records that older persistence saved only `editableScript`, leaving `systemPrompt` stale, which made inbound calls run an unrelated campaign. **Any change that routes imports through the compiler must fix that persistence path first, or inbound regresses.**

---

## Metrics

Separate the tiers so a regression can be attributed to the compiler rather than the model.

### Import quality

| Metric | How | Ground truth needed |
|---|---|---|
| Line coverage | every source spoken line lands in exactly one unit — computable from spans | none |
| Verbatim pass rate | `verifyVerbatimSpokenLines` | none — already computed |
| Route completeness | 10/10 required kinds bound | none |
| Unresolved diagnostics | count by severity | none |
| Placeholder role accuracy | agent vs customer vs dataset-field vs runtime-slot | ~30 labelled docs (27 available) |

"≥95% of conversational content correctly extracted" is not directly measurable — there is no ground-truth extraction to compare against. Line coverage plus verbatim rate is the computable substitute.

### Dialogue quality

Derivable from persisted transcripts plus the existing turn-latency work: words-per-agent-turn distribution, questions per turn, consecutive agent turns without customer speech, barge-in recovery rate.

Duration targets ("≤8 seconds") are not enforceable at the prompt layer — convert to word counts. Measure seconds from transcripts if wanted, but constrain in words.

### Runtime quality

Completion rate, task success, routing consistency, hallucination rate. Slowest-moving tier; only the dialogue tier is directly changed by this work.

---

## Risks and open questions

**Turn segmentation is the crux.** Everything else is plumbing and taxonomy. Where to break a dense pitch section determines whether the agent sounds human, and it is the one pass whose output cannot be checked mechanically. Budget effort accordingly.

**The canonical taxonomy will not cover everything.** A support SOP has no COMMIT; a win-back has two DISCOVER phases. `UNCATEGORIZED` must be a runnable stage, not an error. A taxonomy that cannot say "I don't know" produces confidently wrong graphs.

**The knowledge plane has a size ceiling.** It sits in the prompt; there is no mid-call retrieval. Gemini Live receives one system prompt at call start. At TWD's 23 FAQs this is fine; at 200 it is not, and real retrieval becomes necessary earlier than this design assumes. Adjacent machinery exists to build on (`midCallAction` on `VoiceFlowNodeData:127`, the link tool hint) — not now, but know where the wall is.

**Calling it a "knowledge graph" oversells it.** In practice plane three means: still in the prompt, in a clearly-labelled answer-only section the model is told to consult but never narrate. Smaller claim, and the true one.

**Slots are declared, not executed.** Gemini Live has no reliable writable memory. Mid-call routing on slot values requires tool calls, with the attendant latency and reliability cost. Default to transcript-derived extraction and treat tool-backed slots as a per-slot decision, not a platform feature. See "Conversation state."

**The act enum is a closed set and will meet content it doesn't fit.** Same failure mode as the stage taxonomy: allow an `UNCATEGORIZED` act that still compiles rather than forcing a wrong label. A taxonomy that cannot abstain produces confidently wrong policies.

**The `editableScript` persistence bug** must be fixed before the short-circuit is narrowed. See above.

---

## Sequencing

Ordered so value lands before the rewrite, not after.

1. **Wire `universalRoutes` into the compiled prompt.** A missing paragraph in a template string; taxonomy, validation, persistence, and plumbing all exist.
2. **Fix the `systemPrompt` persistence bug, then narrow the `editableScript` short-circuit** so imported campaigns inherit the rule stack. Most of the observable naturalness gap closes here, before any new architecture.
3. **Add `contentType`, `mode`, and `act` to node data.** Kills the recitation bug, makes budgets derivable, and is the precondition for the linter.
4. **Extract the IR properly** — spans, planes, slots, diagnostics, content-hash caching. Ship the linter here; it is the visible half.
5. **Schema-driven slot extraction** in the post-call analysis layer, generalising `VoiceCallOutcome`. Transcript-derived first; tool-calls only where a slot earns the latency.
6. **Pass 2 turn segmentation**, behind the eval harness built in step 4.

Steps 1–2 are days and recover most of the observable quality. Steps 3–6 are what makes the tenth client cost the same as the second.
