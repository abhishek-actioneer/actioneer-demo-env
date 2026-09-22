import type { DatasetConfig } from "./datasets/types";
import type { FunnelConfig, ConversionWindow } from "./funnel-types";
import type { EventDefinition, PropertyFilter } from "./explorer-types";

// ── Helpers ──

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

function windowToInterval(w: ConversionWindow): string {
  const map: Record<ConversionWindow, string> = {
    "1h": "1 HOUR",
    "1d": "1 DAY",
    "7d": "7 DAYS",
    "30d": "30 DAYS",
    "90d": "90 DAYS",
  };
  return map[w] ?? "30 DAYS";
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
    case "gte": return `${col} >= ${val}`;
    case "lte": return `${col} <= ${val}`;
    case "contains":
      return `${col} ILIKE '%${escapeStr(String(val))}%'`;
    case "in":
      if (Array.isArray(val)) {
        return `${col} IN (${val.map((v) => `'${escapeStr(String(v))}'`).join(", ")})`;
      }
      return `${col} = '${escapeStr(String(val))}'`;
    case "not_in":
      if (Array.isArray(val)) {
        return `${col} NOT IN (${val.map((v) => `'${escapeStr(String(v))}'`).join(", ")})`;
      }
      return `${col} != '${escapeStr(String(val))}'`;
    default:
      return "1=1";
  }
}

export function resolveDateRange(
  config: FunnelConfig,
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

// ── Ordering modes ──

export type FunnelOrder = "this_order" | "any_order" | "exact_order";

// ── Session property detection ──

const SESSION_COLUMN_PATTERNS = /^(session_id|session|sessionid|session_number)$/i;

/** Detect a session-like column from event definitions. Returns column name or null. */
export function detectSessionProperty(events: EventDefinition[]): string | null {
  for (const ev of events) {
    for (const p of ev.properties) {
      if (SESSION_COLUMN_PATTERNS.test(p.column)) {
        return p.column;
      }
    }
  }
  return null;
}

// ── Main compiler ──

export function compileFunnelSQL(
  config: FunnelConfig,
  dataset: DatasetConfig,
  segmentSQL?: string,
): string | null {
  if (config.steps.length < 2) return null;

  const events = dataset.events ?? [];
  const userIdField = dataset.userIdField ?? "user_id";
  const defaultDateCol = dataset.dateField ?? "date";
  const dateRange = resolveDateRange(config, dataset);
  const interval = windowToInterval(config.conversionWindow);
  const breakdown = config.breakdown;
  const order: FunnelOrder = (config as { order?: FunnelOrder }).order ?? "this_order";
  const countingMethod = config.countingMethod ?? "uniques";
  const isTotals = countingMethod === "totals";

  // Sessions mode: partition by the dataset's session property if one exists.
  // Internal implementation detail — not user-configurable.
  const isSessions = countingMethod === "sessions";
  const sessionCol = isSessions ? detectSessionProperty(events) : null;
  const partitionCols: string[] = sessionCol ? [sessionCol] : [];

  const resolved = config.steps.map((step) => {
    const def = events.find((e) => e.id === step.eventId);
    return { step, def };
  });

  if (resolved.some((r) => !r.def)) return null;

  const ctes: string[] = [];
  const bCol = breakdown ? quoteIdent(breakdown) : null;

  // Sessions partition columns (internal — was previously "hold-constant")
  const hcCols = partitionCols.map((c) => quoteIdent(c));

  // Build CTEs per step
  for (let i = 0; i < resolved.length; i++) {
    const { step, def } = resolved[i];
    const dateCol = def!.dateColumn ?? defaultDateCol;
    const table = def!.table;

    const conditions: string[] = [];

    // Event filter
    if (def!.filterColumn && def!.filterValue) {
      conditions.push(`${quoteIdent(def!.filterColumn)} = '${escapeStr(def!.filterValue)}'`);
    }
    if (def!.filterSQL) {
      conditions.push(`(${def!.filterSQL})`);
    }

    // Per-step filters
    if (step.filters?.length) {
      for (const f of step.filters) conditions.push(filterToSQL(f));
    }

    if (i === 0) {
      // Entry step
      conditions.push(`${quoteIdent(dateCol)}::TIMESTAMP >= '${dateRange.start}'::TIMESTAMP`);
      conditions.push(`${quoteIdent(dateCol)}::TIMESTAMP <= '${dateRange.end} 23:59:59'::TIMESTAMP`);

      if (segmentSQL) {
        conditions.push(`${quoteIdent(userIdField)} IN (${segmentSQL})`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join("\n    AND ")}` : "";

      if (isTotals) {
        // Totals: keep every entry, assign attempt_id
        const selectCols = [
          `${quoteIdent(userIdField)} AS uid`,
          `ROW_NUMBER() OVER (PARTITION BY ${quoteIdent(userIdField)} ORDER BY ${quoteIdent(dateCol)}::TIMESTAMP) AS attempt_id`,
          `${quoteIdent(dateCol)}::TIMESTAMP AS t0`,
        ];
        if (bCol) selectCols.push(`${bCol} AS bk`);
        for (const hc of hcCols) selectCols.push(`${hc}`);

        ctes.push(`step0 AS (
  SELECT ${selectCols.join(", ")}
  FROM ${quoteIdent(table)}
  ${where}
)`);
      } else {
        // Uniques: first entry per user
        const selectCols = [
          `${quoteIdent(userIdField)} AS uid`,
          `MIN(${quoteIdent(dateCol)}::TIMESTAMP) AS t0`,
        ];
        if (bCol) selectCols.push(`${bCol} AS bk`);
        for (const hc of hcCols) selectCols.push(`${hc}`);

        const groupCols = [quoteIdent(userIdField)];
        if (bCol) groupCols.push(bCol);
        for (const hc of hcCols) groupCols.push(hc);

        ctes.push(`step0 AS (
  SELECT DISTINCT ${selectCols.join(", ")}
  FROM ${quoteIdent(table)}
  ${where}
  GROUP BY ${groupCols.join(", ")}
)`);
      }
    } else {
      // Subsequent step
      const joinIdx = order === "any_order" ? 0 : i - 1;
      const timeCol = `prev.t${joinIdx}`;

      const timeCondition = order === "any_order"
        ? `e.${quoteIdent(dateCol)}::TIMESTAMP >= ${timeCol} AND e.${quoteIdent(dateCol)}::TIMESTAMP <= ${timeCol} + INTERVAL '${interval}'`
        : `e.${quoteIdent(dateCol)}::TIMESTAMP > ${timeCol} AND e.${quoteIdent(dateCol)}::TIMESTAMP <= ${timeCol} + INTERVAL '${interval}'`;

      const extraWhere = conditions.length > 0 ? `AND ${conditions.join("\n    AND ")}` : "";

      // Sessions partition JOIN: require same session value across steps
      const hcJoins = hcCols.map((hc) => `AND e.${hc} = prev.${hc}`).join("\n    ");

      const selectCols = [`prev.uid`, `MIN(e.${quoteIdent(dateCol)}::TIMESTAMP) AS t${i}`];
      if (isTotals) selectCols.splice(1, 0, `prev.attempt_id`);
      if (bCol) selectCols.push(`prev.bk`);
      for (const hc of hcCols) selectCols.push(`prev.${hc}`);

      const groupCols = [`prev.uid`];
      if (isTotals) groupCols.push(`prev.attempt_id`);
      if (bCol) groupCols.push(`prev.bk`);
      for (const hc of hcCols) groupCols.push(`prev.${hc}`);

      ctes.push(`step${i} AS (
  SELECT DISTINCT ${selectCols.join(", ")}
  FROM step${joinIdx} prev
  JOIN ${quoteIdent(table)} e ON e.${quoteIdent(userIdField)} = prev.uid
  WHERE ${timeCondition}
    ${hcJoins}
    ${extraWhere}
  GROUP BY ${groupCols.join(", ")}
)`);
    }
  }

  // Final SELECT
  if (bCol) {
    const unions: string[] = [];
    for (let i = 0; i < resolved.length; i++) {
      unions.push(`SELECT ${i} AS step_index, bk AS breakdown, COUNT(*) AS user_count FROM step${i} GROUP BY bk`);
    }
    const sql = `WITH ${ctes.join(",\n")}\n${unions.join("\nUNION ALL\n")}\nORDER BY step_index, breakdown`;
    return sql;
  }

  // Without breakdown: scalar counts + avg times
  const selects: string[] = [];
  for (let i = 0; i < resolved.length; i++) {
    selects.push(`(SELECT COUNT(*) FROM step${i}) AS step${i}_count`);
    if (i > 0) {
      const joinCond = `s${i}.uid = s${i - 1}.uid${isTotals ? " AND s" + i + ".attempt_id = s" + (i - 1) + ".attempt_id" : ""}`;
      selects.push(
        `(SELECT AVG(EPOCH(s${i}.t${i} - s${i - 1}.t${i - 1})) FROM step${i} s${i} JOIN step${i - 1} s${i - 1} ON ${joinCond}) AS step${i}_avg_time`,
      );
      selects.push(
        `(SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EPOCH(s${i}.t${i} - s${i - 1}.t${i - 1})) FROM step${i} s${i} JOIN step${i - 1} s${i - 1} ON ${joinCond}) AS step${i}_median_time`,
      );
    }
  }

  const sql = `WITH ${ctes.join(",\n")}\nSELECT ${selects.join(",\n  ")}`;
  return sql;
}
