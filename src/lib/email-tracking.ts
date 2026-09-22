import crypto from "node:crypto";

/**
 * First-party email tracking. Rewrites outbound email HTML to:
 *   1. Route every <a href> through our /api/r/c redirect (click tracking)
 *   2. Append a 1×1 pixel pointing at /api/r/o (open tracking)
 *
 * Per-recipient identity is interpolated by CleverTap at render time using
 * its merge-tag syntax, so a single bulk send still produces per-user events.
 *
 * Click destination URLs are HMAC-signed to prevent the redirector from being
 * abused as an open-redirect (would let attackers craft phishing URLs that
 * redirect through our trusted domain).
 *
 * Configuration via env:
 *   TRACKING_BASE_URL  — public origin where /api/r/* is reachable. If unset,
 *                        rewrite is a no-op (returns the original HTML). Useful
 *                        for local dev where there's no public URL.
 *   TRACKING_SECRET    — HMAC key for click signatures. Falls back to a dev
 *                        constant; set to a real secret in production.
 *
 * CleverTap merge tag for the recipient identity is injected literally; if your
 * CleverTap plan uses a different macro syntax (e.g. `{{User.Email}}` instead
 * of `{{profile.identity}}`), update CLEVERTAP_IDENTITY_MACRO below.
 */

const SIG_LEN = 22; // first 22 chars of base64url HMAC = 132 bits, plenty
const DEV_SECRET = "baby-sentinel-dev-tracking-secret-change-in-prod";

// CleverTap's campaign creation API rejects personalization tokens like
// {{ profile.* }} on Trial / lower-tier plans ("Personalization is unavailable
// in campaign creation API"). Until we either (a) move to a plan that allows
// it, (b) switch to CleverTap's transactional API for per-recipient sends, or
// (c) replace CleverTap with direct SMTP (Resend/Postmark), we use a static
// token. Result: aggregate sent/open/click counts work correctly, but we
// cannot attribute individual events to specific recipients.
const CLEVERTAP_IDENTITY_MACRO = "anon";

export function trackingBaseUrl(): string {
  return (process.env.TRACKING_BASE_URL ?? "").replace(/\/$/, "");
}

function trackingSecret(): string {
  return process.env.TRACKING_SECRET ?? DEV_SECRET;
}

export function signDestination(url: string): string {
  return crypto
    .createHmac("sha256", trackingSecret())
    .update(url)
    .digest("base64url")
    .slice(0, SIG_LEN);
}

export function verifyDestination(url: string, sig: string): boolean {
  if (!sig || sig.length !== SIG_LEN) return false;
  const expected = signDestination(url);
  // timingSafeEqual requires equal length; we already checked
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

export interface RewriteContext {
  campaignId: string;
  variantId?: string;
}

/**
 * Rewrite an HTML email body for first-party tracking.
 * Returns the HTML unchanged if TRACKING_BASE_URL is not configured.
 */
export function rewriteForTracking(html: string, ctx: RewriteContext): string {
  const base = trackingBaseUrl();
  if (!base) return html;

  const variantId = ctx.variantId ?? "default";
  const userToken = CLEVERTAP_IDENTITY_MACRO;

  // 1. Wrap <a href="..."> links. Skip mailto:, tel:, in-page #anchors, and
  //    anything that already looks like a CleverTap merge tag (don't double-wrap).
  const wrapped = html.replace(
    /<a\b([^>]*?)\shref=(["'])([^"']+)\2([^>]*)>/gi,
    (full, pre: string, _q: string, href: string, post: string) => {
      if (/^(mailto:|tel:|#|\{\{|javascript:)/i.test(href.trim())) return full;
      const sig = signDestination(href);
      const tracked =
        `${base}/api/r/c/${encodeURIComponent(ctx.campaignId)}/${encodeURIComponent(variantId)}/${userToken}` +
        `?to=${encodeURIComponent(href)}&s=${sig}`;
      return `<a${pre} href="${tracked}"${post}>`;
    },
  );

  // 2. Append open pixel before </body>, or at the end if no body tag.
  const pixelUrl =
    `${base}/api/r/o/${encodeURIComponent(ctx.campaignId)}/${encodeURIComponent(variantId)}/${userToken}`;
  const pixelTag =
    `<img src="${pixelUrl}" width="1" height="1" alt="" ` +
    `style="display:block;border:0;outline:none;width:1px;height:1px" />`;

  if (/<\/body>/i.test(wrapped)) {
    return wrapped.replace(/<\/body>/i, `${pixelTag}</body>`);
  }
  return `${wrapped}${pixelTag}`;
}
