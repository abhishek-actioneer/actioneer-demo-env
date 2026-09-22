// src/lib/credit-store.ts

import type { CreditTransaction, OrgCreditState, CreditSource } from "./credit-types";
import { MONTHLY_CREDIT_ALLOWANCE } from "./credit-types";
import { apiFetch } from "./api-client";

const creditMap = new Map<string, OrgCreditState>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let serverSynced = false;
let serverDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-credits";
const STORAGE_VERSION = 5; // bumped for mock usage
const DEFAULT_ORG_ID = "org-1";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function ensureInitialized() {
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      // Version mismatch — clear stale data so we re-seed
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  if (initialized) return;
  initialized = true;

  // Try restoring from localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: OrgCreditState[] = JSON.parse(stored);
        items.forEach((org) => creditMap.set(org.orgId, org));
        localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
        return;
      }
    } catch {
      console.warn("[credit-store] corrupt localStorage data — clearing");
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }

  // Seed default org with mock usage
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const ps = periodStart.getTime();
  const DAY = 86400000;

  let bal = MONTHLY_CREDIT_ALLOWANCE;
  function tx(offset: number, amount: number, source: CreditSource, preview: string, mode?: "deep" | "quick" | "direct"): CreditTransaction {
    bal -= amount;
    return { id: createId(), type: "deduction", amount, balanceAfter: bal, timestamp: ps + offset * DAY, source, questionPreview: preview, ...(mode ? { queryMode: mode } : {}) };
  }

  const seedTransactions: CreditTransaction[] = [
    { id: createId(), type: "grant", amount: MONTHLY_CREDIT_ALLOWANCE, balanceAfter: MONTHLY_CREDIT_ALLOWANCE, timestamp: ps, source: "grant", packName: "14-day trial — 20,000 credits (expires at end of trial)" },
    tx(1, 12, "schema-mapper", "Schema enrichment after CSV upload"),
    tx(2, 14, "chat", "What are the top revenue drivers this quarter?", "deep"),
    tx(2, 3, "chat", "How many active users today?", "quick"),
    tx(3, 8, "playbook", "Weekly growth report playbook"),
    tx(3, 3, "scout", "Revenue drop alert check"),
    tx(4, 18, "chat", "Analyze cohort retention by acquisition channel", "deep"),
    tx(5, 3, "scout", "Churn spike monitor"),
    tx(5, 1, "chat", "What tables are available?", "direct"),
    tx(6, 11, "chat", "Revenue breakdown by geography and segment", "deep"),
    tx(6, 4, "scout", "Daily engagement check"),
    tx(7, 8, "playbook", "Customer health score playbook"),
    tx(7, 12, "chat", "Compare MoM retention across plans", "deep"),
    tx(8, 3, "scout", "Revenue anomaly detector"),
    tx(8, 5, "schema-mapper", "Schema re-index after column add"),
  ];

  creditMap.set(DEFAULT_ORG_ID, {
    orgId: DEFAULT_ORG_ID,
    orgName: "Acme Corp",
    balance: bal,
    periodCredits: MONTHLY_CREDIT_ALLOWANCE,
    transactions: seedTransactions,
  });

  // Background server hydration
  if (typeof window !== "undefined" && !serverSynced) {
    serverSynced = true;
    hydrateFromServer();
  }
}

async function hydrateFromServer() {
  try {
    const data = await apiFetch<{ orgId: string; balance: number; transactions: string }>(
      "/api/credits",
      { skipModel: true },
    );
    if (data && data.orgId && data.balance > 0) {
      const transactions: CreditTransaction[] = typeof data.transactions === "string"
        ? JSON.parse(data.transactions)
        : data.transactions ?? [];
      creditMap.set(data.orgId, {
        orgId: data.orgId,
        orgName: "Acme Corp",
        balance: data.balance,
        periodCredits: MONTHLY_CREDIT_ALLOWANCE,
        transactions,
      });
      writeLocalStorage();
    } else if (creditMap.size > 0) {
      for (const org of creditMap.values()) {
        syncToServer(org);
      }
    }
  } catch {
    // Server unavailable
  }
}

function syncToServer(org: OrgCreditState) {
  if (serverDebounceTimer) clearTimeout(serverDebounceTimer);
  serverDebounceTimer = setTimeout(() => {
    serverDebounceTimer = null;
    apiFetch("/api/credits", {
      method: "PATCH",
      body: {
        orgId: org.orgId,
        balance: org.balance,
        transactions: JSON.stringify(org.transactions),
      },
      skipModel: true,
    }).catch(() => {});
  }, 2000);
}

function writeLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    const items = Array.from(creditMap.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // silent
  }
}

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    writeLocalStorage();
    for (const org of creditMap.values()) {
      syncToServer(org);
    }
  }, 300);
}

/* ── Public API ── */

export function getOrgCredits(orgId: string = DEFAULT_ORG_ID): OrgCreditState | undefined {
  ensureInitialized();
  return creditMap.get(orgId);
}

export function getBalance(orgId: string = DEFAULT_ORG_ID): number {
  ensureInitialized();
  return creditMap.get(orgId)?.balance ?? 0;
}

export function getTransactionHistory(orgId: string = DEFAULT_ORG_ID, limit?: number): CreditTransaction[] {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return [];
  const sorted = [...org.transactions].sort((a, b) => b.timestamp - a.timestamp);
  return limit ? sorted.slice(0, limit) : sorted;
}

/** Generate a fixed credit cost based on query mode */
export function generateCreditCost(mode: "deep" | "quick" | "direct"): number {
  switch (mode) {
    case "deep": return 12;
    case "quick": return 3;
    case "direct": return 1;
  }
}

export function deductCredits(
  amount: number,
  meta: {
    source?: CreditSource;
    conversationId?: string;
    messageId?: string;
    queryMode?: "deep" | "quick" | "direct";
    questionPreview?: string;
  },
  orgId: string = DEFAULT_ORG_ID,
): CreditTransaction | null {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return null;

  const newBalance = Math.max(0, org.balance - amount);
  const txn: CreditTransaction = {
    id: createId(),
    type: "deduction",
    amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    source: meta.source ?? "chat",
    ...meta,
  };

  org.balance = newBalance;
  org.transactions.push(txn);
  creditMap.set(orgId, { ...org });
  persistToStorage();
  return txn;
}

/** Top up with a specified credit amount */
export function topUpCredits(
  credits: number = MONTHLY_CREDIT_ALLOWANCE,
  orgId: string = DEFAULT_ORG_ID,
): CreditTransaction | null {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return null;

  const newBalance = org.balance + credits;
  const txn: CreditTransaction = {
    id: createId(),
    type: "topup",
    amount: credits,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    source: "topup",
    packName: `${credits.toLocaleString()} credit top-up`,
  };

  org.balance = newBalance;
  org.transactions.push(txn);
  creditMap.set(orgId, { ...org });
  persistToStorage();
  return txn;
}

/** Get daily usage split by chat vs background agents for stacked chart */
export function getDailyUsageBySource(days: number = 30, orgId: string = DEFAULT_ORG_ID): { date: string; chat: number; agent: number }[] {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return [];

  const now = new Date();
  const result: { date: string; chat: number; agent: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayStart = new Date(dateStr).getTime();
    const dayEnd = dayStart + 86400000;

    let chat = 0;
    let agent = 0;
    for (const t of org.transactions) {
      if (t.type !== "deduction" || t.timestamp < dayStart || t.timestamp >= dayEnd) continue;
      if (t.source === "chat") chat += t.amount;
      else agent += t.amount;
    }

    result.push({ date: dateStr, chat, agent });
  }

  return result;
}

/** Get total credits used this period (all deductions) */
export function getTotalUsed(orgId: string = DEFAULT_ORG_ID): number {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return 0;
  return org.transactions
    .filter((t) => t.type === "deduction")
    .reduce((sum, t) => sum + t.amount, 0);
}

/** Get background agent usage broken down by source type */
export function getAgentBreakdown(orgId: string = DEFAULT_ORG_ID): { source: CreditSource; label: string; credits: number }[] {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return [];

  const agentSources: CreditSource[] = ["playbook", "scout", "schema-mapper"];
  const labels: Record<string, string> = { playbook: "Playbook runs", scout: "Scout runs", "schema-mapper": "Schema Mapper" };
  const totals = new Map<CreditSource, number>();

  for (const t of org.transactions) {
    if (t.type !== "deduction") continue;
    if (agentSources.includes(t.source)) {
      totals.set(t.source, (totals.get(t.source) ?? 0) + t.amount);
    }
  }

  return agentSources
    .map((s) => ({ source: s, label: labels[s] ?? s, credits: totals.get(s) ?? 0 }))
    .filter((r) => r.credits > 0)
    .sort((a, b) => b.credits - a.credits);
}
