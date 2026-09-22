import { auth } from "@clerk/nextjs/server";
import { safeVoiceInsightRunId } from "@/lib/voice-campaign-insights-loader";
import { loadCallTranscript, maskPhone } from "@/lib/voice-campaign-transcript-loader";

export const runtime = "nodejs";

const SAFE_CALL_ID = /^[a-zA-Z0-9_-]+$/;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const runId = safeVoiceInsightRunId(params.get("runId") ?? params.get("run"));
  if (!runId) return Response.json({ error: "Invalid runId" }, { status: 400 });

  const callId = params.get("callId") ?? "";
  if (!SAFE_CALL_ID.test(callId) || callId.length > 200) {
    return Response.json({ error: "Invalid callId" }, { status: 400 });
  }

  const record = await loadCallTranscript(runId, callId);
  if (!record) return Response.json({ error: "Transcript not found" }, { status: 404 });

  // Never ship the raw number — mask before it leaves the server.
  return Response.json(
    { ...record, call: { ...record.call, toNumber: maskPhone(record.call.toNumber) } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
