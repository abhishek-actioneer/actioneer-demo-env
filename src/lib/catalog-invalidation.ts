/**
 * Lightweight pub/sub for entity catalog invalidation.
 * Stores call `invalidateCatalog()` after mutations (save/delete).
 * Chat state provider subscribes to rebuild the @ picker catalog.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeCatalog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidateCatalog(): void {
  for (const l of listeners) l();
}
