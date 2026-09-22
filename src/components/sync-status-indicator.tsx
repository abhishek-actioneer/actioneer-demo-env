"use client";

/**
 * Sync status indicator — hidden for now.
 * The sync-status pub/sub is still active (stores call markSyncError/markSynced),
 * but saves are automatic so users don't need to see this.
 * To re-enable: restore the original render logic from git history.
 */
export function SyncStatusIndicator() {
  return null;
}
