import { createHash } from "crypto";
import { getDb } from "@/lib/meta-db";
import type { VoiceRecording } from "@/lib/voice-campaign-types";

export interface UpsertCallRecordingRowInput {
  userId: string;
  datasetId: string;
  campaignId: string;
  callId: string;
  provider?: string;
  recording: VoiceRecording;
}

function rowId(input: UpsertCallRecordingRowInput): string {
  const raw = `${input.userId}:${input.datasetId}:${input.campaignId}:${input.callId}:${input.recording.sid}`;
  return createHash("sha256").update(raw).digest("hex");
}

export function upsertCallRecordingRow(input: UpsertCallRecordingRowInput): void {
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(`
    INSERT INTO call_recordings (
      id, user_id, dataset_id, campaign_id, call_id, recording_sid,
      provider, source, status, storage_key, recording_uri, provider_url,
      content_type, size_bytes, duration_seconds, channels, started_at, stored_at,
      created_at, updated_at
    ) VALUES (
      @id, @user_id, @dataset_id, @campaign_id, @call_id, @recording_sid,
      @provider, @source, @status, @storage_key, @recording_uri, @provider_url,
      @content_type, @size_bytes, @duration_seconds, @channels, @started_at, @stored_at,
      @created_at, @updated_at
    )
    ON CONFLICT(user_id, dataset_id, campaign_id, call_id, recording_sid) DO UPDATE SET
      provider = excluded.provider,
      source = excluded.source,
      status = excluded.status,
      storage_key = excluded.storage_key,
      recording_uri = excluded.recording_uri,
      provider_url = excluded.provider_url,
      content_type = excluded.content_type,
      size_bytes = excluded.size_bytes,
      duration_seconds = excluded.duration_seconds,
      channels = excluded.channels,
      started_at = excluded.started_at,
      stored_at = excluded.stored_at,
      updated_at = excluded.updated_at
  `).run({
    id: rowId(input),
    user_id: input.userId,
    dataset_id: input.datasetId,
    campaign_id: input.campaignId,
    call_id: input.callId,
    recording_sid: input.recording.sid,
    provider: input.provider ?? null,
    source: input.recording.source ?? null,
    status: input.recording.status,
    storage_key: input.recording.storageKey ?? null,
    recording_uri: input.recording.recordingUri ?? null,
    provider_url: input.recording.twilioUrl ?? null,
    content_type: input.recording.contentType ?? null,
    size_bytes: input.recording.sizeBytes ?? null,
    duration_seconds: input.recording.durationSeconds ?? null,
    channels: input.recording.channels ?? null,
    started_at: input.recording.startedAt ?? null,
    stored_at: input.recording.storedAt ?? null,
    created_at: now,
    updated_at: now,
  });
}

