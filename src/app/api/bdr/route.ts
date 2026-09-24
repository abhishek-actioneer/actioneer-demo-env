import { bdrRoute } from "@/lib/bdr/http";
import { bdrReadiness } from "@/lib/bdr/config";
import { listBdrCampaigns } from "@/lib/bdr/store";
export const runtime = "nodejs";
export async function GET() {
  return bdrRoute(async (userId) => Response.json({ campaigns: listBdrCampaigns(userId), readiness: bdrReadiness() }, { headers: { "Cache-Control": "no-store" } }));
}
