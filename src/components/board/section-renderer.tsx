"use client";

import { useState } from "react";
import type { BoardCard, BoardSection } from "@/lib/board-types";
import { MarkdownContent } from "@/lib/markdown";
import { SectionCardGrid } from "./section-card-grid";
import { GhostPlaceholder } from "./ghost-placeholder";
import { ChevronRight, X } from "lucide-react";
import type { CardCreationPayload } from "./add-card-menu";

interface SectionRendererProps {
  section: BoardSection;
  cards: BoardCard[];
  onDeleteSection?: (sectionId: string) => void;
  onDeleteProse?: (sectionId: string) => void;
  proseDeleted?: boolean;
  onDeleteCard?: (card: BoardCard) => void;
  deletedCards?: { id: string; height: number }[];
  onCardResized?: () => void;
  onAddCard?: (payload: CardCreationPayload, sectionId: string) => void;
  loadingCardIds?: Set<string>;
}

export function SectionRenderer({
  section,
  cards,
  onDeleteSection,
  onDeleteProse,
  proseDeleted,
  onDeleteCard,
  deletedCards,
  onCardResized,
  onAddCard,
  loadingCardIds,
}: SectionRendererProps) {
  const [collapsed, setCollapsed] = useState(section.collapsed);

  return (
    <div className="mb-10">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4 group/section">
        <button
          type="button"
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronRight
            className="h-4 w-4 text-muted-foreground transition-transform duration-200"
            style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}
          />
          <h2 className="text-lg font-semibold text-foreground">
            {section.title}
          </h2>
        </button>
        {onDeleteSection && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteSection(section.id);
            }}
            className="opacity-0 group-hover/section:opacity-100 ml-auto p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground transition-opacity"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Collapsible content */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden">
          {/* Prose — show placeholder if deleted, otherwise show content */}
          {proseDeleted ? (
            <div className="mb-4">
              <GhostPlaceholder height={48} />
            </div>
          ) : section.prose ? (
            <div className="relative group/prose mb-4">
              <div className="text-[13.5px] text-muted-foreground leading-relaxed max-w-3xl">
                <MarkdownContent content={section.prose} />
              </div>
              {onDeleteProse && (
                <button
                  type="button"
                  onClick={() => onDeleteProse(section.id)}
                  className="absolute top-0 right-0 opacity-0 group-hover/prose:opacity-100 p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground transition-opacity"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ) : null}

          {/* Cards */}
          <SectionCardGrid
            cards={cards}
            sectionId={section.id}
            onDeleteCard={onDeleteCard}
            deletedCards={deletedCards}
            onCardResized={onCardResized}
            onAddCard={onAddCard}
            loadingCardIds={loadingCardIds}
          />
        </div>
      </div>
    </div>
  );
}
