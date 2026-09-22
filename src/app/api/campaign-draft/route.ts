import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { generateText, type ModelId } from "@/lib/llm";
import { getSegment } from "@/lib/server/segment-repo";
import { getCleverTapConnection } from "@/lib/integrations/connections";

const DraftSchema = z.object({
  segmentId: z.string().min(1),
  intent: z.string().min(1).max(4000),
  channel: z.enum(["email", "push", "sms", "webpush", "whatsapp"]).optional(),
});

interface DraftPayload {
  channel: "email" | "push" | "sms" | "webpush" | "whatsapp";
  subject: string;
  body: string;
  senderName?: string;
  rationale?: string;
}

function buildDraftPrompt(segmentName: string, segmentDescription: string, userCount: number, channel: string, intent: string, adminEmail?: string): string {
  return `You are a direct-response marketing copywriter drafting ONE campaign message for a targeted user segment. Return a single JSON object — no markdown, no explanation.

SEGMENT
- Name: ${segmentName}
- Description: ${segmentDescription || "(no description provided)"}
- Audience size: ${userCount.toLocaleString()} users

CHANNEL: ${channel}

CAMPAIGN INTENT
${intent}

OUTPUT JSON SHAPE
{
  "channel": "${channel}",
  "subject": "<subject line for email/webpush, title for push — max 60 chars>",
  "body": "<message body — see RULES below>",
  "senderName": "${adminEmail ? "Actioneer" : "Actioneer"}",
  "rationale": "<1 sentence explaining why this copy fits this segment>"
}

RULES
- Tone: concise, warm, human. NO exclamation marks. NO emoji. NO em-dashes.
- For "email": body must be valid HTML using simple tags (<p>, <a>, <strong>). Keep under 180 words. Include ONE clear call-to-action link or button.
- For "push" / "webpush" / "sms": body is plain text, max 140 chars.
- For "whatsapp": body is plain text, max 300 chars, conversational.
- Reference the segment's characteristics if helpful (do not invent specifics that aren't in the description).
- Subject/title should create curiosity without clickbait. Avoid "Act now", "Don't miss out", "Last chance".
- Return ONLY the JSON object.`;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DraftSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { segmentId, intent } = parsed.data;
  const channel = parsed.data.channel ?? "email";

  const segment = getSegment(userId, segmentId);
  if (!segment) return Response.json({ error: "Segment not found" }, { status: 404 });

  const conn = await getCleverTapConnection(userId);

  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const systemPrompt = buildDraftPrompt(segment.name, segment.description ?? "", segment.userCount, channel, intent, conn?.adminEmail);

  try {
    const text = await generateText(intent, { modelId, systemPrompt, jsonMode: true });
    const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const draft = JSON.parse(cleaned) as DraftPayload;

    if (!draft.body || typeof draft.body !== "string") {
      return Response.json({ error: "Model returned an invalid draft" }, { status: 502 });
    }

    return Response.json({
      segmentId,
      segmentName: segment.name,
      userCount: segment.userCount,
      channel: draft.channel ?? channel,
      subject: draft.subject ?? "",
      body: draft.body,
      senderName: draft.senderName ?? "Actioneer",
      senderEmailId: conn?.adminEmail,
      replyTo: conn?.adminEmail,
      rationale: draft.rationale,
    });
  } catch (err) {
    console.error("[campaign-draft] failed:", err);
    return Response.json({ error: (err as Error).message || "Draft generation failed" }, { status: 500 });
  }
}
