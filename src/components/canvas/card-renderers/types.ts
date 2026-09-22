import type { BoardCard } from "@/lib/board-types";

/** Payload emitted when a user clicks a data point on a chart */
export interface DataPointClickPayload {
  /** The dimension column that was clicked (e.g., "hub_name") */
  column: string;
  /** The clicked dimension value (e.g., "Koramangala Hub") */
  value: string;
  /** The primary measure value at that data point */
  measure: number | null;
  /** The measure key (e.g., "revenue") */
  measureKey: string | null;
  /** Screen-space coordinates of the click for popover positioning */
  screenX: number;
  screenY: number;
}

export interface CardRendererProps {
  item: BoardCard;
  width: number;
  height: number;
  isSelected: boolean;
  isEditing: boolean;
  /** Comparison data rows (from comparison date execution) */
  comparisonData?: Record<string, unknown>[];
  /** Callback when a data point on a chart is clicked (chart cards only) */
  onDataPointClick?: (payload: DataPointClickPayload) => void;
  /** Pointer-down capture handler for interactive buttons inside tldraw shapes.
   *  Provided by card-content.tsx (tldraw context); undefined in board/document view. */
  onButtonPointerDown?: (e: React.PointerEvent) => void;
  /** Called when the renderer wants to persist partial updates to the card */
  onUpdateCard?: (updates: Partial<BoardCard>) => void;
}
