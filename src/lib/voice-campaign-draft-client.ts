"use client";

import { apiFetch } from "@/lib/api-client";

export async function createVoiceCampaignDraft(datasetId: string): Promise<string> {
  const result = await apiFetch<{ id: string }>("/api/voice-campaigns", {
    method: "POST",
    body: {
      draftOnly: true,
      datasetId,
      campaignName: "Untitled campaign",
    },
    datasetId,
    skipModel: true,
  });
  return result.id;
}
