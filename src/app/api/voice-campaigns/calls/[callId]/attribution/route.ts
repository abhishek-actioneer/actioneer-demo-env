import { auth } from "@clerk/nextjs/server";
import { getCallAttribution } from "@/lib/attribution-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { callId } = await params;
  if (!callId) return Response.json({ error: "Missing callId" }, { status: 400 });

  const result = getCallAttribution(callId);
  return Response.json(result);
}
