import type { PlaybookParam } from "./playbook-types";
import type { QueryResult } from "./sql-executor";

const SQL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SQL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?$/;

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function isQuotedSqlLiteral(value: string): boolean {
  return /^'(?:[^']|'')*'$/.test(value.trim());
}

function normalizeDateTimeString(value: string): string {
  return value.trim().replace("T", " ").replace(/Z$/, "");
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function maybeDuckDbTimestampObject(value: unknown): Date | null {
  if (!value || typeof value !== "object" || !("micros" in value)) return null;
  const micros = (value as { micros?: unknown }).micros;
  if (typeof micros !== "bigint") return null;
  return new Date(Number(micros / BigInt(1000)));
}

function toSqlLiteral(value: unknown): string {
  const duckDate = maybeDuckDbTimestampObject(value);
  if (duckDate) return `'${formatTimestamp(duckDate)}'`;
  if (value instanceof Date) return `'${formatDate(value)}'`;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";

  const raw = String(value).trim();
  if (!raw) return "''";
  if (isQuotedSqlLiteral(raw)) return raw;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase();
  if (SQL_DATE_RE.test(raw) || SQL_TIMESTAMP_RE.test(raw)) {
    return `'${escapeSqlString(normalizeDateTimeString(raw))}'`;
  }
  return `'${escapeSqlString(raw)}'`;
}

function formatParamValue(param: PlaybookParam, value: string): string {
  const raw = value.trim();
  if (isQuotedSqlLiteral(raw)) return raw;
  if (param.type === "integer" || param.type === "float") return raw;
  if (param.type === "boolean") return /^(true|1|yes)$/i.test(raw) ? "true" : "false";
  if (param.type === "date") return toSqlLiteral(raw);
  return raw;
}

/**
 * Replace {{param_name}} placeholders in a string with resolved values.
 * Unresolved placeholders are left as-is.
 */
export function substituteParams(
  text: string,
  params: Record<string, string>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    return name in params ? params[name] : match;
  });
}

/**
 * Build a flat name→value map from PlaybookParam[], with optional overrides.
 */
export function buildParamMap(
  params: PlaybookParam[],
  overrides?: Record<string, string>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of params) {
    map[p.name] = formatParamValue(p, overrides?.[p.name] ?? p.defaultVal);
  }
  return map;
}

/**
 * After a "parameter" role SQL cell executes, merge its first row's
 * column values into the param map as computed parameters.
 * Later cells can use {{column_name}} placeholders resolved from actual data.
 */
export function mergeComputedParams(
  paramMap: Record<string, string>,
  result: QueryResult
): Record<string, string> {
  if (result.error || result.rows.length === 0) return paramMap;
  const row = result.rows[0];
  const merged = { ...paramMap };
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined) {
      merged[key] = toSqlLiteral(value);
    }
  }
  return merged;
}
