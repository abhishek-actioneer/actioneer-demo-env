/**
 * Evaluate the romanized-language detectors against every Latin-script user
 * transcript we have recorded, before they are allowed anywhere near a call.
 *
 * The bar: a false positive pushes a speaker of one language into another, so
 * precision matters far more than recall. Two separate checks:
 *
 *   1. HINDI PRECISION — the original measurement. Every line the Hindi list
 *      flags at the two-marker threshold must genuinely be Hindi or Hinglish.
 *      Reviewed by eye below; the count is the regression signal.
 *
 *   2. REGIONAL FALSE POSITIVES — the corpus is Hindi and English only (2026-07-28:
 *      634 unique customer transcripts, 7 Tamil and 2 Telugu, all in native
 *      script, zero romanized regional lines). So ANY Tamil/Telugu/Kannada/
 *      Marathi/Bengali/Odia line flagged here is by construction a false
 *      positive. This number must be 0.
 *
 * Recall on the regional lists cannot be measured until romanized regional
 * speech shows up in the dumps. Unit tests cover it with authored sentences,
 * which is weaker evidence and is labelled as such.
 *
 * Reads the lists straight from src so this cannot drift from what ships.
 *
 * Run: npx tsx tmp/eval-romanized.ts
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

import {
  ENGLISH_MARKER_LIST,
  ROMANIZED_MARKER_LISTS,
  languageFollowInstruction,
} from "../src/lib/voice-language-policy";

const DIR = "data/voice-callback-dumps/plivo-gemini-live-session";
const MIN_MARKERS = 2;

function markerHits(text: string, markers: ReadonlySet<string>): string[] {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return [...new Set(tokens.filter((t) => markers.has(t)))];
}

const texts: string[] = [];
for (const file of readdirSync(DIR)) {
  if (!file.endsWith(".json")) continue;
  let dump: { events?: Array<{ type?: string; detail?: { text?: string } }> };
  try {
    dump = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  } catch {
    continue;
  }
  for (const e of dump.events ?? []) {
    if (e.type === "transcript.user" && e.detail?.text?.trim()) texts.push(e.detail.text.trim());
  }
}

const latin = [...new Set(texts)].filter((t) => !/[^\x00-\x7F]/.test(t));
const hindi = ROMANIZED_MARKER_LISTS.Hindi;

const flagged = latin.filter((t) => markerHits(t, hindi).length >= MIN_MARKERS);
const single = latin.filter((t) => markerHits(t, hindi).length === 1);
const none = latin.filter((t) => markerHits(t, hindi).length === 0);

console.log(`Latin-script unique transcripts: ${latin.length}`);
console.log(`  >=2 Hindi markers (would send "Reply in Hindi"): ${flagged.length}`);
console.log(`   1 marker  (stays neutral): ${single.length}`);
console.log(`   0 markers (stays neutral): ${none.length}`);

// ── Check 2: regional lists must never fire on this Hindi/English corpus ─────
console.log(`\n--- regional false positives (each must be 0) ---`);
let regionalFalsePositives = 0;
for (const [language, markers] of Object.entries(ROMANIZED_MARKER_LISTS)) {
  if (language === "Hindi") continue;
  const hits = latin.filter((t) => markerHits(t, markers).length >= MIN_MARKERS);
  regionalFalsePositives += hits.length;
  console.log(`  ${language.padEnd(8)} ${hits.length}`);
  for (const t of hits) console.log(`      [${markerHits(t, markers).join(",")}] ${t.slice(0, 88)}`);
}

// Sub-threshold hits are not bugs, but a list drifting toward English shows up
// here first, so it is worth watching.
console.log(`\n--- regional single-marker touches (watch list, not failures) ---`);
for (const [language, markers] of Object.entries(ROMANIZED_MARKER_LISTS)) {
  if (language === "Hindi") continue;
  const touched = latin.filter((t) => markerHits(t, markers).length === 1);
  if (!touched.length) continue;
  console.log(`  ${language}: ${touched.length}`);
  for (const t of touched.slice(0, 8)) {
    console.log(`      [${markerHits(t, markers).join(",")}] ${t.slice(0, 84)}`);
  }
}

// ── Check 3: the English detector, the other direction of the same risk ─────
// A false positive here shoves a HINDI speaker into English. The corpus is the
// right test set: it is full of romanized Hindi, which is exactly what must not
// be mistaken for English.
console.log(`\n--- English detector on the real corpus (Hindi campaign) ---`);
const asEnglish = latin.filter(
  (t) => languageFollowInstruction(t, "Hindi") === "Reply in English.",
);
const asHindi = latin.filter((t) => languageFollowInstruction(t, "Hindi") === "Reply in Hindi.");
const asNeutral = latin.length - asEnglish.length - asHindi.length;
console.log(`  "Reply in English": ${asEnglish.length}`);
console.log(`  "Reply in Hindi"  : ${asHindi.length}`);
console.log(`  neutral nudge     : ${asNeutral}`);
console.log(`\n  every line called English — any romanized Hindi here is a FALSE POSITIVE:`);
for (const t of asEnglish.sort()) console.log(`      ${t.slice(0, 92)}`);

console.log(`\n--- ALL Hindi-flagged, for precision review ---`);
for (const t of flagged.sort()) console.log(`  [${markerHits(t, hindi).join(",")}] ${t.slice(0, 96)}`);

console.log(`\n--- Hindi single-marker (recall misses live here) ---`);
for (const t of single.sort().slice(0, 40)) console.log(`  [${markerHits(t, hindi)}] ${t.slice(0, 90)}`);

console.log(
  `\nRESULT: ${regionalFalsePositives === 0 ? "PASS" : "FAIL"} — ` +
    `${regionalFalsePositives} regional false positive(s) on ${latin.length} real Latin transcripts.`,
);
process.exit(regionalFalsePositives === 0 ? 0 : 1);
