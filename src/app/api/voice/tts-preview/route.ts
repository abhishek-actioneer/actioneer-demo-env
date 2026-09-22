import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_SARVAM_TTS_PACE, synthesizeSarvamAudio } from "@/lib/sarvam-tts-client";

const PreviewSchema = z.object({
  speaker: z.string().min(1),
  language: z.string().default("Hinglish"),
  text: z.string().trim().min(1).max(160).optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PreviewSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { speaker, language } = parsed.data;
  const text = parsed.data.text || "Namaste, Vastu se calling. Ek minute baat ho payegi?";
  const audio = await synthesizeSarvamAudio(text, language, {
    speaker,
    pace: DEFAULT_SARVAM_TTS_PACE,
    outputAudioCodec: "wav",
  });
  const bytes = Buffer.from(audio, "base64");

  return new Response(bytes, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": bytes.length.toString(),
      "Cache-Control": "no-store",
    },
  });
}
