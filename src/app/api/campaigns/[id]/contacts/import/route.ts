import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getLifecycleCampaignBundle } from "@/lib/server/lifecycle-campaign-repo";
import { importCampaignContacts } from "@/lib/server/lifecycle-campaign-service";

const ImportSchema = z.object({
  csvText: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const bundle = getLifecycleCampaignBundle(userId, id);
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = ImportSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const result = importCampaignContacts({
    userId,
    datasetId: bundle.campaign.datasetId,
    csvText: parsed.data.csvText,
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
