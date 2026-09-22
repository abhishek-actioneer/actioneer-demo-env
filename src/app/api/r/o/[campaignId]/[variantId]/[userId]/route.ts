import { recordEmailEvent } from "@/lib/server/email-event-repo";

/**
 * Open tracking pixel.
 *
 *   GET /api/r/o/{campaignId}/{variantId}/{userId}
 *
 * Returns a 1×1 transparent GIF and logs the open. Always responds 200 with
 * the pixel — never error out, since a broken pixel is visible to recipients.
 *
 * Caveats:
 *   - Apple Mail Privacy Protection (iOS 15+) pre-fetches images regardless
 *     of whether the user opened the email. Treat opens as DIRECTIONAL, not
 *     absolute. Variant-vs-variant comparisons remain valid.
 *   - Some corporate spam filters pre-fetch images. Optionally filter by UA.
 *
 * Public route — must be allowed in middleware.
 */

// 43-byte 1×1 transparent GIF.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ campaignId: string; variantId: string; userId: string }> },
) {
  const { campaignId, variantId, userId } = await params;
  const decodedUserId =
    userId && userId !== "anon" ? decodeURIComponent(userId) : null;

  try {
    recordEmailEvent({
      campaignId: decodeURIComponent(campaignId),
      userId: decodedUserId,
      variantId: decodeURIComponent(variantId),
      eventType: "open",
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[track/open] log failed:", err);
  }

  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
