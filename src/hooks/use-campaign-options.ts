"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { Purpose } from "@/lib/purpose-types";
import type { Segment } from "@/lib/types";

function withDataset(path: string, datasetId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}datasetId=${encodeURIComponent(datasetId)}`;
}

interface UseCampaignOptionsParams {
  datasetId: string;
  datasetReadyForPage: boolean;
  existingCampaignId: string | null;
  prefillSegmentId: string;
  prefillBrief: string;
  onSegmentIdChange: (id: string) => void;
  onOfferId: (id: string) => void;
  onCampaignBrief: (brief: string) => void;
  onError: (msg: string) => void;
}

export function useCampaignOptions({
  datasetId,
  datasetReadyForPage,
  existingCampaignId,
  prefillSegmentId,
  prefillBrief,
  onSegmentIdChange,
  onOfferId,
  onCampaignBrief,
  onError,
}: UseCampaignOptionsParams) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [offers, setOffers] = useState<Purpose[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  useEffect(() => {
    if (!datasetReadyForPage) return;
    let active = true;
    setLoadingOptions(true);
    if (!existingCampaignId) {
      setSegments([]);
      onSegmentIdChange("");
      setOffers([]);
      onOfferId("");
    }
    Promise.all([
      apiFetch<Segment[]>(withDataset("/api/segments", datasetId), { skipModel: true, datasetId }),
      apiFetch<{ purposes: Purpose[] }>(withDataset("/api/purposes", datasetId), { skipModel: true, datasetId }),
    ])
      .then(([segs, purposeRes]) => {
        if (!active) return;
        const segList = Array.isArray(segs) ? segs : [];
        const requestedSegment =
          prefillSegmentId && segList.some((seg) => seg.id === prefillSegmentId)
            ? prefillSegmentId
            : "";
        setSegments(segList);
        setOffers(purposeRes.purposes ?? []);
        if (!existingCampaignId && segList.length > 0) onSegmentIdChange(requestedSegment || segList[0].id);
        if (!existingCampaignId && prefillBrief) {
          onCampaignBrief(prefillBrief.slice(0, 2000));
        }
      })
      .catch((err) => {
        if (active) onError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, [datasetId, datasetReadyForPage, existingCampaignId, prefillBrief, prefillSegmentId, onSegmentIdChange, onOfferId, onCampaignBrief, onError]);

  return { segments, setSegments, offers, setOffers, loadingOptions };
}
