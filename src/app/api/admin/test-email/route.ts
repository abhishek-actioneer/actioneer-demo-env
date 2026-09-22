import { z } from "zod/v4";
import { requireAdminApi } from "@/lib/server/require-admin";
import { companyLoginEmail, generateDemoPassword } from "@/lib/server/provision-utils";
import { renderInviteEmail } from "@/lib/server/invite-email";
import { sendProspectEmail } from "@/lib/server/send-prospect-email";

// Sends a one-off TEST copy of the invite to the deal owner so they can preview
// exactly what the prospect would receive. Creates NO Clerk login and NO record;
// the magic link and password are sample placeholders.
const TestSchema = z.object({
  dealOwner: z.object({ name: z.string().min(1), email: z.string().email() }),
  champion: z.object({ name: z.string(), email: z.string() }).partial().optional(),
  company: z.string().optional(),
});

const SENDER_NAME = "Divyansh";

export async function POST(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = TestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { dealOwner, champion, company } = parsed.data;

  const companyName = company?.trim() || "Acme Corp";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(req.url).origin;

  try {
    const { html, text, subject } = await renderInviteEmail({
      championName: champion?.name?.trim() || "Priya Sharma",
      dealOwnerName: dealOwner.name,
      senderName: SENDER_NAME,
      loginEmail: companyLoginEmail(companyName),
      password: generateDemoPassword(),
      magicLink: `${appUrl}/auth/agent-consume?ticket=sample-preview-ticket`,
      loomUrl: process.env.INVITE_LOOM_URL?.trim() || undefined,
    });
    await sendProspectEmail({
      to: [dealOwner.email],
      subject: `[Test] ${subject}`,
      html,
      text,
      fromName: `${SENDER_NAME} from Actioneer`,
      categories: ["actioneer", "prospect-invite", "test"],
    });
    return Response.json({ ok: true, sentTo: dealOwner.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin/test-email] failed:", message);
    return Response.json({ error: "Test email could not be sent. Check the email configuration." }, { status: 502 });
  }
}
