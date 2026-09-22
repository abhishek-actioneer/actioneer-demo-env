import { randomUUID } from "node:crypto";
import { rewriteForTracking, trackingBaseUrl } from "@/lib/email-tracking";
import { recordEmailEvent } from "@/lib/server/email-event-repo";
import { renderPlaybookOutputEmail } from "@/lib/server/playbook-output-email";
import { sendTwilioEmail } from "@/lib/twilio-email-client";
import { isPlaybookV2, type AnyPlaybook, type PlaybookRunHistory, type PlaybookV2 } from "@/lib/playbook-types";

export const DORMANT_CURRENT_FUND_HOLDERS_PLAYBOOK_NAME = "Dormant Current Fund Holders";
export const DORMANT_CURRENT_FUND_HOLDERS_EMAIL_RECIPIENTS = [
  "vimarsh@actioneer.com",
  "taha@actioneer.com",
];

export interface DormantPlaybookEmailResult {
  provider: "twilio-sendgrid";
  status: number;
  messageId: string | null;
  recipients: string[];
  trackingCampaignId: string;
}

export function isDormantCurrentFundHoldersPlaybook(playbook: AnyPlaybook): playbook is PlaybookV2 {
  return isPlaybookV2(playbook) && (
    playbook.name === DORMANT_CURRENT_FUND_HOLDERS_PLAYBOOK_NAME ||
    playbook.name === "Dormant Current Fund Holder"
  );
}

export async function sendDormantCurrentFundHoldersRunEmail(input: {
  playbook: PlaybookV2;
  run: PlaybookRunHistory;
  subject?: string;
}): Promise<DormantPlaybookEmailResult | null> {
  if (!isDormantCurrentFundHoldersPlaybook(input.playbook)) return null;
  if (input.run.status === "failed") return null;

  const subject = input.subject?.trim() || "Dormant Current Fund Holders activation brief";
  const rendered = await renderPlaybookOutputEmail({
    playbook: input.playbook,
    run: input.run,
    subject,
  });
  if (!rendered.markdown.trim()) return null;

  const trackingCampaignId = randomUUID();
  const variantId = "default";
  const html = trackingBaseUrl()
    ? rewriteForTracking(rendered.html, { campaignId: trackingCampaignId, variantId })
    : rendered.html;

  const sendResult = await sendTwilioEmail({
    to: DORMANT_CURRENT_FUND_HOLDERS_EMAIL_RECIPIENTS,
    subject,
    html,
    text: rendered.markdown,
    categories: ["sentinel", "playbook", "dormant-current-fund-holders"],
    customArgs: {
      campaignId: trackingCampaignId,
      playbookId: input.playbook.id,
    },
  });

  recordEmailEvent({
    campaignId: trackingCampaignId,
    variantId,
    eventType: "sent",
    meta: {
      recipientCount: sendResult.recipients.length,
      recipients: sendResult.recipients,
      provider: sendResult.provider,
      sendGridMessageId: sendResult.messageId,
      playbookId: input.playbook.id,
      runDate: input.run.date,
      runStatus: input.run.status,
    },
  });

  return {
    provider: sendResult.provider,
    status: sendResult.status,
    messageId: sendResult.messageId,
    recipients: sendResult.recipients,
    trackingCampaignId,
  };
}
