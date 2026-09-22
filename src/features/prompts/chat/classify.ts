import { buildClassifyPrompt as buildLegacyClassifyPrompt } from "@/lib/prompts/classify";
import type { PromptModule } from "../types";

export interface ClassifyPromptInput {
  suggestedPrompts?: string[];
  segmentEntityContext?: string;
}

export function buildClassifyPrompt(
  suggestedPrompts?: string[],
  segmentEntityContext?: string,
): string {
  return buildLegacyClassifyPrompt("", suggestedPrompts, undefined, undefined, segmentEntityContext);
}

export const classifyPromptModule: PromptModule<ClassifyPromptInput, string> = {
  id: "chat.classify",
  version: "1.0.0",
  owner: "chat",
  description: "Classifies user messages into direct chat, analytics, segment, and voice-campaign modes.",
  build: ({ suggestedPrompts, segmentEntityContext }) =>
    buildClassifyPrompt(suggestedPrompts, segmentEntityContext),
};
