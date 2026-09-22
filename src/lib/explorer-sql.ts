import type { DatasetConfig } from "./datasets/types";
import type {
  ExplorerConfig,
  EventDefinition,
  EventSelection,
  PropertyFilter,
} from "./explorer-types";

// ── Date range resolution ──

function resolveDateRange(
  config: ExplorerConfig,
  dataset: DatasetConfig,
): { start: string; end: string } {
  if ("start" in config.dateRange) {
    // Clamp to dataset range if the requested dates are entirely outside it
    if (dataset.dateRange) {
      const reqStart = config.dateRange.start;
      const reqEnd = config.dateRange.end;
      const dsEnd = dataset.dateRange.end;
      const dsStart = dataset.dateRange.start;
      if (reqStart > dsEnd) {
        // Requested range is entirely after dataset — shift to last N days of dataset
        const span = Math.round((new Date(reqEnd).getTime() - new Date(reqStart).getTime()) / 86400000);
        const end = new Date(dsEnd);
        const start = new Date(end);
        start.setDate(start.getDate() - Math.max(span, 30));
        if (start.toISOString().split("T")[0] < dsStart) {
          return { start: dsStart, end: dsEnd };
        }
        return { start: start.toISOString().split("T")[0], end: dsEnd };
      }
    }
    return { start: config.dateRange.start, end: config.dateRange.end };
  }
  // Preset: compute from dataset's date range end (or today)
  const endDate = dataset.dateRange
    ? new Date(dataset.dateRange.end)
    : new Date();
  const days: Record<string, number> = {
    "7d": 7,
    "30d": 30,
    "60d": 60,
    "90d": 90,
    "1y": 365,
  };
  const d = days[config.dateRange.preset] ?? 30;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - d);
  return {
    start: startDate.toISOString().split("T")[0],
    end: endDate.toISOString().split("T")[0],
  };
}

// ── Granularity to DuckDB DATE_TRUNC ──

function granularityBucket(
  granularity: ExplorerConfig["granularity"],
  dateCol: string,
): string {
  const unit: Record<string, string> = {
    hourly: "hour",
    daily: "day",
    weekly: "week",
    monthly: "month",
  };
  return `DATE_TRUNC('${unit[granularity] ?? "day"}', ${dateCol}::TIMESTAMP)`;
}

// ── Filter to SQL WHERE clause fragment ──

function filterToSQL(f: PropertyFilter): string {
  const col = quoteIdent(f.property);
  const val = f.value;

  switch (f.operator) {
    case "eq":
      return typeof val === "number" ? `${col} = ${val}` : `${col} = '${escapeStr(String(val))}'`;
    case "neq":
      return typeof val === "number" ? `${col} != ${val}` : `${col} != '${escapeStr(String(val))}'`;
    case "gt":
      return `${col} > ${val}`;
    case "lt":
      return `${col} < ${val}`;
    case "gte":
      return `${col} >= ${val}`;
    case "lte":
      return `${col} <= ${val}`;
    case "contains":
      return `${col} ILIKE '%${escapeStr(String(val))}%'`;
    case "in":
      if (Array.isArray(val)) {
        const items = val.map((v) => `'${escapeStr(String(v))}'`).join(", ");
        return `${col} IN (${items})`;
      }
      return `${col} = '${escapeStr(String(val))}'`;
    case "not_in":
      if (Array.isArray(val)) {
        const items = val.map((v) => `'${escapeStr(String(v))}'`).join(", ");
        return `${col} NOT IN (${items})`;
      }
      return `${col} != '${escapeStr(String(val))}'`;
    default:
      return "1=1";
  }
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

// ── Build aggregate expression for a measure type ──

function aggregateExpr(
  measureType: EventSelection["measureType"],
  event: EventDefinition,
  userIdField: string,
): string {
  switch (measureType) {
    case "uniques":
      return `COUNT(DISTINCT ${quoteIdent(userIdField)})`;
    case "event_totals":
      return "COUNT(*)";
    case "sum":
      return event.valueColumn
        ? `SUM(${quoteIdent(event.valueColumn)})`
        : "COUNT(*)";
    case "average":
      // Amplitude-style: events per user (COUNT(*) / COUNT(DISTINCT user_id))
      return `ROUND(COUNT(*)::DOUBLE / NULLIF(COUNT(DISTINCT ${quoteIdent(userIdField)}), 0), 2)`;
    case "active_pct":
      // % of total active users who triggered this event
      // Uses a window function: COUNT(DISTINCT user) for this bucket / total distinct users
      return `ROUND(100.0 * COUNT(DISTINCT ${quoteIdent(userIdField)})::DOUBLE / NULLIF(SUM(COUNT(DISTINCT ${quoteIdent(userIdField)})) OVER (), 0), 2)`;
    case "frequency":
      // Average events per user (same as average but labelled differently for clarity)
      return `ROUND(COUNT(*)::DOUBLE / NULLIF(COUNT(DISTINCT ${quoteIdent(userIdField)}), 0), 2)`;
    default:
      return "COUNT(*)";
  }
}

// ── Build SQL for a single event ──

function buildSingleEventSQL(
  eventSel: EventSelection,
  event: EventDefinition,
  dataset: DatasetConfig,
  config: ExplorerConfig,
  dateRange: { start: string; end: string },
  segmentSQLs: string[],
  options: { includeLimit?: boolean; includeOrderBy?: boolean } = {},
): string {
  const { includeLimit = true, includeOrderBy = true } = options;
  const dateCol = event.dateColumn ?? dataset.dateField ?? "date";
  const userIdField = dataset.userIdField ?? "user_id";
  const table = event.table;
  const timeBucket = granularityBucket(config.granularity, dateCol);
  const agg = aggregateExpr(eventSel.measureType, event, userIdField);

  // SELECT clause
  const selectCols: string[] = [`${timeBucket} AS period`];
  if (config.breakdown) {
    selectCols.push(`${quoteIdent(config.breakdown)} AS breakdown`);
  }
  selectCols.push(`${agg} AS value`);

  // WHERE clause
  const conditions: string[] = [];

  // Date range — cast column to TIMESTAMP (column may be VARCHAR)
  conditions.push(
    `${quoteIdent(dateCol)}::TIMESTAMP >= '${dateRange.start}'::TIMESTAMP`,
  );
  conditions.push(
    `${quoteIdent(dateCol)}::TIMESTAMP <= '${dateRange.end} 23:59:59'::TIMESTAMP`,
  );

  // Event filter (e.g. event_type = 'purchase')
  if (event.filterColumn && event.filterValue) {
    conditions.push(
      `${quoteIdent(event.filterColumn)} = '${escapeStr(event.filterValue)}'`,
    );
  }
  if (event.filterSQL) {
    conditions.push(`(${event.filterSQL})`);
  }

  // Property filters
  if (eventSel.filters?.length) {
    for (const f of eventSel.filters) {
      conditions.push(filterToSQL(f));
    }
  }

  // Segment filters
  for (const segSQL of segmentSQLs) {
    conditions.push(`${quoteIdent(userIdField)} IN (${segSQL})`);
  }

  // GROUP BY
  const groupByCols: string[] = ["period"];
  if (config.breakdown) {
    groupByCols.push(quoteIdent(config.breakdown));
  }

  const orderClause = includeOrderBy ? "\nORDER BY period ASC" : "";
  const limitClause = includeLimit ? " LIMIT 500" : "";

  return `SELECT ${selectCols.join(", ")}
FROM ${quoteIdent(table)}
WHERE ${conditions.join("\n  AND ")}
GROUP BY ${groupByCols.join(", ")}${orderClause}${limitClause}`;
}

// ── Main compiler ──

/**
 * Compile an ExplorerConfig into one or more SQL queries.
 * Returns null if the config cannot be compiled deterministically
 * (caller should fall back to LLM).
 */
export function compileExplorerSQL(
  config: ExplorerConfig,
  dataset: DatasetConfig,
  segmentSQLs: string[] = [],
): { sql: string; perEventLabels: string[] } | null {
  if (!config.events.length) return null;

  const events = dataset.events ?? [];
  const dateRange = resolveDateRange(config, dataset);

  // Resolve event definitions
  const resolved = config.events.map((sel) => {
    const def = events.find((e) => e.id === sel.eventId);
    return { sel, def };
  });

  // Check all events are known
  if (resolved.some((r) => !r.def)) return null;

  const perEventLabels = resolved.map(
    (r) => r.def!.displayName,
  );

  if (resolved.length === 1) {
    // Single event — simple query
    const { sel, def } = resolved[0];
    const sql = buildSingleEventSQL(
      sel,
      def!,
      dataset,
      config,
      dateRange,
      segmentSQLs,
    );
    return { sql, perEventLabels };
  }

  // Multi-event — UNION ALL with event label column (no LIMIT on inner queries)
  const parts = resolved.map(({ sel, def }) => {
    const base = buildSingleEventSQL(
      sel,
      def!,
      dataset,
      config,
      dateRange,
      segmentSQLs,
      { includeLimit: false, includeOrderBy: false },
    );
    // Inject event_name into SELECT
    const eventLabel = escapeStr(def!.displayName);
    return base.replace(
      "SELECT ",
      `SELECT '${eventLabel}' AS event_name, `,
    );
  });

  const sql = parts.join("\nUNION ALL\n") + "\nORDER BY period ASC LIMIT 500";
  return { sql, perEventLabels };
}

/** Map explorer chart type to ChartSpec type + stacked flag */
function resolveChartType(ct: ExplorerConfig["chartType"]): { type: import("./chart-types").ChartSpec["type"]; stacked: boolean } {
  switch (ct) {
    case "stacked-bar": return { type: "bar", stacked: true };
    case "stacked-area": return { type: "area", stacked: true };
    case "pie": return { type: "pie", stacked: false };
    case "kpi": return { type: "bar", stacked: false }; // KPI rendered specially in UI, not by ChartSpec
    default: return { type: ct, stacked: false };
  }
}

/**
 * Build a ChartSpec from explorer query results.
 */
export function buildExplorerChartSpec(
  data: Record<string, unknown>[],
  config: ExplorerConfig,
  perEventLabels: string[],
): {
  chartSpec: import("./chart-types").ChartSpec;
  breakdownData?: Record<string, unknown>[];
  dates?: string[];
} {
  const { type: chartType, stacked } = resolveChartType(config.chartType);

  if (!data.length) {
    return {
      chartSpec: {
        type: chartType,
        title: "",
        data: [],
        xKey: "period",
        yKeys: ["value"],
      },
    };
  }

  const isMultiEvent = perEventLabels.length > 1;
  const hasBreakdown = !!config.breakdown;

  if (isMultiEvent) {
    // Pivot: rows have event_name + period + value
    const pivoted = new Map<string, Record<string, string | number>>();
    for (const row of data) {
      const period = String(row.period);
      if (!pivoted.has(period)) {
        pivoted.set(period, { period });
      }
      const eventName = String(row.event_name);
      const entry = pivoted.get(period)!;
      entry[eventName] = Number(row.value) || 0;
    }
    const chartData = Array.from(pivoted.values()).sort(
      (a, b) => String(a.period).localeCompare(String(b.period)),
    );

    return {
      chartSpec: applyComputation({
        type: chartType,
        title: perEventLabels.join(" vs "),
        data: chartData,
        xKey: "period",
        yKeys: perEventLabels,
        yLabels: perEventLabels,
        stacked,
      }, config),
    };
  }

  if (hasBreakdown) {
    // Pivot: rows have breakdown + period + value
    const breakdownValues = new Set<string>();
    const pivoted = new Map<string, Record<string, string | number>>();
    for (const row of data) {
      const period = String(row.period);
      const bv = String(row.breakdown ?? "Other");
      breakdownValues.add(bv);
      if (!pivoted.has(period)) {
        pivoted.set(period, { period });
      }
      pivoted.get(period)![bv] = Number(row.value) || 0;
    }
    const yKeys = Array.from(breakdownValues).slice(0, 10);
    const chartData = Array.from(pivoted.values()).sort(
      (a, b) => String(a.period).localeCompare(String(b.period)),
    );

    // Breakdown table: return raw rows for the date × breakdown matrix
    const breakdownData = data.map((row) => ({
      breakdown: String(row.breakdown ?? "Other"),
      period: String(row.period),
      value: Number(row.value) || 0,
    }));

    // Sorted unique dates
    const dates = Array.from(new Set(data.map((r) => String(r.period)))).sort();

    // Pie chart: aggregate totals per breakdown value
    const pieSpec = chartType === "pie" ? {
      type: "pie" as const,
      title: `${perEventLabels[0]} by ${config.breakdown}`,
      data: Array.from(breakdownValues).slice(0, 10).map((bv) => {
        const total = data
          .filter((r) => String(r.breakdown ?? "Other") === bv)
          .reduce((s, r) => s + (Number(r.value) || 0), 0);
        return { name: bv, value: Math.round(total * 100) / 100 };
      }).sort((a, b) => b.value - a.value) as Record<string, string | number>[],
      nameKey: "name",
      valueKey: "value",
    } : null;

    return {
      chartSpec: applyComputation(pieSpec ?? {
        type: chartType,
        title: `${perEventLabels[0]} by ${config.breakdown}`,
        data: chartData,
        xKey: "period",
        yKeys,
        yLabels: yKeys,
        stacked,
      }, config),
      breakdownData,
      dates,
    };
  }

  // Simple: single event, no breakdown
  const chartData: Record<string, string | number>[] = data.map((row) => ({
    period: String(row.period),
    value: Number(row.value) || 0,
  }));

  const spec: import("./chart-types").ChartSpec = {
    type: chartType,
    title: perEventLabels[0] ?? "",
    data: chartData,
    xKey: "period",
    yKeys: ["value"],
    yLabels: [perEventLabels[0] ?? "Value"],
    stacked,
  };

  return { chartSpec: applyComputation(spec, config) };
}

// ── Client-side data transformations ──

function applyComputation(
  spec: import("./chart-types").ChartSpec,
  config: ExplorerConfig,
): import("./chart-types").ChartSpec {
  const computation = config.computation ?? "none";
  if (computation === "none" || !spec.data.length || !spec.yKeys?.length) {
    return spec;
  }

  const yKeys = spec.yKeys;
  const window = config.rollingWindow ?? 7;

  if (computation === "rolling-avg") {
    const transformed = spec.data.map((row, i) => {
      const newRow: Record<string, string | number> = { [spec.xKey!]: row[spec.xKey!] };
      for (const yk of yKeys) {
        const start = Math.max(0, i - window + 1);
        let sum = 0;
        let count = 0;
        for (let j = start; j <= i; j++) {
          const v = Number(spec.data[j][yk]) || 0;
          sum += v;
          count++;
        }
        newRow[yk] = Math.round((sum / count) * 100) / 100;
      }
      return newRow;
    });
    return { ...spec, data: transformed, title: `${spec.title} (${window}-pt rolling avg)` };
  }

  if (computation === "cumulative") {
    const cumSums: Record<string, number> = {};
    for (const yk of yKeys) cumSums[yk] = 0;

    const transformed = spec.data.map((row) => {
      const newRow: Record<string, string | number> = { [spec.xKey!]: row[spec.xKey!] };
      for (const yk of yKeys) {
        cumSums[yk] += Number(row[yk]) || 0;
        newRow[yk] = Math.round(cumSums[yk] * 100) / 100;
      }
      return newRow;
    });
    return { ...spec, data: transformed, title: `${spec.title} (cumulative)` };
  }

  return spec;
}
