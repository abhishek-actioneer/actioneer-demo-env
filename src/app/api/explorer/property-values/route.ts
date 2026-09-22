import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDataset, getDatasetForUser } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";

function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function escapeStr(value: string): string {
  return value.replace(/'/g, "''");
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const datasetId = req.headers.get("x-dataset-id") || undefined;
    if (!datasetId) return NextResponse.json({ error: "Missing x-dataset-id" }, { status: 400 });
    if (!getDatasetForUser(datasetId, userId)) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    const body = await req.json();
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const property = typeof body.property === "string" ? body.property : "";
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

    const dataset = getDataset(datasetId);
    const event = dataset.events?.find((candidate) => candidate.id === eventId);
    const propertyDef = event?.properties.find((candidate) => candidate.column === property);

    if (!event || !propertyDef) {
      return NextResponse.json({ error: "Unknown event or property" }, { status: 400 });
    }

    const predicates = [`${q(property)} IS NOT NULL`];
    if (event.filterColumn && event.filterValue) {
      predicates.push(`${q(event.filterColumn)} = '${escapeStr(event.filterValue)}'`);
    }
    if (event.filterSQL) predicates.push(`(${event.filterSQL})`);

    const result = await executeSQLInternal(
      `SELECT ${q(property)} AS value, COUNT(*) AS count
       FROM ${q(event.table)}
       WHERE ${predicates.join(" AND ")}
       GROUP BY 1
       ORDER BY count DESC, value ASC
       LIMIT ${limit}`,
      datasetId,
    );

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      values: (result.rows ?? []).map((row) => ({
        value: row.value,
        count: Number(row.count) || 0,
      })),
    });
  } catch (err) {
    console.error("[explorer/property-values] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
