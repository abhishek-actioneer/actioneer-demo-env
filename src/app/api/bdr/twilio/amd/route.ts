import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";
import { BDR_AMD_RESULTS } from "@/lib/bdr/answer-mode";
import { updateBdrCall } from "@/lib/bdr/store";
import { TERMINAL_BDR_STATUSES } from "@/lib/bdr/telephony";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!verifyTwilioWebhookSignature(req, params) || params.AccountSid !== process.env.TWILIO_ACCOUNT_SID) return new Response("Forbidden", { status: 403 });
  const callId = new URL(req.url).searchParams.get("callId") || "";
  if (callId && params.CallSid && BDR_AMD_RESULTS.some((value) => value === params.AnsweredBy)) {
    updateBdrCall(callId, (row) => {
      if ((row.providerSid && row.providerSid !== params.CallSid) || TERMINAL_BDR_STATUSES.has(row.status)) return;
      // The durable value crosses Next's route bundle/custom-server boundary.
      // Duplicate callbacks are idempotent; polling never redials a contact.
      row.providerSid = params.CallSid;
      row.answeredBy = params.AnsweredBy;
    });
  }
  return new Response(null, { status: 204 });
}
