/**
 * Pure conversion utility: Slide → BoardSection + BoardCard[].
 * No React, no side effects. Adapted from deck-canvas.tsx:83-168.
 */

import type { Slide } from "./deck-types";
import type { BoardSection, BoardCard } from "./board-types";

/** Build silent LLM context for follow-up chips. Extracted from deck-canvas.tsx:69-80. */
export function buildFollowUpContext(
  slide: Omit<Slide, "commentaryThreadId" | "chatThreadId">,
): string {
  const parts: string[] = [];
  parts.push(`[CHART CONTEXT — user is asking a follow-up about this specific chart]`);
  parts.push(`Chart: ${slide.title}`);
  if (slide.sql) parts.push(`Previous SQL: ${slide.sql}`);
  if (slide.commentary) parts.push(`Previous analysis: ${slide.commentary}`);
  if (slide.data && slide.data.length > 0) {
    const preview = slide.data.slice(0, 5);
    parts.push(
      `Sample data (${slide.data.length} total rows, showing first 5 only): ${JSON.stringify(preview)}`,
    );
  }
  parts.push(
    `[IMPORTANT: This is background context only. You have full access to the underlying events database. ALWAYS run new SQL queries to answer the follow-up question completely — do NOT answer based solely on the sample data above.]`,
  );
  return parts.join("\n");
}

/** Build silent LLM context for board document view follow-up chips. */
export function buildBoardFollowUpContext(
  title: string,
  sqls: string[],
  markdownContent: string | undefined,
): string {
  const parts: string[] = [];
  parts.push(`[CHART CONTEXT — user is asking a follow-up about this specific board card]`);
  parts.push(`Card: ${title}`);
  for (const sql of sqls) {
    parts.push(`Previous SQL: ${sql}`);
  }
  if (markdownContent) parts.push(`Previous analysis: ${markdownContent}`);
  parts.push(
    `[IMPORTANT: This is background context only. You have full access to the underlying events database. ALWAYS run new SQL queries to answer the follow-up question completely — do NOT answer based solely on the sample data above.]`,
  );
  return parts.join("\n");
}

/** Convert a PDF filename to a board title. */
export function pdfFilenameToBoardTitle(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert a slide to a BoardSection + its BoardCard array.
 * Returns { section, cards }.
 *
 * Card types per slide:
 * - "chart"    (chartSpecs[0]) — orderInSection: 0
 * - "text"     (commentary + follow-ups inline) — orderInSection: 1
 *
 * Canvas positions set to a sensible grid (document view is default,
 * but canvas view should render readably if toggled).
 */
export function deckSlideToSection(
  slide: Omit<Slide, "commentaryThreadId" | "chatThreadId">,
  boardId: string,
  slideIndex: number,
): { section: BoardSection; cards: BoardCard[] } {
  const sectionId = `${boardId}-section-${slide.index}`;
  const now = new Date().toISOString();

  const section: BoardSection = {
    id: sectionId,
    boardId,
    title: slide.title,
    prose: "",
    order: slideIndex,
    collapsed: false,
  };

  const cards: BoardCard[] = [];

  // Chart card
  if (slide.chartSpecs && slide.chartSpecs.length > 0) {
    cards.push({
      id: `${boardId}-slide-${slide.index}-chart`,
      boardId,
      type: "chart",
      title: slide.chartSpecs[0].title ?? slide.title,
      position: { x: 0, y: slideIndex * 400 },
      size: { width: 440, height: 320 },
      author: "system",
      chartSpec: slide.chartSpecs[0],
      data: slide.data as Record<string, unknown>[],
      sql: slide.sql,
      refreshCadence: "manual",
      lastRefreshed: new Date(slide.lastRefreshed).toISOString(),
      pinnedAt: now,
      comments: [],
      sectionId,
      orderInSection: 0,
    });
  }

  // Analysis text card — always create, even if commentary is empty
  {
    cards.push({
      id: `${boardId}-slide-${slide.index}-analysis`,
      boardId,
      type: "text",
      title: "Analysis",
      markdownContent: slide.commentary || "Analysis pending.",
      position: { x: 460, y: slideIndex * 400 },
      size: { width: 440, height: 320 },
      author: "system",
      refreshCadence: "manual",
      pinnedAt: now,
      comments: [],
      sectionId,
      orderInSection: 1,
      // Attach follow-up questions inline instead of a separate card
      followUpQuestions: slide.followUps ?? [],
      silentContext: slide.followUps?.length ? buildFollowUpContext(slide) : undefined,
    });
  }

  return { section, cards };
}
