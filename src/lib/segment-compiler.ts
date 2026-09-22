import type { DatasetConfig } from "./datasets/types";
import type { EventDefinition, PropertyFilter, DateRangePreset } from "./explorer-types";
import type {
  SegmentBuilderConfig,
  EventRule,
  AttributeRule,
  OccurrenceConstraint,
} from "./segment-builder-types";

// ── SQL helpers (mirrored from funnel-sql) ──

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

function occurrenceSQL(c: OccurrenceConstraint): string {
  const ops: Record<string, string> = { gte: ">=", gt: ">", eq: "=", lte: "<=", lt: "<" };
  return `COUNT(*) ${ops[c.op]} ${Number.isFinite(c.value) ? c.value : 1}`;
}

function resolveDateRange(
  range: SegmentBuilderConfig["dateRange"],
  dataset: DatasetConfig,
): { start: string; end: string } | null {
  if ("preset" in range && range.preset === "all") return null;
  if ("start" in range) return { start: range.start, end: range.end };
  const endDate = dataset.dateRange ? new Date(dataset.dateRange.end) : new Date();
  const days: Record<DateRangePreset, number> = { "7d": 7, "30d": 30, "60d": 60, "90d": 90, "1y": 365 };
  const d = days[(range as { preset: DateRangePreset }).preset] ?? 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - d);
  return {
    start: startDate.toISOString().split("T")[0],
    end: endDate.toISOString().split("T")[0],
  };
}

// ── Rule → SELECT user_id CTE body ──

function eventRuleSQL(
  rule: EventRule,
  dataset: DatasetConfig,
  userIdField: string,
  dateRange: { start: string; end: string } | null,
): string | null {
  const events = dataset.events ?? [];
  const def = events.find((e) => e.id === rule.eventId);
  if (!def) return null;

  const table = def.table;
  const dateCol = def.dateColumn ?? dataset.dateField;

  const conds: string[] = [];
  if (def.filterColumn && def.filterValue) {
    conds.push(`${quoteIdent(def.filterColumn)} = '${escapeStr(def.filterValue)}'`);
  }
  if (def.filterSQL) conds.push(`(${def.filterSQL})`);

  for (const f of rule.filters ?? []) conds.push(filterToSQL(f));

  if (dateRange && dateCol) {
    const ts = `TRY_CAST(${quoteIdent(dateCol)} AS TIMESTAMP)`;
    conds.push(`${ts} >= '${dateRange.start}'::TIMESTAMP`);
    conds.push(`${ts} <= '${dateRange.end} 23:59:59'::TIMESTAMP`);
  }

  conds.push(`${quoteIdent(userIdField)} IS NOT NULL`);

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  if (rule.occurrence) {
    const having = occurrenceSQL(rule.occurrence);
    return `SELECT ${quoteIdent(userIdField)} AS user_id
      FROM ${quoteIdent(table)}
      ${where}
      GROUP BY ${quoteIdent(userIdField)}
      HAVING ${having}`;
  }

  return `SELECT DISTINCT ${quoteIdent(userIdField)} AS user_id
    FROM ${quoteIdent(table)}
    ${where}`;
}

function attributeRuleSQL(
  rule: AttributeRule,
  dataset: DatasetConfig,
  userIdField: string,
): string {
  const table = dataset.primaryTable;
  return `SELECT DISTINCT ${quoteIdent(userIdField)} AS user_id
    FROM ${quoteIdent(table)}
    WHERE ${filterToSQL(rule.filter)}
      AND ${quoteIdent(userIdField)} IS NOT NULL`;
}

// ── Main compiler ──

export interface CompileResult {
  sql: string;
  warnings: string[];
}

export interface TimeSeriesCompileResult {
  sql: string;
  warnings: string[];
}

interface TimeSeriesWindow {
  chartStart: string;
  chartEnd: string;
  mode: "all" | "bucketed" | "custom";
  fixedStart?: string;
}

function resolveTimeSeriesWindow(
  range: SegmentBuilderConfig["dateRange"],
  dataset: DatasetConfig,
): TimeSeriesWindow {
  const end = dataset.dateRange?.end ?? new Date().toISOString().slice(0, 10);
  const datasetStart = dataset.dateRange?.start ?? (() => {
    const fallback = new Date(`${end}T00:00:00Z`);
    fallback.setUTCFullYear(fallback.getUTCFullYear() - 1);
    return fallback.toISOString().slice(0, 10);
  })();

  if ("preset" in range && range.preset === "all") {
    return { chartStart: datasetStart, chartEnd: end, mode: "all" };
  }
  if ("start" in range) {
    return { chartStart: range.start, chartEnd: range.end, mode: "custom", fixedStart: range.start };
  }

  const days: Record<DateRangePreset, number> = { "7d": 7, "30d": 30, "60d": 60, "90d": 90, "1y": 365 };
  const lookbackDays = days[range.preset] ?? 30;
  const endDate = new Date(`${end}T00:00:00Z`);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays);
  return {
    chartStart: startDate.toISOString().slice(0, 10),
    chartEnd: end,
    mode: "bucketed",
  };
}

function periodWindowConditions(ts: string, window: TimeSeriesWindow): string[] {
  const conds = [`${ts} <= periods.period_end`];
  if (window.mode === "bucketed") {
    conds.push(`${ts} >= GREATEST(CAST(periods.period AS TIMESTAMP), '${window.chartStart}'::TIMESTAMP)`);
  } else if (window.mode === "custom" && window.fixedStart) {
    conds.push(`${ts} >= '${window.fixedStart}'::TIMESTAMP`);
  }
  return conds;
}

function eventRuleWindowSQL(
  rule: EventRule,
  def: EventDefinition,
  dataset: DatasetConfig,
  userIdField: string,
  window: TimeSeriesWindow,
  options: { includeBreakdown?: boolean; breakdown?: string } = {},
): string {
  const dateCol = def.dateColumn ?? dataset.dateField ?? "date";
  const ts = `TRY_CAST(${quoteIdent(dateCol)} AS TIMESTAMP)`;
  const conds: string[] = [];

  if (def.filterColumn && def.filterValue) {
    conds.push(`${quoteIdent(def.filterColumn)} = '${escapeStr(def.filterValue)}'`);
  }
  if (def.filterSQL) conds.push(`(${def.filterSQL})`);
  for (const f of rule.filters ?? []) conds.push(filterToSQL(f));
  conds.push(`${ts} IS NOT NULL`);
  conds.push(`${quoteIdent(userIdField)} IS NOT NULL`);

  const breakdownExpr = options.includeBreakdown && options.breakdown
    ? `COALESCE(CAST(${quoteIdent(options.breakdown)} AS VARCHAR), '(empty)') AS breakdown`
    : null;
  const selectCols = [
    "periods.period",
    `${quoteIdent(userIdField)} AS user_id`,
    ...(breakdownExpr ? [breakdownExpr] : []),
  ];
  const joinConditions = periodWindowConditions(ts, window);
  const where = `WHERE ${conds.join(" AND ")}`;
  const base = `SELECT ${selectCols.join(", ")}
      FROM periods
      JOIN ${quoteIdent(def.table)} ON ${joinConditions.join(" AND ")}
      ${where}`;
  const groupCols = [
    "period",
    "user_id",
    ...(breakdownExpr ? ["breakdown"] : []),
  ];

  if (rule.occurrence) {
    return `SELECT ${groupCols.join(", ")}
    FROM (${base}) __window_events
    GROUP BY ${groupCols.join(", ")}
    HAVING ${occurrenceSQL(rule.occurrence)}`;
  }

  return `SELECT DISTINCT ${groupCols.join(", ")}
    FROM (${base}) __window_events`;
}

function periodsCTE(window: TimeSeriesWindow): string {
  return `periods AS (
  SELECT CAST(period AS DATE) AS period,
         LEAST(
           CAST(period AS TIMESTAMP) + INTERVAL 6 DAY + INTERVAL 23 HOUR + INTERVAL 59 MINUTE + INTERVAL 59 SECOND,
           '${window.chartEnd} 23:59:59'::TIMESTAMP
         ) AS period_end
  FROM generate_series(
    DATE_TRUNC('week', '${window.chartStart}'::DATE)::DATE,
    DATE_TRUNC('week', '${window.chartEnd}'::DATE)::DATE,
    INTERVAL 1 WEEK
  ) AS t(period)
)`;
}

function attributeRuleTimeSeriesSQL(rule: AttributeRule, dataset: DatasetConfig, userIdField: string): string {
  return `SELECT DISTINCT ${quoteIdent(userIdField)} AS user_id
    FROM ${quoteIdent(dataset.primaryTable)}
    WHERE ${filterToSQL(rule.filter)}
      AND ${quoteIdent(userIdField)} IS NOT NULL`;
}

/**
 * Compiles a visual segment config into weekly segment trend points.
 * Preset windows are bucketed inside the selected range so the chart shows
 * weekly activity instead of a rolling-window decay. All-time/custom windows
 * still accumulate through each week so the latest point matches the headline
 * segment count.
 */
export function compileSegmentTimeSeriesSQL(
  config: SegmentBuilderConfig,
  dataset: DatasetConfig,
  breakdown?: string,
): TimeSeriesCompileResult | null {
  const events = dataset.events ?? [];
  const userIdField = dataset.userIdField ?? "user_id";
  const window = resolveTimeSeriesWindow(config.dateRange, dataset);
  const warnings: string[] = [];

  const positiveEvents = config.rules.filter(
    (rule): rule is EventRule => rule.kind === "event" && rule.action === "did",
  );
  const negativeEvents = config.rules.filter(
    (rule): rule is EventRule => rule.kind === "event" && rule.action === "did_not",
  );
  const attributeRules = config.rules.filter(
    (rule): rule is AttributeRule => rule.kind === "attribute",
  );

  if (!positiveEvents.length && !attributeRules.length) return null;

  const resolvedPositives = positiveEvents.map((rule) => ({
    rule,
    def: events.find((event) => event.id === rule.eventId),
  }));
  const resolvedNegatives = negativeEvents.map((rule) => ({
    rule,
    def: events.find((event) => event.id === rule.eventId),
  }));

  if (resolvedPositives.some((item) => !item.def) || resolvedNegatives.some((item) => !item.def)) {
    return null;
  }

  if (breakdown) {
    if (!positiveEvents.length) return null;
    if (config.combinator === "OR" && attributeRules.length > 0) return null;
    const anchorDefs = config.combinator === "OR"
      ? resolvedPositives.map((item) => item.def!)
      : [resolvedPositives[0].def!];
    const missingBreakdown = anchorDefs.some(
      (def) => !def.properties.some((property) => property.column === breakdown),
    );
    if (missingBreakdown) return null;
  }

  const ctes: string[] = [periodsCTE(window)];
  resolvedPositives.forEach(({ rule, def }, index) => {
    ctes.push(`pos${index} AS (
  ${eventRuleWindowSQL(rule, def!, dataset, userIdField, window, {
    includeBreakdown: Boolean(breakdown) && (config.combinator === "OR" || index === 0),
    breakdown,
  }).replace(/\n/g, "\n  ")}
)`);
  });
  resolvedNegatives.forEach(({ rule, def }, index) => {
    ctes.push(`neg${index} AS (
  ${eventRuleWindowSQL(rule, def!, dataset, userIdField, window).replace(/\n/g, "\n  ")}
)`);
  });
  attributeRules.forEach((rule, index) => {
    ctes.push(`attr${index} AS (
  ${attributeRuleTimeSeriesSQL(rule, dataset, userIdField).replace(/\n/g, "\n  ")}
)`);
  });

  let matchedSQL: string;
  if (config.combinator === "OR") {
    const unionParts = [
      ...resolvedPositives.map((_, index) => `SELECT period, user_id${breakdown ? ", breakdown" : ""} FROM pos${index}`),
      ...attributeRules.map((_, index) => `SELECT periods.period, attr${index}.user_id FROM periods CROSS JOIN attr${index}`),
    ];
    if (!unionParts.length) return null;

    ctes.push(`unioned AS (
  ${unionParts.join("\n  UNION ALL\n  ")}
)`);
    const exclusions = resolvedNegatives
      .map((_, index) => `NOT EXISTS (
      SELECT 1 FROM neg${index} n${index}
      WHERE n${index}.period = __unioned.period AND n${index}.user_id = __unioned.user_id
    )`);
    matchedSQL = `SELECT DISTINCT period, user_id${breakdown ? ", breakdown" : ""}
    FROM unioned __unioned
    ${exclusions.length ? `WHERE ${exclusions.join("\n      AND ")}` : ""}`;
  } else {
    const anchor = positiveEvents.length > 0
      ? { alias: "p0", sql: `pos0 p0`, hasBreakdown: Boolean(breakdown) }
      : { alias: "a0", sql: `periods CROSS JOIN attr0 a0`, hasBreakdown: false };
    const joins: string[] = [];
    const positiveStart = positiveEvents.length > 0 ? 1 : 0;
    for (let i = positiveStart; i < resolvedPositives.length; i++) {
      joins.push(`JOIN pos${i} p${i} ON p${i}.period = ${anchor.alias}.period AND p${i}.user_id = ${anchor.alias}.user_id`);
    }
    const attributeStart = positiveEvents.length > 0 ? 0 : 1;
    for (let i = attributeStart; i < attributeRules.length; i++) {
      joins.push(`JOIN attr${i} a${i} ON a${i}.user_id = ${anchor.alias}.user_id`);
    }
    const exclusions = resolvedNegatives
      .map((_, index) => `NOT EXISTS (
      SELECT 1 FROM neg${index} n${index}
      WHERE n${index}.period = ${anchor.alias}.period AND n${index}.user_id = ${anchor.alias}.user_id
    )`);
    matchedSQL = `SELECT ${anchor.alias}.period, ${anchor.alias}.user_id${breakdown && anchor.hasBreakdown ? `, ${anchor.alias}.breakdown` : ""}
    FROM ${anchor.sql}
    ${joins.join("\n    ")}
    ${exclusions.length ? `WHERE ${exclusions.join("\n      AND ")}` : ""}`;
  }

  ctes.push(`matched AS (
  ${matchedSQL.replace(/\n/g, "\n  ")}
)`);

  const sql = breakdown
    ? `WITH ${ctes.join(",\n")},
counts AS (
  SELECT period, breakdown, COUNT(DISTINCT user_id) AS count
  FROM matched
  GROUP BY period, breakdown
)
SELECT period, breakdown, count
FROM counts
ORDER BY period, count DESC`
    : `WITH ${ctes.join(",\n")},
counts AS (
  SELECT period, COUNT(DISTINCT user_id) AS count
  FROM matched
  GROUP BY period
)
SELECT periods.period, COALESCE(counts.count, 0) AS count
FROM periods
LEFT JOIN counts ON counts.period = periods.period
ORDER BY periods.period`;

  return { sql, warnings };
}

/**
 * Compiles a visual segment config into a `SELECT DISTINCT user_id` SQL statement.
 * Positive rules ("did", attribute) combine via combinator.
 * Negative rules ("did_not") are EXCEPTed against the positive base.
 * Returns null if the config is invalid (no positives, unresolved events, etc.).
 */
export function compileSegmentSQL(
  config: SegmentBuilderConfig,
  dataset: DatasetConfig,
): CompileResult | null {
  const userIdField = dataset.userIdField ?? "user_id";
  const dateRange = resolveDateRange(config.dateRange, dataset);
  const warnings: string[] = [];

  const positives: string[] = [];
  const negatives: string[] = [];

  for (const rule of config.rules) {
    if (rule.kind === "event") {
      const body = eventRuleSQL(rule, dataset, userIdField, dateRange);
      if (!body) {
        warnings.push(`Event "${rule.eventId}" not found in this dataset.`);
        continue;
      }
      if (rule.action === "did_not") negatives.push(body);
      else positives.push(body);
    } else {
      positives.push(attributeRuleSQL(rule, dataset, userIdField));
    }
  }

  if (!positives.length) return null;

  const joinOp = config.combinator === "OR" ? "UNION" : "INTERSECT";
  const basePopulation = positives
    .map((p, i) => `  -- positive ${i + 1}\n  ${p.replace(/\n/g, "\n  ")}`)
    .join(`\n${joinOp}\n`);

  let sql = positives.length === 1
    ? `SELECT DISTINCT user_id FROM (\n${basePopulation}\n) __seg`
    : `SELECT DISTINCT user_id FROM (\n${basePopulation}\n) __seg`;

  // Wrap in CTE so EXCEPT works cleanly
  if (negatives.length) {
    const negBlock = negatives
      .map((n) => `  ${n.replace(/\n/g, "\n  ")}`)
      .join("\n  UNION\n");
    sql = `WITH __base AS (
${positives.length === 1 ? basePopulation : `SELECT user_id FROM (\n${basePopulation}\n) __p`}
),
__excluded AS (
${negBlock}
)
SELECT DISTINCT user_id FROM __base
WHERE user_id NOT IN (SELECT user_id FROM __excluded)`;
  }

  return { sql, warnings };
}

// ── Label helper for UI ──

export function ruleLabel(
  rule: import("./segment-builder-types").SegmentRule,
  events: EventDefinition[],
): string {
  if (rule.kind === "attribute") {
    return `Has ${rule.filter.property}`;
  }
  const def = events.find((e) => e.id === rule.eventId);
  const name = def?.displayName ?? rule.eventId;
  return rule.action === "did_not" ? `Did not do ${name}` : `Did ${name}`;
}
