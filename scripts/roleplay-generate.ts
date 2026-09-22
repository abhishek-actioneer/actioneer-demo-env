/**
 * Roleplay generation demo — proves the product engine: policy -> personas + rubric.
 *
 * Runs `generateRoleplayScenarios` against the real Anmol Akshaya policy facts for
 * the SP role, prints the DERIVED traps, the generated rubric (the "test"), and the
 * personas — then composes one actor prompt to show it plugs into the call path.
 *
 * Usage: npx tsx scripts/roleplay-generate.ts [SP|RO] [easy|medium|hard] [count]
 */

import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

loadEnvFile(resolve(".env.local"));

import { generateRoleplayScenarios } from "../src/features/roleplay/roleplay-generator";
import { composeActorPrompt, composeRubric, type TraineeRole, type Difficulty } from "../src/features/roleplay/roleplay-scenario";
import { ANMOL_AKSHAYA_POLICY_FACTS } from "../src/features/roleplay/roleplay-anmol-akshaya";

async function main(): Promise<void> {
  const role = (process.argv[2] as TraineeRole) || "SP";
  const difficulty = (process.argv[3] as Difficulty) || "medium";
  const count = Number(process.argv[4]) || 2;

  console.log(`Generating ${count} ${role} persona(s) @${difficulty} from Anmol Akshaya policy…\n`);

  const gen = await generateRoleplayScenarios({
    productId: "absli-anmol-akshaya",
    productLabel: "ABSLI Anmol Akshaya",
    knowledgeDocId: "absli-anmol-akshaya-brochure",
    policyFacts: ANMOL_AKSHAYA_POLICY_FACTS,
    role,
    difficulty,
    language: "Hinglish",
    personaCount: count,
    datasetId: "absli-life",
  });

  console.log("── DERIVED COMPLIANCE TRAPS ─────────────────────────────");
  for (const t of gen.spine.traps) {
    console.log(`• [${t.label}] bait: ${t.bait}`);
    console.log(`    pass: ${t.pass}`);
    console.log(`    fail: ${t.fail}`);
    console.log(`    ref:  ${t.groundTruthRef}\n`);
  }

  console.log("── GENERATED RUBRIC (the test on the call) ──────────────");
  console.log(`funnelStage: ${gen.roleModule.funnelStage}`);
  for (const r of composeRubric(gen.scenarios[0]).items) {
    console.log(`• ${r.label}${r.gate ? " [GATE]" : ` (w=${r.weight})`} — pass: ${r.pass}`);
  }

  console.log("\n── GENERATED PERSONAS ───────────────────────────────────");
  for (const p of gen.personas) {
    console.log(`• ${p.name} (${p.id}, ${p.difficulty}, ${p.language})`);
    console.log(`    opens: ${p.openingLine}`);
    console.log(`    arc:   ${p.arcNotes ?? "(none)"}\n`);
  }

  console.log("── PROOF IT DRIVES A CALL: composed actor prompt (persona 1) ──");
  const actor = composeActorPrompt(gen.scenarios[0]);
  console.log(`firstMessage → ${actor.firstMessage}`);
  console.log(`systemPrompt (first 500 chars) →\n${actor.systemPrompt.slice(0, 500)}…`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
