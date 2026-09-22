import type { PromptModule } from "../types";

export const fraudAnalysisServicePromptModule: PromptModule<void, string> = {
  id: "fraud.analysis-service",
  version: "1.0.0",
  owner: "fraud",
  description: "Documents the external acoustic fraud-analysis service contract; no LLM prompt is generated.",
  build: () => "Fraud analysis is performed by the external services/fraud-analysis API, not by an inline LLM prompt.",
};
