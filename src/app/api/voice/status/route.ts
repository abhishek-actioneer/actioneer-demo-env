import { listCampaigns, upsertCall } from "@/lib/voice-campaign-store";
import type { VoiceCallStatus } from "@/lib/voice-campaign-types";
import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";
import { enqueueCallEvent } from "@/lib/server/call-event-outbox-repo";

const STATUS_MAP: Record<string, VoiceCallStatus> = {
  completed: "completed",
  failed: "failed",
  "no-answer": "no_answer",
  busy: "failed",
  canceled: "failed",
};

// Twilio sends call status updates here after a call ends.
export async function POST(req: Request) {
  const configuredCallId = new URL(req.url).searchParams.get("callId") ?? "";
  const formData = await req.formData();
  const params = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
  );
  if (!verifyTwilioWebhookSignature(req, params)) {
    return new Response("Forbidden", { status: 403 });
  }
  const callSid = formData.get("CallSid") as string;
  const rawStatus = (formData.get("CallStatus") as string) ?? "";
  const durationSeconds = parseInt((formData.get("CallDuration") as string) ?? "0", 10) || undefined;
  const callDuration = formData.get("CallDuration");
  const errorCode = formData.get("ErrorCode");
  const errorMessage = formData.get("ErrorMessage");

  console.log(
    `[voice/status] CallSid=${callSid} status=${rawStatus || "(missing)"} duration=${callDuration ?? "(missing)"}` +
      (errorCode ? ` errorCode=${errorCode}` : "") +
      (errorMessage ? ` errorMessage=${errorMessage}` : ""),
  );

  const status = STATUS_MAP[rawStatus] ?? "completed";

  // Find which campaign owns this call by searching for the Twilio call SID.
  const campaigns = listCampaigns();
  for (const campaign of campaigns) {
    const call = campaign.calls.find((c) =>
      c.id === callSid ||
      c.providerRequestId === callSid ||
      c.callConfigId === configuredCallId
    );
    if (call) {
      upsertCall(campaign.id, {
        id: callSid,
        callConfigId: configuredCallId || call.callConfigId,
        providerRequestId: call.providerRequestId,
        toNumber: call.toNumber,
        status,
        durationSeconds,
        engaged: (durationSeconds ?? 0) >= 20,
        endedAt: new Date().toISOString(),
      });
      if (campaign.userId && campaign.datasetId) {
        try {
          enqueueCallEvent({
            userId: campaign.userId,
            datasetId: campaign.datasetId,
            campaignId: campaign.id,
            callId: callSid,
            provider: "twilio",
            eventType: "call.status",
            payload: {
              configuredCallId,
              callSid,
              rawStatus,
              mappedStatus: status,
              durationSeconds,
              errorCode: errorCode ? String(errorCode) : undefined,
              errorMessage: errorMessage ? String(errorMessage) : undefined,
            },
          });
        } catch (error) {
          console.error("[voice/status] Failed to enqueue call event", error);
        }
      }
      break;
    }
  }

  return new Response(null, { status: 200 });
}
