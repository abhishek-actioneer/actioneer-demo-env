import { z } from "zod/v4";
import { bdrRoute } from "@/lib/bdr/http";
import { bdrSpeech } from "@/lib/bdr/cartesia";
export const runtime = "nodejs";
export async function POST(req: Request) {
  return bdrRoute(async () => {
    const input = z.object({ text: z.string().trim().min(1).max(1200), voiceId: z.uuid(), language: z.enum(["English", "Hindi", "Hinglish"]) }).parse(await req.json());
    const audio = await bdrSpeech(input.text, input.language, input.voiceId, true);
    return Response.json({ audio: audio.toString("base64") });
  });
}
