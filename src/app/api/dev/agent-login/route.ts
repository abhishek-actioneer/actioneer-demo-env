import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Dev-only programmatic sign-in for headless agents (Cursor Cloud, Playwright, etc).
// Mints a one-time Clerk Sign-In Token for CURSOR_AGENT_USER_ID, then redirects to
// /auth/agent-consume which exchanges the ticket for a real session cookie.
//
// Hard-locked: refuses unless NODE_ENV !== "production" AND a matching secret is
// provided. Both must be true. Production deploys must NOT have AGENT_LOGIN_SECRET
// or CURSOR_AGENT_USER_ID set.

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("disabled in production", { status: 404 });
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get("secret");
  const expected = process.env.AGENT_LOGIN_SECRET;
  if (!expected || !provided || provided !== expected) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const userId = process.env.CURSOR_AGENT_USER_ID;
  if (!userId) {
    return new NextResponse("CURSOR_AGENT_USER_ID not set", { status: 500 });
  }

  try {
    const client = await clerkClient();
    const ticket = await client.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 600,
    });
    return NextResponse.redirect(
      new URL(`/auth/agent-consume?ticket=${encodeURIComponent(ticket.token)}`, req.url),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return new NextResponse(`failed to mint sign-in token: ${message}`, { status: 500 });
  }
}
