import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";

// Twilio sends Media Stream lifecycle and error callbacks here. This is separate
// from /api/voice/status, which is the parent call status callback.
export async function POST(req: Request) {
  const formData = await req.formData();
  const params = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
  );
  if (!verifyTwilioWebhookSignature(req, params)) {
    return new Response("Forbidden", { status: 403 });
  }
  const streamSid = formData.get("StreamSid");
  const callSid = formData.get("CallSid");
  const streamEvent = formData.get("StreamEvent");
  const streamError = formData.get("StreamError");

  console.log(
    `[voice/stream-status] StreamSid=${streamSid ?? "(missing)"} CallSid=${callSid ?? "(missing)"} event=${streamEvent ?? "(missing)"}` +
      (streamError ? ` error=${streamError}` : ""),
  );

  return new Response(null, { status: 200 });
}
