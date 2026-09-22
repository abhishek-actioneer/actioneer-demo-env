import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAdminEmail } from "@/lib/admin-allowlist";

export interface AdminIdentity {
  userId: string;
  email: string;
}

/**
 * Resolves the signed-in user's real email via the Clerk Backend SDK and checks
 * it against the admin allowlist. Returns the identity if allowed, else null.
 *
 * We read the email from the backend (not the session token) so authorization
 * can't be spoofed by a crafted JWT claim.
 */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      null;
    if (!isAdminEmail(email)) return null;
    return { userId, email: email as string };
  } catch {
    return null;
  }
}

/**
 * API-route guard. Returns the admin identity, or a ready-to-return 403 Response
 * when the caller is not an allowlisted admin.
 *
 *   const admin = await requireAdminApi();
 *   if (admin instanceof Response) return admin;
 *   // ...admin.email is now trusted
 */
export async function requireAdminApi(): Promise<AdminIdentity | Response> {
  const identity = await getAdminIdentity();
  if (!identity) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return identity;
}
