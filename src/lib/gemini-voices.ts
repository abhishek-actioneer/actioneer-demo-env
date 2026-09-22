export interface GeminiVoice {
  name: string;
  displayName: string;
  gender: "female" | "male";
  description: string;
}

export const GEMINI_VOICES: GeminiVoice[] = [
  { name: "Zephyr", displayName: "Aanya", gender: "female", description: "Bright" },
  { name: "Kore", displayName: "Kiara", gender: "female", description: "Firm" },
  { name: "Orus", displayName: "Rohan", gender: "male", description: "Firm" },
  { name: "Autonoe", displayName: "Isha", gender: "female", description: "Bright" },
  { name: "Umbriel", displayName: "Kabir", gender: "male", description: "Easy-going" },
  { name: "Erinome", displayName: "Meera", gender: "female", description: "Clear" },
  { name: "Laomedeia", displayName: "Kavya", gender: "female", description: "Upbeat" },
  { name: "Schedar", displayName: "Dev", gender: "male", description: "Even" },
  { name: "Achird", displayName: "Arjun", gender: "male", description: "Friendly" },
  { name: "Sadachbia", displayName: "Shaan", gender: "male", description: "Lively" },
  { name: "Puck", displayName: "Aarav", gender: "male", description: "Upbeat" },
  { name: "Fenrir", displayName: "Vivaan", gender: "male", description: "Excitable" },
  { name: "Aoede", displayName: "Ananya", gender: "female", description: "Breezy" },
  { name: "Enceladus", displayName: "Ishaan", gender: "male", description: "Breathy" },
  { name: "Algieba", displayName: "Advait", gender: "male", description: "Smooth" },
  { name: "Algenib", displayName: "Rudra", gender: "male", description: "Gravelly" },
  { name: "Achernar", displayName: "Diya", gender: "female", description: "Soft" },
  { name: "Gacrux", displayName: "Nandita", gender: "female", description: "Mature" },
  { name: "Zubenelgenubi", displayName: "Karan", gender: "male", description: "Casual" },
  { name: "Sadaltager", displayName: "Varun", gender: "male", description: "Knowledgeable" },
  { name: "Charon", displayName: "Aditya", gender: "male", description: "Informative" },
  { name: "Leda", displayName: "Rhea", gender: "female", description: "Youthful" },
  { name: "Callirrhoe", displayName: "Siya", gender: "female", description: "Easy-going" },
  { name: "Iapetus", displayName: "Neil", gender: "male", description: "Clear" },
  { name: "Despina", displayName: "Mira", gender: "female", description: "Smooth" },
  { name: "Rasalgethi", displayName: "Rahul", gender: "male", description: "Informative" },
  { name: "Alnilam", displayName: "Vikram", gender: "male", description: "Firm" },
  { name: "Pulcherrima", displayName: "Sana", gender: "female", description: "Forward" },
  { name: "Vindemiatrix", displayName: "Anika", gender: "female", description: "Gentle" },
  { name: "Sulafat", displayName: "Priya", gender: "female", description: "Warm" },
];

export const DEFAULT_GEMINI_VOICE = "Aoede";

export function getGeminiVoice(name: string): GeminiVoice | undefined {
  return GEMINI_VOICES.find((v) => v.name.toLowerCase() === name.toLowerCase());
}

export function normalizeGeminiVoiceName(name: string | undefined): string | undefined {
  const candidate = name?.trim();
  if (!candidate) return undefined;
  const byName = getGeminiVoice(candidate);
  if (byName) return byName.name;
  const byDisplayName = GEMINI_VOICES.find((voice) =>
    voice.displayName.toLowerCase() === candidate.toLowerCase()
  );
  return byDisplayName?.name;
}

export function geminiVoiceGender(name: string): "female" | "male" | "unknown" {
  return getGeminiVoice(name)?.gender ?? "unknown";
}

export function geminiVoiceDisplayName(name: string): string {
  return getGeminiVoice(name)?.displayName ?? name;
}

export function geminiVoiceGenderLabel(name: string): "Female" | "Male" | "Unknown" {
  const gender = geminiVoiceGender(name);
  if (gender === "female") return "Female";
  if (gender === "male") return "Male";
  return "Unknown";
}

export function geminiPreviewText(gender: "female" | "male", language: string): string {
  const lang = language.trim().toLowerCase();
  if (lang === "english") {
    return gender === "female"
      ? "Hi, I'm calling from Vastu Housing Finance. Do you have a minute to talk?"
      : "Hi, I'm calling from Vastu Housing Finance. Do you have a minute to talk?";
  }
  return gender === "female"
    ? "haan ji, main Vastu Housing Finance se call kar rahi hoon. Kya aap ek minute baat kar sakte hain?"
    : "haan ji, main Vastu Housing Finance se call kar raha hoon. Kya aap ek minute baat kar sakte hain?";
}
