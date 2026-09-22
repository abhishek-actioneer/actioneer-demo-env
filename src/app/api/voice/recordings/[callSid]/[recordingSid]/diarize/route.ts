import { auth } from "@clerk/nextjs/server";
import { findCall } from "@/lib/voice-campaign-store";
import { diarizeStoredCallTranscript } from "@/lib/voice-transcription";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";

export const runtime = "nodejs";

function datasetIdFromRequest(req: Request): string {
  const raw = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ callSid: string; recordingSid: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { callSid, recordingSid } = await params;
  const found = findCall(callSid, { userId, datasetId: datasetIdFromRequest(req) });
  if (!found || (found.call.recording?.sid !== recordingSid && found.call.bridgeRecording?.sid !== recordingSid)) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  try {
    const turns = await diarizeStoredCallTranscript(callSid, recordingSid);
    return Response.json({ turns });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
