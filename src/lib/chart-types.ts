export interface ChartAnnotation {
  id: string;
  x: string | number;
  label: string;
  type: "marker" | "line";
  color?: string;
}

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "scatter" | "combo" | "stacked-area" | "grouped-bar" | "funnel";
  title: string;
  data: Record<string, string | number>[];

  // For bar / line / area / combo / stacked-area / grouped-bar
  xKey?: string;
  yKeys?: string[];
  yLabels?: string[];

  // For combo: which yKeys render as lines (rest render as bars)
  comboLineKeys?: string[];

  // For stacked-area: stack all area series (default: true for stacked-area type)
  // For grouped-bar: render bars side-by-side (default: true for grouped-bar type)

  // For pie
  nameKey?: string;
  valueKey?: string;

  // Value formatting hints
  format?: Record<string, "number" | "currency" | "percent">;

  // Optional: highlight the most important value/series
  // For bar/pie: xKey or nameKey value to accent (e.g. "Electronics")
  // For line/area: yKey to accent (e.g. "revenue")
  highlight?: string;

  // Visual tone. Defaults to the global chart palette; use monochrome for
  // product surfaces that should stay inside neutral UI tokens.
  tone?: "palette" | "monochrome";

  // Human-readable axis title labels (from PDF extraction or LLM)
  xAxisLabel?: string;
  yAxisLabel?: string;

  // Stacked rendering: stack bars/areas instead of overlaying
  stacked?: boolean;

  // For combo with dual axes: label for the right Y axis
  yAxisRightLabel?: string;

  // Forecast rendering: keys in yKeys that should render as dashed lines
  forecastKeys?: string[];
  // Optional x-axis value where forecast begins (renders a vertical reference line)
  forecastStartX?: string | number;

  // ── Extended fields for unified chart system ──

  // Source SQL query (for display in SQL tab + re-query on grain/time change)
  sql?: string;

  // Current aggregation granularity
  grain?: "daily" | "weekly" | "monthly";

  // Current time window
  dateRange?: { start: string; end: string };

  // Currency symbol from DatasetConfig (e.g. "$", "₹", "€")
  currency?: string;

  // User-defined annotations (reference lines, markers)
  annotations?: ChartAnnotation[];

  // Dataset ID for dataset-aware operations
  datasetId?: string;
}
