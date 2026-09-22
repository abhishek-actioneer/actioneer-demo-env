/**
 * Intra-language homophone traps for Indian voice campaigns.
 * Deterministic short-utterance gate — used before consent/workflow transitions.
 *
 * Supported languages: English, Hindi, Hinglish, Kannada, Tamil, Telugu, Odia.
 *
 * Design:
 * 1. CANONICAL_VOCABULARY — single source of truth per language (clear, fuzzy, leading)
 * 2. TRAPS — homophone pairs that need one clarification at decision points
 *
 * A third layer, high_stakes_confirm, was removed — see the note above
 * CLEAR_CONFUSED. Clear yes/no answers now go straight to the model.
 */

export const SUPPORTED_SEMANTIC_LANGUAGES = [
  "English",
  "Hindi",
  "Hinglish",
  "Kannada",
  "Tamil",
  "Telugu",
  "Odia",
] as const;

export type SemanticLanguage = (typeof SUPPORTED_SEMANTIC_LANGUAGES)[number];

export type ShortUtteranceIntent =
  | "yes"
  | "no"
  | "confused"
  | "location"
  | "all"
  | "unknown";

export interface ShortUtteranceClassification {
  intent: ShortUtteranceIntent;
  confidence: 1 | 2 | 3;
  ambiguous: boolean;
  needsClarification: boolean;
  trapId?: string;
}

export interface ClassifyShortUtteranceInput {
  text: string;
  language: string | undefined;
  lastAssistantText?: string;
  /** Opening permission, callback consent, or other yes/no moment */
  atDecisionPoint?: boolean;
}

/** Opt-in rollout — set VOICE_SEMANTIC_TRAP_GATE=1 to enable in production. */
export function isSemanticTrapGateEnabled(): boolean {
  return process.env.VOICE_SEMANTIC_TRAP_GATE === "1";
}

export interface SemanticTrapDefinition {
  id: string;
  language: SemanticLanguage;
  label: string;
  conflictingIntents: ShortUtteranceIntent[];
  spokenClarification: string;
}

interface TrapDef extends SemanticTrapDefinition {
  match: RegExp;
}

const TRAPS: TrapDef[] = [
  // ── Kannada ──────────────────────────────────────────────
  {
    id: "kn_ha_vs_huh",
    language: "Kannada",
    label: "Ha (yes) vs Huh (what?)",
    match: /^(ha+|haa+|h+a)$/i,
    conflictingIntents: ["yes", "confused"],
    spokenClarification:
      "ಕ್ಷಮಿಸಿ, ನೀವು 'ಹೌ' ಅಂದಿದ್ದೀರಾ, ಅಥವಾ 'ಗೊತ್ತಿಲ್ಲ' ಅಂದಿದ್ದೀರಾ?",
  },
  {
    id: "kn_illa_vs_ella",
    language: "Kannada",
    label: "Illa (no) vs Ella (all/everything)",
    match: /^(ella+|ellaa|ಎಲ್ಲ)$/u,
    conflictingIntents: ["no", "all"],
    spokenClarification:
      "ಕ್ಷಮಿಸಿ, ನೀವು 'ಇಲ್ಲ' ಅಂದಿದ್ದೀರಾ, ಅಥವಾ 'ಎಲ್ಲಾ' ಅಂದಿದ್ದೀರಾ?",
  },
  {
    id: "kn_beda_vs_beku",
    language: "Kannada",
    label: "Beda (don't want) vs Beku (want) — short ASR flip",
    match: /^(beku|bekaa|ಬೇಕು)$/u,
    conflictingIntents: ["yes", "no"],
    spokenClarification:
      "Just to confirm — ನಿಮಗೆ ಬೇಕಾ, ಅಥವಾ ಬೇಡಾ?",
  },

  // ── Tamil ────────────────────────────────────────────────
  {
    id: "ta_aama_vs_amma",
    language: "Tamil",
    label: "Aama (yes) vs Amma (mother / exclamation)",
    match: /^(amma+|அம்மா)$/u,
    conflictingIntents: ["yes", "unknown"],
    spokenClarification:
      "சாரி, 'ஆமா' nu solreengala, illa vera meaning-aa?",
  },
  {
    id: "ta_illa_vs_ille",
    language: "Tamil",
    label: "Illa (no) vs Ille (here)",
    match: /^(ille+|இல்லே|இங்கே|inge)$/u,
    conflictingIntents: ["no", "location"],
    spokenClarification:
      "சாரி, 'இல்லை' nu solreengala, illa location sollureengala?",
  },
  {
    id: "ta_aa_vs_aama",
    language: "Tamil",
    label: "Aa (yes particle) vs incomplete / surprise",
    match: /^(aa+|ஆ)$/u,
    conflictingIntents: ["yes", "unknown"],
    spokenClarification:
      "Confirm pannalaam — 'ஆமா' nu sollureengala?",
  },

  // ── Telugu ───────────────────────────────────────────────
  {
    id: "te_aa_vs_avunu",
    language: "Telugu",
    label: "Aa (yes particle) vs Avunu (yes) — short ASR",
    match: /^(aa+|a+)$/i,
    conflictingIntents: ["yes", "unknown"],
    spokenClarification:
      "క్షమించandi, 'అవును' అన్నారా, లేదా ఇంకేమైనా?",
  },
  {
    id: "te_ledu_vs_leda",
    language: "Telugu",
    label: "Ledu (no/none) vs Leda (without)",
    match: /^(leda+|లేద)$/u,
    conflictingIntents: ["no", "unknown"],
    spokenClarification:
      "క్షమించandi, 'లేదు' అన్నారా, లేదా 'లేకుండా' అన్నారా?",
  },
  {
    id: "te_vaddu_vs_vadu",
    language: "Telugu",
    label: "Vaddu (don't want) vs Vadu (he) — short ASR",
    match: /^(vadu+)$/i,
    conflictingIntents: ["no", "unknown"],
    spokenClarification:
      "Confirm cheyandi — 'వద్దు' అన్నారా?",
  },
  {
    id: "te_sare_vs_sari",
    language: "Telugu",
    label: "Sare (ok/yes) vs Sari (sari cloth) — roman ASR",
    match: /^(sari)$/i,
    conflictingIntents: ["yes", "unknown"],
    spokenClarification:
      "క్షమించandi, 'సరే' అన్నారా?",
  },

  // ── Odia ─────────────────────────────────────────────────
  {
    id: "or_ha_vs_huh",
    language: "Odia",
    label: "Ha (yes) vs Huh (what?)",
    match: /^(ha+|haa+|h+a)$/i,
    conflictingIntents: ["yes", "confused"],
    spokenClarification:
      "କ୍ଷମା, ଆପଣ 'ହଁ' କହିଲେ, ନା 'ବୁଝିଲି ନାହିଁ' କହିଲେ?",
  },
  {
    id: "or_na_vs_naa",
    language: "Odia",
    label: "Na (no) vs Naa (mine / particle)",
    match: /^(naa+|ନା)$/u,
    conflictingIntents: ["no", "unknown"],
    spokenClarification:
      "Confirm କରନ୍ତୁ — 'ନାହିଁ' କହୁଛନ୍ତି, ନା ଅନ୍ୟ ଅର୍ଥ?",
  },
  {
    id: "or_na_short",
    language: "Odia",
    label: "Na (no particle) — ambiguous alone",
    match: /^(na)$/i,
    conflictingIntents: ["no", "unknown"],
    spokenClarification:
      "କ୍ଷମା, ଆପଣ 'ନାହିଁ' କହିବାକୁ ଚାହୁଁଛନ୍ତି?",
  },
  {
    id: "or_kana_confused",
    language: "Odia",
    label: "Kana (what) — confusion not consent",
    match: /^(kana+|kaana+|କଣ)$/iu,
    conflictingIntents: ["confused"],
    spokenClarification:
      "ଠିକ ଅଛି, ମୁଁ ଆଉ ଥରେ ଧୀରେ କହିଦେବି। ଏବେ clear ହେଲା?",
  },

  // ── Hindi ────────────────────────────────────────────────
  {
    id: "hi_ha_vs_huh",
    language: "Hindi",
    label: "Ha (yes particle) vs Huh (what?)",
    match: /^(ha+|haa+|h+a)$/i,
    conflictingIntents: ["yes", "confused"],
    spokenClarification:
      "माफ़ कीजिए, आपने 'हाँ' कहा, या 'समझ नहीं आया'?",
  },
  {
    id: "hi_ji_vs_unknown",
    language: "Hindi",
    label: "Ji (yes/respect) vs standalone particle",
    match: /^(ji|jee)$/i,
    conflictingIntents: ["yes", "unknown"],
    spokenClarification:
      "Confirm कीजिए — आप 'हाँ/ठीक' कह रहे हैं?",
  },

  // ── Hinglish ─────────────────────────────────────────────
  {
    id: "hg_ha_vs_huh",
    language: "Hinglish",
    label: "Ha (yes) vs Huh (what?)",
    match: /^(ha+|haa+|h+a)$/i,
    conflictingIntents: ["yes", "confused"],
    spokenClarification:
      "Sorry, did you mean 'haan/yes', or 'didn't get it'?",
  },

  // ── English ──────────────────────────────────────────────
  {
    id: "en_yeah_vs_what",
    language: "English",
    label: "Yeah (yes) vs What (confused)",
    match: /^(ya+|yah)$/i,
    conflictingIntents: ["yes", "confused"],
    spokenClarification:
      "Sorry, did you mean 'yes', or 'what'?",
  },
];

const HIGH_STAKES_CUES = [
  /\b(callback|consent|schedule|follow[- ]?up|advisor|transfer|whatsapp|link|book|confirm)\b/i,
  /(कॉलबैक|सहमत|शेड्यूल|फॉलो|एडवाइज|ट्रांसफर|व्हाट्सऐप|लिंक|बुक|कन्फर्म)/u,
  /(ಕಾಲ್|ಬ್ಯಾಕ|ಅಪಾಯಂಟ|ಅನುಮತ|ವಾಟ್ಸ್|ಲಿಂಕ)/u,
  /(கால்பேக|அப்பாயின|ஒப்ப|வாட்ஸ்|லிங்க)/u,
  /(కాల్|బ్యాక|అపాయింట|అనుమ|వాట్స|లింక)/u,
  /(କଲ୍|ବ୍ୟାକ|ଅନୁମ|ଲିଙ୍କ|ନିଶ୍ଚିତ)/u,
];

// The high_stakes_confirm trap used to live here: a canned per-language
// "confirm — should I go ahead, or not right now?" line that hijacked the turn
// whenever the customer gave a CLEAR yes/no and the agent's previous sentence
// contained a HIGH_STAKES_CUES word. It was removed after a live TVS Credit
// call played the identical Hindi line three times and the customer asked
// "आप एआई हो क्या?".
//
// Why it looped: in a campaign whose whole purpose is sending a link and
// booking an appointment, "link"/"book" appear in nearly every agent turn, so
// the cue gate was open almost permanently. The re-entry guard only inspected
// the single preceding assistant turn, so one ordinary sentence re-armed it,
// and nothing capped the number of fires.
//
// HIGH_STAKES_CUES above is deliberately KEPT — requiresHighStakesConfirm() is
// still the signal that blocks mid-call workflow actions (send_link, callback)
// after an ambiguous turn. That gate is a safety property; only the spoken
// hijack was removed.

const CLEAR_CONFUSED: RegExp[] = [
  /^(huh+|what|sorry|repeat|again|\?+)$/i,
  /^(enti|enduku|yeno|gottilla|arthagilla|kelistini|samjha|nahi samjha)$/i,
  /(ఏమito|ఏంటి|అర్థం|తెలియ)/u,
  /(என்ன|புரிய|தெரிய)/u,
  /(ಏನು|ಗೊತ್ತ|ಅರ್ಥ)/u,
  /(କଣ|ବୁଝ|ଜାଣ)/u,
  /(क्या|समझ|नहीं आया)/u,
];

export function normalizeSemanticLanguage(language: string | undefined): SemanticLanguage | undefined {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (normalized === "en" || normalized === "english") return "English";
  if (normalized === "hi" || normalized === "hindi") return "Hindi";
  if (normalized === "hinglish") return "Hinglish";
  if (normalized.includes("kannada") || normalized === "kn") return "Kannada";
  if (normalized.includes("tamil") || normalized === "ta") return "Tamil";
  if (normalized.includes("telugu") || normalized === "te") return "Telugu";
  if (normalized.includes("odia") || normalized.includes("oriya") || normalized === "or") return "Odia";
  return undefined;
}

/** Public catalog for docs, tests, and UI reference. */
export function listSemanticTraps(language?: string): SemanticTrapDefinition[] {
  const semanticLanguage = language ? normalizeSemanticLanguage(language) : undefined;
  return TRAPS
    .filter((trap) => !semanticLanguage || trap.language === semanticLanguage)
    .map(({ id, language: lang, label, conflictingIntents, spokenClarification }) => ({
      id,
      language: lang,
      label,
      conflictingIntents,
      spokenClarification,
    }));
}

interface CanonicalVocabEntry {
  forms: string[];
  intent: ShortUtteranceIntent;
  trapId?: string;
}

interface LanguagePhraseLexicon {
  /** Longer utterance cues — interest/need confirmed */
  interest: string[];
  /** Longer utterance cues — decline/not needed */
  decline: string[];
  /** User thanks-only detection */
  thanks: string[];
  /** Assistant wrap-up / closing detection */
  wrapUp: string[];
}

/** Closed per-language vocabulary for fuzzy ASR recovery (edit distance fallback). */
const CANONICAL_VOCABULARY: Record<SemanticLanguage, CanonicalVocabEntry[]> = {
  English: [
    { forms: ["yes", "yeah", "yep", "sure", "ok", "okay", "correct", "right"], intent: "yes" },
    { forms: ["no", "nope", "nah", "not"], intent: "no" },
    { forms: ["ya", "yah"], intent: "yes", trapId: "en_yeah_vs_what" },
  ],
  Hindi: [
    {
      forms: [
        "haan", "han", "haanji", "bilkul", "theek", "thik", "ठीक", "हाँ", "हां", "बिल्कुल",
        // Permission-to-talk go-aheads ("बोलो" after opening) — not mid-sentence "बोल".
        "बोलो", "बोलिए", "बोलिये", "बताओ", "बताइए",
        // High-stakes confirm proceed ("आगे बढ़ाओ" after confirm line).
        "बढ़ाओ", "बढ़ाइए",
      ],
      intent: "yes",
    },
    { forms: ["nahi", "nahin", "mat", "नहीं", "नही", "ना"], intent: "no" },
    { forms: ["ha", "haa"], intent: "yes", trapId: "hi_ha_vs_huh" },
    { forms: ["ji", "jee"], intent: "yes", trapId: "hi_ji_vs_unknown" },
  ],
  Hinglish: [
    {
      forms: [
        "haan", "han", "haanji", "ji", "bilkul", "theek", "thik", "yes", "yeah", "ok", "okay", "sure",
        "bolo", "boliye", "batao", "bataiye",
        "badhao", "badhaao",
      ],
      intent: "yes",
    },
    { forms: ["nahi", "nahin", "no", "nope", "mat"], intent: "no" },
    { forms: ["ha", "haa"], intent: "yes", trapId: "hg_ha_vs_huh" },
  ],
  Kannada: [
    { forms: ["howdu", "houdu", "haanji", "ಹೌದು", "ಸರಿ", "ಹಾ", "ok", "okay", "yes"], intent: "yes" },
    { forms: ["illa", "illaa", "beda", "bekuilla", "ಇಲ್ಲ", "ಬೇಡ", "no"], intent: "no" },
    { forms: ["beku", "bekaa", "ಬೇಕು"], intent: "yes", trapId: "kn_beda_vs_beku" },
    { forms: ["ha", "haa"], intent: "yes", trapId: "kn_ha_vs_huh" },
    { forms: ["ella", "ellaa", "ಎಲ್ಲ"], intent: "all", trapId: "kn_illa_vs_ella" },
  ],
  Tamil: [
    { forms: ["aama", "ama", "seri", "sari", "ஆமா", "ஆமாம்", "சரி", "ok", "okay", "yes"], intent: "yes" },
    { forms: ["illa", "illai", "venda", "இல்லை", "இல்ல", "no"], intent: "no" },
    { forms: ["amma", "அம்மா"], intent: "yes", trapId: "ta_aama_vs_amma" },
    { forms: ["ille", "இல்லே", "inge", "இங்கே"], intent: "location", trapId: "ta_illa_vs_ille" },
    { forms: ["aa", "ஆ"], intent: "yes", trapId: "ta_aa_vs_aama" },
  ],
  Telugu: [
    { forms: ["avunu", "sare", "అవును", "సరే", "ok", "okay", "yes"], intent: "yes" },
    { forms: ["ledu", "vaddu", "kaadu", "లేదు", "వద్దు", "కాదు", "no"], intent: "no" },
    { forms: ["aa"], intent: "yes", trapId: "te_aa_vs_avunu" },
    { forms: ["leda", "లేద"], intent: "no", trapId: "te_ledu_vs_leda" },
    { forms: ["vadu"], intent: "no", trapId: "te_vaddu_vs_vadu" },
    { forms: ["sari"], intent: "yes", trapId: "te_sare_vs_sari" },
  ],
  Odia: [
    { forms: ["haan", "haanji", "thik", "ହଁ", "ଠିକ", "ok", "okay", "yes"], intent: "yes" },
    { forms: ["nahi", "naahin", "ନାହିଁ", "no"], intent: "no" },
    { forms: ["ha", "haa"], intent: "yes", trapId: "or_ha_vs_huh" },
    { forms: ["naa", "ନା"], intent: "no", trapId: "or_na_vs_naa" },
    { forms: ["na"], intent: "no", trapId: "or_na_short" },
    { forms: ["kana", "kaana", "କଣ"], intent: "confused", trapId: "or_kana_confused" },
  ],
};

/** Per-language phrase lists for longer utterances and closing detection. */
const LANGUAGE_PHRASE_LEXICON: Record<SemanticLanguage, LanguagePhraseLexicon> = {
  English: {
    interest: ["need", "want", "require", "looking for", "interested"],
    decline: [
      "don't think",
      "dont think",
      "i don't think",
      "i dont think",
      // Common ASR garble of "don't think (so)"
      "don't install",
      "dont install",
      "i don't",
      "i dont",
      "oh no",
      "no thanks",
      "no thank you",
      "not interested",
      "no need",
      "not now",
      "not required",
    ],
    thanks: ["thank you", "thanks", "thank", "thx", "bye", "goodbye"],
    wrapUp: ["thank you", "thanks", "have a good day", "have a nice day", "noted", "no need", "not required"],
  },
  Hindi: {
    // Keep "चाहिए/जरूरत" for need statements; do NOT use bare "बोल/बात" —
    // those fire false YES on amount/need clauses and mid-sentence speech.
    interest: ["चाहिए", "जरूरत", "ज़रूरत", "अवश्यक", "रुचि"],
    decline: ["नहीं चाहिए", "अगत्य नही", "जरूरत नही", "रुचि नही"],
    thanks: ["धन्यवाद", "थैंक यू", "शुक्रिया", "बाय"],
    wrapUp: ["धन्यवाद", "समय दिया", "नोट कर", "जरूरत नही", "रुचि नही"],
  },
  Hinglish: {
    interest: ["chahiye", "zarurat", "need", "want", "interested", "bol sakte"],
    decline: ["nahi chahiye", "not interested", "no need", "not now"],
    thanks: ["dhanyavaad", "thank you", "thanks", "shukriya"],
    wrapUp: ["dhanyavaad", "thank you", "noted", "no need"],
  },
  Kannada: {
    interest: ["beku", "avashyaka", "avashyakate", "ಬೇಕು", "ಅವಶ್ಯಕ"],
    decline: ["agatyavilla", "ಅಗತ್ಯವಿಲ್ಲ", "beda", "ಇಲ್ಲ"],
    thanks: ["dhanyavaad", "ಧನ್ಯವಾದ", "ಧನ್ಯವಾದಗಳು", "ನಮಸ್ಕಾರ"],
    wrapUp: ["ಧನ್ಯವಾದ", "ಧನ್ಯವಾದಗಳು", "ಅಗತ್ಯವಿಲ್ಲ", "ಫಂಡ್ಸ್ ಅಗತ್ಯವಿಲ್ಲ", "ನೋಟ್ ಮಾಡ"],
  },
  Tamil: {
    interest: ["venum", "vendum", "தேவை", "வேண்டும்", "interest"],
    decline: ["தேவை இல்ல", "வேண்டாம்", "illai"],
    thanks: ["நன்றி", "nandri"],
    wrapUp: ["நன்றி", "நோட்", "தேவை இல்ல"],
  },
  Telugu: {
    interest: ["kavali", "avashyam", "అవసరం", "కావాలి"],
    decline: ["అవసరం లేదు", "వద్దు", "ledu"],
    thanks: ["ధన్యవాద", "namaskaram", "నమస్కారం"],
    wrapUp: ["ధన్యవాద", "సమయం ఇచ్చిన", "అవసరం లేదు", "నోట్"],
  },
  Odia: {
    interest: ["darkar", "dorkar", "ଦରକାର", "ଜରୁରତ"],
    decline: ["ଦରକାର ନାହିଁ", "ନାହିଁ", "ଆବଶ୍ୟକ ନାହିଁ"],
    thanks: ["ଧନ୍ୟବାଦ", "dhanyavaad"],
    wrapUp: ["ଧନ୍ୟବାଦ", "ନୋଟ", "ଆବଶ୍ୟକ ନାହିଁ"],
  },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRomanForm(form: string): boolean {
  return /^[a-z0-9'’-]+$/i.test(form);
}

function buildClearPatternsFromForms(forms: string[]): RegExp[] {
  const roman = forms.filter(isRomanForm);
  const script = forms.filter((form) => !isRomanForm(form));
  const patterns: RegExp[] = [];
  if (roman.length > 0) {
    patterns.push(new RegExp(`^(?:${roman.map(escapeRegExp).join("|")})$`, "i"));
  }
  for (const form of script) {
    patterns.push(new RegExp(`^${escapeRegExp(form)}$`, "u"));
  }
  return patterns;
}

function collectVocabForms(intent: ShortUtteranceIntent): string[] {
  const forms = new Set<string>();
  for (const language of SUPPORTED_SEMANTIC_LANGUAGES) {
    for (const entry of CANONICAL_VOCABULARY[language]) {
      if (entry.intent === intent) {
        for (const form of entry.forms) {
          if (form.length >= 2 || !isRomanForm(form)) {
            forms.add(form);
          }
        }
      }
    }
  }
  return [...forms];
}

function collectPhrasePatterns(selector: (lexicon: LanguagePhraseLexicon) => string[]): string[] {
  const phrases = new Set<string>();
  for (const language of SUPPORTED_SEMANTIC_LANGUAGES) {
    for (const phrase of selector(LANGUAGE_PHRASE_LEXICON[language])) {
      phrases.add(phrase);
    }
  }
  return [...phrases];
}

const CLEAR_YES: Record<SemanticLanguage, RegExp[]> = Object.fromEntries(
  SUPPORTED_SEMANTIC_LANGUAGES.map((language) => {
    const forms = CANONICAL_VOCABULARY[language]
      .filter((entry) => entry.intent === "yes" && !entry.trapId)
      .flatMap((entry) => entry.forms);
    return [language, buildClearPatternsFromForms(forms)];
  }),
) as Record<SemanticLanguage, RegExp[]>;

const CLEAR_NO: Record<SemanticLanguage, RegExp[]> = Object.fromEntries(
  SUPPORTED_SEMANTIC_LANGUAGES.map((language) => {
    const forms = CANONICAL_VOCABULARY[language]
      .filter((entry) => entry.intent === "no" && !entry.trapId)
      .flatMap((entry) => entry.forms);
    return [language, buildClearPatternsFromForms(forms)];
  }),
) as Record<SemanticLanguage, RegExp[]>;

const ALL_YES_LEADING_FORMS = collectVocabForms("yes");
const ALL_NO_LEADING_FORMS = collectVocabForms("no");
const ALL_INTEREST_PHRASES = collectPhrasePatterns((lexicon) => lexicon.interest);
const ALL_DECLINE_PHRASES = collectPhrasePatterns((lexicon) => lexicon.decline);
const ALL_THANKS_PHRASES = collectPhrasePatterns((lexicon) => lexicon.thanks);
const ALL_WRAP_UP_PHRASES = collectPhrasePatterns((lexicon) => lexicon.wrapUp);

export interface FuzzyCanonicalMatch {
  form: string;
  intent: ShortUtteranceIntent;
  distance: number;
  trapId?: string;
}

export interface FuzzyMatchResult {
  text: string;
  matches: FuzzyCanonicalMatch[];
  bestDistance: number | null;
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Strip trailing sentence punctuation so "बोलो।" / "haan!" still match clear vocab. */
function collapseForIntentMatch(text: string): string {
  return collapse(text).replace(/[\p{P}\p{S}]+$/gu, "").trim();
}

function normalizeForFuzzyMatch(text: string): string {
  const collapsed = collapse(text);
  return /[\u0900-\u0cff]/.test(collapsed) ? collapsed : collapsed.toLowerCase();
}

/** Levenshtein edit distance — used only on short closed-vocabulary tokens. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

/** Max edit distance allowed for a token length (never >= 3). */
export function maxAllowedEditDistance(length: number): number {
  if (length <= 3) return 1;
  if (length <= 6) return 2;
  return 2;
}

function isFuzzyEvaluationReady(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed) return false;
  // Mirror live ASR guard — single roman letters are too noisy for fuzzy recovery.
  if (collapsed.length === 1 && !/[\u0900-\u0cff]/.test(collapsed)) return false;
  return true;
}

/** Fuzzy match user text against the closed canonical vocabulary for a language. */
export function fuzzyMatchCanonicalUtterance(
  language: SemanticLanguage,
  text: string,
): FuzzyMatchResult {
  const normalized = normalizeForFuzzyMatch(text);
  if (!normalized || !isFuzzyEvaluationReady(normalized)) {
    return { text: normalized, matches: [], bestDistance: null };
  }

  const maxDistance = maxAllowedEditDistance(normalized.length);
  const matches: FuzzyCanonicalMatch[] = [];

  for (const entry of CANONICAL_VOCABULARY[language]) {
    for (const form of entry.forms) {
      const normalizedForm = normalizeForFuzzyMatch(form);
      const distance = levenshteinDistance(normalized, normalizedForm);
      const formMaxDistance = maxAllowedEditDistance(
        Math.min(normalized.length, normalizedForm.length),
      );
      if (distance > 0 && distance <= Math.min(maxDistance, formMaxDistance)) {
        matches.push({
          form: normalizedForm,
          intent: entry.intent,
          distance,
          trapId: entry.trapId,
        });
      }
    }
  }

  matches.sort((left, right) => left.distance - right.distance);
  return {
    text: normalized,
    matches,
    bestDistance: matches[0]?.distance ?? null,
  };
}

function resolveFuzzyClassification(
  language: SemanticLanguage,
  text: string,
): ShortUtteranceClassification | null {
  const { matches, bestDistance } = fuzzyMatchCanonicalUtterance(language, text);
  if (bestDistance == null) return null;

  const bestMatches = matches.filter((match) => match.distance === bestDistance);
  const intents = new Set(bestMatches.map((match) => match.intent));
  const trapMatches = bestMatches.filter((match) => match.trapId);

  if (bestMatches.length === 1) {
    const [winner] = bestMatches;
    if (winner.trapId) {
      return {
        intent: winner.intent,
        confidence: 1,
        ambiguous: true,
        needsClarification: true,
        trapId: winner.trapId,
      };
    }
    return {
      intent: winner.intent,
      confidence: 2,
      ambiguous: false,
      needsClarification: false,
    };
  }

  if (intents.size === 1 && trapMatches.length > 0) {
    const nonTrapWinner = bestMatches.find((match) => !match.trapId);
    if (nonTrapWinner) {
      return {
        intent: nonTrapWinner.intent,
        confidence: 2,
        ambiguous: false,
        needsClarification: false,
      };
    }
  }

  if (intents.size === 1 && trapMatches.length === 0) {
    return {
      intent: bestMatches[0].intent,
      confidence: 2,
      ambiguous: false,
      needsClarification: false,
    };
  }

  const trapId = trapMatches[0]?.trapId;
  const primaryIntent = trapMatches[0]?.intent ?? bestMatches[0].intent;
  return {
    intent: primaryIntent,
    confidence: 1,
    ambiguous: true,
    needsClarification: true,
    trapId,
  };
}

/**
 * Amount / need statements ("₹2 करोड़ चाहिए", "I need 20 lakh") are contentful
 * interest — not short yes/no consent. Never force high-stakes callback confirm.
 * Also catches common ASR garbles: "दो कोके/खोके" ≈ "दो करोड़".
 */
export function looksLikeAmountOrNeedStatement(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed) return false;
  const hasAmount =
    /[₹$€]|rs\.?\b|\binr\b|\b(lakh|lac|crore|thousand|million|billion)\b/i.test(collapsed) ||
    /(लाख|करोड़|हजार|रुपये|रु\.?)/u.test(collapsed) ||
    // ASR: करोड़ → कोके / खोके / कोर
    /(दो|तीन|चार|पांच|पाँच|\d+)\s*(कोके|खोके|कोर|crore|lakh|lac)/iu.test(collapsed) ||
    /\d[\d,]*(?:\.\d+)?/.test(collapsed);
  if (!hasAmount) return false;
  return (
    matchesLeadingPhrase(collapsed, ALL_INTEREST_PHRASES) ||
    /\b(need|want|require|looking for|interested)\b/i.test(collapsed) ||
    /(चाहिए|जरूरत|ज़रूरत|रुचि|मिलेंगे|मिलेगा)/u.test(collapsed)
  );
}

function tokenCount(text: string): number {
  return collapse(text).split(/\s+/).filter(Boolean).length;
}

/** Max tokens for decision-point utterances beyond the short (≤3) trap gate. */
export const DECISION_UTTERANCE_MAX_TOKENS = 12;
const DECISION_UTTERANCE_MAX_CHARS = 96;

function normalizeLeadingText(text: string): string {
  const collapsed = collapse(text);
  return /[\u0900-\u0cff]/.test(collapsed) ? collapsed : collapsed.toLowerCase();
}

/** Strip trailing punctuation so "ಧನ್ಯವಾದಗಳು!" still matches wrap-up phrases. */
function tokenizeLeadingHead(fragment: string, maxWords = 4): string[] {
  return normalizeLeadingText(fragment)
    .split(/\s+/)
    .map((word) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter(Boolean)
    .slice(0, maxWords);
}

/** Short roman yes/no tokens must lead the clause — not match mid-utterance (e.g. Telugu "no vaidyum"). */
function isShortRomanYesNoToken(phrase: string): boolean {
  return isRomanForm(phrase) && phrase.length <= 4 && !/\s/.test(phrase);
}

/** Whole-token match only — never substring ("हां" must not hit "कहां"). */
function tokenEqualsOrContainsPhrase(words: string[], phrase: string): boolean {
  if (!phrase) return false;
  if (words.includes(phrase)) return true;
  // Multi-word phrases: allow contiguous token join match in the head window.
  if (/\s/.test(phrase)) {
    const joined = words.join(" ");
    return joined === phrase || joined.startsWith(`${phrase} `) || joined.includes(` ${phrase} `);
  }
  return false;
}

function matchesLeadingPhrase(fragment: string, phrases: string[]): boolean {
  const normalizedFragment = normalizeLeadingText(fragment);
  const words = tokenizeLeadingHead(fragment);
  const head = words.join(" ");

  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeLeadingText(phrase);
    if (!normalizedPhrase) return false;
    if (head === normalizedPhrase || normalizedFragment === normalizedPhrase) return true;
    if (head.startsWith(`${normalizedPhrase} `)) return true;
    // Multi-word interest/decline phrases may appear later in the clause.
    if (/\s/.test(normalizedPhrase) && normalizedFragment.includes(normalizedPhrase)) return true;
    return tokenEqualsOrContainsPhrase(words, normalizedPhrase);
  });
}

/** Leading fillers before a short yes/no ("Oh no…", "Uh yes…") — not content words. */
const LEADING_YES_NO_FILLERS = new Set([
  "oh",
  "ah",
  "uh",
  "um",
  "hmm",
  "well",
  "hey",
  "like",
  "so",
  "look",
  "listen",
  "man",
  "dude",
  "sir",
  "maam",
  "madam",
  "please",
]);

/** Stricter leading match for short yes/no vocabulary — avoids embedded "no" in code-switched speech. */
function matchesLeadingYesNoPhrase(fragment: string, phrases: string[]): boolean {
  const normalizedFragment = normalizeLeadingText(fragment);
  const words = tokenizeLeadingHead(fragment);
  const head = words.join(" ");

  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeLeadingText(phrase);
    if (!normalizedPhrase) return false;
    if (head === normalizedPhrase || normalizedFragment === normalizedPhrase) return true;
    if (isShortRomanYesNoToken(normalizedPhrase)) {
      // Never use startsWith("ya …") — Spanish/Portuguese "Ya un día…" is not YES.
      // Skip phone fillers so "Oh no no man…" counts as leading "no".
      let i = 0;
      while (i < words.length && LEADING_YES_NO_FILLERS.has(words[i])) i += 1;
      if (i >= words.length || words[i] !== normalizedPhrase) {
        // Repeated short no/yes in the opening window ("no no", "yes yes").
        const early = words.slice(0, 3);
        return early.filter((w) => w === normalizedPhrase).length >= 2;
      }
      // Short token must dominate the utterance — not open a long foreign sentence.
      const rest = words.slice(i + 1).filter((w) => !LEADING_YES_NO_FILLERS.has(w));
      return rest.length <= 2;
    }
    if (head.startsWith(`${normalizedPhrase} `)) return true;
    if (/\s/.test(normalizedPhrase) && normalizedFragment.includes(normalizedPhrase)) return true;
    // Exact token only — never substring. "हां" must not match inside "कहां".
    return tokenEqualsOrContainsPhrase(words, normalizedPhrase);
  });
}

/**
 * "नहीं तो X मिलेंगे क्या" / "will I get X?" — content/availability question, not a decline.
 * Leading "नहीं" alone must not fire semantic_no / high-stakes.
 */
export function looksLikeContentOrAvailabilityQuestion(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed) return false;
  if (!/[?？]$/.test(collapsed) && !/(क्या|क्या\s|$|\bwill\b|\bcan\b|\bhow\b)/i.test(collapsed)) {
    // Still allow mid-clause क्या without terminal ?
    if (!/(मिलेंगे|मिलेगा|मिल|लगेंगे|लगेगा|दोक्यूमेंट|डॉक्यूमेंट)/u.test(collapsed)) {
      return false;
    }
  }
  return (
    /^(नहीं\s+तो|नही\s+तो|nahi\s+to|nahin\s+to)\b/iu.test(collapsed) ||
    /(मिलेंगे|मिलेगा|मिल\s+सक|क्या\s+मिल|will\s+i\s+get|can\s+i\s+get|how\s+much)/iu.test(collapsed) ||
    /(डॉक्यूमेंट|दोक्यूमेंट|document).*(क्या|क्या-क्या|लगेंगे|chahiye)/iu.test(collapsed)
  );
}

function firstDecisionFragments(text: string, maxFragments = 2): string[] {
  const collapsed = collapse(text);
  const parts = collapsed.split(/[,;।.!?]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 0) return parts.slice(0, maxFragments);
  return [collapsed.slice(0, 56)];
}

/**
 * Romance-language ASR garble — never a yes/no decision.
 *
 * This is a GUARD, not Spanish support, and it long outlived the Spanish
 * campaign feature that was removed on 2026-07-28. Gemini's ASR emits Romance
 * fragments on Hindi calls routinely — "Si, boludo.", "di nuovo" and "di volo"
 * all appear as customer transcripts in this evening's dumps alone. Without
 * this, "Si" resolves as YES and the agent books a false affirmative on a
 * collections or KYC confirmation. Do not delete it because it mentions
 * Spanish.
 */
export function looksLikeUnsupportedRomanceAsr(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed || /[\u0900-\u097f]/.test(collapsed)) return false;
  // Accent class widened 2026-07-28: the corpus contained "Ah, che cavolo è
  // questo?" and "Yo no estoy de acuerdo, güey." — both Romance garble that the
  // acute-only class missed, so both were scored as genuine customer English.
  // None of these codepoints occur in English or in romanized-Hindi ASR output.
  return /[áéíóúñ¿¡àèìòùâêîôûãõäëïöüç]|(\b(ya|un|una|día|dia|es|que|deus|mandou|não|nao|você|voce|para|com|uma|isso|parlare|inglese|per|mais|pouquinho|falar|amor|meu|estoy|acuerdo|cavolo|questo|güey|guey)\b)/i.test(
    collapsed,
  );
}

/**
 * WH / clarification questions — never yes/no from embedded interest cues
 * ("Why do I need…" ≠ funding YES). Do NOT treat a trailing "?" alone as WH —
 * "I need a loan, may I know?" is still interest.
 */
function looksLikeWhOrClarificationQuestion(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed) return false;
  return (
    /\b(what|why|how|when|where|which|who)\b/i.test(collapsed) ||
    /\b(kya|kyon|kyun|kaise|kahan|kahaan|kab|kis|kaun)\b/i.test(collapsed) ||
    /(क्या|क्यों|कैसे|कहां|कहाँ|कब|कौन|किस)/u.test(collapsed)
  );
}

/** Detect yes/no from the leading clause of a longer utterance (all languages). */
export function detectLeadingDecisionIntent(
  text: string,
): ShortUtteranceClassification | undefined {
  // Availability / document questions are not consent decisions.
  if (looksLikeContentOrAvailabilityQuestion(text)) return undefined;
  // "What is this…? Why do I need…" must not become YES via interest cue "need".
  if (looksLikeWhOrClarificationQuestion(text)) return undefined;
  // Spanish/Portuguese ASR must not resolve as yes/no via trailing "¿no?".
  if (looksLikeUnsupportedRomanceAsr(text)) return undefined;

  const fragments = firstDecisionFragments(text);
  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    // Trailing tag questions ("…, ¿no?") are not a leading decision.
    if (
      index > 0 &&
      /^(no|yes|ya|nah|nope)$/i.test(normalizeLeadingText(fragment).replace(/[¿?¡!]+/g, "").trim())
    ) {
      continue;
    }
    const yes =
      matchesLeadingYesNoPhrase(fragment, ALL_YES_LEADING_FORMS) ||
      matchesLeadingPhrase(fragment, ALL_INTEREST_PHRASES);
    const no =
      matchesLeadingYesNoPhrase(fragment, ALL_NO_LEADING_FORMS) ||
      matchesLeadingPhrase(fragment, ALL_DECLINE_PHRASES);

    if (yes && !no) {
      return {
        intent: "yes",
        confidence: 2,
        ambiguous: false,
        needsClarification: false,
      };
    }
    if (no && !yes) {
      return {
        intent: "no",
        confidence: 2,
        ambiguous: false,
        needsClarification: false,
      };
    }
  }
  return undefined;
}

/** True when the user turn is only a brief thanks/goodbye after closing. */
export function isThanksOnlyTranscript(text: string): boolean {
  const collapsed = collapse(text).replace(/[.!?,;।]+$/u, "").trim();
  if (!collapsed || collapsed.length > 48) return false;

  let remainder = collapsed;
  for (const phrase of ALL_THANKS_PHRASES) {
    const pattern = new RegExp(escapeRegExp(phrase), "giu");
    remainder = remainder.replace(pattern, " ");
  }
  remainder = remainder
    .replace(/\b(thank you|thanks|thank|dhanyavaad|thx|bye|goodbye)\b/gi, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();

  if (remainder.length > 0) return false;
  return matchesLeadingPhrase(collapsed, ALL_THANKS_PHRASES)
    || /\b(thank|thanks|dhanyavaad|bye|goodbye)\b/i.test(collapsed);
}

/** True when assistant text looks like a call wrap-up / decline closing. */
export function isAssistantWrapUpTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return matchesLeadingPhrase(trimmed, ALL_WRAP_UP_PHRASES)
    || /\b(thank you|thanks|have a (?:good|nice) day|goodbye|noted)\b/i.test(trimmed);
}

export function isDecisionTrapEvaluationReady(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed) return false;
  if (tokenCount(collapsed) > DECISION_UTTERANCE_MAX_TOKENS || collapsed.length > DECISION_UTTERANCE_MAX_CHARS) {
    return false;
  }
  if (collapsed.length === 1 && !/[\u0900-\u0cff]/.test(collapsed)) return false;
  return true;
}

/** Short trap path first; then leading-clause yes/no for longer decision replies. */
export function classifyDecisionUtterance(
  input: ClassifyShortUtteranceInput,
): ShortUtteranceClassification | null {
  if (looksLikeContentOrAvailabilityQuestion(input.text)) {
    return null;
  }
  // Barge-in content questions are not binary decisions.
  if (looksLikeWhOrClarificationQuestion(input.text)) {
    return null;
  }
  // Italian/Portuguese/Spanish ASR must not resolve as yes/no (e.g. "No, per parlare…").
  if (looksLikeUnsupportedRomanceAsr(input.text)) {
    return null;
  }

  const short = classifyShortUtterance(input);
  if (short) return short;

  const text = collapse(input.text);
  if (!text || tokenCount(text) > DECISION_UTTERANCE_MAX_TOKENS || text.length > DECISION_UTTERANCE_MAX_CHARS) {
    return null;
  }

  const atDecisionPoint = input.atDecisionPoint ?? isBinaryDecisionContext(input.lastAssistantText);
  if (!atDecisionPoint) return null;

  // After a short identity opening, "हां जी बताइए" / "bolo" is opening YES even
  // when leading-yes patterns alone are thin.
  if (isOpeningPermissionQuestion(input.lastAssistantText) && isOpeningGoAhead(text)) {
    return {
      intent: "yes",
      confidence: 3,
      ambiguous: false,
      needsClarification: false,
    };
  }

  // Confirm-line echo ("आगे बढ़ाओ" / "go ahead") after "हाँ, आगे बढ़ाऊँ…".
  if (isConfirmProceedUtterance(text)) {
    return {
      intent: "yes",
      confidence: 3,
      ambiguous: false,
      needsClarification: false,
    };
  }

  return detectLeadingDecisionIntent(text) ?? null;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const collapsed = collapse(text);
  return patterns.some((pattern) => pattern.test(collapsed));
}

export function requiresHighStakesConfirm(lastAssistantText: string | undefined): boolean {
  const text = lastAssistantText?.trim() ?? "";
  if (!text) return false;
  return HIGH_STAKES_CUES.some((pattern) => pattern.test(text));
}

export function isBinaryDecisionContext(lastAssistantText: string | undefined): boolean {
  const text = lastAssistantText?.trim() ?? "";
  if (!text) return false;
  if (/[?؟]$/.test(text)) return true;
  // Short identity openings still expect a yes/go-ahead from the customer.
  if (isOpeningPermissionQuestion(text)) return true;

  const lower = text.toLowerCase();
  const cues = [
    /\b(can we|could we|would you|do you|shall i|may i|interested|minute|callback|need|want)\b/i,
    /\b(kya|kyaa|chahoge|chahenge|theek|sahi|interest|consent|callback|review|useful|permission|minute|baat)\b/i,
    /(होग|है क्या|चाहिए|ठीक|बात|मिनट|रुचि|बोल)/u,
    /(चाही|बात|मिनट)/u,
    /(ಮಾತನಾಡ|ನಿಮಿಷ|ಬೇಕ|ಸರಿ|ಇಷ್ಟ)/u,
    /(பேச|நிமிட|வேண்ட|சரி|interest)/u,
    /(మాట్లాడ|నిమిష|కావ|సరే|అవసర)/u,
    /(କଥା|ମିନିଟ|ଦରକାର|ଠିକ)/u,
  ];
  return cues.some((pattern) => pattern.test(lower) || pattern.test(text));
}

function detectClearIntent(
  language: SemanticLanguage,
  text: string,
): ShortUtteranceClassification | undefined {
  if (matchesAny(text, CLEAR_CONFUSED)) {
    return {
      intent: "confused",
      confidence: 3,
      ambiguous: false,
      needsClarification: false,
    };
  }
  if (matchesAny(text, CLEAR_YES[language])) {
    return {
      intent: "yes",
      confidence: 3,
      ambiguous: false,
      needsClarification: false,
    };
  }
  if (matchesAny(text, CLEAR_NO[language])) {
    return {
      intent: "no",
      confidence: 3,
      ambiguous: false,
      needsClarification: false,
    };
  }
  return undefined;
}

function findTrap(language: SemanticLanguage, text: string): TrapDef | undefined {
  const collapsed = collapse(text);
  return TRAPS.find((trap) => trap.language === language && trap.match.test(collapsed));
}

export function isSemanticTrapEvaluationReady(text: string): boolean {
  const collapsed = collapse(text);
  if (!collapsed) return false;
  if (tokenCount(collapsed) > 3 || collapsed.length > 32) return false;
  // Avoid firing on single roman letters while ASR is still streaming ("h" -> "ha").
  if (collapsed.length === 1 && !/[\u0900-\u0cff]/.test(collapsed)) return false;
  return true;
}

export function classifyShortUtterance(
  input: ClassifyShortUtteranceInput,
): ShortUtteranceClassification | null {
  const text = collapseForIntentMatch(input.text);
  if (!text || tokenCount(text) > 3 || text.length > 32) return null;

  const language = normalizeSemanticLanguage(input.language);
  if (!language) return null;

  const atDecisionPoint = input.atDecisionPoint ?? isBinaryDecisionContext(input.lastAssistantText);
  if (!atDecisionPoint) return null;

  const clear = detectClearIntent(language, text);
  if (clear) return clear;

  const trap = findTrap(language, text);
  if (trap) {
    const primaryIntent = trap.conflictingIntents[0] ?? "unknown";
    return {
      intent: primaryIntent,
      confidence: 1,
      ambiguous: true,
      needsClarification: true,
      trapId: trap.id,
    };
  }

  const fuzzy = resolveFuzzyClassification(language, text);
  if (fuzzy) return fuzzy;

  return null;
}

export function getTrapById(trapId: string | undefined): TrapDef | undefined {
  if (!trapId) return undefined;
  return TRAPS.find((trap) => trap.id === trapId);
}

export function semanticTrapSystemPromptBlock(language: string | undefined): string {
  const semanticLanguage = normalizeSemanticLanguage(language);
  if (!semanticLanguage) return "";

  const traps = listSemanticTraps(semanticLanguage);
  if (traps.length === 0) return "";

  const lines = traps.map(
    (trap) => `- ${trap.label} (${trap.conflictingIntents.join(" vs ")})`,
  );

  return [
    "",
    `# INTRA-LANGUAGE TRAP AWARENESS (${semanticLanguage})`,
    "Some short replies sound similar but mean opposite things on phone calls.",
    "Never treat a one-word reply as consent or refusal without context.",
    "If a short reply is ambiguous, ask ONE clarification question before proceeding.",
    "For callback/consent/transfer, always confirm once even on clear yes/no.",
    "Known traps for this language:",
    ...lines,
  ].join("\n");
}

export function buildSemanticClarificationInstruction(
  language: string | undefined,
  trapId: string | undefined,
  userText: string,
): string {
  const trap = getTrapById(trapId);
  const semanticLanguage = normalizeSemanticLanguage(language) ?? "the active language";

  const spoken = trap?.spokenClarification
    ?? `In ${semanticLanguage}, ask one short clarification because the customer's reply "${userText}" was ambiguous. Do not assume yes or no yet.`;

  return [
    `Say exactly this clarification, nothing else, then stop and wait: ${spoken}`,
    "Do not speak any other words from this instruction.",
    `Customer said: "${userText}".`,
    trap ? `Trap: ${trap.label}.` : "Their short reply may be an intra-language homophone trap.",
    "Do not pitch, schedule, or close until they answer clearly.",
  ].join(" ");
}

/** Opening / permission-to-talk questions — YES means continue the next scripted step, not callback. */
export function isOpeningPermissionQuestion(lastAssistantText: string | undefined): boolean {
  const text = lastAssistantText?.trim() ?? "";
  if (!text) return false;
  const lower = text.toLowerCase();

  // Right-person / identity confirmation is NOT "can we talk?" — YES means confirm identity,
  // then follow the Campaign workflow (e.g. good-time check), not a hardcoded product pitch.
  if (isRightPersonQuestion(text)) return false;

  // Language-preference ask is also not permission-to-talk.
  if (
    /भाषा|bhasha|language|पसंद करेंगे|pasand karenge|किस भाषा|kis bhasha|which language|preferred language/i.test(
      text,
    )
  ) {
    return false;
  }

  // Explicit "can we talk for a minute?" / "good time?" style only.
  // Do NOT match bare "बात कर रही हूँ" inside identity lines — that falsely
  // treated right-person checks as opening permission and forced a top-up pitch.
  if (
    (
      /\b(minute|min|good time|baat|talk|speak|free|available)\b/i.test(lower) ||
      /(मिनट|बात हो|समय|फ्री|टाइम|अच्छा समय)/u.test(text)
    ) && (
      /\b(can we|could we|may i|do you have|are you|is this|क्या अभी|हो पाएगी|हो पाएगा|good time)\b/i.test(lower) ||
      /(हो पाएगी|हो पाएगा|बात हो पा|मिनट बात|एक मिनट|अच्छा समय)/u.test(text)
    )
  ) {
    return true;
  }
  // Short campaign identity openings ("Namaste, main Ananya… se.") with no
  // explicit permission question — still treat the next go-ahead as opening YES.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 28) return false;
  if ((text.match(/[.।!?？]/g) || []).length >= 2) return false;
  return (
    /\b(namaste|hello|hi|main|mein|bol rahi|bol raha|calling from|se bol)\b/i.test(lower) ||
    /(नमस्ते|नमस्कार|मैं|बोल रही|बोल रहा|से बोल)/u.test(text)
  );
}

/** Customer go-ahead after a short opening ("हां जी बताइए", "bolo", "go ahead"). */
export function isOpeningGoAhead(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;
  return (
    /\b(batao|bataiye|bolo|boliye|bolie|dikhaiye|dikhāo|go ahead|tell me|please tell|continue|aage|aage batao)\b/i.test(
      normalized,
    ) ||
    /(बताओ|बताइए|बताईए|बोलो|बोलिए|दिखाइए|दिखाओ|आगे|जारी)/u.test(text)
  );
}

/**
 * Customer affirming the high-stakes confirm line
 * ("कन्फर्म कीजिए — हाँ, आगे बढ़ाऊँ…") with proceed phrasing.
 * Bare "आगे" alone is too weak mid-pitch; require proceed verbs.
 */
export function isConfirmProceedUtterance(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;
  return (
    /\b(go ahead|please proceed|proceed|aage badhao|aage badhaao|aage badhaye|aage badhaen|aage badho|badhao|badhaao)\b/i.test(
      normalized,
    ) ||
    /(आगे\s*बढ़ाओ|आगे\s*बढ़ाएँ|आगे\s*बढ़ाएं|आगे\s*बढ़ाइए|आगे\s*बढ़ा|बढ़ाओ|बढ़ाइए)/u.test(text)
  );
}

/** Right-person / identity confirmation — YES means continue the script after identity. */
export function isRightPersonQuestion(lastAssistantText: string | undefined): boolean {
  const text = lastAssistantText?.trim() ?? "";
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    /\b(right person|correct person|speaking with the right|am i speaking with)\b/i.test(lower) ||
    /(सही व्यक्ति|सही इंसान|क्या मैं सही)/u.test(text)
  );
}

/** Funds / need / interest questions — YES means need confirmed. */
export function isNeedOrInterestQuestion(lastAssistantText: string | undefined): boolean {
  const text = lastAssistantText?.trim() ?? "";
  if (!text) return false;
  // "loan application" identity lines must not count as funding-need questions.
  if (isRightPersonQuestion(text)) return false;
  return (
    /\b(fund|funds|need|interest|expense|purpose|extra|top-?up)\b/i.test(text) ||
    /(फंड|जरूरत|ज़रूरत|रुचि|एक्सपेंस|खर्च|उद्देश्य|एक्स्ट्रा)/u.test(text) ||
    (/\b(loan)\b/i.test(text) && /\b(need|want|interested|extra|top-?up|funds?)\b/i.test(text)) ||
    (/(लोन)/u.test(text) && /(जरूरत|ज़रूरत|चाहिए|रुचि|एक्स्ट्रा|फंड)/u.test(text))
  );
}

/** Callback / transfer scheduling — YES means schedule it. */
export function isCallbackOfferQuestion(lastAssistantText: string | undefined): boolean {
  const text = lastAssistantText?.trim() ?? "";
  if (!text) return false;
  return (
    /\b(callback|call back|advisor|schedule|transfer)\b/i.test(text) ||
    /(कॉलबैक|कॉल बैक|एडवाइजर|शेड्यूल|ट्रांसफर)/u.test(text)
  );
}

export function buildSemanticResolutionInstruction(
  classification: ShortUtteranceClassification,
  userText: string,
  language?: string,
  lastAssistantText?: string,
  customerName?: string,
): string {
  const languageLock = language
    ? ` Speak this entire reply only in ${language}; do not mix other languages.`
    : "";
  const name = customerName?.trim();
  const nameReminder = name
    ? `If you mention who the loan / call is for, say the name exactly as "${name}" — do not skip or invent a different name.`
    : "";
  if (classification.intent === "yes") {
    const openingYes = isOpeningPermissionQuestion(lastAssistantText);
    const rightPersonYes = isRightPersonQuestion(lastAssistantText);
    const amountNeedYes = looksLikeAmountOrNeedStatement(userText);
    // Amount/need statements answer the funds question — never treat as callback consent.
    const callbackYes = !amountNeedYes && isCallbackOfferQuestion(lastAssistantText);
    const needYes = amountNeedYes || isNeedOrInterestQuestion(lastAssistantText);
    if (openingYes) {
      // Never hardcode a product pitch here — campaigns differ (PD briefing, top-up, etc.).
      // Follow the Campaign workflow next step only.
      return [
        `Semantic resolution: Customer affirmed ("${userText}").`,
        "Treat this as YES for the permission-to-talk / go-ahead question.",
        "They only agreed to talk — do NOT jump to advisor callback, scheduling, or closing yet.",
        "Continue with the NEXT step written in the Campaign workflow.",
        "Say ONLY that one next workflow step, then stop and wait for the customer.",
        "Do NOT combine recording notice + disbursement + later steps into one reply.",
        "Do NOT invent a product pitch (top-up loan, extra funds, disbursement check, etc.) unless that exact next step is in the Campaign workflow.",
        "Say one short continuous reply for that next workflow step only, then stop and wait.",
        nameReminder,
        languageLock,
      ].filter(Boolean).join(" ");
    }
    if (rightPersonYes) {
      return [
        `Semantic resolution: Customer affirmed ("${userText}").`,
        "Treat this as YES for the right-person / identity question.",
        "Continue with the NEXT step written in the Campaign workflow after identity confirmation (for example a good-time check).",
        "Say ONLY that one next workflow step, then stop and wait. Do not jump ahead to disbursement, EMI, or closing.",
        "Do NOT invent a product pitch (top-up loan, extra funds, disbursement check, etc.).",
        "Do not skip ahead to PD briefing, scheduling, or closing unless that is the next workflow step.",
        nameReminder,
        languageLock,
      ].filter(Boolean).join(" ");
    }
    const nextStep = amountNeedYes
      ? "They stated a concrete funding need/amount. Acknowledge that need briefly, ask one clarifying detail if useful (purpose/timeline), then offer advisor callback — do NOT re-ask whether they are interested."
      : callbackYes
        ? "They agreed to the callback/transfer. Confirm briefly and proceed to schedule or handoff."
        : needYes
          ? "They confirmed need/interest for the question you asked. Continue the positive intake path (purpose details, then advisor callback if appropriate)."
          : "Continue with ONLY the next single Campaign workflow step for the question you just asked. Do not combine multiple steps (recording + disbursement + EMI) into one reply. Stop and wait after that one step.";
    return [
      `Semantic resolution: Customer affirmed ("${userText}").`,
      "Treat this as YES for the question you just asked.",
      nextStep,
      "Do NOT treat this as a decline.",
      "Do not re-ask the same yes/no question.",
      languageLock,
    ].filter(Boolean).join(" ");
  }
  if (classification.intent === "no") {
    const openingNo = isOpeningPermissionQuestion(lastAssistantText);
    const rightPersonNo = isRightPersonQuestion(lastAssistantText);
    const nextStep = openingNo
      ? "They declined to talk now. Acknowledge politely and close briefly — do not pitch funds."
      : rightPersonNo
        ? name
          ? `They said you have the wrong person. Apologize briefly. If you clarify who you called for, say the name exactly as "${name}", then close politely.`
          : "They said you have the wrong person. Apologize briefly and close politely."
        : "Acknowledge politely for that question, note no current need if relevant, and close or offer callback later.";
    return [
      `Semantic resolution: Customer declined ("${userText}").`,
      "Treat this as NO for the question you just asked.",
      nextStep,
      "Do NOT pitch further or treat as yes.",
      "Do not re-ask the same yes/no question.",
      !rightPersonNo ? nameReminder : "",
      language
        ? `Say your entire reply only in ${language} from the first word — do not start in another language.`
        : "",
      languageLock,
    ].filter(Boolean).join(" ");
  }

  const intentLabel =
    classification.intent === "confused" ? "confused — explain briefly"
      : classification.intent === "location" ? "location reference, not yes/no"
        : classification.intent === "all" ? "meaning 'all/everything', not consent"
          : "unclear";

  return [
    `Semantic resolution: Customer clarified "${userText}" as ${intentLabel}.`,
    "Proceed naturally based on that meaning.",
    "Do not re-ask the same clarification.",
    languageLock,
  ].filter(Boolean).join(" ");
}

/**
 * @deprecated Hardcoded Vastu top-up pitch — do not use for live instructions.
 * Kept only so older pitch-remainder unit tests can pass an explicit fullPitch string.
 * Runtime opening-YES and pitch continuation must follow the Campaign workflow instead.
 */
export function openingYesExactPitchLine(language?: string): string {
  const normalized = (language ?? "Hindi").toLowerCase();
  if (normalized.startsWith("english")) {
    return "Your loan was recently disbursed, so I'm doing a quick check — over the next 3-6 months, might you need extra funds for home, business, education, medical, or family expenses?";
  }
  if (normalized.includes("hinglish")) {
    return "Aapka loan recently disburse hua tha, isliye ek chhota sa check kar rahi hoon — aage 3-6 mahine mein home, business, education, medical ya family expense ke liye extra fund ki zarurat pad sakti hai kya?";
  }
  return "आपका लोन रिसेंटली डिस्बर्स हुआ था, इसलिए एक छोटा सा चेक कर रही हूँ - आगे 3-6 महीने में होम, बिज़नेस, एजुकेशन, मेडिकल या फैमिली एक्सपेंस के लिए एक्स्ट्रा फंड की ज़रूरत पड़ सकती है क्या?";
}
