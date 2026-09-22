"use client";

import React from "react";
import { MarkdownContent } from "@/lib/markdown";
import type { ChartSpec } from "@/lib/chart-types";
import type { DetectableEntity } from "@/lib/entity-types";
import type { SubagentInfo } from "@/lib/types";

interface DocumentViewProps {
  content: string;
  isStreaming?: boolean;
  onCitationClick?: (agentId: string, queryIndex: number) => void;
  activeCitation?: string | null;
  subagents?: SubagentInfo[];
  renderChartActions?: (spec: ChartSpec) => React.ReactNode;
  renderTableActions?: (data: Record<string, unknown>[], title: string) => React.ReactNode;
  entityLookup?: Map<string, DetectableEntity>;
  onEntityClick?: (entity: DetectableEntity) => void;
  headingIdPrefix?: string;
}

export function DocumentView({
  content,
  isStreaming,
  onCitationClick,
  activeCitation,
  subagents,
  renderChartActions,
  renderTableActions,
  entityLookup,
  onEntityClick,
  headingIdPrefix,
}: DocumentViewProps) {
  return (
    <div className="pt-4 mt-2">
      <div className={`text-base leading-relaxed prose prose-neutral max-w-none
        prose-headings:text-foreground
        prose-h2:text-lg prose-h2:font-semibold prose-h2:mt-6 prose-h2:mb-3
        prose-h3:text-base prose-h3:font-semibold prose-h3:mt-4 prose-h3:mb-2
        prose-p:leading-relaxed prose-p:mb-2
        prose-strong:text-foreground prose-strong:font-semibold
        prose-table:text-sm
        prose-li:leading-relaxed
      `}>
        <MarkdownContent
          content={content}
          onCitationClick={onCitationClick}
          activeCitation={activeCitation}
          subagents={subagents}
          renderChartActions={renderChartActions}
          renderTableActions={renderTableActions}
          entityLookup={entityLookup}
          onEntityClick={onEntityClick}
          headingIdPrefix={headingIdPrefix}
        />
      </div>
      {isStreaming && (
        <span className="inline-block w-1.5 h-4 bg-foreground animate-pulse rounded-sm ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}
