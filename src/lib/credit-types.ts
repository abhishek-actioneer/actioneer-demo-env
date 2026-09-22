// src/lib/credit-types.ts

export type CreditSource = "chat" | "playbook" | "scout" | "schema-mapper" | "topup" | "grant";

export interface CreditTransaction {
  id: string;
  type: "deduction" | "topup" | "grant";
  amount: number;
  balanceAfter: number;
  timestamp: number;
  source: CreditSource;
  // Deduction metadata
  conversationId?: string;
  messageId?: string;
  queryMode?: "deep" | "quick" | "direct";
  questionPreview?: string;
  // Top-up / grant metadata
  packName?: string;
}

export interface OrgCreditState {
  orgId: string;
  orgName: string;
  balance: number;
  periodCredits: number; // total credits for this billing period (e.g. 20000)
  transactions: CreditTransaction[];
}

/** Monthly credit allowance */
export const MONTHLY_CREDIT_ALLOWANCE = 20_000;

export type TopUpTier = "base" | "plus" | "max";

export interface TopUpOption {
  id: TopUpTier;
  credits: number;
  label: string;
}

export const TOP_UP_OPTIONS: TopUpOption[] = [
  { id: "base", credits: 20_000, label: "20,000 credits" },
  { id: "plus", credits: 50_000, label: "50,000 credits" },
  { id: "max", credits: 100_000, label: "100,000 credits" },
];
