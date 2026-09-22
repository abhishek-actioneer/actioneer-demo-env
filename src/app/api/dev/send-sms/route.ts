import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { sendSms } from "@/lib/twilio-sms-client";

const SendSmsSchema = z.object({
  to: z.string().trim().min(8, "Recipient phone number is required").max(32),
  body: z.string().trim().min(1, "Message is required").max(1000),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SendSmsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const result = await sendSms(parsed.data.to, parsed.data.body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[dev/send-sms] failed:", err);
    return Response.json(
      { error: (err as Error).message || "SMS send failed" },
      { status: 500 },
    );
  }
}
