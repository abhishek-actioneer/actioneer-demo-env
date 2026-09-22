import { auth } from "@clerk/nextjs/server";
import { readForensicClip, isForensicClipKey } from "@/lib/voice-forensics/clip-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a voice-forensics audio clip as a playable WAV. `key` selects which:
 *   500 | 1000 | 2000 | 5000  — horizon prefixes of the CLEAN (silence-trimmed) track
 *   full-raw                  — entire caller audio at wall-clock time
 *   full-processed            — entire caller audio after VAD silence removal
 * Lets the operator hear precisely what the models received.
 */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const callId = url.searchParams.get("callId")?.trim();
  // Back-compat: `horizonMs` still accepted; `key` is the canonical param.
  const key = (url.searchParams.get("key") ?? url.searchParams.get("horizonMs") ?? "").trim();

  if (!callId) return Response.json({ error: "callId required" }, { status: 400 });
  if (!isForensicClipKey(key)) return Response.json({ error: "invalid clip key" }, { status: 400 });

  const wav = readForensicClip(callId, key);
  if (!wav) return Response.json({ error: "clip not found" }, { status: 404 });

  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${callId}-${key}.wav"`,
    },
  });
}
