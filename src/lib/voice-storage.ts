import { existsSync, mkdirSync } from "fs";
import { join, resolve, sep } from "path";

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getVoiceStorageRoot(): string {
  if (process.env.VOICE_STORAGE_DIR) return resolve(process.env.VOICE_STORAGE_DIR);

  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return resolve(
      process.env.RAILWAY_VOLUME_MOUNT_PATH,
      process.env.VOICE_STORAGE_SUBDIR || "voice-logs",
    );
  }

  return join(process.cwd(), "data");
}

export function ensureVoiceStorageDir(...parts: string[]): string {
  const dir = join(getVoiceStorageRoot(), ...parts.map(safePathPart));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getVoiceCampaignStorePath(): string {
  return join(getVoiceStorageRoot(), "voice-campaigns.json");
}

export function recordingStorageKey(callSid: string, recordingSid: string, extension = "mp3"): string {
  return `${safePathPart(callSid)}/${safePathPart(recordingSid)}.${safePathPart(extension)}`;
}

export interface VoiceRecordingPartitionScope {
  userId?: string;
  datasetId?: string;
  campaignId?: string;
}

type ScopedKeyOrder = "dataset-campaign-user" | "user-dataset-campaign";

function scopedPrefix(scope: VoiceRecordingPartitionScope, order: ScopedKeyOrder): string {
  const user = safePathPart(scope.userId || "anon");
  const dataset = safePathPart(scope.datasetId || "unknown_dataset");
  const campaign = safePathPart(scope.campaignId || "unknown_campaign");
  const parts = order === "dataset-campaign-user"
    ? [dataset, campaign, user]
    : [user, dataset, campaign];
  return parts.join("/");
}

export function recordingStorageKeyForScope(
  scope: VoiceRecordingPartitionScope,
  callSid: string,
  recordingSid: string,
  extension = "mp3",
): string {
  // Canonical format: client(dataset) -> campaign -> user -> call -> file
  return `${scopedPrefix(scope, "dataset-campaign-user")}/${recordingStorageKey(callSid, recordingSid, extension)}`;
}

export function recordingStorageKeyForScopeLegacy(
  scope: VoiceRecordingPartitionScope,
  callSid: string,
  recordingSid: string,
  extension = "mp3",
): string {
  // Backward-compat format used in earlier rollout: user -> dataset -> campaign
  return `${scopedPrefix(scope, "user-dataset-campaign")}/${recordingStorageKey(callSid, recordingSid, extension)}`;
}

export function recordingStorageKeyCandidatesForScope(
  scope: VoiceRecordingPartitionScope,
  callSid: string,
  recordingSid: string,
  extension = "mp3",
): string[] {
  const canonical = recordingStorageKeyForScope(scope, callSid, recordingSid, extension);
  const legacyScoped = recordingStorageKeyForScopeLegacy(scope, callSid, recordingSid, extension);
  const legacyUnscoped = recordingStorageKey(callSid, recordingSid, extension);
  return Array.from(new Set([canonical, legacyScoped, legacyUnscoped]));
}

export function recordingFilePath(storageKey: string): string {
  const root = resolve(getVoiceStorageRoot(), "voice-recordings");
  const filePath = resolve(root, storageKey);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid recording storage key");
  }
  return filePath;
}

export function recordingExists(storageKey: string): boolean {
  return existsSync(recordingFilePath(storageKey));
}
