"use client";

import { useRouter } from "next/navigation";
import type { MetricRelationship } from "@/lib/metric-types";

export function MetricRelationships({
  relationships,
}: {
  relationships: MetricRelationship[];
}) {
  const router = useRouter();

  const drives = relationships.filter((r) => r.direction === "drives");
  const drivenBy = relationships.filter((r) => r.direction === "driven_by");

  if (!drives.length && !drivenBy.length) {
    return (
      <p className="text-xs text-muted-foreground">No relationships defined.</p>
    );
  }

  return (
    <div className="space-y-3">
      {drives.length > 0 && (
        <div>
          <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Drives
          </p>
          <div className="flex flex-wrap gap-1.5">
            {drives.map((r) => (
              <RelPill
                key={r.metricId}
                rel={r}
                onClick={() => router.push(`/metrics/${r.metricId}`)}
              />
            ))}
          </div>
        </div>
      )}
      {drivenBy.length > 0 && (
        <div>
          <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Driven by
          </p>
          <div className="flex flex-wrap gap-1.5">
            {drivenBy.map((r) => (
              <RelPill
                key={r.metricId}
                rel={r}
                onClick={() => router.push(`/metrics/${r.metricId}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RelPill({
  rel,
  onClick,
}: {
  rel: MetricRelationship;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-[9.9px] font-medium rounded-full border transition-colors hover:bg-muted ${
        rel.type === "component"
          ? "border-border text-foreground bg-muted/50"
          : "border-border text-muted-foreground bg-muted/30"
      }`}
    >
      {rel.type === "component" ? (
        <span className="text-[8.1px]">═▶</span>
      ) : (
        <span className="text-[8.1px]">─▶</span>
      )}
      {rel.metricName}
    </button>
  );
}
