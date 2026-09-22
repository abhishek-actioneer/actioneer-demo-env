import type { ChatMessage } from "@/lib/types";

export interface SegmentCandidateArtifact {
  segmentId?: string;
  name: string;
  description: string;
  sql: string;
  userCount: number | null;
}

export function isDataLookupRequest(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const startsWithLookup =
    /^(find|show|list|which|who|count|analyze|compare|break down|breakdown)\b/.test(normalized) ||
    /^how many\b/.test(normalized) ||
    /^what (are|is|were|was)\b/.test(normalized);
  if (!startsWithLookup) return false;
  return /\b(users?|customers?|investors?|members?|cohorts?|segments?|accounts?|events?|transactions?|orders?|bookings?|records?|revenue|conversion|retention|churn)\b/.test(normalized);
}

export function isCohortDiscoveryRequest(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const startsWithDiscovery = /^(find|show|list)\b/.test(normalized) || /^which\b/.test(normalized);
  if (!startsWithDiscovery) return false;
  const namesAudience = /\b(investors?|users?|customers?)\b/.test(normalized);
  const hasCriteria = /\b(who|with|without|that|where|but|have|has|had|did|did not|not|no)\b/.test(normalized);
  const asksForAggregate =
    /\b(count|how many|trend|rate|percentage|breakdown|compare|comparison|by month|by week|over time)\b/.test(normalized);
  return namesAudience && hasCriteria && !asksForAggregate;
}

export function latestSegmentCandidate(messages: ChatMessage[]): SegmentCandidateArtifact | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i].segmentConfirm;
    if (!candidate) continue;
    if (!["ready", "confirmed"].includes(candidate.status)) continue;
    return {
      segmentId: candidate.segmentId,
      name: candidate.suggestedName,
      description: candidate.description,
      sql: candidate.sql,
      userCount: candidate.userCount,
    };
  }
  return null;
}

export function buildCohortDiscoveryInsight({
  description,
  suggestedName,
  userCount,
}: {
  description: string;
  suggestedName: string;
  userCount: number | null;
}): string {
  const entity = description.match(/\b(investors?|customers?|users?)\b/i)?.[1]?.toLowerCase() ?? "members";
  const countText = userCount === null ? "a reusable cohort" : `**${userCount.toLocaleString()} ${entity}**`;
  const cleanedDescription = description
    .replace(/^(find|show|list)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return [
    `### ${suggestedName}`,
    "",
    `${countText} match this cohort.`,
    "",
    `**Why it matters:** ${cleanedDescription || description}`,
    "",
    "**Next step:** Save it as a segment for campaign or voice outreach.",
  ].join("\n");
}
