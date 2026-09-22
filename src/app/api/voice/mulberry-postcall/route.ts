import { listCampaigns, upsertCall } from "@/lib/voice-campaign-store";
import type {
  VoiceCallStatus,
  VoiceRecording,
  VoiceTranscriptTurn,
} from "@/lib/voice-campaign-types";
import { enqueueCallEvent } from "@/lib/server/call-event-outbox-repo";
import { enqueueVoiceEvalCall } from "@/lib/server/voice-eval-repo";

/**
 * Post-call webhook for the SEPARATE Mulberry (Pipecat) rail.
 *
 * Mulberry's external runtime owns the call (its own Plivo + Pipecat), so its
 * hangup never hits our `plivo-status` CDR webhook. Instead Mulberry POSTs the
 * result here (we hand it `postCall.callbackUrl` in the /start payload). We
 * reconcile it onto the same VoiceCall record + eval pipeline the Gemini rail
 * uses, so both rails land in one workbench.
 *
 * Field parsing is deliberately tolerant — the vendor's exact response shape is
 * still being finalized over WhatsApp; we accept common aliases.
 */

const STATUS_MAP: Record<string, VoiceCallStatus> = {
  completed: "completed",
  complete: "completed",
  done: "completed",
  success: "completed",
  failed: "failed",
  error: "failed",
  busy: "failed",
  cancel: "failed",
  canceled: "failed",
  cancelled: "failed",
  timeout: "failed",
  "no-answer": "no_answer",
  no_answer: "no_answer",
  noanswer: "no_answer",
};

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function normalizeRole(raw: unknown): VoiceTranscriptTurn["role"] {
  const value = String(raw ?? "").toLowerCase();
  if (["assistant", "agent", "bot", "ai"].includes(value)) return "assistant";
  if (["user", "customer", "human", "caller"].includes(value)) return "user";
  return "user";
}

function coerceTranscript(raw: unknown, callId: string): VoiceTranscriptTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const now = new Date().toISOString();
  const turns: VoiceTranscriptTurn[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const obj = item as Record<string, unknown>;
    const text = pickString(obj, ["text", "content", "message", "utterance"]);
    if (!text) return;
    turns.push({
      id: `${callId}-mb-${index}`,
      role: normalizeRole(obj.speaker ?? obj.role),
      text,
      at: pickString(obj, ["at", "timestamp"]) ?? now,
      sequence: index,
      startMs: pickNumber(obj, ["startMs", "start_ms", "startMillis"]),
      endMs: pickNumber(obj, ["endMs", "end_ms", "endMillis"]),
    });
  });
  return turns.length ? turns : undefined;
}

function authorized(req: Request, body: Record<string, unknown>): boolean {
  const expected = process.env.MULBERRY_WEBHOOK_SECRET?.trim();
  if (!expected) {
    console.warn("[voice/mulberry-postcall] MULBERRY_WEBHOOK_SECRET not set — accepting unauthenticated callback");
    return true;
  }
  const headerSecret =
    req.headers.get("x-mulberry-secret")?.trim() ||
    req.headers.get("x-webhook-secret")?.trim();
  const querySecret = new URL(req.url).searchParams.get("secret")?.trim();
  const bodySecret = pickString(body, ["secret", "callbackSecret"]);
  return [headerSecret, querySecret, bodySecret].some((value) => value && value === expected);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!authorized(req, body)) {
    return new Response("Forbidden", { status: 403 });
  }

  const callConfigId = pickString(body, ["callId", "call_id", "callConfigId", "idempotencyKey"]);
  const requestUuid = pickString(body, ["request_uuid", "requestUuid", "requestId", "request_id"]);
  const identity = callConfigId || requestUuid;

  if (!identity) {
    return Response.json({ error: "callId or request_uuid required" }, { status: 400 });
  }

  const rawStatus = (pickString(body, ["status", "callStatus", "disposition"]) ?? "completed").toLowerCase();
  const status = STATUS_MAP[rawStatus] ?? "completed";
  const durationSeconds = pickNumber(body, ["durationSec", "durationSeconds", "duration", "billDuration"]);
  const recordingUrl = pickString(body, ["recordingUrl", "recording_url", "recordingUri", "recording"]);
  const transcript = coerceTranscript(body.transcript ?? body.turns, identity);

  const recording: VoiceRecording | undefined = recordingUrl
    ? {
        sid: requestUuid || callConfigId || identity,
        status: "completed",
        source: "mulberry",
        recordingUri: recordingUrl,
        durationSeconds,
        storedAt: new Date().toISOString(),
      }
    : undefined;

  let matchedCampaignId: string | undefined;
  let matchedCallId: string | undefined;

  for (const campaign of listCampaigns()) {
    const call = campaign.calls.find((item) =>
      (callConfigId && (item.callConfigId === callConfigId || item.id === callConfigId)) ||
      (requestUuid && item.providerRequestId === requestUuid)
    );
    if (!call) continue;

    upsertCall(campaign.id, {
      id: call.id,
      callConfigId: call.callConfigId ?? callConfigId,
      providerRequestId: call.providerRequestId ?? requestUuid,
      provider: "mulberry",
      toNumber: call.toNumber,
      status,
      durationSeconds,
      engaged: (durationSeconds ?? 0) >= 20,
      endedAt: new Date().toISOString(),
      ...(transcript ? { transcript } : {}),
      ...(recording ? { recording } : {}),
    });
    matchedCampaignId = campaign.id;
    matchedCallId = call.id;

    if (campaign.userId && campaign.datasetId) {
      try {
        enqueueCallEvent({
          userId: campaign.userId,
          datasetId: campaign.datasetId,
          campaignId: campaign.id,
          callId: call.id,
          provider: "mulberry",
          eventType: "call.status",
          payload: { callConfigId, requestUuid, rawStatus, mappedStatus: status, durationSeconds, recordingUrl },
        });
      } catch (error) {
        console.error("[voice/mulberry-postcall] Failed to enqueue call event", error);
      }
      try {
        enqueueVoiceEvalCall({
          userId: campaign.userId,
          datasetId: campaign.datasetId,
          campaignId: campaign.id,
          callId: call.id,
        });
      } catch (error) {
        console.error("[voice/mulberry-postcall] Failed to enqueue call eval", error);
      }
    }
    break;
  }

  console.log(
    `[voice/mulberry-postcall] callConfigId=${callConfigId ?? "(none)"} requestUuid=${requestUuid ?? "(none)"}` +
      ` status=${rawStatus} matchedCampaign=${matchedCampaignId ?? "(none)"} matchedCall=${matchedCallId ?? "(none)"}` +
      ` recording=${recordingUrl ? "yes" : "no"} transcriptTurns=${transcript?.length ?? 0}`,
  );

  if (!matchedCampaignId) {
    // Accept + log even when unmatched so Mulberry doesn't retry-storm; the call
    // record may not exist yet if this races the /start response.
    return Response.json({ ok: true, matched: false }, { status: 202 });
  }

  return Response.json({ ok: true, matched: true, campaignId: matchedCampaignId, callId: matchedCallId });
}
