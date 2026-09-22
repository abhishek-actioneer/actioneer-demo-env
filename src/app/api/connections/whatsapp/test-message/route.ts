import { auth } from "@clerk/nextjs/server";
import { sendWhatsAppTemplate } from "@/lib/gupshup-whatsapp-client";
import {
  getWhatsAppMessageStatus,
  recordWhatsAppMessageStatus,
} from "@/lib/whatsapp-message-status-store";

interface TestMessageBody {
  to?: string;
  message?: string;
  apiKey?: string;
  source?: string;
  appName?: string;
  appId?: string;
  templateId?: string;
  templateParams?: string;
  apiBase?: string;
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Failed to send WhatsApp test message";
  if (/template_id|template id|template/i.test(message) && /not set|required|missing/i.test(message)) {
    return "Select an approved template before sending a test message.";
  }
  if (/source/i.test(message) && /not set|required|missing|valid/i.test(message)) {
    return "Source number is required for sending. Use the WhatsApp Business number connected to this Gupshup app.";
  }
  if (/api key|apikey/i.test(message)) {
    return "Gupshup API key is required for sending messages.";
  }
  return message;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as TestMessageBody;
  const to = body.to?.trim();
  if (!to) return Response.json({ error: "Recipient WhatsApp number is required" }, { status: 400 });

  try {
    const result = await sendWhatsAppTemplate(to, {
      userId,
      templateId: body.templateId,
      configuredParams: body.templateParams,
      credentials: {
        apiKey: body.apiKey,
        source: body.source,
        appName: body.appName,
        appId: body.appId,
        templateId: body.templateId,
        templateParams: body.templateParams,
        apiBase: body.apiBase,
      },
      runtimeVariables: {
        message: body.message?.trim() || "Test message from Actioneer",
        body: body.message?.trim() || "Test message from Actioneer",
        text: body.message?.trim() || "Test message from Actioneer",
      },
    });
    if (result.sid) {
      recordWhatsAppMessageStatus({
        gupshupMessageId: result.sid,
        source: result.from,
        destination: result.to,
        templateId: result.templateId,
        appName: body.appName,
        status: "submitted",
        submittedAt: new Date().toISOString(),
      });
    }

    return Response.json(
      { ok: true, messageId: result.sid, status: result.status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: normalizeError(error) },
      { status: 400 },
    );
  }
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId")?.trim();
  if (!messageId) return Response.json({ error: "messageId is required" }, { status: 400 });

  const status = getWhatsAppMessageStatus(messageId);
  return Response.json(
    { ok: true, status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
