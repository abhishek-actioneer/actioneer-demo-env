// Simple event bridge between canvas card renderers and the canvas page component.
// Custom React Flow nodes can't easily access page-level state, so they emit events.

export type CanvasEventType = "open-config" | "ask-about" | "dismiss-insight" | "refresh-card" | "open-comments" | "run-sql";

type CanvasEventHandler = (itemId: string) => void;

const handlers: Record<string, CanvasEventHandler[]> = {};

export function onCanvasEvent(event: CanvasEventType, handler: CanvasEventHandler) {
  if (!handlers[event]) handlers[event] = [];
  handlers[event].push(handler);
  return () => {
    handlers[event] = handlers[event].filter((h) => h !== handler);
  };
}

export function emitCanvasEvent(event: CanvasEventType, itemId: string) {
  handlers[event]?.forEach((h) => h(itemId));
}
