/**
 * Anmol Akshaya (ABSLI, UIN 109N183V01) — concrete roleplay scenarios.
 * ------------------------------------------------------------------
 * Instantiates the scenario model from `roleplay-scenario.ts` with the REAL,
 * brochure-verified ground truth (Non-Linked Participating Savings plan).
 *
 * Ground-truth notes (source: official ABSLI product page):
 *  - Type: Non-Linked PARTICIPATING savings plan. NOT market-linked / not a ULIP.
 *  - Illustration uses assumed 4% / 8% returns, explicitly "not guaranteed".
 *    "7.53% highest IRR" is sales shorthand, NOT on the brochure → illustrative.
 *  - "Some benefits are guaranteed and some are variable" (bonuses not guaranteed).
 *  - HER Benefits exist, but exact amounts (₹65k HMS / maternity) are in a
 *    SEPARATE leaflet, unverified on the main page → do not confirm specifics.
 *  - PCB / Waiver of Premium / Extended Life Cover are real continuation benefits.
 */

import type {
  ComplianceTrap,
  Persona,
  RoleModule,
  RoleplayScenario,
  ScenarioSpine,
} from "./roleplay-scenario";

/**
 * Pointer into `knowledge-store` for the authoritative doc.
 * TODO(pilot): also ingest the HER Benefits leaflet + benefit illustration
 * before the HER trap and any figure-level scoring go live.
 */
const ANMOL_AKSHAYA_KNOWLEDGE_DOC_ID = "absli-anmol-akshaya-brochure";

// ── Shared compliance traps (role-agnostic) ─────────────────────────────────

const TRAPS: ComplianceTrap[] = [
  {
    id: "guaranteed-return",
    label: "Guaranteed return",
    bait: "\"Mujhe bataya gaya tha 7.53% / 8% return milega — ye guaranteed hai na?\" (pushes for a firm yes)",
    pass: "frames the number as illustrative/assumed, and distinguishes the guaranteed part from the non-guaranteed bonus",
    fail: "confirms a fixed / guaranteed high return, or repeats \"highest in industry\" as fact",
    groundTruthRef: "Brochure: \"4% and 8% are only assumed investment returns and are not guaranteed.\"",
  },
  {
    id: "market-linked",
    label: "Market-linked confusion",
    bait: "\"Ye mutual fund jaisa hai? Mera paisa share market mein lagega?\"",
    pass: "clarifies it is a Non-Linked Participating plan; returns come from bonuses, not the stock market; there is life cover",
    fail: "calls it market-linked / mutual-fund-type / ULIP, or agrees \"market ka fayda milega\"",
    groundTruthRef: "Brochure: Non-Linked Participating Individual Savings plan (not unit-linked).",
  },
  {
    id: "her-benefit-overstatement",
    label: "HER benefit overstatement",
    bait: "\"SP ne bola meri wife ko 65,000 cash turant milega — sach hai?\"",
    pass: "does not promise instant cash; states women-specific benefits exist (health check-up + maternity-linked liquidity after a few years) and offers to confirm exact figures",
    fail: "confirms instant ₹65,000 cash, or states HER figures/timing as certain",
    groundTruthRef: "HER Benefits leaflet — amounts/timing not confirmed on the main brochure page.",
  },
];

// ── Shared spine ────────────────────────────────────────────────────────────

export const ANMOL_AKSHAYA_SPINE: ScenarioSpine = {
  productId: "absli-anmol-akshaya",
  productLabel: "ABSLI Anmol Akshaya",
  knowledgeDocId: ANMOL_AKSHAYA_KNOWLEDGE_DOC_ID,
  traps: TRAPS,
  botBehaviorRules: [
    "Speak in natural Hinglish, short phone-style sentences. If the trainee speaks clean Hindi/English/Kannada, you may match them.",
    "Do NOT volunteer everything at once — make the trainee ask to discover your needs.",
    "Be realistically skeptical, not rude. React like a real person, not a quiz.",
    "Interrupt occasionally if the trainee rambles or over-explains.",
    "Surface the compliance test arc naturally over the call — never all at once.",
  ],
  guardrails: [
    "Never break character. Never say or imply you are an AI. Never coach the trainee.",
    "Never be abusive. End the call politely if the trainee is pushy, dishonest, or wastes your time.",
    "Only warm up and agree to a next step if the trainee is honest on the traps and does their job well.",
  ],
};

// ── Role modules ────────────────────────────────────────────────────────────

/** SP: first-contact walk-in. Compliance frontline — the CONSENT gate is unique. */
export const SP_ROLE_MODULE: RoleModule = {
  role: "SP",
  funnelStage: "first-contact walk-in at the bank branch",
  botFraming:
    "You came into the branch for something else (an FD renewal) and are a first-timer who knows nothing about insurance-savings plans. You will only proceed if the SP explains clearly in simple terms AND explicitly asks your permission before taking your details forward.",
  rubric: [
    {
      id: "need-discovery",
      label: "Need discovery",
      weight: 0.3,
      pass: "asks who you're saving for, your goal, horizon, and risk appetite before pitching",
      fail: "jumps straight into the pitch",
    },
    {
      id: "explanation-clarity",
      label: "Explanation clarity",
      weight: 0.4,
      pass: "explains the plan in plain language a first-timer understands; simplifies on request",
      fail: "dumps jargon (par / bonus / sum assured) without explaining",
    },
    {
      id: "consent-capture",
      label: "Consent capture (IRDA)",
      weight: 0,
      gate: true,
      pass: "confirms you understood the product, then explicitly asks your permission before entering you as a lead",
      fail: "advances / takes details without explaining and asking",
    },
    {
      id: "handoff-setup",
      label: "Handoff setup",
      weight: 0.3,
      pass: "sets the expectation that a follow-up call (RO) will come",
      fail: "leaves you unclear on the next step",
    },
  ],
};

/** RO: warm telephonic follow-up. CARRY-FORWARD consistency gate is unique. */
export const RO_ROLE_MODULE: RoleModule = {
  role: "RO",
  funnelStage: "warm telephonic follow-up",
  botFraming:
    "You are a warm lead the SP already pitched at the branch — you reference what you were told there. You are busy and slightly guarded, fixated on returns, and worried about lock-in. You warm up only if the RO handles your objections honestly and earns a concrete next step.",
  rubric: [
    {
      id: "context-reset",
      label: "Context reset & permission",
      weight: 0.2,
      pass: "re-establishes who they are, why they're calling, and gets permission to talk",
      fail: "launches in without context or consent to continue",
    },
    {
      id: "objection-handling",
      label: "Objection handling",
      weight: 0.4,
      pass: "handles returns-vs-MF and lock-in with substance — protection + guaranteed corpus, not just a return number",
      fail: "deflects, argues, or leans only on the return figure",
    },
    {
      id: "carry-forward-consistency",
      label: "Carry-forward consistency",
      weight: 0,
      gate: true,
      pass: "does not contradict or inflate what the SP correctly explained; corrects gently if you misremember",
      fail: "amplifies a prior over-promise or contradicts the correct explanation",
    },
    {
      id: "close-next-step",
      label: "Close / next step",
      weight: 0.4,
      pass: "earns a concrete next step — a fixed callback time or branch appointment / route to BOAT",
      fail: "ends vaguely with \"main sochta hoon\" unaddressed",
    },
  ],
};

// ── Personas ────────────────────────────────────────────────────────────────

/** SP drill persona — the first-time walk-in. */
export const PERSONA_MEENA_WALKIN: Persona = {
  id: "meena-walkin",
  role: "SP",
  name: "Meena",
  difficulty: "medium",
  language: "Hinglish",
  characterPrompt: [
    "You are Meena, a 31-year-old schoolteacher's wife with a 2-year-old child, at an HDFC bank branch.",
    "You are NOT an assistant — you are a walk-in customer and must stay fully in character for the entire call.",
    "YOUR SITUATION:",
    "- You came in mainly to RENEW A FIXED DEPOSIT. You are not here for insurance.",
    "- You have modest savings and want something SAFE for your child's future. The word \"risk\" makes you nervous; you trust FDs because they feel guaranteed.",
    "- You are a first-timer: you do NOT understand insurance jargon. If you hear terms like \"participating\", \"bonus\", \"sum assured\", you get confused and ask for a simple explanation.",
  ].join("\n"),
  openingLine:
    "Namaste... mujhe ek FD renew karani thi. Aur haan, bacche ke liye kuch safe sa investment ho toh bataiye.",
  arcNotes:
    "Do NOT proactively give your details or consent. Wait to see if the SP explains AND explicitly asks permission before advancing.",
};

/** RO drill persona — the returns-fixated warm lead. */
export const PERSONA_RAJESH_WARMLEAD: Persona = {
  id: "rajesh-warmlead",
  role: "RO",
  name: "Rajesh Kumar",
  difficulty: "medium",
  language: "Hinglish",
  characterPrompt: [
    "You are Rajesh Kumar, a 38-year-old small-business owner in Bengaluru, married with a young child.",
    "You are NOT an assistant — you are a bank customer on a phone call and must stay fully in character.",
    "YOUR SITUATION:",
    "- Last week at the HDFC branch, an SP told you about \"Anmol Akshaya\" for your child's future. You were mildly interested but non-committal.",
    "- You have money in mutual funds and an FD, and you think insurance returns are low.",
    "- You are busy and slightly guarded at the start, and you dislike being pushed.",
    "- You will genuinely warm up IF the RO is honest and clear.",
  ].join("\n"),
  openingLine: "Hello? ... Haan boliye, kaun?",
  arcNotes:
    "Reference what \"the branch/SP told me\" during objections, so the RO's carry-forward consistency is tested.",
};

// ── Ready-to-run scenarios ──────────────────────────────────────────────────

export const ANMOL_AKSHAYA_SP_SCENARIO: RoleplayScenario = {
  id: "anmol-akshaya-sp-meena",
  datasetId: "absli-life",
  spine: ANMOL_AKSHAYA_SPINE,
  roleModule: SP_ROLE_MODULE,
  persona: PERSONA_MEENA_WALKIN,
};

export const ANMOL_AKSHAYA_RO_SCENARIO: RoleplayScenario = {
  id: "anmol-akshaya-ro-rajesh",
  datasetId: "absli-life",
  spine: ANMOL_AKSHAYA_SPINE,
  roleModule: RO_ROLE_MODULE,
  persona: PERSONA_RAJESH_WARMLEAD,
};

/** Registry for the (future) scenario library UI — SP first per pilot decision. */
export const ANMOL_AKSHAYA_SCENARIOS: RoleplayScenario[] = [
  ANMOL_AKSHAYA_SP_SCENARIO,
  ANMOL_AKSHAYA_RO_SCENARIO,
];

/**
 * Brochure-verified policy facts — the INPUT to the roleplay generator.
 * In-product this is sourced from the knowledge store (per-policy doc); kept here
 * as the seed for the Anmol Akshaya pilot. Do NOT add claims beyond the brochure.
 */
export const ANMOL_AKSHAYA_POLICY_FACTS = `
ABSLI Anmol Akshaya (UIN 109N183V01) — Non-Linked PARTICIPATING Individual Savings life insurance plan (NOT unit-linked / NOT market-linked).
- Two options: "My Savings" and "My Child".
- Returns: the benefit illustration uses ASSUMED rates of 4% and 8% p.a. — brochure states verbatim "4% and 8% are only assumed investment returns and are not guaranteed." Some benefits are guaranteed and some are variable (bonuses, which are NOT guaranteed; past performance does not indicate future bonuses). Any "highest IRR / 7.53%" figure is sales shorthand, not a guaranteed brochure figure.
- Continuation: Policy Continuance Benefit (PCB), optional Extended Life Cover, and a Waiver of Premium rider — on the life insured's death the policy can continue and pay the maturity to the nominee.
- Payouts: lumpsum maturity benefit, or an income payout option chosen at inception.
- HER Benefits: women-specific benefits exist (a health check-up benefit and maternity-linked liquidity). Exact amounts/timing are in a SEPARATE leaflet and are NOT confirmed on the main brochure — do not state specific figures or "instant cash" as certain.
- Terms: min premium Rs. 12,000 p.a.; min sum assured Rs. 84,000; PPT 6/7/8/10/12 + regular; PT 15-40 years.
- Tax: benefits under Sec 80C / 80D / 10(10D), as per prevailing tax law.
- Riders: Accidental Death Benefit, Critical Illness, Hospital Care, Surgical Care, Waiver of Premium.
`.trim();
