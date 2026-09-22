/**
 * Roleplay Training — scenario model (ABSLI / `absli-life` only)
 * ------------------------------------------------------------------
 * The AI plays the CUSTOMER; a human SP or RO practices and is scored.
 *
 * MERGE-SAFETY DESIGN (read before extending):
 *  - This file is ADDITIVE. It produces a `systemPrompt` + `firstMessage`
 *    string pair that plugs straight into the existing `callConfig`
 *    (see `voice-call-state.ts` / `resolveCallConfig`). The live audio
 *    bridge (`plivo-gemini-live-bridge.ts` — turn detection, VAD, barge-in)
 *    runs whatever prompt it is handed and NEVER needs to know a call is a
 *    roleplay. Keep it that way: put divergence here (prompt content) and in
 *    the post-call scorer, NOT in the bridge.
 *  - The ONE coupling point to align with whoever owns core agent behaviour:
 *    the bridge wraps `callConfig.systemPrompt` with `withIndianLanguageDirective`,
 *    which is framed for an ADVISOR agent. For a customer-bot that framing is
 *    slightly off. For v1 we accept it (the language rules still hold); if it
 *    misbehaves, add a `mode: "advisor" | "customer"` flag to that wrapper —
 *    a change in the bridge owner's domain, not a fork here.
 *
 * STRUCTURE:
 *   ScenarioSpine   — shared, one per product (Anmol Akshaya). Role-agnostic.
 *     └─ RoleModule — SP | RO. Funnel framing + role-specific rubric.
 *         └─ Persona — a concrete character instance (difficulty, language).
 */

/** The human being trained — NOT the bot (the bot always plays the customer). */
export type TraineeRole = "SP" | "RO";

export type Difficulty = "easy" | "medium" | "hard";

/**
 * Languages the runtime voice agent can actually detect/switch today.
 * Mirrors the set in `plivo-gemini-live-bridge.ts` — Telugu/Marathi/Gujarati
 * are NOT yet supported by the detector, so they are intentionally absent.
 */
export type RoleplayLanguage =
  | "English"
  | "Hindi"
  | "Hinglish"
  | "Kannada"
  | "Odia"
  | "Tamil";

/**
 * A compliance trap: a claim the trainee must NOT make, grounded in the
 * product's approved ground truth. SHARED across roles — an over-promise is
 * judged identically whether it happens at the branch (SP) or on follow-up (RO).
 * This is what makes the tool train the SP→RO handoff instead of two isolated
 * drills.
 */
export interface ComplianceTrap {
  /** Stable id, e.g. "guaranteed-return". */
  id: string;
  label: string;
  /** What the bot-customer says to tempt the trainee into the violation. */
  bait: string;
  /** What a compliant answer looks like (fed to both the bot arc and the judge). */
  pass: string;
  /** The violation the judge must flag. */
  fail: string;
  /** Citation into the knowledge doc / brochure line the judge quotes. */
  groundTruthRef: string;
}

/**
 * The kind of thing a coverage item is — drives how the coach frames it, how the
 * customer bot creates an opening for it, and how it's scored.
 */
export type CoverageKind =
  | "talking_point" // a key product benefit/fact the rep must EXPLAIN
  | "discovery" //     something the rep must ASK the customer
  | "disclosure" //    a MANDATORY compliance statement the rep must SAY
  | "objection"; //    a likely customer objection the rep must HANDLE

/**
 * A coverage item: the POSITIVE-space counterpart to a ComplianceTrap. Traps are
 * what the rep must NOT say; coverage is what a good call must actively cover /
 * say. Required items are scored (disclosures become gates, others competencies);
 * optional items only steer the coach and the customer bot.
 */
export interface CoverageItem {
  /** Stable id, e.g. "explain-plan-options". */
  id: string;
  /** Short imperative — "Explain the 3 plan options", "Ask about dependents". */
  topic: string;
  kind: CoverageKind;
  /** Must-cover (true) vs nice-to-have (false). */
  required: boolean;
  /** What good coverage looks like — taught by the coach, graded by the scorer. */
  detail?: string;
}

/**
 * Shared spine — one per product. Role-agnostic. The single source of truth for
 * facts + traps so SP and RO rubrics can never drift apart.
 */
export interface ScenarioSpine {
  /** e.g. "absli-anmol-akshaya". */
  productId: string;
  productLabel: string;
  /** Pointer into `knowledge-store` — the authoritative brochure/leaflet doc. */
  knowledgeDocId: string;
  /** Brochure-verified policy facts — taught by the coach (train mode). */
  policyFacts?: string;
  /** Shared compliance traps, referenced by both role rubrics. */
  traps: ComplianceTrap[];
  /**
   * The call agenda — what a good rep must cover / say. Optional for
   * backward-compat with bundles generated before the coverage plan existed.
   */
  coverage?: CoverageItem[];
  /** Bot meta-behaviour: stay in character, be realistically difficult, etc. */
  botBehaviorRules: string[];
  /** Bot guardrails: never break character, never coach, never abusive. */
  guardrails: string[];
}

/** A single scored line item in a rubric. */
export interface RubricItem {
  id: string;
  label: string;
  /** Relative weight, 0..1. Weights across a rubric should sum to ~1. */
  weight: number;
  /** If true, failing this caps the overall score (compliance / consent gates). */
  gate?: boolean;
  pass: string;
  fail: string;
}

/**
 * Role layer — differs SP vs RO. Frames the bot's funnel stage and supplies the
 * role-specific rubric. The rubric here holds only role competencies; the shared
 * compliance-trap gates are merged in at compose time from the spine.
 */
export interface RoleModule {
  role: TraineeRole;
  /** e.g. "first-contact walk-in" (SP) | "warm telephonic follow-up" (RO). */
  funnelStage: string;
  /** How the bot frames its relationship to the trainee for this role. */
  botFraming: string;
  /** Role-only competencies (need discovery, consent, close, …). */
  rubric: RubricItem[];
}

/** A concrete character instance the bot embodies for a drill. */
export interface Persona {
  id: string;
  /** Which trainee role this persona is authored for. */
  role: TraineeRole;
  name: string;
  difficulty: Difficulty;
  language: RoleplayLanguage;
  /** The specific character + situation (the heart of the actor prompt). */
  characterPrompt: string;
  /** The bot's opening line → becomes `callConfig.firstMessage`. */
  openingLine: string;
  /** Optional extra guidance on how the bot should run the objection arc. */
  arcNotes?: string;
}

/** A fully-specified drill: spine + role + persona. Gated to `absli-life`. */
export interface RoleplayScenario {
  id: string;
  /** Hard-scoped: this feature only exists on the Life Insurance dataset. */
  datasetId: "absli-life";
  spine: ScenarioSpine;
  roleModule: RoleModule;
  persona: Persona;
}

/**
 * A persisted, trainer-curated scenario set — what the scenario-store saves and
 * the library lists. Holds the EDITABLE spine/rubric/personas plus the source
 * inputs, so a saved scenario can be reopened, tuned by a handler, and re-run.
 * The concrete per-persona `RoleplayScenario[]` is NOT stored — it is rebuilt
 * from spine + roleModule + personas via `buildScenarios` so a trainer's edit to
 * a trap or rubric item can never drift out of the runnable drills.
 */
export interface SavedScenarioBundle {
  id: string;
  datasetId: string;
  /** Editable display name (defaults to productLabel). */
  name: string;
  productId: string;
  productLabel: string;
  role: TraineeRole;
  difficulty: Difficulty;
  language: RoleplayLanguage;
  /** The source policy text the bundle was generated from (kept for re-generation/reference). */
  policyFacts: string;
  spine: ScenarioSpine;
  roleModule: RoleModule;
  personas: Persona[];
  /** Epoch millis. */
  createdAt: number;
  updatedAt: number;
}

/**
 * Rebuild the concrete per-persona scenarios from an (editable) spine + role +
 * personas. Extracted so the generator AND the saved-scenario load path produce
 * identical drills — after a trainer edits a trap or rubric item the change
 * propagates into every persona's scenario with zero drift.
 */
export function buildScenarios(
  datasetId: "absli-life",
  productId: string,
  role: TraineeRole,
  spine: ScenarioSpine,
  roleModule: RoleModule,
  personas: Persona[],
): RoleplayScenario[] {
  return personas.map((persona) => ({
    id: `${productId}-${role.toLowerCase()}-${persona.id}`,
    datasetId,
    spine,
    roleModule,
    persona,
  }));
}

/** Output that plugs into the existing call config — no bridge changes. */
export interface ComposedActorPrompt {
  /** → callConfig.systemPrompt (the bot playing the customer). */
  systemPrompt: string;
  /** → callConfig.firstMessage. */
  firstMessage: string;
  /** → callConfig.language (drives the existing runtime language handling). */
  language: RoleplayLanguage;
}

/** Output that plugs into the call config for TRAIN mode (bot = coach). */
export interface ComposedCoachPrompt {
  systemPrompt: string;
  firstMessage: string;
}

/** Output consumed by the post-call scorer (a separate, additive module). */
export interface ComposedRubric {
  role: TraineeRole;
  /** Role competencies + shared compliance/consent gates, merged. */
  items: RubricItem[];
}

// ── Composition ────────────────────────────────────────────────────────────
// Pure functions: (spine + role + persona) → actor prompt / rubric.
// No I/O, no imports from the audio bridge — trivially unit-testable and
// conflict-free.

/** Default weight given to a required non-disclosure coverage item in scoring. */
const COVERAGE_ITEM_WEIGHT = 0.1;

function traineeRoleLabel(role: TraineeRole): string {
  return role === "RO" ? "RO" : "SP";
}

export function coachOpeningRoadmap(scenario: RoleplayScenario): string {
  return `Aaj hum ${scenario.spine.productLabel} ke ${traineeRoleLabel(scenario.roleModule.role)} practice call ki taiyari karenge. ` +
    "Main pehle customer context aur key compliance points cover karungi. Kya abhi shuru karein?";
}

/**
 * Turn required coverage items into scored rubric items: mandatory disclosures
 * become affirmative-required GATES (must be said, or the assessment fails);
 * other required items become weighted competencies. Optional items aren't scored.
 */
function coverageRubricItems(spine: ScenarioSpine): RubricItem[] {
  return (spine.coverage ?? [])
    .filter((c) => c.required)
    .map((c) => {
      const isDisclosure = c.kind === "disclosure";
      const detail = c.detail?.trim() ? ` ${c.detail.trim()}` : "";
      return {
        id: `cover:${c.id}`,
        label: isDisclosure ? `Disclosure — ${c.topic}` : `Coverage — ${c.topic}`,
        weight: isDisclosure ? 0 : COVERAGE_ITEM_WEIGHT,
        gate: isDisclosure,
        pass: isDisclosure ? `Clearly states: ${c.topic}.${detail}` : `Covers: ${c.topic}.${detail}`,
        fail: isDisclosure
          ? `Fails to state the mandatory disclosure: ${c.topic}.`
          : `Does not cover: ${c.topic}.`,
      };
    });
}

/**
 * Assemble the bot-customer system prompt from the shared spine, the role
 * framing, and the persona. The trap "bait" lines are woven into the arc so the
 * customer naturally tempts the trainee into each violation.
 */
export function composeActorPrompt(scenario: RoleplayScenario): ComposedActorPrompt {
  const { spine, roleModule, persona } = scenario;

  const trapArc = spine.traps
    .map((t, i) => `  ${i + 1}. [${t.label}] Bait: ${t.bait} — a good trainee: ${t.pass}`)
    .join("\n");

  const coverage = spine.coverage ?? [];
  const mustCover = coverage.filter((c) => c.required && c.kind !== "objection");
  const objections = coverage.filter((c) => c.kind === "objection");
  const coverBlock = mustCover.length
    ? "WHAT A GOOD REP SHOULD COVER — do NOT prompt them; make them earn it by needing/asking:\n" +
      mustCover.map((c) => `  - ${c.topic}`).join("\n")
    : "";
  const objectionBlock = objections.length
    ? "OBJECTIONS YOU CAN RAISE (naturally, to test them):\n" +
      objections.map((o) => `  - ${o.topic}${o.detail?.trim() ? `: ${o.detail.trim()}` : ""}`).join("\n")
    : "";

  const systemPrompt = [
    persona.characterPrompt.trim(),
    "",
    `ROLE CONTEXT: The person talking to you is a ${roleModule.role} (${roleModule.funnelStage}). ${roleModule.botFraming}`,
    "",
    "HOW TO BEHAVE:",
    ...spine.botBehaviorRules.map((r) => `  - ${r}`),
    "",
    "COMPLIANCE TEST ARC — surface these naturally over the call, not all at once:",
    trapArc,
    coverBlock ? "\n" + coverBlock : "",
    objectionBlock ? "\n" + objectionBlock : "",
    "",
    "GUARDRAILS (never violate):",
    ...spine.guardrails.map((g) => `  - ${g}`),
    "  - Do not proactively announce that you are AI. If the trainee explicitly asks whether you are AI, a bot, or a recorded voice, answer truthfully in one short sentence: \"Yes, I am an AI customer for this training roleplay.\" Then continue the roleplay naturally.",
    persona.arcNotes ? `\nARC NOTES: ${persona.arcNotes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    systemPrompt,
    firstMessage: persona.openingLine.trim(),
    language: persona.language,
  };
}

/**
 * Merge the role's own competencies with the shared compliance traps (each
 * becomes a gated rubric item), so both SP and RO are graded against identical
 * compliance definitions.
 */
export function composeRubric(scenario: RoleplayScenario): ComposedRubric {
  const { spine, roleModule } = scenario;

  const trapItems: RubricItem[] = spine.traps.map((t) => ({
    id: `trap:${t.id}`,
    label: `Compliance — ${t.label}`,
    weight: 0, // gates are pass/fail; weight is carried by the role competencies
    gate: true,
    pass: t.pass,
    fail: `${t.fail} (ref: ${t.groundTruthRef})`,
  }));

  return {
    role: roleModule.role,
    items: [...roleModule.rubric, ...coverageRubricItems(spine), ...trapItems],
  };
}

/**
 * Assemble the COACH prompt (TRAIN mode) — the bot TEACHES the policy and drills
 * the compliance rules BEFORE the rep is evaluated. Same scenario, same voice
 * bridge; the bot is a trainer here, not a customer. The rules it teaches are the
 * exact `pass`/`fail` the scorer will grade, so training and assessment can't drift.
 */
export function composeCoachPrompt(scenario: RoleplayScenario): ComposedCoachPrompt {
  const { spine, roleModule } = scenario;

  const rules = spine.traps
    .map(
      (t, i) =>
        `  ${i + 1}. ${t.label}\n     DO: ${t.pass}\n     DON'T: ${t.fail}\n     Source: ${t.groundTruthRef}`,
    )
    .join("\n");

  const facts = spine.policyFacts?.trim();

  const coverage = spine.coverage ?? [];
  const agenda = coverage
    .map((c) => `  ${c.required ? "★" : "•"} [${c.kind}] ${c.topic}${c.detail?.trim() ? ` — ${c.detail.trim()}` : ""}`)
    .join("\n");

  const systemPrompt = [
    `You are a product-sales COACH training a ${roleModule.role} on "${spine.productLabel}" before a live roleplay evaluation.`,
    "You are a teacher, not a customer. Be encouraging but rigorous.",
    "",
    facts
      ? "PRODUCT FACTS — teach ONLY from these, never invent beyond them:"
      : "Teach the product accurately; never invent facts.",
    facts ?? "",
    "",
    agenda ? "CALL AGENDA the trainee must be able to cover (★ = mandatory, graded in Assess):" : "",
    agenda,
    "",
    "COMPLIANCE RULES the trainee MUST learn (this is exactly what they'll be scored on):",
    rules,
    "",
    "HOW TO COACH:",
    "  - First explain the plan simply, then walk the trainee through the agenda above, then teach each compliance rule with a plain right-way vs wrong-way example.",
    "  - Drill the ★ mandatory items hardest — the trainee will fail the assessment if they skip a mandatory disclosure.",
    "  - Quiz the trainee with realistic customer questions and correct their answers against the rules above.",
    "  - Answer questions grounded ONLY in the facts. If you don't have something, say so and point to the brochure — never fabricate.",
    "  - Do not proactively announce that you are AI. If the trainee explicitly asks whether you are AI, a bot, or a recorded voice, answer truthfully in one short sentence: \"Haan, main Aditya Birla Sun Life Insurance ka AI training voice agent hoon.\" Then continue the training call naturally.",
    "  - When the trainee can state the plan correctly, cover the agenda, and pass the rules, tell them they're ready for the roleplay.",
  ]
    .filter(Boolean)
    .join("\n");

  const firstMessage =
    "Namaste, main Aditya Birla Sun Life Insurance training team se bol rahi hoon. Abhi baat kar sakte hain?";

  return { systemPrompt, firstMessage };
}
