"use client";
import { Sparkles } from "lucide-react";

export function CellTypeIcon({ type, size = 12 }: { type: string; size?: number }) {
  if (type === "sql") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0 text-muted-foreground">
        <ellipse cx="8" cy="4" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 4v8c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5V4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 8c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if ((type as string) === "python") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0 text-muted-foreground">
        <path d="M6 2C4.34 2 3 3.11 3 4.5V7c0 .83.67 1.5 1.5 1.5H8V9H4.5C3.67 9 3 9.67 3 10.5v1C3 12.88 4.34 14 6 14h1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M10 14c1.66 0 3-1.11 3-2.5V9c0-.83-.67-1.5-1.5-1.5H8V7h3.5c.83 0 1.5-.67 1.5-1.5v-1C13 3.12 11.66 2 10 2H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="6" cy="4.5" r="0.75" fill="currentColor" />
        <circle cx="10" cy="11.5" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  return <Sparkles className="shrink-0 text-muted-foreground" style={{ width: size, height: size }} />;
}

export function StatusDot({ status, size = 14 }: { status: string; size?: number }) {
  if (status === "running") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="animate-spin shrink-0 text-muted-foreground">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" className="text-border" />
        <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-foreground" />
      </svg>
    );
  }
  if (status === "done") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0 text-emerald-500">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5.5 8l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0 text-red-500">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  // idle, waiting, blocked
  const dotSize = Math.round(size * 0.5);
  return (
    <span
      className={`rounded-full shrink-0 ${status === "blocked" ? "bg-muted-foreground/25" : "bg-muted-foreground/40"}`}
      style={{ width: dotSize, height: dotSize }}
    />
  );
}
