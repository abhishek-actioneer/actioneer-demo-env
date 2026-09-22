"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { Board } from "@/lib/board-types";
import { saveBoard, removeBoard } from "@/lib/board-store";
import { useSidebarContext } from "@/components/sidebar-context";
import { PH } from "@/components/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface BoardHeaderProps {
  board: Board;
}

export function BoardHeader({ board }: BoardHeaderProps) {
  const router = useRouter();
  const { refreshBoards } = useSidebarContext();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(board.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(board.name), [board.name]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = name.trim();
    const finalName = trimmed || "Untitled Board";
    setName(finalName);
    setEditing(false);
    if (finalName !== board.name) {
      saveBoard({ ...board, name: finalName, updatedAt: new Date().toISOString() });
    }
  }, [name, board]);

  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleDelete = useCallback(() => {
    removeBoard(board.id);
    refreshBoards();
    router.push("/canvas");
  }, [board.id, refreshBoards, router]);

  return (
    <div className="pb-4 mb-4 border-b border-border">
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete board"
        description={`"${board.name}" and all its cards will be permanently deleted.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
      <div className={PH.titleRow}>
        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setName(board.name);
                setEditing(false);
              }
            }}
            className={`${PH.title} bg-transparent border-none outline-none flex-1 p-0 m-0 cursor-text`}
          />
        ) : (
          <h1
            className={`${PH.title} cursor-text`}
            onDoubleClick={() => setEditing(true)}
          >
            {board.name}
          </h1>
        )}
        <div className={PH.actions}>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            title="Delete board"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
