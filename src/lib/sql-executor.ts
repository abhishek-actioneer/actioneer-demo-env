import { withConnection } from "./db";

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

const MAX_RESULT_ROWS = 500;

/**
 * Append LIMIT to a SQL query if no LIMIT clause is present.
 * Best-effort: not comment-aware or string-literal-aware.
 * DuckDB memory_limit is the primary safety net; this reduces result set
 * transfer size for well-formed queries.
 */
function ensureLimit(sql: string): string {
  // DuckDB uses double-quoted identifiers; replace MySQL-style backtick quoting
  // that LLMs sometimes generate (e.g. `country` → "country").
  const normalized = sql.trim().replace(/;+\s*$/, "").replace(/`([^`]+)`/g, '"$1"');
  if (/\bLIMIT\b/i.test(normalized)) return normalized;
  return `${normalized} LIMIT ${MAX_RESULT_ROWS}`;
}

function sanitize(val: unknown): unknown {
  if (typeof val === "bigint") return Number(val);
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) return val.map(sanitize);
  if (val !== null && typeof val === "object") {
    // DuckDB Date/Time/Timestamp objects have a non-plain prototype — coerce to string
    const proto = Object.getPrototypeOf(val);
    if (proto && proto !== Object.prototype) {
      return String(val);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = sanitize(v);
    }
    return out;
  }
  return val;
}

/** Materialize raw DuckDB rows into typed QueryResult fields. */
function buildResult(
  colNames: string[],
  rawRows: unknown[][],
  start: number,
): QueryResult {
  const rows = rawRows.slice(0, MAX_RESULT_ROWS).map((row) => {
    const obj: Record<string, unknown> = {};
    colNames.forEach((col, i) => {
      obj[col] = sanitize(row[i]);
    });
    return obj;
  });
  return {
    columns: colNames,
    rows,
    rowCount: rows.length,
    executionTimeMs: Math.round(performance.now() - start),
  };
}

const BLOCKED_KEYWORDS = [
  "DROP", "DELETE", "INSERT", "UPDATE", "ALTER",
  "CREATE", "TRUNCATE", "GRANT", "REVOKE",
  "COPY", "ATTACH", "EXPORT", "IMPORT", "LOAD",
  "INSTALL", "PRAGMA", "CALL", "SET",
];

export function validateSQL(sql: string): { valid: boolean; error?: string } {
  // Strip SQL comments before type-checking so leading `-- ...` lines don't cause false rejections
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .toUpperCase();
  if (!stripped.startsWith("SELECT") && !stripped.startsWith("WITH")) {
    return { valid: false, error: "Only SELECT queries are allowed" };
  }
  for (const kw of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\s`, "i");
    // Test the stripped SQL so comments mentioning blocked keywords don't false-reject
    if (regex.test(stripped)) {
      return { valid: false, error: `${kw} statements are not allowed` };
    }
  }
  return { valid: true };
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/out of memory/i.test(msg)) {
    const limit = process.env.DUCKDB_MEMORY_LIMIT ?? "4GB";
    return `Query exceeded the DuckDB memory limit (${limit}). Try narrowing the date range or simplifying the query.`;
  }
  return msg;
}

const MAX_INTERNAL_ROWS = 10_000;

/** Internal SQL executor — bypasses validation. Only use from server-side API routes for known-safe queries. */
export async function executeSQLInternal(sql: string, datasetId?: string): Promise<QueryResult> {
  const start = performance.now();
  try {
    return await withConnection(datasetId, async (conn) => {
      const result = await conn.run(sql);
      const colNames = result.columnNames();
      const rawRows = await result.getRows();
      // Internal queries get a higher cap (10K) since they're trusted server-side code
      const rows = rawRows.slice(0, MAX_INTERNAL_ROWS).map((row) => {
        const obj: Record<string, unknown> = {};
        colNames.forEach((col, i) => {
          obj[col] = sanitize(row[i]);
        });
        return obj;
      });
      return {
        columns: colNames,
        rows,
        rowCount: rows.length,
        executionTimeMs: Math.round(performance.now() - start),
      };
    });
  } catch (err) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: Math.round(performance.now() - start),
      error: friendlyError(err),
    };
  }
}

/**
 * Parameterized SQL executor using native DuckDB prepared statements for both
 * SELECT and DML (INSERT, UPDATE, DELETE). Use for any query with user-provided
 * values bound as parameters.
 */
export async function executeSQLPrepared(
  sql: string,
  params: unknown[],
  datasetId?: string,
): Promise<QueryResult> {
  const start = performance.now();
  try {
    return await withConnection(datasetId, async (conn) => {
      const trimmed = sql.trim().toUpperCase();
      const isDML =
        trimmed.startsWith("UPDATE") ||
        trimmed.startsWith("DELETE") ||
        trimmed.startsWith("INSERT");

      // Apply LIMIT cap for SELECT queries only; DML does not support LIMIT.
      const safeSql = isDML ? sql : ensureLimit(sql);

      const stmt = await conn.prepare(safeSql);
      for (let i = 0; i < params.length; i++) {
        const val = params[i];
        if (val === null || val === undefined) {
          stmt.bindNull(i + 1);
        } else if (typeof val === "number") {
          if (Number.isInteger(val)) {
            stmt.bindInteger(i + 1, val);
          } else {
            stmt.bindDouble(i + 1, val);
          }
        } else {
          stmt.bindVarchar(i + 1, String(val));
        }
      }
      const result = await stmt.run();
      const colNames = result.columnNames();
      const rawRows = await result.getRows();
      return buildResult(colNames, rawRows, start);
    });
  } catch (err) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: Math.round(performance.now() - start),
      error: friendlyError(err),
    };
  }
}

/**
 * Dry-run a SQL query using EXPLAIN. Validates syntax, column references,
 * table existence, and join logic without actually executing the query.
 * Returns null on success, or the error message on failure.
 */
export async function dryRunSQL(sql: string, datasetId?: string): Promise<string | null> {
  const validation = validateSQL(sql);
  if (!validation.valid) return validation.error ?? "Invalid SQL";

  try {
    await withConnection(datasetId, async (conn) => {
      await conn.run(`EXPLAIN ${ensureLimit(sql)}`);
    });
    return null;
  } catch (err) {
    return friendlyError(err);
  }
}

/**
 * Batch dry-run multiple SQL queries in a single connection.
 * Returns an array of null (valid) or error string per query.
 */
export async function batchDryRunSQL(sqls: string[], datasetId?: string): Promise<(string | null)[]> {
  if (sqls.length === 0) return [];
  return withConnection(datasetId, async (conn) => {
    const results: (string | null)[] = [];
    for (const sql of sqls) {
      const validation = validateSQL(sql);
      if (!validation.valid) {
        results.push(validation.error ?? "Invalid SQL");
        continue;
      }
      try {
        await conn.run(`EXPLAIN ${ensureLimit(sql)}`);
        results.push(null);
      } catch (err) {
        results.push(friendlyError(err));
      }
    }
    return results;
  });
}

export async function executeSQL(sql: string, datasetId?: string): Promise<QueryResult> {
  const validation = validateSQL(sql);
  if (!validation.valid) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: 0,
      error: validation.error,
    };
  }

  const start = performance.now();

  try {
    return await withConnection(datasetId, async (conn) => {
      const result = await conn.run(ensureLimit(sql));
      const colNames = result.columnNames();
      const rawRows = await result.getRows();
      return buildResult(colNames, rawRows, start);
    });
  } catch (err) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      executionTimeMs: Math.round(performance.now() - start),
      error: friendlyError(err),
    };
  }
}
