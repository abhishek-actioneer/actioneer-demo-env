import { getAdminIdentity } from "@/lib/server/require-admin";
import { AdminPanel } from "./admin-panel";

// Server-gated: only allowlisted internal emails may render the panel. A
// signed-in non-admin (e.g. a prospect) reaches this and gets the restricted
// view; every /api/admin/* route enforces the same allowlist independently.
export default async function AdminPage() {
  const admin = await getAdminIdentity();

  if (!admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <p className="text-base font-semibold">Access Restricted</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This area is limited to the Actioneer team.
          </p>
        </div>
      </div>
    );
  }

  return <AdminPanel />;
}
