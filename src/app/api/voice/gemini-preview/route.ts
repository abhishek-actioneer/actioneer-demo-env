import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";

const Schema = z.object({
  voiceName: z.string().min(1),
  text: z.string().trim().min(1).max(1200),
});

function pcm16ToWav(pcmBase64: string, sampleRate = 24000): Buffer {
  const pcm = Buffer.from(pcmBase64, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { voiceName, text } = parsed.data;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    return Response.json({ error: `Gemini TTS error: ${err}` }, { status: 502 });
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };

  const part = json.candidates?.[0]?.content?.parts?.[0];
  const data = part?.inlineData?.data;
  const mime = part?.inlineData?.mimeType ?? "";

  if (!data) return Response.json({ error: "No audio returned from Gemini" }, { status: 502 });

  const rateMatch = mime.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const wav = pcm16ToWav(data, sampleRate);

  return new Response(new Uint8Array(wav), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": wav.length.toString(),
      "Cache-Control": "no-store",
    },
  });
}
