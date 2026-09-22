"use client";

import { useState, useEffect, useRef } from "react";
import { Layout, Check, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getAllBoards, saveBoard, saveBoardSection } from "@/lib/board-store";
import { invalidateCatalog } from "@/lib/catalog-invalidation";
import { useDataset } from "@/lib/dataset-context";
import type { Board } from "@/lib/board-types";

const LAST_USED_BOARD_KEY = "sentinel-last-used-board-id";

function getLastUsedBoardId(): string | null {
  try {
    return localStorage.getItem(LAST_USED_BOARD_KEY);
  } catch {
    return null;
  }
}

function setLastUsedBoardId(id: string) {
  try {
    localStorage.setItem(LAST_USED_BOARD_KEY, id);
  } catch {
    // ignore
  }
}

interface BoardPickerPopoverProps {
  /** Trigger element — the Pin button */
  children: React.ReactNode;
  /** Called with the chosen boardId when user picks a board */
  onSelect: (boardId: string) => void;
  /** Whether the popover is open (controlled by parent) */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BoardPickerPopover({
  children,
  onSelect,
  open,
  onOpenChange,
}: BoardPickerPopoverProps) {
  const { datasetId } = useDataset();
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);

  // Reset creating state when popover closes
  useEffect(() => {
    if (!open) { setCreating(false); setNewName(""); }
  }, [open]);

  // Load boards when popover opens
  useEffect(() => {
    if (!open) return;

    const loaded = getAllBoards(datasetId);
    setBoards(loaded);

    // Pre-select last-used or first board
    const lastId = getLastUsedBoardId();
    const match = loaded.find((b) => b.id === lastId) ?? loaded[0];
    setSelectedId(match?.id ?? null);
  }, [open, datasetId]);

  function handleSelect(boardId: string) {
    setSelectedId(boardId);
    setLastUsedBoardId(boardId);
    onSelect(boardId);
    onOpenChange(false);
  }

  function handleCreateBoard() {
    const name = newName.trim();
    if (!name) return;

    const boardId = `board-${crypto.randomUUID()}`;
    const board: Board = {
      id: boardId,
      name,
      datasetId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveBoard(board);
    invalidateCatalog();

    // Create a default section so pinned cards have somewhere to go
    saveBoardSection({
      id: crypto.randomUUID(),
      boardId,
      title: "Pinned",
      prose: "",
      order: 0,
      collapsed: false,
    });

    setNewName("");
    setCreating(false);
    handleSelect(boardId);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-56 p-1.5"
        align="start"
        side="top"
        sideOffset={6}
      >
        <p className="px-2 py-1 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wide">
          Pin to Board
        </p>
        {boards.length === 0 && !creating ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No boards yet</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5 max-h-48 overflow-y-auto">
            {boards.map((board) => (
              <li key={board.id}>
                <button
                  onClick={() => handleSelect(board.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted/60 transition-colors text-left"
                >
                  <Layout className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate text-foreground">{board.name}</span>
                  {selectedId === board.id && (
                    <Check className="w-3.5 h-3.5 text-foreground/50 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border mt-1 pt-1">
          {creating ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreateBoard(); }}
              className="flex items-center gap-1.5 px-2 py-1"
            >
              <input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
                placeholder="Board name..."
                autoFocus
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="text-xs font-medium text-foreground px-1.5 py-0.5 rounded hover:bg-muted/60 disabled:opacity-30"
              >
                Create
              </button>
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-muted/60 transition-colors text-left text-muted-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Board</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Utility: get the last-used (or first) board ID for the given dataset, for non-interactive pins */
export function getTargetBoardId(datasetId: string): string | null {
  const boards = getAllBoards(datasetId);
  const lastId = getLastUsedBoardId();
  const match = boards.find((b) => b.id === lastId) ?? boards[0];
  if (match) {
    setLastUsedBoardId(match.id);
  }
  return match?.id ?? null;
}
