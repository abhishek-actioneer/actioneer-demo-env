import type { DatasetConfig } from "./datasets/types";
import type { FunnelConfig } from "./funnel-types";
import { compileFunnelSQL } from "./funnel-sql";

/**
 * Compile SQL to compute time-to-convert distribution between funnel steps.
 * Returns percentiles (P25, P50, P75, P90) and histogram buckets.
 * Requires the base funnel CTEs, then computes time differences for converted users.
 */
export function compileFunnelTimeDistributionSQL(
  config: FunnelConfig,
  dataset: DatasetConfig,
): string | null {
  if (config.steps.length < 2) return null;

  // Get the base funnel SQL (which defines step0, step1, ... CTEs)
  const baseSql = compileFunnelSQL(config, dataset);
  if (!baseSql) return null;

  // Extract the WITH clause (everything before the final SELECT)
  const withMatch = baseSql.match(/^(WITH [\s\S]+?)(\nSELECT )/);
  if (!withMatch) return null;

  const withClause = withMatch[1];
  const isTotals = config.countingMethod === "totals";
  const joinCondition = isTotals
    ? "s_next.uid = s_prev.uid AND s_next.attempt_id = s_prev.attempt_id"
    : "s_next.uid = s_prev.uid";

  // Build time diff CTEs for each consecutive step pair
  const timePairCTEs: string[] = [];
  const unionParts: string[] = [];

  for (let i = 1; i < config.steps.length; i++) {
    const cteName = `time_pair_${i - 1}_${i}`;
    timePairCTEs.push(`${cteName} AS (
  SELECT
    ${i - 1} AS from_step,
    ${i} AS to_step,
    EPOCH(s_next.t${i} - s_prev.t${i - 1}) AS seconds_to_convert
  FROM step${i} s_next
  JOIN step${i - 1} s_prev ON ${joinCondition}
  WHERE s_next.t${i} IS NOT NULL AND s_prev.t${i - 1} IS NOT NULL
)`);
    unionParts.push(`SELECT * FROM ${cteName}`);
  }

  // Overall time (step 0 to last step)
  const lastIdx = config.steps.length - 1;
  timePairCTEs.push(`time_overall AS (
  SELECT
    0 AS from_step,
    ${lastIdx} AS to_step,
    EPOCH(s_last.t${lastIdx} - s_first.t0) AS seconds_to_convert
  FROM step${lastIdx} s_last
  JOIN step0 s_first ON ${joinCondition}
  WHERE s_last.t${lastIdx} IS NOT NULL AND s_first.t0 IS NOT NULL
)`);
  unionParts.push(`SELECT * FROM time_overall`);

  // Combine all time pairs
  const allTimes = `all_times AS (${unionParts.join("\n  UNION ALL\n  ")})`;
  timePairCTEs.push(allTimes);

  const sql = `${withClause},
${timePairCTEs.join(",\n")}
SELECT
  from_step,
  to_step,
  COUNT(*) AS converted_count,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY seconds_to_convert) AS p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY seconds_to_convert) AS median,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY seconds_to_convert) AS p75,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY seconds_to_convert) AS p90,
  MIN(seconds_to_convert) AS min_time,
  MAX(seconds_to_convert) AS max_time,
  AVG(seconds_to_convert) AS avg_time,
  -- Histogram buckets
  COUNT(*) FILTER (WHERE seconds_to_convert < 60) AS bucket_lt_1m,
  COUNT(*) FILTER (WHERE seconds_to_convert >= 60 AND seconds_to_convert < 300) AS bucket_1_5m,
  COUNT(*) FILTER (WHERE seconds_to_convert >= 300 AND seconds_to_convert < 1800) AS bucket_5_30m,
  COUNT(*) FILTER (WHERE seconds_to_convert >= 1800 AND seconds_to_convert < 3600) AS bucket_30_60m,
  COUNT(*) FILTER (WHERE seconds_to_convert >= 3600 AND seconds_to_convert < 86400) AS bucket_1_24h,
  COUNT(*) FILTER (WHERE seconds_to_convert >= 86400 AND seconds_to_convert < 604800) AS bucket_1_7d,
  COUNT(*) FILTER (WHERE seconds_to_convert >= 604800) AS bucket_7d_plus
FROM all_times
GROUP BY from_step, to_step
ORDER BY from_step, to_step`;

  return sql;
}

export interface TimeDistributionResult {
  stepPairs: Array<{
    fromStep: number;
    toStep: number;
    convertedCount: number;
    median: number;
    p25: number;
    p75: number;
    p90: number;
    minTime: number;
    maxTime: number;
    avgTime: number;
    buckets: Array<{
      label: string;
      count: number;
      percentage: number;
    }>;
  }>;
}

const BUCKET_LABELS = [
  "< 1 min",
  "1-5 min",
  "5-30 min",
  "30-60 min",
  "1-24 hours",
  "1-7 days",
  "7+ days",
];

const BUCKET_KEYS = [
  "bucket_lt_1m",
  "bucket_1_5m",
  "bucket_5_30m",
  "bucket_30_60m",
  "bucket_1_24h",
  "bucket_1_7d",
  "bucket_7d_plus",
];

export function parseTimeDistributionRows(rows: Record<string, unknown>[]): TimeDistributionResult {
  const stepPairs = rows.map((row) => {
    const convertedCount = Number(row.converted_count) || 0;
    const buckets = BUCKET_KEYS.map((key, i) => {
      const count = Number(row[key]) || 0;
      return {
        label: BUCKET_LABELS[i],
        count,
        percentage: convertedCount > 0 ? Math.round((count / convertedCount) * 10000) / 100 : 0,
      };
    });

    return {
      fromStep: Number(row.from_step),
      toStep: Number(row.to_step),
      convertedCount,
      median: Number(row.median) || 0,
      p25: Number(row.p25) || 0,
      p75: Number(row.p75) || 0,
      p90: Number(row.p90) || 0,
      minTime: Number(row.min_time) || 0,
      maxTime: Number(row.max_time) || 0,
      avgTime: Number(row.avg_time) || 0,
      buckets,
    };
  });

  return { stepPairs };
}
