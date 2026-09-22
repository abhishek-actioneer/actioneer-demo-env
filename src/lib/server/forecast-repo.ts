import { stmts } from "@/lib/meta-db";

export interface ForecastSeedRow {
  id: string;
  user_id: string;
  dataset_id: string;
  model_data: string;
  seed_data: string;
  updated_at: string;
}

export interface ForecastSeedData {
  id: string;
  datasetId: string;
  modelData: string; // JSON
  seedData: string;  // JSON
  updatedAt: string;
}

function rowToSeed(row: ForecastSeedRow): ForecastSeedData {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    modelData: row.model_data,
    seedData: row.seed_data,
    updatedAt: row.updated_at,
  };
}

export function listForecastSeeds(userId: string, datasetId: string): ForecastSeedData[] {
  const rows = stmts().forecastSeedListByUserDataset.all(userId, datasetId) as ForecastSeedRow[];
  return rows.map(rowToSeed);
}

export function upsertForecastSeed(userId: string, seed: ForecastSeedData): void {
  stmts().forecastSeedUpsert.run({
    id: seed.id,
    user_id: userId,
    dataset_id: seed.datasetId,
    model_data: seed.modelData,
    seed_data: seed.seedData,
    updated_at: seed.updatedAt,
  });
}

export function deleteForecastSeed(userId: string, id: string): void {
  stmts().forecastSeedDelete.run(id, userId);
}
