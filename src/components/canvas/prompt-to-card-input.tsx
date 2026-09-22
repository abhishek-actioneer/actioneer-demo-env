"use client";

import { useEffect, useRef, useState } from "react";

export interface PromptToCardInputProps {
  /** Canvas page-space position where the input should appear */
  position: { x: number; y: number };
  onSubmit: (query: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function PromptToCardInput({
  position,
  onSubmit,
  onCancel,
  isLoading,
}: PromptToCardInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const trimmed = value.trim();
      if (trimmed && !isLoading) {
        onSubmit(trimmed);
      }
      return;
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        zIndex: 100,
        transform: "translate(-50%, -50%)",
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "var(--canvas-card-shadow, 0 4px 24px rgba(0,0,0,0.12))",
          minWidth: 320,
          maxWidth: 480,
        }}
      >
        {/* Sparkle icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3m-3.22-6.78-2.12 2.12M6.34 17.66l-2.12 2.12m0-13.56 2.12 2.12m11.32 11.32-2.12-2.12" />
        </svg>

        {isLoading ? (
          <span
            style={{
              fontSize: 11.7,
              color: "var(--muted-foreground)",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Analyzing...
          </span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 11.7,
              color: "var(--foreground)",
              fontFamily: "inherit",
            }}
          />
        )}

        {!isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <button
              onClick={onCancel}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                border: "none",
                background: "transparent",
                borderRadius: 4,
                cursor: "pointer",
                color: "var(--muted-foreground)",
                padding: 0,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--muted)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
              title="Cancel (Esc)"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {!isLoading && (
        <p
          style={{
            margin: "4px 0 0 0",
            fontSize: 9.9,
            color: "var(--muted-foreground)",
            textAlign: "center",
          }}
        >
          Double-click empty canvas to ask anywhere · Esc to dismiss
        </p>
      )}
    </div>
  );
}
