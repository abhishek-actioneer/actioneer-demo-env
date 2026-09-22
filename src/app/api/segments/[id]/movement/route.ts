import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal, validateSQL } from "@/lib/sql-executor";
import { listSegments } from "@/lib/server/segment-repo";
import { safeStringify } from "@/lib/safe-stringify";

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
    const period: string = body.period ?? "30d";

    if (!segmentSQL) {
      return NextResponse.json({ error: "Segment SQL required" }, { status: 400 });
    }

    const validation = validateSQL(segmentSQL);
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid segment SQL: ${validation.error}` }, { status: 400 });
    }

    const userIdField = dataset.userIdField;
    const primaryTable = dataset.primaryTable;
    const dateField = dataset.dateField;

    // Movement requires a user/entity ID to track flows between segments
    if (!userIdField) {
      return new Response(
        safeStringify({ inflow: [], outflow: [], netChange: 0, entered: 0, left: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Compute period in days
    const days = period === "90d" ? 90 : period === "60d" ? 60 : 30;

    // Get all other saved segments from SQLite
    const allSegments = listSegments(userId, datasetId);
    const otherSegments = allSegments
      .filter((s) => s.id !== segmentId)
      .slice(0, 50)
      .map((s) => ({ id: s.id, name: s.name, sql: s.sql }));

    if (otherSegments.length === 0) {
      return new Response(
        safeStringify({
          inflow: [],
          outflow: [],
          netChange: 0,
          entered: 0,
          left: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Current segment users
    const currentUsersSQL = segmentSQL;

    // For each other segment, compute overlap with current segment
    const inflow: { segmentName: string; userCount: number; percentage: number }[] = [];
    const outflow: { segmentName: string; userCount: number; percentage: number }[] = [];

    // Get current segment size
    const currentCountResult = await executeSQLInternal(
      `SELECT COUNT(*) AS cnt FROM (${currentUsersSQL}) sub`,
      datasetId,
    );
    const currentCount = Number(currentCountResult.rows[0]?.cnt) || 1;

    // Check overlap with each other segment
    for (const other of otherSegments.slice(0, 10)) {
      const otherValidation = validateSQL(other.sql);
      if (!otherValidation.valid) continue;
      try {
        // Users in BOTH this segment and the other segment
        const overlapResult = await executeSQLInternal(
          `SELECT COUNT(*) AS cnt
           FROM (SELECT ${quoteIdent(userIdField)} FROM (${currentUsersSQL}) LIMIT 10000) a
           INNER JOIN (SELECT ${quoteIdent(userIdField)} FROM (${other.sql}) LIMIT 10000) b
           ON a.${quoteIdent(userIdField)} = b.${quoteIdent(userIdField)}`,
          datasetId,
        );
        const overlapCount = Number(overlapResult.rows[0]?.cnt) || 0;

        if (overlapCount > 0) {
          // Users in other segment but not in this → potential inflow source
          const otherOnlyResult = await executeSQLInternal(
            `SELECT COUNT(*) AS cnt
             FROM (SELECT ${quoteIdent(userIdField)} FROM (${other.sql}) LIMIT 10000) b
             LEFT JOIN (SELECT ${quoteIdent(userIdField)} FROM (${currentUsersSQL}) LIMIT 10000) a
             ON b.${quoteIdent(userIdField)} = a.${quoteIdent(userIdField)}
             WHERE a.${quoteIdent(userIdField)} IS NULL`,
            datasetId,
          );
          const otherOnly = Number(otherOnlyResult.rows[0]?.cnt) || 0;

          if (overlapCount > 0) {
            inflow.push({
              segmentName: other.name,
              userCount: overlapCount,
              percentage: Math.round((overlapCount / currentCount) * 100),
            });
          }
        }
      } catch {
        // Skip segments with invalid SQL
      }
    }

    // Sort by user count
    inflow.sort((a, b) => b.userCount - a.userCount);

    // For outflow, we'd need historical data (what the segment looked like N days ago)
    // Since we don't have time-travel, approximate: users in other segments but not this one
    for (const other of otherSegments.slice(0, 10)) {
      const otherValidation = validateSQL(other.sql);
      if (!otherValidation.valid) continue;
      try {
        const leftResult = await executeSQLInternal(
          `SELECT COUNT(*) AS cnt
           FROM (SELECT ${quoteIdent(userIdField)} FROM (${other.sql}) LIMIT 10000) b
           LEFT JOIN (SELECT ${quoteIdent(userIdField)} FROM (${currentUsersSQL}) LIMIT 10000) a
           ON b.${quoteIdent(userIdField)} = a.${quoteIdent(userIdField)}
           WHERE a.${quoteIdent(userIdField)} IS NULL`,
          datasetId,
        );
        const leftCount = Number(leftResult.rows[0]?.cnt) || 0;
        if (leftCount > 0 && leftCount < 10000) {
          outflow.push({
            segmentName: other.name,
            userCount: leftCount,
            percentage: Math.round((leftCount / currentCount) * 100),
          });
        }
      } catch {
        // Skip
      }
    }

    outflow.sort((a, b) => b.userCount - a.userCount);

    const entered = inflow.reduce((s, f) => s + f.userCount, 0);
    const left = outflow.reduce((s, f) => s + f.userCount, 0);

    return new Response(
      safeStringify({
        inflow: inflow.slice(0, 5),
        outflow: outflow.slice(0, 5),
        netChange: entered - left,
        entered,
        left,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[segments/movement] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}
