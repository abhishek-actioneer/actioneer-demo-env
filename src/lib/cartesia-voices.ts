export const DEFAULT_CARTESIA_VOICE_ID = "95d51f79-c397-46f9-b49a-23763d3eaa2d";
export const DEFAULT_CARTESIA_VOICE_NAME = "Arushi - Hinglish Speaker";

export interface CartesiaVoiceOption {
  id: string;
  name: string;
  description?: string;
  language?: string;
  previewFileUrl?: string;
  isPublic?: boolean;
  isOwner?: boolean;
}

export const DEFAULT_CARTESIA_VOICES: CartesiaVoiceOption[] = [
  {
    id: DEFAULT_CARTESIA_VOICE_ID,
    name: DEFAULT_CARTESIA_VOICE_NAME,
    description: "Hinglish female for bilingual content",
    language: "hi",
  },
];

export function cartesiaVoiceLabel(
  voiceId: string | undefined,
  voices: CartesiaVoiceOption[] = DEFAULT_CARTESIA_VOICES,
): string {
  if (!voiceId) return DEFAULT_CARTESIA_VOICE_NAME;
  return voices.find((voice) => voice.id === voiceId)?.name
    || (voiceId === DEFAULT_CARTESIA_VOICE_ID ? DEFAULT_CARTESIA_VOICE_NAME : voiceId);
}

export function voiceCharacterName(label: string | undefined): string {
  const trimmed = (label || DEFAULT_CARTESIA_VOICE_NAME).trim();
  const [name] = trimmed.split(/\s[-–—]\s/);
  return (name || trimmed).trim();
}
