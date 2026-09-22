import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { withConnection } from "@/lib/db";
import { validateSQL } from "@/lib/sql-executor";
import { safeStringify } from "@/lib/safe-stringify";
import { isUploadedAudienceSql } from "@/lib/segment-csv-upload";

function q(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

interface ColumnFilter {
  column: string;
  operator: "in" | "not_in" | "gt" | "lt" | "gte" | "lte" | "between";
  values: (string | number)[];
}

function buildFilterSQL(filters: ColumnFilter[]): string {
  if (!filters.length) return "";
  const clauses = filters.map((f) => {
    const col = q(f.column);
    switch (f.operator) {
      case "in":
        return `${col} IN (${f.values.map((v) => typeof v === "number" ? v : `'${escapeStr(String(v))}'`).join(", ")})`;
      case "not_in":
        return `${col} NOT IN (${f.values.map((v) => typeof v === "number" ? v : `'${escapeStr(String(v))}'`).join(", ")})`;
      case "gt":
        return `${col} > ${Number(f.values[0])}`;
      case "lt":
        return `${col} < ${Number(f.values[0])}`;
      case "gte":
        return `${col} >= ${Number(f.values[0])}`;
      case "lte":
        return `${col} <= ${Number(f.values[0])}`;
      case "between":
        return `${col} BETWEEN ${Number(f.values[0])} AND ${Number(f.values[1])}`;
      default:
        return "";
    }
  }).filter(Boolean);
  return clauses.length ? "AND " + clauses.join(" AND ") : "";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await params;
    const datasetId = req.headers.get("x-dataset-id") || undefined;
    if (!datasetId) {
      return NextResponse.json({ error: "Missing x-dataset-id" }, { status: 400 });
    }
    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const dataset = getDataset(datasetId);
    const body = await req.json();
    const segmentSQL: string = (body.sql as string)?.trim().replace(/;+\s*$/, "");
    const page: number = body.page ?? 0;
    const pageSize: number = Math.min(body.pageSize ?? 50, 100);
    const sortCol: string | undefined = body.sortCol;
    const sortDir: "asc" | "desc" = body.sortDir === "desc" ? "desc" : "asc";
    const filters: ColumnFilter[] = body.filters ?? [];
    const search = typeof body.search === "string" ? body.search.trim().slice(0, 200) : "";

    if (!segmentSQL) {
      return NextResponse.json({ error: "Segment SQL required" }, { status: 400 });
    }
    const uploadedAudience = isUploadedAudienceSql(segmentSQL);

    const validation = validateSQL(segmentSQL);
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid segment SQL: ${validation.error}` }, { status: 400 });
    }

    const userIdField = dataset.userIdField;
    const primaryTable = dataset.entityTable ?? dataset.primaryTable;
    const offset = page * pageSize;
    const filterSQL = buildFilterSQL(filters);
    const searchSQL = search
      ? `AND CAST(to_json(__search_row) AS VARCHAR) ILIKE '%${escapeStr(search)}%'`
      : "";

    // Allowlist for sortCol — only permit well-known columns plus the dataset's entity ID field.
    // This prevents ORDER BY injection via arbitrary user-supplied column names.
    const SAFE_SORT_COLS = new Set([
      ...(userIdField ? [userIdField] : []),
      "event_count",
      "session_count",
      "revenue",
      "ltv",
      "first_seen",
      "last_seen",
      "created_at",
      "updated_at",
      "country",
      "platform",
      "app_version",
    ]);
    const validatedSortCol = sortCol && (uploadedAudience || SAFE_SORT_COLS.has(sortCol))
      ? sortCol
      : undefined;

    let countSQL: string;
    let dataSQL: string;

    if (userIdField && !uploadedAudience) {
      // With entity ID: deduplicate rows per entity, join back to primary table
      countSQL = `SELECT COUNT(*) AS cnt FROM (
        WITH user_rows AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ${q(userIdField)}) AS __rn
          FROM ${q(primaryTable)}
          WHERE ${q(userIdField)} IN (SELECT ${q(userIdField)} FROM (${segmentSQL}) __seg)
        )
        SELECT * EXCLUDE (__rn)
        FROM user_rows AS __search_row
        WHERE __rn = 1 ${filterSQL} ${searchSQL}
      ) __filtered`;

      const orderBy = validatedSortCol
        ? `ORDER BY ${q(validatedSortCol)} ${sortDir}`
        : `ORDER BY ${q(userIdField)} ASC`;
      dataSQL = `
        WITH user_rows AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ${q(userIdField)}) AS __rn
          FROM ${q(primaryTable)}
          WHERE ${q(userIdField)} IN (SELECT ${q(userIdField)} FROM (${segmentSQL}) __seg)
        )
        SELECT * EXCLUDE (__rn)
        FROM user_rows AS __search_row
        WHERE __rn = 1 ${filterSQL} ${searchSQL}
        ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}`;
    } else {
      // No entity ID: segment SQL returns rows directly, paginate them
      const orderBy = validatedSortCol
        ? `ORDER BY ${q(validatedSortCol)} ${sortDir}`
        : "";
      countSQL = `SELECT COUNT(*) AS cnt FROM (${segmentSQL}) __search_row WHERE 1=1 ${filterSQL} ${searchSQL}`;
      dataSQL = `SELECT * FROM (${segmentSQL}) __search_row WHERE 1=1 ${filterSQL} ${searchSQL} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;
    }

    const result = await withConnection(datasetId, async (conn) => {
      const countResult = await conn.run(countSQL);
      const countRows = await countResult.getRows();
      const totalCount = Number(countRows[0]?.[0]) || 0;

      const dataResult = await conn.run(dataSQL);
      const colNames = Array.from(dataResult.columnNames()).map(String);
      const rawRows = await dataResult.getRows();

      const rows = rawRows.map((row) => {
        const obj: Record<string, unknown> = {};
        colNames.forEach((col, i) => {
          let val = row[i];
          if (typeof val === "bigint") val = Number(val);
          if (val instanceof Date) val = val.toISOString();
          if (val !== null && typeof val === "object") {
            const proto = Object.getPrototypeOf(val);
            if (proto && proto !== Object.prototype) val = String(val);
          }
          obj[col] = val;
        });
        return obj;
      });

      return { columns: colNames, rows, totalCount, page };
    });

    return new Response(safeStringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[segments/users] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
