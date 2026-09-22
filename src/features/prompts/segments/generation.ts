export { buildSegmentGenerationPrompt } from "@/lib/prompts/segments";
import { buildSegmentGenerationPrompt } from "@/lib/prompts/segments";
import type { SchemaMap } from "@/lib/datasets/types";
import type { PromptModule } from "../types";

export const segmentGenerationPromptModule: PromptModule<{
  schemaMap: SchemaMap;
  userIdField: string;
  label: string;
}, string> = {
  id: "segments.generate",
  version: "1.0.0",
  owner: "segments",
  description: "Generates starter segment definitions from a dataset schema map.",
  build: ({ schemaMap, userIdField, label }) =>
    buildSegmentGenerationPrompt(schemaMap, userIdField, label),
};
