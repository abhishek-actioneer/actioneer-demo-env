import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { synthesizeCartesiaMulaw } from "@/lib/cartesia-tts-client";

const PreviewSchema = z.object({
  text: z.string().trim().min(1).max(240).default("Namaste, Vastu se calling. Ek minute baat ho payegi?"),
  language: z.string().default("Hinglish"),
  voiceId: z.string().min(1).optional(),
});

function mulawWav(audio: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + audio.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(7, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PreviewSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const audio = Buffer.from(
    await synthesizeCartesiaMulaw(parsed.data.text, parsed.data.language, {
      voiceId: parsed.data.voiceId,
    }),
    "base64",
  );
  const wav = mulawWav(audio);

  return new Response(new Uint8Array(wav), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": wav.length.toString(),
      "Cache-Control": "no-store",
    },
  });
}
