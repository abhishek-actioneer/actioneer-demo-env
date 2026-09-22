import { auth } from "@clerk/nextjs/server";
import { getSegment } from "@/lib/server/segment-repo";
import { listActivity } from "@/lib/server/segment-activity-repo";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const segment = getSegment(userId, id);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const activity = listActivity(userId, id);
  return Response.json({ activity });
}
