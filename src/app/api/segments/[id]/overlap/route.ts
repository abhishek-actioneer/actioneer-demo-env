import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { listSegments } from "@/lib/server/segment-repo";
import { safeStringify } from "@/lib/safe-stringify";

function q(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: segmentId } = await params;
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

    // Get current segment user count
    const countResult = await executeSQLInternal(
      `SELECT COUNT(*) AS cnt FROM (${segmentSQL}) sub`,
      datasetId,
    );
    const segmentCount = Number(countResult.rows[0]?.cnt) || 1;

    // Get all other saved segments from SQLite
    const allSegments = listSegments(userId, datasetId);

    const otherSegments = allSegments
      .filter((s) => s.id !== segmentId)
      .slice(0, 50)
      .map((s) => ({
        id: s.id,
        name: s.name,
        sql: s.sql.trim().replace(/;+\s*$/, ""),
      }));

    // Compute overlap with each other segment in parallel
    // With userIdField: INTERSECT on the entity column
    // Without: INTERSECT on full rows (works for SELECT * segments)
    const overlaps = await Promise.all(
      otherSegments.slice(0, 10).map(async (other) => {
        const otherValidation = validateSQL(other.sql);
        if (!otherValidation.valid) return null;
        try {
          const overlapSQL = userIdField
            ? `SELECT COUNT(*) AS cnt FROM (
                SELECT ${q(userIdField)} FROM (${segmentSQL}) a
                INTERSECT
                SELECT ${q(userIdField)} FROM (${other.sql}) b
              ) overlap`
            : `SELECT COUNT(*) AS cnt FROM (
                SELECT * FROM (${segmentSQL}) a
                INTERSECT
                SELECT * FROM (${other.sql}) b
              ) overlap`;
          const overlapResult = await executeSQLInternal(overlapSQL, datasetId);
          const overlapCount = Number(overlapResult.rows[0]?.cnt) || 0;
          if (overlapCount === 0) return null;

          return {
            name: other.name,
            overlapCount,
            overlapPct: Math.round((overlapCount / segmentCount) * 100),
          };
        } catch {
          return null;
        }
      }),
    );

    const validOverlaps = overlaps
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .sort((a, b) => b.overlapCount - a.overlapCount);

    return new Response(
      safeStringify({ overlaps: validOverlaps }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[segments/overlap] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
