export {
  getAgentSummaryTemplate,
  getCritiqueSummaryTemplate,
  getQuickResponseTemplate,
  getReportGenerationTemplate,
} from "@/lib/prompts/analyze";
import {
  getAgentSummaryTemplate,
  getCritiqueSummaryTemplate,
  getQuickResponseTemplate,
  getReportGenerationTemplate,
} from "@/lib/prompts/analyze";
import type { DatasetConfig } from "@/lib/datasets";
import type { PromptModule } from "../types";

export const analyticsReportPromptModule: PromptModule<DatasetConfig, string> = {
  id: "analytics.report",
  version: "1.0.0",
  owner: "analytics",
  description: "Builds the final multi-agent analytics report generation template.",
  build: getReportGenerationTemplate,
};

export const analyticsPromptBuilders = {
  getAgentSummaryTemplate,
  getCritiqueSummaryTemplate,
  getQuickResponseTemplate,
  getReportGenerationTemplate,
};
