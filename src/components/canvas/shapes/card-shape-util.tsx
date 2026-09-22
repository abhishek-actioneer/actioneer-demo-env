"use client";

import {
  ShapeUtil,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  T,
  type TLShape,
  type TLResizeInfo,
  type RecordProps,
  type Editor,
} from "tldraw";
import { useRef, useLayoutEffect } from "react";
import { CardContent } from "./card-content";
import { getBoardCard } from "@/lib/board-store";
import { CARD_STYLE_TOKENS } from "../card-renderers/shared";

// ── Module augmentation (required for tldraw v4 custom shapes) ──

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    "board-card": {
      w: number;
      h: number;
      cardId: string;
      boardId: string;
      /** Bumped to force re-render when board-store data changes */
      version: number;
    };
  }
}

export type BoardCardShape = TLShape<"board-card">;

/** Card types whose height should auto-fit to content */
const AUTO_HEIGHT_TYPES = new Set(["text", "report"]);

/** Wrapper that measures content and updates shape height when it overflows */
function AutoHeightWrapper({
  editor,
  shapeId,
  width,
  height,
  cardType,
  children,
}: {
  editor: Editor;
  shapeId: string;
  width: number;
  height: number;
  cardType: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!AUTO_HEIGHT_TYPES.has(cardType)) return;
    const el = ref.current;
    if (!el) return;
    const scrollH = el.scrollHeight;
    // Only grow, don't shrink below a minimum
    if (scrollH > height + 4) {
      // Use requestAnimationFrame to avoid updating during render
      requestAnimationFrame(() => {
        editor.updateShape({
          id: shapeId as BoardCardShape["id"],
          type: "board-card",
          props: { h: scrollH + 8 },
        });
      });
    }
  });

  return <div ref={ref} style={{ width, height, minHeight: height }}>{children}</div>;
}

// ── ShapeUtil ──

export class CardShapeUtil extends ShapeUtil<BoardCardShape> {
  static override type = "board-card" as const;

  static override props: RecordProps<BoardCardShape> = {
    w: T.number,
    h: T.number,
    cardId: T.string,
    boardId: T.string,
    version: T.number,
  };

  override canEdit() {
    return true;
  }

  override canResize() {
    return true;
  }

  getDefaultProps(): BoardCardShape["props"] {
    return { w: 400, h: 260, cardId: "", boardId: "", version: 0 };
  }

  getGeometry(shape: BoardCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override onResize(shape: BoardCardShape, info: TLResizeInfo<BoardCardShape>) {
    return resizeBox(shape, info);
  }

  component(shape: BoardCardShape) {
    const isEditing = this.editor.getEditingShapeId() === shape.id;
    const isSelected =
      this.editor.getSelectedShapeIds().includes(shape.id);
    const card = getBoardCard(shape.props.boardId, shape.props.cardId);

    if (!card) {
      return (
        <HTMLContainer
          style={{
            ...CARD_STYLE_TOKENS,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: shape.props.w,
            height: shape.props.h,
            color: "var(--muted-foreground)",
            fontSize: 10.8,
            border: "1px solid var(--border)",
          }}
        >
          Card not found
        </HTMLContainer>
      );
    }

    const autoHeight = AUTO_HEIGHT_TYPES.has(card.type);

    const content = (
      <CardContent
        card={card}
        width={shape.props.w}
        height={shape.props.h}
        isEditing={isEditing}
        isSelected={isSelected}
      />
    );

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
          overflow: autoHeight ? "visible" : "hidden",
        }}
      >
        {autoHeight ? (
          <AutoHeightWrapper
            editor={this.editor}
            shapeId={shape.id}
            width={shape.props.w}
            height={shape.props.h}
            cardType={card.type}
          >
            {content}
          </AutoHeightWrapper>
        ) : (
          content
        )}
      </HTMLContainer>
    );
  }

  indicator(shape: BoardCardShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={10}
        ry={10}
      />
    );
  }
}
