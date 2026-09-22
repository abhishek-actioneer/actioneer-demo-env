/**
 * Serves outbound WhatsApp media at a clean, query-string-free URL.
 *
 * Gupshup fetches media server-side with no credentials, so this route is
 * deliberately public — the same trust model as the attribution redirect at
 * /api/t/[token]. Keys are opaque paths under a private S3 prefix; nothing
 * enumerable is exposed, and the route only ever reads that one prefix.
 *
 * See whatsapp-media-storage.ts for why we serve this ourselves rather than
 * handing out a presigned S3 URL.
 */

import { readWhatsAppMedia } from "@/lib/whatsapp-media-storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const storageKey = (key ?? []).join("/");
  if (!storageKey) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { bytes, contentType } = await readWhatsAppMedia(storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        // Providers re-fetch on retry paths; let their edge keep it a while.
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error(`[whatsapp-media] read failed for "${storageKey}":`, error);
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
