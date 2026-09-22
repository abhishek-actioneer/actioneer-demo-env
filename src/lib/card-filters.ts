/**
 * card-filters.ts — Client-side filtering, sorting, and date range
 * for board card data. Operates on the data arrays already present
 * on the card (chartSpec.data or card.data). No SQL parsing or
 * server round-trips.
 */

// ── Types ──

export interface CardFilter {
  column: string;
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains";
  value: string | number;
}

export interface CardSort {
  column: string;
  direction: "asc" | "desc";
}

export type DatePreset = "7d" | "14d" | "30d" | "90d" | "1y";

export interface CardControls {
  filters: CardFilter[];
  sort: CardSort | null;
  datePreset: DatePreset | null;
}

export interface ColumnInfo {
  name: string;
  type: "string" | "number" | "date";
}

// ── Column Detection ──

const DATE_NAME_RE = /^(date|day|week|month|year|period|time|created|updated|timestamp)|(_at|_on|_date|_time)$/i;

function looksLikeDateValue(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}/.test(v) || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(v);
}

/** Derive column metadata from data rows. Uses column names + value sampling. */
export function deriveColumns(data: Record<string, unknown>[]): ColumnInfo[] {
  if (data.length === 0) return [];
  const keys = Object.keys(data[0]);
  const sample = data.slice(0, 10);

  return keys.map((name) => {
    const values = sample.map((r) => r[name]).filter((v) => v != null);
    if (values.length === 0) return { name, type: "string" as const };

    if (values.every((v) => typeof v === "number" || typeof v === "bigint")) {
      return { name, type: "number" as const };
    }
    if (DATE_NAME_RE.test(name) || values.every(looksLikeDateValue)) {
      return { name, type: "date" as const };
    }
    return { name, type: "string" as const };
  });
}

/** Find the date column from columns. Returns null if none found. */
export function findDateColumn(columns: ColumnInfo[]): string | null {
  return columns.find((c) => c.type === "date")?.name ?? null;
}

/** Get unique values for a column (for filter value picker). Max 30. */
export function uniqueValues(data: Record<string, unknown>[], column: string): (string | number)[] {
  const seen = new Set<string | number>();
  for (const row of data) {
    const v = row[column];
    if (v == null) continue;
    seen.add(typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : String(v));
    if (seen.size >= 30) break;
  }
  return Array.from(seen).sort((a, b) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
  );
}

// ── Date helpers ──

/** Find the max (most recent) date in data for a given column. */
export function findMaxDate(data: Record<string, unknown>[], dateColumn: string): Date | null {
  let max: Date | null = null;
  for (const row of data) {
    const v = row[dateColumn];
    if (v == null) continue;
    const d = new Date(String(v));
    if (!isNaN(d.getTime()) && (max === null || d > max)) max = d;
  }
  return max;
}

/** Compute the cutoff date for a preset, anchored to the data's max date. */
function presetToCutoff(preset: DatePreset, anchor: Date): Date {
  const d = new Date(anchor);
  switch (preset) {
    case "7d": d.setDate(d.getDate() - 7); break;
    case "14d": d.setDate(d.getDate() - 14); break;
    case "30d": d.setDate(d.getDate() - 30); break;
    case "90d": d.setDate(d.getDate() - 90); break;
    case "1y": d.setFullYear(d.getFullYear() - 1); break;
  }
  return d;
}

// ── Filtering ──

function matchesFilter(row: Record<string, unknown>, f: CardFilter): boolean {
  const v = row[f.column];
  if (v == null) return false;
  switch (f.operator) {
    case "eq": return typeof f.value === "number" ? Number(v) === f.value : String(v) === String(f.value);
    case "neq": return typeof f.value === "number" ? Number(v) !== f.value : String(v) !== String(f.value);
    case "gt": return Number(v) > Number(f.value);
    case "lt": return Number(v) < Number(f.value);
    case "gte": return Number(v) >= Number(f.value);
    case "lte": return Number(v) <= Number(f.value);
    case "contains": return String(v).toLowerCase().includes(String(f.value).toLowerCase());
    default: return true;
  }
}

/**
 * Apply filters, date range, and sorting to a data array.
 * Date presets are anchored to `maxDate` (the latest date in the data).
 */
export function applyControls(
  data: Record<string, unknown>[],
  controls: CardControls,
  dateColumn: string | null,
  maxDate: Date | null,
): Record<string, unknown>[] {
  if (data.length === 0) return data;

  let result = data;

  // Date range filter — anchored to the data's max date
  if (controls.datePreset && dateColumn && maxDate) {
    const cutoff = presetToCutoff(controls.datePreset, maxDate);
    result = result.filter((row) => {
      const val = row[dateColumn];
      if (val == null) return true;
      const d = new Date(String(val));
      return !isNaN(d.getTime()) && d >= cutoff;
    });
  }

  // Column filters (AND — all must match)
  if (controls.filters.length > 0) {
    result = result.filter((row) => controls.filters.every((f) => matchesFilter(row, f)));
  }

  // Sort
  if (controls.sort) {
    const { column, direction } = controls.sort;
    result = [...result].sort((a, b) => {
      const av = a[column], bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return direction === "asc" ? cmp : -cmp;
    });
  }

  return result;
}

/** Default empty controls state. */
export function emptyControls(): CardControls {
  return { filters: [], sort: null, datePreset: null };
}
