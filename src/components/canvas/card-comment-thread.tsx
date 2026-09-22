"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getCardComments, addCardComment, getBoardCard, saveBoardCard } from "@/lib/board-store";
import type { CardComment, BoardCard } from "@/lib/board-types";
import { apiFetch } from "@/lib/api-client";

/* ── Minimal markdown-ish renderer for system comments ── */
function SimpleMarkdown({ text }: { text: string }) {
  // Split into paragraphs/lines and handle **bold** and `code`
  const lines = text.split("\n");
  return (
    <span style={{ display: "block" }}>
      {lines.map((line, i) => {
        // Parse **bold** and `code` inline
        const parts: React.ReactNode[] = [];
        let remaining = line;
        let key = 0;

        while (remaining.length > 0) {
          const boldMatch = remaining.match(/^([\s\S]*?)\*\*([\s\S]*?)\*\*([\s\S]*)/);
          const codeMatch = remaining.match(/^([\s\S]*?)`([^`]+)`([\s\S]*)/);

          if (boldMatch && (!codeMatch || boldMatch[1].length <= codeMatch[1].length)) {
            if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
            parts.push(<strong key={key++}>{boldMatch[2]}</strong>);
            remaining = boldMatch[3];
          } else if (codeMatch) {
            if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
            parts.push(
              <code
                key={key++}
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.85em",
                  background: "var(--muted)",
                  borderRadius: 3,
                  padding: "0 4px",
                }}
              >
                {codeMatch[2]}
              </code>
            );
            remaining = codeMatch[3];
          } else {
            parts.push(<span key={key++}>{remaining}</span>);
            remaining = "";
          }
        }

        return (
          <span key={i} style={{ display: "block", marginBottom: i < lines.length - 1 ? 2 : 0 }}>
            {parts.length > 0 ? parts : "\u00a0"}
          </span>
        );
      })}
    </span>
  );
}

/* ── Comment row ── */
function CommentRow({ comment }: { comment: CardComment }) {
  const isUser = comment.author === "user";
  const time = new Date(comment.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {isUser && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--foreground)",
              opacity: 0.7,
            }}
          >
            You
          </span>
        )}
        <span
          style={{
            fontSize: 9,
            color: "var(--muted-foreground)",
            marginLeft: "auto",
          }}
        >
          {time}
        </span>
      </div>
      <div
        style={{
          fontSize: 10.8,
          lineHeight: 1.5,
          color: "var(--foreground)",
        }}
      >
        {isUser ? (
          <span>{comment.content}</span>
        ) : (
          <SimpleMarkdown text={comment.content} />
        )}
      </div>
      {comment.spawnedCardId && (
        <div
          style={{
            fontSize: 9.9,
            color: "var(--muted-foreground)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 2,
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
          Created card
        </div>
      )}
    </div>
  );
}

/* ── Main component ── */
export interface CardAnnotation {
  text: string;
  relatedCardId: string;
  severity?: "info" | "warning";
}

export interface CardCommentThreadProps {
  cardId: string;
  boardId: string;
  onClose: () => void;
  onCommentAdded?: () => void;
  onAnnotations?: (annotations: CardAnnotation[], sourceCard: BoardCard) => void;
}

export function CardCommentThread({
  cardId,
  boardId,
  onClose,
  onCommentAdded,
  onAnnotations,
}: CardCommentThreadProps) {
  const [comments, setComments] = useState<CardComment[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [card, setCard] = useState<BoardCard | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load card and comments on mount
  useEffect(() => {
    const c = getBoardCard(boardId, cardId);
    setCard(c);
    setComments(getCardComments(boardId, cardId));
  }, [boardId, cardId]);

  // Scroll to bottom when comments change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const refreshComments = useCallback(() => {
    setComments(getCardComments(boardId, cardId));
  }, [boardId, cardId]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text || isSubmitting) return;

      setIsSubmitting(true);
      setInputValue("");

      // 1. Add user comment immediately
      const userComment: CardComment = {
        id: crypto.randomUUID(),
        cardId,
        author: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };
      addCardComment(boardId, cardId, userComment);
      refreshComments();
      onCommentAdded?.();

      // 2. Call LLM API with card context
      try {
        const cardContext = card
          ? {
              type: card.type,
              title: card.title,
              sql: card.sql,
              data: card.data?.slice(0, 10) ?? card.chartSpec?.data?.slice(0, 10),
              markdownContent: card.markdownContent ?? card.reportMarkdown,
            }
          : undefined;

        const result = await apiFetch<{
          type: "response" | "update" | "note";
          text?: string;
          newCard?: Partial<BoardCard>;
          updatedFields?: Partial<BoardCard>;
          annotations?: Array<{ text: string; relatedCardId: string; severity?: "info" | "warning" }>;
        }>("/api/canvas-comment", {
          method: "POST",
          body: {
            cardId,
            boardId,
            comment: text,
            cardContext,
          },
        });

        if (result.type === "response") {
          // Add system reply
          const systemComment: CardComment = {
            id: crypto.randomUUID(),
            cardId,
            author: "system",
            content: result.text ?? "",
            timestamp: new Date().toISOString(),
            spawnedCardId: result.newCard ? "pending" : undefined,
          };
          addCardComment(boardId, cardId, systemComment);

          // If there's a suggested new card, add a note
          if (result.newCard?.title) {
            const noteComment: CardComment = {
              id: crypto.randomUUID(),
              cardId,
              author: "system",
              content: `Suggested: "${result.newCard.title}"`,
              timestamp: new Date().toISOString(),
            };
            addCardComment(boardId, cardId, noteComment);
          }

          refreshComments();
          onCommentAdded?.();
        } else if (result.type === "update" && result.updatedFields && card) {
          // Update card in store
          const updatedCard: BoardCard = { ...card, ...result.updatedFields };
          saveBoardCard(updatedCard);
          setCard(updatedCard);

          // Add "Card updated" system comment
          const updateComment: CardComment = {
            id: crypto.randomUUID(),
            cardId,
            author: "system",
            content: "Card updated based on your instruction.",
            timestamp: new Date().toISOString(),
          };
          addCardComment(boardId, cardId, updateComment);
          refreshComments();
          onCommentAdded?.();
        }
        // type === "note": already stored client-side, no additional action needed

        // Fire annotations callback if the API returned any and we have a source card
        if (result.annotations && result.annotations.length > 0 && card && onAnnotations) {
          onAnnotations(result.annotations, card);
        }
      } catch (err) {
        console.error("[card-comment] API error:", err);
        // Add error comment so user knows something went wrong
        const errComment: CardComment = {
          id: crypto.randomUUID(),
          cardId,
          author: "system",
          content: "Sorry, I couldn't process that comment right now.",
          timestamp: new Date().toISOString(),
        };
        addCardComment(boardId, cardId, errComment);
        refreshComments();
      } finally {
        setIsSubmitting(false);
      }
    },
    [inputValue, isSubmitting, boardId, cardId, card, refreshComments, onCommentAdded, onAnnotations]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [handleSubmit]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 320,
        height: "100%",
        background: "var(--card)",
        borderLeft: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10.8,
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Comments
          </div>
          {card && (
            <div
              style={{
                fontSize: 9.9,
                color: "var(--muted-foreground)",
                marginTop: 1,
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {card.title}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "none",
            background: "transparent",
            color: "var(--muted-foreground)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--muted)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title="Close comments"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Comment list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 16px",
          minHeight: 0,
        }}
      >
        {comments.length === 0 ? (
          <div
            style={{
              padding: "24px 0",
              textAlign: "center",
              color: "var(--muted-foreground)",
              fontSize: 10.8,
            }}
          >
            No comments yet.
            <br />
            Ask a question about this card.
          </div>
        ) : (
          comments.map((comment) => <CommentRow key={comment.id} comment={comment} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--border)",
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask or comment... (Enter to send)"
          rows={2}
          disabled={isSubmitting}
          style={{
            flex: 1,
            resize: "none",
            fontSize: 10.8,
            lineHeight: 1.5,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            outline: "none",
            fontFamily: "inherit",
            opacity: isSubmitting ? 0.6 : 1,
          }}
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || isSubmitting}
          style={{
            width: 30,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: inputValue.trim() && !isSubmitting ? "var(--foreground)" : "var(--muted)",
            color: inputValue.trim() && !isSubmitting ? "var(--background)" : "var(--muted-foreground)",
            cursor: inputValue.trim() && !isSubmitting ? "pointer" : "default",
            transition: "background 0.15s, color 0.15s",
            flexShrink: 0,
          }}
          title="Send comment"
        >
          {isSubmitting ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: "spin 1s linear infinite" }}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m22 2-7 20-4-9-9-4 20-7z" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
