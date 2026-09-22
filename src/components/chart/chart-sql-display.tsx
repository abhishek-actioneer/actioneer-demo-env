"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { SqlHighlighted } from "@/lib/sql-highlight";

export function ChartSQLDisplay({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="relative h-full">
      {/* Copy button — floats top-right over the code */}
      <button
        type="button"
        aria-label={copied ? "Copied to clipboard" : "Copy SQL to clipboard"}
        className="absolute top-2 right-2 z-[1] flex items-center gap-1 px-2 py-1 min-h-[28px] text-[9px] text-muted-foreground bg-card/80 backdrop-blur-sm border border-border/50 rounded-md transition-[color,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer hover:text-foreground hover:bg-card active:scale-[0.97]"
        onClick={handleCopy}
      >
        <span className="inline-flex items-center gap-1 transition-opacity duration-150 ease-out motion-reduce:transition-none" style={{ opacity: copied ? 0 : 1, position: copied ? "absolute" : "relative" }}>
          <Copy className="w-3 h-3" aria-hidden="true" />
        </span>
        <span className="inline-flex items-center gap-1 transition-opacity duration-150 ease-out motion-reduce:transition-none" style={{ opacity: copied ? 1 : 0, position: copied ? "relative" : "absolute" }}>
          <Check className="w-3 h-3" aria-hidden="true" />
        </span>
      </button>

      {/* SQL code */}
      <div className="h-full overflow-auto p-3 pr-12">
        <pre className="text-[9.9px] leading-relaxed font-mono whitespace-pre-wrap break-words">
          <SqlHighlighted sql={sql} />
        </pre>
      </div>
    </div>
  );
}
