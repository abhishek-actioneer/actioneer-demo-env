/**
 * Schema context for text-to-SQL prompt generation.
 * Now reads from the dataset config registry instead of hardcoded strings.
 *
 * Outputs go through {{DATASET_NOW}} substitution so the LLM stays anchored to
 * the synthetic clock for sample datasets that have live data appended via the
 * synthetic tick. Datasets without synthetic data fall back to seed end-date.
 */
import { getDataset, DEFAULT_DATASET } from "./datasets";
import { substituteNowPlaceholders } from "./synthetic/now-cache";
import { ASSISTANT_IDENTITY_GUARD } from "./assistant-identity";

export function getSchemaContext(datasetId?: string): string {
  const id = datasetId || DEFAULT_DATASET;
  return substituteNowPlaceholders(getDataset(id).schemaContext, id);
}

export function getSystemContext(datasetId: string): string {
  const id = datasetId || DEFAULT_DATASET;
  return `${substituteNowPlaceholders(getDataset(id).systemContext, id)}\n\n${ASSISTANT_IDENTITY_GUARD}`;
}
