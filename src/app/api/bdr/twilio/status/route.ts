import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";
import { applyBdrCallStatus } from "@/lib/bdr/telephony";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!verifyTwilioWebhookSignature(req, params) || params.AccountSid !== process.env.TWILIO_ACCOUNT_SID) return new Response("Forbidden", { status: 403 });
  const callId = new URL(req.url).searchParams.get("callId") || "";
  if (callId && params.CallSid) applyBdrCallStatus(callId, params.CallSid, params.CallStatus);
  return new Response(null, { status: 204 });
}
