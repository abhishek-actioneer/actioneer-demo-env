import { getAttributionRecord, recordClick } from "@/lib/attribution-store";
import { findCallByAnyIdentity } from "@/lib/voice-campaign-store";
import { markContactActionEventsResolved } from "@/lib/customer-channel-memory";

// ---------------------------------------------------------------------------
// Bot detection
// ---------------------------------------------------------------------------

// WhatsApp pre-fetches every URL before the user taps it — must be filtered or
// every WA follow-up would immediately register as "attributed".
const BOT_UA_PATTERNS = [
  /WhatsApp\/\d/i,
  /facebookexternalhit/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Slackbot/i,
  /TelegramBot/i,
  /Googlebot/i,
  /bingbot/i,
  /DuckDuckBot/i,
  /YandexBot/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /axios\//i,
  /Go-http-client/i,
  /okhttp\//i,
  /libwww-perl/i,
  /Jakarta/i,
  /Scrapy/i,
];

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return true; // no UA → almost certainly automated
  return BOT_UA_PATTERNS.some((p) => p.test(userAgent));
}

// ---------------------------------------------------------------------------
// UTM injection
// ---------------------------------------------------------------------------

function injectUtm(dest: string, token: string, channel: string): string {
  try {
    const url = new URL(dest);
    if (!url.searchParams.has("utm_source")) url.searchParams.set("utm_source", "actioneer_voice");
    if (!url.searchParams.has("utm_medium"))   url.searchParams.set("utm_medium", channel);
    if (!url.searchParams.has("utm_campaign")) url.searchParams.set("utm_campaign", token.slice(0, 8));
    return url.toString();
  } catch {
    return dest; // dest is not a valid URL — redirect as-is
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Validate token format before hitting the store
  if (!/^[A-Za-z0-9_-]{8,20}$/.test(token)) {
    return new Response("Not found.", { status: 404 });
  }

  const record = getAttributionRecord(token);

  if (!record) {
    return new Response("Link not found.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (new Date() > new Date(record.token.expiresAt)) {
    return new Response("This link has expired.", {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const ua = req.headers.get("user-agent");
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;

  const bot = isBot(ua);
  const { isFirstHuman } = recordClick(token, { isBot: bot, userAgent: ua ?? undefined, ip });

  if (isFirstHuman) {
    const found = findCallByAnyIdentity([record.token.callId]);
    if (found?.call.toNumber && found?.campaign.userId) {
      markContactActionEventsResolved(found.campaign.userId, found.call.toNumber);
    }
  }

  const destUrl = injectUtm(record.token.dest, token, record.token.channel);

  return Response.redirect(destUrl, 302);
  // 302 (not 301) — attribution links must never be cached by the browser.
  // A cached 301 would bypass click recording on repeat visits.
}
