export { OUTPUT_SQL_ONLY, buildSegmentSqlPrompt, buildTextToSqlPrompt } from "@/lib/prompts/sql";
import { buildSegmentSqlPrompt, buildTextToSqlPrompt } from "@/lib/prompts/sql";
import type { PromptModule } from "../types";

export const textToSqlPromptModule: PromptModule<{ datasetId: string; dateRangeOverride?: string }, string> = {
  id: "analytics.text-to-sql",
  version: "1.0.0",
  owner: "analytics",
  description: "Builds DuckDB text-to-SQL prompts for dataset analytics.",
  build: ({ datasetId, dateRangeOverride }) =>
    buildTextToSqlPrompt(datasetId, dateRangeOverride ? { dateRangeOverride } : undefined),
};

export const segmentSqlPromptModule: PromptModule<{ datasetId: string }, string> = {
  id: "segments.sql",
  version: "1.0.0",
  owner: "segments",
  description: "Builds DuckDB SQL prompts for audience segment membership queries.",
  build: ({ datasetId }) => buildSegmentSqlPrompt(datasetId),
};
