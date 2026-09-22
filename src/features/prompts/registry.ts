import type { PromptModule } from "./types";
import { analyticsReportPromptModule } from "./analytics/analyze";
import { segmentSqlPromptModule, textToSqlPromptModule } from "./analytics/sql";
import { classifyPromptModule } from "./chat/classify";
import { routePromptModule } from "./chat/route";
import { datasetColumnAnalysisPromptModule } from "./dataset/enrichment";
import { fraudAnalysisServicePromptModule } from "./fraud/analysis-service";
import { connectorMappingPromptModule } from "./integrations/connectors";
import { segmentGenerationPromptModule } from "./segments/generation";
import { voiceCampaignBenchPromptModule } from "./voice/campaign-bench";
import { voiceCampaignScriptPromptModule } from "./voice/campaign-script";
import { voiceIntakePromptModule } from "./voice/intake";
import { voiceScriptImportPromptModule } from "./voice/script-import";

export const PROMPT_REGISTRY = {
  [analyticsReportPromptModule.id]: analyticsReportPromptModule,
  [textToSqlPromptModule.id]: textToSqlPromptModule,
  [segmentSqlPromptModule.id]: segmentSqlPromptModule,
  [classifyPromptModule.id]: classifyPromptModule,
  [routePromptModule.id]: routePromptModule,
  [datasetColumnAnalysisPromptModule.id]: datasetColumnAnalysisPromptModule,
  [fraudAnalysisServicePromptModule.id]: fraudAnalysisServicePromptModule,
  [connectorMappingPromptModule.id]: connectorMappingPromptModule,
  [segmentGenerationPromptModule.id]: segmentGenerationPromptModule,
  [voiceCampaignBenchPromptModule.id]: voiceCampaignBenchPromptModule,
  [voiceCampaignScriptPromptModule.id]: voiceCampaignScriptPromptModule,
  [voiceIntakePromptModule.id]: voiceIntakePromptModule,
  [voiceScriptImportPromptModule.id]: voiceScriptImportPromptModule,
} as const satisfies Record<string, PromptModule<unknown, unknown>>;

export type PromptId = keyof typeof PROMPT_REGISTRY;

export function getPromptModule(id: PromptId): (typeof PROMPT_REGISTRY)[PromptId] {
  return PROMPT_REGISTRY[id];
}
