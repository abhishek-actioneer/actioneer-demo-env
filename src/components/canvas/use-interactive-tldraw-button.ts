import { useEditor } from "tldraw";
import { useCallback } from "react";
import type React from "react";

/**
 * Returns an `onPointerDownCapture` handler that prevents tldraw from
 * stealing pointer events away from interactive buttons inside shapes.
 *
 * Root cause: tldraw's canvas handler runs during the native bubble phase
 * at `tl-canvas` and calls `setPointerCapture`, routing all subsequent
 * pointer events (including `pointerup`) to the canvas — so the button
 * never receives `pointerup` and `click` never fires.
 *
 * This handler fires during the native CAPTURE phase (before tldraw's
 * bubble handler), so `markEventAsHandled` is set before tldraw's guard
 * check — causing tldraw to skip `setPointerCapture` entirely.
 *
 * Safe to call outside tldraw context (document view) — returns a simple
 * stopPropagation handler when no editor is available.
 *
 * Usage:
 *   const handlePointerDown = useInteractiveTldrawButton();
 *   <button onPointerDownCapture={handlePointerDown} onClick={...}>
 */
export function useInteractiveTldrawButton() {
  let editor: ReturnType<typeof useEditor> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    editor = useEditor();
  } catch {
    // Outside tldraw context (e.g., document view) — no editor available
  }

  return useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (editor) editor.markEventAsHandled(e);
    },
    [editor]
  );
}
