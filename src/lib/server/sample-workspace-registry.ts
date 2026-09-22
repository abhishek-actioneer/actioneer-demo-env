import {
  FUNDSINDIA_DATASET_ID,
  seedFundsIndiaSampleWorkspace,
} from "@/lib/server/fundsindia-sample-workspace";
import {
  HEALTHIANS_DATASET_ID,
  seedHealthiansSampleWorkspace,
} from "@/lib/server/healthians-sample-workspace";
import {
  PRESTO_DATASET_ID,
  seedPrestoSampleWorkspace,
} from "@/lib/server/presto-sample-workspace";
import {
  VASTU_HFC_DATASET_ID,
  seedVastuHfcSampleWorkspace,
} from "@/lib/server/vastu-hfc-sample-workspace";
import {
  QUICKHELP_DATASET_ID,
  seedQuickhelpSampleWorkspace,
} from "@/lib/server/quickhelp-sample-workspace";
import {
  HDFC_CREDITFRAUD_DATASET_ID,
  seedHdfcCreditfraudSampleWorkspace,
} from "@/lib/server/hdfc-creditfraud-sample-workspace";
import {
  YESBANK_CARDS_DATASET_ID,
  seedYesbankCardsSampleWorkspace,
} from "@/lib/server/yesbank-cards-sample-workspace";
import {
  FLIPKART_MARKETPLACE_DATASET_ID,
  seedFlipkartMarketplaceSampleWorkspace,
} from "@/lib/server/flipkart-marketplace-sample-workspace";
import {
  SUVIDHA_CAPITAL_DATASET_ID,
  seedSuvidhaCapitalSampleWorkspace,
} from "@/lib/server/suvidha-capital-sample-workspace";
import { SEED_SAMPLE_WORKSPACE_CONTENT } from "@/lib/server/seed-config";

export interface SampleWorkspaceSeedResult {
  segments: number;
  funnels: number;
  retentions: number;
  metrics?: number;
  playbooks?: number;
}

/**
 * Datasets with a handcrafted, deterministic sample workspace (segments, funnels,
 * retentions — all event-backed and validated against real data). These replace
 * the unreliable live-LLM generation so a sample workspace is never empty.
 */
const SEEDERS: Record<string, (userId: string) => Promise<SampleWorkspaceSeedResult>> = {
  [FUNDSINDIA_DATASET_ID]: seedFundsIndiaSampleWorkspace,
  [HEALTHIANS_DATASET_ID]: seedHealthiansSampleWorkspace,
  [PRESTO_DATASET_ID]: seedPrestoSampleWorkspace,
  [VASTU_HFC_DATASET_ID]: seedVastuHfcSampleWorkspace,
  [QUICKHELP_DATASET_ID]: seedQuickhelpSampleWorkspace,
  [HDFC_CREDITFRAUD_DATASET_ID]: seedHdfcCreditfraudSampleWorkspace,
  [YESBANK_CARDS_DATASET_ID]: seedYesbankCardsSampleWorkspace,
  [FLIPKART_MARKETPLACE_DATASET_ID]: seedFlipkartMarketplaceSampleWorkspace,
  [SUVIDHA_CAPITAL_DATASET_ID]: seedSuvidhaCapitalSampleWorkspace,
};

/** Returns the handcrafted seeder for a dataset, or null if it has none (falls back to LLM generation). */
export function getSampleWorkspaceSeeder(
  datasetId: string,
): ((userId: string) => Promise<SampleWorkspaceSeedResult>) | null {
  if (!SEED_SAMPLE_WORKSPACE_CONTENT) return null;
  return SEEDERS[datasetId] ?? null;
}

/**
 * Whether a dataset has a handcrafted seeder registered, independent of the
 * SEED_SAMPLE_WORKSPACE_CONTENT runtime flag. Use for wiring/coverage checks;
 * use getSampleWorkspaceSeeder for the runtime-gated seeder.
 */
export function hasHandcraftedSeeder(datasetId: string): boolean {
  return datasetId in SEEDERS;
}
