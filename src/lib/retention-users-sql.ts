import type { DatasetConfig } from "./datasets/types";
import type { RetentionConfig } from "./retention-types";
import { DAY_BUCKETS, DEFAULT_BRACKETS } from "./retention-types";
import { compileRetentionSQL } from "./retention-sql";

/**
 * Build the WITH clause (cohort + returns CTEs) from the full retention SQL.
 * Returns null if the retention SQL can't be compiled.
 */
function extractWithClause(
  config: RetentionConfig,
  dataset: DatasetConfig,
): string | null {
  const fullSql = compileRetentionSQL(config, dataset);
  if (!fullSql) return null;

  // The full SQL has: WITH cohort AS (...), returns AS (...), cohort_sizes AS (...), bucket_retention AS (...) SELECT ...
  // We only need cohort + returns CTEs. Extract everything up to (but not including) "cohort_sizes AS".
  const cohortSizesIdx = fullSql.indexOf("cohort_sizes AS");
  if (cohortSizesIdx === -1) return null;

  // Walk backwards to find the comma before cohort_sizes
  let cutIdx = cohortSizesIdx;
  while (cutIdx > 0 && fullSql[cutIdx - 1] !== ',') cutIdx--;
  if (cutIdx <= 0) return null;

  // Remove trailing comma + whitespace
  let withClause = fullSql.substring(0, cutIdx - 1).trimEnd();
  // Remove trailing comma if still present
  if (withClause.endsWith(",")) {
    withClause = withClause.slice(0, -1).trimEnd();
  }

  return withClause;
}

/**
 * Build the days_since filter clause based on config mode and bucket.
 */
function bucketFilter(
  config: RetentionConfig,
  bucket: number,
  alias = "r",
): string {
  if (config.mode === "custom") {
    const brackets = config.customBrackets ?? DEFAULT_BRACKETS;
    const bracket = brackets[bucket];
    if (!bracket) return `${alias}.days_since >= 0 AND ${alias}.days_since < 0`; // impossible match
    return `${alias}.days_since >= ${bracket.from} AND ${alias}.days_since < ${bracket.to}`;
  } else if (config.mode === "on") {
    return `${alias}.days_since = ${bucket}`;
  } else {
    // on_or_after
    return `${alias}.days_since >= ${bucket}`;
  }
}

/**
 * Compile SQL to retrieve user IDs for a specific retention cohort + bucket.
 *
 * - status "retained": users in cohort C who returned at/after bucket B
 * - status "churned": users in cohort C who did NOT return at/after bucket B
 */
export function compileRetentionUsersSQL(
  config: RetentionConfig,
  dataset: DatasetConfig,
  cohortDate: string,
  bucket: number,
  status: "retained" | "churned",
  limit = 50,
  offset = 0,
): string | null {
  const withClause = extractWithClause(config, dataset);
  if (!withClause) return null;

  const filter = bucketFilter(config, bucket);
  const cohortFilter = `cohort_date = '${cohortDate}'`;

  if (status === "retained") {
    return `${withClause}
SELECT DISTINCT uid FROM returns
WHERE ${cohortFilter}
  AND ${filter}
ORDER BY uid
LIMIT ${limit} OFFSET ${offset}`;
  }

  // churned: in cohort but NOT in retained set
  return `${withClause}
SELECT c.uid FROM cohort c
WHERE c.${cohortFilter}
  AND c.uid NOT IN (
    SELECT DISTINCT uid FROM returns
    WHERE ${cohortFilter}
      AND ${filter}
  )
ORDER BY c.uid
LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * Compile a COUNT query for users at a specific cohort + bucket.
 */
export function compileRetentionUsersCountSQL(
  config: RetentionConfig,
  dataset: DatasetConfig,
  cohortDate: string,
  bucket: number,
  status: "retained" | "churned",
): string | null {
  const withClause = extractWithClause(config, dataset);
  if (!withClause) return null;

  const filter = bucketFilter(config, bucket);
  const cohortFilter = `cohort_date = '${cohortDate}'`;

  if (status === "retained") {
    return `${withClause}
SELECT COUNT(DISTINCT uid) AS total FROM returns
WHERE ${cohortFilter}
  AND ${filter}`;
  }

  return `${withClause}
SELECT COUNT(*) AS total FROM (
  SELECT c.uid FROM cohort c
  WHERE c.${cohortFilter}
    AND c.uid NOT IN (
      SELECT DISTINCT uid FROM returns
      WHERE ${cohortFilter}
        AND ${filter}
    )
) __churned`;
}

/**
 * Compile a segment-definition SQL for retained or churned users.
 * No LIMIT — suitable for saving as a segment.
 *
 * If cohortDate is omitted, includes ALL cohorts (useful for broader segments).
 */
export function compileRetentionChurnSegmentSQL(
  config: RetentionConfig,
  dataset: DatasetConfig,
  cohortDate: string | undefined,
  bucket: number,
  status: "retained" | "churned" = "churned",
): string | null {
  const withClause = extractWithClause(config, dataset);
  if (!withClause) return null;

  const filter = bucketFilter(config, bucket);
  const cohortFilter = cohortDate ? `cohort_date = '${cohortDate}'` : "1=1";

  if (status === "retained") {
    return `${withClause}
SELECT DISTINCT uid FROM returns
WHERE ${cohortFilter}
  AND ${filter}`;
  }

  // churned
  return `${withClause}
SELECT c.uid FROM cohort c
WHERE c.${cohortFilter}
  AND c.uid NOT IN (
    SELECT DISTINCT uid FROM returns
    WHERE ${cohortFilter}
      AND ${filter}
  )`;
}
