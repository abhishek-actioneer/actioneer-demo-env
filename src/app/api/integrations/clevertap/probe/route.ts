import { auth } from "@clerk/nextjs/server";
import { getCleverTapConnection } from "@/lib/integrations/connections";
import { fetchCampaignResult } from "@/lib/integrations/clevertap";

/**
 * Debug probe: GET /api/integrations/clevertap/probe?targetId=1770978892
 * Returns the raw CleverTap targets/result.json response so we can see what
 * shape the trial plan returns vs. what's gated.
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get("targetId");
  const targetId = raw ? Number(raw) : NaN;
  if (!Number.isFinite(targetId)) {
    return Response.json({ error: "targetId query param required" }, { status: 400 });
  }

  const conn = await getCleverTapConnection(userId);
  if (!conn) return Response.json({ error: "CleverTap not connected" }, { status: 400 });

  const stats = await fetchCampaignResult(conn, targetId);
  return Response.json({ stats });
}
