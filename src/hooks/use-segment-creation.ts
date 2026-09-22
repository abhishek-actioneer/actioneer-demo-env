import { useState, useCallback } from "react";
import { useSidebarContext } from "@/components/sidebar-context";
import { apiFetch } from "@/lib/api-client";

interface SegmentModalState {
  open: boolean;
  sql: string;
  defaultName: string;
  userCount: number | null;
  pushTo?: string;
}

export function useSegmentCreation(activeConvId: string | null) {
  const [segmentModal, setSegmentModal] = useState<SegmentModalState | null>(null);
  const [isCreatingSegment, setIsCreatingSegment] = useState(false);
  const [segmentToast, setSegmentToast] = useState<{ name: string; id: string } | null>(null);
  const { refreshSegments } = useSidebarContext();

  const openSegmentModal = useCallback(
    (sql: string, defaultName: string, pushTo?: string) => {
      setSegmentModal({ open: true, sql, defaultName, userCount: null, pushTo });

      // Fetch user count (uses dedicated endpoint — no row cap)
      apiFetch<{ count: number }>("/api/segments/count", {
        method: "POST",
        body: { sql },
        skipModel: true,
      })
        .then((data) => {
          setSegmentModal((prev) => prev ? { ...prev, userCount: data.count } : prev);
        })
        .catch(() => {});
    },
    []
  );

  const handleCreateSegment = useCallback(
    async (name: string, sql?: string, description?: string) => {
      const segmentSql = sql ?? segmentModal?.sql;
      if (!segmentSql) return;
      const pushTo = segmentModal?.pushTo;
      setIsCreatingSegment(true);
      try {
        const data = await apiFetch<{ id: string; name: string }>("/api/segments", {
          method: "POST",
          body: {
            name,
            sql: segmentSql,
            description,
            sourceConversationId: activeConvId,
          },
        });
        setSegmentModal(null);

        let pushedTo: string | undefined;
        if (pushTo) {
          try {
            await apiFetch(`/api/segments/${data.id}/push`, {
              method: "POST",
              body: { integrationId: pushTo },
            });
            pushedTo = pushTo;
          } catch {
            // Push failed — segment still created
          }
        }

        const toastName = pushedTo
          ? `${data.name} — pushed to ${pushedTo}`
          : data.name;
        setSegmentToast({ name: toastName, id: data.id });
        setTimeout(() => setSegmentToast(null), 6000);
        refreshSegments();
      } finally {
        setIsCreatingSegment(false);
      }
    },
    [segmentModal, activeConvId, refreshSegments]
  );

  const closeSegmentModal = useCallback(() => setSegmentModal(null), []);
  const dismissSegmentToast = useCallback(() => setSegmentToast(null), []);

  return {
    segmentModal,
    isCreatingSegment,
    segmentToast,
    openSegmentModal,
    handleCreateSegment,
    closeSegmentModal,
    dismissSegmentToast,
  };
}
