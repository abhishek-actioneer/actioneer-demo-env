"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBoardSummaries, saveBoard } from "@/lib/board-store";
import { useDataset } from "@/lib/dataset-context";
import { Plus, FileText, LayoutDashboard } from "lucide-react";
import type { BoardSummary } from "@/lib/board-types";

export function BoardList() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const [summaries, setSummaries] = useState<BoardSummary[]>([]);
  const [mounted, setMounted] = useState(false);

  // Hydration gate: only load board data after mount
  useEffect(() => {
    setMounted(true);
    setSummaries(getBoardSummaries(datasetId));
  }, [datasetId]);

  // Show loading state until mounted
  if (!mounted) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-semibold text-foreground">Boards</h1>
            <button
              type="button"
              disabled
              className="flex items-center gap-2 rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium opacity-50"
            >
              <Plus className="h-4 w-4" />
              New Board
            </button>
          </div>
          <div className="rounded-md border border-dashed border-border p-12 text-center">
            <p className="text-sm text-muted-foreground">Loading boards...</p>
          </div>
        </div>
      </div>
    );
  }

  const handleCreate = () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    saveBoard({
      id,
      name: "Untitled Board",
      datasetId,
      viewMode: "document",
      createdAt: now,
      updatedAt: now,
    });
    // Refresh local state after creating
    setSummaries(getBoardSummaries(datasetId));
    router.push(`/canvas?board=${id}`);
  };

  const handleOpen = (boardId: string) => {
    router.push(`/canvas?board=${boardId}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Boards</h1>
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-2 rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            New Board
          </button>
        </div>

        {summaries.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-12 flex flex-col items-center justify-center text-center">
            <LayoutDashboard className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No boards yet</p>
            <p className="text-xs text-muted-foreground">
              Create a board to organize your analyses.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summaries.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleOpen(s.id)}
                className="flex items-start gap-3 rounded-md border border-border p-4 text-left hover:border-foreground/20 transition-colors cursor-pointer"
              >
                <div className="rounded bg-muted p-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {s.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.cardCount} cards
                    <span className="mx-1.5">·</span>
                    {new Date(s.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
