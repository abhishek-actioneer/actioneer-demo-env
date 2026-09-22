export type RuntimeControlIntent = "wait" | "stop" | "slow_down";

export interface RuntimeControlDetection {
  intent: RuntimeControlIntent;
  confidence: 2 | 3;
  evidence: string;
}

const RESUME_PATTERNS = [
  /\b(continue|you can continue|go ahead|carry on|proceed|start now)\b/u,
  /\b(haan continue|han continue|chaliye|aage badho|aage bolo|ab boliye|ab bolo)\b/u,
  /(जारी रखो|जारी रखिए|आगे बोलो|आगे बोलिए|अब बोलो|अब बोलिए)/u,
  /(ಮುಂದುವರಿಸಿ|ಮುಂದೆ ಮಾತಾಡಿ|ಈಗ ಮಾತಾಡಿ|ಮುಂದೆ ಹೇಳಿ)/u,
  /(కొనసాగించండి|ముందు చెప్పండి|ఇప్పుడు మాట్లాడండి|ముందుకు మాట్లాడండి)/u,
  /(தொடருங்கள்|இப்போ பேசுங்க|முன்னாடி சொல்லுங்க|தொடர்ந்து பேசுங்க)/u,
  /(ଜାରି ରଖନ୍ତୁ|ଆଗକୁ କହନ୍ତୁ|ଏବେ କୁହନ୍ତୁ)/u,
];

const STOP_PATTERNS = [
  /\b(stop|stop speaking|don't speak|dont speak|don't talk|dont talk)\b/u,
  /(बस|बंद करो|मत बोलो|मत बोलिए)/u,
  /(ನಿಲ್ಲಿ|ಸಾಕು|ಮಾತನಾಡಬೇಡಿ|ಬೇಡ ಮಾತನಾಡಬೇಡಿ)/u,
  /(ఆపు|చాలు|మాట్లాడొద్దు|ఇంకా మాట్లాడొద్దు)/u,
  /(நிறுத்து|போதும்|பேசாதே|பேசாதீங்க)/u,
  /(ଥାଅ|ବସ|କୁହନ୍ତୁ ନାହିଁ|ଆଉ କହନ୍ତୁ ନାହିଁ)/u,
];

const WAIT_DIRECT_PATTERNS = [
  /\b(wait|wait please|hold on|hold up|just a sec|just a second|just a minute|just a min|give me a minute|one (?:sec|second|minute|min)|stick around|pause)\b/u,
  /\b(ruko|ruko na|rukna|rukhna|thoda ruk|ruk jaiye|ruk jao|thahro|thahriye)\b/u,
  /(रुको|रुकिए|रुकना|रुक जाओ|रुक जाइए|ज़रा रुको|जरा रुको|ज़रा रुकिए|जरा रुकिए|ठहरो|ठहरिए)/u,
  /(ಸ್ವಲ್ಪ ತಾಳಿ|ಒಂದು ನಿಮಿಷ|ಸ್ವಲ್ಪ ಸಮಯ|ಕಾಯಿರಿ)/u,
  /(ఒక్క నిమిషం|కొంచెం ఆగండి|వెయిట్ చేయండి|కొద్దిసేపు ఆగండి)/u,
  /(ஒரு நிமிடம்|கொஞ்சம் காத்திரு|கொஞ்சம் காத்திருங்க|ஒரு நிமிஷம்)/u,
  /(ଗୋଟେ ମିନିଟ|ଅପେକ୍ଷା କରନ୍ତୁ|କିଛିଖଣ୍ଡ ରୁହନ୍ତୁ)/u,
];

const WAIT_CUE_PATTERNS = [
  /\b(wait|hold|ruko|ruk|later|baad)\b/u,
  /(रुको|रुकिए|ठहरो|ठहरिए|बाद में)/u,
  /(ತಾಳಿ|ಕಾಯಿ|ನಂತರ)/u,
  /(ఆగండి|వెయిట్|తర్వాత)/u,
  /(காத்திரு|காத்திருங்க|பிறகு)/u,
  /(ଅପେକ୍ଷା|ପରେ)/u,
];

const SLOW_PATTERNS = [
  /\b(?:please\s+)?(?:speak|talk|bolo|boliye)\s+(?:a\s+)?(?:bit\s+|little\s+)?slow(?:ly)?\b/u,
  /\b(?:speak|talk)\s+slow(?:ly)?\b/u,
  /\bslow(?:ly)?\s+(?:please\s+)?(?:speak|talk|bolo|boliye)\b/u,
  /\b(?:bit|little)\s+slow(?:ly)?\b/u,
  /\b(dheere|dhire)\s*(bolo|boliye|baat)?\b/u,
  /\baaram se\s*(bolo|boliye|baat)?\b/u,
  /(धीरे\s*(बोल|बोलिए|बोलो)|आहिस्ता\s*(बोल|बोलिए)?)/u,
];

const ROMANCE_ASR_SLOW_REJECT_RE =
  /\b(deus|que|te|mandou|meu|amor|você|voce|falar|pouquinho|não|nao|para|com)\b/iu;

const FILLER_DURATION_WAIT_PREFIX_RE =
  /^(?:(?:ah+|uh+|um+|hmm+|ha+|haan|han|ma|please|plz|sir|madam|bhai|anna)\s+){0,4}(?:one|1|two|2|ek|do|oru|rendu)\s*(?:min|mins|minute|minutes|minuti|minits|nimish|nimisham)\b/u;

const BARE_DURATION_ONLY_RE =
  /^(?:one|1|two|2|ek|do|oru|rendu)\s*(?:min|mins|minute|minutes|minuti|minits|nimish|nimisham)\b(?:\s+please)?$/u;

function normalizeControlText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMinuteDurationPhrase(text: string): boolean {
  const latin = /\b(?:one|1|two|2|ek|do|oru|rendu)\s*(?:min|mins|minute|minutes|minuti|minits|nimish|nimisham)\b/u;
  if (latin.test(text)) return true;

  return (
    /(एक|दो)\s*मिनट/u.test(text) ||
    /(ಒಂದು|ಎರಡು)\s*(ನಿಮಿಷ|ನಿಮಿಷಗಳು)/u.test(text) ||
    /(ఒక|రెండు)\s*(నిమిషం|నిమిషాలు)/u.test(text) ||
    /(ஒரு|இரண்டு)\s*(நிமிடம்|நிமிஷம்)/u.test(text) ||
    /(ଗୋଟେ|ଦୁଇ)\s*(ମିନିଟ|ମିନିଟ୍)/u.test(text)
  );
}

export function detectResumeIntent(text: string): boolean {
  const normalized = normalizeControlText(text);
  if (!normalized) return false;
  const tail = normalized.slice(-160);
  return RESUME_PATTERNS.some((pattern) => pattern.test(tail));
}

export function detectRuntimeControlIntent(text: string): RuntimeControlDetection | undefined {
  const normalized = normalizeControlText(text);
  if (!normalized) return undefined;

  const tail = normalized.slice(-160);
  if (STOP_PATTERNS.some((pattern) => pattern.test(tail))) {
    return { intent: "stop", confidence: 3, evidence: "stop_phrase" };
  }

  const hasResumeCue = detectResumeIntent(tail);
  const hasDirectWait = WAIT_DIRECT_PATTERNS.some((pattern) => pattern.test(tail));
  const hasDuration = hasMinuteDurationPhrase(tail);
  const hasWaitCue = WAIT_CUE_PATTERNS.some((pattern) => pattern.test(tail));
  const hasFillerDurationWait = FILLER_DURATION_WAIT_PREFIX_RE.test(tail);
  const hasBareDurationOnly = BARE_DURATION_ONLY_RE.test(tail);

  if (!hasResumeCue && (hasDirectWait || (hasDuration && (hasWaitCue || hasFillerDurationWait)))) {
    return {
      intent: "wait",
      confidence: 3,
      evidence: hasDirectWait ? "wait_phrase" : hasFillerDurationWait ? "wait_filler_duration_phrase" : "wait_duration_phrase",
    };
  }

  if (!hasResumeCue && hasDuration && hasBareDurationOnly) {
    return {
      intent: "wait",
      confidence: 2,
      evidence: "wait_bare_duration_phrase",
    };
  }

  if (ROMANCE_ASR_SLOW_REJECT_RE.test(tail)) {
    return undefined;
  }
  if (SLOW_PATTERNS.some((pattern) => pattern.test(tail))) {
    return { intent: "slow_down", confidence: 2, evidence: "slow_phrase" };
  }

  return undefined;
}
