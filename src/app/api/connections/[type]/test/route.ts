import { auth } from "@clerk/nextjs/server";
import {
  actioneerCdpProvider,
  cleverTapProvider,
  gupshupWhatsAppProvider,
  plivoDialerProvider,
  twilioProvider,
} from "@/features/integrations/server/provider-registry";
import { ACTIONEER_CDP_ENABLED } from "@/lib/datasets/constants";

interface TestBody {
  authId?: string;
  accountSid?: string;
  authToken?: string;
  from?: string;
  apiKey?: string;
  source?: string;
  appName?: string;
  templateId?: string;
  templateParams?: string;
  templateApiBase?: string;
  accountId?: string;
  passcode?: string;
  apiBase?: string;
  profileServiceUrl?: string;
  baseUrl?: string;
  tenantId?: string;
  teamId?: string;
  appId?: string;
  apiToken?: string;
  authenticatedHeader?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  const body = await req.json() as TestBody;
  const config = body as Record<string, string | undefined>;

  if (type === "sms") {
    const result = await twilioProvider.testConnection(config);
    return Response.json({ ok: result.ok, accountName: result.label, error: result.error, status: result.status });
  }

  if (type === "whatsapp") {
    const result = await gupshupWhatsAppProvider.testConnection(config);
    return Response.json({ ok: result.ok, accountName: result.label, error: result.error, status: result.status });
  }

  if (type === "plivo") {
    const result = await plivoDialerProvider.testConnection(config);
    return Response.json({ ok: result.ok, accountName: result.label, error: result.error, status: result.status });
  }

  if (type === "clevertap") {
    const result = await cleverTapProvider.testConnection(config);
    return Response.json({ ok: result.ok, accountName: result.label, error: result.error, status: result.status });
  }

  if (type === "cdp") {
    if (!ACTIONEER_CDP_ENABLED) {
      return Response.json({ ok: false, error: "Actioneer CDP is not available" }, { status: 404 });
    }
    const result = await actioneerCdpProvider.testConnection(config);
    return Response.json({ ok: result.ok, accountName: result.label, error: result.error, status: result.status });
  }

  return Response.json({ ok: false, error: "Test not supported for this connection type" });
}
