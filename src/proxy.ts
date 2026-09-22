import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
// Cache-bust: force Railway to rebuild with env vars

const isPublicRoute = createRouteMatcher([
  "/auth(.*)",
  "/data-asks/(.*)",
  "/api/health",
  // Synthetic tick endpoint authenticates via x-cron-secret header for scheduled
  // cron jobs (no Clerk session). Internal handler also accepts admin allowlist.
  "/api/admin/synthetic/(.*)",
  // Slack slash command — verifies its own signature via SLACK_SIGNING_SECRET.
  "/api/agent/slack",
  // Dev-only programmatic agent sign-in. Self-guards on NODE_ENV !== "production"
  // AND a secret query param. /auth/agent-consume is already covered by /auth(.*).
  "/api/dev/agent-login",
  // Twilio calls these endpoints without a Clerk session.
  "/api/voice/twiml",
  "/api/voice/status",
  "/api/voice/stream-status",
  "/api/voice/recording",
  "/api/voice/plivo-answer",
  "/api/voice/plivo-answer-inbound",
  "/api/voice/plivo-status",
  "/api/voice/plivo-stream-status",
  "/api/voice/probe-answer",
  "/media-stream",
  "/plivo-media-stream(.*)",
  "/plivo-probe-stream",
  "/voice-live-transcribe",
  "/voice-test-stream",
  // First-party email tracking endpoints — must be reachable from recipients'
  // mail clients without auth. Click endpoint validates HMAC on destination URL;
  // open endpoint just records and returns a 1×1 GIF.
  "/api/r/c/(.*)",
  "/api/r/o/(.*)",
  // Voice-campaign attribution click redirect — hit by customers' phones from
  // WhatsApp/SMS follow-up links, no Clerk session. Bot-UA filtered internally.
  "/api/t/(.*)",
  // Inbound "In your system" webhook — called by the client's own backend,
  // authenticated via per-campaign HMAC signature, not a Clerk session.
  "/api/events/inbound",
  // Outbound WhatsApp media. Gupshup fetches this server-side with no
  // credentials before handing the file to Meta, so it cannot carry a Clerk
  // session. Keys are opaque paths under one private S3 prefix.
  "/api/whatsapp-media/(.*)",
  // Gupshup WhatsApp delivery-status + inbound-message webhook. Called by
  // Gupshup's servers, no Clerk session possible; authenticates itself via
  // GUPSHUP_WHATSAPP_WEBHOOK_SECRET inside the route handler.
  "/api/webhooks/gupshup/whatsapp",
]);

// Routes exempt from onboarding check (user must be authed but may not have completed onboarding)
const isOnboardingExempt = createRouteMatcher([
  "/onboarding(.*)",
  "/api/onboarding(.*)",
  "/api/datasets/upload",
  "/api/datasets/(.*)/enrich",
]);

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;

  // Redirect legacy /sign-in and /sign-up to /auth
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  if (isPublicRoute(request)) return;

  // Protect all non-public routes (requires authentication)
  await auth.protect();

  // Server-side onboarding gate — redirect non-onboarded users
  // Skip for onboarding routes themselves and dataset upload/enrich (used during onboarding)
  if (!isOnboardingExempt(request) && !isPublicRoute(request)) {
    const { sessionClaims } = await auth();
    const metadata = sessionClaims?.metadata as { onboardingComplete?: boolean } | undefined;

    // Only enforce if Clerk session token is configured to include publicMetadata.
    // If metadata key is absent (not configured in Clerk Dashboard), skip — client-side
    // OnboardingGate remains the primary guard. This prevents blocking all users when
    // the session token template hasn't been set up yet.
    if (metadata && !metadata.onboardingComplete) {
      // API routes get 403 JSON (not a redirect, which breaks apiFetch)
      if (pathname.startsWith("/api/")) {
        return new NextResponse(
          JSON.stringify({ error: "Onboarding required" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      // Page routes get redirected
      return NextResponse.redirect(new URL("/onboarding/account", request.url));
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
