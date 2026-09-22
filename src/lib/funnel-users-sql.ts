import type { DatasetConfig } from "./datasets/types";
import type { FunnelConfig } from "./funnel-types";
import { compileFunnelSQL } from "./funnel-sql";

/**
 * Compile SQL to retrieve user IDs for a specific funnel step.
 *
 * - "converted" at step N: users who reached step N
 * - "dropped" at step N: users who reached step N-1 but NOT step N
 * - "dropped" at step 0: not applicable (returns null)
 */
export function compileFunnelUsersSQL(
  config: FunnelConfig,
  dataset: DatasetConfig,
  stepIndex: number,
  status: "converted" | "dropped",
  limit = 50,
  offset = 0,
): string | null {
  if (config.steps.length < 2) return null;
  if (stepIndex < 0 || stepIndex >= config.steps.length) return null;
  if (status === "dropped" && stepIndex === 0) return null;

  const baseSql = compileFunnelSQL(config, dataset);
  if (!baseSql) return null;

  // Extract the WITH clause (everything before the final SELECT)
  const withMatch = baseSql.match(/^(WITH [\s\S]+?)(\nSELECT )/);
  if (!withMatch) return null;

  const withClause = withMatch[1];
  const isTotals = config.countingMethod === "totals";

  if (status === "converted") {
    // Users who reached step N
    if (isTotals) {
      return `${withClause}
SELECT DISTINCT uid FROM step${stepIndex}
ORDER BY uid
LIMIT ${limit} OFFSET ${offset}`;
    }
    return `${withClause}
SELECT uid FROM step${stepIndex}
ORDER BY uid
LIMIT ${limit} OFFSET ${offset}`;
  }

  // status === "dropped": users in step N-1 but NOT in step N
  const prevStep = stepIndex - 1;
  if (isTotals) {
    return `${withClause}
SELECT DISTINCT s_prev.uid
FROM step${prevStep} s_prev
LEFT JOIN step${stepIndex} s_next ON s_next.uid = s_prev.uid AND s_next.attempt_id = s_prev.attempt_id
WHERE s_next.uid IS NULL
ORDER BY s_prev.uid
LIMIT ${limit} OFFSET ${offset}`;
  }
  return `${withClause}
SELECT s_prev.uid
FROM step${prevStep} s_prev
LEFT JOIN step${stepIndex} s_next ON s_next.uid = s_prev.uid
WHERE s_next.uid IS NULL
ORDER BY s_prev.uid
LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * Compile a COUNT query to get total users for a step/status combination.
 */
export function compileFunnelUsersCountSQL(
  config: FunnelConfig,
  dataset: DatasetConfig,
  stepIndex: number,
  status: "converted" | "dropped",
): string | null {
  if (config.steps.length < 2) return null;
  if (stepIndex < 0 || stepIndex >= config.steps.length) return null;
  if (status === "dropped" && stepIndex === 0) return null;

  const baseSql = compileFunnelSQL(config, dataset);
  if (!baseSql) return null;

  const withMatch = baseSql.match(/^(WITH [\s\S]+?)(\nSELECT )/);
  if (!withMatch) return null;

  const withClause = withMatch[1];
  const isTotals = config.countingMethod === "totals";

  if (status === "converted") {
    if (isTotals) {
      return `${withClause}
SELECT COUNT(DISTINCT uid) AS total FROM step${stepIndex}`;
    }
    return `${withClause}
SELECT COUNT(*) AS total FROM step${stepIndex}`;
  }

  // dropped
  const prevStep = stepIndex - 1;
  if (isTotals) {
    return `${withClause}
SELECT COUNT(DISTINCT s_prev.uid) AS total
FROM step${prevStep} s_prev
LEFT JOIN step${stepIndex} s_next ON s_next.uid = s_prev.uid AND s_next.attempt_id = s_prev.attempt_id
WHERE s_next.uid IS NULL`;
  }
  return `${withClause}
SELECT COUNT(*) AS total
FROM step${prevStep} s_prev
LEFT JOIN step${stepIndex} s_next ON s_next.uid = s_prev.uid
WHERE s_next.uid IS NULL`;
}

/**
 * Compile a segment-definition SQL for drop-off users at a given step.
 * Returns a SELECT of user IDs (no LIMIT) suitable for saving as a segment.
 */
export function compileFunnelDropoffSegmentSQL(
  config: FunnelConfig,
  dataset: DatasetConfig,
  stepIndex: number,
): string | null {
  if (config.steps.length < 2) return null;
  if (stepIndex < 1 || stepIndex >= config.steps.length) return null;

  const baseSql = compileFunnelSQL(config, dataset);
  if (!baseSql) return null;

  const withMatch = baseSql.match(/^(WITH [\s\S]+?)(\nSELECT )/);
  if (!withMatch) return null;

  const withClause = withMatch[1];
  const isTotals = config.countingMethod === "totals";
  const prevStep = stepIndex - 1;

  if (isTotals) {
    return `${withClause}
SELECT DISTINCT s_prev.uid
FROM step${prevStep} s_prev
LEFT JOIN step${stepIndex} s_next ON s_next.uid = s_prev.uid AND s_next.attempt_id = s_prev.attempt_id
WHERE s_next.uid IS NULL`;
  }

  return `${withClause}
SELECT s_prev.uid
FROM step${prevStep} s_prev
LEFT JOIN step${stepIndex} s_next ON s_next.uid = s_prev.uid
WHERE s_next.uid IS NULL`;
}
