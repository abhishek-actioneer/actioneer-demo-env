import { stmts } from "@/lib/meta-db";

export interface CreditRow {
  org_id: string;
  user_id: string;
  balance: number;
  transactions: string;
}

export interface CreditData {
  orgId: string;
  balance: number;
  transactions: string; // JSON array
}

export function getCredits(userId: string): CreditData | null {
  const row = stmts().creditGet.get(userId) as CreditRow | undefined;
  if (!row) return null;
  return {
    orgId: row.org_id,
    balance: row.balance,
    transactions: row.transactions,
  };
}

export function upsertCredits(userId: string, data: CreditData): void {
  stmts().creditUpsert.run({
    org_id: data.orgId,
    user_id: userId,
    balance: data.balance,
    transactions: data.transactions,
  });
}
