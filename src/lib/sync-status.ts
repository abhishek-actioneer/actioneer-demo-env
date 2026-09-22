/**
 * Lightweight pub/sub for store sync status.
 * Stores call markSyncError() / markSynced() on server write success/failure.
 * UI subscribes to show a visual indicator.
 */

type SyncState = "synced" | "pending" | "error";

let currentState: SyncState = "synced";
let errorCount = 0;
const listeners = new Set<(state: SyncState) => void>();

function notify() {
  for (const fn of listeners) fn(currentState);
}

export function markSyncPending(): void {
  if (currentState === "error") return;
  currentState = "pending";
  notify();
}

export function markSynced(): void {
  errorCount = 0;
  currentState = "synced";
  notify();
}

export function markSyncError(): void {
  errorCount++;
  currentState = "error";
  notify();
}

export function getSyncState(): SyncState {
  return currentState;
}

export function getSyncErrorCount(): number {
  return errorCount;
}

export function subscribeSyncStatus(fn: (state: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
