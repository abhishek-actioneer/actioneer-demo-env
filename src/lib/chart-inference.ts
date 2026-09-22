import type { ChartSpec } from "./chart-types";
import type { CardType } from "./board-types";

// ── Pivot helpers (unchanged) ──

/**
 * Returns the name of the pivot column if the data is long format,
 * or null if no pivot is needed.
 *
 * @param description - optional user query/title to help pick the right pivot
 *   column when multiple categorical columns exist (e.g. "by service_type")
 */
export function detectPivotKey(
  rows: Record<string, unknown>[],
  xKey: string,
  stringCols: string[],
  description?: string,
): string | null {
  const categoricalCols = stringCols.filter(c => c !== xKey);
  if (categoricalCols.length === 0) return null;

  // Must have duplicate x-values (signal of long format)
  const uniqueX = new Set(rows.map(r => r[xKey]));
  if (uniqueX.size === rows.length) return null;

  // Pick the best pivot candidate:
  // 1. If description mentions a column name (e.g. "by service_type"), use that
  // 2. Otherwise pick the one with 2-10 unique values (categorical, not high-cardinality)
  let pivotKey: string | null = null;

  if (description && categoricalCols.length > 1) {
    const desc = description.toLowerCase().replace(/[_-]/g, " ");
    for (const col of categoricalCols) {
      const colNorm = col.toLowerCase().replace(/[_-]/g, " ");
      if (desc.includes(colNorm)) {
        pivotKey = col;
        break;
      }
    }
  }

  // Fallback: pick the first categorical column with 2-10 unique values
  if (!pivotKey) {
    for (const col of categoricalCols) {
      const vals = new Set(rows.map(r => r[col]));
      if (vals.size >= 2 && vals.size <= 10) {
        pivotKey = col;
        break;
      }
    }
  }

  if (!pivotKey) return null;

  // Validate the pivot has reasonable cardinality
  const pivotValues = new Set(rows.map(r => r[pivotKey!]));
  if (pivotValues.size < 2 || pivotValues.size > 10) return null;

  return pivotKey;
}

/**
 * Reshapes long-format rows into wide format.
 */
export function pivotLongToWide(
  rows: Record<string, unknown>[],
  xKey: string,
  pivotKey: string,
  valueKeys: string[],
): { data: Record<string, unknown>[]; yKeys: string[]; yLabels: string[] } {
  const pivotValues = [...new Set(rows.map(r => String(r[pivotKey])))].sort();
  const xValues = [...new Set(rows.map(r => r[xKey]))];

  const yKeys =
    valueKeys.length === 1
      ? pivotValues
      : pivotValues.flatMap(pv => valueKeys.map(vk => `${pv}_${vk}`));

  const yLabels = yKeys.map(k => k.replace(/_/g, " "));

  const data = xValues.map(xVal => {
    const row: Record<string, unknown> = { [xKey]: xVal };
    const matchingRows = rows.filter(r => r[xKey] === xVal);
    for (const pv of pivotValues) {
      const pvRow = matchingRows.find(r => String(r[pivotKey]) === pv);
      if (valueKeys.length === 1) {
        row[pv] = pvRow ? pvRow[valueKeys[0]] : null;
      } else {
        for (const vk of valueKeys) {
          row[`${pv}_${vk}`] = pvRow ? pvRow[vk] : null;
        }
      }
    }
    return row;
  });

  return { data, yKeys, yLabels };
}

/** Coerce BigInt → number and filter to string/number values for chart rendering */
export function sanitizeChartData(
  rows: Record<string, unknown>[]
): Record<string, string | number>[] {
  return rows.map((row) => {
    const clean: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "bigint") clean[k] = Number(v);
      else if (typeof v === "number") clean[k] = v;
      else if (v != null) clean[k] = String(v);
    }
    return clean;
  });
}

// ── Intent detection ──

type ChartIntent = "trend" | "comparison" | "ranking" | "distribution" | "composition" | "unknown";

const INTENT_PATTERNS: [RegExp, ChartIntent][] = [
  [/\b(trend|over time|monthly|weekly|daily|time.?series|growth|trajectory)\b/i, "trend"],
  [/\b(top|rank|best|worst|leading|bottom|highest|lowest)\b/i, "ranking"],
  [/\b(distribut|spread|histogram|frequency|bucket|tier)\b/i, "distribution"],
  [/\b(share|proportion|mix|composition|split|breakdown|percent.*of)\b/i, "composition"],
  [/\b(compar|versus|vs\.?|by\s+\w+|across|between)\b/i, "comparison"],
];

function detectIntent(description: string): ChartIntent {
  for (const [pattern, intent] of INTENT_PATTERNS) {
    if (pattern.test(description)) return intent;
  }
  return "unknown";
}

// ── Metric type classification ──

type MetricUnit = "currency" | "count" | "rate" | "duration" | "generic";

const UNIT_PATTERNS: [RegExp, MetricUnit][] = [
  [/\b(revenue|spend|cost|price|amount|value|fee|profit|margin|arpu|ltv|cac|aov|gmv|mrr|arr)\b/i, "currency"],
  [/\b(count|num|total|users|bookings|orders|sessions|visits|signups|events|items|quantity)\b/i, "count"],
  [/\b(rate|pct|percent|ratio|conversion|retention|churn|ctr|bounce|share|proportion|_pct|_rate)\b/i, "rate"],
  [/\b(time|duration|latency|seconds|minutes|hours|days|avg_time|median_time|ttfb|p50|p95|p99)\b/i, "duration"],
];

function classifyColumn(colName: string): MetricUnit {
  for (const [pattern, unit] of UNIT_PATTERNS) {
    if (pattern.test(colName)) return unit;
  }
  return "generic";
}

function formatForUnit(
  unit: MetricUnit,
  colName?: string,
  rows?: Record<string, unknown>[],
): "currency" | "percent" | "number" {
  switch (unit) {
    case "currency": return "currency";
    case "rate": {
      // Only format as percent if values actually look like percentages.
      // Check a sample of values — if they're in 0-100 range (or 0-1), it's percent.
      // Otherwise it's just a column with "rate" or "pct" in the name but raw numbers.
      if (colName && rows?.length) {
        const vals = rows.slice(0, 20).map(r => Number(r[colName])).filter(v => !isNaN(v));
        if (vals.length > 0) {
          const max = Math.max(...vals);
          if (max > 100) return "number"; // values like 5000 — not a percentage
        }
      }
      return "percent";
    }
    default: return "number";
  }
}

// ── Smart yKey selection ──

/**
 * Pick the best yKey from numeric columns, matching against the query description.
 * Returns the column name whose name best matches the description.
 */
/** Check if a numeric column is really an ordinal dimension, not a measure */
function isOrdinalDimension(colName: string, rows: Record<string, unknown>[]): boolean {
  const lower = colName.toLowerCase();
  // Name-based: "since", "number", "step", "rank", "bucket", "nth" suggest ordinals
  const ordinalWords = ["_since_", "since_", "_number", "_step", "_rank", "_bucket", "_nth", "period_n"];
  if (ordinalWords.some(w => lower.includes(w))) return true;
  // Data-based: if values are small sequential integers (0,1,2,3...), likely a dimension
  if (rows.length >= 3) {
    const vals = rows.slice(0, 30).map(r => Number(r[colName])).filter(v => !isNaN(v));
    const allInts = vals.every(v => Number.isInteger(v));
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (allInts && min >= 0 && max <= 50 && vals.length > 2) {
      // Check if values look sequential/ordinal (small range of integers)
      const unique = new Set(vals);
      if (unique.size <= max - min + 1) return true;
    }
  }
  return false;
}

function pickPrimaryMetric(numericCols: string[], description: string, rows?: Record<string, unknown>[]): string {
  if (numericCols.length === 0) return "value";
  if (numericCols.length === 1) return numericCols[0];

  const descWords = description.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  let bestCol = numericCols[0];
  let bestScore = -1;

  for (const col of numericCols) {
    const colWords = col.toLowerCase().split(/[_\s-]+/);
    let score = 0;
    for (const cw of colWords) {
      if (cw.length <= 2) continue;
      if (descWords.some(dw => dw.includes(cw) || cw.includes(dw))) score += 2;
    }
    // Bonus: well-known measure columns
    const lower = col.toLowerCase();
    if (["revenue", "total", "count", "value", "amount"].some(w => lower.includes(w))) score += 1;
    // Penalty: ordinal dimensions shouldn't be plotted as measures
    if (rows && isOrdinalDimension(col, rows)) score -= 5;
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }

  return bestCol;
}

/**
 * For line charts, pick compatible yKeys (same unit type, similar scale).
 */
function pickCompatibleYKeys(
  numericCols: string[],
  rows: Record<string, unknown>[],
  primaryCol: string,
): string[] {
  if (numericCols.length <= 1) return [primaryCol];

  const primaryUnit = classifyColumn(primaryCol);
  const compatible = numericCols.filter(col => {
    if (col === primaryCol) return true;
    // Exclude ordinal dimensions (months_since_first, step, rank, etc.)
    if (isOrdinalDimension(col, rows)) return false;
    // Must be same unit type
    if (classifyColumn(col) !== primaryUnit && primaryUnit !== "generic") return false;
    return true;
  });

  // Check scale compatibility: max ratio < 10x
  if (compatible.length > 1 && rows.length > 0) {
    const maxVals = compatible.map(col => {
      let max = 0;
      for (const row of rows) {
        const v = Number(row[col]) || 0;
        if (Math.abs(v) > max) max = Math.abs(v);
      }
      return max;
    });

    const primaryMax = maxVals[0] || 1;
    const scaleCompatible = compatible.filter((_, i) => {
      if (i === 0) return true;
      const ratio = primaryMax > 0 ? maxVals[i] / primaryMax : 1;
      return ratio >= 0.1 && ratio <= 10;
    });

    return scaleCompatible.slice(0, 3);
  }

  return compatible.slice(0, 3);
}

// ── Sort data for bar charts ──

function sortBarData(
  data: Record<string, string | number>[],
  yKey: string,
  intent: ChartIntent,
): Record<string, string | number>[] {
  // Don't sort if intent is distribution (tiers have natural order)
  if (intent === "distribution") return data;

  // Sort descending by primary yKey for rankings and comparisons
  return [...data].sort((a, b) => {
    const av = Number(a[yKey]) || 0;
    const bv = Number(b[yKey]) || 0;
    return bv - av;
  });
}

// ── Public API ──

/** Context for smarter chart inference */
export interface ChartContext {
  agentId?: string;
  queryDescription?: string;
  datasetHints?: { currency?: string; entityName?: string };
}

/**
 * Infer the best card type from query result shape.
 */
export function inferCardType(
  columns: string[],
  rows: Record<string, unknown>[]
): CardType {
  if (!rows.length || !columns.length) return "table";

  const sample = rows[0];
  const numericCols: string[] = [];
  const stringCols: string[] = [];

  for (const col of columns) {
    const val = sample[col];
    if (typeof val === "number" || typeof val === "bigint") {
      numericCols.push(col);
    } else {
      stringCols.push(col);
    }
  }

  // Single row with any numeric columns → metric
  if (rows.length === 1 && numericCols.length > 0) {
    return "metric";
  }

  // Multiple rows with a date-like column → chart
  const hasDateCol = stringCols.some((c) =>
    /date|month|week|day|year|time|period/i.test(c)
  );
  if (hasDateCol && numericCols.length > 0) {
    return "chart";
  }

  // Multiple rows with categorical + numeric → chart if ≤20 categories, else table
  if (stringCols.length > 0 && numericCols.length > 0) {
    const uniqueCategories = new Set(rows.map((r) => String(r[stringCols[0]])));
    return uniqueCategories.size <= 20 ? "chart" : "table";
  }

  return "table";
}

/**
 * Infer a ChartSpec from raw query result data with optional context
 * for smarter chart type, metric, and format selection.
 */
export function inferChartSpec(
  columns: string[],
  rows: Record<string, unknown>[],
  title: string,
  context?: ChartContext,
): ChartSpec | null {
  if (!rows.length || !columns.length) return null;
  if (rows.length === 1) return null;

  const sample = rows[0];
  const numericCols: string[] = [];
  const stringCols: string[] = [];

  for (const col of columns) {
    const val = sample[col];
    if (typeof val === "number" || typeof val === "bigint") {
      numericCols.push(col);
    } else {
      stringCols.push(col);
    }
  }

  if (numericCols.length === 0) return null;

  // ── Step 1: Detect intent from description ──
  const description = context?.queryDescription ?? title;
  const intent = detectIntent(description);

  // ── Step 2: Pick xKey (date column wins, then first string column) ──
  const dateCol = stringCols.find((c) =>
    /date|month|week|day|year|time|period/i.test(c)
  );
  const xKey = dateCol ?? stringCols[0] ?? columns[0];
  const isTimeSeries = !!dateCol;

  // ── Step 3: Pick primary metric (description-aware) ──
  const primaryMetric = pickPrimaryMetric(numericCols, description, rows);

  // ── Step 4: Detect pivot (long-to-wide) ──
  const pivotKey = detectPivotKey(rows, xKey, stringCols, description);
  let chartData: Record<string, string | number>[];
  let resolvedYKeys: string[];
  let resolvedYLabels: string[] | undefined;

  if (pivotKey) {
    // For pivoted data, use only the primary metric column for pivoting
    const pivoted = pivotLongToWide(rows, xKey, pivotKey, [primaryMetric]);
    chartData = sanitizeChartData(pivoted.data).slice(0, 50);
    resolvedYKeys = pivoted.yKeys;
    resolvedYLabels = pivoted.yLabels;
  } else if (isTimeSeries) {
    // Line charts: pick compatible yKeys (same unit, similar scale)
    chartData = sanitizeChartData(rows).slice(0, 50);
    resolvedYKeys = pickCompatibleYKeys(numericCols, rows, primaryMetric);
    // Reorder so primary is first
    resolvedYKeys = [primaryMetric, ...resolvedYKeys.filter(k => k !== primaryMetric)];
  } else {
    // Bar charts: single yKey only (the primary metric)
    chartData = sanitizeChartData(rows).slice(0, 50);
    resolvedYKeys = [primaryMetric];
  }

  // ── Step 5: Pick chart type based on intent + data shape ──
  const uniqueX = new Set(rows.map((r) => String(r[xKey]))).size;
  let chartType: ChartSpec["type"];

  if (isTimeSeries || intent === "trend") {
    chartType = "line";
  } else if (intent === "composition" && uniqueX <= 8) {
    chartType = "pie";
  } else if (uniqueX <= 15) {
    chartType = "bar";
  } else {
    chartType = "line";
  }

  // ── Step 6: Sort bar chart data by primary metric (desc) ──
  if (chartType === "bar" && resolvedYKeys.length === 1) {
    chartData = sortBarData(chartData, resolvedYKeys[0], intent);
  }

  // ── Step 7: Build format hints from column names + actual values ──
  const format: Record<string, "number" | "currency" | "percent"> = {};
  for (const yk of resolvedYKeys) {
    const unit = classifyColumn(yk);
    const fmt = formatForUnit(unit, yk, rows);
    if (fmt !== "number") format[yk] = fmt;
  }

  // ── Step 8: Build the spec ──
  const spec: ChartSpec = {
    type: chartType,
    title,
    data: chartData,
    xKey,
    yKeys: resolvedYKeys,
    ...(resolvedYLabels ? { yLabels: resolvedYLabels } : {}),
    ...(Object.keys(format).length > 0 ? { format } : {}),
  };

  // For pie charts, use nameKey/valueKey instead of xKey/yKeys
  if (chartType === "pie") {
    spec.nameKey = xKey;
    spec.valueKey = resolvedYKeys[0];
  }

  return spec;
}
