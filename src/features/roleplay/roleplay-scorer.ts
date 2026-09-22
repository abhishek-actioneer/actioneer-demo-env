/**
 * Roleplay scorer — grades a completed ASSESS call against the generated rubric.
 * ------------------------------------------------------------------------------
 * Closes the train→evaluate loop: the SAME traps/rubric the coach taught and the
 * customer baited are what the trainee is graded on here (via `composeRubric`),
 * so coaching, roleplay, and scoring share one ground truth and can't drift.
 *
 * DESIGN: the LLM is a per-item JUDGE only — it returns a verdict + a quoted
 * evidence line per rubric item. All arithmetic (weighted score, gate pass/fail,
 * overall pass) is computed HERE in code, never trusted to the model. Gates use
 * an intentional asymmetry:
 *   - Compliance gates (id "trap:*") FAIL only if the trainee actually made the
 *     violation. Never baited / handled correctly → pass. (You can't fail a
 *     compliance breach you never had occasion to make.)
 *   - Role gates (e.g. consent-capture) must be AFFIRMATIVELY demonstrated —
 *     if it never happened, that's a fail.
 */

import { generateJson } from "@/lib/llm";
import { composeRubric, type RoleplayScenario } from "./roleplay-scenario";

export interface TranscriptTurn {
  /** trainee = the human SP/RO being graded; customer = the AI bot. */
  speaker: "trainee" | "customer";
  text: string;
}

export interface ScoredItem {
  id: string;
  label: string;
  gate: boolean;
  weight: number;
  /** 0..1 competency score. For gates: 1 if passed, else 0. */
  score: number;
  /** Gate outcome (also set for competency items: score >= 0.6). */
  passed: boolean;
  /** Whether the relevant moment actually occurred in the call. */
  addressed: boolean;
  /** Short direct quote from the trainee's turns (or "" if none). */
  evidence: string;
  rationale: string;
  /** For compliance gates: the exact policy line the trap is grounded in. */
  groundTruthRef?: string;
}

export interface Scorecard {
  /** 0..100, weighted competencies only. */
  overallScore: number;
  /** True only when EVERY gate passed. A gate failure fails the assessment. */
  passed: boolean;
  /** Labels of the gates that failed (compliance / consent). */
  gateFailures: string[];
  items: ScoredItem[];
  summary: string;
  strengths: string[];
  improvements: string[];
  transcriptTurns: number;
}

interface JudgeItem {
  id: string;
  score?: number;
  passed?: boolean;
  addressed?: boolean;
  evidence?: string;
  rationale?: string;
}
interface JudgeOutput {
  items: JudgeItem[];
  summary: string;
  strengths: string[];
  improvements: string[];
}

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

function renderTranscript(turns: TranscriptTurn[], role: string): string {
  return turns
    .map((t) => `${t.speaker === "trainee" ? role : "CUSTOMER"}: ${t.text.trim()}`)
    .join("\n");
}

export function buildScorerPrompt(scenario: RoleplayScenario, turns: TranscriptTurn[]): string {
  const rubric = composeRubric(scenario);
  const role = scenario.roleModule.role;
  const facts = scenario.spine.policyFacts?.trim() || "(no policy facts provided)";

  const rubricLines = rubric.items
    .map((it) => {
      const kind = it.gate
        ? it.id.startsWith("trap:")
          ? "GATE (compliance)"
          : "GATE (required)"
        : `COMPETENCY (weight ${it.weight})`;
      return `- ${it.id} | ${kind} — ${it.label}\n    PASS: ${it.pass}\n    FAIL: ${it.fail}`;
    })
    .join("\n");

  return [
    `You are a STRICT insurance sales-compliance EXAMINER. A human ${role} (the "trainee") practised selling "${scenario.spine.productLabel}" to an AI customer. Grade ONLY what the trainee ACTUALLY said in the transcript below — never reward intent, hints, or what they "seemed to mean".`,
    "",
    "AUTHORITATIVE POLICY GROUND TRUTH (the only true facts; anything the trainee says beyond or against this is wrong):",
    facts,
    "",
    "HOW TO GRADE EACH RUBRIC ITEM (grade by id):",
    "- COMPETENCY items: score 0..1 for how well the trainee did it (0 if never attempted). Set passed = score >= 0.6.",
    '- GATE (compliance) items (id starts "trap:"): passed=false ONLY IF the trainee actually STATED or clearly IMPLIED the violation in "FAIL". If it never came up, or they handled it per "PASS", passed=true. score = passed ? 1 : 0.',
    "- GATE (required) items (e.g. consent): passed=true ONLY IF the trainee affirmatively demonstrated it in the transcript. If it never happened, passed=false. score = passed ? 1 : 0.",
    'Set addressed=true if the relevant moment actually occurred in the call. Put a SHORT direct quote from the trainee in "evidence" (or "" if none).',
    "",
    "RUBRIC ITEMS:",
    rubricLines,
    "",
    `TRANSCRIPT (trainee = the ${role}; customer = the AI):`,
    renderTranscript(turns, role),
    "",
    "Also write: summary (2-3 sentences of direct feedback to the trainee), strengths (up to 3 short bullets), improvements (up to 3 short, actionable bullets).",
    "",
    "Return ONLY valid JSON with EXACTLY these keys:",
    `{`,
    `  "items": [{ "id": "", "score": 0.0, "passed": true, "addressed": true, "evidence": "", "rationale": "" }],`,
    `  "summary": "",`,
    `  "strengths": [],`,
    `  "improvements": []`,
    `}`,
  ].join("\n");
}

export async function scoreRoleplay(
  scenario: RoleplayScenario,
  turns: TranscriptTurn[],
): Promise<Scorecard> {
  const rubric = composeRubric(scenario);
  const prompt = buildScorerPrompt(scenario, turns);

  const out = await generateJson<JudgeOutput>(
    { messages: [{ role: "user", content: prompt }] },
    { feature: "roleplay.score", datasetId: scenario.datasetId },
  );

  const byId = new Map((out.items ?? []).map((v) => [v.id, v]));
  const trapRefById = new Map(
    scenario.spine.traps.map((t) => [`trap:${t.id}`, t.groundTruthRef]),
  );

  const items: ScoredItem[] = rubric.items.map((item) => {
    const v = byId.get(item.id);
    const isGate = !!item.gate;
    const isComplianceGate = item.id.startsWith("trap:");

    let passed: boolean;
    let score: number;
    let addressed: boolean;
    let evidence: string;
    let rationale: string;

    if (v) {
      addressed = !!v.addressed;
      evidence = (v.evidence ?? "").trim();
      rationale = (v.rationale ?? "").trim();
      if (isGate) {
        passed = !!v.passed;
        score = passed ? 1 : 0;
      } else {
        score = clamp01(v.score);
        passed = score >= 0.6;
      }
    } else {
      // Judge omitted the item → conservative defaults.
      addressed = false;
      evidence = "";
      rationale = "Not evaluated.";
      if (isGate) {
        // Compliance: benefit of the doubt (no observed violation). Required: fail.
        passed = isComplianceGate;
        score = passed ? 1 : 0;
      } else {
        score = 0;
        passed = false;
      }
    }

    return {
      id: item.id,
      label: item.label,
      gate: isGate,
      weight: item.weight,
      score,
      passed,
      addressed,
      evidence,
      rationale,
      groundTruthRef: trapRefById.get(item.id),
    };
  });

  const competencies = items.filter((i) => !i.gate);
  const weightSum = competencies.reduce((a, i) => a + i.weight, 0) || 1;
  const overallScore = Math.round(
    (100 * competencies.reduce((a, i) => a + i.weight * i.score, 0)) / weightSum,
  );

  const gates = items.filter((i) => i.gate);
  const gateFailures = gates.filter((i) => !i.passed).map((i) => i.label);

  return {
    overallScore,
    passed: gateFailures.length === 0,
    gateFailures,
    items,
    summary: (out.summary ?? "").trim(),
    strengths: (out.strengths ?? []).filter(Boolean).slice(0, 3),
    improvements: (out.improvements ?? []).filter(Boolean).slice(0, 3),
    transcriptTurns: turns.length,
  };
}
