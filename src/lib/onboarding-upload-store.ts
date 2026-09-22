/**
 * Module-level store for passing upload file between onboarding pages.
 * File objects can't be serialized to localStorage, so we hold them in memory.
 * Only lives for the duration of the SPA session — fine for onboarding flow.
 */

let _pendingFile: File | null = null;
let _pendingLabel: string = "";

export function setPendingUpload(file: File, label: string) {
  _pendingFile = file;
  _pendingLabel = label;
}

export function getPendingUpload(): { file: File; label: string } | null {
  if (!_pendingFile) return null;
  return { file: _pendingFile, label: _pendingLabel };
}

export function clearPendingUpload() {
  _pendingFile = null;
  _pendingLabel = "";
}
