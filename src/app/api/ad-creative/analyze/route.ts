import { generateJsonWithMedia, type GenerateMediaPart } from "@/lib/llm";
import { getOpenAI } from "@/lib/openai-client";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const maxDuration = 120;

const execFileAsync = promisify(execFile);

const ANALYSIS_PROMPT = `You are an expert mobile advertising analyst. You are analyzing an ad creative (video or image) for a mobile app.

Analyze this creative across four dimensions: Visual, Audio, Textual, and Interactive. Be specific and descriptive — name exact elements, colors, transitions, and text you see.

## Output Format

Respond with ONLY valid JSON matching this structure:

{
  "description": "2-3 sentence summary of the entire creative — what it shows, what it communicates, who it targets",

  "visual": {
    "style": "Overall visual style (e.g. cinematic, flat design, UGC-style, animated, live-action)",
    "layout": "How the frame is composed (e.g. vertical 9:16, split-screen, full-bleed video with text overlay)",
    "color_palette": ["List dominant colors"],
    "framing": "Camera work and shot progression (e.g. close-up → wide shot → UI screenshot)",
    "products_and_characters": ["People, mascots, game characters, or products shown"],
    "environments": ["Settings and backgrounds (e.g. stadium, city street, app UI, abstract)"],
    "scenes": [
      {
        "timestamp": "0:00-0:05 (for video) or 'static' (for image)",
        "description": "What happens in this scene segment",
        "transition": "How this scene transitions to the next (cut, fade, swipe, etc.)"
      }
    ],
    "on_screen_text": [
      {
        "timestamp": "When the text appears (or 'static' for images)",
        "text": "Exact text shown",
        "style": "How it looks (font weight, color, animation, position)"
      }
    ]
  },

  "audio": {
    "spoken_dialogue": ["Exact words spoken, in original language with translation if non-English"],
    "hook_line": "The key spoken or displayed hook in the first 3 seconds",
    "voiceover_style": "Gender, energy level, language, accent, tone",
    "background_music": "Genre, tempo, mood, instruments",
    "sound_effects": ["Individual sound effects (e.g. swoosh, coin drop, crowd roar)"],
    "emotional_tone": "The overall emotional feel (e.g. excitement, urgency, FOMO, aspiration, humor)"
  },

  "textual": {
    "headline": "The primary headline or hero text",
    "messaging": ["Key messages communicated (explicit or implicit)"],
    "value_propositions": ["What benefits or offers are highlighted"],
    "calls_to_action": ["CTAs shown (e.g. Download Now, Play Free, Install)"]
  },

  "interactive": {
    "is_playable": false,
    "interactive_elements": ["Any interactive/playable elements if this is a playable ad"],
    "mechanics_shown": ["Game or app mechanics demonstrated visually"],
    "gameplay_demonstrated": "Description of any gameplay or app usage shown"
  },

  "creative_strategy": {
    "hook": "What grabs attention in the first 3 seconds",
    "value_prop": "The core promise of the ad",
    "target_audience": "Who this ad is designed for (demographics, interests, behavior)",
    "format_notes": "Platform optimization notes (aspect ratio, length, placement fit)"
  }
}

## Guidelines

- For images: use "static" for all timestamps, skip audio section fields (set to null or empty)
- For video: be precise with timestamps to the second
- Transcribe ALL on-screen text exactly as shown
- Transcribe ALL spoken dialogue exactly, noting the language
- If the creative is in a non-English language, provide translations in parentheses
- Name specific UI elements, brand assets, and recognizable figures
- Note any dark patterns, misleading elements, or regulatory concerns
- The creative_strategy section is your expert interpretation — be opinionated`;

function detectMediaType(contentType: string, url: string): { type: "video" | "image"; mimeType: string } {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("video/")) return { type: "video", mimeType: ct.split(";")[0] };
  if (ct.startsWith("image/")) return { type: "image", mimeType: ct.split(";")[0] };

  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  const videoExts: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo", webm: "video/webm" };
  const imageExts: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

  if (ext && videoExts[ext]) return { type: "video", mimeType: videoExts[ext] };
  if (ext && imageExts[ext]) return { type: "image", mimeType: imageExts[ext] };

  return { type: "video", mimeType: "video/mp4" };
}

async function extractVideoContext(videoPath: string, workDir: string): Promise<GenerateMediaPart[]> {
  const framesDir = join(workDir, "frames");
  await mkdir(framesDir, { recursive: true });

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-vf",
    "fps=1/5,scale='min(768,iw)':-2",
    "-frames:v",
    "8",
    join(framesDir, "frame-%02d.jpg"),
  ]);

  let transcript = "";
  const audioPath = join(workDir, "audio.wav");
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      audioPath,
    ]);
    const transcription = await getOpenAI().audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "gpt-4o-mini-transcribe",
    });
    transcript = transcription.text ?? "";
  } catch {
    transcript = "";
  }

  const frameNames = (await readdir(framesDir)).filter((name) => name.endsWith(".jpg")).sort();
  const parts: GenerateMediaPart[] = [
    {
      type: "text",
      text: `${ANALYSIS_PROMPT}

The uploaded creative is a video. Analyze these sampled frames in chronological order. Use the transcript below for spoken dialogue/audio when present.

TRANSCRIPT:
${transcript || "(No transcript available or no speech detected.)"}`,
    },
  ];

  for (const [index, frameName] of frameNames.entries()) {
    const bytes = await readFile(join(framesDir, frameName));
    parts.push({
      type: "image",
      filename: `frame-${index + 1}.jpg`,
      dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    });
  }

  return parts;
}

export async function POST(req: Request) {
  const body = await req.json();
  const url: string = body.url;
  if (!url) {
    return Response.json({ error: "URL is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      let workDir: string | null = null;

      try {
        // Phase 1: Download
        send({ phase: "downloading" });
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 100 * 1024 * 1024) throw new Error("File too large (max 100MB)");

        const contentType = res.headers.get("content-type") || "";
        const { type, mimeType } = detectMediaType(contentType, url);
        const ext = mimeType.split("/")[1]?.split("+")[0] || "bin";
        workDir = join(tmpdir(), `creative-${randomUUID()}`);
        await mkdir(workDir, { recursive: true });
        const tmpPath = join(workDir, `source.${ext}`);
        await writeFile(tmpPath, buffer);

        // Phase 2: Prepare media for OpenAI
        send({ phase: "uploading" });
        let parts: GenerateMediaPart[];
        if (type === "image") {
          parts = [
            { type: "text", text: ANALYSIS_PROMPT },
            { type: "image", dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`, filename: `creative.${ext}` },
          ];
        } else {
          send({ phase: "processing" });
          parts = await extractVideoContext(tmpPath, workDir);
        }

        // Phase 3: Analyze
        send({ phase: "analyzing" });
        const analysis = await generateJsonWithMedia(parts, {
          label: "ad-creative-analyze",
          timeoutMs: 90_000,
          maxOutputTokens: 8192,
        });

        const creative = {
          id: randomUUID().slice(0, 16),
          url,
          type,
          mimeType,
          analyzedAt: new Date().toISOString(),
          analysis,
        };

        send({ phase: "complete", creative });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ phase: "error", message });
      } finally {
        if (workDir) {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
