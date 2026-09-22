/**
 * Eval harness for voice semantic traps.
 * Usage: npx tsx scripts/eval-semantic-traps.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  classifyShortUtterance,
  isSemanticTrapEvaluationReady,
} from "../src/lib/voice-semantic-traps";

interface EvalCase {
  language: string;
  text: string;
  lastAssistantText: string;
  expectClarify: boolean;
  expectTrapId?: string;
  expectIntent?: string;
}

const fixturePath = resolve(__dirname, "../tests/fixtures/semantic-trap-eval.json");
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as EvalCase[];

let passed = 0;
let failed = 0;

for (const [index, testCase] of cases.entries()) {
  if (!isSemanticTrapEvaluationReady(testCase.text)) {
    console.error(`[${index}] FAIL ready-check text="${testCase.text}"`);
    failed += 1;
    continue;
  }

  const result = classifyShortUtterance({
    text: testCase.text,
    language: testCase.language,
    lastAssistantText: testCase.lastAssistantText,
    atDecisionPoint: true,
  });

  const clarify = result?.needsClarification ?? false;
  const trapOk = !testCase.expectTrapId || result?.trapId === testCase.expectTrapId;
  const intentOk = !testCase.expectIntent || result?.intent === testCase.expectIntent;
  const clarifyOk = clarify === testCase.expectClarify;

  if (clarifyOk && trapOk && intentOk) {
    passed += 1;
    console.log(`[${index}] PASS ${testCase.language} "${testCase.text}"`);
  } else {
    failed += 1;
    console.error(
      `[${index}] FAIL ${testCase.language} "${testCase.text}" ` +
      `got clarify=${clarify} trap=${result?.trapId ?? "-"} intent=${result?.intent ?? "-"}`,
    );
  }
}

console.log(`\nSemantic trap eval: ${passed}/${cases.length} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
