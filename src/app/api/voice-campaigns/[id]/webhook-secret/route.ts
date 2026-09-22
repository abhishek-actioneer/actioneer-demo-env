import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { getCampaign, updateCampaign } from "@/lib/voice-campaign-store";

function generateSecret(): string {
  return `whs_${randomBytes(24).toString("hex")}`; // whs_ prefix + 48 hex chars
}

// GET — return existing secret (or generate if missing)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found." }, { status: 404 });

  if (campaign.webhookSecret) {
    return Response.json({ secret: campaign.webhookSecret }, { headers: { "Cache-Control": "no-store" } });
  }

  // Generate on first access
  const secret = generateSecret();
  updateCampaign(id, { webhookSecret: secret }, { userId });
  return Response.json({ secret }, { headers: { "Cache-Control": "no-store" } });
}

// POST — regenerate secret (invalidates all existing integrations)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Not found." }, { status: 404 });

  const secret = generateSecret();
  updateCampaign(id, { webhookSecret: secret }, { userId });
  return Response.json({ secret, regenerated: true }, { headers: { "Cache-Control": "no-store" } });
}
