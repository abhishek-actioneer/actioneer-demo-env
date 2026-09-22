import { auth } from "@clerk/nextjs/server";
import { getDataset, DEFAULT_DATASET } from "@/lib/datasets";
import { generateImage } from "@/lib/llm";

function safeDatasetId(raw: string | null): string {
  if (!raw) return DEFAULT_DATASET;
  if (!/^[a-z0-9-]+$/.test(raw) || raw.length > 64) return DEFAULT_DATASET;
  return raw;
}

const MAX_PROMPT = 2000;
const ALLOWED_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
type Ratio = (typeof ALLOWED_RATIOS)[number];

function stripHtml(html: string, max = 320): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function firstParagraphs(text: string, maxLines = 4): string {
  return text
    .split(/\n\s*\n/)
    .slice(0, maxLines)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildGroundedPrompt(opts: {
  userPrompt?: string;
  datasetLabel?: string;
  entityName?: string;
  businessSummary?: string;
  subject?: string;
  body?: string;
  segmentName?: string;
}): string {
  const lines: string[] = [];
  lines.push("Generate a single image suitable as the hero/inline visual for an email campaign.");
  lines.push("");
  lines.push("BUSINESS CONTEXT");
  if (opts.datasetLabel) lines.push(`- Brand / product: ${opts.datasetLabel}`);
  if (opts.entityName) lines.push(`- Audience: ${opts.entityName}`);
  if (opts.businessSummary) lines.push(`- About: ${opts.businessSummary}`);

  if (opts.subject || opts.body || opts.segmentName) {
    lines.push("");
    lines.push("EMAIL CONTEXT");
    if (opts.segmentName) lines.push(`- Sending to segment: ${opts.segmentName}`);
    if (opts.subject) lines.push(`- Subject line: "${opts.subject}"`);
    if (opts.body) lines.push(`- Body excerpt: "${opts.body}"`);
  }

  lines.push("");
  if (opts.userPrompt) {
    lines.push("CREATIVE BRIEF (from the user — interpret in context of the business and email above)");
    lines.push(opts.userPrompt);
  } else {
    lines.push("CREATIVE BRIEF");
    lines.push("No explicit brief — choose a single, evocative scene that complements the email subject and body above, set in the business context, that a recipient would find emotionally resonant. Decide the subject yourself; do not generate something generic.");
  }

  lines.push("");
  lines.push("STYLE GUIDANCE");
  lines.push("- Photoreal unless the email tone reads as playful / illustrated.");
  lines.push("- Tone consistent with the business above (formal financial brand → restrained; consumer brand → warmer).");
  lines.push("- Composition designed to work as an email banner — clear focal point, breathing room, no critical detail near edges.");
  lines.push("- Avoid embedded text overlays unless the brief explicitly asks for them.");
  lines.push("- No watermarks, no UI chrome, no logos unless present in the business context.");

  return lines.join("\n");
}

function imageSizeForRatio(ratio: Ratio): "1024x1024" | "1536x1024" | "1024x1536" {
  const [w, h] = ratio.split(":").map(Number);
  if (w === h) return "1024x1024";
  return w > h ? "1536x1024" : "1024x1536";
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY not configured." },
      { status: 503 },
    );
  }

  let body: {
    prompt?: string;
    aspectRatio?: string;
    subject?: string;
    body?: string;
    segmentName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userPrompt = (body.prompt ?? "").trim();
  if (userPrompt.length > MAX_PROMPT) {
    return Response.json({ error: `prompt too long (max ${MAX_PROMPT} chars)` }, { status: 400 });
  }
  // Empty prompt is allowed — server relies on business + email context to brief the model.

  const aspectRatio: Ratio =
    body.aspectRatio && (ALLOWED_RATIOS as readonly string[]).includes(body.aspectRatio)
      ? (body.aspectRatio as Ratio)
      : "16:9";

  // Resolve dataset context from x-dataset-id header
  const datasetId = safeDatasetId(req.headers.get("x-dataset-id"));
  let datasetLabel: string | undefined;
  let entityName: string | undefined;
  let businessSummary: string | undefined;
  try {
    const ds = getDataset(datasetId);
    datasetLabel = ds.label;
    entityName = ds.entityName;
    businessSummary = firstParagraphs(ds.systemContext, 4);
  } catch {
    // Unknown dataset — proceed without business context
  }

  const subjectClean = body.subject?.trim().slice(0, 200);
  const bodyExcerpt = body.body ? stripHtml(body.body, 320) : undefined;
  const segmentName = body.segmentName?.trim().slice(0, 120);

  const groundedPrompt = buildGroundedPrompt({
    userPrompt,
    datasetLabel,
    entityName,
    businessSummary,
    subject: subjectClean,
    body: bodyExcerpt,
    segmentName,
  });

  let image;
  try {
    image = await generateImage({
      prompt: groundedPrompt,
      size: imageSizeForRatio(aspectRatio),
      label: "assets-generate",
      timeoutMs: 120_000,
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? "Image generation failed" },
      { status: 500 },
    );
  }

  const mimeType = image.mimeType;
  const base64 = image.base64;
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const size = Math.round((base64.length * 3) / 4);

  return Response.json({
    dataUrl,
    contentType: mimeType,
    size,
    userPrompt,
    groundedPrompt,
    aspectRatio,
  });
}
