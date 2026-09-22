import { auth } from "@clerk/nextjs/server";
import { campaignResults } from "@/lib/server/lifecycle-campaign-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const results = await campaignResults(userId, id);
    return Response.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = (err as Error).message;
    return Response.json({ error: message }, { status: message === "Campaign not found" ? 404 : 400 });
  }
}
