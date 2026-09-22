export interface SarvamSpeaker {
  id: string;
  label: string;
  tier?: "Tier 1" | "Tier 2";
}

export const DEFAULT_SARVAM_SPEAKER = "priya";

export const SARVAM_SPEAKERS: SarvamSpeaker[] = [
  { id: "priya", label: "Priya", tier: "Tier 1" },
  { id: "ishita", label: "Ishita", tier: "Tier 1" },
  { id: "roopa", label: "Roopa", tier: "Tier 2" },
  { id: "pooja", label: "Pooja", tier: "Tier 2" },
  { id: "ritu", label: "Ritu" },
  { id: "neha", label: "Neha" },
  { id: "simran", label: "Simran" },
  { id: "kavya", label: "Kavya" },
  { id: "shreya", label: "Shreya" },
  { id: "tanya", label: "Tanya" },
  { id: "shruti", label: "Shruti" },
  { id: "suhani", label: "Suhani" },
  { id: "kavitha", label: "Kavitha" },
  { id: "rupali", label: "Rupali" },
  { id: "mani", label: "Mani", tier: "Tier 1" },
  { id: "shubh", label: "Shubh", tier: "Tier 2" },
  { id: "varun", label: "Varun", tier: "Tier 1" },
  { id: "sunny", label: "Sunny", tier: "Tier 2" },
  { id: "ratan", label: "Ratan", tier: "Tier 2" },
  { id: "rehan", label: "Rehan", tier: "Tier 2" },
  { id: "ashutosh", label: "Ashutosh", tier: "Tier 2" },
  { id: "aditya", label: "Aditya" },
  { id: "rahul", label: "Rahul" },
  { id: "rohan", label: "Rohan" },
  { id: "amit", label: "Amit" },
  { id: "dev", label: "Dev" },
  { id: "manan", label: "Manan" },
  { id: "sumit", label: "Sumit" },
  { id: "kabir", label: "Kabir" },
  { id: "aayan", label: "Aayan" },
  { id: "advait", label: "Advait" },
  { id: "anand", label: "Anand" },
  { id: "tarun", label: "Tarun" },
  { id: "gokul", label: "Gokul" },
  { id: "vijay", label: "Vijay" },
  { id: "mohit", label: "Mohit" },
  { id: "soham", label: "Soham" },
];

const SPEAKER_IDS = new Set(SARVAM_SPEAKERS.map((speaker) => speaker.id));

export function isSarvamSpeaker(value: string | undefined): value is string {
  return !!value && SPEAKER_IDS.has(value);
}

export function resolveSarvamSpeaker(value: string | undefined): string {
  if (isSarvamSpeaker(value)) return value;
  return DEFAULT_SARVAM_SPEAKER;
}

export function sarvamSpeakerLabel(value: string | undefined): string {
  const speaker = SARVAM_SPEAKERS.find((item) => item.id === value);
  return speaker?.label || value || "-";
}
