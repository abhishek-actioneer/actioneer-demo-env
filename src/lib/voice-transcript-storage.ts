import { recordingStorageKeyForScope } from "./voice-storage";
import { storeRecordingBytes } from "./voice-recording-storage";
import { selectDisplayTranscript, type TranscriptSourceCall } from "./voice-transcript-display";
import { canonicalTurnTimingMs } from "./voice-transcript-sort";
import type { VoiceCampaign, VoiceTranscriptTurn } from "./voice-campaign-types";

const DEFAULT_FLUSH_MS = 5_000;
const JSONL_SCHEMA_VERSION = 1;

interface TranscriptSnapshot {
  campaign: Pick<VoiceCampaign, "id" | "userId" | "datasetId">;
  call: TranscriptSourceCall;
}

interface PendingTranscriptFlush {
  timer: NodeJS.Timeout;
  snapshot: TranscriptSnapshot;
}

const pendingFlushes = new Map<string, PendingTranscriptFlush>();

function flushIntervalMs(): number {
  const raw = Number.parseInt(process.env.VOICE_TRANSCRIPT_FLUSH_MS || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_FLUSH_MS;
  return Math.max(1_000, Math.min(raw, 60_000));
}

function key(campaignId: string, callId: string): string {
  return `${campaignId}:${callId}`;
}

function transcriptTurnSource(turn: VoiceTranscriptTurn): string {
  const itemId = turn.itemId ?? "";
  if (itemId.startsWith("live-") || itemId.startsWith("live_") || itemId.startsWith("live-test:")) {
    return "gemini-live";
  }
  return "legacy";
}

/** Canonical NDJSON lines for S3 / warehouse export — dialogue turns only, timestamp-sorted. */
export function buildTranscriptJsonlLines(
  campaign: Pick<VoiceCampaign, "id" | "userId" | "datasetId">,
  call: TranscriptSourceCall,
): string[] {
  const exportedAt = new Date().toISOString();
  const turns = selectDisplayTranscript(call);
  const timingContext = { callStartedAt: call.startedAt };

  if (turns.length === 0) return [];

  const metaLine = JSON.stringify({
    v: JSONL_SCHEMA_VERSION,
    type: "meta",
    exportedAt,
    campaignId: campaign.id,
    callId: call.id,
    userId: campaign.userId ?? null,
    datasetId: campaign.datasetId ?? null,
    turnCount: turns.length,
    source: "canonical-dialogue",
    timingClock: "stream-relative-ms",
    ...(call.startedAt ? { callStartedAt: call.startedAt } : {}),
  });

  const turnLines = turns.map((turn, index) => {
    const turnIndex = index + 1;
    const timing = canonicalTurnTimingMs(turn, timingContext);
    return JSON.stringify({
      v: JSONL_SCHEMA_VERSION,
      type: "turn",
      exportedAt,
      campaignId: campaign.id,
      callId: call.id,
      userId: campaign.userId ?? null,
      datasetId: campaign.datasetId ?? null,
      turnIndex,
      sequence: turnIndex,
      role: turn.role,
      text: turn.text,
      at: turn.at,
      source: transcriptTurnSource(turn),
      ...(timing.startMs !== undefined ? { startMs: timing.startMs } : {}),
      ...(timing.endMs !== undefined ? { endMs: timing.endMs } : {}),
      ...(timing.durationMs !== undefined ? { durationMs: timing.durationMs } : {}),
    });
  });

  return [metaLine, ...turnLines];
}

export async function persistCallTranscriptJsonl(
  campaign: Pick<VoiceCampaign, "id" | "userId" | "datasetId">,
  call: TranscriptSourceCall,
): Promise<{ storageKey: string; lineCount: number }> {
  const storageKey = recordingStorageKeyForScope(
    {
      userId: campaign.userId,
      datasetId: campaign.datasetId,
      campaignId: campaign.id,
    },
    call.id,
    "transcript",
    "jsonl",
  );

  const lines = buildTranscriptJsonlLines(campaign, call);
  const content = lines.join("\n");
  const bytes = Buffer.from(content.length > 0 ? `${content}\n` : "", "utf8");

  await storeRecordingBytes(storageKey, bytes, "application/x-ndjson; charset=utf-8");
  return { storageKey, lineCount: lines.length };
}

export function scheduleCallTranscriptJsonlPersist(
  campaign: Pick<VoiceCampaign, "id" | "userId" | "datasetId">,
  call: TranscriptSourceCall,
): void {
  const id = key(campaign.id, call.id);
  const existing = pendingFlushes.get(id);
  if (existing) {
    // Coalesce high-frequency turn updates into a single PUT.
    existing.snapshot = { campaign, call };
    return;
  }

  const entry: PendingTranscriptFlush = {
    timer: setTimeout(() => {
      void flushCallTranscriptJsonlPersist(id).catch((error) => {
        console.error("[voice/transcript-storage] Failed to persist transcript.jsonl:", error);
      });
    }, flushIntervalMs()),
    snapshot: { campaign, call },
  };
  pendingFlushes.set(id, entry);
}

async function flushCallTranscriptJsonlPersist(id: string): Promise<void> {
  const entry = pendingFlushes.get(id);
  if (!entry) return;
  pendingFlushes.delete(id);
  await persistCallTranscriptJsonl(entry.snapshot.campaign, entry.snapshot.call);
}

export async function flushCallTranscriptJsonlPersistNow(
  campaign: Pick<VoiceCampaign, "id" | "userId" | "datasetId">,
  call: TranscriptSourceCall,
): Promise<void> {
  const id = key(campaign.id, call.id);
  const pending = pendingFlushes.get(id);
  if (pending) {
    clearTimeout(pending.timer);
    pendingFlushes.delete(id);
  }
  await persistCallTranscriptJsonl(campaign, call);
}

export async function flushAllScheduledCallTranscriptJsonlPersists(): Promise<void> {
  const entries = Array.from(pendingFlushes.values());
  pendingFlushes.clear();
  await Promise.allSettled(entries.map(async (entry) => {
    clearTimeout(entry.timer);
    await persistCallTranscriptJsonl(entry.snapshot.campaign, entry.snapshot.call);
  }));
}
