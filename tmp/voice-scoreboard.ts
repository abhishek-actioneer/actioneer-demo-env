/**
 * VOICE SCOREBOARD — turns "better code-switching / latency / barge-in" into
 * numbers computed over every recorded call, so a change can be shown to help.
 *
 * Four measurements, each tied to a specific known failure:
 *
 *   1. ASR DELAY DISTRIBUTION — gemini.activity_end -> the next transcript.user.
 *      Every timeout in the barge-in controller is a bet against this tail. The
 *      2026-07-28 session set them from n=24; this reads the whole corpus.
 *
 *   2. SPURIOUS RECOVERY — user_activity_response_timeout (or an unclear/empty
 *      recovery) fired, and the caller's transcript landed right afterwards.
 *      That means the agent asked someone to repeat what they had just clearly
 *      said, and cost a whole turn doing it. This is the biggest latency event
 *      on a call, far bigger than the ~850ms round trip the design avoids.
 *
 *   3. STICKY DROP GUARD — interrupt_ignored_existing_drop_guard occurrences,
 *      plus how the guard was actually released. While it is stuck the agent is
 *      inaudible AND further barge-in is disabled.
 *
 *   4. SWITCH-FOLLOW RATE — of the turns where the customer changed language,
 *      how often did the agent's very next turn follow? This is the number that
 *      "better auto code-switching" actually means, and nothing computed it
 *      before: the previous evidence was 4/4 on a single call.
 *
 * Language classification reuses the SHIPPED detector where it can (script +
 * the romanized marker lists from src), so the scoreboard cannot drift from
 * what the runtime believes.
 *
 * Run: npx tsx tmp/voice-scoreboard.ts [--calls]
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
const SHOW_PER_CALL = process.argv.includes("--calls");

/**
 * Scope the run to calls made after a cutoff, so a test batch is not diluted by
 * the 299 historical calls. Dump filenames start with the epoch-ms the session
 * opened, which is the cheapest possible cursor.
 *
 *   --since=now-2h     relative, h or m
 *   --since=1785259826217   raw epoch ms
 *
 * Without it the whole corpus is read, which is what you want for a baseline
 * and NOT what you want for a before/after.
 */
function parseSince(): number {
  const arg = process.argv.find((a) => a.startsWith("--since="));
  if (!arg) return 0;
  const value = arg.slice("--since=".length);
  const relative = value.match(/^now-(\d+)([hm])$/);
  if (relative) {
    const amount = Number(relative[1]) * (relative[2] === "h" ? 3_600_000 : 60_000);
    return Date.now() - amount;
  }
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) {
    throw new Error(`--since expects epoch ms or now-<N>[hm], got "${value}"`);
  }
  return epoch;
}
const SINCE = parseSince();

/** A transcript landing within this window of a recovery makes it retroactively wrong. */
const SPURIOUS_WINDOW_MS = 1_500;

interface Event {
  at?: string;
  elapsedMs?: number;
  type?: string;
  detail?: Record<string, any>;
}
interface Dump {
  metadata?: Record<string, any>;
  events?: Event[];
}

const SCRIPTS: Array<[string, RegExp]> = [
  ["Devanagari", /[ऀ-ॿ]/],
  ["Bengali", /[ঀ-৿]/],
  ["Odia", /[଀-୿]/],
  ["Tamil", /[஀-௿]/],
  ["Telugu", /[ఀ-౿]/],
  ["Kannada", /[ಀ-೿]/],
];

/**
 * A coarse language label for scoring only — NOT the runtime's decision rule.
 * The runtime deliberately abstains on ambiguity; here we want a best guess so
 * that a switch is countable, and "unknown" is kept as its own bucket rather
 * than being folded into English.
 */
/**
 * Turns that carry no language information at all. Without this filter the
 * switch-follow rate is garbage: the first run of this script scored 59.8%, and
 * reading the misses showed most were "man man man man man", "Ah!", "2 minute
 * 2 minute", bare "Okay." — Latin characters with no language content — plus
 * Romance-garble ASR hallucinations ("¿Y qué?", "È un po' che non ci sentiamo"),
 * which Gemini emits on Hindi calls routinely. Counting those as a switch TO
 * English and then blaming the agent for not following is measuring nothing.
 *
 * Both guards are the runtime's own, imported rather than reimplemented.
 */
function carriesLanguageSignal(text: string): boolean {
  const t = text?.trim();
  if (!t) return false;
  if (isLowSignalTranscript(t)) return false;
  if (looksLikeUnsupportedRomanceAsr(t)) return false;
  // A language claim needs more than one or two words behind it.
  const words = t.split(/[^\p{L}]+/u).filter((w) => w.length > 1);
  if (words.length < 3) return false;
  // Pure repetition ("mam mam mam mam") is one word, however many times it lands.
  return new Set(words.map((w) => w.toLowerCase())).size >= 3;
}

function labelLanguage(text: string): string {
  const t = text?.trim();
  if (!t) return "unknown";
  const scripts = SCRIPTS.filter(([, re]) => re.test(t)).map(([n]) => n);
  if (scripts.length === 1) return scripts[0] === "Devanagari" ? "Hindi/Marathi" : scripts[0];
  if (scripts.length > 1) return "mixed";

  let best = "";
  let bestCount = 0;
  let tie = false;
  for (const [language, markers] of Object.entries(ROMANIZED_MARKER_LISTS)) {
    const seen = new Set<string>();
    for (const token of t.toLowerCase().split(/[^a-z]+/)) {
      if (token && markers.has(token)) seen.add(token);
    }
    if (seen.size > bestCount) {
      best = language;
      bestCount = seen.size;
      tie = false;
    } else if (seen.size === bestCount && seen.size > 0) {
      tie = true;
    }
  }
  if (bestCount >= 2 && !tie) return best === "Hindi" ? "Hindi/Marathi" : best;
  if (/[A-Za-z]/.test(t)) return "English";
  return "unknown";
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const asrDelays: number[] = [];
const spurious: Array<{ call: string; recoveryAtMs: number; gapMs: number; text: string }> = [];
let recoveriesTotal = 0;
let dropGuardIgnored = 0;
const dropGuardCalls = new Set<string>();
const dropGuardReleaseReasons = new Map<string, number>();
let switchOpportunities = 0;
let switchFollowed = 0;
const switchMisses: Array<{
  call: string;
  from: string;
  to: string;
  agent: string;
  text: string;
}> = [];
let callsRead = 0;

let dropGuardExpired = 0;
const dropGuardWindows: number[] = [];
let dropGuardNeverReleased = 0;

/**
 * Every way the guard can actually come down — including the two SILENT ones.
 *
 * This list is the correction to a wrong number. The first version counted only
 * `model_audio_drop_guard_cleared` and reported p90 9254ms with 116 calls where
 * the guard "never released". Reading a live call showed that is not what
 * happens: gemini-handler.ts:1036 releases the guard through the raw setter
 * `setDropModelAudioActive(false)` on the turnComplete / turn-dropped path, and
 * that setter emits nothing. The guard was down; the dump just never said so.
 *
 * Measuring an invisible release as a 7-second stall is how a healthy call gets
 * reported as a stuck one. If the raw setter ever starts emitting, drop these.
 */
const GUARD_RELEASE_TYPES = new Set([
  "gemini.model_audio_drop_guard_cleared",
  "gemini.turn_dropped_after_interrupt",
  "gemini.turn_complete",
]);

for (const file of readdirSync(DIR).sort()) {
  if (!file.endsWith(".json")) continue;
  if (SINCE) {
    const stamp = Number(file.split("-")[0]);
    if (!Number.isFinite(stamp) || stamp < SINCE) continue;
  }
  let dump: Dump;
  try {
    dump = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  } catch {
    continue;
  }
  const events = dump.events ?? [];
  if (!events.length) continue;
  callsRead++;
  const call = file.replace(/\.json$/, "").slice(-24);

  // ── 1. ASR delay: each activity_end paired with the next user transcript ──
  let pendingActivityEnd: number | undefined;
  for (const e of events) {
    if (e.type === "gemini.activity_end") pendingActivityEnd = e.elapsedMs;
    else if (e.type === "transcript.user" && pendingActivityEnd !== undefined) {
      const delay = (e.elapsedMs ?? 0) - pendingActivityEnd;
      if (delay >= 0 && delay < 30_000) asrDelays.push(delay);
      pendingActivityEnd = undefined;
    }
  }

  // ── 2. Spurious recovery: recovery fired, real words arrived right after ──
  const RECOVERY_TYPES = new Set([
    "gemini.user_activity_response_timeout",
    "gemini.barge_in_unclear_recovery",
    "gemini.barge_in_empty_recovery",
  ]);
  for (let i = 0; i < events.length; i++) {
    if (!RECOVERY_TYPES.has(events[i].type ?? "")) continue;
    recoveriesTotal++;
    const at = events[i].elapsedMs ?? 0;
    for (let j = i + 1; j < events.length; j++) {
      const gap = (events[j].elapsedMs ?? 0) - at;
      if (gap > SPURIOUS_WINDOW_MS) break;
      if (events[j].type === "transcript.user" && events[j].detail?.text?.trim()) {
        spurious.push({
          call,
          recoveryAtMs: at,
          gapMs: gap,
          text: String(events[j].detail?.text).slice(0, 60),
        });
        break;
      }
    }
  }

  // ── 3. Sticky drop guard ────────────────────────────────────────────────
  // How long the guard stays armed is the number that matters: for that whole
  // window agent audio is discarded and barge-in is refused.
  let guardOpenedAtMs: number | undefined;
  for (const e of events) {
    if (
      (e.type === "gemini.model_audio_interrupted" ||
        e.type === "gemini.model_audio_drop_guard_armed") &&
      guardOpenedAtMs === undefined
    ) {
      guardOpenedAtMs = e.elapsedMs ?? 0;
    } else if (GUARD_RELEASE_TYPES.has(e.type ?? "") && guardOpenedAtMs !== undefined) {
      const held = (e.elapsedMs ?? 0) - guardOpenedAtMs;
      if (held >= 0) dropGuardWindows.push(held);
      guardOpenedAtMs = undefined;
    }
  }
  if (guardOpenedAtMs !== undefined) dropGuardNeverReleased++;

  for (const e of events) {
    if (e.type === "gemini.interrupt_ignored_existing_drop_guard") {
      dropGuardIgnored++;
      dropGuardCalls.add(call);
    }
    if (e.type === "gemini.model_audio_drop_guard_expired") dropGuardExpired++;
    if (e.type === "gemini.model_audio_drop_guard_cleared") {
      const reason = String(e.detail?.reason ?? e.detail?.previousDropReason ?? "unknown");
      dropGuardReleaseReasons.set(reason, (dropGuardReleaseReasons.get(reason) ?? 0) + 1);
    }
  }

  // ── 4. Switch-follow rate ───────────────────────────────────────────────
  // Walk the conversation. When the customer's language differs from the one
  // they used on their previous turn, the agent's NEXT turn is the test.
  const turns = events
    .filter(
      (e) =>
        (e.type === "transcript.user" ||
          e.type === "transcript.assistant" ||
          e.type === "transcript.assistant_recorded_on_drop") &&
        e.detail?.text?.trim() &&
        carriesLanguageSignal(String(e.detail?.text)),
    )
    .map((e) => ({
      role: e.type === "transcript.user" ? "user" : "agent",
      language: labelLanguage(String(e.detail?.text)),
      text: String(e.detail?.text),
    }));

  let prevUserLanguage: string | undefined;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== "user") continue;
    if (turn.language === "unknown" || turn.language === "mixed") continue;

    if (prevUserLanguage && prevUserLanguage !== turn.language) {
      const nextAgent = turns.slice(i + 1).find((t) => t.role === "agent");
      if (nextAgent && nextAgent.language !== "unknown" && nextAgent.language !== "mixed") {
        switchOpportunities++;
        if (nextAgent.language === turn.language) switchFollowed++;
        else {
          switchMisses.push({
            call,
            from: prevUserLanguage,
            to: turn.language,
            agent: nextAgent.language,
            text: turn.text,
          });
        }
      }
    }
    prevUserLanguage = turn.language;
  }
}

const sorted = [...asrDelays].sort((a, b) => a - b);
console.log(`calls read: ${callsRead}\n`);

console.log(`── 1. ASR DELAY  (activity_end -> transcript.user), n=${sorted.length}`);
for (const p of [50, 75, 90, 95, 99]) {
  console.log(`     p${String(p).padEnd(3)} ${Math.round(percentile(sorted, p))}ms`);
}
console.log(`     max  ${sorted.length ? sorted[sorted.length - 1] : NaN}ms`);
console.log(
  `     >3500ms (current userActivityRecoveryTimeoutMs): ` +
    `${sorted.filter((d) => d > 3500).length} of ${sorted.length}`,
);

console.log(`\n── 2. SPURIOUS RECOVERY  (recovery fired, words landed <${SPURIOUS_WINDOW_MS}ms later)`);
console.log(`     ${spurious.length} of ${recoveriesTotal} recoveries were retroactively wrong`);
for (const s of spurious.slice(0, 12)) {
  console.log(`       ${s.call}  +${s.gapMs}ms  "${s.text}"`);
}

console.log(`\n── 3. STICKY DROP GUARD`);
const guardSorted = [...dropGuardWindows].sort((a, b) => a - b);
console.log(`     armed windows: ${guardSorted.length}  (never released: ${dropGuardNeverReleased})`);
if (guardSorted.length) {
  const line = [50, 90, 95, 99]
    .map((p) => `p${p} ${Math.round(percentile(guardSorted, p))}ms`)
    .join("  ");
  console.log(`     held: ${line}  max ${guardSorted[guardSorted.length - 1]}ms`);
  console.log(
    `     >3000ms: ${guardSorted.filter((d) => d > 3000).length} of ${guardSorted.length}`,
  );
}
console.log(`     drop_guard_max_age releases (fix firing): ${dropGuardExpired}`);
console.log(`     interrupt_ignored_existing_drop_guard: ${dropGuardIgnored} events`);
console.log(`     across ${dropGuardCalls.size} of ${callsRead} calls`);
console.log(`     guard release reasons:`);
for (const [reason, n] of [...dropGuardReleaseReasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`       ${String(n).padStart(5)}  ${reason}`);
}

console.log(`\n── 4. SWITCH-FOLLOW RATE`);
if (switchOpportunities) {
  const pct = ((switchFollowed / switchOpportunities) * 100).toFixed(1);
  console.log(`     ${switchFollowed}/${switchOpportunities} = ${pct}%`);
} else {
  console.log(`     no switch opportunities found`);
}

// Which DIRECTION fails is the whole story: it says which missing signal to add.
const byDirection = new Map<string, number>();
for (const m of switchMisses) {
  const key = `customer -> ${m.to}, agent stayed ${m.agent}`;
  byDirection.set(key, (byDirection.get(key) ?? 0) + 1);
}
console.log(`     misses by direction:`);
for (const [key, n] of [...byDirection].sort((a, b) => b[1] - a[1])) {
  console.log(`       ${String(n).padStart(4)}  ${key}`);
}

// ── Counterfactual coverage ─────────────────────────────────────────────────
// The 59.8% above is a HISTORICAL baseline: those calls already happened and no
// code change can move them. What can be checked today is whether the shipping
// detector would now hand each missed turn a concrete directive instead of the
// neutral nudge it actually got. That is coverage of the failure, not proof of
// the cure — only new calls prove the cure — but it does show the fix aims at
// the turns that actually broke.
console.log(`\n     counterfactual: what would today's detector say on the missed turns?`);
let nowConcrete = 0;
let nowCorrect = 0;
for (const m of switchMisses) {
  const line = languageFollowInstruction(m.text, "Hindi");
  if (line === FOLLOW_CUSTOMER_LANGUAGE_NUDGE) continue;
  nowConcrete++;
  const named = line.replace(/^Reply in |\.$/g, "");
  const wanted = m.to === "Hindi/Marathi" ? "Hindi" : m.to;
  if (named === wanted) nowCorrect++;
}
console.log(
  `       ${nowConcrete}/${switchMisses.length} missed turns now get a concrete "Reply in X."`,
);
console.log(
  `       ${nowCorrect}/${switchMisses.length} of those name the language the customer had switched to`,
);

if (SHOW_PER_CALL && switchMisses.length > 12) {
  console.log(`\n     ... ${switchMisses.length - 12} more misses`);
}
console.log("");

if (process.argv.includes("--misses")) {
  console.log(`\n--- missed turns, with what the detector says today ---`);
  for (const m of switchMisses) {
    const line = languageFollowInstruction(m.text, "Hindi");
    const verdict = line === FOLLOW_CUSTOMER_LANGUAGE_NUDGE ? "neutral" : line;
    console.log(`  [want ${m.to}] [${verdict}] ${m.text.slice(0, 84)}`);
  }
}
