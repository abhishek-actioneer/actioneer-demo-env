"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getActiveDatasetId } from "@/lib/api-client";
import { saveBoard, saveBoardCard, saveBoardSection, removeBoardCard } from "@/lib/board-store";
import { deckSlideToSection, pdfFilenameToBoardTitle } from "@/lib/deck-to-board";
import {
  setActivePdfStream,
} from "@/lib/deck-to-board-stream";
import type { DeckProcessEvent, ExtractedSlidePreview } from "@/lib/deck-types";

export function useDeckUploadToBoard(): {
  upload: (file: File) => Promise<void>;
  isUploading: boolean;
  error: string | null;
} {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigatedRef = useRef(false);

  // Cleanup on unmount: abort any in-progress upload and clear stream state.
  // Guard: if we navigated to the board page, the stream must keep running to
  // deliver slide_complete events — only abort if the user left before upload completed.
  useEffect(() => {
    return () => {
      if (!navigatedRef.current) {
        abortRef.current?.abort();
        setActivePdfStream(null);
      }
    };
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setError(null);

      const boardId = crypto.randomUUID();
      const boardTitle = pdfFilenameToBoardTitle(file.name);

      const ac = new AbortController();
      abortRef.current = ac;

      const now = new Date().toISOString();

      // 1. Create board + sentinel IMMEDIATELY (before fetch)
      saveBoard({
        id: boardId,
        name: boardTitle,
        datasetId: getActiveDatasetId() ?? "",
        createdAt: now,
        updatedAt: now,
        viewMode: "document",
      });

      saveBoardCard(
        {
          id: `${boardId}-sentinel`,
          boardId,
          type: "text",
          title: "",
          markdownContent: "",
          position: { x: 0, y: 0 },
          size: { width: 0, height: 0 },
          author: "system",
          refreshCadence: "manual",
          pinnedAt: now,
          comments: [],
        },
        { sync: true },
      );

      // 2. Set stream to uploading + navigate IMMEDIATELY
      setActivePdfStream({ boardId, status: "uploading", stage: "uploading_file" });
      navigatedRef.current = true;
      setIsUploading(false);
      router.push(`/canvas/${boardId}`);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/decks/process", {
          method: "POST",
          credentials: "include",
          headers: { "x-dataset-id": getActiveDatasetId() ?? "" },
          body: formData,
          signal: ac.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Upload failed: ${res.status} ${text}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completedSlides = 0;
        let totalSlides = 0;
        let extractedSlides: ExtractedSlidePreview[] | undefined;
        const completedIndices = new Set<number>();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || ac.signal.aborted) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const event = JSON.parse(line) as DeckProcessEvent;
                handleEvent(event);
              } catch {
                // Skip malformed lines
              }
            }
          }
        } finally {
          reader.cancel().catch(() => {});
        }

        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");

        function handleEvent(event: DeckProcessEvent) {
          if (event.type === "progress") {
            // Only update uploading stage for pre-extraction events.
            // Per-slide progress (sql, complete) arrives after extraction_complete
            // and must not reset status from "processing" back to "uploading".
            const preExtractionStages = ["uploading_file", "processing_file", "reading_slides"];
            if (preExtractionStages.includes(event.stage)) {
              setActivePdfStream({
                boardId,
                status: "uploading",
                stage: event.stage,
              });
            }
          } else if (event.type === "extraction_complete") {
            totalSlides = event.count;
            extractedSlides = event.slides;

            // Update board name from extraction
            saveBoard({
              id: boardId,
              name: event.deckTitle || boardTitle,
              datasetId: getActiveDatasetId() ?? "",
              createdAt: now,
              updatedAt: new Date().toISOString(),
              viewMode: "document",
              deckId: event.deckId,
            });

            // Create skeleton sections with titles from extraction
            for (const slide of event.slides) {
              saveBoardSection({
                id: `${boardId}-section-${slide.index}`,
                boardId,
                title: slide.title,
                prose: "",
                order: slide.index,
                collapsed: false,
              });
            }

            setActivePdfStream({
              boardId,
              status: "processing",
              completedSlides: 0,
              totalSlides: event.count,
              stage: "analyzing",
              extractedSlides: event.slides,
            });
          } else if (event.type === "total") {
            // Backward compat — totalSlides may already be set from extraction_complete
            if (totalSlides === 0) totalSlides = event.count;
          } else if (event.type === "slide_complete") {
            const { section, cards } = deckSlideToSection(
              event.slide,
              boardId,
              event.slideIndex,
            );

            saveBoardSection(section);
            for (const card of cards) {
              saveBoardCard(card, { sync: true });
            }

            completedIndices.add(event.slideIndex);
            completedSlides = completedIndices.size;
            setActivePdfStream({
              boardId,
              status: "processing",
              completedSlides,
              totalSlides,
              extractedSlides,
            });
          } else if (event.type === "done") {
            // Write fallback cards for sections that never got populated (failed slides)
            if (extractedSlides) {
              for (let si = 0; si < extractedSlides.length; si++) {
                const slide = extractedSlides[si];
                if (!completedIndices.has(si)) {
                  const sectionId = `${boardId}-section-${slide.index}`;
                  const failNow = new Date().toISOString();
                  saveBoardCard(
                    {
                      id: `${boardId}-slide-${slide.index}-failed`,
                      boardId,
                      type: "text",
                      title: "Analysis unavailable",
                      markdownContent: "This slide could not be analyzed. Try re-analyzing the deck.",
                      position: { x: 0, y: slide.index * 400 },
                      size: { width: 440, height: 120 },
                      author: "system",
                      refreshCadence: "manual",
                      pinnedAt: failNow,
                      comments: [],
                      sectionId,
                      orderInSection: 0,
                    },
                    { sync: true },
                  );
                }
              }
            }

            removeBoardCard(boardId, `${boardId}-sentinel`);
            setActivePdfStream({
              boardId,
              status: "done",
              completedSlides,
              totalSlides,
            });
          } else if (event.type === "error") {
            if (event.slideIndex != null) {
              // Per-slide error: write an error placeholder card
              const errNow = new Date().toISOString();
              const sectionId = `${boardId}-section-${event.slideIndex}`;
              saveBoardCard(
                {
                  id: `${boardId}-slide-${event.slideIndex}-error`,
                  boardId,
                  type: "text",
                  title: "Could not analyze this slide",
                  markdownContent: "An error occurred while processing this slide.",
                  position: { x: 0, y: event.slideIndex * 400 },
                  size: { width: 440, height: 120 },
                  author: "system",
                  refreshCadence: "manual",
                  pinnedAt: errNow,
                  comments: [],
                  sectionId,
                  orderInSection: 0,
                },
                { sync: true },
              );
            } else {
              // Global stream error
              setActivePdfStream({
                boardId,
                status: "error",
                error: event.message,
                completedSlides,
              });
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Upload failed";
        setError(msg);
        setActivePdfStream({
          boardId,
          status: "error",
          error: msg,
          completedSlides: 0,
        });
      }
    },
    [router],
  );

  return { upload, isUploading, error };
}
