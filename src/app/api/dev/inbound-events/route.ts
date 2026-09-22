import { auth } from "@clerk/nextjs/server";
import { getEventsForCampaign } from "@/lib/inbound-event-store";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "disabled in production" }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const campaignId = new URL(req.url).searchParams.get("campaignId");
  if (!campaignId) return Response.json({ error: "Pass ?campaignId=..." }, { status: 400 });

  const events = getEventsForCampaign(campaignId);
  return Response.json({ events, count: events.length }, { headers: { "Cache-Control": "no-store" } });
}
