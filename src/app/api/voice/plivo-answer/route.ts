import { resolvePlivoStreamBaseUrl, resolvePublicBaseUrl, toWebSocketUrl } from "@/lib/public-base-url";
import { refreshGeminiPrewarmOnAnswer } from "@/lib/plivo-gemini-live-bridge";
import { dumpVoiceRequestMetadata, updateVoiceDump } from "@/lib/voice-debug-dump";
import { requestPathAndSearch, verifyPlivoWebhookSignature } from "@/lib/voice-webhook-auth";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function plivoXmlResponse(req: Request): Promise<Response> {
  if (!(await verifyPlivoWebhookSignature(req))) {
    console.warn(`[voice/plivo-answer] rejected — Plivo signature verification failed (${requestPathAndSearch(req)})`);
    return new Response("Forbidden", { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const callId = searchParams.get("callId") ?? "";
  const dumpStorageKey = dumpVoiceRequestMetadata({ req, endpoint: "plivo-answer" });
  let baseUrl: string | undefined;
  let streamBaseUrl: string | undefined;

  try {
    baseUrl = resolvePublicBaseUrl(req);
    streamBaseUrl = resolvePlivoStreamBaseUrl(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Public base URL is invalid";
    console.error(`[voice/plivo-answer] ${message}`);
    updateVoiceDump({
      dumpStorageKey,
      patch: {
        response: {
          generatedAt: new Date().toISOString(),
          status: 500,
          error: message,
        },
      },
    });
    return new Response(message, { status: 500 });
  }

  if (!baseUrl || !streamBaseUrl) {
    updateVoiceDump({
      dumpStorageKey,
      patch: {
        response: {
          generatedAt: new Date().toISOString(),
          status: 500,
          error: "Public base URL is not configured",
        },
      },
    });
    return new Response("Public base URL is not configured", { status: 500 });
  }

  const streamUrl = toWebSocketUrl(streamBaseUrl, `/plivo-media-stream/${encodeURIComponent(callId)}`);
  const statusCallbackUrl = `${baseUrl}/api/voice/plivo-stream-status`;
  if (callId) refreshGeminiPrewarmOnAnswer(callId);
  console.log(`[voice/plivo-answer] callId=${callId || "(missing)"} streamUrl=${streamUrl} epochMs=${Date.now()}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" statusCallbackUrl="${xmlEscape(statusCallbackUrl)}" statusCallbackMethod="POST">${xmlEscape(streamUrl)}</Stream>
</Response>`;

  updateVoiceDump({
    dumpStorageKey,
    patch: {
      response: {
        generatedAt: new Date().toISOString(),
        status: 200,
        callId,
        streamUrl,
        statusCallbackUrl,
        contentType: "text/xml",
      },
    },
  });

  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: Request) { return plivoXmlResponse(req); }
export async function POST(req: Request) { return plivoXmlResponse(req); }
