/**
 * Hook for board resolution.
 * Validates the boardId from the URL segment and redirects to /canvas if invalid.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBoard } from "@/lib/board-store";
import { useSidebarContext } from "@/components/sidebar-context";
import { useDataset } from "@/lib/dataset-context";

export function useCanvasBoard(boardId: string | undefined) {
  const router = useRouter();
  const { datasetId } = useDataset();
  const { setActiveBoardId, notifyBoardChanged } = useSidebarContext();

  useEffect(() => {
    if (!boardId) {
      router.push("/canvas");
      return;
    }

    const board = getBoard(boardId);

    if (!board) {
      router.push("/canvas");
      return;
    }

    if (board.datasetId !== datasetId) {
      router.push("/canvas");
      return;
    }

    setActiveBoardId(boardId);
    notifyBoardChanged();
  }, [boardId, datasetId, router, setActiveBoardId, notifyBoardChanged]);

  const resolvedBoardId = boardId ?? null;
  const resolvedBoard = resolvedBoardId ? getBoard(resolvedBoardId) : undefined;

  return {
    resolvedBoardId: resolvedBoard ? resolvedBoardId : null,
    resolvedBoard,
    datasetId,
  };
}
