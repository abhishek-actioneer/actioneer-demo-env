"use client";

import { X, FileText } from "lucide-react";
import { MarkdownContent } from "@/lib/markdown";
import type { ScoutRun } from "@/lib/scout-data";

interface ScoutReportPanelProps {
  run: ScoutRun;
  onClose: () => void;
}

export function ScoutReportPanel({ run, onClose }: ScoutReportPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold truncate">
            Run #{run.number} · {run.runAt}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Report content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-5 space-y-4">
          <div
            className="report-prose text-sm leading-relaxed prose prose-sm prose-neutral max-w-none
            prose-headings:text-foreground
            prose-h1:text-lg prose-h1:font-bold prose-h1:mb-3 prose-h1:mt-0
            prose-h2:text-sm prose-h2:font-semibold prose-h2:mb-2 prose-h2:mt-5
            prose-h3:text-xs prose-h3:font-semibold prose-h3:mb-1.5 prose-h3:mt-3
            prose-p:text-xs prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-2
            prose-strong:text-foreground prose-strong:font-semibold
            prose-table:text-xs prose-table:border-collapse
            prose-th:text-left prose-th:py-1.5 prose-th:px-2 prose-th:font-medium prose-th:border prose-th:border-border prose-th:bg-muted/30
            prose-td:py-1.5 prose-td:px-2 prose-td:border prose-td:border-border
            prose-li:text-xs prose-li:text-muted-foreground
            prose-ol:pl-4 prose-ol:space-y-1
            prose-ul:pl-4 prose-ul:space-y-1
            prose-hr:my-4 prose-hr:border-border"
          >
            <MarkdownContent content={run.report} />
          </div>
        </div>
      </div>
    </div>
  );
}
