export {
  buildVoiceIntakePrompt,
  VOICE_INTAKE_SCHEMA,
  type VoiceIntakePromptInput,
  type VoiceIntakeResult,
} from "@/lib/prompts/voice-intake";
import { buildVoiceIntakePrompt } from "@/lib/prompts/voice-intake";
import type { PromptModule } from "../types";

export const voiceIntakePromptModule: PromptModule<
  Parameters<typeof buildVoiceIntakePrompt>,
  ReturnType<typeof buildVoiceIntakePrompt>
> = {
  id: "voice.intake",
  version: "1.0.0",
  owner: "voice",
  description:
    "Pass 0 intake: classifies a voice-campaign request into mode, archetype, languages, known facts, and open questions before generation.",
  build: (input) => buildVoiceIntakePrompt(...input),
};
