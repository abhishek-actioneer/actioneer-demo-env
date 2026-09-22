export {
  buildColumnAnalysisPrompt,
  buildPromptGenerationInput,
  type ColumnAnalysis,
} from "@/lib/prompts/dataset-enrichment";
import { buildColumnAnalysisPrompt } from "@/lib/prompts/dataset-enrichment";
import type { TableProfile } from "@/lib/datasets/data-profiler";
import type { PromptModule } from "../types";

export const datasetColumnAnalysisPromptModule: PromptModule<{
  profiles: TableProfile[];
  label: string;
}, string> = {
  id: "dataset.column-analysis",
  version: "1.0.0",
  owner: "dataset",
  description: "Analyzes uploaded dataset columns before prompt/schema enrichment.",
  build: ({ profiles, label }) => buildColumnAnalysisPrompt(profiles, label),
};
