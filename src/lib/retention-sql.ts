import type { DatasetConfig } from "./datasets/types";
import type { RetentionConfig, RetentionBracket } from "./retention-types";
import { DAY_BUCKETS, DEFAULT_BRACKETS } from "./retention-types";
import type { EventDefinition, PropertyFilter } from "./explorer-types";

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

function filterToSQL(f: PropertyFilter): string {
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
 * Compile a RetentionConfig into SQL for a single return event.
 * Supports 3 modes: on_or_after (>=), on (=), custom (brackets).
 */
export function compileRetentionSQL(
  config: RetentionConfig,
  dataset: DatasetConfig,
  returnEventId?: string,
  segmentSQL?: string,
): string | null {
  const effectiveReturnId = returnEventId ?? config.returnEventIds[0];
  if (!config.startEventId || !effectiveReturnId) return null;

  const events = dataset.events ?? [];
  const startEvent = events.find((e) => e.id === config.startEventId);
  const returnEvent = events.find((e) => e.id === effectiveReturnId);
  if (!startEvent || !returnEvent) return null;

  const userIdField = dataset.userIdField ?? "user_id";
  const dateRange = resolveDateRange(config, dataset);
  const startDateCol = startEvent.dateColumn ?? dataset.dateField ?? "date";
  const returnDateCol = returnEvent.dateColumn ?? dataset.dateField ?? "date";
  const truncUnit = config.granularity === "weekly" ? "week" : config.granularity === "monthly" ? "month" : "day";
  const breakdown = config.breakdown;
  const bCol = breakdown ? quoteIdent(breakdown) : null;

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
  if (segmentSQL) {
    startConditions.push(`${quoteIdent(userIdField)} IN (${segmentSQL})`);
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

  // Cohort SELECT columns
  const cohortSelect = [
    `${quoteIdent(userIdField)} AS uid`,
    `DATE_TRUNC('${truncUnit}', MIN(${quoteIdent(startDateCol)}::TIMESTAMP))::DATE AS cohort_date`,
    `MIN(${quoteIdent(startDateCol)}::TIMESTAMP) AS first_time`,
  ];
  const cohortGroup = [quoteIdent(userIdField)];
  if (bCol) {
    cohortSelect.push(`${bCol} AS bk`);
    cohortGroup.push(bCol);
  }

  // Build bucket logic based on mode
  let bucketSQL: string;
  let bucketValues: number[];

  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    // For custom brackets, generate a CASE statement that maps days_since to a bracket index
    const cases = brackets.map((b, i) =>
      `WHEN r.days_since >= ${b.from} AND r.days_since < ${b.to} THEN ${i}`,
    ).join("\n      ");
    bucketSQL = `bucket_retention AS (
  SELECT
    r.cohort_date,
    ${bCol ? "r.bk," : ""}
    CASE ${cases} ELSE -1 END AS bucket,
    COUNT(DISTINCT r.uid) AS retained
  FROM returns r
  WHERE CASE ${cases} ELSE -1 END >= 0
  GROUP BY r.cohort_date, ${bCol ? "r.bk," : ""} bucket
)`;
    bucketValues = brackets.map((_, i) => i);
  } else if (config.mode === "on") {
    // Return On: exact day match
    bucketSQL = `bucket_retention AS (
  SELECT
    r.cohort_date,
    ${bCol ? "r.bk," : ""}
    b.bucket,
    COUNT(DISTINCT r.uid) AS retained
  FROM returns r
  CROSS JOIN (SELECT UNNEST([${[...DAY_BUCKETS].join(",")}]) AS bucket) b
  WHERE r.days_since = b.bucket
  GROUP BY r.cohort_date, ${bCol ? "r.bk," : ""} b.bucket
)`;
    bucketValues = [...DAY_BUCKETS];
  } else {
    // Return On or After: >= bucket
    bucketSQL = `bucket_retention AS (
  SELECT
    r.cohort_date,
    ${bCol ? "r.bk," : ""}
    b.bucket,
    COUNT(DISTINCT r.uid) AS retained
  FROM returns r
  CROSS JOIN (SELECT UNNEST([${[...DAY_BUCKETS].join(",")}]) AS bucket) b
  WHERE r.days_since >= b.bucket
  GROUP BY r.cohort_date, ${bCol ? "r.bk," : ""} b.bucket
)`;
    bucketValues = [...DAY_BUCKETS];
  }

  const cohortSizeGroup = bCol ? "cohort_date, bk" : "cohort_date";
  const cohortSizeSelect = bCol ? "cohort_date, bk, COUNT(*) AS cohort_size" : "cohort_date, COUNT(*) AS cohort_size";
  const finalJoin = bCol
    ? "LEFT JOIN bucket_retention br ON br.cohort_date = cs.cohort_date AND br.bk = cs.bk"
    : "LEFT JOIN bucket_retention br ON br.cohort_date = cs.cohort_date";
  const finalSelect = bCol
    ? "cs.cohort_date, cs.bk AS breakdown, cs.cohort_size, br.bucket AS day_bucket, COALESCE(br.retained, 0) AS retained_users"
    : "cs.cohort_date, cs.cohort_size, br.bucket AS day_bucket, COALESCE(br.retained, 0) AS retained_users";

  const sql = `WITH cohort AS (
  SELECT DISTINCT ${cohortSelect.join(", ")}
  FROM ${quoteIdent(startEvent.table)}
  WHERE ${startConditions.join("\n    AND ")}
  GROUP BY ${cohortGroup.join(", ")}
),
returns AS (
  SELECT DISTINCT
    c.uid,
    c.cohort_date,
    ${bCol ? "c.bk," : ""}
    c.first_time,
    DATE_DIFF('day', c.first_time, e.${quoteIdent(returnDateCol)}::TIMESTAMP) AS days_since
  FROM cohort c
  JOIN ${quoteIdent(returnEvent.table)} e ON e.${quoteIdent(userIdField)} = c.uid
  WHERE e.${quoteIdent(returnDateCol)}::TIMESTAMP >= c.first_time
    ${returnWhere}
),
cohort_sizes AS (
  SELECT ${cohortSizeSelect}
  FROM cohort
  GROUP BY ${cohortSizeGroup}
),
${bucketSQL}
SELECT ${finalSelect}
FROM cohort_sizes cs
${finalJoin}
ORDER BY cs.cohort_date, br.bucket`;

  return sql;
}
