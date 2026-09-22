/**
 * Training-call script — the plain-text INSTRUCTOR call script the AI voice
 * agent follows when it phones a trainee to teach them.
 *
 * This is a CONTENT-TRAINING call: the AI is an instructor/coach (not a
 * customer). It phones the trainee (SP/RO) and teaches them everything they
 * must know before they face a real customer — the product, the required
 * coverage, every mandatory disclosure, and how to handle each compliance trap
 * the right way. The generated script IS the realtime system prompt for that
 * instructor agent, built from everything in the scenario bundle (plus an
 * optional trainer brief scoping what to focus the lesson on).
 *
 * This file is pure (no I/O): (bundle, brief?) → prompt. The route runs the LLM
 * and persists the returned text.
 */

import type { SavedScenarioBundle, TraineeRole } from "./roleplay-scenario";

export interface TrainingCallScript {
  /** Keyed to the scenario bundle it was generated from. */
  scenarioBundleId: string;
  datasetId: string;
  role: TraineeRole;
  language: string;
  /** The plain-text customer call script (realtime system prompt). */
  script: string;
  /** Epoch millis. */
  generatedAt: number;
}

function trim(value: string | undefined, max = 1200): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trim()}...`;
}

function rolePlural(role: TraineeRole): string {
  return role === "RO" ? "Relationship Officers (ROs)" : "Sales Persons (SPs)";
}

export type VoiceGender = "female" | "male" | "unknown";

/**
 * The instructor speaks in first person throughout the script, so its self-
 * reference must match the selected voice's gender (e.g. "kar sakti hoon" for a
 * female voice, "kar sakta hoon" for a male one). Returns a prompt block, or ""
 * when the gender is unknown.
 */
function genderInstruction(gender: VoiceGender): string {
  if (gender === "unknown") return "";
  const forms =
    gender === "female"
      ? `"kar sakti hoon", "samajh lungi", "kar dungi", "karungi", "bata rahi hoon", "kar rahi hoon", "poochhungi"`
      : `"kar sakta hoon", "samajh lunga", "kar dunga", "karunga", "bata raha hoon", "kar raha hoon", "poochhunga"`;
  return `AGENT VOICE GENDER: The instructor's voice is ${gender}. Write EVERY first-person line the instructor speaks to match a ${gender} speaker. In Hindi/Hinglish that means using ${forms} — never the opposite-gender forms. Keep the instructor's self-reference consistently ${gender} throughout the whole script.`;
}

/**
 * Fixed delivery rules prepended to the lesson guide when it is sent to the
 * realtime voice agent. The lesson guide is only the CONTENT; these rules make
 * the agent teach one point at a time and — critically — actually STOP and wait
 * for the trainee to reply instead of racing through the whole lesson. Enforced
 * here (not left to the LLM) so turn-taking is deterministic.
 */
export function buildInstructorDeliveryRules(
  gender: VoiceGender = "unknown",
  options?: { openingRoadmap?: string },
): string {
  const forms =
    gender === "female"
      ? `"main samjha rahi hoon", "main bata sakti hoon", "main karungi", "main poochhungi", "main dungi"`
      : `"main samjha raha hoon", "main bata sakta hoon", "main karunga", "main poochhunga", "main dunga"`;
  const genderRule =
    gender === "unknown"
      ? ""
      : `\n- YOUR VOICE IS ${gender.toUpperCase()}. Every time you refer to yourself, use ${gender} verb forms — ${forms} — and NEVER the opposite-gender forms. This holds even when you improvise your own lines, not just the guide's examples.`;
  const openingRoadmap = options?.openingRoadmap?.trim()
    ? `- After the trainee agrees to talk, say this short roadmap exactly once, then STOP and wait: "${options.openingRoadmap.trim()}"`
    : "- After the trainee agrees to start, give a soft one-turn roadmap: what this call is for, what customer situation they are preparing for, and that you will cover compliance points one by one.";
  return `HOW TO RUN THIS TRAINING CALL — follow strictly:
You are an insurance sales INSTRUCTOR coaching a trainee by phone. This is a LIVE two-way conversation, not a lecture. The LESSON GUIDE below is your reference to teach from, never a speech to read out.
${openingRoadmap}
- Teach ONE point at a time, in 1–2 short, simple spoken-Hinglish sentences.
- After you explain a point, ask a short check like "samajh aaya?" or "theek hai?" and then STOP. Asking the check ENDS your turn — do NOT answer it yourself and do NOT start the next point in the same turn.
- WAIT for the trainee to actually reply before continuing. If they are confused or silent, re-explain the SAME point shorter and simpler; do not move on until they confirm.
- Never deliver two points in one turn, and never read the guide verbatim or in one go.
- If the lesson guide or examples contain opposite-gender first-person wording, silently convert it before speaking. Never refer to yourself with the wrong gender.
- Do not proactively announce that you are AI. If the trainee explicitly asks whether you are AI, a bot, or a recorded voice, answer truthfully in one short sentence: "Haan, main Aditya Birla Sun Life Insurance ka AI training voice agent hoon." Then continue the training call naturally.
- Be warm and encouraging, but firm on compliance.${genderRule}

LESSON GUIDE:`;
}

/**
 * Assemble the (system, user) messages that make the model write a plain-text
 * INSTRUCTOR lesson guide from EVERYTHING in the scenario bundle (and an optional
 * trainer brief scoping what to focus the lesson on). `voiceGender` matches the
 * instructor's first-person grammar to the selected voice.
 */
export function buildCallScriptPrompt(
  bundle: SavedScenarioBundle,
  brief?: string,
  voiceGender: VoiceGender = "unknown",
): { system: string; user: string } {
  const { spine, roleModule } = bundle;
  const coverage = spine.coverage ?? [];
  const talkingPoints = coverage.filter((c) => c.required && c.kind !== "disclosure" && c.kind !== "objection");
  const disclosures = coverage.filter((c) => c.required && c.kind === "disclosure");
  const objections = coverage.filter((c) => c.kind === "objection");

  const system = `You write the INSTRUCTOR LESSON GUIDE for a phone CONTENT-TRAINING call for insurance sales agents.

An AI voice agent phones a sales trainee and acts as an INSTRUCTOR/COACH (a teacher, NOT a customer), teaching — over a natural phone conversation — what the trainee must know before they face a real customer.

WHAT YOU PRODUCE: the coach's LESSON GUIDE — the points to teach, in a sensible teaching order, each with the key fact in plain words and a short, natural example of how the coach might say it. The agent teaches FROM this guide; it does not read it out verbatim.

FORMAT — aim for a natural MIDDLE, not either extreme:
- NOT a rigid "Beat 1 / Beat 2 / Step 1" numbered list of one-liners.
- NOT one long monologue or "script to speak" wall of text.
- INSTEAD: flowing teaching notes grouped by topic, in this order — (1) opening & discovery, (2) the two options My Savings vs My Child, (3) PCB / ELC / riders & key limits, (4) mandatory disclosures, (5) compliance traps, (6) consent & close. Under each topic write a few short sentences of what to convey plus one or two SHORT example spoken lines the coach could use.
- Keep the whole guide tight and focused — a coach should be able to teach it in a few minutes.

Weave in the delivery reminder that the agent teaches ONE point at a time and then checks understanding before moving on; keep spoken lines short and simple. Drill the mandatory items hardest (product nature / illustration limits, and explicit consent before lead entry).

Output PLAIN TEXT only — no markdown fences, no JSON. Teach ONLY from the approved facts; if you don't have something, say you can't confirm it and point to the brochure — never invent product facts.`;

  const trapLines = spine.traps.length
    ? spine.traps
        .map(
          (t, i) =>
            `  ${i + 1}. ${t.label}\n     Customer will tempt like: ${trim(t.bait, 300)}\n     RIGHT way (teach this): ${trim(t.pass, 300)}\n     WRONG way (warn against this): ${trim(t.fail, 300)}`,
        )
        .join("\n")
    : "  (none)";

  const rubricLines = roleModule.rubric.length
    ? roleModule.rubric.map((r) => `  - ${r.gate ? "[MUST-PASS] " : ""}${r.label}: pass = ${trim(r.pass, 200)}`).join("\n")
    : "  (none)";

  const briefBlock = brief?.trim()
    ? `TRAINER BRIEF FOR THIS CALL (focus the lesson on this):\n${trim(brief, 600)}\n\n`
    : "";

  const gender = genderInstruction(voiceGender);
  const genderBlock = gender ? `${gender}\n\n` : "";

  const user = `${briefBlock}${genderBlock}PRODUCT: ${bundle.productLabel}
TRAINEE ROLE: ${roleModule.role} — ${rolePlural(roleModule.role)}${roleModule.funnelStage ? ` at the "${roleModule.funnelStage}" stage` : ""}
DIFFICULTY: ${bundle.difficulty}
CALL LANGUAGE: ${bundle.language} (write spoken lines in this language)

HOW THE INSTRUCTOR SHOULD FRAME THE LESSON:
${trim(roleModule.botFraming, 600) || "A supportive product-sales coach preparing this trainee for live customer calls."}

WHAT THE INSTRUCTOR MUST TEACH (walk through each, plainly):
${talkingPoints.map((c) => `  - ${c.topic}${c.detail?.trim() ? ` — ${c.detail.trim()}` : ""}`).join("\n") || "  (none specified)"}

MANDATORY DISCLOSURES TO DRILL (teach each and why it matters):
${disclosures.map((c) => `  - ${c.topic}${c.detail?.trim() ? ` — ${c.detail.trim()}` : ""}`).join("\n") || "  (none specified)"}

OBJECTIONS TO PREPARE THE TRAINEE FOR (teach how to answer each):
${objections.map((o) => `  - ${o.topic}${o.detail?.trim() ? `: ${o.detail.trim()}` : ""}`).join("\n") || "  (prepare them for realistic objections)"}

COMPLIANCE TRAPS TO TEACH (right way vs wrong way):
${trapLines}

GUARDRAILS THE INSTRUCTOR MUST NEVER VIOLATE:
${spine.guardrails.map((g) => `  - ${g}`).join("\n") || "  (stay in the instructor role; teach only from approved facts)"}

SCORING RUBRIC THE TRAINEE WILL LATER BE GRADED ON (teach so they can pass it):
${rubricLines}

APPROVED PRODUCT FACTS (teach ONLY from these; never contradict or exceed them):
${trim(spine.policyFacts || bundle.policyFacts, 2600)}

Now write the lesson guide as flowing teaching notes grouped by the six topics above — short paragraphs with a couple of short example spoken lines each. Not a numbered "Beat"/"Step" list, and not a long monologue.`;

  return { system, user };
}
