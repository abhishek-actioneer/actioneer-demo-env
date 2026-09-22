import { recordEmailEvent } from "@/lib/server/email-event-repo";
import { verifyDestination } from "@/lib/email-tracking";

/**
 * Click tracking redirect.
 *
 *   GET /api/r/c/{campaignId}/{variantId}/{userId}?to={url}&s={sig}
 *
 * Logs the click then 302s to the original destination. The destination is
 * HMAC-signed to prevent the endpoint from being abused as an open redirect.
 *
 * Public route — must be allowed in middleware.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ campaignId: string; variantId: string; userId: string }> },
) {
  const { campaignId, variantId, userId } = await params;
  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  const sig = url.searchParams.get("s");

  if (!to || !sig || !verifyDestination(to, sig)) {
    return new Response("Invalid tracking link", { status: 400 });
  }

  const decodedUserId =
    userId && userId !== "anon" ? decodeURIComponent(userId) : null;

  // Fire-and-forget log; never block the redirect on DB writes.
  try {
    recordEmailEvent({
      campaignId: decodeURIComponent(campaignId),
      userId: decodedUserId,
      variantId: decodeURIComponent(variantId),
      eventType: "click",
      url: to,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[track/click] log failed:", err);
  }

  return Response.redirect(to, 302);
}
