import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod/v4";
import { getCampaign } from "@/lib/voice-campaign-store";
import { recordInboundEvent, findMatchingCall } from "@/lib/inbound-event-store";

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

function verifySignature(rawBody: string, secret: string, sig: string): boolean {
  if (!sig.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  // Pad to equal length before timingSafeEqual to prevent length-based timing attacks
  const a = Buffer.from(sig.padEnd(expected.length, "\0"));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

const PayloadSchema = z.object({
  event:     z.string().trim().min(1).max(120),
  phone:     z.string().trim().min(6).max(32),
  timestamp: z.string().datetime().optional(),
  metadata:  z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Route handler — public, auth via HMAC
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const campaignId = req.headers.get("x-actioneer-campaign-id")?.trim();
  if (!campaignId) {
    return Response.json(
      { error: "X-Actioneer-Campaign-Id header is required." },
      { status: 400 },
    );
  }

  // Read body as text first — needed for signature verification
  const rawBody = await req.text();

  const campaign = getCampaign(campaignId);
  if (!campaign) {
    // Return 200 to avoid leaking campaign existence to unauthenticated callers.
    // The signature check below will also fail since there's no secret.
    return Response.json({ received: true, matched: false }, { status: 200 });
  }

  const secret = campaign.webhookSecret;
  if (!secret) {
    return Response.json(
      { error: "Webhook secret not configured for this campaign. Generate one in Success Metrics → In your system." },
      { status: 403 },
    );
  }

  const sig = req.headers.get("x-actioneer-signature") ?? "";
  if (!verifySignature(rawBody, secret, sig)) {
    return Response.json({ error: "Signature verification failed." }, { status: 401 });
  }

  let payload: z.infer<typeof PayloadSchema>;
  try {
    payload = PayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  const timestamp  = payload.timestamp ?? new Date().toISOString();
  const windowDays = campaign.successDefinition?.attributionWindowDays ?? 7;
  const calls      = Array.isArray(campaign.calls) ? campaign.calls : [];

  const matchedCallId = findMatchingCall(payload.phone, calls, windowDays, timestamp);

  const ev = recordInboundEvent({
    campaignId,
    event:       payload.event,
    phone:       payload.phone,
    timestamp,
    matchedCallId,
  });

  return Response.json(
    { received: true, eventId: ev.id, matched: !!matchedCallId, callId: matchedCallId ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
