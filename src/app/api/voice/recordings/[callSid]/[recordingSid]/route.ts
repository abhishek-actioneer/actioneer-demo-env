import { auth } from "@clerk/nextjs/server";
import { findCall } from "@/lib/voice-campaign-store";
import { readRecordingBytes, recordingExists } from "@/lib/voice-recording-storage";
import { recordingStorageKeyCandidatesForScope } from "@/lib/voice-storage";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";

function matchingRecording(call: NonNullable<ReturnType<typeof findCall>>["call"], recordingSid: string) {
  if (call.bridgeRecording?.sid === recordingSid) return call.bridgeRecording;
  if (call.recording?.sid === recordingSid) return call.recording;
  return undefined;
}

function datasetIdFromRequest(req: Request): string {
  const raw = new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function byteRange(req: Request, size: number): { start: number; end: number } | undefined {
  const range = req.headers.get("range");
  if (!range) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return undefined;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ callSid: string; recordingSid: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { callSid, recordingSid } = await params;
  const found = findCall(callSid, { userId, datasetId: datasetIdFromRequest(req) }) ?? findCall(callSid, { userId });
  const recording = found ? matchingRecording(found.call, recordingSid) : undefined;
  if (!found || !recording) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  const fallbackCandidates = recordingStorageKeyCandidatesForScope({
    userId: found.campaign.userId,
    datasetId: found.campaign.datasetId,
    campaignId: found.campaign.id,
  }, found.call.id, recordingSid);
  const legacyCallSidCandidates = recordingStorageKeyCandidatesForScope({
    userId: found.campaign.userId,
    datasetId: found.campaign.datasetId,
    campaignId: found.campaign.id,
  }, callSid, recordingSid);
  const candidateKeys = recording.storageKey
    ? [recording.storageKey, ...fallbackCandidates, ...legacyCallSidCandidates]
    : [...fallbackCandidates, ...legacyCallSidCandidates];
  let storageKey: string | undefined;
  for (const key of candidateKeys) {
    if (await recordingExists(key)) {
      storageKey = key;
      break;
    }
  }
  if (!storageKey) {
    return Response.json({ error: "Recording file not found" }, { status: 404 });
  }

  const { bytes } = await readRecordingBytes(storageKey);
  const filename = storageKey.split("/").at(-1) ?? `${recordingSid}.mp3`;
  const contentType = recording.contentType ?? "audio/mpeg";
  const range = byteRange(req, bytes.length);

  if (range) {
    const body = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(body), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": body.length.toString(),
        "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`,
        "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": bytes.length.toString(),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
