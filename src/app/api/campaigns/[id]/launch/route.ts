import { auth } from "@clerk/nextjs/server";
import { launchQueuedTreatmentTasks } from "@/lib/server/lifecycle-campaign-service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const run = await launchQueuedTreatmentTasks(userId, id);
    return Response.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = (err as Error).message;
    const status = message === "Campaign not found" ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
