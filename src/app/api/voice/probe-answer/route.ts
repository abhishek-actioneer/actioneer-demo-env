import { resolvePlivoStreamBaseUrl, resolvePublicBaseUrl, toWebSocketUrl } from "@/lib/public-base-url";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function probeXmlResponse(req: Request): Response {
  let baseUrl: string | undefined;
  let streamBaseUrl: string | undefined;

  try {
    baseUrl = resolvePublicBaseUrl(req);
    streamBaseUrl = resolvePlivoStreamBaseUrl(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Public base URL is invalid";
    console.error(`[voice/probe-answer] ${message}`);
    return new Response(message, { status: 500 });
  }

  if (!baseUrl || !streamBaseUrl) {
    return new Response("Public base URL is not configured", { status: 500 });
  }

  const streamUrl = toWebSocketUrl(streamBaseUrl, "/plivo-probe-stream");
  const statusCallbackUrl = `${baseUrl}/api/voice/plivo-stream-status`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" statusCallbackUrl="${xmlEscape(statusCallbackUrl)}" statusCallbackMethod="POST">${xmlEscape(streamUrl)}</Stream>
</Response>`;

  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

export async function GET(req: Request) { return probeXmlResponse(req); }
export async function POST(req: Request) { return probeXmlResponse(req); }
