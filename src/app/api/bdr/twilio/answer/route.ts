import twilio from "twilio";
import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";
import { requirePublicBaseUrl } from "@/lib/public-base-url";
import { findBdrCall } from "@/lib/bdr/store";
import { applyBdrCallStatus, bdrStreamToken } from "@/lib/bdr/telephony";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!verifyTwilioWebhookSignature(req, params)) return new Response("Forbidden", { status: 403 });
  const callId = new URL(req.url).searchParams.get("callId") || "";
  const found = findBdrCall(callId);
  if (!found || !params.CallSid || params.AccountSid !== process.env.TWILIO_ACCOUNT_SID || !["dispatching", "calling", "connected"].includes(found.recipient.status) || (found.recipient.providerSid && found.recipient.providerSid !== params.CallSid)) return new Response("Call not found", { status: 404 });
  applyBdrCallStatus(callId, params.CallSid, "in-progress");
  const xml = new twilio.twiml.VoiceResponse();
  const stream = xml.connect().stream({ url: `${requirePublicBaseUrl().replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/bdr-media-stream` });
  stream.parameter({ name: "callId", value: callId });
  stream.parameter({ name: "token", value: bdrStreamToken(callId) });
  xml.hangup();
  return new Response(xml.toString(), { headers: { "Content-Type": "text/xml" } });
}
