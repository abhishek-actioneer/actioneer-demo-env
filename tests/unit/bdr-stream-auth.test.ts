import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { IncomingMessage } from "node:http";
import twilio from "twilio";
import { authorizeBdrUpgrade } from "@/lib/bdr/bridge";

const mocks = vi.hoisted(() => ({ protect: vi.fn() }));

vi.mock("@clerk/nextjs/server", async (original) => {
  const clerk = await original<typeof import("@clerk/nextjs/server")>();
  return {
    ...clerk,
    clerkMiddleware: (handler: (auth: unknown, request: NextRequest) => unknown) =>
      (request: NextRequest) => handler(Object.assign(
        async () => ({ sessionClaims: {} }), { protect: mocks.protect },
      ), request),
  };
});

import proxy from "@/proxy";

// Exercise the real route matcher with an unauthenticated request. Next.js
// also invokes this middleware while routing custom-server WebSocket upgrades.
const runProxy = proxy as unknown as (request: NextRequest) => Promise<unknown>;

beforeEach(() => { mocks.protect.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("BDR WebSocket authentication boundary", () => {
  it.each(["/bdr-media-stream", "/api/bdr/twilio/answer", "/api/bdr/twilio/status", "/api/bdr/twilio/amd"])(
    "does not send Twilio through browser login at %s", async (path) => {
      await runProxy(new NextRequest(`https://example.com${path}`));
      expect(mocks.protect).not.toHaveBeenCalled();
    },
  );

  it.each(["/bdr", "/api/bdr", "/api/bdr/campaigns", "/bdr-media-stream-other"])(
    "still requires browser authentication at %s", async (path) => {
      await runProxy(new NextRequest(`https://example.com${path}`));
      expect(mocks.protect).toHaveBeenCalledOnce();
    },
  );

  it("requires a valid Twilio signature even though browser login is skipped", () => {
    vi.stubEnv("VOICE_PUBLIC_BASE_URL", "https://example.com");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
    const request = (signature?: string) => ({
      headers: signature ? { "x-twilio-signature": signature } : {},
    }) as IncomingMessage;
    expect(authorizeBdrUpgrade(request())).toBe(false);
    expect(authorizeBdrUpgrade(request("invalid"))).toBe(false);
    const signature = twilio.getExpectedTwilioSignature(
      "test-auth-token", "https://example.com/bdr-media-stream", {},
    );
    expect(authorizeBdrUpgrade(request(signature))).toBe(true);
  });
});
