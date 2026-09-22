"use client";

import { SqlHighlighted } from "@/lib/sql-highlight";

export function SqlDiff({ oldSql, newSql }: { oldSql: string; newSql: string }) {
  const hasOld = !!(oldSql && oldSql.trim());
  const hasNew = !!(newSql && newSql.trim());

  return (
    <div className="space-y-2">
      {hasOld && (
        <div className="bg-muted border border-border rounded-lg px-3 py-2.5">
          <span className="text-muted-foreground text-[9px] font-medium uppercase tracking-wider block mb-1.5">Removed</span>
          <div className="text-[9.9px] font-mono leading-relaxed whitespace-pre-wrap break-words text-muted-foreground line-through">
            <SqlHighlighted sql={oldSql.trim()} />
          </div>
        </div>
      )}
      {hasNew && (
        <div className="bg-muted border border-border rounded-lg px-3 py-2.5">
          {hasOld && <span className="text-muted-foreground text-[9px] font-medium uppercase tracking-wider block mb-1.5">Added</span>}
          <div className="text-[9.9px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground">
            <SqlHighlighted sql={newSql.trim()} />
          </div>
        </div>
      )}
    </div>
  );
}
