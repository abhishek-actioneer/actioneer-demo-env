/**
 * How much does shrinking the permitted set help the detector?
 * Mirrors the runtime resolution order against arbitrary permitted sets.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ROMANIZED_MARKER_LISTS, ENGLISH_MARKER_LIST } from "../src/lib/voice-language-policy";
import { looksLikeUnsupportedRomanceAsr } from "../src/lib/voice-semantic-traps";

const DIR = "data/voice-callback-dumps/plivo-gemini-live-session";
const SCRIPTS: Array<[RegExp, string[]]> = [
  [/[ऀ-ॿ]/, ["Hindi", "Marathi"]], [/[ঀ-৿]/, ["Bengali"]], [/[଀-୿]/, ["Odia"]],
  [/[஀-௿]/, ["Tamil"]], [/[ఀ-౿]/, ["Telugu"]], [/[ಀ-೿]/, ["Kannada"]],
];
const NAMES = /\b(english|angrezi|hindi|hinglish|marathi|tamil|telugu|kannada|bengali|bangla|odia|punjabi|gujarati|malayalam|urdu)\b|अंग्रेज़ी|हिंदी|तमिल|तेलुगु|कन्नड़/i;

function count(text: string, m: ReadonlySet<string>): number {
  const s = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z]+/)) if (t && m.has(t)) s.add(t);
  return s.size;
}
function decide(text: string, permitted: Set<string>): string {
  const t = text.trim();
  if (!t) return "neutral";
  if (NAMES.test(t)) return "neutral";
  const matched = SCRIPTS.filter(([re]) => re.test(t));
  if (matched.length === 1) {
    const c = matched[0][1].filter((l) => permitted.has(l));
    return c.length === 1 ? c[0] : "neutral";
  }
  if (matched.length > 1) return "neutral";
  const scored = Object.entries(ROMANIZED_MARKER_LISTS)
    .filter(([l]) => permitted.has(l))
    .map(([l, m]) => ({ l, n: count(t, m) }))
    .sort((a, b) => b.n - a.n);
  const [best, next] = scored;
  if (best && best.n >= 2 && !(next && next.n >= best.n)) return best.l;
  if (permitted.has("English") && !looksLikeUnsupportedRomanceAsr(t)) {
    let indic = 0;
    for (const [l, m] of Object.entries(ROMANIZED_MARKER_LISTS)) if (permitted.has(l)) indic += count(t, m);
    if (indic === 0 && count(t, ENGLISH_MARKER_LIST) >= 2) return "English";
  }
  return "neutral";
}

// Collect customer turns per campaign shape.
const tri: string[] = [], bi: string[] = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith(".json")) continue;
  let d: any; try { d = JSON.parse(readFileSync(join(DIR, f), "utf8")); } catch { continue }
  const si = (d.events ?? []).find((e: any) => e.type === "gemini.system_instruction");
  if (!si) continue;
  const three = /three languages/.test(si.detail?.text ?? "");
  for (const e of d.events ?? []) {
    if (e.type === "transcript.user" && e.detail?.text?.trim()) (three ? tri : bi).push(e.detail.text.trim());
  }
}

const SETS: Array<[string, string[]]> = [
  ["Tamil+Hindi+English (current)", ["Tamil", "Hindi", "English"]],
  ["Tamil+English", ["Tamil", "English"]],
  ["Tamil+Hindi", ["Tamil", "Hindi"]],
  ["Hindi+English", ["Hindi", "English"]],
];
console.log(`REGIONAL-campaign customer turns (n=${tri.length})`);
for (const [label, langs] of SETS) {
  const p = new Set(langs);
  const out = tri.map((t) => decide(t, p));
  const concrete = out.filter((o) => o !== "neutral").length;
  const byLang: Record<string, number> = {};
  for (const o of out) if (o !== "neutral") byLang[o] = (byLang[o] ?? 0) + 1;
  console.log(`  ${label.padEnd(32)} decisive ${concrete}/${tri.length}  ${JSON.stringify(byLang)}`);
}
console.log(`\nHINDI-campaign customer turns (n=${bi.length})`);
for (const [label, langs] of [SETS[3], SETS[0]] as Array<[string, string[]]>) {
  const p = new Set(langs);
  const out = bi.map((t) => decide(t, p));
  const concrete = out.filter((o) => o !== "neutral").length;
  const byLang: Record<string, number> = {};
  for (const o of out) if (o !== "neutral") byLang[o] = (byLang[o] ?? 0) + 1;
  console.log(`  ${label.padEnd(32)} decisive ${concrete}/${bi.length}  ${JSON.stringify(byLang)}`);
}
