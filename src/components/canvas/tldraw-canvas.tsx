"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Tldraw,
  type Editor,
  DefaultContextMenu,
  DefaultContextMenuContent,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  useEditor,
} from "tldraw";
import { useTheme } from "next-themes";
import "tldraw/tldraw.css";

import { CardShapeUtil } from "./shapes/card-shape-util";
import { DotGrid } from "./shapes/dot-grid";
import {
  cardToShape,
  createConnectionArrow,
  syncTldrawToStore,
  loadCamera,
  saveCamera,
} from "./tldraw-adapter";
import {
  getBoardCards,
  getBoardConnections,
  getBoardCard,
  flushPendingPersists,
} from "@/lib/board-store";

// ── Module-level registry: boardId → callback ──
// Immune to portal/tree propagation issues with React context in tldraw overrides.

const followUpRegistry = new Map<string, (cardId: string) => void>();

function CustomContextMenu({ children }: { children?: React.ReactNode }) {
  const editor = useEditor();

  let targetCard: { id: string; boardId: string } | null = null;

  // Attempt 1: from current selection (user clicked card first, then right-clicked)
  for (const shape of editor.getSelectedShapes()) {
    if (shape.type !== "board-card") continue;
    const props = shape.props as { cardId?: string; boardId?: string };
    if (!props.cardId || !props.boardId || !followUpRegistry.has(props.boardId)) continue;
    const card = getBoardCard(props.boardId, props.cardId);
    if (card && (card.type === "chart" || card.type === "text")) {
      targetCard = { id: card.id, boardId: props.boardId };
      break;
    }
  }

  // Attempt 2: shape directly under the pointer (user right-clicked without selecting first)
  if (!targetCard) {
    const shapes = editor.getShapesAtPoint(editor.inputs.currentPagePoint);
    for (const shape of shapes) {
      if (shape.type !== "board-card") continue;
      const props = shape.props as { cardId?: string; boardId?: string };
      if (!props.cardId || !props.boardId || !followUpRegistry.has(props.boardId)) continue;
      const card = getBoardCard(props.boardId, props.cardId);
      if (card && (card.type === "chart" || card.type === "text")) {
        targetCard = { id: card.id, boardId: props.boardId };
        break;
      }
    }
  }

  return (
    <DefaultContextMenu>
      {targetCard && (
        <TldrawUiMenuGroup id="ask-follow-up-group">
          <TldrawUiMenuItem
            id="ask-follow-up"
            readonlyOk
            label="Ask a follow-up"
            onSelect={() => followUpRegistry.get(targetCard!.boardId)?.(targetCard!.id)}
          />
        </TldrawUiMenuGroup>
      )}
      <DefaultContextMenuContent />
      {children}
    </DefaultContextMenu>
  );
}

// ── Config: MUST be outside the component to prevent re-registration flicker ──

const customShapeUtils = [CardShapeUtil];

/** Base chrome: hide non-essential tldraw panels, keep the dot grid */
const customComponentsBase = {
  StylePanel: null as null,
  MainMenu: null as null,
  PageMenu: null as null,
  HelpMenu: null as null,
  DebugPanel: null as null,
  DebugMenu: null as null,
  KeyboardShortcutsDialog: null as null,
  MenuPanel: null as null,
  TopPanel: null as null,
  SharePanel: null as null,
  RichTextToolbar: null as null,
  // Custom dot grid to match playbook canvas aesthetic
  Grid: DotGrid,
};

/** With toolbar — used on the general canvas page */
const customComponents = customComponentsBase;

/** No toolbar — used on surfaces where annotation isn't the primary task (e.g. Decks) */
const customComponentsNoToolbar = {
  ...customComponentsBase,
  Toolbar: null as null,
};

/** With toolbar + follow-up context menu */
const customComponentsWithFollowUp = {
  ...customComponents,
  ContextMenu: CustomContextMenu,
};

/** No toolbar + follow-up context menu */
const customComponentsNoToolbarWithFollowUp = {
  ...customComponentsNoToolbar,
  ContextMenu: CustomContextMenu,
};

// ── Component ──

interface TldrawCanvasProps {
  boardId: string;
  onEditorReady?: (editor: Editor) => void;
  /** Hide the drawing toolbar — use on surfaces where annotation isn't the primary task */
  hideToolbar?: boolean;
  /** Called when user selects "Ask a follow-up" from a card's context menu */
  onAskFollowUp?: (cardId: string) => void;
}

export function TldrawCanvas({ boardId, onEditorReady, hideToolbar, onAskFollowUp }: TldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const { resolvedTheme } = useTheme();

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      // Set color scheme to match app theme
      editor.user.updateUserPreferences({
        colorScheme: resolvedTheme === "dark" ? "dark" : "light",
      });

      // Enable grid mode so the custom Grid component renders
      editor.updateInstanceState({ isGridMode: true });

      // Load cards from board-store → create tldraw shapes
      const cards = getBoardCards(boardId);
      if (cards.length > 0) {
        editor.createShapes(cards.map(cardToShape));
      }

      // Load connections → create arrows with bindings
      const connections = getBoardConnections(boardId);
      for (const conn of connections) {
        createConnectionArrow(editor, conn);
      }

      // Sync tldraw geometry changes → board-store (position/size only)
      editor.store.listen(
        (entry) => {
          syncTldrawToStore(entry, boardId);
        },
        { source: "user", scope: "document" }
      );

      // Camera persistence — restore
      const savedCamera = loadCamera(boardId);
      if (savedCamera) {
        editor.setCamera(savedCamera);
      } else if (cards.length > 0) {
        setTimeout(() => {
          const bounds = editor.getCurrentPageBounds();
          if (!bounds) return;
          // Zoom to the top portion of the canvas so text is readable on first load.
          // zoomToFit shows everything at thumbnail scale; instead fit the first ~800px
          // of height, which gives a readable view of the first 1–2 rows of cards.
          editor.zoomToBounds(
            { x: bounds.minX, y: bounds.minY, w: bounds.w, h: Math.min(bounds.h, 800) },
            { animation: { duration: 400 }, inset: 60 },
          );
        }, 100);
      }

      // Camera persistence — save on camera changes
      editor.store.listen(
        () => {
          saveCamera(boardId, editor.getCamera());
        },
        { source: "user", scope: "session" }
      );

      // Notify parent
      onEditorReady?.(editor);
    },
    [boardId, onEditorReady, resolvedTheme]
  );

  // Sync theme changes at runtime (e.g. user toggles dark mode while canvas is open)
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.user.updateUserPreferences({
        colorScheme: resolvedTheme === "dark" ? "dark" : "light",
      });
    }
  }, [resolvedTheme]);

  // Flush pending persists on unmount
  useEffect(() => {
    return () => {
      flushPendingPersists();
    };
  }, []);

  // Register/unregister follow-up callback for this canvas instance
  useEffect(() => {
    if (onAskFollowUp) followUpRegistry.set(boardId, onAskFollowUp);
    return () => { followUpRegistry.delete(boardId); };
  }, [boardId, onAskFollowUp]);

  const components = hideToolbar
    ? (onAskFollowUp ? customComponentsNoToolbarWithFollowUp : customComponentsNoToolbar)
    : (onAskFollowUp ? customComponentsWithFollowUp : customComponents);

  return (
    <div className="actioneer-canvas" style={{ width: "100%", height: "100%" }}>
      <Tldraw
        shapeUtils={customShapeUtils}
        components={components}
        onMount={handleMount}
      />
    </div>
  );
}
