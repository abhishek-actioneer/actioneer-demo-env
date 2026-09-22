import { auth } from "@clerk/nextjs/server";
import { getCampaign } from "@/lib/voice-campaign-store";

export const runtime = "nodejs";

function recordingUrlForCall(req: Request, callId: string, recordingSid: string, datasetId?: string): string {
  const url = new URL(
    `/api/voice/recordings/${encodeURIComponent(callId)}/${encodeURIComponent(recordingSid)}`,
    req.url,
  );
  if (datasetId) url.searchParams.set("datasetId", datasetId);
  return url.toString();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id, callId } = await params;
  const campaign = getCampaign(id, { userId });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  const call = campaign.calls.find((item) =>
    item.id === callId ||
    item.callConfigId === callId ||
    item.providerRequestId === callId
  );
  if (!call) return Response.json({ error: "Call not found" }, { status: 404 });

  const recordings = [call.recording, call.bridgeRecording]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((recording) => ({
      sid: recording.sid,
      status: recording.status,
      source: recording.source,
      storageKey: recording.storageKey,
      recordingUri: recording.recordingUri,
      contentType: recording.contentType,
      durationSeconds: recording.durationSeconds,
      sizeBytes: recording.sizeBytes,
      storedAt: recording.storedAt,
      startedAt: recording.startedAt,
      playbackUrl: recordingUrlForCall(req, call.id, recording.sid, campaign.datasetId),
    }));

  return Response.json(
    {
      campaignId: campaign.id,
      datasetId: campaign.datasetId,
      callId: call.id,
      clientPartition: {
        userId: campaign.userId,
        datasetId: campaign.datasetId,
        campaignId: campaign.id,
      },
      recordings,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
