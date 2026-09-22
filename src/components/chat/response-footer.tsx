"use client";

import { useState, useCallback } from "react";
import { Zap, ThumbsUp, ThumbsDown, Copy, Check, Download } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.522 2.522v6.312z" />
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zm0-1.27a2.527 2.527 0 0 1-2.521-2.522 2.528 2.528 0 0 1 2.521-2.522h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.521h-6.313z" />
    </svg>
  );
}

type Feedback = "up" | "down" | null;

export function ResponseFooter({ message }: { message: ChatMessage }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }, [message.content]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([message.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "report.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [message.content]);

  if (message.role === "user") return null;

  const iconClass =
    "w-3.5 h-3.5 text-muted-foreground transition-colors";
  const btnClass =
    "p-1 rounded-sm hover:text-foreground cursor-pointer";

  return (
    <div className="flex items-center justify-between gap-1 mt-6">
      {/* Left group — download, copy, slack */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={btnClass}
          onClick={handleDownload}
          aria-label="Download report"
        >
          <Download className={iconClass} />
        </button>

        <button
          type="button"
          className={btnClass}
          onClick={handleCopy}
          aria-label="Copy response"
        >
          {copied ? (
            <Check className={iconClass} />
          ) : (
            <Copy className={iconClass} />
          )}
        </button>

        <button
          type="button"
          className={btnClass}
          onClick={() => {}}
          aria-label="Share to Slack"
        >
          <SlackIcon className={iconClass} />
        </button>

        {message.creditCost != null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground ml-1">
            <Zap className={iconClass} />
            {message.creditCost} credit{message.creditCost !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Right group — thumbs up/down */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={btnClass}
          onClick={() => setFeedback(feedback === "up" ? null : "up")}
          aria-label="Thumbs up"
        >
          <ThumbsUp
            className={iconClass}
            fill={feedback === "up" ? "currentColor" : "none"}
          />
        </button>

        <button
          type="button"
          className={btnClass}
          onClick={() => setFeedback(feedback === "down" ? null : "down")}
          aria-label="Thumbs down"
        >
          <ThumbsDown
            className={iconClass}
            fill={feedback === "down" ? "currentColor" : "none"}
          />
        </button>
      </div>
    </div>
  );
}
