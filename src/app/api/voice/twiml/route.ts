import { resolvePublicBaseUrl, toWebSocketUrl } from "@/lib/public-base-url";
import { verifyTwilioWebhookSignature } from "@/lib/voice-webhook-auth";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Twilio fetches this URL when a call connects. Returns TwiML that opens a media stream
// to our WebSocket server, where the OpenAI Realtime bridge takes over.
function twimlResponse(req: Request): Response {
  const { searchParams } = new URL(req.url);
  const callId = searchParams.get("callId") ?? "";
  let baseUrl: string | undefined;

  try {
    baseUrl = resolvePublicBaseUrl(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Public base URL is invalid";
    console.error(`[voice/twiml] ${message}`);
    return new Response(message, { status: 500 });
  }

  if (!baseUrl) {
    return new Response("Public base URL is not configured", { status: 500 });
  }

  const streamUrl = toWebSocketUrl(baseUrl, "/media-stream");
  const statusCallbackUrl = `${baseUrl}/api/voice/stream-status`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEscape(streamUrl)}" statusCallback="${xmlEscape(statusCallbackUrl)}" statusCallbackMethod="POST">
      <Parameter name="callId" value="${xmlEscape(callId)}" />
    </Stream>
  </Connect>
</Response>`;

  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

// Twilio may send either GET or POST depending on its configuration.
export async function GET(req: Request) {
  // GET signature covers full URL including query params.
  if (!verifyTwilioWebhookSignature(req, {})) {
    return new Response("Forbidden", { status: 403 });
  }
  return twimlResponse(req);
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const params = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
  );
  if (!verifyTwilioWebhookSignature(req, params)) {
    return new Response("Forbidden", { status: 403 });
  }
  return twimlResponse(req);
}
