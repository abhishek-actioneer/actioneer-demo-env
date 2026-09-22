import { listCampaigns, upsertCall } from "@/lib/voice-campaign-store";
import { getFraudCallMeta } from "@/lib/fraud-call-registry";
import type { VoiceCall, VoiceCallStatus, VoiceCampaign } from "@/lib/voice-campaign-types";
import { readAndDumpVoiceForm, updateVoiceDump } from "@/lib/voice-debug-dump";
import { verifyPlivoWebhookSignature } from "@/lib/voice-webhook-auth";
import { formDataToParamMap } from "@/lib/plivo-webhook-signature";
import { enqueueCallEvent } from "@/lib/server/call-event-outbox-repo";
import { enqueueVoiceEvalCall } from "@/lib/server/voice-eval-repo";

const STATUS_MAP: Record<string, VoiceCallStatus> = {
  completed: "completed",
  failed: "failed",
  "no-answer": "no_answer",
  busy: "failed",
  cancel: "failed",
  canceled: "failed",
  timeout: "failed",
};

export async function POST(req: Request) {
  const { formData, dumpStorageKey } = await readAndDumpVoiceForm(req, "plivo-status");
  if (!(await verifyPlivoWebhookSignature(req, formDataToParamMap(formData)))) {
    return new Response("Forbidden", { status: 403 });
  }
  const configuredCallId = new URL(req.url).searchParams.get("callId") ?? "";
  const callUuid = (formData.get("CallUUID") as string) || "";
  const requestUuid = (formData.get("RequestUUID") as string) || "";
  const callId = callUuid || requestUuid;
  const rawStatus = ((formData.get("CallStatus") as string) || "").toLowerCase();
  const durationSeconds = parseInt(
    ((formData.get("Duration") as string) || (formData.get("BillDuration") as string) || "0"),
    10,
  ) || undefined;
  const hangupCause = formData.get("HangupCauseName");

  console.log(
    `[voice/plivo-status] CallUUID=${callUuid || "(missing)"} RequestUUID=${requestUuid || "(missing)"} callId=${configuredCallId || "(missing)"} status=${rawStatus || "(missing)"}` +
      ` duration=${durationSeconds ?? "(missing)"}` +
      (hangupCause ? ` cause=${hangupCause}` : ""),
  );

  let matchedCampaignId: string | undefined;
  let matchedCallId: string | undefined;

  if (!callId && !configuredCallId) {
    updateVoiceDump({
      dumpStorageKey,
      patch: {
        normalized: {
          configuredCallId,
          callUuid,
          requestUuid,
          rawStatus,
          durationSeconds,
          hangupCause,
        },
      },
    });
    return new Response(null, { status: 200 });
  }

  const status = STATUS_MAP[rawStatus] ?? "completed";

  for (const campaign of listCampaigns()) {
    const call = campaign.calls.find((item) =>
      item.id === callId ||
      Boolean(callUuid && item.id === callUuid) ||
      Boolean(requestUuid && item.providerRequestId === requestUuid) ||
      Boolean(configuredCallId && item.callConfigId === configuredCallId)
    );
    if (call) {
      upsertCall(campaign.id, {
        id: callUuid || call.id,
        callConfigId: configuredCallId || call.callConfigId,
        providerRequestId: requestUuid || call.providerRequestId,
        provider: "plivo",
        toNumber: call.toNumber,
        status,
        durationSeconds,
        engaged: (durationSeconds ?? 0) >= 20,
        endedAt: new Date().toISOString(),
      });
      matchedCampaignId = campaign.id;
      matchedCallId = call.id;
      if (campaign.userId && campaign.datasetId) {
        try {
          enqueueCallEvent({
            userId: campaign.userId,
            datasetId: campaign.datasetId,
            campaignId: campaign.id,
            callId: callUuid || call.id,
            provider: "plivo",
            eventType: "call.status",
            payload: {
              configuredCallId,
              callUuid,
              requestUuid,
              rawStatus,
              mappedStatus: status,
              durationSeconds,
              hangupCause,
            },
          });
        } catch (error) {
          console.error("[voice/plivo-status] Failed to enqueue call event", error);
        }
        if (Object.prototype.hasOwnProperty.call(STATUS_MAP, rawStatus)) {
          try {
            enqueueVoiceEvalCall({
              userId: campaign.userId,
              datasetId: campaign.datasetId,
              campaignId: campaign.id,
              callId: callUuid || call.id,
            });
          } catch (error) {
            console.error("[voice/plivo-status] Failed to enqueue call eval", error);
          }
        }
      }

      if (status === "completed" && campaign.datasetId) {
        const capturedCall = {
          ...call,
          id: callUuid || call.id,
          callConfigId: configuredCallId || call.callConfigId,
          durationSeconds,
          endedAt: new Date().toISOString(),
        };
        void runPostCallRiskAnalysis({
          campaign,
          call: capturedCall,
          configuredCallId,
          callUuid,
          requestUuid,
        }).catch((err) => {
          console.error("[voice/plivo-status] Post-call risk analysis failed:", err);
        });
      }

      break;
    }
  }

  updateVoiceDump({
    dumpStorageKey,
    patch: {
      normalized: {
        configuredCallId,
        callUuid,
        requestUuid,
        resolvedCallId: callId,
        rawStatus,
        status,
        durationSeconds,
        hangupCause,
        matchedCampaignId,
        matchedCallId,
      },
    },
  });

  return new Response(null, { status: 200 });
}

async function runPostCallRiskAnalysis({
  campaign,
  call,
  configuredCallId,
  callUuid,
  requestUuid,
}: {
  campaign: VoiceCampaign;
  call: VoiceCall;
  configuredCallId: string;
  callUuid: string;
  requestUuid: string;
}): Promise<void> {
  const datasetId = campaign.datasetId;
  if (!datasetId) return;

  const analysisCallId = configuredCallId || call.callConfigId || call.id || callUuid || requestUuid;
  if (!analysisCallId) return;

  const registryMeta =
    getFraudCallMeta(analysisCallId) ||
    (callUuid ? getFraudCallMeta(callUuid) : undefined) ||
    (requestUuid ? getFraudCallMeta(requestUuid) : undefined);
  const transcript = call.transcript ?? [];

  const {
    computeDuressScore,
    computeTranscriptFeatures,
    runGenderClassification,
    writeFraudAnalysisToDuckDB,
    writeGenderToDuckDB,
    updateGenderStatus,
  } = await import("@/lib/fraud-analysis");

  const features = computeTranscriptFeatures(transcript);
  const duressScore = computeDuressScore(features);
  const recommendation = registryMeta?.outcome ?? inferVerificationOutcome(transcript) ?? "unknown";
  const customerId = registryMeta?.customerId || registryMeta?.subjectId || call.recipientId || "";
  const gender = registryMeta?.cardholderGender || call.recipientContext?.gender || null;

  const input = {
    callId: analysisCallId,
    campaignId: campaign.id,
    alertId: registryMeta?.alertId ?? "",
    customerId,
    amountAtRisk: registryMeta?.amountAtRisk ?? 0,
    recommendation,
    toolName: registryMeta?.outcomeTool ?? "",
    toolArgs: registryMeta?.outcomeArgs ?? {},
    cardholderGender: gender,
    transcript,
    resolvedAt: registryMeta?.resolvedAt,
    datasetId,
  };

  try {
    await writeFraudAnalysisToDuckDB(input, features, duressScore, null);
  } catch (err) {
    console.warn("[voice/plivo-status] Initial call analysis write failed:", err instanceof Error ? err.message : err);
  }

  const bridgeCallIdentities = [
    callUuid,
    call.id,
    call.callConfigId,
    requestUuid,
    configuredCallId,
  ].filter((value): value is string => Boolean(value));
  if (bridgeCallIdentities.length === 0) return;

  // Identity check: voice-gender vs registered gender. This is the only acoustic
  // signal we surface. Transcript/duress features are still logged above (silent,
  // for future labelled-model work) but the acoustic stress / coercion scoring
  // (Python /analyze-call) is intentionally NOT called — it produced unreliable,
  // telephony-confounded "coercion" numbers. See identity-check rationale.
  //
  // Marked "pending" before the attempt and resolved to completed/failed/skipped
  // after, so a dev-server restart mid-attempt leaves a visible stuck "pending"
  // row in voice_verification_calls instead of silently looking like gender was
  // never attempted at all.
  await updateGenderStatus(analysisCallId, datasetId, "pending");
  try {
    const detected = await runGenderClassification(bridgeCallIdentities);
    if (detected.kind === "detected") {
      await writeGenderToDuckDB(analysisCallId, gender, detected, datasetId, { campaignId: campaign.id });
      return;
    }
    if (detected.kind === "skipped") {
      const reason = detected.detail
        ? `${detected.reason}: ${detected.detail}`
        : detected.reason;
      await updateGenderStatus(analysisCallId, datasetId, "skipped", reason);
      return;
    }
    await updateGenderStatus(analysisCallId, datasetId, "failed", detected.reason);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[voice/plivo-status] Gender analysis failed:", message);
    await updateGenderStatus(analysisCallId, datasetId, "failed", message).catch(() => {});
  }
}

function inferVerificationOutcome(transcript: VoiceCall["transcript"]): "clear" | "block" | "escalate" | undefined {
  const assistantText = (transcript ?? [])
    .filter((turn) => turn.role === "assistant")
    .slice(-3)
    .map((turn) => turn.text.toLowerCase())
    .join(" ");
  if (/\b(clear_transaction|outcome\s*:\s*clear|final\s*:\s*clear|\bclear\b)/i.test(assistantText)) return "clear";
  if (/\b(block_card|outcome\s*:\s*block|final\s*:\s*block|\bblock\b)/i.test(assistantText)) return "block";
  if (/\b(escalate_to_specialist|outcome\s*:\s*escalate|final\s*:\s*escalate|\bescalate\b)/i.test(assistantText)) return "escalate";
  return undefined;
}
