import { findCallByAnyIdentity, upsertCallRecording } from "@/lib/voice-campaign-store";
import { storeRecordingBytes } from "@/lib/voice-recording-storage";
import { recordingStorageKeyForScope } from "@/lib/voice-storage";
import { transcribeStoredCallRecording } from "@/lib/voice-transcription";
import type { VoiceRecording } from "@/lib/voice-campaign-types";
import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";
import { enqueueCallEvent } from "@/lib/server/call-event-outbox-repo";
import { upsertCallRecordingRow } from "@/lib/server/call-recording-repo";

export const runtime = "nodejs";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function formString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formNumber(formData: FormData, key: string): number | undefined {
  const value = formString(formData, key);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordingMediaUrl(recordingUrl: string): string {
  return recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
}

async function downloadRecording(recordingUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
  const auth = Buffer.from(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64");
  const res = await fetch(recordingMediaUrl(recordingUrl), {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    throw new Error(`Twilio recording download failed: ${res.status} ${res.statusText}`);
  }

  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
  };
}

export async function POST(req: Request) {
  const requestCallId = new URL(req.url).searchParams.get("callId") ?? "";
  const formData = await req.formData();
  const params = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
  );
  if (!verifyTwilioWebhookSignature(req, params)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const callSid = formString(formData, "CallSid");
  const parentCallSid = formString(formData, "ParentCallSid");
  const recordingSid = formString(formData, "RecordingSid");
  const recordingStatus = formString(formData, "RecordingStatus") as VoiceRecording["status"] | undefined;
  const recordingUrl = formString(formData, "RecordingUrl");

  if (!callSid || !recordingSid || !recordingStatus) {
    return Response.json({ error: "Missing recording callback fields" }, { status: 400 });
  }

  const baseRecording: VoiceRecording = {
    sid: recordingSid,
    status: recordingStatus,
    source: "twilio",
    twilioUrl: recordingUrl,
    durationSeconds: formNumber(formData, "RecordingDuration"),
    channels: formNumber(formData, "RecordingChannels"),
    startedAt: formString(formData, "RecordingStartTime"),
  };
  const found = findCallByAnyIdentity([callSid, parentCallSid, requestCallId]);
  if (!found) {
    console.error(
      `[voice/recording] unresolved call identity callSid=${callSid} parentCallSid=${parentCallSid} callId=${requestCallId} status=${recordingStatus}`,
    );
    return Response.json(
      { error: "Call not found for recording callback; retry later" },
      { status: 409 },
    );
  }
  const resolvedCallId = found.call.id;

  if (recordingStatus !== "completed" || !recordingUrl) {
    upsertCallRecording(resolvedCallId, baseRecording);
    if (found.campaign.userId && found.campaign.datasetId) {
      upsertCallRecordingRow({
        userId: found.campaign.userId,
        datasetId: found.campaign.datasetId,
        campaignId: found.campaign.id,
        callId: resolvedCallId,
        provider: "twilio",
        recording: baseRecording,
      });
    }
    if (found.campaign.userId && found.campaign.datasetId) {
      try {
        enqueueCallEvent({
          userId: found.campaign.userId,
          datasetId: found.campaign.datasetId,
          campaignId: found.campaign.id,
          callId: resolvedCallId,
          provider: "twilio",
          eventType: "call.recording_status",
          payload: {
            callSid,
            parentCallSid,
            recordingSid,
            recordingStatus,
            recordingUrl,
          },
        });
      } catch (error) {
        console.error("[voice/recording] Failed to enqueue recording status event", error);
      }
    }
    return Response.json({ ok: true });
  }

  try {
    const { bytes, contentType } = await downloadRecording(recordingUrl);
    const storageKey = recordingStorageKeyForScope({
      userId: found?.campaign.userId,
      datasetId: found?.campaign.datasetId,
      campaignId: found?.campaign.id,
    }, resolvedCallId, recordingSid);
    const stored = await storeRecordingBytes(storageKey, bytes, contentType);

    upsertCallRecording(resolvedCallId, {
      ...baseRecording,
      storageKey,
      recordingUri: stored.recordingUri,
      contentType,
      sizeBytes: bytes.length,
      storedAt: new Date().toISOString(),
    });
    if (found.campaign.userId && found.campaign.datasetId) {
      upsertCallRecordingRow({
        userId: found.campaign.userId,
        datasetId: found.campaign.datasetId,
        campaignId: found.campaign.id,
        callId: resolvedCallId,
        provider: "twilio",
        recording: {
          ...baseRecording,
          storageKey,
          recordingUri: stored.recordingUri,
          contentType,
          sizeBytes: bytes.length,
          storedAt: new Date().toISOString(),
        },
      });
    }

    console.log(
      `[voice/recording] Stored CallSid=${callSid} resolvedCallId=${resolvedCallId} RecordingSid=${recordingSid} bytes=${bytes.length}`,
    );
    if (process.env.OPENAI_API_KEY) {
      void transcribeStoredCallRecording(resolvedCallId, recordingSid).catch((transcribeErr) => {
        console.error("[voice/recording] Failed to transcribe stored recording:", transcribeErr);
      });
    }
    if (found.campaign.userId && found.campaign.datasetId) {
      try {
        enqueueCallEvent({
          userId: found.campaign.userId,
          datasetId: found.campaign.datasetId,
          campaignId: found.campaign.id,
          callId: resolvedCallId,
          provider: "twilio",
          eventType: "call.recording_stored",
          payload: {
            callSid,
            parentCallSid,
            recordingSid,
            storageKey,
            recordingUri: stored.recordingUri,
            contentType,
            sizeBytes: bytes.length,
          },
        });
      } catch (error) {
        console.error("[voice/recording] Failed to enqueue stored recording event", error);
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[voice/recording] Failed to store recording:", err);
    upsertCallRecording(resolvedCallId, {
      ...baseRecording,
      status: "failed",
      storedAt: new Date().toISOString(),
    });
    if (found.campaign.userId && found.campaign.datasetId) {
      upsertCallRecordingRow({
        userId: found.campaign.userId,
        datasetId: found.campaign.datasetId,
        campaignId: found.campaign.id,
        callId: resolvedCallId,
        provider: "twilio",
        recording: {
          ...baseRecording,
          status: "failed",
          storedAt: new Date().toISOString(),
        },
      });
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
