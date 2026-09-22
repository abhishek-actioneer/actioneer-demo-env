import type { SendTwilioEmailInput } from "@/lib/twilio-email-client";
import { sendTwilioEmail } from "@/lib/twilio-email-client";
import { isWorkspaceEmailConfigured, sendWorkspaceEmail } from "@/lib/google-workspace-email";

/**
 * Single entry point for prospect-facing emails (invites + tests).
 *
 * Prefers Google Workspace send-as (from the real divyansh@actioneer.com inbox,
 * with replies landing back there) when its credentials are configured; falls
 * back to SendGrid otherwise. Call sites don't care which transport is used.
 */
export async function sendProspectEmail(
  input: SendTwilioEmailInput,
): Promise<{ provider: string; messageId: string | null }> {
  if (isWorkspaceEmailConfigured()) {
    const r = await sendWorkspaceEmail(input);
    return { provider: r.provider, messageId: r.messageId };
  }
  const r = await sendTwilioEmail(input);
  return { provider: r.provider, messageId: r.messageId };
}
