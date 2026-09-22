import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { createAttributionToken } from "@/lib/attribution-store";
import { resolvePublicBaseUrl } from "@/lib/public-base-url";
import { sendSms } from "@/lib/twilio-sms-client";
import { sendWhatsAppTemplate } from "@/lib/gupshup-whatsapp-client";

const BodySchema = z.object({
  to:         z.string().trim().min(8).max(32),
  dest:       z.string().trim().url(),
  channel:    z.enum(["sms", "whatsapp"]).default("sms"),
  windowDays: z.number().int().min(1).max(90).default(7),
  template:   z.string().trim().max(480).optional(),
  templateId: z.string().trim().max(120).optional(),
  templateParams: z.union([z.array(z.string()), z.record(z.string(), z.string())]).optional(),
  contentSid: z.string().trim().max(80).optional(),
  contentVariables: z.record(z.string(), z.string()).optional(),
  messageMode: z.enum(["freeform", "template"]).optional(),
  send:       z.boolean().default(false),
  callId:     z.string().trim().max(80).optional(),
  campaignId: z.string().trim().max(80).optional(),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "disabled in production" }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const {
    to,
    dest,
    channel,
    windowDays,
    template,
    templateId,
    templateParams,
    contentSid,
    contentVariables,
    messageMode,
    send,
    callId,
    campaignId,
  } = parsed.data;
  void messageMode;

  const baseUrl = resolvePublicBaseUrl(req);
  if (!baseUrl) {
    return Response.json({ error: "No public base URL configured — set NEXT_PUBLIC_BASE_URL or APP_URL." }, { status: 500 });
  }

  const attrToken = createAttributionToken({
    callId:      callId      ?? `dev-test-${Date.now()}`,
    campaignId:  campaignId  ?? "dev-test",
    dest,
    channel,
    windowDays,
    recipientId: `dev-${userId.slice(0, 8)}`,
  });

  const trackingUrl = `${baseUrl}/api/t/${attrToken.token}`;

  const messageBody = template?.includes("{link}")
    ? template.replace("{link}", trackingUrl)
    : `Test attribution link: ${trackingUrl}`;

  let smsSent = false;
  let messageSid: string | undefined;
  let sendError: string | undefined;

  if (send) {
    try {
      const result = channel === "whatsapp"
        ? await sendWhatsAppTemplate(to, {
            userId,
            templateId: templateId ?? contentSid,
            configuredParams: templateParams,
            configuredVariables: contentVariables,
            runtimeVariables: {
              message: messageBody,
              body: messageBody,
              text: messageBody,
              link: trackingUrl,
              url: trackingUrl,
              date: new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              }),
              time: new Date().toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              }),
            },
          })
        : await sendSms(to, messageBody, { userId });
      smsSent = true;
      messageSid = result.sid;
    } catch (err) {
      sendError = (err as Error).message;
    }
  }

  return Response.json({
    token:       attrToken.token,
    trackingUrl,
    messageBody,
    expiresAt:   attrToken.expiresAt,
    smsSent,
    messageSid,
    sendError,
  }, { headers: { "Cache-Control": "no-store" } });
}
