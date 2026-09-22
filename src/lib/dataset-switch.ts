/**
 * Lightweight pub/sub for dataset switch events.
 * DatasetProvider calls `notifyDatasetSwitch()` before changing the active dataset.
 * ChatStateProvider subscribes to abort in-flight requests and reset UI state.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onDatasetSwitch(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyDatasetSwitch(): void {
  for (const l of listeners) l();
}
