import { auth } from "@clerk/nextjs/server";
import { getCredits, upsertCredits } from "@/lib/server/credit-repo";
import { MONTHLY_CREDIT_ALLOWANCE } from "@/lib/credit-types";

function createInitialGrant() {
  const now = Date.now();
  const id = Math.random().toString(36).slice(2, 10);
  const transaction = {
    id,
    type: "grant",
    amount: MONTHLY_CREDIT_ALLOWANCE,
    balanceAfter: MONTHLY_CREDIT_ALLOWANCE,
    timestamp: now,
    source: "grant",
    packName: "14-day trial — 20,000 credits (expires at end of trial)",
  };
  return {
    balance: MONTHLY_CREDIT_ALLOWANCE,
    transactions: JSON.stringify([transaction]),
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let credits = getCredits(userId);

  // First-time user — seed with 20k grant
  if (!credits) {
    const initial = createInitialGrant();
    const orgId = `org-${userId.slice(0, 8)}`;
    upsertCredits(userId, {
      orgId,
      balance: initial.balance,
      transactions: initial.transactions,
    });
    credits = { orgId, balance: initial.balance, transactions: initial.transactions };
  }

  return Response.json(credits);
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { orgId, balance, transactions } = body;
  if (orgId === undefined || balance === undefined) {
    return Response.json({ error: "orgId and balance required" }, { status: 400 });
  }

  upsertCredits(userId, {
    orgId,
    balance,
    transactions: typeof transactions === "string" ? transactions : JSON.stringify(transactions ?? []),
  });
  return Response.json({ ok: true });
}
