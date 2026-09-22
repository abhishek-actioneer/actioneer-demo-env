import { auth } from "@clerk/nextjs/server";
import { getTenantConnections, saveCredentials } from "@/lib/tenant-connections-store";
import { listIntegrationConnections } from "@/features/integrations/server/connections";
import type { ConnectionType } from "@/lib/tenant-connections-store";
import { ACTIONEER_CDP_ENABLED } from "@/lib/datasets/constants";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const connections = getTenantConnections(userId);
  const connectionRecords = listIntegrationConnections(userId);
  return Response.json({ connections, connectionRecords });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    type: ConnectionType;
    provider: string;
    credentials: Record<string, string>;
  };

  if (!body.type || !body.credentials) {
    return Response.json({ error: "Missing type or credentials" }, { status: 400 });
  }
  if (body.type === "cdp" && !ACTIONEER_CDP_ENABLED) {
    return Response.json({ error: "Actioneer CDP is not available" }, { status: 404 });
  }

  saveCredentials(userId, body.type, body.provider ?? "", body.credentials);

  const connections = getTenantConnections(userId);
  const connectionRecords = listIntegrationConnections(userId);
  return Response.json({ connections, connectionRecords });
}
