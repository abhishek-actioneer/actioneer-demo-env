import { readAndDumpVoiceForm, updateVoiceDump } from "@/lib/voice-debug-dump";
import { verifyPlivoWebhookSignature } from "@/lib/voice-webhook-auth";
import { formDataToParamMap } from "@/lib/plivo-webhook-signature";
import { findCallByAnyIdentity } from "@/lib/voice-campaign-store";
import { enqueueCallEvent } from "@/lib/server/call-event-outbox-repo";

export async function POST(req: Request) {
  const { formData, body: payload, dumpStorageKey } = await readAndDumpVoiceForm(req, "plivo-stream-status");
  if (!(await verifyPlivoWebhookSignature(req, formDataToParamMap(formData)))) {
    return new Response("Forbidden", { status: 403 });
  }
  const streamId = formData.get("StreamID") ?? formData.get("StreamId") ?? formData.get("streamId");
  const callUuid = formData.get("CallUUID") ?? formData.get("CallUuid") ?? formData.get("callId");
  const event = formData.get("Event") ?? formData.get("StreamEvent") ?? formData.get("event");
  const statusReason = formData.get("StatusReason") ?? formData.get("Reason") ?? formData.get("Error") ?? formData.get("error");

  console.log(
    `[voice/plivo-stream-status] StreamID=${streamId ?? "(missing)"} CallUUID=${callUuid ?? "(missing)"}` +
      ` event=${event ?? "(missing)"} reason=${statusReason ?? "(missing)"} payload=${JSON.stringify(payload)}`,
  );
  updateVoiceDump({
    dumpStorageKey,
    patch: {
      normalized: {
        streamId,
        callUuid,
        event,
        statusReason,
      },
    },
  });

  const resolvedCallId = typeof callUuid === "string" ? callUuid : undefined;
  if (resolvedCallId) {
    const found = findCallByAnyIdentity([resolvedCallId]);
    if (found?.campaign.userId && found.campaign.datasetId) {
      try {
        enqueueCallEvent({
          userId: found.campaign.userId,
          datasetId: found.campaign.datasetId,
          campaignId: found.campaign.id,
          callId: found.call.id,
          provider: "plivo",
          eventType: "call.stream_status",
          payload: {
            streamId: typeof streamId === "string" ? streamId : null,
            event: typeof event === "string" ? event : null,
            statusReason: typeof statusReason === "string" ? statusReason : null,
          },
        });
      } catch (error) {
        console.error("[voice/plivo-stream-status] Failed to enqueue call event", error);
      }
    }
  }
  return new Response(null, { status: 200 });
}
