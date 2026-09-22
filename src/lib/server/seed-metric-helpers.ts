import type { DatasetConfig } from "@/lib/datasets/types";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { compileFunnelSQL } from "@/lib/funnel-sql";
import { compileRetentionSQL } from "@/lib/retention-sql";
import { executeSQLInternal } from "@/lib/sql-executor";

/**
 * Compute the headline (no-breakdown) conversion rate for a funnel config.
 * Strips any breakdown so the result is a single scalar step0 → last percentage.
 */
export async function computeFunnelHeadlineConversion(
  config: FunnelConfig,
  dataset: DatasetConfig,
  datasetId: string,
): Promise<number | null> {
  try {
    const headlineConfig = config.breakdown ? { ...config, breakdown: undefined } : config;
    const sql = compileFunnelSQL(headlineConfig, dataset);
    if (!sql) return null;
    const result = await executeSQLInternal(sql, datasetId);
    if (result.error || result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, unknown>;
    const step0 = Number(row.step0_count) || 0;
    const last = Number(row[`step${config.steps.length - 1}_count`]) || 0;
    return step0 > 0 ? Math.round((last / step0) * 10000) / 100 : 0;
  } catch {
    return null;
  }
}

/**
 * Compute the D7 retention rate for a retention config.
 * Groups by (breakdown, cohort_date) so breakdown retentions do not double-count
 * retained users, and only counts a cohort in the D7 denominator if it has an
 * observable day-7 bucket.
 */
export async function computeD7Retention(
  config: RetentionConfig,
  dataset: DatasetConfig,
  datasetId: string,
): Promise<number | null> {
  try {
    const sql = compileRetentionSQL(config, dataset);
    if (!sql) return null;
    const result = await executeSQLInternal(sql, datasetId);
    if (result.error || result.rows.length === 0) return null;
    const byCohort = new Map<string, { size: number; d7?: number }>();
    for (const row of result.rows as Record<string, unknown>[]) {
      const key =
        "breakdown" in row
          ? `${String(row.breakdown)}|${String(row.cohort_date)}`
          : String(row.cohort_date);
      let entry = byCohort.get(key);
      if (!entry) {
        entry = { size: Number(row.cohort_size) || 0 };
        byCohort.set(key, entry);
      }
      if (Number(row.day_bucket) === 7) entry.d7 = Number(row.retained_users) || 0;
    }
    let cohort = 0;
    let retained = 0;
    for (const entry of byCohort.values()) {
      if (entry.d7 !== undefined) {
        cohort += entry.size;
        retained += entry.d7;
      }
    }
    return cohort > 0 ? Math.round((retained / cohort) * 10000) / 100 : 0;
  } catch {
    return null;
  }
}
