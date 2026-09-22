"use client";

import { SqlHighlighted } from "@/lib/sql-highlight";

export function MetricSqlSection({ sql }: { sql: string }) {
  return (
    <div className="bg-muted rounded-lg px-3 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
      <pre className="text-foreground/80 whitespace-pre-wrap">{sql}</pre>
    </div>
  );
}
