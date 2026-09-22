/**
 * Roleplay dry-run (L1) — text harness, NO telephony, no cost beyond text tokens.
 *
 * Validates the bot-customer PERSONA before spending a phone call:
 *  - does the customer stay in character?
 *  - do the 3 Anmol Akshaya compliance traps actually surface?
 *  - does the SP scenario correctly withhold consent until asked?
 *  - does the customer warm up for a COMPLIANT SP and latch onto violations
 *    for a MIS-SELLING SP?
 *
 * It runs two scripted SP conversations against the composed persona and prints
 * both transcripts side by side.
 *
 * NOTE: uses the project text LLM (OpenAI Responses) as a behaviour proxy. The
 * live call uses Gemini Live — this checks whether the PROMPT elicits the right
 * behaviour, which transfers; fine-tune voice specifics on a real call (L3).
 *
 * Usage: npx tsx scripts/roleplay-dry-run.ts
 */

import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

loadEnvFile(resolve(".env.local"));

import { composeActorPrompt } from "../src/features/roleplay/roleplay-scenario";
import { ANMOL_AKSHAYA_SP_SCENARIO } from "../src/features/roleplay/roleplay-anmol-akshaya";
import { generateText } from "../src/lib/llm";

type Msg = { role: "system" | "user" | "assistant"; content: string };

// A COMPLIANT SP — discovers need, explains honestly, passes the traps, asks consent.
const SP_COMPLIANT: string[] = [
  "Namaste Meena ji. FD ke saath-saath, main aapko ek plan bata sakta hoon jo bacche ke future ke liye accha hai — sirf 2 minute? Main Rahul, ABSLI se.",
  "Aap bacche ke liye kitne saal baad paisa chahengi, aur aap zyada safe rakhna chahti hain ya thoda risk chalega?",
  "Ye Anmol Akshaya ek savings-plus-life-insurance plan hai. Isme ek guaranteed hissa hota hai aur ek bonus hissa jo company ki performance pe depend karta hai. Jo bade return ke numbers dikhte hain wo assumed hote hain, guaranteed nahi.",
  "Nahi, ye share market wala nahi hai. Aapka paisa seedha market mein nahi lagta — returns bonus se aate hain, aur saath mein life cover milta hai.",
  "Mahilaon ke liye kuch extra benefits hain — ek health check-up benefit aur kuch maternity-related liquidity kuch saal baad. Exact amount main brochure se confirm karke bataunga, abhi koi galat number nahi bolna chahta.",
  "Agar aapko theek lage toh main aapki details note kar loon aur humari team follow-up call karegi — aapki permission hai?",
];

// A MIS-SELLING SP — over-promises, calls it market-linked, inflates HER, skips consent.
const SP_MISSELLING: string[] = [
  "Meena ji, ye Anmol Akshaya le lijiye — isme guaranteed 7.53% milega, industry mein sabse zyada.",
  "Bilkul mutual fund jaisa hai, market ka pura fayda milega, tension mat lijiye.",
  "Aur mahila hone ke naate aapko 65,000 cash turant mil jayega.",
  "Main aapka number aage bhej deta hoon, team laga degi.",
];

async function runConversation(label: string, spTurns: string[]): Promise<void> {
  const { systemPrompt, firstMessage } = composeActorPrompt(ANMOL_AKSHAYA_SP_SCENARIO);

  console.log(`\n${"=".repeat(72)}\n  ${label}\n${"=".repeat(72)}`);
  // The walk-in speaks first (approaches the counter). Keep the running dialogue
  // in a single user turn each round — the Responses API rejects assistant-role
  // input parts, so we don't thread assistant messages.
  let transcript = `CUSTOMER (Meena): ${firstMessage}`;
  console.log(`CUSTOMER (Meena): ${firstMessage}`);

  for (const turn of spTurns) {
    transcript += `\nSP: ${turn}`;
    console.log(`\nSP: ${turn}`);
    const userPrompt =
      `${transcript}\n\nContinue as Meena. Reply with ONLY Meena's next spoken line ` +
      `(natural Hinglish, short, in character), nothing else.`;
    const messages: Msg[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    const reply = (await generateText({
      messages,
      feature: "roleplay.dryrun",
      datasetId: "absli-life",
    })).trim();
    transcript += `\nCUSTOMER (Meena): ${reply}`;
    console.log(`CUSTOMER (Meena): ${reply}`);
  }
}

async function main(): Promise<void> {
  console.log("Composed persona system prompt:\n");
  console.log(composeActorPrompt(ANMOL_AKSHAYA_SP_SCENARIO).systemPrompt);

  await runConversation("SCENARIO A — COMPLIANT SP (expect: warms up, gives consent)", SP_COMPLIANT);
  await runConversation("SCENARIO B — MIS-SELLING SP (expect: latches onto false promises, no clean consent)", SP_MISSELLING);

  console.log(`\n${"=".repeat(72)}`);
  console.log("Eyeball check:");
  console.log("  - Did Meena stay in character (confused first-timer, not an assistant)?");
  console.log("  - In A: did she ask for simple explanation, then warm up and consent?");
  console.log("  - In B: did she latch onto 'guaranteed 7.53%' / 'mutual fund' / 'instant 65k'?");
  console.log("  - Did she withhold consent until the SP explained AND asked?");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
