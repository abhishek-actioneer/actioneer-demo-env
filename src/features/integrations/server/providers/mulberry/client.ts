import { requirePublicBaseUrl } from "@/lib/public-base-url";
import type { MulberryRuntimeContext } from "./payload";

const DEFAULT_START_URL = "https://13-232-38-175.sslip.io";

export function mulberryStartUrl(): string {
  const raw = (process.env.MULBERRY_START_URL || DEFAULT_START_URL).replace(/\/+$/, "");
  return `${raw}/start`;
}

/** Public URL Mulberry POSTs the post-call result to. */
export function mulberryCallbackUrl(): string | undefined {
  try {
    return `${requirePublicBaseUrl()}/api/voice/mulberry-postcall`;
  } catch {
    // No public base URL configured (e.g. missing tunnel) — omit callback; the
    // call still runs, we just won't receive transcript/recording automatically.
    return undefined;
  }
}

export function mulberryCallbackSecret(): string | undefined {
  return process.env.MULBERRY_WEBHOOK_SECRET || undefined;
}

export function ensureMulberryConfig(): void {
  // START_URL has a sane default; nothing is strictly required to place a call.
  // The callback (transcript/recording) needs a public base URL, but we degrade
  // gracefully without it, so we don't hard-fail here.
  if (!process.env.MULBERRY_START_URL && !DEFAULT_START_URL) {
    throw new Error("MULBERRY_START_URL is not set");
  }
}

interface MulberryStartResponse {
  status?: string;
  request_uuid?: string;
  tts?: string;
  error?: string;
  message?: string;
}

/**
 * Fire the external Mulberry runtime for one call. Returns Mulberry's
 * `request_uuid`, which we persist onto the VoiceCall as `providerRequestId`
 * so the post-call webhook can reconcile the result back to this call.
 */
export async function startMulberryCall(context: MulberryRuntimeContext): Promise<string> {
  ensureMulberryConfig();
  const url = mulberryStartUrl();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    throw new Error(`Mulberry /start request failed: ${message}`);
  }

  const bodyText = await res.text();
  let body: MulberryStartResponse = {};
  try {
    body = bodyText ? (JSON.parse(bodyText) as MulberryStartResponse) : {};
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const detail = body.error || body.message || bodyText.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`Mulberry /start returned ${res.status}: ${detail}`);
  }

  const requestId = body.request_uuid;
  if (!requestId) {
    throw new Error(`Mulberry /start returned no request_uuid (status=${body.status ?? "?"})`);
  }

  console.info("[voice/mulberry] call started", {
    callId: context.call.callId,
    requestId,
    status: body.status,
    tts: body.tts,
  });

  return requestId;
}
