/**
 * The call's language policy, expressed entirely as system-instruction text.
 *
 * DESIGN CONSTRAINT — read before adding anything here:
 *
 * This is PROMPT ONLY. There is deliberately no runtime language detection,
 * drift guard, switching machinery, preference gate, or hard lock. That layer
 * existed once and was removed (see the note on buildGeminiLiveSystemInstruction
 * in plivo-gemini-live-config.ts); re-adding it costs a `realtimeInput.text`
 * round trip (~850ms of voice-to-voice latency, see isRedundantLiveTurnPlan)
 * and reintroduces the bug class that got it deleted.
 *
 * Gemini hears the caller's raw audio. It identifies the spoken language more
 * reliably than anything we could infer downstream of an ASR transcript, so the
 * policy is stated once at setup and the model applies it.
 *
 * ── Two shapes ──────────────────────────────────────────────────────────────
 *
 * Hindi and English are the BASE PAIR. Indian phone conversations move between
 * them constantly, so every call carries both — the campaign's selected
 * language decides what the agent OPENS in and repairs misunderstandings in,
 * not which languages are allowed.
 *
 * BILINGUAL (Hinglish, Hindi, English selected): the call runs in
 * {Hindi + English}.
 *
 * TRILINGUAL (a regional Indic language is selected): the call runs in
 * {regional + Hindi + English}. Opening is in the regional language, and Hindi
 * is the fallback when a repair attempt fails.
 *
 * In both shapes the agent follows whichever permitted language the customer
 * last used, and anything outside the permitted set is treated as "unclear"
 * and re-asked in the PRIMARY language.
 *
 * Every language this product offers is an Indian-call language — the studio
 * picker is {Hinglish, Hindi, English} + the six regional packs. There is no
 * European-language shape here and nothing should be gated on one.
 *
 * Both shapes honour an EXPLICIT customer request to change language. That is
 * the customer asking in words ("can you speak in English?"), not the model
 * inferring a preference from what it heard — the latter is the drift-guessing
 * this module refuses to do. Until 2026-07-28 the monolingual shape asserted
 * "Speak only {lang} for the whole call", which a Hindi campaign could not
 * escape: the switch rule existed only on the trilingual path, so Hindi (the
 * bridge language, never a trilingual primary) had no way to reach it and
 * callers asking for English were refused.
 */

import {
  casualSpokenRegisterNudge,
  isCasualIndicLanguage,
  type CasualIndicLanguage,
} from "./voice-casual-spoken-register";
import {
  isSemanticTrapGateEnabled,
  looksLikeUnsupportedRomanceAsr,
  semanticTrapSystemPromptBlock,
} from "./voice-semantic-traps";

/** Always available alongside a regional language — never separately selectable. */
const BRIDGE_LANGUAGE = "Hindi";
const TERM_LANGUAGE = "English";

/**
 * Terms Indian callers say in English regardless of the conversation language.
 * Translating these into formal regional equivalents is the single most common
 * way a regional-language agent starts sounding like a government form.
 */
const NATURAL_ENGLISH_TERMS = [
  "loan", "EMI", "KYC", "branch", "confirm", "account", "balance", "OTP", "link",
];

export type VoiceLanguageShape = "bilingual" | "pinned";

export interface VoiceLanguagePlan {
  /** The language the agent opens in and repairs misunderstandings in. */
  primary: string;
  /** Every language permitted on the call. Always includes the base pair. */
  spoken: string[];
  shape: VoiceLanguageShape;
  /**
   * Regional campaigns do NOT code-switch on their own.
   *
   * Product decision, 2026-07-29, taken on measurement: on regional campaigns
   * 37.5% of customer turns come back from Gemini's ASR as Romance or Korean
   * hallucination, against 2.8% on Hindi campaigns. Automatic following is only
   * as good as the transcript it reads, and on those calls the transcript is
   * noise. Call w42ib is the concrete cost — garbled Devanagari resolved to
   * "Reply in Hindi." exactly as the rules say it should, and the agent
   * abandoned Tamil for fifty seconds.
   *
   * So a regional call stays in its language by default. The customer can still
   * move it BY ASKING, in words — that path runs on the model's own audio
   * understanding rather than on our transcript, and refusing it is the bug
   * removed on 2026-07-28, when a caller asking for English had no escape.
   */
  pinned: boolean;
}

export function resolveVoiceLanguagePlan(language: string | undefined): VoiceLanguagePlan {
  const requested = language?.trim() || "Hinglish";

  if (isCasualIndicLanguage(requested)) {
    const regional = requested as CasualIndicLanguage;
    return {
      primary: regional,
      // The permitted SET is unchanged — an explicit request can still reach
      // Hindi or English. What changed is the DEFAULT: no auto-following.
      spoken: [regional, BRIDGE_LANGUAGE, TERM_LANGUAGE],
      shape: "pinned",
      pinned: true,
    };
  }

  // Hinglish IS the base pair spoken as one mixed register, so it names both
  // rather than adding itself as a third entry. Hindi and English each open in
  // themselves and carry the other.
  const spoken =
    requested === BRIDGE_LANGUAGE || requested === TERM_LANGUAGE
      ? [requested, requested === BRIDGE_LANGUAGE ? TERM_LANGUAGE : BRIDGE_LANGUAGE]
      : [BRIDGE_LANGUAGE, TERM_LANGUAGE];

  return { primary: requested, spoken, shape: "bilingual", pinned: false };
}

/**
 * Both shapes share one rule set — they differ only in the language list and in
 * the trilingual-only Hindi fallback. Rules are numbered here rather than in the
 * literals so a conditional rule cannot silently produce "…rule 3" pointing at
 * the wrong line.
 */
/**
 * Turn-level reinforcement of rule 1, appended to instructions the runtime is
 * already sending. Costs no extra `realtimeInput.text` round trip, so it does
 * not violate this module's no-runtime-machinery constraint.
 *
 * Why it exists: on 2026-07-28 a live Hindi campaign answered an
 * English-speaking caller in Hindi, three turns running, and only switched when
 * asked outright. Replaying that exact turn against the exact shipped system
 * instruction on gemini-3-flash-preview followed the caller into English 6/6 —
 * so the rule is not wrong, it is just 17k characters away from the point of
 * generation and the Live model under-weights it. This sentence sits next to
 * the customer's words instead.
 *
 * Deliberately says "the same language the customer just used" rather than
 * naming a language: naming one would require inspecting the transcript, and
 * romanized Hindi ("Haan ji bolo") is Latin script, so any script check would
 * flip the call to English on a Hindi speaker — the drift bug that got the old
 * language checker deleted. The model heard the audio; let it decide.
 */
export const FOLLOW_CUSTOMER_LANGUAGE_NUDGE =
  "Reply in the same language the customer just used." +
  " If that is English, use Indian English (en-IN) — never American or British.";

/**
 * The pinned-path answer when the agent's own language cannot be identified —
 * Devanagari on a Marathi campaign, which is Marathi and Hindi at once.
 *
 * Points at the AGENT rather than the customer, unlike the nudge above. On a
 * pinned call the customer's transcript is the thing we have decided not to
 * trust; what the agent is already speaking is the thing worth preserving.
 */
export const CONTINUE_IN_CURRENT_LANGUAGE =
  "Continue in the language you are already speaking." +
  " If that is English, use Indian English (en-IN) — never American or British.";

/**
 * The turn-level reply line. English is NEVER named bare.
 *
 * Rule 7 of the system instruction has always said "speak ONLY Indian English
 * (en-IN), never US or UK". On 2026-07-29 a live call switched to English on
 * request and came back American anyway — the same failure mode as the original
 * follow-the-customer rule: the model under-weights a rule sitting 17k
 * characters from the point of generation. The fix is the same one that worked
 * there, which is to say it next to the customer's words instead.
 *
 * en-IN is not a dialect preference here, it is the product: these are Indian
 * phone calls to Indian borrowers.
 */
function replyLine(language: string): string {
  if (language !== TERM_LANGUAGE) return `Reply in ${language}.`;
  return `Reply in Indian English (en-IN) — Indian pronunciation, wording and phone cadence, never American or British.`;
}

/**
 * Writing systems we can recognise, mapped to every campaign language that uses
 * them. Devanagari is the one many-to-one entry and the reason this is a list
 * of languages rather than a single label: Hindi and Marathi are written in the
 * same script and cannot be told apart by codepoint.
 *
 * Latin is deliberately absent. It carries English *and* romanized everything
 * ("Haan ji bolo", "Call kyon kar rahe ho"), so seeing it tells us nothing.
 */
/** Languages written in Devanagari — the one script that cannot self-identify. */
const DEVANAGARI_LANGUAGES = ["Hindi", "Marathi"];

/**
 * Any mention of a language by name, in English or Devanagari. Presence means
 * the customer is probably asking for a language rather than merely speaking
 * one, which is rule 3's job, not this function's.
 */
const NAMES_A_LANGUAGE_RE =
  /\b(english|angrezi|angreji|hindi|hinglish|marathi|tamil|telugu|kannada|bengali|bangla|odia|oriya|punjabi|gujarati|malayalam|urdu)\b|अंग्रेज़ी|अंग्रेजी|इंग्लिश|हिंदी|हिन्दी|मराठी|तमिल|तेलुगु|कन्नड़|बंगाली|ओड़िया/i;

/**
 * Romanized tokens per language, for the case the script gate cannot reach:
 * Gemini's ASR romanizes Indic speech once a call has been running in English,
 * which is exactly the turn where a switch back is needed.
 *
 * THREE RULES, all of them load-bearing:
 *
 * 1. No English homographs, anywhere. main, to, is, in, us, me, par, so, do,
 *    the, a, hi, sang, chai, mash, mote, sari and naan are ordinary English
 *    words and would fire this on ordinary English sentences.
 * 2. Every regional list is DISJOINT FROM HINDI, asserted in the unit tests.
 *    Hindi is permitted on every campaign, so a token shared with Hindi is
 *    evidence for nobody. Regional-vs-regional overlap ("illa" is Tamil and
 *    Kannada, "achhi" is Bengali and Odia) is left alone on purpose: a campaign
 *    permits at most one regional language, so those two never compete.
 * 3. The Hindi list's precision claim below is a MEASUREMENT, not a guarantee.
 *    Any edit to it invalidates the number until tmp/eval-romanized.ts is re-run
 *    AND every flagged line is re-read by eye. Do not edit it casually, and
 *    never to fix a single call. Tokens for other languages go in their own list.
 *
 * ── Validation status, which differs sharply per language ───────────────────
 *
 * HINDI — measured. Over the 243 unique Latin-script customer transcripts in
 * data/voice-callback-dumps, a two-marker threshold flags 65 lines and every
 * one is genuinely Hindi or Hinglish. One marker was rejected: it captures
 * "Haan ji, can you like speak in English?" and "speak fast I am like thoda in
 * a rush", both English.
 *
 * EVERYTHING ELSE — authored, not measured, because the corpus contains no
 * romanized regional speech at all to measure against (2026-07-28: 634 unique
 * customer transcripts, of which 7 Tamil and 2 Telugu, all in native script).
 * What tmp/eval-romanized.ts does check is the direction that can actually hurt
 * a live call: none of these lists may fire on the real Hindi/English corpus.
 * Recall is unverified. Marathi/Bengali/Odia are weakest — the casual-register
 * packs for those three are themselves marked `reviewed: false`.
 *
 * Re-run tmp/eval-romanized.ts whenever any list changes.
 */
const ROMANIZED_MARKERS: Record<string, ReadonlySet<string>> = {
  // FROZEN — see rule 3 above.
  Hindi: new Set([
    "haan", "haa", "nahin", "nahi", "nai",
    "kya", "kyon", "kyun", "kaise", "kaisa", "kahan", "kab", "kitna", "kitne", "kaun",
    "gaya", "gayi", "gaye", "diya", "liya", "hua", "hui", "huye",
    "raha", "rahi", "rahe", "hoga", "hogi", "honge", "hai", "hain", "tha", "thi", "thay",
    "hun", "hoon", "chahiye", "chahie", "mujhe", "mujhko", "tumhe", "aapko", "aapka", "aapki",
    "apna", "apni", "mera", "meri", "mere", "uska", "iska", "unka",
    "abhi", "phir", "lekin", "magar", "agar", "matlab", "thoda", "bahut", "bohot",
    "kuch", "kuchh", "koi", "sab", "karo", "karna", "kiya", "karke", "karta", "karti",
    "karun", "karunga", "kripya", "prayas",
    "bata", "batao", "bolo", "boliye", "bolta", "samajh", "dekh", "dekha", "dekhi",
    "milega", "milegi", "theek", "thik", "achha", "accha", "acha",
    "waise", "jaldi", "zyada", "jyada", "pura", "poora", "baat", "sirf",
    // Second pass, 2026-07-28: recall gaps found by reading the switch-follow
    // misses in tmp/voice-scoreboard.ts. Every one of these was a Hindi turn
    // scored as English. Short English homographs from the same lines (do, to,
    // par, hi, na, bus, lo, tab, jo, de) are still excluded.
    "aap", "aapne", "aapse", "bhej", "bhejo", "bhejiye", "bhejta",
    "samjhao", "samjha", "samjhaya", "samajhna", "wapas", "wapis",
    "pehla", "pehle", "pehli", "jaise", "aati", "aata", "aate", "aaya", "aayi",
    "dekhte", "hue", "sakta", "sakte", "sakti", "paunga", "payega",
    "karenge", "karenga", "lena", "dena", "yaad", "pata", "mila", "milta",
    "jab", "wahan", "yahan", "idhar", "udhar", "kyunki", "isliye",
    "woh", "yeh", "unko", "inko", "humein", "hamara", "tumhara", "tera", "teri",
    "suno", "suniye", "batayenge", "chalega", "hona", "hone", "rakho",
    "wala", "wale", "wali", "bhi", "bhar", "paise", "paisa", "rupaye", "rupay",
    "kal", "aaj", "mahina", "mahine", "saal", "din",
  ]),
  Tamil: new Set([
    "illa", "illai", "aama", "aamaa", "aamam",
    "enna", "eppadi", "epdi", "enge", "engey", "eppo", "eppothu",
    "evlo", "evvalavu", "yaaru", "yaru",
    "naanga", "neenga", "neengal", "enakku", "enaku", "ungalukku", "ungaluku",
    "avanga", "avaru", "adhu", "idhu", "ithu", "adhukku",
    "panren", "panra", "panrom", "pannunga", "panniten", "pannitten",
    "sollunga", "sollu", "sonna", "sonnen", "sonninga",
    "theriyum", "theriyala", "theriyathu", "purinjhu", "purinjuthu",
    "venum", "vendam", "venaam", "irukku", "iruku", "irukken", "irukkanga",
    "varum", "varen", "vandhu", "vanthu", "konjam", "romba", "seri",
    "appuram", "apparam", "ippo", "innum", "mudiyum", "mudiyala",
    "kekkanum", "kelunga", "paathu", "paatha", "kaasu", "mattum",
  ]),
  Telugu: new Set([
    "ledu", "ledhu", "kadu", "kaadu", "avunu",
    // "emi" (what) is deliberately absent: EMI is the single most-spoken English
    // term on these calls and the eval caught it touching six real Hindi lines.
    "emiti", "enti", "ela", "ekkada", "eppudu", "entha", "evaru",
    "nenu", "meeru", "miru", "nuvvu", "vaallu", "vallu", "adi", "idi",
    "cheppu", "cheppandi", "chepandi", "chesanu", "chestanu", "cheyandi", "cheyyandi",
    "telusu", "teliyadu", "kavali", "kaavali", "vaddu",
    "undi", "unnadi", "unnaru", "unnanu", "vastundi", "vachindi", "ravali",
    "konchem", "koncham", "chala", "chaala", "sare", "sarey",
    "tarvata", "tarwata", "ippudu", "appudu", "malli",
    "dabbu", "paisalu", "rojulu", "nela", "samvatsaram",
    "artham", "ardham", "kaledu", "ayindi", "ayyindi", "avutundi", "bagundi",
  ]),
  Kannada: new Set([
    "houdu", "haudu", "howdu", "illa", "ella",
    "yenu", "enu", "yaake", "yake", "hege", "hegide", "elli", "yavaga", "eshtu",
    "yaaru", "naanu", "neevu", "nivu", "nimma", "nanna", "adu", "idu",
    "heli", "helu", "helthini", "heltini", "gottilla", "gottu",
    "beku", "bekku", "beda", "ide", "idhe", "irutte", "iruttade", "barutte", "bandide",
    "swalpa", "tumba", "thumba", "aytu", "ayithu", "matte", "eega", "aamele",
    "duddu", "tingalu", "varsha", "artha",
    "maadi", "madi", "maadu", "nodi", "nodu", "saaku", "aagutte", "aagalla", "madtini",
  ]),
  Marathi: new Set([
    "aahe", "ahe", "aahet", "ahet", "aahat", "ahat", "nahiye", "navhe",
    "kay", "kasa", "kase", "kashi", "kuthe", "kevha", "kiti", "kon", "konala",
    "mala", "tula", "tumhala", "tumhi", "aapan",
    "maza", "majha", "majhi", "maze", "tumcha", "tumche", "tyacha", "tyanni",
    "ata", "atta", "nantar", "punha", "ekda", "khup", "sagle", "sagla", "kahi",
    "karto", "karte", "kartoy", "kela", "keli", "kele", "karaycha",
    "sanga", "sangitla", "samajla", "samajle", "disat", "disto",
    "milel", "milala", "barobar", "changla", "changle", "changli",
    // "hota" and "apan" are absent: both are ordinary Hindi ("kya hota hai",
    // "apan ne baat kari"), caught touching real Hindi lines in the eval.
    "pahije", "nako", "hoil", "jhala", "jhali", "zala", "zali",
    "udya", "parva", "varsha", "divas",
  ]),
  Bengali: new Set([
    // "ki" is absent: it is also the Hindi conjunction ("hai ki mera repayment
    // kaise hoga"), so it is evidence for nobody. "kobe"/"kothay" carry the load.
    "hyan", "hyaan", "kobe", "kothay", "kothae", "kemon", "koto", "keno",
    // Bare "apni" (you) is absent — it is also Hindi "apni" (one's own).
    "ami", "amar", "aapni", "apnar", "tumi", "tomar", "tader", "ota", "eta", "oita",
    "bolun", "bolchi", "bolchen", "bolben",
    "korbo", "korchi", "korte", "korechi", "koreche", "korben",
    "jani", "janina", "lagbe", "hobe", "hoyeche", "hoyechi", "hoy",
    "ache", "achhe", "achi", "achhi", "nei",
    "ektu", "onek", "ekhon", "pore", "porey", "taka", "takar", "bochor",
    "bujhte", "bujhechi", "bujhlam", "dekhun", "dekhchi", "kintu", "tahole", "chaina",
  ]),
  Odia: new Set([
    "hein", "kana", "kemiti", "kouthi", "kebe", "kete", "kie",
    "mora", "apana", "apananka", "tumara", "tume", "sethi", "ehi", "sehi",
    "kuhantu", "kahantu", "karibi", "karuchi", "karichi", "kariba",
    "heba", "heuchi", "heichi", "hoiba", "hela", "thila",
    "achhi", "achi", "achanti", "jane", "janena",
    "tike", "kichi", "sabu", "ebe", "tapare", "pachhe", "bhala", "aau",
    "bujhili", "dekhantu", "masa", "barsa", "dina",
  ]),
};

/**
 * Positive evidence for ENGLISH, which the rest of this file could not express.
 *
 * Why this exists, measured rather than guessed: tmp/voice-scoreboard.ts scores
 * the switch-follow rate over all 299 recorded calls at 79/132 = 59.8%, and
 * 45 of the 53 misses are one single shape — the customer switched to English
 * and the agent stayed in an Indic language.
 *
 * The cause was structural, not a threshold. Every other branch here can say
 * "Reply in Hindi" or "Reply in Tamil", but nothing could ever say "Reply in
 * English": Latin script proves nothing on its own and English had no marker
 * list, so an English switch only ever got the neutral nudge — which the
 * 2026-07-28 probes established is too weak to move the Live model. The policy
 * could push the agent INTO an Indic language and never back out of it.
 *
 * Common English function words that are NOT romanized Indic tokens. The Indic
 * lists already exclude every English homograph (see rule 1 above), so these two
 * vocabularies cannot collide — asserted in the unit tests.
 */
const ENGLISH_MARKERS = new Set([
  "the", "and", "but", "because", "about", "with", "from", "for", "that", "this",
  "there", "they", "them", "their", "your", "you", "are", "was", "were", "been",
  "have", "has", "had", "will", "would", "should", "could", "can", "cannot",
  "what", "when", "where", "which", "who", "how", "why",
  "please", "thank", "thanks", "sorry", "just", "only", "also", "very", "much",
  "need", "want", "know", "think", "tell", "said", "say", "give", "take", "make",
  "get", "got", "going", "come", "back", "call", "calling", "called",
  "time", "money", "month", "year", "week", "day", "today", "tomorrow", "now",
  "right", "okay", "yes", "not", "any", "some", "more", "less", "first", "last",
  "pay", "paid", "payment", "amount", "again", "still", "already", "actually",
]);

/**
 * Symmetric with the Indic threshold, and deliberately strict in the other
 * direction too: ANY Indic marker at all disqualifies the line. One romanized
 * Hindi token in an otherwise English-looking sentence means we do not know, and
 * shoving a Hindi speaker into English is the same drift bug in mirror image.
 */
const ENGLISH_MIN_MARKERS = 2;

/** Two, not one — see the note on ROMANIZED_MARKERS. */
const ROMANIZED_MIN_MARKERS = 2;

/** Count of DISTINCT markers, so "nahin nahin nahin" stays one piece of evidence. */
function countRomanizedMarkers(text: string, markers: ReadonlySet<string>): number {
  const seen = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z]+/)) {
    if (token && markers.has(token)) seen.add(token);
  }
  return seen.size;
}

/**
 * The one permitted language the romanized evidence points at, or null.
 *
 * Only languages this campaign actually permits are scored, so a Tamil campaign
 * never has to tell Tamil from Kannada — only from Hindi. The winner must clear
 * the threshold AND strictly beat the runner-up: a line that scores 2 Hindi and
 * 2 Marathi has said nothing, and guessing on it is precisely the drift bug the
 * old language checker was deleted for.
 */
function resolveRomanizedLanguage(text: string, permitted: ReadonlySet<string>): string | null {
  const scored = Object.entries(ROMANIZED_MARKERS)
    .filter(([language]) => permitted.has(language))
    .map(([language, markers]) => ({ language, count: countRomanizedMarkers(text, markers) }))
    .sort((a, b) => b.count - a.count);

  const [best, runnerUp] = scored;
  if (!best || best.count < ROMANIZED_MIN_MARKERS) return null;
  if (runnerUp && runnerUp.count >= best.count) return null;
  return best.language;
}

/**
 * Which permitted language the AGENT's last turn was spoken in.
 *
 * Deliberately by DOMINANT script rather than by any-match: a real agent turn is
 * mixed by design — "நான் Mira, Vastu Housing Finance-ல இருந்து AI Assistant
 * பேசுறேன்" is Tamil with four English words in it, and one turn on call u066j
 * was Tamil containing the Devanagari word हिंदी. Counting characters gets all
 * of those right where a first-match-wins test does not.
 *
 * Latin with no Indic characters at all means English. That is safe HERE, unlike
 * on caller transcripts, because this text is the model's own speech.
 */
function detectAgentLanguage(
  text: string | undefined,
  permitted: ReadonlySet<string>,
): string | null {
  const t = text?.trim();
  if (!t) return null;

  let best: { languages: string[]; count: number } | null = null;
  for (const script of SCRIPT_LANGUAGES) {
    const count = (t.match(new RegExp(script.test.source, "g")) ?? []).length;
    if (count > 0 && (!best || count > best.count)) best = { languages: script.languages, count };
  }
  if (best) {
    const candidates = best.languages.filter((language) => permitted.has(language));
    return candidates.length === 1 ? candidates[0] : null;
  }
  if (permitted.has(TERM_LANGUAGE) && /[A-Za-z]/.test(t)) return TERM_LANGUAGE;
  return null;
}

/**
 * True when the line is confidently English: enough English function words, and
 * not one single token from any language this campaign also permits.
 */
function looksLikeEnglish(text: string, permitted: ReadonlySet<string>): boolean {
  // Romance garble is NOT English, however many Latin letters it has. Gemini's
  // ASR emits it constantly on Indic calls — one Tamil call on 2026-07-29
  // produced French twice, Spanish once and Korean once across seven customer
  // turns. Those particular lines happened to carry too few English function
  // words to fire, but "come has been, no more que nada" clears the threshold
  // outright, and acting on it would switch a Tamil call to English on a
  // hallucination. The guard already exists for exactly this input class.
  if (looksLikeUnsupportedRomanceAsr(text)) return false;
  for (const [language, markers] of Object.entries(ROMANIZED_MARKERS)) {
    if (!permitted.has(language)) continue;
    if (countRomanizedMarkers(text, markers) > 0) return false;
  }
  return countRomanizedMarkers(text, ENGLISH_MARKERS) >= ENGLISH_MIN_MARKERS;
}

/** Exported for the disjointness assertions in the unit tests. */
export const ROMANIZED_MARKER_LISTS: Readonly<Record<string, ReadonlySet<string>>> =
  ROMANIZED_MARKERS;

/** Exported for the same assertions — English must not collide with any of them. */
export const ENGLISH_MARKER_LIST: ReadonlySet<string> = ENGLISH_MARKERS;

const SCRIPT_LANGUAGES: Array<{ test: RegExp; languages: string[] }> = [
  { test: /[ऀ-ॿ]/, languages: DEVANAGARI_LANGUAGES },
  { test: /[ঀ-৿]/, languages: ["Bengali"] },
  { test: /[଀-୿]/, languages: ["Odia"] },
  { test: /[஀-௿]/, languages: ["Tamil"] },
  { test: /[ఀ-౿]/, languages: ["Telugu"] },
  { test: /[ಀ-೿]/, languages: ["Kannada"] },
];

/**
 * The language line to put on an instruction the runtime is already sending.
 *
 * DESIGN CONSTRAINT EXCEPTION — this inspects the transcript, which the note at
 * the top of this file forbids. Relaxed deliberately on 2026-07-28, on these
 * terms, and it should not be widened past them:
 *
 *   - No extra round trip. It only ever rewrites one line of an instruction
 *     already being dispatched, so the ~850ms cost the constraint guards
 *     against is not incurred.
 *   - It names a language ONLY when the script narrows the campaign's permitted
 *     set to exactly one candidate. Devanagari on a Marathi campaign (Marathi
 *     AND Hindi permitted, one script) resolves to nothing and falls back.
 *   - Anything ambiguous — Latin, an unknown script, several scripts at once —
 *     falls back to the language-neutral nudge. It never guesses.
 *
 * That last point is what separates this from the deleted checker: that one
 * inferred a language from ambiguous romanized text and flipped calls wrongly.
 * This one stays quiet unless the script is decisive.
 *
 * Why it is needed at all: the system-instruction rule and the neutral nudge
 * both fail to bring the Live model back once it has drifted (call 5hgso —
 * followed the caller into English, then held English through three Hindi
 * turns). The same prompt scores 6/6 in both directions on the text model, so
 * the wording is not the problem; a concrete directive is.
 */
export function languageFollowInstruction(
  userText: string,
  campaignLanguage: string | undefined,
  /**
   * The agent's own last turn. Used only by the pinned (regional) path, to hold
   * a language the customer explicitly asked for. Optional: without it a pinned
   * campaign simply falls back to its configured language, which is the old
   * behaviour and is still safe — just unable to stay where it was asked to go.
   */
  lastAssistantText?: string,
): string {
  const text = userText?.trim();
  const plan = resolveVoiceLanguagePlan(campaignLanguage);

  // A customer naming a language is making a request, and rule 3 of the system
  // instruction owns those. Stay out of it: "Haan ji, can you speak in English?"
  // is romanized Hindi asking for English, and answering it with "Reply in
  // Hindi" would contradict the thing they just asked for.
  const namesALanguage = Boolean(text) && NAMES_A_LANGUAGE_RE.test(text);

  // PINNED (regional): no detection at all. Nothing this function could read off
  // a transcript is worth acting on when 37.5% of those transcripts are ASR
  // hallucination — so it never names anything but the campaign's own language.
  //
  // The trailing clause is what keeps this from becoming the monolingual lock
  // that was removed on 2026-07-28. Once the customer has ASKED for another
  // language, a bare "Reply in Tamil." on every subsequent turn would drag them
  // straight back and silently overrule rule 3. Deferring that judgement to the
  // model costs nothing — it has the audio and the conversation, and we do not
  // have to carry switch state in a module that is meant to be prompt-only.
  if (plan.pinned) {
    if (namesALanguage) return FOLLOW_CUSTOMER_LANGUAGE_NUDGE;
    // Pin to the language the agent is ALREADY SPEAKING, falling back to the
    // campaign's own.
    //
    // The first version of this pinned to plan.primary and hung a condition off
    // the end — "Reply in Tamil unless the customer has asked you to use another
    // language". Call u066j (2026-07-29) disproved it twice in sixty seconds:
    // the customer asked for Hindi and the agent switched, then the very next
    // turn line said "Reply in Tamil unless..." and it went straight back to
    // Tamil; the customer then asked for English, got it, and was dragged back
    // again. The model obeys the leading directive and does not weigh a trailing
    // conditional against it.
    //
    // Reading the AGENT's last turn fixes that without any switch state, and
    // without reintroducing the thing pinning exists to avoid: this is the
    // model's transcription of its OWN speech, not the caller ASR that returns
    // Portuguese for Tamil audio 37.5% of the time. Once an explicit request has
    // moved the agent, the pin follows it there and holds.
    const speaking = detectAgentLanguage(lastAssistantText, new Set(plan.spoken));
    if (speaking) return replyLine(speaking);
    // Nothing said yet — open in the campaign's language.
    if (!lastAssistantText?.trim()) return replyLine(plan.primary);
    // The agent HAS spoken but we cannot tell in what: a Marathi campaign that
    // granted a Hindi request is now speaking Devanagari, which is both. Naming
    // the campaign language here would drag it straight back off the language
    // the customer asked for — the exact bug this whole path exists to fix.
    // Hold position instead; the model knows what it is speaking.
    return CONTINUE_IN_CURRENT_LANGUAGE;
  }

  if (!text) return FOLLOW_CUSTOMER_LANGUAGE_NUDGE;
  if (namesALanguage) return FOLLOW_CUSTOMER_LANGUAGE_NUDGE;

  const permitted = new Set(plan.spoken);
  const resolve = (languages: string[]): string | null => {
    const candidates = languages.filter((language) => permitted.has(language));
    return candidates.length === 1 ? candidates[0] : null;
  };

  const matched = SCRIPT_LANGUAGES.filter((script) => script.test.test(text));
  if (matched.length === 1) {
    const named = resolve(matched[0].languages);
    if (named) return replyLine(named);
    return FOLLOW_CUSTOMER_LANGUAGE_NUDGE;
  }
  if (matched.length > 1) return FOLLOW_CUSTOMER_LANGUAGE_NUDGE;

  // No Indic script at all. Latin alone proves nothing, but Gemini's ASR
  // romanizes Indic speech once a call has been running in English — precisely
  // the turns that need correcting (call 9w6t3: three Latin-script Hindi turns
  // went uncorrected before a Devanagari one finally triggered the switch).
  // Distinct non-English tokens are the second decisive signal.
  //
  // This is also the ONLY signal a Marathi campaign ever gets: Marathi and Hindi
  // share Devanagari, so the script gate above always abstains there. Romanized
  // "mala kahi samajla nahi" separates them where the codepoints cannot.
  const romanized = resolveRomanizedLanguage(text, permitted);
  if (romanized) return replyLine(romanized);

  // The way back OUT. Without this the policy is one-way: it can name an Indic
  // language but never English, so a customer switching to English got only the
  // neutral nudge and the agent stayed put. That single asymmetry accounted for
  // 45 of the 53 measured switch misses.
  if (permitted.has(TERM_LANGUAGE) && looksLikeEnglish(text, permitted)) {
    return replyLine(TERM_LANGUAGE);
  }
  return FOLLOW_CUSTOMER_LANGUAGE_NUDGE;
}

/** "Tamil, Hindi or English" — a spoken list, not a comma-joined array. */
function orList(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function conversationRules(plan: VoiceLanguagePlan): string[] {
  const { primary, spoken } = plan;
  const list = orList(spoken);
  const nonEnglish = spoken.filter((language) => language !== TERM_LANGUAGE);

  const rules = [
    plan.pinned
      ? // Regional campaigns do not follow. See VoiceLanguagePlan.pinned for the
        // measurement behind that: the transcripts these calls produce are not
        // reliable enough to steer on.
        `Speak ${primary} for the whole call. Do NOT change language on your own — not because the customer's words sounded like another language, and not because you are unsure what they said. Reply in ${primary} on every turn unless rule 3 applies.`
      : // The English clause is the fix for a customer who answers a regional- or
        // Hindi-opening call entirely in English: without it the model has a rule
        // for every other language it might hear and none for that one.
        `Follow the customer. Reply in whichever of ${list} they last spoke to you in${
          primary === TERM_LANGUAGE
            ? ""
            : ` — that includes staying in ${TERM_LANGUAGE} if they are speaking ${TERM_LANGUAGE} to you`
        }.`,
    `Keep ${TERM_LANGUAGE} for words normally said in ${TERM_LANGUAGE} on Indian phone calls — ${NATURAL_ENGLISH_TERMS.join(", ")}. Do not translate these into formal ${orList(nonEnglish)}; that sounds like a textbook, not a person.`,
    // Bounded to the permitted set on purpose. The unbounded wording promised a
    // switch to anything asked for, including a language with no register pack
    // and an un-localized script — on call 5hgso the model sensibly refused a
    // Tamil request on a Hindi campaign and offered English, i.e. it did the
    // right thing by disobeying us. Specify the graceful answer instead of
    // relying on that.
    // Survives the pin on purpose. Refusing an explicit request is the bug
    // removed on 2026-07-28, when a caller asking for English had no escape,
    // and this path reads the customer's own words rather than our transcript.
    `If the customer explicitly asks you to speak one of ${list}, switch to it on your next sentence and stay there — this takes priority over${
      plan.pinned ? " rule 1 and over" : ""
    } the language you are speaking at that moment. Keep following the same numbered steps: same content, same order, in the language they asked for.`,
    `If they ask for a language that is not ${list}, say briefly that you can speak ${list}, offer whichever fits them best, and carry on — do not attempt a language outside that set.`,
    // The Hindi repair fallback is gone on pinned campaigns: "recover into
    // Hindi" is itself an unrequested language change, and unclear audio is
    // precisely when the transcript is least trustworthy.
    `If you cannot make out what the customer said, OR they spoke something that is not ${list}, treat it as unclear: ask them to repeat — in ${primary}. Do not guess at the meaning${
      plan.pinned ? `, and do not switch to ${BRIDGE_LANGUAGE} or any other language to recover` : ""
    }.`,
    `Never speak a language outside ${list} on this call.`,
    `Whenever you speak ${TERM_LANGUAGE}, speak ONLY Indian English (en-IN). Never US English (en-US) or UK English — Indian pronunciation, wording, and phone cadence only.`,
  ];

  const header = plan.pinned
    ? [
        `This call is in ${primary}.`,
        `Speak ${primary} throughout. You may use ${orList(
          spoken.filter((language) => language !== primary),
        )} ONLY if the customer explicitly asks you to.`,
      ]
    : [
        `This call runs in two languages: ${spoken.join(", ")}.`,
        "Move between them the way a real Indian phone agent does — not one fixed language for the whole call.",
      ];

  return [
    ...header,
    "",
    `OPENING: speak the opening line in ${primary}.`,
    "",
    "RULES:",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
  ];
}

/**
 * The `# LANGUAGE — READ FIRST` block prepended to every campaign's runtime
 * prompt. This is the ONLY place a language policy is asserted for a call.
 */
export function buildVoiceLanguageDirective(language: string | undefined): string {
  const plan = resolveVoiceLanguagePlan(language);

  return [
    "# LANGUAGE — READ FIRST",
    ...conversationRules(plan),
    "",
    `The authored Conversation script is the source of truth for WHAT you say and in what order. It does not fix WHICH of ${plan.spoken.join(", ")} you say it in — render each "Say:" line in whichever one fits the customer at that moment. A "Say:" line already in the language you are currently speaking is approved copy: deliver it as written rather than substituting a different script.`,
    "Follow the numbered steps and Routing notes. Do not invent another workflow.",
    ...(plan.pinned ? [`REGISTER:${casualSpokenRegisterNudge(plan.primary)}`] : []),
    ...(isSemanticTrapGateEnabled() ? [semanticTrapSystemPromptBlock(plan.primary)] : []),
  ].join("\n");
}
