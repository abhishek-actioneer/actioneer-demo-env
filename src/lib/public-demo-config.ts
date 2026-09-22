/**
 * Env + binding helpers for the public inbound demo router.
 */

import { getLiveInboundBinding, getInboundBinding } from "./inbound-agent-store";

/** When true, inbound answer uses the combined router+persona system prompt. */
export function isPublicDemoInboundEnabled(): boolean {
  const raw = process.env.PUBLIC_DEMO_INBOUND_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Phone number to show on the public /try page.
 * Prefer explicit env; else the currently live inbound binding.
 */
export function resolvePublicDemoInboundNumber(): string | undefined {
  const fromEnv = process.env.PUBLIC_DEMO_INBOUND_NUMBER?.trim();
  if (fromEnv) return fromEnv;
  const live = getLiveInboundBinding();
  return live?.number;
}

/** True when this dialed DID should run the public demo router. */
export function shouldUsePublicDemoRouter(toNumber?: string): boolean {
  if (!isPublicDemoInboundEnabled()) return false;
  const configured = process.env.PUBLIC_DEMO_INBOUND_NUMBER?.trim();
  if (!configured) {
    // No number pin — any inbound answer while the flag is on uses the router
    // (typical single-DID demo setups).
    return true;
  }
  if (!toNumber) return false;
  const a = configured.replace(/\D/g, "");
  const b = toNumber.replace(/\D/g, "");
  if (a && b && (a === b || a.endsWith(b) || b.endsWith(a))) return true;
  // Also accept if the live binding matches.
  const binding = getInboundBinding(toNumber);
  return Boolean(binding?.live);
}

/** Stable callId key for the always-on Gemini standby session for the demo DID. */
export const PUBLIC_DEMO_STANDBY_CALL_ID = "public-demo-inbound-standby";
