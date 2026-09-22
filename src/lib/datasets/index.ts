export type { DatasetConfig, DatasetId } from "./types";
export { quickhelpDataset } from "./quickhelp";
export { prestoDataset } from "./presto";
export { vastuHfcDataset } from "./vastu-hfc";
export { fundsindiaDataset } from "./fundsindia";
export { healthiansDataset } from "./healthians";
export { absliLifeDataset } from "./absli-life";
export { suvidhaCapitalDataset } from "./suvidha-capital";
export { healthplusDataset } from "./healthplus";
export { DEFAULT_DATASET } from "./constants";

import { prestoDataset } from "./presto";
import { vastuHfcDataset } from "./vastu-hfc";
import { fundsindiaDataset } from "./fundsindia";
import { quickhelpDataset } from "./quickhelp";
import { healthiansDataset } from "./healthians";
import { hdfcCreditfraudDataset } from "./hdfc-creditfraud";
import { yesbankCardsDataset } from "./yesbank-cards";
import { flipkartMarketplaceDataset } from "./flipkart-marketplace";
import { absliLifeDataset } from "./absli-life";
import { suvidhaCapitalDataset } from "./suvidha-capital";
import { healthplusDataset } from "./healthplus";
import { getDynamicDataset, getDynamicDatasets } from "./dynamic-registry";
import { DEFAULT_DATASET } from "./constants";
import type { DatasetConfig } from "./types";

const STATIC_DATASETS: Record<string, DatasetConfig> = {
  presto: prestoDataset,
  "vastu-hfc": vastuHfcDataset,
  fundsindia: fundsindiaDataset,
  quickhelp: quickhelpDataset,
  healthians: healthiansDataset,
  "hdfc-creditfraud": hdfcCreditfraudDataset,
  "yesbank-cards": yesbankCardsDataset,
  "flipkart-marketplace": flipkartMarketplaceDataset,
  "absli-life": absliLifeDataset,
  "suvidha-capital": suvidhaCapitalDataset,
  healthplus: healthplusDataset,
};

export function getDataset(id: string): DatasetConfig {
  if (STATIC_DATASETS[id]) return STATIC_DATASETS[id];
  const dynamic = getDynamicDataset(id);
  if (dynamic) return dynamic;
  // Fall back to default instead of throwing — handles stale localStorage values
  const fallback = STATIC_DATASETS[DEFAULT_DATASET];
  if (fallback) return fallback;
  throw new Error(`[getDataset] unknown dataset: "${id}"`);
}

export function getAllDatasets(): DatasetConfig[] {
  return [...Object.values(STATIC_DATASETS), ...getDynamicDatasets()];
}

/**
 * Returns datasets visible to a specific user:
 * - Their uploaded datasets (ownerId === userId)
 * - Selected sample datasets (filtered by selectedSampleIds, or all if not provided)
 */
/**
 * Returns a single dataset if the user has access, or null if denied.
 * Rules:
 * - User's own uploads (ownerId === userId) → allow
 * - Another user's upload (ownerId !== userId) → deny
 * - Dynamic dataset with no owner (legacy orphan) → deny
 * - Static sample dataset → allow (shared demo data)
 * - Unknown dataset / silent fallback → deny
 */
export function getDatasetForUser(id: string, userId: string): DatasetConfig | null {
  let ds: DatasetConfig | null;
  try {
    ds = getDataset(id);
  } catch {
    console.warn(`[getDatasetForUser] getDataset threw for id="${id}"`);
    return null;
  }
  // getDataset silently falls back to DEFAULT_DATASET for unknown IDs — catch that
  if (ds.id !== id) { console.warn(`[getDatasetForUser] id mismatch: requested="${id}" got="${ds.id}"`); return null; }
  // Another user's upload
  if (ds.ownerId && ds.ownerId !== userId) { console.warn(`[getDatasetForUser] owner mismatch: ds.ownerId="${ds.ownerId}" userId="${userId}"`); return null; }
  // Legacy orphan dynamic dataset (isSample datasets are shared on purpose)
  if (ds.isDynamic && !ds.ownerId && !ds.isSample) { console.warn(`[getDatasetForUser] orphan dynamic dataset: id="${id}"`); return null; }
  return ds;
}

export function getAllDatasetsForUser(
  userId: string,
  selectedSampleIds?: string[],
  restrictToSelected = false,
): DatasetConfig[] {
  // Prospect accounts (provisioned via the admin panel) carry restrictDatasets:
  // true and exactly one selected industry. For them, the workspace shows ONLY
  // that industry — nothing else. Regular/internal accounts never set this flag,
  // so their behavior is unchanged (all static samples remain visible).
  const restrict = restrictToSelected && Array.isArray(selectedSampleIds);
  const allowed = restrict ? new Set(selectedSampleIds) : null;

  return getAllDatasets().filter((ds) => {
    // User's own uploads — always visible
    if (ds.ownerId === userId) return true;
    // Another user's upload — never visible
    if (ds.ownerId && ds.ownerId !== userId) return false;
    // Restricted prospect: only their chosen industry is visible.
    if (allowed) return allowed.has(ds.id);
    // Promoted shared sample — visible to everyone, even accounts whose stored
    // selectedSampleDatasets predates this dataset's promotion
    if (ds.isDynamic && ds.isSample) return true;
    // Dynamic dataset with no ownerId = legacy orphan — hide it
    if (ds.isDynamic && !ds.ownerId) return false;
    // Static sample dataset — shared demo data, always visible to everyone
    // regardless of the account's onboarding selection.
    return true;
  });
}
