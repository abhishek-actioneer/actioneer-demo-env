// Client-safe model registry — no server SDK imports.
// llm.ts imports from here too, so types stay in one place.

export type ModelId = "gpt-5.4";

export interface LLMModel {
  id: ModelId;
  label: string;
  badge: string;
}

export const MODELS: LLMModel[] = [
  { id: "gpt-5.4", label: "GPT-5.4", badge: "OpenAI" },
];

export const DEFAULT_MODEL: ModelId = "gpt-5.4";
