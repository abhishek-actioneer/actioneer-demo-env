/**
 * Roleplay generator — turns a POLICY into roleplay scenarios (personas + rubric).
 * ------------------------------------------------------------------------------
 * This is the product engine behind a "Generate scenarios" action. Given a
 * policy's facts + a trainee role, an LLM:
 *   1. DERIVES the compliance traps from the policy (the claims most at risk of
 *      non-compliant over-promising) — so it works for ANY policy, not just
 *      Anmol Akshaya.
 *   2. Produces the role-appropriate rubric (the "test on the call").
 *   3. Generates N customer personas grounded in the policy + role.
 *
 * Output plugs straight into `composeActorPrompt` (→ callConfig, drives the live
 * call) and `composeRubric` (→ the scorer). Same seam, no bridge changes.
 *
 * Mirrors the existing voice-campaign script generator, inverted for training.
 */

import { generateJson } from "@/lib/llm";
import { buildScenarios } from "./roleplay-scenario";
import type {
  ComplianceTrap,
  CoverageItem,
  CoverageKind,
  Difficulty,
  Persona,
  RoleModule,
  RoleplayLanguage,
  RoleplayScenario,
  RubricItem,
  ScenarioSpine,
  TraineeRole,
} from "./roleplay-scenario";

export interface RoleplayGenInput {
  productId: string;
  productLabel: string;
  /** Pointer into knowledge-store for the authoritative doc (carried onto the spine). */
  knowledgeDocId: string;
  /** Brochure-verified policy facts (sourced from the knowledge store in-product). */
  policyFacts: string;
  role: TraineeRole;
  difficulty: Difficulty;
  language: RoleplayLanguage;
  /** How many personas to generate. */
  personaCount: number;
  datasetId: "absli-life";
}

export interface GeneratedRoleplay {
  spine: ScenarioSpine;
  roleModule: RoleModule;
  personas: Persona[];
  /** Ready-to-run scenarios (one per persona) for the call + scorer. */
  scenarios: RoleplayScenario[];
}

/** Bot meta-behaviour + guardrails are policy-agnostic → kept static, not generated. */
const DEFAULT_BOT_BEHAVIOR_RULES = [
  "Speak in natural, short phone-style sentences. Match the trainee's language if they switch.",
  "Do NOT volunteer everything at once — make the trainee ask to discover your needs.",
  "Be realistically skeptical, not rude. React like a real person, not a quiz.",
  "Interrupt occasionally if the trainee rambles or over-explains.",
  "Surface the compliance test arc naturally over the call — never all at once.",
];

const DEFAULT_GUARDRAILS = [
  "Never break character. Never say or imply you are an AI. Never coach the trainee.",
  "Never be abusive. End the call politely if the trainee is pushy, dishonest, or wastes your time.",
  "Only warm up and agree to a next step if the trainee is honest on the traps and does their job well.",
];

const ROLE_BRIEF: Record<TraineeRole, string> = {
  SP:
    "SP (Specified Person): the branch first-contact who meets a walk-in, EXPLAINS the product from scratch, and must CAPTURE CONSENT before entering the lead. The bot plays a fresh walk-in who came in for something else and knows nothing about the product. The rubric MUST include a gated consent-capture item.",
  RO:
    "RO (Relationship Officer): telephonic follow-up on a warm lead the SP already pitched. The bot plays a warm lead who references what the branch told them, and is fixated on returns / worried about lock-in. The rubric MUST include a gated carry-forward-consistency item (don't contradict or inflate the SP's correct explanation) and a close/next-step item.",
};

interface GenOutput {
  traps: ComplianceTrap[];
  coverage: Array<{ id: string; topic: string; kind: string; required: boolean; detail?: string }>;
  funnelStage: string;
  botFraming: string;
  rubric: RubricItem[];
  personas: Array<Omit<Persona, "role">>;
}

const COVERAGE_KINDS = new Set<CoverageKind>(["talking_point", "discovery", "disclosure", "objection"]);

export function buildRoleplayGeneratorPrompt(input: RoleplayGenInput): string {
  return [
    `You design VOICE ROLEPLAY TRAINING scenarios for insurance sales staff. The AI plays the CUSTOMER; a human ${input.role} practices and is scored.`,
    "",
    `PRODUCT: ${input.productLabel}`,
    `ROLE BEING TRAINED: ${ROLE_BRIEF[input.role]}`,
    `DIFFICULTY: ${input.difficulty}. LANGUAGE: ${input.language}. GENERATE ${input.personaCount} distinct persona(s).`,
    "",
    "AUTHORITATIVE POLICY FACTS (the single source of truth — never invent beyond this):",
    input.policyFacts.trim(),
    "",
    "YOUR JOB:",
    "Keep the output concise. This is a manager-review module, not a long manual: short labels, one-sentence pass/fail values, and no paragraphs longer than 35 words.",
    "1. TRAPS: Analyse the policy and identify the 2-3 claims most at risk of NON-COMPLIANT over-promising — e.g. stating illustrative/assumed returns as guaranteed, confusing the product category (par vs market-linked/ULIP/mutual fund), or overstating a conditional/benefit feature. For each trap give: id (kebab-case), label, bait (what the customer SAYS to tempt the trainee, in " + input.language + "), pass (what a compliant answer looks like), fail (the violation to flag), groundTruthRef (quote or cite the exact policy fact it violates).",
    "2. COVERAGE PLAN (the call agenda — what a good rep must actively cover, the POSITIVE counterpart to the traps): 4-5 items. Each has a kind: 'talking_point' (a key product benefit/fact to EXPLAIN), 'discovery' (something the rep must ASK the customer — e.g. dependents, income, goal), 'disclosure' (a MANDATORY compliance statement the rep must SAY — e.g. returns are not guaranteed/illustrative, subject to underwriting, 15-day free-look period, participating/non-linked nature), 'objection' (a likely customer objection to handle). For each: id (kebab-case), topic (short imperative), kind, required (true for must-cover items; ALWAYS true for disclosures), detail (what good coverage looks like, grounded in the facts). Include at least one 'disclosure'.",
    `3. ROLE RUBRIC: Write funnelStage, botFraming (how the customer relates to the ${input.role}), and 3-4 rubric items with id, label, weight 0..1 summing to ~1 across NON-gate items, gate:true for pass/fail gates. ${input.role === "SP" ? "Include a gated consent-capture item." : "Include a gated carry-forward-consistency item and a close/next-step item."}`,
    `4. PERSONAS: ${input.personaCount} realistic customer persona(s) grounded in this policy's likely buyer and the ${input.role} funnel stage. Each: id (kebab-case), name, difficulty ("${input.difficulty}"), language ("${input.language}"), characterPrompt (2nd-person, "You are <name>…" with situation + why they're skeptical; instructions in English, sample spoken lines in ${input.language}), openingLine (the customer's first spoken line in ${input.language}), arcNotes (how to bait the traps and ${input.role === "SP" ? "withhold consent until the SP explains AND asks" : "reference what the branch told you to test carry-forward"}).`,
    "",
    "For difficulty: an 'easy' persona should NAIVELY ACCEPT a wrong claim (so the scorer catches it); a 'hard' persona should push aggressively and expose contradictions.",
    "",
    "Return ONLY valid JSON with EXACTLY these keys:",
    `{`,
    `  "traps": [{ "id": "", "label": "", "bait": "", "pass": "", "fail": "", "groundTruthRef": "" }],`,
    `  "coverage": [{ "id": "", "topic": "", "kind": "talking_point", "required": true, "detail": "" }],`,
    `  "funnelStage": "",`,
    `  "botFraming": "",`,
    `  "rubric": [{ "id": "", "label": "", "weight": 0.0, "gate": false, "pass": "", "fail": "" }],`,
    `  "personas": [{ "id": "", "name": "", "difficulty": "${input.difficulty}", "language": "${input.language}", "characterPrompt": "", "openingLine": "", "arcNotes": "" }]`,
    `}`,
  ].join("\n");
}

export async function generateRoleplayScenarios(input: RoleplayGenInput): Promise<GeneratedRoleplay> {
  const prompt = buildRoleplayGeneratorPrompt(input);
  const out = await generateJson<GenOutput>(
    { messages: [{ role: "user", content: prompt }] },
    { feature: "roleplay.generate", datasetId: input.datasetId },
  );

  const spine: ScenarioSpine = {
    productId: input.productId,
    productLabel: input.productLabel,
    knowledgeDocId: input.knowledgeDocId,
    policyFacts: input.policyFacts,
    traps: (out.traps ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      bait: t.bait,
      pass: t.pass,
      fail: t.fail,
      groundTruthRef: t.groundTruthRef,
    })),
    coverage: (out.coverage ?? []).map(
      (c): CoverageItem => ({
        id: c.id,
        topic: c.topic,
        kind: COVERAGE_KINDS.has(c.kind as CoverageKind) ? (c.kind as CoverageKind) : "talking_point",
        required: c.kind === "disclosure" ? true : Boolean(c.required),
        detail: c.detail,
      }),
    ),
    botBehaviorRules: DEFAULT_BOT_BEHAVIOR_RULES,
    guardrails: DEFAULT_GUARDRAILS,
  };

  const roleModule: RoleModule = {
    role: input.role,
    funnelStage: out.funnelStage ?? "",
    botFraming: out.botFraming ?? "",
    rubric: (out.rubric ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      weight: typeof r.weight === "number" ? r.weight : 0,
      gate: Boolean(r.gate),
      pass: r.pass,
      fail: r.fail,
    })),
  };

  const personas: Persona[] = (out.personas ?? []).map((p) => ({
    id: p.id,
    role: input.role,
    name: p.name,
    difficulty: (p.difficulty as Difficulty) ?? input.difficulty,
    language: (p.language as RoleplayLanguage) ?? input.language,
    characterPrompt: p.characterPrompt,
    openingLine: p.openingLine,
    arcNotes: p.arcNotes,
  }));

  const scenarios: RoleplayScenario[] = buildScenarios(
    input.datasetId,
    input.productId,
    input.role,
    spine,
    roleModule,
    personas,
  );

  return { spine, roleModule, personas, scenarios };
}
