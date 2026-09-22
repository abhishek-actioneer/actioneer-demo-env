import type { DatasetConfig } from "./datasets/types";
import type { RetentionConfig } from "./retention-types";
import { DAY_BUCKETS, DEFAULT_BRACKETS } from "./retention-types";

/**
 * Result types for the Change Over Time view.
 * Each period represents a single cohort date and its retention rate
 * for a specific bucket (e.g. "Day 7 retention for users who started on Jan 1").
 */
export interface RetentionTrendPeriod {
  period: string;
  cohortSize: number;
  retainedCount: number;
  retentionRate: number;
}

export interface RetentionTrendResult {
  periods: RetentionTrendPeriod[];
  bucket: number;
  executionTimeMs: number;
}

// ── Internal helpers (mirror retention-sql.ts) ──

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

function filterToSQL(f: { property: string; operator: string; value: unknown }): string {
  const col = quoteIdent(f.property);
  const val = f.value;
  switch (f.operator) {
    case "eq":
      return typeof val === "number" ? `${col} = ${val}` : `${col} = '${escapeStr(String(val))}'`;
    case "neq":
      return typeof val === "number" ? `${col} != ${val}` : `${col} != '${escapeStr(String(val))}'`;
    case "gt": return `${col} > ${val}`;
    case "lt": return `${col} < ${val}`;
    case "contains":
      return `${col} ILIKE '%${escapeStr(String(val))}%'`;
    default:
      return "1=1";
  }
}

function resolveDateRange(
  config: RetentionConfig,
  dataset: DatasetConfig,
): { start: string; end: string } {
  if ("start" in config.dateRange) {
    return { start: config.dateRange.start, end: config.dateRange.end };
  }
  const endDate = dataset.dateRange ? new Date(dataset.dateRange.end) : new Date();
  const days: Record<string, number> = { "7d": 7, "30d": 30, "60d": 60, "90d": 90, "1y": 365 };
  const d = days[config.dateRange.preset] ?? 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - d);
  return {
    start: startDate.toISOString().split("T")[0],
    end: endDate.toISOString().split("T")[0],
  };
}

/**
 * Compile a retention trend SQL query for a single bucket.
 *
 * This produces one row per cohort date with:
 *   period (cohort_date), cohort_size, retained_count, retention_rate
 *
 * The SQL follows the same CTE chain as compileRetentionSQL but only
 * computes retention for the selected bucket, making it simpler and faster.
 */
export function compileRetentionTrendSQL(
  config: RetentionConfig,
  dataset: DatasetConfig,
  bucket: number,
): string | null {
  const returnEventId = config.returnEventIds[0];
  if (!config.startEventId || !returnEventId) return null;

  const events = dataset.events ?? [];
  const startEvent = events.find((e) => e.id === config.startEventId);
  const returnEvent = events.find((e) => e.id === returnEventId);
  if (!startEvent || !returnEvent) return null;

  const userIdField = dataset.userIdField ?? "user_id";
  const dateRange = resolveDateRange(config, dataset);
  const startDateCol = startEvent.dateColumn ?? dataset.dateField ?? "date";
  const returnDateCol = returnEvent.dateColumn ?? dataset.dateField ?? "date";
  const truncUnit = config.granularity === "weekly" ? "week" : config.granularity === "monthly" ? "month" : "day";

  // Start event conditions
  const startConditions: string[] = [];
  startConditions.push(`${quoteIdent(startDateCol)}::TIMESTAMP >= '${dateRange.start}'::TIMESTAMP`);
  startConditions.push(`${quoteIdent(startDateCol)}::TIMESTAMP <= '${dateRange.end} 23:59:59'::TIMESTAMP`);
  if (startEvent.filterColumn && startEvent.filterValue) {
    startConditions.push(`${quoteIdent(startEvent.filterColumn)} = '${escapeStr(startEvent.filterValue)}'`);
  }
  if (startEvent.filterSQL) {
    startConditions.push(`(${startEvent.filterSQL})`);
  }
  if (config.startFilters?.length) {
    for (const f of config.startFilters) startConditions.push(filterToSQL(f));
  }

  // Return event conditions
  const returnConditions: string[] = [];
  if (returnEvent.filterColumn && returnEvent.filterValue) {
    returnConditions.push(`${quoteIdent(returnEvent.filterColumn)} = '${escapeStr(returnEvent.filterValue)}'`);
  }
  if (returnEvent.filterSQL) {
    returnConditions.push(`(${returnEvent.filterSQL})`);
  }
  if (config.returnFilters?.length) {
    for (const f of config.returnFilters) returnConditions.push(filterToSQL(f));
  }
  const returnWhere = returnConditions.length > 0 ? `AND ${returnConditions.join("\n    AND ")}` : "";

  // Build the WHERE clause for the selected bucket based on mode
  let bucketCondition: string;

  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    // Find the bracket that matches the bucket index
    if (bucket < 0 || bucket >= brackets.length) return null;
    const b = brackets[bucket];
    bucketCondition = `r.days_since >= ${b.from} AND r.days_since < ${b.to}`;
  } else if (config.mode === "on") {
    // Exact day match
    bucketCondition = `r.days_since = ${bucket}`;
  } else {
    // on_or_after: user returned on or after this day
    bucketCondition = `r.days_since >= ${bucket}`;
  }

  const sql = `WITH cohort AS (
  SELECT DISTINCT
    ${quoteIdent(userIdField)} AS uid,
    DATE_TRUNC('${truncUnit}', MIN(${quoteIdent(startDateCol)}::TIMESTAMP))::DATE AS cohort_date,
    MIN(${quoteIdent(startDateCol)}::TIMESTAMP) AS first_time
  FROM ${quoteIdent(startEvent.table)}
  WHERE ${startConditions.join("\n    AND ")}
  GROUP BY ${quoteIdent(userIdField)}
),
returns AS (
  SELECT DISTINCT
    c.uid,
    c.cohort_date,
    c.first_time,
    DATE_DIFF('day', c.first_time, e.${quoteIdent(returnDateCol)}::TIMESTAMP) AS days_since
  FROM cohort c
  JOIN ${quoteIdent(returnEvent.table)} e ON e.${quoteIdent(userIdField)} = c.uid
  WHERE e.${quoteIdent(returnDateCol)}::TIMESTAMP >= c.first_time
    ${returnWhere}
),
cohort_sizes AS (
  SELECT cohort_date, COUNT(*) AS cohort_size
  FROM cohort
  GROUP BY cohort_date
),
bucket_retained AS (
  SELECT
    r.cohort_date,
    COUNT(DISTINCT r.uid) AS retained
  FROM returns r
  WHERE ${bucketCondition}
  GROUP BY r.cohort_date
)
SELECT
  cs.cohort_date AS period,
  cs.cohort_size,
  COALESCE(br.retained, 0) AS retained_count,
  CASE WHEN cs.cohort_size > 0
    THEN ROUND(COALESCE(br.retained, 0) * 100.0 / cs.cohort_size, 2)
    ELSE 0
  END AS retention_rate
FROM cohort_sizes cs
LEFT JOIN bucket_retained br ON br.cohort_date = cs.cohort_date
ORDER BY cs.cohort_date`;

  return sql;
}

/**
 * Parse raw SQL rows into a RetentionTrendResult.
 */
export function parseRetentionTrendRows(
  rows: Record<string, unknown>[],
  bucket: number,
  executionTimeMs: number,
): RetentionTrendResult {
  const periods: RetentionTrendPeriod[] = rows.map((row) => {
    const periodRaw = row.period;
    const periodStr =
      periodRaw instanceof Date
        ? periodRaw.toISOString().split("T")[0]
        : String(periodRaw).split("T")[0];

    return {
      period: periodStr,
      cohortSize: Number(row.cohort_size) || 0,
      retainedCount: Number(row.retained_count) || 0,
      retentionRate: Number(row.retention_rate) || 0,
    };
  });

  return { periods, bucket, executionTimeMs };
}

/**
 * Get available bucket options based on retention mode.
 * For standard modes: DAY_BUCKETS [0, 1, 3, 7, 14, 30, 60, 90]
 * For custom mode: bracket indices [0, 1, 2, ...]
 */
export function getAvailableBuckets(config: RetentionConfig): number[] {
  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    return brackets.map((_, i) => i);
  }
  return [...DAY_BUCKETS];
}

/**
 * Get a human-readable label for a bucket value.
 */
export function getBucketLabel(config: RetentionConfig, bucket: number): string {
  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    if (bucket >= 0 && bucket < brackets.length) {
      const b = brackets[bucket];
      return `Day ${b.from}-${b.to}`;
    }
    return `Bracket ${bucket}`;
  }
  return `Day ${bucket}`;
}
