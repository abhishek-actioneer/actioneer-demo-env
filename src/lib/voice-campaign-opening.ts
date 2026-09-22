import type { VoiceFlowNode } from "@/lib/voice-campaign-flow";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

/**
 * Pull the first customer-facing spoken line from an operator script.
 * Supports "VIDYA: …", "Say: …", and bare greeting lines.
 */
export function extractOpeningLineFromScript(script: string): string | undefined {
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^(STEP\b|AI Name|Tone:|Target duration|Languages:|IF\b|SEGMENT\b|FAQ\b|\[)/i.test(line)) {
      continue;
    }
    const labeled = line.match(
      /^(?:VIDYA|AGENT|ASSISTANT|Say|कहें)\s*[:：]\s*(.+)$/i,
    );
    const candidate = (labeled?.[1] ?? line).trim();
    if (!candidate || candidate.length < 8 || candidate.length > 220) continue;
    if (/^(STEP\b|IF\b|SEGMENT\b)/i.test(candidate)) continue;
    if (
      /^(नमस्कार|नमस्ते|Namaskar|Namaste|Hello|Hi\b)/i.test(candidate) ||
      labeled
    ) {
      return candidate.replace(/\s+/g, " ").trim();
    }
  }
  return undefined;
}

/** Spoken opening from the workflow start node's Say: / कहें: line. */
export function extractOpeningLineFromWorkflow(
  nodes: VoiceFlowNode[] | undefined,
): string | undefined {
  if (!nodes?.length) return undefined;
  const start = nodes.find((n) => n.data?.kind === "start");
  const body = start?.data?.body?.trim() ?? "";
  if (!body) return undefined;
  return extractOpeningLineFromScript(body);
}

/**
 * Canonical spoken opening for a campaign.
 * Workflow start-node Say: wins; then stored firstMessage; then Script-tab text.
 */
export function resolveCampaignCanonicalOpening(
  campaign: Pick<VoiceCampaign, "editableScript" | "firstMessage" | "workflow">,
): string {
  const fromWorkflow = extractOpeningLineFromWorkflow(campaign.workflow?.nodes);
  if (fromWorkflow) return fromWorkflow;
  const stored = campaign.firstMessage?.trim() ?? "";
  if (stored) return stored;
  return extractOpeningLineFromScript(campaign.editableScript ?? "") ?? "";
}
