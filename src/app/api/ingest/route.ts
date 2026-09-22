import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_DATASET } from "@/lib/datasets";
import { executeSQLPrepared } from "@/lib/sql-executor";

const INSERT_SQL = `INSERT INTO sentinel_live_events (
  id, tenant_id, app_id, event_type, tier, timestamp, session_id,
  anonymous_id, user_id, platform, device_type, properties, context
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { events } = body;

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ status: "ok", ingested: 0 });
    }

    let ingested = 0;
    const errors: string[] = [];

    for (const event of events) {
      try {
        const id = crypto.randomUUID();
        const params = [
          id,
          event.context?.tenant_id || "",
          event.context?.app_id || "",
          event.event_type || "",
          Number(event.tier) || 1,
          event.timestamp || new Date().toISOString(),
          event.session_id || "",
          event.anonymous_id || "",
          event.user_id || "",
          event.context?.platform || "",
          event.context?.device_type || "",
          JSON.stringify(event.properties || {}),
          JSON.stringify(event.context || {}),
        ];

        const result = await executeSQLPrepared(INSERT_SQL, params, DEFAULT_DATASET);
        if (result.error) {
          errors.push(`Failed to insert ${event.event_type}: ${result.error}`);
        } else {
          ingested++;
        }
      } catch (e) {
        errors.push(`Failed to insert ${event.event_type}: ${e}`);
      }
    }

    return NextResponse.json({
      status: "ok",
      ingested,
      errors: errors.length > 0 ? errors : null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
