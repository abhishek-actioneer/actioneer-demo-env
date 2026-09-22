import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { safeStringify } from "@/lib/safe-stringify";

function q(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
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

    if (!segmentSQL) {
      return NextResponse.json({ error: "Segment SQL required" }, { status: 400 });
    }

    const validation = validateSQL(segmentSQL);
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid segment SQL: ${validation.error}` }, { status: 400 });
    }

    const userIdField = dataset.userIdField;
    const primaryTable = dataset.entityTable ?? dataset.primaryTable;

    // Step 1: Discover string columns from the primary table schema
    const schemaResult = await executeSQLInternal(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = '${primaryTable.replace(/"/g, "")}'
       AND data_type = 'VARCHAR'
       ORDER BY ordinal_position`,
      datasetId,
    );

    if (schemaResult.error || !schemaResult.rows.length) {
      return new Response(
        safeStringify({ breakdowns: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Exclude obvious non-composition columns
    const skipColumns = new Set([
      ...(userIdField ? [userIdField] : []),
      "booking_id", "partner_id", "campaign_id",
      "id", "uuid", "email", "phone", "name", "address",
    ]);
    const candidates = schemaResult.rows
      .map((r) => String(r.column_name))
      .filter((col) => !skipColumns.has(col));

    // Step 2: For a sample of segment rows, check which columns are low-cardinality
    // (worth showing as breakdowns) vs high-cardinality (skip).
    const sampleFrom = userIdField
      ? `SELECT ${q(userIdField)}, ${candidates.map(q).join(", ")}
         FROM ${q(primaryTable)}
         WHERE ${q(userIdField)} IN (SELECT ${q(userIdField)} FROM (${segmentSQL}) __seg)
         LIMIT 5000`
      : `SELECT ${candidates.map(q).join(", ")}
         FROM (${segmentSQL}) __seg
         LIMIT 5000`;

    const sampleSQL = `
      WITH seg_sample AS (${sampleFrom})
      SELECT
        COUNT(*) AS row_cnt,
        ${candidates.map((col) => `COUNT(DISTINCT ${q(col)}) AS ${q("d_" + col)}`).join(",\n        ")}
      FROM seg_sample
    `;

    const sampleResult = await executeSQLInternal(sampleSQL, datasetId);
    if (sampleResult.error || !sampleResult.rows.length) {
      return new Response(
        safeStringify({ breakdowns: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const row = sampleResult.rows[0];
    const rowCnt = Number(row.row_cnt) || 1;

    // Classify: low-cardinality columns worth showing as breakdowns
    const compositionCols: string[] = [];

    for (const col of candidates) {
      const distinctCount = Number(row[`d_${col}`]) || 0;
      if (distinctCount <= 1 || distinctCount > 50) continue;
      if (distinctCount <= 30) {
        compositionCols.push(col);
      }
    }

    // Step 3: Query composition — GROUP BY each low-cardinality column, count rows
    const breakdowns: { property: string; displayName: string; values: { name: string; count: number }[] }[] = [];

    const compositionProps = compositionCols.slice(0, 8);
    const compositionResults = await Promise.all(
      compositionProps.map(async (col) => {
        const sql = userIdField
          ? `WITH user_attr AS (
              SELECT ${q(userIdField)}, ${q(col)} AS val
              FROM ${q(primaryTable)}
              WHERE ${q(userIdField)} IN (SELECT ${q(userIdField)} FROM (${segmentSQL}) __seg)
                AND ${q(col)} IS NOT NULL
              GROUP BY ${q(userIdField)}, ${q(col)}
            ),
            deduped AS (
              SELECT ${q(userIdField)}, FIRST(val) AS val FROM user_attr GROUP BY ${q(userIdField)}
            )
            SELECT val, COUNT(*) AS cnt
            FROM deduped
            GROUP BY val
            ORDER BY cnt DESC
            LIMIT 20`
          : `SELECT ${q(col)} AS val, COUNT(*) AS cnt
            FROM (${segmentSQL}) __seg
            WHERE ${q(col)} IS NOT NULL
            GROUP BY ${q(col)}
            ORDER BY cnt DESC
            LIMIT 20`;
        const qr = await executeSQLInternal(sql, datasetId);
        return {
          property: col,
          displayName: formatColumnName(col),
          values: (qr.rows ?? []).map((r) => ({
            name: String(r.val ?? ""),
            count: Number(r.cnt) || 0,
          })),
        };
      }),
    );
    breakdowns.push(...compositionResults.filter((b) => b.values.length > 0));

    return new Response(
      safeStringify({ breakdowns }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[segments/composition] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** Convert snake_case column name to Title Case display name */
function formatColumnName(col: string): string {
  return col
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
