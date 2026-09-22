import { redirect } from "next/navigation";

interface VoiceCampaignPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Dynamic route for individual voice campaigns.
 * /voice-campaigns/[id] redirects to the campaign studio at
 * /voice-campaigns/new?campaignId=<id>, forwarding any additional query
 * params (e.g. tab, callId) so deep links work correctly.
 */
export default async function VoiceCampaignDetailPage({
  params,
  searchParams,
}: VoiceCampaignPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;

  // Build forwarded query string from existing search params, minus any
  // stale campaignId (we replace it with the path param).
  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (key === "campaignId" || key === "datasetId") continue; // replaced/derived by campaign record
    if (Array.isArray(value)) {
      value.forEach((v) => forwarded.append(key, v));
    } else if (value !== undefined) {
      forwarded.set(key, value);
    }
  }

  forwarded.set("campaignId", id);
  redirect(`/voice-campaigns/new?${forwarded.toString()}`);
}
