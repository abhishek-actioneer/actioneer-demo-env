"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SegmentWorkspace } from "@/components/segments/segment-workspace";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import type { Segment, SegmentDisplay } from "@/lib/types";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { isUploadedAudienceSql } from "@/lib/segment-csv-upload";

function toSegmentDisplay(segment: Segment): SegmentDisplay {
  return {
    ...segment,
    description: (segment as unknown as { description?: string }).description || "Segment created from chat analysis",
    type: isUploadedAudienceSql(segment.sql) ? "static" : "dynamic",
    destinations: Object.entries(segment.pushStatus)
      .filter(([, status]) => status === "synced" || status === "pushing")
      .map(([id]) => id),
    trend: null,
    refreshStatus: "active",
    refreshLabel: "Live query",
    creator: "You",
    statusColor: "green",
    archived: false,
    refreshFrequency: "daily",
    similarSegments: [],
    totalUsers: segment.userCount,
  };
}

export default function SegmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const segmentId = params.id as string;
  const { datasetId } = useDataset();

  const [segment, setSegment] = useState<SegmentDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<Segment>(`/api/segments/${segmentId}`)
      .then((data) => {
        if (cancelled) return;
        setSegment(toSegmentDisplay(data));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [segmentId, refreshKey, datasetId]);

  useBreadcrumbTitle(segment?.name ?? "");

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/segments/${id}`, { method: "DELETE" });
        router.push("/segments");
      } catch { /* keep on page */ }
    },
    [router],
  );

  const handleUpdate = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Chat context
  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (segment) {
      setEntity({
        id: segment.id,
        name: segment.name,
        type: "segment",
        summary: `${segment.userCount.toLocaleString()} users`,
        contextPayload: {
          sql: segment.sql,
          userCount: segment.userCount,
          description: (segment as unknown as Record<string, unknown>).description,
        },
      });
    }
  }, [segment, setEntity]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !segment) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Segment not found</p>
          <button
            onClick={() => router.push("/segments")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back to Segments
          </button>
        </div>
      </div>
    );
  }

  return (
    <SegmentWorkspace
      segment={segment}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
    />
  );
}
