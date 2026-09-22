import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { executeSQL } from "@/lib/sql-executor";
import { getDatasetForUser } from "@/lib/datasets";
import { inferChartSpec, sanitizeChartData } from "@/lib/chart-inference";

// ── SQL Transformers ──

const GRAIN_MAP: Record<string, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
};

/**
 * Replace DATE_TRUNC grain in SQL.
 * Handles: DATE_TRUNC('day', col), DATE_TRUNC('week', "col"::TIMESTAMP), etc.
 */
function transformGrain(sql: string, newGrain: string): string {
  const unit = GRAIN_MAP[newGrain];
  if (!unit) return sql;
  // Match DATE_TRUNC('day'|'week'|'month', ...) — case insensitive
  return sql.replace(
    /DATE_TRUNC\s*\(\s*'(day|week|month)'/gi,
    `DATE_TRUNC('${unit}'`,
  );
}

/**
 * Extract the raw date column from the SQL.
 * Tries DATE_TRUNC first, then falls back to column names that look date-like.
 */
function extractDateColumn(sql: string): string | null {
  // Try DATE_TRUNC('grain', column)
  const truncMatch = sql.match(
    /DATE_TRUNC\s*\(\s*'[^']+'\s*,\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
  );
  if (truncMatch) return truncMatch[1];

  // Fallback: find a column reference that looks like a date
  // Match "column_name" or column_name in SELECT/WHERE/GROUP BY context
  const dateColMatch = sql.match(
    /\b"?((?:booking_|order_|created_|updated_|event_|transaction_)?date|(?:booking_|order_|created_|updated_|event_)?(?:_at|_time|_timestamp))"?\b/i,
  );
  if (dateColMatch) return dateColMatch[1];

  return null;
}

/**
 * Apply a date range filter to SQL.
 *
 * Strategy:
 * 1. If the SQL already has date literals in >= / <= / BETWEEN patterns, replace them.
 * 2. If no existing date filter found, inject a WHERE clause using the date column
 *    from the DATE_TRUNC expression. If there's already a WHERE, append with AND.
 */
function transformDateRange(
  sql: string,
  newRange: { start: string; end: string },
): string {
  const safeStart = newRange.start.replace(/\$/g, "$$$$");
  const safeEnd = newRange.end.replace(/\$/g, "$$$$");
  let result = sql;
  let replaced = false;

  // Pattern 1: >= 'date' ... <= 'date' (with optional ::TIMESTAMP or ::DATE cast)
  // Replace the first date literal after >= with new start
  // No `g` flag — only replace the first >= and first <= date literal.
  // LLM-generated chart SQL has a single date column; replacing all occurrences
  // would corrupt independent date predicates on other columns (e.g. refund_date).
  result = result.replace(
    /(>=\s*')(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?)((?:::(?:TIMESTAMP|DATE))?')/i,
    () => { replaced = true; return `>= '${safeStart}'`; },
  );
  result = result.replace(
    /(<=\s*')(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?)((?:::(?:TIMESTAMP|DATE))?')/i,
    () => { replaced = true; return `<= '${safeEnd} 23:59:59'`; },
  );

  // Pattern 2: BETWEEN 'date' AND 'date'
  result = result.replace(
    /(BETWEEN\s*')(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?)('(?:::(?:TIMESTAMP|DATE))?\s+AND\s+')(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?)((?:::(?:TIMESTAMP|DATE))?')/gi,
    () => { replaced = true; return `BETWEEN '${safeStart}' AND '${safeEnd} 23:59:59'`; },
  );

  // If no existing date filter was found, inject one
  if (!replaced) {
    const dateCol = extractDateColumn(sql);
    if (dateCol) {
      const filter = `"${dateCol}" >= '${newRange.start}' AND "${dateCol}" <= '${newRange.end} 23:59:59'`;

      // Check if there's already a WHERE clause
      const whereMatch = result.match(/\bWHERE\b/i);
      if (whereMatch) {
        // Append to existing WHERE with AND
        result = result.replace(
          /\bWHERE\b/i,
          `WHERE ${filter} AND`,
        );
      } else {
        // Insert WHERE before GROUP BY / ORDER BY / LIMIT / HAVING (whichever comes first)
        const insertBefore = result.match(
          /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING)\b/i,
        );
        if (insertBefore && insertBefore.index != null) {
          result =
            result.slice(0, insertBefore.index) +
            `WHERE ${filter}\n` +
            result.slice(insertBefore.index);
        } else {
          // No GROUP BY / ORDER BY — append at end
          result = result.trimEnd().replace(/;?\s*$/, "") + `\nWHERE ${filter}`;
        }
      }
    }
  }

  return result;
}

// ── Route Handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sql, newGrain, newDateRange, title } = body as {
      sql: string;
      newGrain?: "daily" | "weekly" | "monthly";
      newDateRange?: { start: string; end: string };
      title?: string;
    };
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rawDatasetId = req.headers.get("x-dataset-id");
    if (!rawDatasetId || !/^[a-z0-9_-]+$/.test(rawDatasetId) || rawDatasetId.length > 64) {
      return NextResponse.json({ error: "Invalid or missing x-dataset-id" }, { status: 400 });
    }
    const datasetId = rawDatasetId;
    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!sql) {
      return NextResponse.json({ error: "sql is required" }, { status: 400 });
    }
    if (!newGrain && !newDateRange) {
      return NextResponse.json(
        { error: "At least one of newGrain or newDateRange is required" },
        { status: 400 },
      );
    }
    if (newDateRange) {
      const DATE_RE = /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/;
      if (!DATE_RE.test(newDateRange.start) || !DATE_RE.test(newDateRange.end)) {
        return NextResponse.json({ error: "Invalid date range format" }, { status: 400 });
      }
    }

    // Transform SQL
    let transformed = sql;
    if (newGrain) {
      transformed = transformGrain(transformed, newGrain);
    }
    if (newDateRange) {
      transformed = transformDateRange(transformed, newDateRange);
    }

    // NOTE(security): This endpoint accepts arbitrary SQL from the client. executeSQL enforces
    // SELECT-only (blocks DROP/DELETE/INSERT/UPDATE/ALTER/CREATE), limiting risk to read-only
    // data access by authenticated sessions. For a demo with no real user PII this is acceptable.
    // If real sensitive data is ever added, replace this with a signed SQL token pattern so only
    // system-generated SQL can be re-executed.

    // Execute
    const result = await executeSQL(transformed, datasetId);

    if (result.error) {
      return NextResponse.json(
        { error: result.error, sql: transformed },
        { status: 422 },
      );
    }

    // Sanitize data (BigInt → number, etc.)
    const sanitized = sanitizeChartData(result.rows as Record<string, unknown>[]);

    // Re-infer chart spec from new data
    const chartSpec = inferChartSpec(
      result.columns,
      sanitized,
      title ?? "",
    );

    // Patch grain/dateRange/sql onto the spec
    if (chartSpec) {
      chartSpec.sql = transformed;
      if (newGrain) chartSpec.grain = newGrain;
      if (newDateRange) chartSpec.dateRange = newDateRange;
    }

    return NextResponse.json({
      sql: transformed,
      data: sanitized,
      columns: result.columns,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
      chartSpec,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
