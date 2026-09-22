import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import {
  getCleverTapConnection,
  saveCleverTapConnection,
  removeCleverTapConnection,
  maskCleverTapConnection,
  type CleverTapConnection,
} from "@/lib/integrations/connections";
import { validateConnection } from "@/lib/integrations/clevertap";

const ConnectSchema = z.object({
  accountId: z.string().trim().min(1, "Account ID is required"),
  passcode: z.string().trim().min(1, "Passcode is required"),
  apiBase: z.string().trim().url("API base must be a valid URL"),
  adminEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  testEmails: z
    .array(z.string().trim().email("Invalid test email"))
    .optional()
    .transform((v) => (v && v.length > 0 ? Array.from(new Set(v)) : undefined)),
  region: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getCleverTapConnection(userId);
  return Response.json({ connection: conn ? maskCleverTapConnection(conn) : null });
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
  const parsed = ConnectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const validation = await validateConnection(parsed.data);
  if (!validation.ok) {
    return Response.json(
      { error: `CleverTap rejected credentials: ${validation.error ?? `HTTP ${validation.status}`}` },
      { status: 400 },
    );
  }

  const conn: CleverTapConnection = {
    accountId: parsed.data.accountId,
    passcode: parsed.data.passcode,
    apiBase: parsed.data.apiBase.replace(/\/$/, ""),
    adminEmail: parsed.data.adminEmail,
    testEmails: parsed.data.testEmails,
    region: parsed.data.region,
    projectName: validation.projectName,
    connectedAt: new Date().toISOString(),
  };
  await saveCleverTapConnection(userId, conn);

  return Response.json({ connection: maskCleverTapConnection(conn) });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await removeCleverTapConnection(userId);
  return Response.json({ ok: true });
}
