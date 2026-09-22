import { auth } from "@clerk/nextjs/server";
import { fetchGupshupWhatsAppTemplates } from "@/lib/gupshup-whatsapp-client";

interface TemplateListBody {
  apiKey?: string;
  partnerToken?: string;
  appId?: string;
  templateApiMode?: string;
  templateApiBase?: string;
  partnerApiBase?: string;
}

function looksLikeGupshupNamespace(value: string | undefined): boolean {
  return /^[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/i.test(value?.trim() ?? "");
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as TemplateListBody;
  if (looksLikeGupshupNamespace(body.appId)) {
    return Response.json(
      {
        error: "This looks like the Gupshup Namespace, not the Gupshup App ID. Use the appId required by Gupshup's template API, or switch to Partner API with a partner token.",
      },
      { status: 400 },
    );
  }

  try {
    const templates = await fetchGupshupWhatsAppTemplates({
      userId,
      credentials: {
        apiKey: body.apiKey,
        partnerToken: body.partnerToken,
        appId: body.appId,
        templateApiMode: body.templateApiMode,
        templateApiBase: body.templateApiBase,
        partnerApiBase: body.partnerApiBase,
      },
    });
    return Response.json(
      { templates },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Gupshup templates";
    const normalized = /authentication failed/i.test(message)
      ? "Gupshup authentication failed. For Account API, check the API key and Gupshup App ID. For Partner API, switch Template API to Partner API and use the partner token. The App ID is not the WABA ID, Phone Number ID, or Namespace."
      : message;
    return Response.json(
      { error: normalized },
      { status: 400 },
    );
  }
}
