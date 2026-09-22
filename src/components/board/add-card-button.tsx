"use client";

import { useRef, useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { AddCardMenu, type CardCreationPayload } from "./add-card-menu";
import type { BoardCard } from "@/lib/board-types";

interface AddCardButtonProps {
  onSelect: (payload: CardCreationPayload) => void;
  variant?: "cell" | "inline";
  availableCards?: BoardCard[];
}

export function AddCardButton({ onSelect, variant = "cell", availableCards = [] }: AddCardButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    setMenuOpen(true);
  }, []);

  if (variant === "inline") {
    return (
      <>
        <button
          ref={btnRef}
          type="button"
          onClick={handleClick}
          className="p-1 rounded-full hover:bg-muted-foreground/10 text-muted-foreground transition-colors cursor-pointer"
          title="Add card"
        >
          <Plus size={16} />
        </button>
        <AddCardMenu
          anchorRef={btnRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onSelect={onSelect}
          availableCards={availableCards}
        />
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        className="w-full rounded-md border border-dashed border-border hover:border-foreground/30 hover:bg-foreground/5 py-3 px-4 text-center text-muted-foreground transition-colors cursor-pointer flex items-center justify-center gap-2"
      >
        <Plus size={16} />
        <span className="text-sm">Add card</span>
      </button>
      <AddCardMenu
        anchorRef={btnRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSelect={onSelect}
        availableCards={availableCards}
      />
    </>
  );
}
