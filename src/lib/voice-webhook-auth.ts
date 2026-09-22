import twilio from "twilio";
import {
  formDataToParamMap,
  type PlivoParamMap,
  verifyPlivoV2Signature,
  verifyPlivoV3Signature,
} from "./plivo-webhook-signature";
import { resolvePublicBaseUrl } from "./public-base-url";

function allowUnsignedWebhookForDev(): boolean {
  if (process.env.VOICE_FORCE_WEBHOOK_VERIFY === "1") return false;
  return process.env.VOICE_ALLOW_UNSIGNED_WEBHOOKS === "1" && process.env.NODE_ENV !== "production";
}

export function requestPathAndSearch(req: Request): string {
  try {
    const incoming = new URL(req.url);
    return `${incoming.pathname}${incoming.search}`;
  } catch {
    const raw = req.url.trim();
    if (!raw) return "/";
    const withoutHash = raw.split("#")[0] ?? raw;
    return withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
  }
}

function candidateUrls(req: Request): string[] {
  const urls: string[] = [];
  const pathAndSearch = requestPathAndSearch(req);

  try {
    urls.push(new URL(req.url).toString());
  } catch {
    // Custom Node servers (e.g. Railway) sometimes pass a path-only req.url.
  }

  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = req.headers.get("host")?.split(",")[0]?.trim();
  const host = forwardedHost || hostHeader;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host) {
    const proto =
      forwardedProto ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    urls.push(new URL(pathAndSearch, `${proto}://${host}`).toString());
  }

  const publicBase = resolvePublicBaseUrl(req);
  if (publicBase) {
    urls.push(new URL(pathAndSearch, publicBase).toString());
  }

  for (const url of [...urls]) {
    try {
      const parsed = new URL(url);
      if (
        (parsed.protocol === "https:" && parsed.port === "443") ||
        (parsed.protocol === "http:" && parsed.port === "80")
      ) {
        parsed.port = "";
        urls.push(parsed.toString());
      }
    } catch {
      // ignore malformed candidate
    }
  }

  return Array.from(new Set(urls));
}

function plivoCandidateUrls(req: Request): string[] {
  const urls = candidateUrls(req);
  const publicUrls = urls.filter((url) => {
    try {
      const host = new URL(url).hostname;
      return host !== "localhost" && host !== "127.0.0.1" && host !== "0.0.0.0";
    } catch {
      return false;
    }
  });
  return publicUrls.length > 0 ? publicUrls : urls;
}

export function verifyTwilioWebhookSignature(
  req: Request,
  params: Record<string, string>,
): boolean {
  if (allowUnsignedWebhookForDev()) return true;

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const signature = req.headers.get("x-twilio-signature")?.trim();
  if (!authToken || !signature) return false;

  return candidateUrls(req).some((url) =>
    twilio.validateRequest(authToken, signature, url, params)
  );
}

export async function verifyPlivoWebhookSignature(
  req: Request,
  postParams?: PlivoParamMap,
): Promise<boolean> {
  if (allowUnsignedWebhookForDev()) return true;

  const authToken = process.env.PLIVO_AUTH_TOKEN?.trim();
  if (!authToken) {
    console.warn("[voice/plivo-auth] PLIVO_AUTH_TOKEN is not set");
    return false;
  }

  const v3Signature =
    req.headers.get("x-plivo-signature-v3")?.trim() ||
    req.headers.get("x-plivo-signature-ma-v3")?.trim();
  const v3Nonce = req.headers.get("x-plivo-signature-v3-nonce")?.trim();
  const v2Signature =
    req.headers.get("x-plivo-signature-v2")?.trim() ||
    req.headers.get("x-plivo-signature-ma-v2")?.trim();
  const v2Nonce = req.headers.get("x-plivo-signature-v2-nonce")?.trim();

  let bodyParams = postParams;
  if (!bodyParams && req.method.toUpperCase() === "POST") {
    try {
      const cloned = req.clone();
      const formData = await cloned.formData();
      bodyParams = formDataToParamMap(formData);
    } catch {
      bodyParams = {};
    }
  }

  const urls = plivoCandidateUrls(req);
  const method = req.method.toUpperCase();

  if (v3Signature && v3Nonce) {
    const ok = urls.some((uri) =>
      verifyPlivoV3Signature(method, uri, v3Nonce, authToken, v3Signature, bodyParams ?? {}),
    );
    if (ok) return true;
  }

  if (v2Signature && v2Nonce) {
    const ok = urls.some((uri) =>
      verifyPlivoV2Signature(uri, v2Nonce, authToken, v2Signature),
    );
    if (ok) return true;
  }

  if (!v3Signature && !v2Signature) {
    console.warn("[voice/plivo-auth] Missing Plivo signature headers");
  } else if (!v3Nonce && !v2Nonce) {
    console.warn("[voice/plivo-auth] Missing Plivo signature nonce header (expected X-Plivo-Signature-V3-Nonce or X-Plivo-Signature-V2-Nonce)");
  } else {
    console.warn(
      `[voice/plivo-auth] Signature mismatch for ${method} ${requestPathAndSearch(req)} — tried ${urls.length} URL candidate(s) with ${v3Signature ? "V3" : "V2"}`,
    );
  }
  return false;
}

export function withVoiceWebhookSecret(url: string): string {
  return url;
}
