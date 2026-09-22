export {
  DEFAULT_CANDIDATE_GENERATOR_PROMPT,
  buildCandidateVoiceCampaignScriptPrompt,
  type PromptBenchCustomerContext,
} from "@/lib/prompts/voice-campaign-bench";
import { buildCandidateVoiceCampaignScriptPrompt } from "@/lib/prompts/voice-campaign-bench";
import type { PromptModule } from "../types";

export const voiceCampaignBenchPromptModule: PromptModule<
  Parameters<typeof buildCandidateVoiceCampaignScriptPrompt>[0],
  ReturnType<typeof buildCandidateVoiceCampaignScriptPrompt>
> = {
  id: "voice.campaign-bench",
  version: "1.0.0",
  owner: "voice",
  description: "Builds prompt-benchmark variants for voice campaign generation.",
  build: buildCandidateVoiceCampaignScriptPrompt,
};
