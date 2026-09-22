"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowUp } from "lucide-react";

interface FollowUpInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function FollowUpInput({ onSend, disabled }: FollowUpInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="border-t border-border px-4 py-3 bg-background">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-foreground/90 transition-colors"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
