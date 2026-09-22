/**
 * Module-level singleton for PDF-to-board stream state.
 * Survives route navigation (component state does not).
 *
 * Pattern mirrors api-client.ts (_datasetId, _modelId) and
 * canvas-events.ts (multiple singletons) already in this codebase.
 * Pub/sub matches catalog-invalidation.ts.
 */

import type { ExtractedSlidePreview } from "./deck-types";

export type ActivePdfStream =
  | { boardId: string; status: "uploading"; stage?: string }
  | { boardId: string; status: "processing"; completedSlides: number; totalSlides: number; stage?: string; extractedSlides?: ExtractedSlidePreview[] }
  | { boardId: string; status: "done"; completedSlides: number; totalSlides: number }
  | { boardId: string; status: "error"; error: string; completedSlides: number };

let _active: ActivePdfStream | null = null;
const _subscribers = new Set<() => void>();

export function setActivePdfStream(s: ActivePdfStream | null): void {
  _active = s;
  _subscribers.forEach((fn) => fn());
}

export function getActivePdfStream(): ActivePdfStream | null {
  return _active;
}

/** Subscribe to stream state changes. Returns an unsubscribe function. */
export function subscribeToStream(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}
