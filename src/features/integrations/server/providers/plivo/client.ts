import { requirePublicBaseUrl } from "@/lib/public-base-url";
import { dumpVoiceOutboundPayload, updateVoiceOutboundDump } from "@/lib/voice-debug-dump";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function ensurePlivoConfig(): void {
  requireEnv("PLIVO_AUTH_ID");
  requireEnv("PLIVO_AUTH_TOKEN");
  requireEnv("PLIVO_PHONE_NUMBER");
  requirePublicBaseUrl();
}

function baseUrl(): string {
  return requirePublicBaseUrl();
}

function plivoAuthHeader(): string {
  const token = Buffer.from(`${requireEnv("PLIVO_AUTH_ID")}:${requireEnv("PLIVO_AUTH_TOKEN")}`).toString("base64");
  return `Basic ${token}`;
}

export async function initiatePlivoCall(toNumber: string, callId: string): Promise<string> {
  ensurePlivoConfig();
  const authId = requireEnv("PLIVO_AUTH_ID");
  const base = baseUrl();
  const url = `https://api.plivo.com/v1/Account/${encodeURIComponent(authId)}/Call/`;
  const body = {
    from: requireEnv("PLIVO_PHONE_NUMBER"),
    to: toNumber,
    answer_url: `${base}/api/voice/plivo-answer?callId=${encodeURIComponent(callId)}`,
    answer_method: "GET",
    hangup_url: `${base}/api/voice/plivo-status?callId=${encodeURIComponent(callId)}`,
    hangup_method: "POST",
  };
  const dumpStorageKey = dumpVoiceOutboundPayload({
    endpoint: "plivo-call-start",
    url,
    identityParts: [callId],
    payload: {
      callId,
      body,
    },
  });
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: plivoAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    updateVoiceOutboundDump({
      dumpStorageKey,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "Plivo call request failed",
    });
    throw err;
  }

  const text = await res.text();
  let responseBody: unknown = text;
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch {
    responseBody = text;
  }

  updateVoiceOutboundDump({
    dumpStorageKey,
    durationMs: Date.now() - startedAt,
    status: res.status,
    ok: res.ok,
    body: responseBody,
  });

  if (!res.ok) {
    throw new Error(`Plivo call failed (${res.status}): ${text || res.statusText}`);
  }

  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    throw new Error(`Plivo call returned invalid JSON: ${text}`);
  }
  const parsed = responseBody as { request_uuid?: unknown; message?: unknown };

  if (typeof parsed.request_uuid === "string" && parsed.request_uuid) return parsed.request_uuid;
  if (typeof parsed.message === "string") return parsed.message;
  return callId;
}

export async function terminatePlivoCall(callUuid: string): Promise<void> {
  ensurePlivoConfig();
  const authId = requireEnv("PLIVO_AUTH_ID");
  const cleanCallUuid = callUuid.trim();
  if (!cleanCallUuid) throw new Error("callUuid is required to terminate Plivo call");

  const url = `https://api.plivo.com/v1/Account/${encodeURIComponent(authId)}/Call/${encodeURIComponent(cleanCallUuid)}/`;
  const dumpStorageKey = dumpVoiceOutboundPayload({
    endpoint: "plivo-call-terminate",
    url,
    identityParts: [cleanCallUuid],
    payload: { callUuid: cleanCallUuid },
  });
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: plivoAuthHeader(),
      },
    });
  } catch (err) {
    updateVoiceOutboundDump({
      dumpStorageKey,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "Plivo terminate request failed",
    });
    throw err;
  }

  const text = await res.text();
  let responseBody: unknown = text;
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch {
    responseBody = text;
  }

  updateVoiceOutboundDump({
    dumpStorageKey,
    durationMs: Date.now() - startedAt,
    status: res.status,
    ok: res.ok,
    body: responseBody,
  });

  if (!res.ok) {
    throw new Error(`Plivo terminate failed (${res.status}): ${text || res.statusText}`);
  }
}
