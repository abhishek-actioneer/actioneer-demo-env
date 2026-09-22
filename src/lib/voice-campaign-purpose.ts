import type { Purpose } from "@/lib/purpose-types";

interface CampaignBriefPurposeOptions {
  purposeId?: string;
  name?: string;
}

function campaignBriefPurposeId(brief: string): string {
  let hash = 2166136261;
  for (let index = 0; index < brief.length; index += 1) {
    hash ^= brief.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `CUSTOM_BRIEF_${(hash >>> 0).toString(36).toUpperCase()}`;
}

function compact(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

export function buildCampaignBriefPurpose(
  campaignBrief: string,
  options: CampaignBriefPurposeOptions = {},
): Purpose {
  const brief = compact(campaignBrief, 1200);
  if (!brief) throw new Error("Campaign brief is required when no purpose is selected");

  return {
    purposeId: options.purposeId?.trim() || campaignBriefPurposeId(brief),
    sku: "custom-campaign-brief",
    name: options.name?.trim() || compact(brief, 80),
    category: "campaign-brief",
    tagline: compact(brief, 240),
    description: brief,
    valueProp: "Deliver the customer outcome described in the campaign brief",
    priceDisplay: "No pricing or offer terms provided",
    cta: "Follow the next step described in the campaign brief",
  };
}

export function resolveVoiceCampaignPurpose({
  purposeId,
  inlinePurpose,
  purposes,
  campaignBrief,
}: {
  purposeId?: string;
  inlinePurpose?: Purpose;
  purposes: Purpose[];
  campaignBrief: string;
}): Purpose {
  const requestedPurposeId = purposeId?.trim();
  if (!requestedPurposeId) return buildCampaignBriefPurpose(campaignBrief);

  const catalogPurpose = purposes.find((purpose) => purpose.purposeId === requestedPurposeId);
  if (catalogPurpose) return catalogPurpose;
  if (inlinePurpose?.purposeId === requestedPurposeId) return inlinePurpose;

  throw new Error(`Purpose not found: ${requestedPurposeId}`);
}
