import {
  FUNDSINDIA_DATASET_ID,
  seedFundsIndiaPlaybooks,
} from "@/lib/server/fundsindia-sample-workspace";
import {
  PRESTO_DATASET_ID,
  seedPrestoPlaybooks,
} from "@/lib/server/presto-sample-workspace";
import {
  VASTU_HFC_DATASET_ID,
  seedVastuHfcPlaybooks,
} from "@/lib/server/vastu-hfc-sample-workspace";
import {
  QUICKHELP_DATASET_ID,
  seedQuickhelpPlaybooks,
} from "@/lib/server/quickhelp-sample-workspace";
import {
  HEALTHIANS_DATASET_ID,
  seedHealthiansPlaybooks,
} from "@/lib/server/healthians-sample-workspace";
import {
  SUVIDHA_CAPITAL_DATASET_ID,
  seedSuvidhaCapitalPlaybooks,
} from "@/lib/server/suvidha-capital-sample-workspace";
import { SEED_SAMPLE_WORKSPACE_CONTENT } from "@/lib/server/seed-config";

/** Handcrafted playbook seeders per sample dataset. Each is idempotent. */
const PLAYBOOK_SEEDERS: Record<string, (userId: string) => number> = {
  [FUNDSINDIA_DATASET_ID]: seedFundsIndiaPlaybooks,
  [PRESTO_DATASET_ID]: seedPrestoPlaybooks,
  [VASTU_HFC_DATASET_ID]: seedVastuHfcPlaybooks,
  [QUICKHELP_DATASET_ID]: seedQuickhelpPlaybooks,
  [HEALTHIANS_DATASET_ID]: seedHealthiansPlaybooks,
  [SUVIDHA_CAPITAL_DATASET_ID]: seedSuvidhaCapitalPlaybooks,
};

/** Seed the handcrafted playbooks for a dataset (no-op if it has none). Returns count newly seeded. */
export function seedPlaybooksForDataset(userId: string, datasetId: string): number {
  if (!SEED_SAMPLE_WORKSPACE_CONTENT) return 0;
  const seeder = PLAYBOOK_SEEDERS[datasetId];
  return seeder ? seeder(userId) : 0;
}
