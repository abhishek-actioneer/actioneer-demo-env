import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import { isUploadedAudienceSql } from "@/lib/segment-csv-upload";

function q(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

/** Returns distinct values for a column within a segment — used for filter dropdowns. */
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
    const column: string = body.column;

    if (!segmentSQL || !column) {
      return NextResponse.json({ error: "sql and column required" }, { status: 400 });
    }

    const userIdField = dataset.userIdField;
    const primaryTable = dataset.primaryTable;

    const innerSQL = userIdField && !isUploadedAudienceSql(segmentSQL)
      ? `SELECT DISTINCT ${q(column)} AS val
         FROM ${q(primaryTable)}
         WHERE ${q(userIdField)} IN (${segmentSQL})
           AND ${q(column)} IS NOT NULL
         ORDER BY val
         LIMIT 100`
      : `SELECT DISTINCT ${q(column)} AS val
         FROM (${segmentSQL}) __seg
         WHERE ${q(column)} IS NOT NULL
         ORDER BY val
         LIMIT 100`;

    const result = await executeSQLInternal(innerSQL, datasetId);

    const values = (result.rows ?? []).map((r) => r.val);

    return NextResponse.json({ values });
  } catch (err) {
    console.error("[segments/users/distinct] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
