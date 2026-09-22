import type { ChartSpec } from "./chart-types";
import type { BoardCard } from "./board-types";

/** A single slide extracted from a PDF deck */
export interface Slide {
  id: string;
  index: number;
  title: string;
  status: "processing" | "ok" | "failed";
  chartSpecs: ChartSpec[];
  sql: string;
  data: Record<string, string | number>[];
  lastRefreshed: number;
  commentary: string;
  commentaryThreadId: string | null;
  chatThreadId: string | null;
  followUps: string[] | null;
  challengeCard?: { summary: string };
  challengeStale?: boolean;
}

/** A processed PDF deck */
export interface Deck {
  id: string;
  name: string;
  uploadedAt: number;
  analyzedAt: number;
  challengeThreadId?: string;
  reanalyzeRunId?: string;
  challengeInProgress?: boolean;
  slides: Slide[];
  followUpCards?: BoardCard[];
}

/** Preview of an extracted slide (before full analysis) */
export interface ExtractedSlidePreview {
  index: number;
  title: string;
  charts: { chartType: string; metric: string }[];
}

/** SSE events streamed from /api/decks/process */
export type DeckProcessEvent =
  | { type: "total"; count: number }
  | { type: "progress"; stage: "uploading_file" | "processing_file" | "reading_slides" | "extracting" | "sql" | "analyzing" | "complete"; slideIndex?: number }
  | { type: "extraction_complete"; count: number; deckTitle: string; deckId: string; slides: ExtractedSlidePreview[] }
  | { type: "slide_complete"; slideIndex: number; slide: Omit<Slide, "commentaryThreadId" | "chatThreadId"> }
  | { type: "done"; deckId: string; deck?: Deck }
  | { type: "error"; message: string; slideIndex?: number };
