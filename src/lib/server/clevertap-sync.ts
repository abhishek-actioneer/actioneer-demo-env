import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { executeSQLInternal } from "@/lib/sql-executor";
import {
  uploadProfiles,
  uploadTestRecipientProfiles,
  segmentAttributeKey,
} from "@/lib/integrations/clevertap";
import type { CleverTapConnection } from "@/lib/integrations/connections";
import { updatePushStatus } from "@/lib/server/segment-repo";
import type { Segment } from "@/lib/types";

export interface SyncResult {
  synced: boolean;
  identityCount: number;
  skipped: boolean;      // true if already synced and no refresh needed
  error?: string;
}

/**
 * Ensures segment membership is in CleverTap as ct_segment_<slug>=true profile attributes.
 * Skips if already synced (status === "synced") unless forceRefresh is set.
 *
 * Returns error as value — caller decides how to surface to user. Does not throw
 * unless the dataset / SQL pipeline itself is misconfigured.
 */
export async function ensureSyncedToCleverTap(
  userId: string,
  segment: Segment,
  conn: CleverTapConnection,
  datasetIdHeader: string | null,
  opts: { forceRefresh?: boolean } = {},
): Promise<SyncResult> {
  if (!opts.forceRefresh && segment.pushStatus?.clevertap === "synced") {
    // Even when skipping the main identity upload, re-tag test recipients so
    // newly-added test emails get Email + ct_segment_* before campaigns fire.
    const pool = [
      ...(conn.testEmails ?? []),
      ...(conn.adminEmail ? [conn.adminEmail] : []),
    ];
    if (pool.length > 0) {
      await uploadTestRecipientProfiles(conn, pool, segmentAttributeKey(segment.name));
    }
    return { synced: true, identityCount: 0, skipped: true };
  }

  const datasetId = datasetIdHeader || DEFAULT_DATASET;
  const dataset = getDatasetForUser(datasetId, userId);
  if (!dataset) return { synced: false, identityCount: 0, skipped: false, error: "Dataset not found" };

  const idField = dataset.userIdField;
  if (!idField) {
    return { synced: false, identityCount: 0, skipped: false, error: `Dataset "${datasetId}" has no user identity field configured` };
  }

  const result = await executeSQLInternal(segment.sql, datasetId);
  if (result.error) {
    return { synced: false, identityCount: 0, skipped: false, error: `Segment SQL failed: ${result.error}` };
  }
  if (!result.columns.includes(idField)) {
    return { synced: false, identityCount: 0, skipped: false, error: `Segment result missing "${idField}" column` };
  }

  const identities: string[] = [];
  for (const row of result.rows) {
    const v = row[idField];
    if (v !== null && v !== undefined) identities.push(String(v));
  }
  if (identities.length === 0) {
    return { synced: false, identityCount: 0, skipped: false, error: "Segment resolved to 0 users" };
  }

  const segmentKey = segmentAttributeKey(segment.name);
  const up = await uploadProfiles(conn, identities, segmentKey);
  const profilesOk = up.errors.length === 0 && up.unprocessed === 0;

  const testEmailPool = [
    ...(conn.testEmails ?? []),
    ...(conn.adminEmail ? [conn.adminEmail] : []),
  ];
  if (testEmailPool.length > 0) {
    await uploadTestRecipientProfiles(conn, testEmailPool, segmentKey);
  }

  const status: "synced" | "error" = profilesOk ? "synced" : "error";
  updatePushStatus(userId, segment.id, { ...segment.pushStatus, clevertap: status });

  if (!profilesOk) {
    return { synced: false, identityCount: identities.length, skipped: false, error: up.errors[0] ?? "Profile upload failed" };
  }
  return { synced: true, identityCount: identities.length, skipped: false };
}
