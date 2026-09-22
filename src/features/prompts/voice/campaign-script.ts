export {
  buildVoiceCampaignScriptPrompt,
  type GeneratedVoiceAgentNarrative,
  type GeneratedVoiceWorkflow,
  type GeneratedVoiceWorkflowEdge,
  type GeneratedVoiceWorkflowNode,
  type ScriptDatasetContext,
  type ScriptPromptResult,
} from "@/lib/prompts/voice-campaign";
import { buildVoiceCampaignScriptPrompt } from "@/lib/prompts/voice-campaign";
import type { PromptModule } from "../types";

export const voiceCampaignScriptPromptModule: PromptModule<
  Parameters<typeof buildVoiceCampaignScriptPrompt>,
  ReturnType<typeof buildVoiceCampaignScriptPrompt>
> = {
  id: "voice.campaign-script",
  version: "1.0.0",
  owner: "voice",
  description: "Generates campaign script, first message, runtime system prompt, and workflow.",
  build: (input) => buildVoiceCampaignScriptPrompt(...input),
};
