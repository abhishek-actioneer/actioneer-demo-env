import { getAttributionRecord, getCallAttribution } from "@/lib/attribution-store";
import { auth } from "@clerk/nextjs/server";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "disabled in production" }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const token  = url.searchParams.get("token");
  const callId = url.searchParams.get("callId");

  if (!token && !callId) {
    return Response.json({ error: "Pass ?token=... or ?callId=..." }, { status: 400 });
  }

  if (token) {
    const record = getAttributionRecord(token);
    if (!record) return Response.json({ error: "Token not found." }, { status: 404 });

    return Response.json({
      token:           record.token,
      clicks:          record.clicks,
      attributedAt:    record.attributedAt ?? null,
      humanClickCount: record.clicks.filter((c) => !c.isBot).length,
      botClickCount:   record.clicks.filter((c) =>  c.isBot).length,
      expired:         new Date() > new Date(record.token.expiresAt),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  // callId lookup
  const result = getCallAttribution(callId!);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
