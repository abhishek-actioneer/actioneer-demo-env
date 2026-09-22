import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { withConnection } from "@/lib/db";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const datasetId = searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
    if (!getDatasetForUser(datasetId, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return await withConnection(datasetId, async (conn) => {
      const result = await conn.run(
        `SELECT * FROM sentinel_live_events ORDER BY timestamp DESC LIMIT ${limit}`
      );
      
      const columnNames = result.columnNames();
      const rows = await result.getRows();
      
      const events = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        row.forEach((val, i) => {
          obj[columnNames[i]] = val;
        });
        
        // Parse JSON fields
        if (typeof obj.properties === "string") {
          try { obj.properties = JSON.parse(obj.properties); } catch {}
        }
        if (typeof obj.context === "string") {
          try { obj.context = JSON.parse(obj.context); } catch {}
        }
        
        return obj;
      });
      
      return NextResponse.json({ events, count: events.length });
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
