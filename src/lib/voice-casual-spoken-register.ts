/**
 * Single source of truth for casual phone-call register in the regional Indic
 * languages. Used by runtime instructions, script rewrite, and language rebind.
 *
 * Goal: sound like a real Indian outbound agent on a phone call — never like
 * formal written / literary / textbook speech.
 *
 * REVIEW STATUS: the Tamil / Telugu / Kannada packs have been used on live
 * calls. The Marathi / Bengali / Odia packs are NEW and have NOT been reviewed
 * by a native speaker — see `reviewed` on each entry. Treat unreviewed packs as
 * drafts: they encode the right *shape* (colloquial vs literary contrast) but
 * the specific word choices need a native pass before customer-facing use.
 */

export type CasualIndicLanguage =
  | "Tamil"
  | "Telugu"
  | "Kannada"
  | "Marathi"
  | "Bengali"
  | "Odia";

/** @deprecated Marathi/Bengali/Odia are not South Indian — use CasualIndicLanguage. */
export type CasualSouthIndianLanguage = CasualIndicLanguage;

interface CasualRegisterPack {
  /** Native-speaker reviewed and used on live calls. */
  reviewed: boolean;
  /** Short label for the colloquial register, in-language where one exists. */
  registerName?: string;
  /** Colloquial forms a phone agent actually uses. */
  prefer: string[];
  /** Literary / written forms that make the agent sound like a textbook. */
  avoid: string[];
  /** First-person verbs inflect for speaker gender (affects voice-gender match). */
  genderedFirstPerson: boolean;
  /** One casual/formal pair per line, to anchor the contrast concretely. */
  examples: Array<{ ok: string; bad: string }>;
}

const PACKS: Record<CasualIndicLanguage, CasualRegisterPack> = {
  Tamil: {
    reviewed: true,
    registerName: "பேச்சுத் தமிழ்",
    prefer: ["நீங்க", "இருக்கீங்களா", "பேசுறேன்", "சரிங்க", "சொல்லுங்க", "பாருங்க", "ஆமா", "வேணாம்"],
    avoid: ["நீங்கள்", "இருக்கிறீர்களா", "பேசுகிறேன்", "செய்கிறேன்", "கூறுகிறீர்கள்"],
    genderedFirstPerson: false,
    examples: [
      {
        ok: "வணக்கம், நான் Ananya, Vastu-ல இருந்து பேசுறேன். இப்ப ஒரு நிமிஷம் பேசலாமா?",
        bad: "வணக்கம், நான் Ananya, Vastu இலிருந்து பேசுகிறேன். இப்போது ஒரு நிமிடம் பேசலாமா?",
      },
      {
        ok: "நீங்கதான் ராகேஷ் தானே? ஒரு சின்ன விஷயம் confirm பண்றேன்.",
        bad: "நீங்கள் தான் ராகேஷ் தானா? ஒரு சிறிய விஷயத்தை உறுதி செய்கிறேன்.",
      },
    ],
  },
  Telugu: {
    reviewed: true,
    prefer: ["మీరు", "ఉన్నారా", "మాట్లాడుతున్నా", "చెప్పండి", "సరే", "చూడండి", "అవును", "కాదు", "ఇప్పుడు"],
    avoid: ["మాట్లాడుచున్నాను", "చేయుచున్నాను", "newspaper-style phrasing"],
    genderedFirstPerson: false,
    examples: [
      {
        ok: "నమస్కారం, నేను Ananya Vastu నుంచి మాట్లాడుతున్నా. ఇప్పుడు ఒక నిమిషం మాట్లాడొచ్చా?",
        bad: "నమస్కారం, నేను Ananya Vastu నుండి మాట్లాడుచున్నాను. ఇప్పుడు ఒక నిమిషం మాట్లాడవచ్చా?",
      },
      {
        ok: "మీరే రాకేష్ కదా? ఒక్క చిన్న విషయం confirm చేసుకుంటా.",
        bad: "మీరు రాకేష్ అవునా? ఒక చిన్న విషయాన్ని ధృవీకరిస్తున్నాను.",
      },
    ],
  },
  Kannada: {
    reviewed: true,
    prefer: ["ನೀವು", "ಇದ್ದೀರಾ", "ಮಾತಾಡ್ತಾ ಇದೀನಿ", "ಹೇಳಿ", "ಸರಿ", "ನೋಡಿ", "ಹೌದು", "ಬೇಡ", "ಈಗ"],
    avoid: ["ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ", "ಮಾಡುತ್ತಿದ್ದೇನೆ", "stiff written phrasing"],
    genderedFirstPerson: false,
    examples: [
      {
        ok: "ನಮಸ್ಕಾರ, ನಾನು Ananya Vastu ಇಂದ ಮಾತಾಡ್ತಾ ಇದೀನಿ. ಈಗ ಒಂದು ನಿಮಿಷ ಮಾತಾಡಬಹುದಾ?",
        bad: "ನಮಸ್ಕಾರ, ನಾನು Ananya Vastu ಇಂದ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಒಂದು ನಿಮಿಷ ಮಾತನಾಡಬಹುದೇ?",
      },
      {
        ok: "ನೀವೇ ರಾಕೇಶ್ ಅಲ್ವಾ? ಒಂದು ಸಣ್ಣ ವಿಷಯ confirm ಮಾಡ್ತೀನಿ.",
        bad: "ನೀವು ರಾಕೇಶ್ ತಾನೇ? ಒಂದು ಸಣ್ಣ ವಿಷಯವನ್ನು ದೃಢೀಕರಿಸುತ್ತಿದ್ದೇನೆ.",
      },
    ],
  },
  Marathi: {
    reviewed: false,
    prefer: ["तुम्ही", "आहात का", "बोलतोय / बोलतेय", "सांगा", "ठीक आहे", "बघा", "हो", "नको", "आत्ता"],
    avoid: ["बोलत आहे", "करीत आहे", "आपणांस", "newspaper / written Marathi"],
    // मी बोलतोय (male) vs मी बोलतेय (female) — must match the selected voice.
    genderedFirstPerson: true,
    examples: [
      {
        ok: "नमस्कार, मी Ananya, Vastu मधून बोलतेय. आत्ता एक मिनिट बोलू शकता का?",
        bad: "नमस्कार, मी Ananya, Vastu कडून बोलत आहे. आपण आत्ता एक मिनिट बोलू शकाल का?",
      },
      {
        ok: "तुम्हीच राकेश ना? एक छोटी गोष्ट confirm करतेय.",
        bad: "आपणच राकेश आहात का? एक छोटी बाब निश्चित करीत आहे.",
      },
    ],
  },
  Bengali: {
    reviewed: false,
    registerName: "চলিত ভাষা",
    prefer: ["আপনি", "আছেন", "বলছি", "বলুন", "ঠিক আছে", "দেখুন", "হ্যাঁ", "না", "এখন"],
    // সাধু ভাষা is the literary register — never correct on a phone call.
    avoid: ["বলিতেছি", "করিতেছি", "হইয়াছে", "সাধু ভাষা forms generally"],
    genderedFirstPerson: false,
    examples: [
      {
        ok: "নমস্কার, আমি Ananya, Vastu থেকে বলছি। এখন এক মিনিট কথা বলা যাবে?",
        bad: "নমস্কার, আমি Ananya, Vastu হইতে বলিতেছি। এখন এক মিনিট কথা বলিতে পারিবেন?",
      },
      {
        ok: "আপনিই রাকেশ তো? একটা ছোট বিষয় confirm করছি।",
        bad: "আপনিই কি রাকেশ? একটি ক্ষুদ্র বিষয় নিশ্চিত করিতেছি।",
      },
    ],
  },
  Odia: {
    reviewed: false,
    prefer: ["ଆପଣ", "ଅଛନ୍ତି", "କହୁଛି", "କୁହନ୍ତୁ", "ଠିକ ଅଛି", "ଦେଖନ୍ତୁ", "ହଁ", "ନା", "ଏବେ"],
    avoid: ["କହୁଅଛି", "କରୁଅଛି", "formal written Odia"],
    genderedFirstPerson: false,
    examples: [
      {
        ok: "ନମସ୍କାର, ମୁଁ Ananya, Vastu ରୁ କହୁଛି। ଏବେ ଏକ ମିନିଟ୍ କଥା ହୋଇପାରିବ କି?",
        bad: "ନମସ୍କାର, ମୁଁ Ananya, Vastu ରୁ କହୁଅଛି। ଏବେ ଏକ ମିନିଟ୍ କଥା ହୋଇପାରିବେ କି?",
      },
      {
        ok: "ଆପଣ ହିଁ ରାକେଶ ନା? ଗୋଟିଏ ଛୋଟ କଥା confirm କରୁଛି।",
        bad: "ଆପଣ କଣ ରାକେଶ ଅଟନ୍ତି? ଗୋଟିଏ କ୍ଷୁଦ୍ର ବିଷୟ ନିଶ୍ଚିତ କରୁଅଛି।",
      },
    ],
  },
};

const LABEL_ALIASES: Record<string, CasualIndicLanguage> = {
  ta: "Tamil", tamil: "Tamil", tamizh: "Tamil",
  te: "Telugu", telugu: "Telugu",
  kn: "Kannada", kannada: "Kannada", kanada: "Kannada",
  mr: "Marathi", marathi: "Marathi",
  bn: "Bengali", bengali: "Bengali", bangla: "Bengali",
  or: "Odia", odia: "Odia", oriya: "Odia",
};

function normalizeLanguageLabel(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? "";
  return LABEL_ALIASES[normalized] ?? language?.trim() ?? "";
}

export function isCasualIndicLanguage(
  language: string | undefined,
): language is CasualIndicLanguage {
  return normalizeLanguageLabel(language) in PACKS;
}

/** @deprecated Use isCasualIndicLanguage. */
export const isCasualSouthIndianLanguage = isCasualIndicLanguage;

/** The six regional languages that can occupy the third slot on a call. */
export const CASUAL_INDIC_LANGUAGES = Object.keys(PACKS) as CasualIndicLanguage[];

/** Packs still awaiting a native-speaker pass — surfaced in the studio UI. */
export const UNREVIEWED_INDIC_LANGUAGES = CASUAL_INDIC_LANGUAGES.filter(
  (language) => !PACKS[language].reviewed,
);

export function casualRegisterIsGendered(language: string | undefined): boolean {
  const pack = PACKS[normalizeLanguageLabel(language) as CasualIndicLanguage];
  return pack?.genderedFirstPerson ?? false;
}

/** Short mid-call nudge appended to language_update / control instructions. */
export function casualSpokenRegisterNudge(language: string | undefined): string {
  const label = normalizeLanguageLabel(language) as CasualIndicLanguage;
  const pack = PACKS[label];
  if (!pack) return "";

  const register = pack.registerName ? ` (${pack.registerName})` : "";
  return (
    ` Use casual spoken ${label} only${register} — how a phone agent talks, not textbook ${label}.` +
    ` Prefer: ${pack.prefer.join(", ")}.` +
    ` Never use formal/literary forms like: ${pack.avoid.join(", ")}.` +
    ` Keep sentences short and natural; mix light English loanwords only when natural on Indian calls (loan, confirm, meeting).`
  );
}

/**
 * Longer rules for studio script rewrite / system prompts — concrete do/don't
 * so the model does not emit hardcoded formal regional-language text.
 */
export function casualSpokenRegisterAuthoringRules(language: string | undefined): string {
  const label = normalizeLanguageLabel(language) as CasualIndicLanguage;
  const pack = PACKS[label];
  const nudge = casualSpokenRegisterNudge(label);
  if (!pack) return nudge;

  return [
    nudge,
    pack.genderedFirstPerson
      ? `First-person verbs in ${label} inflect for speaker gender — match the selected voice exactly.`
      : "",
    "Authoring examples (match this vibe, do not copy-paste blindly):",
    ...pack.examples.flatMap((example) => [
      `  Casual OK: "${example.ok}"`,
      `  Formal BAD: "${example.bad}"`,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Compact bullet for campaign systemPrompt language rules. */
export function casualSpokenRegisterSystemRule(language: string | undefined): string {
  const label = normalizeLanguageLabel(language) as CasualIndicLanguage;
  const pack = PACKS[label];
  if (!pack) return "";

  const register = pack.registerName ? ` (${pack.registerName})` : "";
  return (
    `- If language is ${label}, use casual spoken ${label}${register} only — phone-agent style with ` +
    `${pack.prefer.slice(0, 3).join(" / ")}. Never formal written ${label} (${pack.avoid.slice(0, 2).join(" / ")}).`
  );
}
