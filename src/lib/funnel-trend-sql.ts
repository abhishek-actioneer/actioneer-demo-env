import type { DatasetConfig } from "./datasets/types";
import type { FunnelConfig } from "./funnel-types";
import { compileFunnelSQL, resolveDateRange } from "./funnel-sql";

export type TrendGranularity = "day" | "week" | "month";

/**
 * Compile SQL to compute funnel conversion over time.
 *
 * Strategy: re-use the same CTE pattern as compileFunnelSQL but bucket
 * step-0 entries by DATE_TRUNC(granularity, entry_timestamp), then for
 * each bucket count how many users reached each subsequent step within the
 * conversion window. This respects countingMethod because we reuse the
 * same CTE chain as compileFunnelSQL.
 *
 * Output columns: period, step0_count, step1_count, ..., stepN_count
 */
export function compileFunnelTrendSQL(
  config: FunnelConfig,
  dataset: DatasetConfig,
  granularity: TrendGranularity = "day",
): string | null {
  if (config.steps.length < 2) return null;

  // Get the base funnel SQL (which defines step0, step1, ... CTEs)
  const baseSql = compileFunnelSQL(config, dataset);
  if (!baseSql) return null;

  // Extract the WITH clause (everything before the final SELECT)
  const withMatch = baseSql.match(/^(WITH [\s\S]+?)(\nSELECT )/);
  if (!withMatch) return null;

  const withClause = withMatch[1];
  const granFn = granularity === "day" ? "day" : granularity === "week" ? "week" : "month";

  // Build the trend query: for each period bucket, count users at each step
  const stepCounts: string[] = [];
  for (let i = 0; i < config.steps.length; i++) {
    if (i === 0) {
      // step0 always has t0
      stepCounts.push(
        `(SELECT COUNT(*) FROM step${i} WHERE DATE_TRUNC('${granFn}', t0) = periods.period) AS step${i}_count`
      );
    } else {
      // Subsequent steps: join back to step0 for period bucketing
      // A user "in period P at step i" means their step0 entry was in period P AND they reached step i
      const isTotals = config.countingMethod === "totals";
      const joinCond = isTotals
        ? `s.uid = s0.uid AND s.attempt_id = s0.attempt_id`
        : `s.uid = s0.uid`;
      stepCounts.push(
        `(SELECT COUNT(*) FROM step${i} s JOIN step0 s0 ON ${joinCond} WHERE DATE_TRUNC('${granFn}', s0.t0) = periods.period) AS step${i}_count`
      );
    }
  }

  const sql = `${withClause},
periods AS (
  SELECT DISTINCT DATE_TRUNC('${granFn}', t0) AS period
  FROM step0
)
SELECT
  periods.period,
  ${stepCounts.join(",\n  ")}
FROM periods
ORDER BY periods.period`;

  return sql;
}

export type TrendComparison = "none" | "previous_period" | "previous_year";

/** Parsed trend result */
export interface FunnelTrendPeriod {
  period: string;
  steps: Array<{
    stepIndex: number;
    count: number;
    conversionRate: number; // relative to step0 count in this period
  }>;
}

export interface FunnelTrendResult {
  periods: FunnelTrendPeriod[];
  comparisonPeriods?: FunnelTrendPeriod[];
  comparisonLabel?: string;
  granularity: TrendGranularity;
  executionTimeMs: number;
}

/**
 * Compute the comparison date range by shifting the current range backwards.
 * "previous_period" shifts by the duration of the range.
 * "previous_year" shifts by exactly 1 year.
 */
export function computeComparisonDateRange(
  config: FunnelConfig,
  dataset: DatasetConfig,
  comparison: TrendComparison,
): { start: string; end: string } | null {
  if (comparison === "none") return null;

  const current = resolveDateRange(config, dataset);
  const startMs = new Date(current.start + "T00:00:00").getTime();
  const endMs = new Date(current.end + "T00:00:00").getTime();
  const durationMs = endMs - startMs;

  if (comparison === "previous_year") {
    const s = new Date(current.start + "T00:00:00");
    const e = new Date(current.end + "T00:00:00");
    s.setFullYear(s.getFullYear() - 1);
    e.setFullYear(e.getFullYear() - 1);
    return {
      start: s.toISOString().split("T")[0],
      end: e.toISOString().split("T")[0],
    };
  }

  // previous_period: shift back by duration
  const compEnd = new Date(startMs - 86400000); // day before current start
  const compStart = new Date(compEnd.getTime() - durationMs);
  return {
    start: compStart.toISOString().split("T")[0],
    end: compEnd.toISOString().split("T")[0],
  };
}

/**
 * Build a FunnelConfig with an overridden date range for the comparison period.
 */
export function configWithDateRange(
  config: FunnelConfig,
  dateRange: { start: string; end: string },
): FunnelConfig {
  return { ...config, dateRange: { start: dateRange.start, end: dateRange.end } };
}

/**
 * Align comparison periods to current periods by shifting dates forward.
 * This makes overlay charting possible — comparison periods get the same
 * date labels as current periods.
 */
export function alignComparisonPeriods(
  currentPeriods: FunnelTrendPeriod[],
  comparisonPeriods: FunnelTrendPeriod[],
): FunnelTrendPeriod[] {
  // Map comparison periods by index to current period dates
  const aligned: FunnelTrendPeriod[] = [];
  for (let i = 0; i < currentPeriods.length; i++) {
    if (i < comparisonPeriods.length) {
      aligned.push({
        ...comparisonPeriods[i],
        period: currentPeriods[i].period, // use current period's date
      });
    }
  }
  return aligned;
}

/** Parse raw SQL rows into structured trend result */
export function parseFunnelTrendRows(
  rows: Record<string, unknown>[],
  stepCount: number,
  granularity: TrendGranularity,
  executionTimeMs: number,
): FunnelTrendResult {
  const periods: FunnelTrendPeriod[] = rows.map((row) => {
    const periodRaw = row.period;
    const periodStr =
      periodRaw instanceof Date
        ? periodRaw.toISOString().split("T")[0]
        : String(periodRaw).split("T")[0];

    const step0Count = Number(row.step0_count) || 0;
    const steps: FunnelTrendPeriod["steps"] = [];

    for (let i = 0; i < stepCount; i++) {
      const count = Number(row[`step${i}_count`]) || 0;
      steps.push({
        stepIndex: i,
        count,
        conversionRate:
          step0Count > 0
            ? Math.round((count / step0Count) * 10000) / 100
            : 0,
      });
    }

    return { period: periodStr, steps };
  });

  return { periods, granularity, executionTimeMs };
}
