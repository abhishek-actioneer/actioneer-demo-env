import { requireAdminApi } from "@/lib/server/require-admin";
import { listProvisionedCreds } from "@/lib/server/provisioned-creds-repo";

export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  return Response.json({ creds: listProvisionedCreds() });
}
