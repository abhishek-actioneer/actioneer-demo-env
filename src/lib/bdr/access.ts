import { auth, currentUser } from "@clerk/nextjs/server";
export async function requireBdrOperator(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to use AI BDR.");
  const allowed = (process.env.BDR_OPERATOR_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) throw new Error("Set BDR_OPERATOR_EMAILS on the server to grant workspace access.");
  const user = await currentUser();
  const permitted = user?.emailAddresses.some((address) => address.verification?.status === "verified" && allowed.includes(address.emailAddress.toLowerCase()));
  if (!permitted) throw new Error("This account does not have access to the BDR workspace.");
  return userId;
}
