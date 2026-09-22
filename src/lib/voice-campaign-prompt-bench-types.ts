import type { Purpose } from "@/lib/purpose-types";
import type { GeneratedVoiceWorkflow } from "@/features/prompts/voice/campaign-script";
import type { Segment } from "@/lib/types";

export type PromptBenchVariantKey = string;

export interface PromptBenchVariantResult {
  key: PromptBenchVariantKey;
  label: string;
  campaignName?: string;
  firstMessage?: string;
  reasoning?: string;
  systemPrompt?: string;
  editableScript?: string;
  workflow?: GeneratedVoiceWorkflow;
  promptMessages?: {
    system: string;
    user: string;
    renderedCandidatePrompt?: string;
  };
  error?: string;
}

export interface PromptBenchSimulationResponse {
  variantKey: PromptBenchVariantKey;
  label: string;
  response: string;
  error?: string;
}

export interface PromptBenchSimulation {
  utterance: string;
  responses: PromptBenchSimulationResponse[];
}

export interface PromptBenchRunPayload {
  dataset: {
    id: string;
    label: string;
    companyName?: string;
    entityName?: string;
  };
  segment: Segment;
  purpose: Purpose;
  inputs: {
    language: string;
    brief: string;
    measurementAwareBrief: string;
    agentName?: string;
    voiceGender?: "female" | "male" | "unknown";
    customerContext?: {
      name?: string;
      attributes?: string;
      lastEvent?: string;
    };
  };
  variants: PromptBenchVariantResult[];
  simulations: PromptBenchSimulation[];
}

export interface PromptBenchRun extends PromptBenchRunPayload {
  id: string;
  createdAt: string;
}
