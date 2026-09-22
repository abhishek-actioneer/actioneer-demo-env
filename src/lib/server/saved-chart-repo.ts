import { stmts } from "@/lib/meta-db";

export interface SavedChartRow {
  id: string;
  user_id: string;
  dataset_id: string;
  name: string;
  config: string;
  created_at: string;
}

export interface SavedChartData {
  id: string;
  name: string;
  datasetId: string;
  config: string; // JSON string of ExplorerConfig
  createdAt: string;
}

function rowToChart(row: SavedChartRow): SavedChartData {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.dataset_id,
    config: row.config,
    createdAt: row.created_at,
  };
}

export function listSavedCharts(userId: string, datasetId: string): SavedChartData[] {
  const rows = stmts().savedChartListByUserDataset.all(userId, datasetId) as SavedChartRow[];
  return rows.map(rowToChart);
}

export function upsertSavedChart(userId: string, chart: SavedChartData): void {
  stmts().savedChartUpsert.run({
    id: chart.id,
    user_id: userId,
    dataset_id: chart.datasetId,
    name: chart.name,
    config: chart.config,
    created_at: chart.createdAt,
  });
}

export function deleteSavedChart(userId: string, id: string): void {
  stmts().savedChartDelete.run(id, userId);
}
