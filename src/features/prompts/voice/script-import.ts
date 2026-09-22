export {
  buildVoiceScriptImportPrompt,
  MAX_IMPORT_NODES,
  MIN_IMPORT_NODES,
  VOICE_SCRIPT_IMPORT_SCHEMA,
  type ScriptImportPromptResult,
} from "@/lib/prompts/voice-script-import";
import { buildVoiceScriptImportPrompt } from "@/lib/prompts/voice-script-import";
import type { PromptModule } from "../types";

export const voiceScriptImportPromptModule: PromptModule<
  Parameters<typeof buildVoiceScriptImportPrompt>,
  ReturnType<typeof buildVoiceScriptImportPrompt>
> = {
  id: "voice.script-import",
  version: "1.0.0",
  owner: "voice",
  description:
    "Indexes an uploaded client voicebot script into a campaign workflow, copying spoken lines verbatim.",
  build: (input) => buildVoiceScriptImportPrompt(...input),
};
