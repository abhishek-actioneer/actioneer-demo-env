/**
 * How reliable is Hindi <-> English switching specifically?
 *
 * The headline scoreboard mixes campaign shapes, and regional calls drag it
 * down with a 37.5% ASR-garble rate that has nothing to do with Hindi/English.
 * This isolates BILINGUAL campaigns and reports the before/after separately,
 * because every historical call predates the English-naming fix.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  FOLLOW_CUSTOMER_LANGUAGE_NUDGE,
  ROMANIZED_MARKER_LISTS,
  languageFollowInstruction,
} from "../src/lib/voice-language-policy";
import { isLowSignalTranscript } from "../src/lib/plivo-gemini-live-transcript-guards";
import { looksLikeUnsupportedRomanceAsr } from "../src/lib/voice-semantic-traps";

const DIR = "data/voice-callback-dumps/plivo-gemini-live-session";
const FIX_LANDED_MS = 1785263000000; // first call on the new code

function signal(t: string): boolean {
  if (!t?.trim() || isLowSignalTranscript(t) || looksLikeUnsupportedRomanceAsr(t)) return false;
  const w = t.split(/[^\p{L}]+/u).filter((x) => x.length > 1);
  return new Set(w.map((x) => x.toLowerCase())).size >= 3;
}
function label(t: string): string {
  if (/[ऀ-ॿ]/.test(t)) return "Hindi";
  if (/[஀-௿ఀ-౿ಀ-೿ঀ-৿଀-୿]/.test(t)) return "other-script";
  let hi = 0;
  const set = ROMANIZED_MARKER_LISTS.Hindi;
  const seen = new Set<string>();
  for (const tok of t.toLowerCase().split(/[^a-z]+/)) if (tok && set.has(tok)) seen.add(tok);
  hi = seen.size;
  if (hi >= 2) return "Hindi";
  if (/[A-Za-z]/.test(t)) return "English";
  return "unknown";
}

interface Bucket { opp: number; hit: number; miss: Array<{ to: string; text: string }> }
const before: Bucket = { opp: 0, hit: 0, miss: [] };
const after: Bucket = { opp: 0, hit: 0, miss: [] };
let calls = 0;

for (const f of readdirSync(DIR).sort()) {
  if (!f.endsWith(".json")) continue;
  let d: any;
  try { d = JSON.parse(readFileSync(join(DIR, f), "utf8")); } catch { continue }
  const si = (d.events ?? []).find((e: any) => e.type === "gemini.system_instruction");
  if (!si || /three languages/.test(si.detail?.text ?? "")) continue; // bilingual only
  calls++;
  const bucket = Number(f.split("-")[0]) >= FIX_LANDED_MS ? after : before;

  const turns = (d.events ?? [])
    .filter((e: any) =>
      ["transcript.user", "transcript.assistant", "transcript.assistant_recorded_on_drop"].includes(e.type) &&
      signal(e.detail?.text ?? ""))
    .map((e: any) => ({
      role: e.type === "transcript.user" ? "user" : "agent",
      lang: label(e.detail.text),
      text: e.detail.text as string,
    }));

  let prev: string | undefined;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "user" || t.lang === "unknown" || t.lang === "other-script") continue;
    if (prev && prev !== t.lang) {
      const next = turns.slice(i + 1).find((x: any) => x.role === "agent" && x.lang !== "unknown");
      if (next) {
        bucket.opp++;
        if (next.lang === t.lang) bucket.hit++;
        else bucket.miss.push({ to: t.lang, text: t.text });
      }
    }
    prev = t.lang;
  }
}

const pct = (b: Bucket) => (b.opp ? ((b.hit / b.opp) * 100).toFixed(1) + "%" : "n/a");
console.log(`Hindi+English campaigns: ${calls} calls\n`);
console.log(`  BEFORE the fix   ${before.hit}/${before.opp} = ${pct(before)}`);
console.log(`  AFTER the fix    ${after.hit}/${after.opp} = ${pct(after)}`);

const dir: Record<string, number> = {};
for (const m of before.miss) dir[`-> ${m.to}`] = (dir[`-> ${m.to}`] ?? 0) + 1;
console.log(`\n  BEFORE misses by direction: ${JSON.stringify(dir)}`);

let fixed = 0;
console.log(`\n  Would today's detector give each BEFORE-miss a concrete directive?`);
for (const m of before.miss) {
  const line = languageFollowInstruction(m.text, "Hindi");
  const ok = line !== FOLLOW_CUSTOMER_LANGUAGE_NUDGE;
  if (ok && line === `Reply in ${m.to}.`) fixed++;
  console.log(`    ${ok ? "YES" : "no "}  want ${m.to.padEnd(7)} ${JSON.stringify(line.replace("Reply in ", "").replace(".", "")).padEnd(12)} ${m.text.slice(0, 58)}`);
}
console.log(`\n  ${fixed}/${before.miss.length} of the historical misses would now be named correctly.`);
