import { auth } from "@clerk/nextjs/server";
import { deleteCredentials, getTenantConnections } from "@/lib/tenant-connections-store";
import { listIntegrationConnections } from "@/features/integrations/server/connections";
import type { ConnectionType } from "@/lib/tenant-connections-store";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  deleteCredentials(userId, type as ConnectionType);

  const connections = getTenantConnections(userId);
  const connectionRecords = listIntegrationConnections(userId);
  return Response.json({ connections, connectionRecords });
}
