// src/lib/forecast-types.ts

export type CellFormat = "currency" | "percent" | "number";

// Discriminated union — formula is required for derived, absent for base
interface ForecastRowCommon {
  id: string;
  label: string;
  indent: number;
  format: CellFormat;
  overrides?: Record<string, number>; // keyed by "week:{dateKey}" e.g. "week:2019-10-07"
  showOnChart?: boolean;
  sourceQuery?: string;
  sourceTable?: string;
  forecastMethod?: string;
  metricId?: string; // linked metric from metric tree
}

export interface ForecastRowBase extends ForecastRowCommon {
  type: "base";
}

export interface ForecastRowDerived extends ForecastRowCommon {
  type: "derived";
  formula: string; // required: "{Revenue} - {Cost}"
}

export type ForecastRow = ForecastRowBase | ForecastRowDerived;

export interface ForecastModel {
  id: string;
  name: string;
  forecastStart: string; // ISO date (Monday) — historical/forecast divider
  rows: ForecastRow[];
  historyWeeks?: number; // default 9
  forecastWeeks?: number; // default 12
}

/** Resolved data for rendering — computed by the engine */
export interface ResolvedColumn {
  key: string; // e.g. "2019-10-07" (Monday of week)
  label: string; // e.g. "7 Oct"
  isForecast: boolean;
}

export interface ResolvedCell {
  value: number | null;
  error?: "#REF!" | "#CIRC!" | "#DIV/0!";
  isOverride?: boolean;
}

export interface ResolvedTable {
  columns: ResolvedColumn[];
  /** rowId → columnKey → cell (plain object, not Map — serializable) */
  rows: Record<string, Record<string, ResolvedCell>>;
}
