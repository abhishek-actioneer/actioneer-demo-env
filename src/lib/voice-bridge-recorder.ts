import { findCall, upsertCallBridgeRecording } from "./voice-campaign-store";
import { transcribeStoredCallRecording } from "./voice-transcription";
import { storeRecordingBytes } from "./voice-recording-storage";
import { recordingStorageKeyForScope } from "./voice-storage";
import { upsertCallRecordingRow } from "./server/call-recording-repo";

const SAMPLE_RATE = 8000;
const FRAME_SAMPLES = 160;
const FRAME_DURATION_MS = 20;
const MAX_RECORDING_SECONDS = 60 * 60;
const MAX_RECORDING_FRAMES = (MAX_RECORDING_SECONDS * 1000) / FRAME_DURATION_MS;

interface StereoFrame {
  inbound?: Buffer;
  outbound?: Buffer;
}

export interface VoiceBridgeRecorder {
  recordInbound(timestampMs: number, base64Pcmu: string): void;
  recordOutbound(base64Pcmu: string): void;
  syncOutboundCursor(timestampMs: number): void;
  finalize(): Promise<void>;
}

function decodeMuLawSample(sample: number): number {
  const value = ~sample & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let decoded = ((mantissa << 3) + 0x84) << exponent;
  decoded -= 0x84;
  return sign ? -decoded : decoded;
}

function writeWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const byteRate = SAMPLE_RATE * 2 * 2;
  const blockAlign = 2 * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function splitPcmuFrames(base64Pcmu: string): Buffer[] {
  const audio = Buffer.from(base64Pcmu, "base64");
  const frames: Buffer[] = [];
  for (let offset = 0; offset < audio.length; offset += FRAME_SAMPLES) {
    frames.push(audio.subarray(offset, Math.min(offset + FRAME_SAMPLES, audio.length)));
  }
  return frames;
}

function renderFrames(frames: Map<number, StereoFrame>): Buffer {
  let maxFrame = -1;
  for (const frameIndex of frames.keys()) {
    maxFrame = Math.max(maxFrame, frameIndex);
  }
  if (maxFrame < 0) return Buffer.alloc(0);

  const pcm = Buffer.alloc((maxFrame + 1) * FRAME_SAMPLES * 2 * 2);
  let outputOffset = 0;

  for (let frameIndex = 0; frameIndex <= maxFrame; frameIndex += 1) {
    const frame = frames.get(frameIndex);
    for (let sampleIndex = 0; sampleIndex < FRAME_SAMPLES; sampleIndex += 1) {
      const inbound = frame?.inbound?.[sampleIndex];
      const outbound = frame?.outbound?.[sampleIndex];
      pcm.writeInt16LE(inbound === undefined ? 0 : decodeMuLawSample(inbound), outputOffset);
      outputOffset += 2;
      pcm.writeInt16LE(outbound === undefined ? 0 : decodeMuLawSample(outbound), outputOffset);
      outputOffset += 2;
    }
  }

  return pcm;
}

export function createVoiceBridgeRecorder(callSid: string): VoiceBridgeRecorder {
  const frames = new Map<number, StereoFrame>();
  const recordingSid = `bridge-${callSid}`;
  const startedAt = new Date().toISOString();
  let outboundFrameIndex = 0;
  let finalized = false;
  let timestampBaseMs: number | undefined;
  let droppedFrameWarningLogged = false;

  function ensureFrame(index: number): StereoFrame {
    const existing = frames.get(index);
    if (existing) return existing;
    const frame: StereoFrame = {};
    frames.set(index, frame);
    return frame;
  }

  function frameIndexFromTimestamp(timestampMs: number): number | undefined {
    if (!Number.isFinite(timestampMs)) return undefined;

    const safeTimestampMs = Math.max(0, timestampMs);
    if (timestampBaseMs === undefined) {
      timestampBaseMs = safeTimestampMs - outboundFrameIndex * FRAME_DURATION_MS;
    }

    const frameIndex = Math.max(0, Math.floor((safeTimestampMs - timestampBaseMs) / FRAME_DURATION_MS));
    return Number.isFinite(frameIndex) ? frameIndex : undefined;
  }

  function shouldRecordFrame(frameIndex: number): boolean {
    if (frameIndex < MAX_RECORDING_FRAMES) return true;
    if (!droppedFrameWarningLogged) {
      droppedFrameWarningLogged = true;
      console.warn(
        `[voice/bridge-recording] Dropping audio beyond ${MAX_RECORDING_SECONDS}s for CallSid=${callSid}`,
      );
    }
    return false;
  }

  return {
    recordInbound(timestampMs: number, base64Pcmu: string) {
      const baseFrameIndex = frameIndexFromTimestamp(timestampMs);
      if (baseFrameIndex === undefined) return;
      for (const [offset, frame] of splitPcmuFrames(base64Pcmu).entries()) {
        const frameIndex = baseFrameIndex + offset;
        if (shouldRecordFrame(frameIndex)) ensureFrame(frameIndex).inbound = frame;
      }
    },
    recordOutbound(base64Pcmu: string) {
      for (const frame of splitPcmuFrames(base64Pcmu)) {
        if (shouldRecordFrame(outboundFrameIndex)) ensureFrame(outboundFrameIndex).outbound = frame;
        outboundFrameIndex += 1;
      }
    },
    syncOutboundCursor(timestampMs: number) {
      if (timestampBaseMs === undefined && timestampMs <= 0) return;
      const frameIndex = frameIndexFromTimestamp(timestampMs);
      if (frameIndex === undefined) return;
      outboundFrameIndex = Math.max(outboundFrameIndex, frameIndex);
    },
    async finalize() {
      if (finalized) return;
      finalized = true;
      if (frames.size === 0) return;

      try {
        const wav = writeWav(renderFrames(frames));
        const found = findCall(callSid);
        const storageKey = recordingStorageKeyForScope({
          userId: found?.campaign.userId,
          datasetId: found?.campaign.datasetId,
          campaignId: found?.campaign.id,
        }, callSid, recordingSid, "wav");
        const stored = await storeRecordingBytes(storageKey, wav, "audio/wav");
        upsertCallBridgeRecording(callSid, {
          sid: recordingSid,
          status: "completed",
          source: "bridge",
          storageKey,
          recordingUri: stored.recordingUri,
          durationSeconds: Math.round((wav.length - 44) / (SAMPLE_RATE * 2 * 2)),
          channels: 2,
          contentType: "audio/wav",
          sizeBytes: wav.length,
          startedAt,
          storedAt: new Date().toISOString(),
        });
        if (found?.campaign.userId && found.campaign.datasetId) {
          upsertCallRecordingRow({
            userId: found.campaign.userId,
            datasetId: found.campaign.datasetId,
            campaignId: found.campaign.id,
            callId: callSid,
            provider: "plivo",
            recording: {
              sid: recordingSid,
              status: "completed",
              source: "bridge",
              storageKey,
              recordingUri: stored.recordingUri,
              durationSeconds: Math.round((wav.length - 44) / (SAMPLE_RATE * 2 * 2)),
              channels: 2,
              contentType: "audio/wav",
              sizeBytes: wav.length,
              startedAt,
              storedAt: new Date().toISOString(),
            },
          });
        }
        console.log(`[voice/bridge-recording] Stored CallSid=${callSid} bytes=${wav.length}`);
        if (process.env.OPENAI_API_KEY) {
          void transcribeStoredCallRecording(callSid, recordingSid).catch((transcribeErr) => {
            console.error("[voice/bridge-recording] Failed to transcribe stored bridge recording:", transcribeErr);
          });
        }
      } catch (err) {
        console.error("[voice/bridge-recording] Failed to store bridge recording:", err);
        upsertCallBridgeRecording(callSid, {
          sid: recordingSid,
          status: "failed",
          source: "bridge",
          startedAt,
          storedAt: new Date().toISOString(),
        });
        const found = findCall(callSid);
        if (found?.campaign.userId && found.campaign.datasetId) {
          upsertCallRecordingRow({
            userId: found.campaign.userId,
            datasetId: found.campaign.datasetId,
            campaignId: found.campaign.id,
            callId: callSid,
            provider: "plivo",
            recording: {
              sid: recordingSid,
              status: "failed",
              source: "bridge",
              startedAt,
              storedAt: new Date().toISOString(),
            },
          });
        }
      }
    },
  };
}
