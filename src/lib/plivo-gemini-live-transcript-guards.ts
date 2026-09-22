import { normalizeTranscriptText } from "./plivo-gemini-live-text-utils";

const AUTOMATED_SCREENING_PATTERNS = [
  /\bcall[-\s]?screen(?:ing|ed)\b/i,
  /\bscreening service\b/i,
  /\b(?:screened|transcribed|recorded) call\b/i,
  /\bperson (?:you are|you're) calling\b/i,
  /\b(?:will|may) receive (?:a )?transcript\b/i,
  /\btranscript of this call\b/i,
  /\bgoogle assistant\b/i,
  /\bassistant (?:will|is|can) (?:screen|connect|ask)\b/i,
  /\bvoicemail\b|\bvoice mail\b/i,
  /\bleave (?:a )?(?:brief )?message\b/i,
  /\bafter (?:the )?(?:tone|beep)\b/i,
  /\breason for (?:your )?call\b/i,
  /\b(?:state|say|tell us|tell me)\s+(?:your\s+)?name\b.{0,80}\b(?:reason|purpose)\b/i,
  /\bgo ahead and (?:say|tell|leave)\b.{0,80}\b(?:why|reason|message)\b/i,
];

export type RuntimeControlIntent = "wait" | "stop" | "slow_down";

export interface RuntimeControlDetection {
  intent: RuntimeControlIntent;
  confidence: 2 | 3;
  evidence: string;
}

export function detectRuntimeControlIntent(text: string): RuntimeControlDetection | undefined {
  const normalized = normalizeTranscriptText(text).toLowerCase();
  if (!normalized) return undefined;
  // Bounded tail scan keeps detection constant-time relative to turn length.
  const tail = normalized.slice(-120);
  const hasResumeCue = /\b(continue|go ahead|carry on|proceed|start now|ab bolo|ab boliye|aage bolo|aage boliye|ondu nimisha aaytu|okka nimisham aindi|oru nimisham aachu)\b/i.test(tail)
    || /(जारी रखो|जारी रखिए|आगे बोलो|आगे बोलिए|अब बोलो|अब बोलिए)/.test(tail)
    || /(ಮುಂದುವರಿಸಿ|ಮುಂದೆ ಮಾತಾಡಿ|ಈಗ ಮಾತಾಡಿ|ಮುಂದೆ ಹೇಳಿ)/.test(tail)
    || /(కొనసాగించండి|ముందు చెప్పండి|ఇప్పుడు మాట్లాడండి|ముందుకు మాట్లాడండి)/.test(tail)
    || /(தொடருங்கள்|இப்போ பேசுங்க|முன்னாடி சொல்லுங்க|தொடர்ந்து பேசுங்க)/.test(tail)
    || /(ଜାରି ରଖନ୍ତୁ|ଆଗକୁ କହନ୍ତୁ|ଏବେ କୁହନ୍ତୁ)/.test(tail);

  const stopPatterns = [
    /\b(stop|stop speaking|don't speak|dont speak|don't talk|dont talk)\b/,
    /\b(बस|बंद करो|मत बोलो|मत बोलिए)\b/,
    /(ನಿಲ್ಲಿ|ಸಾಕು|ಮಾತನಾಡಬೇಡಿ|ಬೇಡ ಮಾತನಾಡಬೇಡಿ)/,
    /(ఆపు|చాలు|మాట్లాడొద్దు|ఇంకా మాట్లాడొద్దు)/,
    /(நிறுத்து|போதும்|பேசாதே|பேசாதீங்க)/,
    /(ଥାଅ|ବସ|କୁହନ୍ତୁ ନାହିଁ|ଆଉ କହନ୍ତୁ ନାହିଁ)/,
  ];
  if (stopPatterns.some((pattern) => pattern.test(tail))) {
    return { intent: "stop", confidence: 3, evidence: "stop_phrase" };
  }

  const directWaitPatterns = [
    /\b(wait|wait please|hold on|hold up|just a sec|just a second|just a minute|just a min|give me a minute|one (?:sec|second|minute|min)|stick around|pause)\b/,
    /\b(ruko|ruko na|rukna|rukhna|thoda ruk|ruk jaiye|ruk jao|thahro|thahriye)\b/,
    /(रुको|रुकिए|रुकना|रुक जाओ|रुक जाइए|ज़रा रुको|जरा रुको|ज़रा रुकिए|जरा रुकिए|ठहरो|ठहरिए)/,
    /(ಸ್ವಲ್ಪ ತಾಳಿ|ಒಂದು ನಿಮಿಷ|ಸ್ವಲ್ಪ ಸಮಯ|ಕಾಯಿರಿ)/,
    /(ఒక్క నిమిషం|కొంచెం ఆగండి|వెయిట్ చేయండి|కొద్దిసేపు ఆగండి)/,
    /(ஒரு நிமிடம்|கொஞ்சம் காத்திரு|கொஞ்சம் காத்திருங்க|ஒரு நிமிஷம்)/,
    /(ଗୋଟେ ମିନିଟ|ଅପେକ୍ଷା କରନ୍ତୁ|କିଛିଖଣ୍ଡ ରୁହନ୍ତୁ)/,
  ];
  const hasDirectWait = directWaitPatterns.some((pattern) => pattern.test(tail));
  const hasTimeDuration = /\b(?:one|1|two|2|ek|do)\s*(?:min|mins|minute|minutes)\b/.test(tail)
    || /(एक|दो)\s*मिनट/.test(tail)
    || /(ಒಂದು|ಎರಡು)\s*(ನಿಮಿಷ|ನಿಮಿಷಗಳು)/.test(tail)
    || /(ఒక|రెండు)\s*(నిమిషం|నిమిషాలు)/.test(tail)
    || /(ஒரு|இரண்டு)\s*(நிமிடம்|நிமிஷம்)/.test(tail)
    || /(ଗୋଟେ|ଦୁଇ)\s*(ମିନିଟ|ମିନିଟ୍)/.test(tail);
  const hasWaitCueNearDuration = /\b(wait|hold|ruko|ruk|baad|later)\b/.test(tail)
    || /(रुको|रुकिए|ठहरो|ठहरिए|बाद में)/.test(tail)
    || /(ತಾಳಿ|ಕಾಯಿ|ನಂತರ)/.test(tail)
    || /(ఆగండి|వెయిట్|తర్వాత)/.test(tail)
    || /(காத்திரு|காத்திருங்க|பிறகு)/.test(tail)
    || /(ଅପେକ୍ଷା|ପରେ)/.test(tail);
  const durationWaitPatterns = [
    /\b(?:wait|hold|ruko|ruk|baad|later)\b.{0,16}\b(?:one|1|two|2|ek|do)\s*(?:min|mins|minute|minutes)\b/,
    /\b(?:one|1|two|2|ek|do)\s*(?:min|mins|minute|minutes)\b.{0,16}\b(?:wait|hold|ruko|ruk|baad|later)\b/,
    /(?:रुको|रुकिए|ठहरो|ठहरिए|बाद में).{0,16}(?:एक|दो)\s*मिनट/,
    /(?:एक|दो)\s*मिनट.{0,16}(?:रुको|रुकिए|ठहरो|ठहरिए|बाद में)/,
  ];
  const hasDurationWait = durationWaitPatterns.some((pattern) => pattern.test(tail))
    || (hasTimeDuration && hasWaitCueNearDuration);
  // Mixed utterances like "wait ... continue" are treated as resume intent, not hold.
  if (!hasResumeCue && (hasDirectWait || hasDurationWait)) {
    return {
      intent: "wait",
      confidence: 3,
      evidence: hasDurationWait ? "wait_duration_phrase" : "wait_phrase",
    };
  }

  // Require a speak/pace cue — bare "slowly" / Portuguese "mais slow" is not enough.
  // Reject Romance ASR garbles that happen to contain "slow".
  if (
    /\b(deus|que|te|mandou|meu|amor|você|voce|falar|pouquinho|não|nao|para|com)\b/i.test(tail)
  ) {
    return undefined;
  }
  const slowPatterns = [
    /\b(?:please\s+)?(?:speak|talk|bolo|boliye)\s+(?:a\s+)?(?:bit\s+|little\s+)?slow(?:ly)?\b/,
    /\b(?:speak|talk)\s+slow(?:ly)?\b/,
    /\bslow(?:ly)?\s+(?:please\s+)?(?:speak|talk|bolo|boliye)\b/,
    /\b(?:bit|little)\s+slow(?:ly)?\b/,
    /\b(dheere|dhire)\s*(bolo|boliye|baat)?\b/,
    /\baaram se\s*(bolo|boliye|baat)?\b/,
    /(धीरे\s*(बोल|बोलिए|बोलो)|आहिस्ता\s*(बोल|बोलिए)?)/,
  ];
  if (slowPatterns.some((pattern) => pattern.test(tail))) {
    return { intent: "slow_down", confidence: 2, evidence: "slow_phrase" };
  }

  return undefined;
}

export function detectResumeIntent(text: string): boolean {
  const normalized = normalizeTranscriptText(text).toLowerCase();
  if (!normalized) return false;
  const tail = normalized.slice(-120);
  const resumePatterns = [
    /\b(continue|you can continue|go ahead|carry on|proceed|start now)\b/,
    /\b(haan continue|han continue|chaliye|aage badho|aage bolo|ab boliye|ab bolo)\b/,
    /(जारी रखो|जारी रखिए|आगे बोलो|आगे बोलिए|अब बोलो|अब बोलिए)/,
    /(ಮುಂದುವರಿಸಿ|ಮುಂದೆ ಮಾತಾಡಿ|ಈಗ ಮಾತಾಡಿ|ಮುಂದೆ ಹೇಳಿ)/,
    /(కొనసాగించండి|ముందు చెప్పండి|ఇప్పుడు మాట్లాడండి|ముందుకు మాట్లాడండి)/,
    /(தொடருங்கள்|இப்போ பேசுங்க|முன்னாடி சொல்லுங்க|தொடர்ந்து பேசுங்க)/,
    /(ଜାରି ରଖନ୍ତୁ|ଆଗକୁ କହନ୍ତୁ|ଏବେ କୁହନ୍ତୁ)/,
  ];
  return resumePatterns.some((pattern) => pattern.test(tail));
}

export function shouldResumeFromUserSpeech(text: string): boolean {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;
  if (detectResumeIntent(normalized)) return true;
  if (isLowSignalTranscript(normalized) || isLikelyNoiseTranscript(normalized)) return false;

  const controlIntent = detectRuntimeControlIntent(normalized);
  if (controlIntent?.intent === "wait" || controlIntent?.intent === "stop") return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 3 || normalized.length >= 18;
}

export function mergeIncrementalTranscript(previous: string, incoming: string): string {
  const next = normalizeTranscriptText(incoming);
  if (!next) return previous;
  if (!previous) return next;
  if (next === previous) return previous;
  if (next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;

  const maxOverlap = Math.min(previous.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === next.slice(0, overlap)) {
      return `${previous}${next.slice(overlap)}`;
    }
  }
  return `${previous} ${next}`.replace(/\s+/g, " ").trim();
}

/**
 * Remove caller speech that leaked into the assistant output transcript
 * (echo / full-duplex ASR crosstalk). Keeps roles separated in the stored turn.
 */
export function stripUserCrosstalkFromAssistant(
  assistantText: string,
  userText: string,
): string {
  const assistant = normalizeTranscriptText(assistantText);
  const user = normalizeTranscriptText(userText);
  if (!assistant || !user || user.length < 4) return assistantText;

  const assistantLower = assistant.toLowerCase();
  const userLower = user.toLowerCase();
  const idx = assistantLower.indexOf(userLower);
  if (idx < 0) return assistantText;

  // Only strip when the user span is a clear contiguous leak, not a shared
  // function word that happens to appear in both turns.
  const userWords = userLower.split(/\s+/).filter(Boolean);
  if (userWords.length < 2 && user.length < 8) return assistantText;

  const stripped = `${assistant.slice(0, idx)} ${assistant.slice(idx + user.length)}`
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || assistantText;
}

/** True while the agent is mid-pitch and should stay protected from echo barge-in. */
export function shouldProtectPitchPlayback(params: {
  lastAssistantText: string;
  currentOutputBuffer: string;
}): boolean {
  const current = normalizeTranscriptText(params.currentOutputBuffer);
  const previous = normalizeTranscriptText(params.lastAssistantText);
  if (current && isIncompletePitchFragment(current)) return true;
  if (current && hasLoanPitchMarkers(current) && !/[?？]/.test(current)) return true;
  if (!current && previous && isIncompletePitchFragment(previous)) return true;
  return false;
}

/**
 * Any script a campaign can plausibly be delivered in: Latin (English),
 * Devanagari (Hindi/Hinglish), Odia, Tamil, Telugu, Kannada. A transcript
 * purely in one of these scripts is never "low signal" — confirmed regression:
 * "தமிழ்" (Tamil script) was silently dropped here because the old whitelist
 * only covered a-zA-Z + Devanagari, so the customer's reply never reached the
 * turn planner no matter how many times they repeated it.
 */
// Bengali (U+0980\u201309FF) was missing here until 2026-07-28 \u2014 the same defect the
// note above describes for Tamil, on a language that is equally selectable in
// the studio. A Bengali reply scored as low-signal and never reached the turn
// planner. Keep this list in step with CASUAL_INDIC_LANGUAGES.
const SUPPORTED_LANGUAGE_SCRIPT_RE =
  /[a-zA-Z0-9\u0900-\u097F\u0980-\u09FF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]/;

export function isLowSignalTranscript(value: string): boolean {
  const normalized = normalizeTranscriptText(value);
  if (!normalized) return true;
  if (!SUPPORTED_LANGUAGE_SCRIPT_RE.test(normalized)) return true;
  if (normalized.length === 1) return true;
  if (/^(uh+|um+|hmm+|mm+|ah+|er+|huh+|hm+)$/i.test(normalized)) return true;
  return false;
}

export function isLikelyNoiseTranscript(value: string): boolean {
  const normalized = normalizeTranscriptText(value);
  if (isLowSignalTranscript(normalized)) return true;

  // Mid-call "Ah, bit slowly" is short too — dropping it as noise means no turn plan.
  if (detectRuntimeControlIntent(normalized)) return false;
  // One/two-word customer replies ("haan", "mil gaya", "theek hai") must stay live —
  // dropping them leaves the agent muted with nothing to answer (dry call).
  if (hasShortConversationalReplySignal(normalized)) return false;

  const hasIndic = /[\u0900-\u097F]/.test(normalized);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (hasIndic) {
    const hasLikelyIntentSignal = /(अभी|बाद|कॉल|व्यस्त|बात|सुन|बोल|रहा|रही|हूँ|है|कौन|क्यों|कर|चाहिए)/.test(normalized);
    if (hasLikelyIntentSignal) return false;
    // Avoid accepting random short Indic fragments as valid turns.
    if (words.length <= 2 && normalized.length <= 12) return true;
    return false;
  }

  if (words.length <= 3 && normalized.length < 28) return true;
  if (words.length <= 4 && normalized.length < 40) return true;

  return false;
}

const REPLY_LIKE_RE =
  /\b(haan|han|haaji|haanji|ji|theek|thik|accha|achha|ok|okay|yes|yeah|yep|no|nahi|nahin|nope|mil\s*gaya|mil\s*gayi|nahi\s*mila|sahi|galat|correct|wrong|sure|fine|done|bilkul|zaroor|maybe|shayad|baad(?:\s*mein|\s*me)?|later|callback|call\s*back|sun[oó]|bolo|boliye|batao|bataiye|hello|hi|hey|helo|hii|hola|namaste|namaskar|good\s*morning|good\s*afternoon|good\s*evening)\b/i;
const REPLY_LIKE_INDIC_RE =
  /(हाँ|हां|जी|ठीक|अच्छा|नहीं|नही|मिल गया|मिल गई|नहीं मिला|सही|गलत|बिल्कुल|ज़रूर|शायद|बाद|सुन|बोल|बता|नमस्ते|नमस्कार|हैलो|हेलो|मैडम|सर|जी\s*बोलिए)/;

/** Short customer answers that must never be treated as noise / out-of-domain. */
export function hasShortConversationalReplySignal(value: string): boolean {
  const normalized = normalizeTranscriptText(value);
  if (!normalized) return false;
  return REPLY_LIKE_RE.test(normalized) || REPLY_LIKE_INDIC_RE.test(normalized);
}

/** True when the last agent turn looks like a question / confirm the customer should answer. */
export function lastAssistantAskedQuestion(lastAssistantText: string): boolean {
  const normalized = normalizeTranscriptText(lastAssistantText);
  if (!normalized) return false;
  if (/[?？]/.test(normalized)) return true;
  const tail = normalized.slice(-96);
  return (
    /\b(kya|hai|hain|mil gaya|mil gayi|baat|sakti|sakte|payegi|payega|karenge|karogi|hogi|hoga)\b/i.test(tail) ||
    /(है|हैं|क्या|गया|गई|सकते|सकती|पाएगी|पाएगा|करेंगे|होगी|होगा)\s*$/.test(tail) ||
    /\bkya\b/i.test(tail) ||
    /क्या/.test(tail)
  );
}

function hasReplyLikeSignal(normalized: string): boolean {
  if (hasShortConversationalReplySignal(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  // Short answers after a question are usually the customer, not TV chatter.
  if (words.length <= 5 && normalized.length <= 36) return true;
  return false;
}

const TOPIC_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "was", "were",
  "this", "that", "with", "you", "your", "me", "my", "we", "our", "i", "it", "at", "from",
  "hai", "hain", "kya", "main", "aap", "se", "ko", "ki", "ka", "ke", "mein", "me", "ho",
  "tha", "thi", "the", "aur", "ya", "nahi", "haan",
]);

function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeTranscriptText(text).toLowerCase().split(/\s+/)) {
    const token = raw.replace(/[^a-z0-9\u0900-\u097f]/gi, "");
    if (token.length < 4) continue;
    if (TOPIC_STOP_WORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

function hasTopicOverlap(userText: string, assistantText: string): boolean {
  const userTokens = significantTokens(userText);
  if (userTokens.size === 0) return false;
  const assistantTokens = significantTokens(assistantText);
  for (const token of userTokens) {
    if (assistantTokens.has(token)) return true;
  }
  return false;
}

/**
 * True when the customer-side transcript looks like background TV / nearby talk
 * rather than an answer to the agent's last question. Short replies, language
 * choices, and control intents are never treated as ambient.
 */
export function isLikelyNonAddressedAmbientTranscript(
  userText: string,
  lastAssistantText: string,
): boolean {
  const normalized = normalizeTranscriptText(userText);
  if (!normalized) return false;
  if (detectRuntimeControlIntent(normalized)) return false;
  if (detectResumeIntent(normalized)) return false;
  if (!lastAssistantAskedQuestion(lastAssistantText)) return false;
  if (hasReplyLikeSignal(normalized)) return false;
  if (hasTopicOverlap(normalized, lastAssistantText)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  // Only reject longer free-speech that has no reply markers after a question.
  if (words.length < 6 && normalized.length < 40) return false;
  return true;
}

/**
 * Whether noise filtering may interrupt/drop model audio.
 * Mid-call dry calls happen when a low-signal blip arms ambient_noise drop
 * right as Gemini is answering the customer — never do that while we are
 * waiting for / just heard an answer to the agent's question.
 */
export function shouldArmAmbientModelAudioDrop(params: {
  muteActive?: boolean;
  recoveryProtected?: boolean;
  awaitingCustomer?: boolean;
  lastAssistantText?: string;
  msSinceMeaningfulUserSpeech?: number;
}): boolean {
  if (params.muteActive || params.recoveryProtected) return false;
  if (params.awaitingCustomer) return false;
  // No assistant turn has been committed yet — we are still inside the opening
  // line, so there is no ambient-triggered reply to suppress. Arming the guard
  // here sets dropModelAudioUntilTurnComplete, and localBargeInAllowedNow()
  // refuses every barge-in while that is set. Confirmed on call
  // vc-test-...-uotur: the end-of-greeting flush ran with an empty transcript
  // ~20ms BEFORE turn_complete, so neither the awaitingCustomer check above nor
  // the askedQuestion check below could see the state that would have blocked
  // it, and barge-in stayed dead for the next 10.7s.
  if (!params.lastAssistantText?.trim()) return false;
  if (lastAssistantAskedQuestion(params.lastAssistantText)) {
    return false;
  }
  if (
    params.msSinceMeaningfulUserSpeech !== undefined &&
    params.msSinceMeaningfulUserSpeech >= 0 &&
    params.msSinceMeaningfulUserSpeech < 8_000
  ) {
    return false;
  }
  return true;
}

export function isOutOfDomainTranscript(value: string): boolean {
  const normalized = normalizeTranscriptText(value);
  if (!normalized) return true;

  if (detectRuntimeControlIntent(normalized)) return false;
  // Short yes/no / confirm replies must reach the turn planner — the old
  // "<=3 words / <22 chars" fallback treated "haan"/"yes"/"mil gaya" as junk
  // and left the call dead after the agent asked a question.
  if (hasShortConversationalReplySignal(normalized)) return false;

  // Scripts outside our supported set (Latin + Devanagari + Telugu + Kannada + Odia + Tamil)
  // are usually ASR hallucinations for this product's language scope.
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(normalized)) return true; // Hangul
  if (/[\u0600-\u06ff\u0750-\u077f]/.test(normalized)) return true; // Arabic
  if (/[\u0400-\u04ff]/.test(normalized)) return true; // Cyrillic
  if (/[\u4e00-\u9fff]/.test(normalized)) return true; // CJK

  const words = normalized.split(/\s+/).filter(Boolean);
  const controlIntent = detectRuntimeControlIntent(normalized);
  const resumeIntent = detectResumeIntent(normalized);

  // Short utterances without any control/reply signal are usually unreliable
  // partials in telephony conditions; don't let them drive state transitions.
  // hasShortConversationalReplySignal above already exempts real short replies.
  if (!controlIntent && !resumeIntent && words.length <= 3 && normalized.length < 22) {
    return true;
  }

  return false;
}

export function isLikelyAutomatedScreeningMessage(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 24) return false;

  if (AUTOMATED_SCREENING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const asksForName = /\b(?:please\s+)?(?:state|say|tell us|tell me)\s+(?:your\s+)?name\b/i.test(normalized);
  const asksForReason = /\b(?:reason|purpose|why|what).{0,40}\b(?:calling|call is about|called)\b/i.test(normalized);
  return asksForName && asksForReason && normalized.length >= 40;
}

/** Collapse whitespace/punct for pitch-restart comparisons (Hindi + Latin). */
export function normalizeForPitchCompare(text: string): string {
  // Keep \p{M} (matras / combining marks) — stripping them splits Devanagari
  // words ("लोन" → "ल न") and breaks restart detection.
  return normalizeTranscriptText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOAN_PITCH_MARKER_RE =
  /(आपका\s+लोन|your\s+loan|aapka\s+loan|\bloan\b|लोन|रिसेंटली|recently|disburse|डिस्बर्स|डिस्बर्स|एक्स्ट्रा\s*फंड|extra\s+fund)/i;

const SOFT_PITCH_RESTATE_RE =
  /(मैं कह रही थी|मैं कह रहा था|जैसा मैं|as i was saying|let me (?:start|begin) again|हाँ[, ]?तो मैं|हां[, ]?तो मैं|to (?:main|mein) keh)/i;

const LOAN_PITCH_OVERLAP_TOKENS = [
  "लोन",
  "loan",
  "रिसेंटली",
  "recently",
  "disburse",
  "डिस्बर्स",
  "डिस्बर्स",
];

export function hasLoanPitchMarkers(text: string): boolean {
  return LOAN_PITCH_MARKER_RE.test(normalizeTranscriptText(text));
}

export function isSoftPitchRestate(text: string): boolean {
  return SOFT_PITCH_RESTATE_RE.test(normalizeTranscriptText(text));
}

function sharedLoanPitchToken(prev: string, curr: string): boolean {
  return LOAN_PITCH_OVERLAP_TOKENS.some(
    (token) => prev.includes(token.toLowerCase()) && curr.includes(token.toLowerCase()),
  );
}

/**
 * True when `next` is restarting the same opening as `previous` instead of
 * continuing mid-sentence. Catches Gemini splitting a pitch across turns and
 * regenerating from "आपका लोन…" (or soft-restating after a mid-phrase fragment).
 *
 * Important: a short stub that the next turn *extends*, or a mid-phrase pickup
 * like "रिसेंटली डिस्बर्स…" after "आपका लोन रिसेंटली डिस्बर्स…", is a
 * continuation — cutting those causes the audible stop→restart stutter.
 */
export function looksLikeAssistantPitchRestart(previous: string, next: string): boolean {
  const prev = normalizeForPitchCompare(previous);
  const curr = normalizeForPitchCompare(next);
  if (!prev || !curr) return false;
  if (prev.length < 8) return false;
  // Wait until the new turn has enough text to judge (avoid false cuts on "आप").
  if (curr.length < 10) return false;

  const prevTokens = prev.split(" ").filter(Boolean);
  const currTokens = curr.split(" ").filter(Boolean);
  if (prevTokens.length < 2 || currTokens.length < 2) return false;

  // Short opener stubs that the next turn extends — let them play.
  // ("आपका लोन" / "आपका लोन रिसेंटली" → longer continuation)
  if (prevTokens.length <= 3 && curr.startsWith(prev) && curr.length > prev.length) {
    return false;
  }

  // Mid-phrase pickup: next starts with a contiguous token span already in previous
  // ("…रिसेंटली डिस्बर्स हुआ था…" → "रिसेंटली डिस्बर्स हुआ था, इसलिए…").
  const currHead3 = currTokens.slice(0, Math.min(3, currTokens.length)).join(" ");
  if (
    currHead3.length >= 8 &&
    prev.includes(currHead3) &&
    !/^(आपका\s+लोन|your\s+loan|aapka\s+loan)/i.test(curr)
  ) {
    return false;
  }

  const prevIsLoanPitch = hasLoanPitchMarkers(prev);
  const currIsLoanPitch = hasLoanPitchMarkers(curr);
  const softRestate = isSoftPitchRestate(next);
  const prevIncomplete = isIncompletePitchFragment(previous);

  // Soft restate after a short/incomplete loan-pitch chunk — cut as soon as
  // "हाँ, तो मैं कह रही थी…" appears, even before "आपका लोन" re-enters the buffer.
  if (prevIsLoanPitch && prevIncomplete && softRestate && curr.length >= 12) {
    return true;
  }

  // Regenerating from the loan opener (or soft-restating) after a loan-pitch chunk.
  // Do NOT cut merely because tokens overlap — mid-phrase continuations share tokens.
  if (
    prevIsLoanPitch &&
    currIsLoanPitch &&
    curr.length > prev.length + 10
  ) {
    const currRestartsLoanOpener =
      /^(आपका\s+लोन|your\s+loan|aapka\s+loan)/i.test(curr) ||
      /(कि\s+आपका\s+लोन|that your\s+loan)/i.test(curr);
    if (currRestartsLoanOpener && (softRestate || prevIncomplete || sharedLoanPitchToken(prev, curr))) {
      return true;
    }
    if (softRestate && sharedLoanPitchToken(prev, curr)) {
      return true;
    }
  }

  // Classic case: previous opened with "आपका लोन…" and next regenerates from there.
  const prevLooksLikeLoanPitchOpen =
    /^(आपका\s+लोन|your\s+loan|aapka\s+loan)/i.test(prev) ||
    /^आपका\s+लोन/u.test(prev);
  if (!prevLooksLikeLoanPitchOpen) return false;

  // Same opening 2 tokens + previous was a short fragment + next is longer
  // ("आपका लोन रिसेंटली" → "आपका लोन अभी रिसेंटली…") even when word 3 differs.
  const prevHead2 = prevTokens.slice(0, 2).join(" ");
  const currHead2 = currTokens.slice(0, 2).join(" ");
  if (
    prevHead2 === currHead2 &&
    prevTokens.length <= 5 &&
    curr.length > prev.length + 5
  ) {
    return true;
  }

  const take = Math.min(prevTokens.length, 4);
  const prevHead = prevTokens.slice(0, take).join(" ");
  const currHead = currTokens.slice(0, take).join(" ");
  if (prevHead === currHead && take >= 2 && curr.length > prev.length + 3) return true;

  // Extending the exact previous fragment from the start.
  if (curr.startsWith(prev) && curr.length > prev.length + 3) return true;

  const sharedPrefixLen = Math.min(prev.length, 20);
  if (
    sharedPrefixLen >= 10 &&
    curr.startsWith(prev.slice(0, sharedPrefixLen)) &&
    curr.length > prev.length + 3
  ) {
    return true;
  }

  return false;
}

/**
 * True when the model restates essentially the same completed assistant turn
 * (same opener + similar length). Common after echo barge-in / ClearedAudio
 * free-wheels a second generation of the same semantic reply.
 */
export function looksLikeDuplicateAssistantRestate(previous: string, next: string): boolean {
  const prev = normalizeForPitchCompare(previous);
  const curr = normalizeForPitchCompare(next);
  if (!prev || !curr) return false;
  if (prev.length < 40 || curr.length < 40) return false;
  if (prev === curr) return true;

  const lengthDelta = Math.abs(prev.length - curr.length);
  const maxLen = Math.max(prev.length, curr.length);
  if (lengthDelta > Math.max(60, maxLen * 0.25)) return false;

  const prefixLen = Math.min(72, prev.length, curr.length);
  if (prefixLen >= 40 && prev.slice(0, prefixLen) === curr.slice(0, prefixLen)) {
    return true;
  }

  const prevTok = prev.split(" ").filter(Boolean).slice(0, 14);
  const currTok = curr.split(" ").filter(Boolean).slice(0, 14);
  if (prevTok.length >= 7 && currTok.length >= 7) {
    let shared = 0;
    for (let i = 0; i < Math.min(prevTok.length, currTok.length); i++) {
      if (prevTok[i] === currTok[i]) shared += 1;
      else break;
    }
    if (shared >= 7) return true;
  }

  return false;
}

/**
 * Whether we should actually cut audio for a detected pitch restart.
 * Never cut while we are mid pitch_continuation — that response is supposed
 * to finish the incomplete fragment and often regenerates from its opener.
 * Also never cut while the last assistant turn is still an incomplete pitch
 * awaiting continuation (Gemini often auto-continues before our nudge lands).
 */
export function shouldCutAssistantPitchRestart(params: {
  previous: string;
  next: string;
  instructionReason: string;
}): boolean {
  if (params.instructionReason === "pitch_continuation") return false;
  if (isIncompletePitchFragment(params.previous) && !isSoftPitchRestate(params.next)) {
    // Incomplete pitch + non-soft-restate next turn = let continuation play.
    if (!looksLikeAssistantPitchRestart(params.previous, params.next)) return false;
    // Even if detector fires, prefer not cutting mid-phrase pickups while incomplete.
    const curr = normalizeForPitchCompare(params.next);
    if (!/^(आपका\s+लोन|your\s+loan|aapka\s+loan|हाँ|हां|haan)/i.test(curr)) {
      return false;
    }
  }
  return looksLikeAssistantPitchRestart(params.previous, params.next);
}

/**
 * True when input ASR is echoing the agent's own pitch (speakerphone / full-duplex).
 * Example from logs: agent said Hindi pitch → user transcript "Aapka loan recently disburse hua tha."
 */
export function looksLikeAssistantEchoInUserTranscript(
  userText: string,
  assistantText: string,
): boolean {
  const user = normalizeForPitchCompare(userText);
  const assistant = normalizeForPitchCompare(assistantText);
  if (!user || !assistant || user.length < 12) return false;

  if (assistant.includes(user) || user.includes(assistant.slice(0, Math.min(48, assistant.length)))) {
    return true;
  }

  const userLooksLikePitch =
    hasLoanPitchMarkers(user) &&
    /(loan|लोन).{0,48}(disburse|डिस्बर्स|recently|रिसेंटली|recently)/i.test(userText);
  if (
    userLooksLikePitch &&
    hasLoanPitchMarkers(assistant) &&
    (isIncompletePitchFragment(assistantText) || assistant.length >= 24)
  ) {
    return true;
  }

  return false;
}

/**
 * Short mid-phrase assistant fragment that still needs a continuation
 * (e.g. "आपका लोन रिसेंटली" or "अभी रिसेंटली disburse…" before the funds question).
 */
export function isIncompletePitchFragment(text: string): boolean {
  const raw = normalizeTranscriptText(text);
  if (!raw) return false;
  if (/[?？]/.test(raw)) return false;
  // Completed funds-need question — not incomplete.
  if (/(क्या|what|okay\?|will that)/i.test(raw) && raw.length >= 40) return false;
  // Already a full sentence with terminal punctuation and enough length.
  if (/[.।!]$/.test(raw) && raw.length >= 60) return false;

  const loanPitchStart =
    /^(आपका\s+लोन|your\s+loan|aapka\s+loan)/i.test(raw) ||
    /^आपका\s+लोन/u.test(raw);
  if (loanPitchStart && raw.length < 90) return true;

  // Mid-phrase chunk (ASR/transcript often drops the opening "आपका लोन").
  // Require loan markers — do NOT treat generic stubs like "जी, मैं" as pitch.
  if (hasLoanPitchMarkers(raw) && raw.length < 90) return true;

  // Opening YES often starts "जी, आपका…" then turnComplete fires before the
  // loan pitch lands — treat that stub as incomplete so we nudge continuation.
  if (
    /^(जी|हाँ|हां|haan|ji)[,.\s]+(आपका|aapka|your)(?:\s|$)/iu.test(raw) &&
    raw.length < 40 &&
    !/[?？]/.test(raw)
  ) {
    return true;
  }

  return false;
}

/**
 * True when a semantic-resolution reply was cut mid-utterance (pitch or otherwise).
 * Catches stubs like "समझी। 2" before "समझी। 2 करोड़…".
 */
export function isIncompleteSemanticReply(text: string): boolean {
  if (isIncompletePitchFragment(text)) return true;
  const raw = normalizeTranscriptText(text);
  if (!raw) return false;
  if (/[?？]$/.test(raw)) return false;
  if (raw.length >= 80 && /[.।!]$/.test(raw)) return false;
  // Cut off on a digit / amount fragment.
  if (/\d\s*$/.test(raw) && raw.length < 40) return true;
  // Very short ack without finishing the thought.
  if (raw.length < 28 && !/[.।!]/.test(raw.slice(-1))) return true;
  if (raw.length < 20) return true;
  return false;
}

/**
 * Short non-pitch stub left after barge-in / clear_playback raced turnComplete
 * (e.g. "Confirm karne", "Aage badhne", "Sunke achha laga,").
 * These must NOT use "continue from the next word" — that creates audible stutter.
 */
export function isBargeInCutStub(text: string): boolean {
  if (isIncompletePitchFragment(text)) return false;
  const raw = normalizeTranscriptText(text);
  if (!raw) return false;
  if (/[?？]$/.test(raw)) return false;
  if (/[.।!]$/.test(raw) && raw.length >= 28) return false;
  // Trailing comma / bare mid-phrase cut.
  if (raw.length <= 48 && /[,;:]$/.test(raw)) return true;
  // Short fragment without sentence end (log cases: "Confirm karne", "Aage badhne").
  if (raw.length <= 40 && !/[.।!]/.test(raw.slice(-1))) return true;
  return false;
}

/**
 * Strip the already-spoken prefix from the scripted full pitch so continuation
 * can exact-say only the remaining words (avoids "रिसेंटली डिस्बर्स" overlap stutter).
 */
export function pitchRemainderAfterSaid(fullPitch: string, alreadySaid: string): string {
  const full = normalizeTranscriptText(fullPitch);
  const said = normalizeTranscriptText(alreadySaid);
  if (!full) return "";
  if (!said) return full;

  const fullTokens = full.split(/\s+/).filter(Boolean);
  const saidTokens = said.split(/\s+/).filter(Boolean);
  if (fullTokens.length === 0) return "";

  let matched = 0;
  for (let i = 0; i < Math.min(fullTokens.length, saidTokens.length); i++) {
    const a = normalizeForPitchCompare(fullTokens[i] ?? "");
    const b = normalizeForPitchCompare(saidTokens[i] ?? "");
    if (!a || !b) break;
    if (a === b || a.startsWith(b) || b.startsWith(a)) {
      matched = i + 1;
      continue;
    }
    break;
  }

  // If prefix match failed, find the longest said-token tail that appears in full.
  if (matched === 0 && saidTokens.length >= 2) {
    for (let take = Math.min(4, saidTokens.length); take >= 2; take -= 1) {
      const tail = saidTokens.slice(-take).map((t) => normalizeForPitchCompare(t));
      for (let i = 0; i <= fullTokens.length - take; i++) {
        const window = fullTokens.slice(i, i + take).map((t) => normalizeForPitchCompare(t));
        const ok = tail.every((tok, idx) => {
          const ft = window[idx] ?? "";
          return tok === ft || tok.startsWith(ft) || ft.startsWith(tok);
        });
        if (ok) {
          matched = i + take;
          break;
        }
      }
      if (matched > 0) break;
    }
  }

  if (matched <= 0) return full;
  if (matched >= fullTokens.length) return "";
  return fullTokens.slice(matched).join(" ").trim();
}

export function buildPitchContinuationInstruction(
  alreadySaid: string,
  fullPitch?: string,
): string {
  const snippet = normalizeTranscriptText(alreadySaid).slice(0, 80);
  const remainder = fullPitch ? pitchRemainderAfterSaid(fullPitch, alreadySaid) : "";
  if (remainder && remainder.length >= 8) {
    return [
      "Your previous reply was cut off mid-sentence.",
      "Do NOT repeat anything the customer already heard.",
      "Do NOT say filler like 'hello can you hear me' or 'as I was saying'.",
      "Say exactly this next, nothing more, then stop and wait:",
      remainder,
    ].join(" ");
  }
  return [
    "Continue from where you left off in the same language.",
    "Do NOT restart the current scripted step from the beginning.",
    "Do NOT say filler like 'hello can you hear me' or 'as I was saying'.",
    `The customer already heard exactly: "${snippet}${alreadySaid.length > 80 ? "…" : ""}".`,
    "Your next spoken words must start AFTER that phrase — do not repeat any word they already heard.",
    "Finish the current Campaign-script step only, then stop and wait. Do not invent a different product pitch.",
  ].join(" ");
}

export function buildSemanticContinuationInstruction(alreadySaid: string, language?: string): string {
  const snippet = normalizeTranscriptText(alreadySaid).slice(0, 60);
  const languageLock = language
    ? ` Speak only in ${language}.`
    : "";
  // Barge-in / clear_playback often leaves a 1–4 word stub. Asking the model to
  // "continue from the next word" produces "Confirm karne" + "ke liye dhanyavaad…"
  // stutter. Discard the stub and answer cleanly instead.
  if (isBargeInCutStub(alreadySaid)) {
    return [
      "Your previous spoken reply was cut off and must be discarded.",
      "Do NOT continue that fragment. Do NOT repeat those cut-off words.",
      "Give one complete short reply to the customer's latest answer now, then stop and wait.",
      languageLock,
    ].filter(Boolean).join(" ");
  }
  return [
    "Your previous reply was cut off mid-sentence.",
    `You already said: "${snippet}${alreadySaid.length > 60 ? "…" : ""}".`,
    "Continue from the next word only — do not repeat those words.",
    "Finish the same thought in one short continuation, then stop.",
    languageLock,
  ].filter(Boolean).join(" ");
}
